// BlastSimulator2026 — Vehicle reservation for vehicle-gated actions (#550)
// Owns the exclusive claim a PendingAction holds on a Vehicle: finding one to
// claim, reserving it, promoting the claim to an active moveTo itinerary
// (#1089), and releasing it — whether that's on completion, cancellation,
// needs-interruption, or the vehicle being destroyed underneath it.
// EmployeeDispatchSteps.ts's claim/promotion sites call into this module
// rather than duplicating any of it.
// Deliberately does NOT import TaskDispatch.ts directly — TaskDispatch.ts's
// own module re-exports from TaskCancellation.ts, which imports
// releaseVehicleReservation from here, so calling into TaskDispatch.ts
// directly would double back immediately. Where reconciliation needs to
// interrupt an active action (case (c) below), it reports the need to its
// caller instead of performing the interruption itself — see
// reconcileVehicleReservations's return type and ArrivalGate.ts, the sole
// caller, which already imports both modules safely.
// A cycle exists through this module's own imports (#1089): MoveTo.ts ->
// PlanItinerary.ts -> findFreeVehicleForRole (here). Safe for the same
// reason the EntityMovementTick.ts <-> VehicleOccupancyReroute.ts cycle that
// used to run through here was safe: every import is a function
// declaration, called only from inside other function bodies, never
// evaluated at module-load time — ESM resolves the cycle fine as long as
// nothing at the top level reads a not-yet-initialized binding.

import type { GameState, PendingAction } from '../state/GameState.js';
import type { Employee } from '../entities/Employee.js';
import type { Vehicle, VehicleRole } from '../entities/Vehicle.js';
import type { EventEmitter } from '../state/EventEmitter.js';
import { ROLE_LICENCE_REQUIRED } from '../entities/VehicleDriverAssignment.js';
import { moveTo } from './MoveTo.js';
import { startVehicleGatedFragmentWork, abortVehicleGatedFragmentWork } from '../economy/FragmentTaskLifecycle.js';
import { alight } from './Mount.js';
// Direct import from TaskLifecycleCore.ts, not TaskDispatch.ts (see this
// module's own header comment on the cycle TaskDispatch.ts's re-export would
// close) — TaskCancellation.ts already imports completePendingAction the
// same way, for the same reason.
import { completePendingAction, clearActiveTaskFields } from './TaskLifecycleCore.js';

/** True when `employee` holds the licence a vehicle of `role` requires (ROLE_LICENCE_REQUIRED, VehicleDriverAssignment.ts). */
export function isLicensedForRole(employee: Employee, role: VehicleRole): boolean {
  const requiredLicence = ROLE_LICENCE_REQUIRED[role];
  return employee.qualifications.some(q => q.category === requiredLicence);
}

/**
 * True when `employee` currently holds an active, vehicle-gated PendingAction
 * and is themself the boarded driver of the vehicle reserved for it — whether
 * still driving toward the target (taskTicksRemaining not yet seeded by
 * ArrivalGate) or already arrived and mid-execution (taskTicksRemaining set).
 * Used by TaskCancellation.ts's interruptActiveAction, combined with
 * `taskTicksRemaining === null` there (mid-drive phase only — see that call
 * site's own inline comment for why the mid-execution phase never reaches
 * that branch at all).
 *
 * A boarded, vehicle-gated action's own mid-execution phase carries no
 * ForceShiftRest.ts guard any more (#1090 deleted the dismount-on-completion/
 * interruption mechanism a walk-and-reboard cost used to justify protecting
 * against — see PROTECTED_MID_EXECUTION_ACTION_TYPES's own doc comment,
 * ForceShiftRest.ts). An on-foot (non-vehicle-gated) task's own interruption
 * discards in-progress ticks the same way it always has, which is why this
 * check stays scoped to `requiredVehicleRole !== null` rather than any
 * in-progress task: using this (instead of a blanket taskTicksRemaining !==
 * null guard, regardless of action type) specifically keeps a long-running
 * on-foot task interruptible — a blanket guard let a generic multi-tick
 * `employee dispatch` task defer a policy-forced rest for its whole duration,
 * letting fatigue swing far past the policy's own threshold every work cycle
 * and crash morale over a long run (needs.integration.test.ts's own long-run
 * wellBeing acceptance case, #945 follow-up regression).
 */
