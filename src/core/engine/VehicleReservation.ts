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
import type { Vehicle, VehicleRole, VehicleState } from '../entities/Vehicle.js';
import { vehicleDriverId, getVehicleReservation, findVehicleReservedForAction, removeVehicleReservation } from '../entities/Vehicle.js';
import type { EventEmitter } from '../state/EventEmitter.js';
import { ROLE_LICENCE_REQUIRED } from '../entities/VehicleDriverAssignment.js';
import { moveTo } from './MoveTo.js';
import { returnFragmentToGround } from '../economy/Logistics.js';
import { alight } from './Mount.js';
import { isMounted, mountedVehicleId } from '../entities/EmployeeLocomotion.js';
// Direct import from TaskLifecycleCore.ts, not TaskDispatch.ts (see this
// module's own header comment on the cycle TaskDispatch.ts's re-export would
// close) — TaskCancellation.ts already imports completePendingAction the
// same way, for the same reason.
import { completePendingAction, clearActiveTaskFields } from './TaskLifecycleCore.js';
import { updateVehicleCellOccupancy } from './EntityMovementTick.js';
// Same function-only cycle already documented above for MoveTo.ts/
// PlanItinerary.ts: TaskCancellation.ts imports releaseVehicleReservation
// from here, and promoteVehicleGatedAction (below) needs
// releaseActionToOpenPool from there — both bindings are only ever read
// inside a function body, never at module-load time, so the cycle resolves
// fine (#1115).
import { releaseActionToOpenPool } from './TaskCancellation.js';

/**
 * True when a `queued` (unclaimed) PendingAction exists whose
 * requiredVehicleRole matches `role` and whose targeting doesn't rule out
 * `employeeId` — untargeted (targetEmployeeId === null, open to whoever's
 * cheapest) or targeted at `employeeId` themself. An action targeted at a
 * DIFFERENT employee specifically is never a follow-up this employee could
 * ever claim, no matter how long it sits `queued`.
 *
 * #1090 follow-up: shared by ForceShiftRest.ts's hasClaimableSameRoleFollowUp
 * (defers a forced rest while a same-role follow-up is about to be picked
 * up) and EmployeeDispatch.ts's own idle-and-mounted-with-nothing-queued
 * check (alights an employee whose vehicle nothing needs any more, so it
 * doesn't sit hostage forever to a *different* employee's own targeted
 * claim on the same role) — both ask the identical question, "is a matching
 * action this employee could actually claim still out there for this role",
 * from opposite ends of the same gap #1090's own dismount-on-completion
 * deletion opened.
 */
function hasQueuedActionForVehicleRole(state: GameState, role: VehicleRole, employeeId: number): boolean {
  return state.pendingActions.some(a =>
    a.status === 'queued'
    && a.requiredVehicleRole === role
    && (a.targetEmployeeId === null || a.targetEmployeeId === employeeId),
  );
}

/**
 * True when `employee`, currently mounted, holds a vehicle whose role still
 * has a `queued` follow-up only `employee` could ever claim
 * (hasQueuedActionForVehicleRole above). Shared by ForceShiftRest.ts's
 * forceShiftRestIfNeededByPolicy (defers a policy-forced rest while a
 * same-role follow-up is about to be picked up by the ordinary cost-ranked
 * pool dispatch — see its own call site's doc comment for the #1090 livelock
 * this closes) and RestActionHelpers.ts's beginRestTravel (keeps mount
 * continuity through the whole rest for this one case, instead of alighting
 * on arrival like every other rest — see that call site's own doc comment,
 * #1122).
 */
export function hasClaimableSameRoleFollowUp(state: GameState, employee: Employee): boolean {
  if (!isMounted(employee.locomotion)) return false;
  const vehicle = state.vehicles.vehicles.find(v => v.id === mountedVehicleId(employee.locomotion));
  if (!vehicle) return false;
  return hasQueuedActionForVehicleRole(state, vehicle.type, employee.id);
}

