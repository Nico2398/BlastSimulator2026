// BlastSimulator2026 — Vehicle reservation for vehicle-gated actions (#550)
// Owns the exclusive claim a PendingAction holds on a Vehicle: finding one to
// claim, reserving it, promoting the claim to an active walk-to-vehicle
// transition, and releasing it — whether that's on completion, cancellation,
// needs-interruption, or the vehicle being destroyed underneath it.
// EmployeeDispatchSteps.ts's claim/promotion sites call into this module rather than
// duplicating any of it. Core-pure: imports only from entities/, state/,
// EntityMovementTick.js (one-way, EntityMovementTick.ts never imports back),
// and — for the haul_debris/fragment_debris continuity case (#552) —
// economy/FragmentTaskLifecycle.js (startVehicleGatedFragmentWork, shared
// with ArrivalGate.ts's resolveBoarding), which does not import anything
// from engine/ that could cycle back here.
// Deliberately does NOT import TaskDispatch.ts directly — TaskDispatch.ts's
// own module re-exports from TaskCancellation.ts, which imports
// releaseVehicleReservation from here, so calling into TaskDispatch.ts
// directly would double back immediately. Where reconciliation needs to
// interrupt an active action (case (c) below), it reports the need to its
// caller instead of performing the interruption itself — see
// reconcileVehicleReservations's return type and ArrivalGate.ts, the sole
// caller, which already imports both modules safely.
// A cycle nonetheless exists through EntityMovementTick.js, which this module
// already imports one-way: EntityMovementTick.ts itself imports
// interruptActiveAction from TaskDispatch.ts (#938, for its sustained-stuck
// abandonment path), closing VehicleReservation -> EntityMovementTick ->
// TaskDispatch -> TaskCancellation -> VehicleReservation. Safe for the same
// reason the pre-existing EntityMovementTick.ts <-> VehicleOccupancyReroute.ts
// cycle is safe: every import here is a function declaration, called only
// from inside other function bodies, never evaluated at module-load time —
// ESM resolves the cycle fine as long as nothing at the top level reads a
// not-yet-initialized binding.

import type { GameState, PendingAction } from '../state/GameState.js';
import type { Employee } from '../entities/Employee.js';
import type { Vehicle, VehicleRole } from '../entities/Vehicle.js';
import { unassignDriver, moveVehicle } from '../entities/Vehicle.js';
import { ROLE_LICENCE_REQUIRED } from '../entities/VehicleDriverAssignment.js';
import { requestBoardVehicle } from '../entities/VehicleBoarding.js';
import { setVehicleIdle, syncDriverPosition } from './EntityMovementTick.js';
import { startVehicleGatedFragmentWork } from '../economy/FragmentTaskLifecycle.js';

/** True when `employee` holds the licence a vehicle of `role` requires (ROLE_LICENCE_REQUIRED, VehicleDriverAssignment.ts). */
export function isLicensedForRole(employee: Employee, role: VehicleRole): boolean {
  const requiredLicence = ROLE_LICENCE_REQUIRED[role];
  return employee.qualifications.some(q => q.category === requiredLicence);
}

/**
 * Cheapest-eligible free vehicle of `role` for `employee`: unreserved
 * (reservedForActionId === null), not `broken`, and either undriven
 * (driverId === null) or already driven by `employee` themself (the
 * continuity case — lets a claim naturally re-pick the vehicle the
 * employee is already sitting in for their next same-role task).
 * Ties broken by lowest vehicle id. Read-only — never mutates.
 * Returns null when none qualify.
 */
export function findFreeVehicleForRole(state: GameState, role: VehicleRole, employee: Employee): Vehicle | null {
  if (!isLicensedForRole(employee, role)) return null;

  const qualifying = state.vehicles.vehicles.filter(v =>
    v.type === role &&
    v.state !== 'broken' &&
    v.reservedForActionId === null &&
    (v.driverId === null || v.driverId === employee.id),
  );
  if (qualifying.length === 0) return null;

  const continuity = qualifying.find(v => v.driverId === employee.id);
  if (continuity) return continuity;

  return qualifying.reduce((lowest, v) => (v.id < lowest.id ? v : lowest));
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
 * own target, the employee walks to (or, already driving it — the
 * continuity tie-break in findFreeVehicleForRole above — skips straight
 * past) the vehicle reserved for this action at claim time. Called by
 * EmployeeDispatchSteps.ts's promoteActionToActive when action.requiredVehicleRole is set.
 *
 * Deliberately does not call seedTaskTimerFields here — that only happens
 * once the VEHICLE (not the employee) reaches action.targetX/targetZ, via
 * the vehicle-drive loop ArrivalGate.tickArrivalGate adds. Boarding and
 * driving reuse existing machinery end to end: VehicleBoarding.requestBoardVehicle
 * for the walk-and-board (resolved by ArrivalGate.resolveBoarding), and
 * Vehicle.moveVehicle for setting the vehicle's own destination once someone
 * is already aboard — EntityMovementTick.tickVehicle is the only thing that
 * ever actually advances a vehicle's x/z (see ArrivalGate.ts's header).
 */