export function isMidVehicleGatedWork(state: GameState, employee: Employee): boolean {
  if (employee.activeActionId === null) return false;
  const action = state.pendingActions.find(a => a.id === employee.activeActionId);
  if (!action || action.requiredVehicleRole === null) return false;
  return state.vehicles.vehicles.some(
    v => v.reservedForActionId === action.id && v.driverId === employee.id,
  );
}

/**
 * Cheapest-eligible free vehicle of `role` for `employee`: unreserved
 * (reservedForActionId === null), not `broken`, not already mid vehicle-gated
 * fragment work (haulingPhase/breakPhase both null — #974 follow-up: a
 * debris_hauler/rock_fragmenter driven out-of-band by the manual `vehicle
 * haul`/`vehicle break` console command never sets reservedForActionId, so
 * without this check a continuity claim could "free-ride" a driver who
 * appears idle to the dispatch system onto a vehicle that is, in reality,
 * already mid-haul/mid-break on unrelated cargo. The claim would then fail
 * at promotion time (requestHaulFragment/requestBreakBoulder's own
 * already-busy guard) and releaseVehicleReservationKeepDriver's
 * abortVehicleGatedFragmentWork call would abort that unrelated in-flight
 * work, discarding real progress instead of the harmless no-op it was before
 * #974 — traced via blast-oversized-boulders.integration.test.ts's manually
 * hauled piece being aborted mid-drive by a same-tick self-dispatch claim for
 * a different fragment), and either undriven (driverId === null) or already
 * driven by `employee` themself (the continuity case — lets a claim
 * naturally re-pick the vehicle the employee is already sitting in for their
 * next same-role task).
 * Ties broken by straight-line distance to `employee` (nearest wins — the
 * employee has to walk there before driving it anywhere, so a farther,
 * otherwise-identical vehicle is a pure extra cost with nothing gained),
 * then by lowest vehicle id for any exact-distance tie. Distance-based
 * (#1002 follow-up): an earlier, id-only tie-break could hand a freshly
 * released, unboarded reservation's own vehicle to a same-tick claim by an
 * unrelated employee standing right next to it, while assigning that vehicle
 * to a DIFFERENT, farther free vehicle instead purely because it happened to
 * have a lower id — direct-traced via a starvation-override release
 * (VehicleContinuity.ts's completeVehicleGatedActionIfApplicable) whose own
 * just-dismounted driver's vehicle (unrelated, farther, lower id) won the
 * tie-break over the released reservation's own vehicle (right next to the
 * idle employee actually claiming it). Read-only — never mutates. Returns
 * null when none qualify.
 */
export function findFreeVehicleForRole(state: GameState, role: VehicleRole, employee: Employee): Vehicle | null {
  if (!isLicensedForRole(employee, role)) return null;

  const qualifying = state.vehicles.vehicles.filter(v =>
    v.type === role &&
    v.state !== 'broken' &&
    v.reservedForActionId === null &&
    v.haulingPhase === null &&
    v.breakPhase === null &&
    (v.driverId === null || v.driverId === employee.id),
  );
  if (qualifying.length === 0) return null;

  // No continuity special-case (#1090): a mounted employee's own vehicle sits
  // at their exact position (I2), so it is already at distance 0 from them —
  // nothing else can tie that — and wins the distance-based tie-break below
  // on its own merits, with no separate branch needed.
  const distanceSquared = (v: Vehicle) => (v.x - employee.x) ** 2 + (v.z - employee.z) ** 2;
  return qualifying.reduce((nearest, v) => {
    const d = distanceSquared(v);
    const dNearest = distanceSquared(nearest);
    if (d < dNearest) return v;
    if (d === dNearest && v.id < nearest.id) return v;
    return nearest;
  });
}

/** Marks `vehicle` reserved for `actionId`. Caller must have already confirmed the vehicle came from findFreeVehicleForRole this same tick. */
export function reserveVehicle(vehicle: Vehicle, actionId: number): void {
  vehicle.reservedForActionId = actionId;
}

/**
 * Vehicle-gate check shared by both of EmployeeDispatchSteps.ts's claim sites (#550): for
 * a non-vehicle action this is always a pass-through no-op; for a
 * vehicle-gated one it finds (but does not yet reserve) a qualifying free
 * vehicle via findFreeVehicleForRole above. `ok: false` means this employee
 * cannot claim this action right now — same "stays queued, retries next
 * tick" outcome as selectBestActionForEmployee returning null for an
 * unreachable target, not an error.
 */