/**
 * True when a `queued` PendingAction requires `role` and is targeted at
 * someone other than `employeeId` (or is untargeted) — i.e. genuine demand
 * for this role that `employeeId` cannot itself be the one to satisfy (an
 * untargeted one they could claim would already have been claimed by
 * `fillIdleEmployeeFromQueueOrPool`, since this is only ever asked of an
 * employee dispatch has *already* had first refusal for this same tick).
 *
 * EmployeeDispatch.ts's own idle-and-mounted eviction check uses this
 * rather than `hasQueuedActionForVehicleRole` above, whose employeeId-scoped
 * definition returns `false` both when a *different* employee's targeted
 * claim is starved for a vehicle (the real hostage bug #1090 introduced this
 * check to fix) AND when literally nothing anywhere needs this role at all
 * (a vehicle boarded by a bare `vehicle driver` console command, or any
 * other manual/test drive with no PendingAction behind it) — the two are
 * opposite outcomes, but `hasQueuedActionForVehicleRole` cannot tell them
 * apart, so using it to gate eviction evicted every manually-driven idle
 * vehicle within one dispatch tick of boarding (confirmed live: every
 * scenario driving a vehicle via `vehicle driver`/`vehicle move` with no
 * accompanying pending action — nav-move-costs-visual, vehicle-traffic,
 * vehicle-task-states-visual and others — lost its driver mid-scenario).
 *
 * An untargeted haul_debris action is excluded when no active
 * freight_warehouse exists anywhere (#1091): the doc comment above assumes
 * "an untargeted one they could claim would already have been claimed",
 * which only holds when claimability depends solely on THIS employee's own
 * reachability — planFragmentTaskItinerary's own depot leg (PlanItinerary.ts)
 * makes a fresh haul's plannability depend on a GLOBAL precondition instead
 * (an active depot to eventually deliver to), identical for every employee.
 * Without this exclusion, an idle debris_hauler driver boarded before any
 * warehouse exists gets evicted the very next tick — nothing was actually
 * "freed" for anyone, since nobody else could complete it either — stranding
 * the vehicle driverless until something re-dispatches a new driver to it
 * (confirmed live: a fleet purchased and crewed ahead of its first
 * freight_warehouse never hauled anything, tutorial/economy integration
 * suites' own haul-and-store cases). A foreign-TARGETED haul_debris action
 * still counts regardless — the original #1090 hostage case this guard
 * exists for — since only that one specific employee could ever claim it
 * once a depot does exist, so freeing the vehicle for them is never wasted.
 */
export function hasBlockedQueuedActionForVehicleRole(state: GameState, role: VehicleRole, employeeId: number): boolean {
  return state.pendingActions.some(a =>
    a.status === 'queued'
    && a.requiredVehicleRole === role
    && a.targetEmployeeId !== employeeId
    && (a.type !== 'haul_debris' || a.targetEmployeeId !== null || hasActiveFreightWarehouse(state)),
  );
}

/** Whether any active freight_warehouse exists anywhere on the map — the global precondition a fresh haul_debris action's own depot leg needs (findHaulDepotApproach, HaulingTask.ts). */
function hasActiveFreightWarehouse(state: GameState): boolean {
  return state.buildings.buildings.some(b => b.type === 'freight_warehouse' && b.active);
}

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
    v => getVehicleReservation(state.vehicles, v.id) === action.id && vehicleDriverId(v) === employee.id,
  );
}

/**
 * Cheapest-eligible free vehicle of `role` for `employee`: unreserved
 * (reservedForActionId === null), not `broken`, and either undriven
 * (driverId === null) or already driven by `employee` themself (the
 * continuity case — lets a claim naturally re-pick the vehicle the employee
 * is already sitting in for their next same-role task). A vehicle already
 * mid vehicle-gated fragment work carries a non-null reservedForActionId for
 * its whole itinerary (#1091 — itinerary-driven hauling/breaking has no
 * separate phase field left to check), so the reservedForActionId filter
 * alone already excludes it; no separate haulingPhase/breakPhase check is
 * needed any more.
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
    v.hp > 0 &&
    getVehicleReservation(state.vehicles, v.id) === null &&
    (vehicleDriverId(v) === null || vehicleDriverId(v) === employee.id),
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

/**
 * Marks `vehicleId` reserved for `actionId` in `vehicleState.reservations`
 * (#1138 — replaces the old `vehicle.reservedForActionId = actionId` direct
 * write). Caller must have already confirmed the vehicle came from
 * findFreeVehicleForRole this same tick. Replaces any existing entry for
 * `vehicleId` rather than appending a second one.
 */