export function promoteVehicleGatedAction(state: GameState, employee: Employee, action: PendingAction): void {
  const vehicle = state.vehicles.vehicles.find(v => v.reservedForActionId === action.id);
  // Reservation vanished between claim and promotion (shouldn't happen within
  // a single tick, but reconcileVehicleReservations is the backstop if it
  // ever does) — leave the employee idle-but-claimed; next tick's reconcile
  // sweep interrupts the action back to the pool.
  if (!vehicle) return;

  if (vehicle.driverId === employee.id) {
    // #552: haul_debris/fragment_debris are driven end to end by their own
    // request*/tick* phase machinery (HaulingTask.ts/BoulderBreaking.ts),
    // not a single generic moveVehicle target — the continuity case (already
    // driving this vehicle, no boarding needed) has to kick that request off
    // itself, mirroring what ArrivalGate.resolveBoarding does for a fresh
    // boarding (both call the same startVehicleGatedFragmentWork helper,
    // FragmentTaskLifecycle.ts). Any failure here (fragment/depot vanished
    // between claim and promotion — practically unreachable within one
    // synchronous tick, but never crashes) just leaves the vehicle idle;
    // reconcileVehicleReservations (ArrivalGate.ts) is the backstop that
    // interrupts a claim nothing is actually working.
    const started = startVehicleGatedFragmentWork(state, vehicle, action);
    if (started === false) {
      // Conditions changed between claim and promotion (fragment gone, no
      // active depot) — release the reservation so
      // reconcileVehicleReservations (ArrivalGate.ts) catches it next tick
      // and returns the action to the pool instead of leaving it claimed
      // with nothing actually driving it. Keeps the driver seated (#552,
      // see releaseVehicleReservationKeepDriver) — they are already
      // aboard this exact vehicle via the continuity tie-break, so
      // dismounting them here would only force a needless walk-back-and-
      // reboard the moment a depot appears.
      releaseVehicleReservationKeepDriver(state, action.id);
    }
    if (started !== null) return;
    moveVehicle(state.vehicles, vehicle.id, action.targetX, action.targetZ);
    return;
  }

  // Stage the destination now (the same targetX/targetZ tickVehicle reads),
  // but deliberately leave vehicle.task alone — starting it 'moving' before
  // anyone is aboard would drive an unmanned vehicle. ArrivalGate.resolveBoarding
  // flips it to 'moving' once the employee has actually boarded.
  vehicle.targetX = action.targetX;
  vehicle.targetZ = action.targetZ;
  requestBoardVehicle(state, vehicle.id, employee.id);
}

/**
 * Unconditional release: clears reservedForActionId, and if the vehicle
 * currently has a driver, unassigns them and resets task/state to idle.
 * Used by cancellation, needs-interruption, and the death/destruction
 * reconciliation sweep. No-op if no vehicle is reserved for `actionId`.
 */
export function releaseVehicleReservation(state: GameState, actionId: number): void {
  const vehicle = state.vehicles.vehicles.find(v => v.reservedForActionId === actionId);
  if (!vehicle) return;

  vehicle.reservedForActionId = null;
  if (vehicle.driverId !== null) {
    // #593/#922: EntityMovementTick.tickVehicle already calls
    // syncDriverPosition every tick, so the driver's x/z tracks the vehicle
    // continuously throughout the drive — this call is a defensive,
    // idempotent re-assertion at release time, not what establishes the
    // invariant. It covers any release path that could otherwise run off the
    // normal tick cycle: without it, a release landing between ticks would
    // risk reading the employee's position as stale (frozen at the boarding
    // point) instead of wherever the vehicle currently sits, which every
    // distance-based decision that follows (nearest living_quarters, the walk
    // back to reboard) relies on being current.
    syncDriverPosition(state, vehicle);
    unassignDriver(state.vehicles, vehicle.id);
    setVehicleIdle(vehicle);
  }
}

/**
 * Lighter release for the one case where dismounting is actively harmful:
 * a haul_debris/fragment_debris workflow (HaulingTask.ts/BoulderBreaking.ts's
 * request*) that could not start this tick — no active depot yet, fragment
 * picked clean between claim and promotion — right after the driver had
 * *just* boarded (or was already driving) this exact vehicle for it. Clears
 * only reservedForActionId, leaving the driver seated and the vehicle idle:
 * next tick's claim reads them as idle again and findFreeVehicleForRole's own
 * continuity tie-break (driverId === employee.id) hands the same vehicle
 * straight back, instead of forcing a dismount-then-walk-back-and-reboard
 * cycle every single tick nothing can start yet (#552). No-op if no vehicle
 * is reserved for `actionId`.
 */
export function releaseVehicleReservationKeepDriver(state: GameState, actionId: number): void {
  const vehicle = state.vehicles.vehicles.find(v => v.reservedForActionId === actionId);
  if (!vehicle) return;

  vehicle.reservedForActionId = null;
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

/** One active action reconcileVehicleReservations found needing interruption — its reserved vehicle vanished before the holder started their work timer. The caller (ArrivalGate.ts) performs the actual interruptActiveAction call, since that lives in TaskDispatch.ts and this module cannot import it without a cycle. */
export interface VehicleGoneInterruption {
  employee: Employee;
  actionId: number;
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
  for (const vehicle of state.vehicles.vehicles) {
    if (vehicle.reservedForActionId === null) continue;
    const actionId = vehicle.reservedForActionId;
    const action = state.pendingActions.find(a => a.id === actionId);

    if (!action) {
      releaseVehicleReservation(state, actionId);
      continue;
    }

    const holderId = action.holderId ?? vehicle.driverId;
    const holder = holderId !== null ? state.employees.employees.find(e => e.id === holderId) : undefined;
    if (!holder || !holder.alive) {
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