export function findVehicleForClaim(
  state: GameState,
  action: PendingAction,
  employee: Employee,
): { ok: true; vehicle: Vehicle | null } | { ok: false } {
  if (action.requiredVehicleRole === null) return { ok: true, vehicle: null };
  const vehicle = findFreeVehicleForRole(state, action.requiredVehicleRole, employee);
  return vehicle === null ? { ok: false } : { ok: true, vehicle };
}

/**
 * Vehicle-gated claim transition (#550): instead of walking to the action's
 * own target, the employee walks to (or, already driving it — moveTo/
 * planItinerary's own continuity — skips straight past) the vehicle reserved
 * for this action at claim time. Called by EmployeeDispatchSteps.ts's
 * promoteActionToActive when action.requiredVehicleRole is set.
 *
 * Deliberately does NOT call seedTaskTimerFields here — that only happens
 * once the EMPLOYEE (and, by I2, their vehicle) reaches action.targetX/
 * targetZ, via ArrivalGate.tickArrivalGate's own vehicle-gated branch
 * (#1089, mirrors the pre-itinerary vehicle-drive loop's identical
 * deferral). Staying null during the whole walk/drive is also what keeps
 * this action interruptible mid-drive by ForceShiftRest.ts's legacy path
 * (its own `pendingTaskDuration !== null` guard, #922) and what keeps
 * `dig_ramp_segment`'s own live-voxel-count duration formula reading the
 * grid at actual arrival rather than at claim time, before an externally
 * timed clearing has had a chance to land (#924). haul_debris/fragment_debris
 * are driven end to end by their own phase machinery
 * (HaulingTask.ts/BoulderBreaking.ts) regardless — they never seed a work
 * timer through this path at all.
 */
export function promoteVehicleGatedAction(state: GameState, employee: Employee, action: PendingAction): void {
  const vehicle = state.vehicles.vehicles.find(v => v.reservedForActionId === action.id);
  // Reservation vanished between claim and promotion (shouldn't happen within
  // a single tick, but reconcileVehicleReservations is the backstop if it
  // ever does) — leave the employee idle-but-claimed; next tick's reconcile
  // sweep interrupts the action back to the pool.
  if (!vehicle) return;

  const continuity = vehicle.driverId === employee.id;
  const isFragmentGated = action.type === 'haul_debris' || action.type === 'fragment_debris';

  // #1089: a fresh boarding and the continuity case (already driving this
  // vehicle) both collapse into one moveTo call — planItinerary drops the
  // leading foot leg when the employee is already mounted in `vehicle`, so
  // continuity needs no boarding walk either way.
  const result = moveTo(state, employee.id, { x: action.targetX, z: action.targetZ }, { via: vehicle.id });
  if (!result.success) return;

  // #552: haul_debris/fragment_debris are driven end to end by their own
  // request*/tick* phase machinery (HaulingTask.ts/BoulderBreaking.ts), not
  // the itinerary's own drive leg above. A fresh boarding's own arrival step
  // (Locomotion.ts) starts that work the tick the employee actually boards;
  // continuity never walks through a board arrival step at all (the driver
  // is already seated this exact tick), so it has to be kicked off here
  // instead — mirroring what the fresh-boarding arrival step does.
  if (continuity && isFragmentGated) {
    const started = startVehicleGatedFragmentWork(state, vehicle, action);
    if (started === true) {
      // Phase machinery now owns driving this vehicle — the itinerary's own
      // single drive leg (targeting the fragment's raw position, not the
      // approach cell requestHaulFragment/requestBreakBoulder just staged)
      // would otherwise fight it for the same vehicle's x/z next tick.
      employee.itinerary = null;
    } else if (started === false) {
      // Conditions changed between claim and promotion (fragment gone, no
      // active depot) — release the reservation so
      // reconcileVehicleReservations (ArrivalGate.ts) catches it next tick
      // and returns the action to the pool instead of leaving it claimed
      // with nothing actually working it. releaseVehicleReservation is
      // claim-only (#1090) — the driver stays mounted, exactly what
      // continuity means here.
      releaseVehicleReservation(state, action.id);
    }
  }
}