export function reserveVehicle(vehicleState: VehicleState, vehicleId: number, actionId: number): void {
  clearVehicleReservation(vehicleState, vehicleId);
  vehicleState.reservations.push({ vehicleId, actionId });
}

/** Removes any reservation entry for `vehicleId` from `vehicleState.reservations`. No-op if none exists. Delegates to `removeVehicleReservation` (Vehicle.ts) — the one code path that splices `reservations`, also used by `destroyVehicle` (#1138). */
function clearVehicleReservation(vehicleState: VehicleState, vehicleId: number): void {
  removeVehicleReservation(vehicleState, vehicleId);
}

/**
 * True when `action` is a haul_debris action whose reserved vehicle already
 * carries the exact fragment it targets (#1091) — the paused-with-cargo
 * resume case: an earlier haul_load leg already ran, a policy-driven
 * interruption/pause left the reservation and the cargo both intact (see
 * releaseActionToOpenPool's own use of this, TaskCancellation.ts), and this
 * action is waiting to be reclaimed so its own remaining haul_unload leg can
 * finish the delivery. Always false for fragment_debris — breaking never
 * loads anything onto `vehicle.payload`, it splits the boulder in place.
 */
export function isCommittedToOwnCargo(state: GameState, action: PendingAction): boolean {
  if (action.type !== 'haul_debris') return false;
  const fragmentId = action.payload['fragmentId'];
  if (typeof fragmentId !== 'number') return false;
  const vehicle = findVehicleReservedForAction(state.vehicles, action.id);
  return !!vehicle && vehicle.payload !== null && vehicle.payload.fragmentId === fragmentId;
}

/**
 * Vehicle-gate check shared by both of EmployeeDispatchSteps.ts's claim sites (#550): for
 * a non-vehicle action this is always a pass-through no-op; for a
 * vehicle-gated one it first checks whether a vehicle is already reserved for
 * this exact action (#1091 — the paused-with-cargo resume case: a policy-driven
 * interruption left the reservation, and possibly loaded cargo, intact on its
 * own vehicle instead of releasing it, see isCommittedToOwnCargo's own doc
 * comment) and returns that one directly; only when nothing is already
 * reserved does it fall back to finding (but not yet reserving) a qualifying
 * free vehicle via findFreeVehicleForRole above. `ok: false` means this
 * employee cannot claim this action right now — same "stays queued, retries
 * next tick" outcome as selectBestActionForEmployee returning null for an
 * unreachable target, not an error.
 */