/**
 * Shared prefix of releaseVehicleReservation: find the vehicle reserved for
 * `actionId`, abort any in-flight vehicle-gated fragment work on it
 * (returning cargo to the ground first if mid-haul), clear the reservation,
 * and reset the vehicle's own display task/state to idle. Returns the
 * vehicle for the caller's own remaining logic, or null when no vehicle is
 * reserved for `actionId` — the caller returns early exactly as before in
 * that case.
 *
 * The task/state reset lives here (#1090) because releaseVehicleReservation
 * is claim-only and no longer resets it via dismountVehicleDriver: without
 * it, task/state would sit frozen at whatever VEHICLE_ROLE_ARRIVAL_TASK the
 * arrival step set (Locomotion.ts) — e.g. still reading "drilling" — for as
 * long as a still-mounted driver goes without a same-role follow-up. Driver
 * mounting (driverId/locomotion) is untouched here — only the derived
 * display fields reset.
 */
function findAndAbortReservedVehicle(state: GameState, actionId: number): Vehicle | null {
  const vehicle = state.vehicles.vehicles.find(v => v.reservedForActionId === actionId);
  if (!vehicle) return null;

  abortVehicleGatedFragmentWork(state, vehicle);
  vehicle.reservedForActionId = null;
  vehicle.task = 'idle';
  vehicle.state = 'idle';
  vehicle.waitingTicks = 0;
  return vehicle;
}

/**
 * Full dismount of `vehicle`'s driver, if any: aborts any in-flight
 * vehicle-gated fragment work (haulingPhase/breakPhase) first, so that
 * unassignDriver's own fail-closed guard (Vehicle.ts — it refuses to clear
 * driverId while haulingPhase is set) is guaranteed to succeed rather than
 * silently no-op. A caller that skipped the abort and ignored
 * unassignDriver's return value could flip task/state to idle while
 * driverId/haulingPhase stayed set — next tick's tickHaulingProgress would
 * then find haulingPhase !== null, re-drive the vehicle at the same
 * unreachable target, and reproduce the exact stuck-forever bug this
 * dismount exists to fix (#986 review follow-up).
 *
 * No-op (past the abort) if the vehicle currently has no driver.
 *
 * Shared by releaseVehicleReservation, whose `findAndAbortReservedVehicle`
 * already aborts as part of clearing the reservation (a second, idempotent
 * abort here is a harmless no-op in that case), and by Locomotion.ts's own
 * sustained-stuck release (advanceLeg's abandon branch) for a vehicle driven
 * with no PendingAction at all (a manual `vehicle driver`/`vehicle haul`
 * console command) — interruptActiveAction(..., actionId: null, ...) is a
 * no-op in that case (nothing to release via an action), so that caller
 * holds the vehicle directly and calls this instead of going through
 * releaseVehicleReservation.
 */
export function dismountVehicleDriver(state: GameState, vehicle: Vehicle, emitter?: EventEmitter): void {
  abortVehicleGatedFragmentWork(state, vehicle);
  if (vehicle.driverId === null) return;

  // #1089: Locomotion.ts is now the only writer of a vehicle's x/z, and it
  // writes the mounted employee's own x/z in the same step (I2) — the two
  // can never drift apart mid-tick the way the pre-itinerary tickVehicle
  // model's own separate syncDriverPosition call (dropped here) had to
  // defend against.
  alight(state, vehicle.id, emitter);
  vehicle.task = 'idle';
  vehicle.state = 'idle';
  vehicle.waitingTicks = 0;
}

/**
 * Claim-only release (#1090): aborts any in-flight vehicle-gated fragment
 * work on the reserved vehicle (returning cargo to the ground first if
 * mid-haul) and clears reservedForActionId. Never dismounts — a mounted
 * driver stays mounted. Used by cancellation, needs-interruption, ordinary
 * completion, and the routine (non-death) branches of the reconciliation
 * sweep; "nothing dismounts automatically any more" is what makes staying
 * mounted across a same-role follow-up an emergent property of cost ranking
 * (planItinerary/resolveActionCost) rather than a mechanism this function
 * drives. No-op if no vehicle is reserved for `actionId`.
 *
 * A dead reservation holder is the one release reason that still needs an
 * explicit dismount — see reconcileVehicleReservations's own dead-holder
 * branch and TaskCancellation.ts's releaseDeadEmployeeActions, both of which
 * call dismountVehicleDriver directly rather than through this function.
 */
export function releaseVehicleReservation(state: GameState, actionId: number): void {
  findAndAbortReservedVehicle(state, actionId);
}

/**
 * Completion resolution for a vehicle-gated action (#1090) — replaces
 * VehicleContinuity.ts's completeVehicleGatedActionIfApplicable (deleted).
 * Releases the vehicle reservation (via releaseVehicleReservation above —
 * claim-only, never dismounts the driver), clears `employee`'s own
 * active-task fields (clearActiveTaskFields, TaskLifecycleCore.ts — a no-op
 * when tickTaskProgress's employee-timer path already cleared them, but the
 * only place that ever does for a haul_debris/fragment_debris completion,
 * whose work is phase-driven and never runs through that timer at all —
 * without this, the employee's own `activeActionId` stays stuck naming the
 * just-completed action forever, never reading as idle for dispatch to pick
 * up a new one, even though the vehicle itself finished and sits idle), and
 * completes the PendingAction (via completePendingAction,
 * TaskLifecycleCore.ts). Staying mounted across a same-role follow-up is no
 * longer a mechanism this function drives — it falls out of
 * estimateActionCost/resolveActionCost (ActionSelection.ts) naturally
 * ranking the still-mounted driver's own next same-role action cheapest,
 * since planItinerary plans them a zero-length first leg.
 *
 * releaseVehicleReservation itself resets the vehicle's display task/state
 * to idle (findAndAbortReservedVehicle, #1090) — no separate reset needed
 * here.
 */
export function completeVehicleGatedAction(state: GameState, employee: Employee, actionId: number): void {
  releaseVehicleReservation(state, actionId);
  clearActiveTaskFields(employee);
  completePendingAction(state, actionId);
}

/**
 * Natural-completion release: called once a vehicle-gated action finishes
 * its work timer. If the vehicle's reservedForActionId still equals
 * `completedActionId`, dismounts the driver and frees the vehicle.
 * If it now names a different action id, a same-role follow-up already
 * claimed this same vehicle — leaves driverId/reservation untouched so
 * the employee stays mounted.
 */
export function releaseVehicleOnCompletion(state: GameState, employee: Employee, completedActionId: number): void {
  const vehicle = state.vehicles.vehicles.find(v => v.reservedForActionId === completedActionId);
  if (!vehicle) return;
  // Defensive: only the driver whose action just completed may trigger the
  // release — a mismatch here means the reservation/driver bookkeeping has
  // already drifted, and reconcileVehicleReservations is the one to fix it.
  if (vehicle.driverId !== null && vehicle.driverId !== employee.id) return;

  releaseVehicleReservation(state, completedActionId);
}

/**
 * Resolves the living employee currently holding `action`'s reservation on
 * `vehicle`: the action's own holderId when set, falling back to the
 * vehicle's driverId (the state before an action's holderId is assigned, at
 * claim time) — undefined when no id resolves, or when the resolved
 * employee no longer exists or is dead. Shared by reconcileVehicleReservations
 * below and WorldInvariants.ts's I5 check, which layers one more validity
 * test (whether the mounting itself still agrees) on top of this lookup.
 */
export function resolveReservationHolder(
  state: GameState,
  vehicle: Vehicle,
  action: PendingAction,
): Employee | undefined {
  const holderId = action.holderId ?? vehicle.driverId;
  if (holderId === null) return undefined;
  const holder = state.employees.employees.find(e => e.id === holderId);
  return holder && holder.alive ? holder : undefined;
}

/** One active action reconcileVehicleReservations found needing interruption — its reserved vehicle vanished before the holder started their work timer. The caller (ArrivalGate.ts) performs the actual interruptActiveAction call, since that lives in TaskDispatch.ts and this module cannot import it without a cycle. */
export interface VehicleGoneInterruption {
  employee: Employee;
  actionId: number;
}

/**
 * True when `actionId`'s reservation is an ordinary reserve-ahead
 * (reserveOnePoolActionAhead, EmployeeDispatchSteps.ts) still sitting in
 * `holder`'s own `taskQueue`, not yet promoted — `holder.activeActionId`
 * naming a DIFFERENT action is exactly what that state looks like, since the
 * whole point of reserving ahead is claiming a follow-up while genuinely busy
 * on something else. Restricted to a holder genuinely working elsewhere (not
 * resting, not walking to rest) the same way WorldInvariants.ts's I5 check
 * already does (#1103) — this is that identical shape, needed a second time
 * by reconcileVehicleReservations below, which independently reinvented the
 * same "activeActionId doesn't name this reservation" test (#928) with no
 * exception for it: an employee busy on one action with a DIFFERENT one
 * reserved ahead onto their vehicle read exactly like #928's genuine staleness
 * case (a driver reassigned without going through interruptActiveAction), so
 * every reserve-ahead reservation got released the instant it was made, its
 * action bounced back to 'queued' via ArrivalGate's own interruptActiveAction
 * call — but interruptActiveAction has no reason to also drop it from
 * `taskQueue` (it is not the employee's active action), so the stale id
 * stayed there and the very next reserve-ahead re-claimed and re-pushed the
 * SAME action id a second time, producing a `[id, id]` duplicate that starves
 * `findStarvedActionForEmployee` forever behind it (confirmed live via
 * rock-fragmenter-breaking.json's interaction-mode run, #1089).
 */