export function findVehicleForClaim(
  state: GameState,
  action: PendingAction,
  employee: Employee,
): { ok: true; vehicle: Vehicle | null } | { ok: false } {
  if (action.requiredVehicleRole === null) return { ok: true, vehicle: null };

  const alreadyReserved = findVehicleReservedForAction(state.vehicles, action.id);
  if (alreadyReserved) return { ok: true, vehicle: alreadyReserved };

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
 * timed clearing has had a chance to land (#924).
 *
 * haul_debris/fragment_debris (#1091) plan a 'work' goal instead of the plain
 * 'reposition' every other vehicle-gated action gets — that routes them to
 * PlanItinerary.ts's planFragmentTaskItinerary instead of the generic
 * single-drive-leg shape, which plans their extra fragment/depot legs and the
 * load/unload/split effect at the end of each. No separate continuity
 * handoff is needed for them any more: an already-mounted driver's own
 * continuity (no boarding walk) and a resumed, already-loaded haul (only the
 * depot leg left) are both resolved by planFragmentTaskItinerary itself (its
 * own alreadyMounted / payload-match checks), not by anything special-cased
 * here.
 */
export function promoteVehicleGatedAction(state: GameState, employee: Employee, action: PendingAction): void {
  const vehicle = findVehicleReservedForAction(state.vehicles, action.id);
  // Reservation vanished between claim and promotion (shouldn't happen within
  // a single tick, but reconcileVehicleReservations is the backstop if it
  // ever does) — leave the employee idle-but-claimed; next tick's reconcile
  // sweep interrupts the action back to the pool.
  if (!vehicle) return;

  const isFragmentGated = action.type === 'haul_debris' || action.type === 'fragment_debris';

  // #1089: a fresh boarding and the continuity case (already driving this
  // vehicle) both collapse into one moveTo call — planItinerary/
  // planFragmentTaskItinerary drop the leading foot leg when the employee is
  // already mounted in `vehicle`, so continuity needs no boarding walk either
  // way.
  const moveResult = isFragmentGated
    ? moveTo(state, employee.id, { actionId: action.id }, { via: vehicle.id })
    : moveTo(state, employee.id, { x: action.targetX, z: action.targetZ }, { via: vehicle.id });

  // #1115 fix: a route to the vehicle (or, continuity aside, on to the
  // target) that planItinerary/buildBoardLeg cannot resolve RIGHT NOW — the
  // same "stays queued, retries next tick" case findVehicleForClaim's own
  // `ok: false` already covers at claim time (its own doc comment above) —
  // must not leave `employee` claimed-but-frozen here: activeActionId already
  // points at `action` (set by the caller, promoteActionToActive, before this
  // function ever runs), but with no itinerary AND no destinationX/Z fallback
  // (unlike promoteActionToActive's own on-foot branch, whose #1090-follow-up
  // doc comment covers exactly this failure mode for the on-foot case), the
  // employee never moves again and the reservation this claim just took stays
  // reserved for a driver who will never reach it — WorldInvariants.ts's I5
  // check flags exactly this stale state (confirmed live via
  // vehicles.integration.test.ts's own "destroying the reserved vehicle
  // mid-drive" case, once I4/I5 became fatal: a re-claim's own moveTo failed
  // this same way and the reservation never resolved for the rest of the
  // run). Undoing the claim — activeActionId back to null, action back to
  // 'queued' via the same releaseActionToOpenPool every other release site
  // uses — lets the ordinary dispatch loop retry it (this employee or another)
  // once the route resolves, exactly like an unreachable claim never taken in
  // the first place.
  if (!moveResult.success) {
    employee.activeActionId = null;
    releaseActionToOpenPool(state, action);
  }
}

/**
 * Returns `vehicle`'s cargo to the ground and clears `payload` (#1091 —
 * replaces the old abortVehicleGatedFragmentWork's haul branch; breaking
 * never sets `payload` at all, so there is no equivalent break branch any
 * more). No-op when nothing is loaded. Shared by findAndAbortReservedVehicle
 * and dismountVehicleDriver below — both need an unconditional (never
 * "keep the cargo aboard") abort, unlike releaseActionToOpenPool's own softer
 * isCommittedToOwnCargo-gated release (TaskCancellation.ts, VehicleReservation.ts).
 */
function returnVehicleCargoToGround(state: GameState, vehicle: Vehicle): void {
  if (vehicle.payload === null) return;
  returnFragmentToGround(state.logistics, vehicle.payload.fragmentId, state.navGrid, { x: vehicle.x, y: 0, z: vehicle.z });
  vehicle.payload = null;
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
 * mounting (occupantIds/locomotion) is untouched here — only the derived
 * display fields reset.
 */
function findAndAbortReservedVehicle(state: GameState, actionId: number): Vehicle | null {
  const vehicle = findVehicleReservedForAction(state.vehicles, actionId);
  if (!vehicle) return null;

  returnVehicleCargoToGround(state, vehicle);
  clearVehicleReservation(state.vehicles, vehicle.id);
  // task/state/waitingTicks used to be reset to idle here (#1090) — now
  // derived display-only via computeVehicleStatus (VehicleStatus.ts), so
  // there is nothing left on Vehicle itself to reset.
  return vehicle;
}

/**
 * Full dismount of `vehicle`'s driver, if any: returns any loaded cargo to
 * the ground first, so that canReleaseDriver's own fail-closed guard
 * (Vehicle.ts — it refuses the dismount while `payload` is set) is
 * guaranteed to succeed rather than silently no-op. A caller that skipped
 * that and ignored canReleaseDriver's return value could flip task/state to
 * idle while the driver seat and payload stayed set, reproducing the exact
 * stuck-forever bug this dismount exists to fix (#986 review follow-up).
 *
 * No-op (past the cargo return) if the vehicle currently has no driver.
 *
 * Shared by releaseVehicleReservation, whose `findAndAbortReservedVehicle`
 * already returns cargo as part of clearing the reservation (a second,
 * idempotent no-op here in that case), and by Locomotion.ts's own
 * sustained-stuck release (advanceLeg's abandon branch) for a vehicle driven
 * with no PendingAction at all (a manual `vehicle driver`/`vehicle haul`
 * console command) — interruptActiveAction(..., actionId: null, ...) is a
 * no-op in that case (nothing to release via an action), so that caller
 * holds the vehicle directly and calls this instead of going through
 * releaseVehicleReservation.
 *
 * Marks the vehicle's own (possibly non-grid-aligned, mid-drive) resting
 * cell as `vehicleOccupied` via updateVehicleCellOccupancy — every OTHER
 * stop (a drive leg's own arrival, EntityMovementTick.ts) already does this
 * as part of writeVehiclePosition's transition out of 'moving', but a
 * mid-drive dismount stops the vehicle without ever going through that
 * arrival path, so without this call its cell never gets flagged: the
 * NavGrid keeps reporting the tile "unoccupied" forever. `isDestinationOccupied`
 * (EntityMovementTick.ts) reads exactly that flag to decide whether a foot
 * leg walking up to BOARD this vehicle may cross other occupied
 * (vehicle/fragment) tiles — a dismounted vehicle's own tile reading
 * "unoccupied" flips that decision to avoidVehicles: true for the boarding
 * walk, which then refuses to route through any real fragment debris on the
 * way there. Post-blast debris is often unavoidable in a straight line, so
 * that false "avoid everything" reading strands a would-be driver outside
 * MOVE_STUCK_ABANDON_TICKS on every single retry, with the vehicle exactly
 * as unreachable each time — reproduced live via vibration-budget.json's
 * grid 2 drilling, whose drill_rig was abandoned mid-drive (a proactive
 * shift rest interrupting the drive leg) and never boarded again (#1110
 * follow-up).
 */
export function dismountVehicleDriver(state: GameState, vehicle: Vehicle, emitter?: EventEmitter): void {
  returnVehicleCargoToGround(state, vehicle);
  if (vehicleDriverId(vehicle) === null) return;

  // #1089: Locomotion.ts is now the only writer of a vehicle's x/z, and it
  // writes the mounted employee's own x/z in the same step (I2) — the two
  // can never drift apart mid-tick the way the pre-itinerary tickVehicle
  // model's own separate syncDriverPosition call (dropped here) had to
  // defend against.
  alight(state, vehicle.id, emitter);
  const cellX = Math.round(vehicle.x);
  const cellZ = Math.round(vehicle.z);
  // task/state/waitingTicks reset dropped (#1138) — derived display-only now.
  updateVehicleCellOccupancy(state, vehicle, false, true, cellX, cellZ);
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
 * claimed this same vehicle — leaves the driver seat and reservation untouched so
 * the employee stays mounted.
 */
export function releaseVehicleOnCompletion(state: GameState, employee: Employee, completedActionId: number): void {
  const vehicle = findVehicleReservedForAction(state.vehicles, completedActionId);
  if (!vehicle) return;
  // Defensive: only the driver whose action just completed may trigger the
  // release — a mismatch here means the reservation/driver bookkeeping has
  // already drifted, and reconcileVehicleReservations is the one to fix it.
  const driverId = vehicleDriverId(vehicle);
  if (driverId !== null && driverId !== employee.id) return;

  releaseVehicleReservation(state, completedActionId);
}

/**
 * Resolves the living employee currently holding `action`'s reservation on
 * `vehicle`: the action's own holderId when set, falling back to the
 * vehicle's own driver seat (the state before an action's holderId is assigned, at
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
  const holderId = action.holderId ?? vehicleDriverId(vehicle);
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
 * naming a DIFFERENT action (including null, #1115) is exactly what that
 * state looks like, since the whole point of reserving ahead is claiming a
 * follow-up before it is needed, whether that's while genuinely busy on
 * something else OR in the one-tick gap between finishing the prior active
 * action and dispatch's next pass promoting this one (tickEmployees runs
 * once per tick — a completion at tickTaskProgress, later the same tick, can
 * leave `holder` idle with this reservation still queued for the rest of
 * that tick, WorldInvariants.ts's own end-of-tick I5 check included).
 * Restricted to a holder genuinely not mid-rest (not resting, not walking to
 * rest) the same way WorldInvariants.ts's I5 check already does (#1103) —
 * this is that identical shape, needed a second time by
 * reconcileVehicleReservations below, which independently reinvented the
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
 *
 * The original version of this check additionally required
 * `holder.activeActionId !== null` — narrower than the actual "not yet
 * promoted" shape it means to recognize: an idle holder (activeActionId
 * null) with this reservation still in taskQueue is just as legitimately
 * "reserved ahead, not yet promoted" as a busy one, and reads identically
 * once promotion catches up on dispatch's very next pass. Confirmed live via
 * tutorial.integration.test.ts's/tutorial-pause.integration.test.ts's own
 * automatic-haul-debris cases, once I4/I5 became fatal (#1115): a driller's
 * drill_hole follow-up sat correctly reserved-ahead in taskQueue for the one
 * tick their prior action finished (activeActionId already null, dispatch not
 * yet run again) and I5 flagged it, even though nothing about it was ever
 * stale.
 */
export function isPendingReserveAhead(holder: Employee, actionId: number): boolean {
  return holder.restTicksRemaining === null
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
    const actionId = getVehicleReservation(state.vehicles, vehicle.id);
    if (actionId === null) continue;
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
      // nothing else ever revisits a stale occupant id pointing at a corpse.
      releaseVehicleReservation(state, actionId);
      dismountVehicleDriver(state, vehicle);
      continue;
    }

    if (
      vehicleDriverId(vehicle) === holder.id
      && holder.activeActionId !== actionId
      // #1089 fix: a reservation still sitting in the holder's own taskQueue
      // (reserveOnePoolActionAhead) is legitimately not the active action —
      // see isPendingReserveAhead's own doc comment for the duplicate-queue
      // bug this exception closes.
      && !isPendingReserveAhead(holder, actionId)
      // #1091 fix: a policy-driven interruption (a hard collapse, today —
      // NeedRestoration.ts's tickCollapse) that pinned this exact reservation
      // via isCommittedToOwnCargo's own carve-out (releaseActionToOpenPool,
      // TaskCancellation.ts) moves the holder's activeActionId on to their
      // OWN new rest action the very same tick, which reads identically to
      // #928's genuine staleness case — the driver "moved on to something
      // else" — even though this is exactly the deliberate "keep the
      // reservation and the loaded cargo together" case the carve-out exists
      // for. Without this exemption, this sweep undid that carve-out within
      // the same tick it was applied: the still-mounted driver's own
      // resting activeActionId immediately reads as staleness, releasing the
      // reservation and returning the cargo to the ground anyway — dropping
      // cargo evacuation/collapse explicitly promises to preserve (confirmed
      // live: collapse-vehicle-recovery.integration.test.ts's own mid-
      // haul_unload case, #1091).
      && !isCommittedToOwnCargo(state, action)
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

    const vehicleStillExists = findVehicleReservedForAction(state.vehicles, action.id) !== null;
    if (vehicleStillExists) continue;

    interruptions.push({ employee: holder, actionId: action.id });
  }

  return interruptions;
}