export function isPendingReserveAhead(holder: Employee, actionId: number): boolean {
  return holder.activeActionId !== null
    && holder.restTicksRemaining === null
    && holder.pendingRestDuration === null
    && holder.taskQueue.includes(actionId);
}

/**
 * Per-tick reconciliation: releases any reservation whose PendingAction
 * no longer exists or whose holder is dead, and reports any employee whose
 * vehicle-gated active action's reserved vehicle no longer exists in
 * state.vehicles.vehicles (destroyed underneath them) — before they've
 * started the work timer — so the caller can interrupt it. Never touches an
 * employee already mid-work-timer. Returns an empty array when nothing needs
 * interrupting.
 */
export function reconcileVehicleReservations(state: GameState): VehicleGoneInterruption[] {
  // (a) / (b): every still-reserved vehicle whose PendingAction vanished or
  // whose reserving employee died — release the reservation outright.
  // (d, #928): the vehicle's own driver is alive and resolves fine, but has
  // since moved on to something else entirely (activeActionId no longer
  // names this reservation's own action) without going through the ordinary
  // interruptActiveAction -> releaseVehicleReservation chain — e.g. a rest-
  // completion handler that reassigns activeActionId directly rather than
  // interrupting the stale vehicle-gated claim first (#928's own original
  // repro: RestCompletion.ts/ShiftCycle.ts). #1089 deleted the dedicated
  // per-tick vehicle-drive loop that used to carry this exact staleness
  // check (ArrivalGate.ts's old holder.activeActionId !== action.id guard,
  // right before promoting a just-arrived vehicle's work timer) — this is
  // that same guard, restored here since nothing else sweeps every reserved,
  // driven vehicle unconditionally each tick any more.
  for (const vehicle of state.vehicles.vehicles) {
    if (vehicle.reservedForActionId === null) continue;
    const actionId = vehicle.reservedForActionId;
    const action = state.pendingActions.find(a => a.id === actionId);

    if (!action) {
      releaseVehicleReservation(state, actionId);
      continue;
    }

    const holder = resolveReservationHolder(state, vehicle, action);
    if (!holder) {
      // #1090: the one release reason that still needs an explicit dismount
      // — resolveReservationHolder returns undefined when the resolved
      // holder is dead (or, harmlessly, when nobody has boarded yet, in
      // which case dismountVehicleDriver is already a no-op). A dead
      // employee left mounted would otherwise violate I1/I2 forever, since
      // nothing else ever revisits a stale driverId pointing at a corpse.
      releaseVehicleReservation(state, actionId);
      dismountVehicleDriver(state, vehicle);
      continue;
    }

    if (
      vehicle.driverId === holder.id
      && holder.activeActionId !== actionId
      // #1089 fix: a reservation still sitting in the holder's own taskQueue
      // (reserveOnePoolActionAhead) is legitimately not the active action —
      // see isPendingReserveAhead's own doc comment for the duplicate-queue
      // bug this exception closes.
      && !isPendingReserveAhead(holder, actionId)
    ) {
      releaseVehicleReservation(state, actionId);
    }
  }

  // (c): a vehicle-gated action still claimed, still pre-work-timer, whose
  // reserved vehicle no longer exists at all — can't be caught by iterating
  // vehicles (there's nothing left to iterate), so walk actions instead.
  const interruptions: VehicleGoneInterruption[] = [];
  for (const action of state.pendingActions) {
    if (action.requiredVehicleRole === null) continue;
    if (action.holderId === null) continue;

    const holder = state.employees.employees.find(e => e.id === action.holderId);
    if (!holder || holder.taskTicksRemaining !== null) continue;

    const vehicleStillExists = state.vehicles.vehicles.some(v => v.reservedForActionId === action.id);
    if (vehicleStillExists) continue;

    interruptions.push({ employee: holder, actionId: action.id });
  }

  return interruptions;
}
