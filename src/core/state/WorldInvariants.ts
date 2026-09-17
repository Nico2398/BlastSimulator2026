// BlastSimulator2026 — World-state invariant checks (#1084)
//
// Pure inspection of a GameState for internal-consistency violations —
// dangling references, mismatched positions, conflicting assignments — that
// should never occur if the mount/itinerary/task machinery is correct.
// Returns a list rather than throwing so callers (tick pipeline, tests) can
// decide how to react.

import type { GameState } from './GameState.js';
import type { Employee } from '../entities/Employee.js';
import { isMounted, mountedVehicleId } from '../entities/EmployeeLocomotion.js';
import { vehicleDriverId } from '../entities/Vehicle.js';
import { VEHICLE_SEAT_COUNT } from '../config/balance.js';
import { resolveReservationHolder, isPendingReserveAhead } from '../engine/VehicleReservation.js';
import { findInTransitFragment } from '../economy/Logistics.js';

export type ViolationKind =
  | 'I1_occupant_locomotion_mismatch'
  | 'I2_mounted_position_mismatch'
  | 'I3_employee_drives_two_vehicles'
  | 'I3_seat_capacity_exceeded'
  | 'I5_reservation_without_valid_holder'
  | 'I8_payload_not_in_transit'
  | 'I9_executing_task_still_travelling'
  // #1089 (mount/itinerary phase 3b): the itinerary/tickLocomotion model's
  // own I4/I6/I7 semantics, replacing the pre-itinerary checks of the same
  // number.
  | 'I4_vehicle_moved_without_occupant'
  | 'I6_empty_itinerary'
  | 'I7_drive_leg_without_mount';

export interface Violation {
  kind: ViolationKind;
  employeeId?: number;
  vehicleId?: number;
  actionId?: number;
  fragmentId?: number;
}

function findLivingDriver(state: GameState, driverId: number): Employee | undefined {
  const employee = state.employees.employees.find(e => e.id === driverId);
  return employee && employee.alive ? employee : undefined;
}

/**
 * I1: `Vehicle.occupantIds` and `Employee.locomotion` must agree in both
 * directions — every occupant must be mounted on that exact vehicle, and
 * every mounted employee must appear in their vehicle's `occupantIds`.
 */
function checkI1OccupantLocomotionMismatch(state: GameState): Violation[] {
  const violations: Violation[] = [];

  for (const v of state.vehicles.vehicles) {
    for (const employeeId of v.occupantIds) {
      const e = findLivingDriver(state, employeeId);
      if (!e || !isMounted(e.locomotion) || mountedVehicleId(e.locomotion) !== v.id) {
        violations.push({ kind: 'I1_occupant_locomotion_mismatch', vehicleId: v.id, employeeId });
      }
    }
  }

  for (const e of state.employees.employees) {
    if (!e.alive || !isMounted(e.locomotion)) continue;
    const vehicleId = mountedVehicleId(e.locomotion)!;
    const v = state.vehicles.vehicles.find(veh => veh.id === vehicleId);
    if (!v || !v.occupantIds.includes(e.id)) {
      violations.push({ kind: 'I1_occupant_locomotion_mismatch', vehicleId, employeeId: e.id });
    }
  }

  return violations;
}

/** I2: a mounted employee's position must equal their vehicle's position. */
function checkI2MountedPositionMismatch(state: GameState): Violation[] {
  const violations: Violation[] = [];
  for (const e of state.employees.employees) {
    if (!e.alive || !isMounted(e.locomotion)) continue;
    const vehicleId = mountedVehicleId(e.locomotion)!;
    const v = state.vehicles.vehicles.find(veh => veh.id === vehicleId);
    if (!v) continue; // already reported by I1
    if (e.x !== v.x || e.z !== v.z) {
      violations.push({ kind: 'I2_mounted_position_mismatch', vehicleId: v.id, employeeId: e.id });
    }
  }
  return violations;
}

/**
 * I3: a vehicle's `occupantIds` may not exceed `VEHICLE_SEAT_COUNT[type]`,
 * and no employee id may appear in more than one vehicle's `occupantIds`.
 */
function checkI3OccupantCapacityViolation(state: GameState): Violation[] {
  const violations: Violation[] = [];
  const seen = new Set<number>();
  for (const v of state.vehicles.vehicles) {
    if (v.occupantIds.length > VEHICLE_SEAT_COUNT[v.type]) {
      violations.push({ kind: 'I3_seat_capacity_exceeded', vehicleId: v.id });
    }
    for (const employeeId of v.occupantIds) {
      if (seen.has(employeeId)) {
        violations.push({ kind: 'I3_employee_drives_two_vehicles', vehicleId: v.id, employeeId });
      } else {
        seen.add(employeeId);
      }
    }
  }
  return violations;
}

/**
 * I4: a vehicle whose x/z changed this tick must have had an occupant — a
 * vehicle only ever moves as a side effect of its occupant driver's own
 * locomotion (#1089). `vehiclePositionsAtTickStart`, when supplied, is the
 * snapshot TickPipeline.ts captures before locomotion runs this tick; when
 * omitted (a caller with no such snapshot to hand, e.g. a unit test), this
 * check is vacuously satisfied rather than requiring every caller to supply
 * one.
 */
function checkI4VehicleMovedWithoutOccupant(
  state: GameState,
  vehiclePositionsAtTickStart?: ReadonlyMap<number, { x: number; z: number }>,
): Violation[] {
  if (!vehiclePositionsAtTickStart) return [];

  const violations: Violation[] = [];
  for (const v of state.vehicles.vehicles) {
    const before = vehiclePositionsAtTickStart.get(v.id);
    if (!before) continue; // created this tick — no baseline to compare against
    const moved = before.x !== v.x || before.z !== v.z;
    if (moved && v.occupantIds.length === 0) {
      violations.push({ kind: 'I4_vehicle_moved_without_occupant', vehicleId: v.id });
    }
  }
  return violations;
}

function checkI5ReservationWithoutValidHolder(state: GameState): Violation[] {
  const violations: Violation[] = [];
  for (const v of state.vehicles.vehicles) {
    if (v.reservedForActionId === null) continue;
    const action = state.pendingActions.find(a => a.id === v.reservedForActionId);
    if (!action) {
      violations.push({ kind: 'I5_reservation_without_valid_holder', vehicleId: v.id, actionId: v.reservedForActionId });
      continue;
    }
    const holderId = action.holderId ?? vehicleDriverId(v);
    if (holderId == null) {
      violations.push({
        kind: 'I5_reservation_without_valid_holder',
        vehicleId: v.id,
        actionId: v.reservedForActionId,
      });
      continue;
    }
    const holder = resolveReservationHolder(state, v, action);
    if (!holder) {
      violations.push({
        kind: 'I5_reservation_without_valid_holder',
        vehicleId: v.id,
        actionId: v.reservedForActionId,
        employeeId: holderId,
      });
      continue;
    }
    // #1103: a vehicle reserved for an action still sitting in its holder's
    // OWN taskQueue (reserveOnePoolActionAhead, EmployeeDispatchSteps.ts) is
    // legitimately not yet boarded — but only while the holder is genuinely
    // busy WORKING a different active action (activeActionId set, not
    // resting or walking to rest) and will walk to claim this one once that
    // finishes (VehicleContinuity.ts's tryContinueVehicleGatedAction is the
    // common case: continuity transfers the ABOUT-TO-FREE vehicle straight
    // onto it instead). Neither vehicleDriverId(v) nor pendingDriverVehicleId
    // reflects that yet, so without this the check flagged this ordinary,
    // transient "reserved ahead, not yet started" state as a violation on
    // every multi-action taskQueue — confirmed live on
    // level2-playthrough-win.json (pre-existing on main too, unrelated to
    // #1089/#1103's own mover work). Deliberately excludes a RESTING holder
    // (restTicksRemaining/pendingRestDuration set): both #1096 (tickCollapse,
    // fixed #1107) and #1110 (shift-rest interruption, fixed) now release a
    // holder's taskQueue-held reservation before it starts resting, so a
    // resting holder should never legitimately reach isPendingReserveAhead
    // with an unreleased reservation. The exclusion stays as a regression
    // guard: if I5 ever flags one, this exact gap reopened — pin coverage in
    // vehicles.integration.test.ts's #922 interrupt/resume case.
    const valid = vehicleDriverId(v) === holderId
      || holder.pendingDriverVehicleId === v.id
      // isPendingReserveAhead (VehicleReservation.ts) is this exact "busy
      // elsewhere, reserved ahead in taskQueue" shape — shared with
      // reconcileVehicleReservations's own identical staleness test (#1089).
      || isPendingReserveAhead(holder, action.id);
    if (!valid) {
      violations.push({
        kind: 'I5_reservation_without_valid_holder',
        vehicleId: v.id,
        actionId: v.reservedForActionId,
        employeeId: holderId,
      });
    }
  }
  return violations;
}

/** I6: an itinerary must never sit empty instead of being cleared to null. */
function checkI6EmptyItinerary(state: GameState): Violation[] {
  const violations: Violation[] = [];
  for (const e of state.employees.employees) {
    if (e.itinerary !== null && e.itinerary.legs.length === 0) {
      violations.push({ kind: 'I6_empty_itinerary', employeeId: e.id });
    }
  }
  return violations;
}

/** I7: a drive leg's employee must actually be mounted in that leg's vehicle. */
function checkI7DriveLegWithoutMount(state: GameState): Violation[] {
  const violations: Violation[] = [];
  for (const e of state.employees.employees) {
    if (!e.alive || e.itinerary === null || e.itinerary.legs.length === 0) continue;
    const leg = e.itinerary.legs[0]!;
    if (leg.mode !== 'drive') continue;
    if (!isMounted(e.locomotion) || mountedVehicleId(e.locomotion) !== leg.vehicleId) {
      const violation: Violation = { kind: 'I7_drive_leg_without_mount', employeeId: e.id };
      if (leg.vehicleId !== null) violation.vehicleId = leg.vehicleId;
      violations.push(violation);
    }
  }
  return violations;
}

/**
 * I8: a vehicle carrying `payload` must have its named fragment tracked
 * `in_transit` in logistics — the two are meant to move together (#1091,
 * `vehicle.payload` replaces the old payloadKg/haulingFragmentId pair). A
 * mismatch here means the fragment and cargo bookkeeping have desynced.
 */
function checkI8PayloadNotInTransit(state: GameState): Violation[] {
  const violations: Violation[] = [];
  for (const v of state.vehicles.vehicles) {
    if (v.payload === null) continue;
    const tracked = findInTransitFragment(state.logistics, v.payload.fragmentId);
    if (!tracked) {
      violations.push({ kind: 'I8_payload_not_in_transit', vehicleId: v.id, fragmentId: v.payload.fragmentId });
    }
  }
  return violations;
}

/**
 * Violation kinds severe enough to abort the tick outright rather than
 * merely being collected and reported (#1091). Today, only I8: a desynced
 * payload/logistics pairing corrupts every later tick that computes against
 * it, so TickPipeline.ts's dev/test-only invariant check throws the instant
 * it finds one instead of letting the game keep running on bad state. Every
 * other violation kind keeps the existing collect-and-continue behavior.
 */
export const FATAL_VIOLATION_KINDS: ReadonlySet<ViolationKind> = new Set<ViolationKind>([
  'I8_payload_not_in_transit',
]);

/**
 * I9: an executing task's employee should not still be travelling —
 * neither via the legacy destinationX/Z walk fields nor (#1090) via an
 * unconsumed itinerary. A task shouldn't be running (taskTicksRemaining set)
 * while the employee still has movement left to do by either mechanism.
 */
function checkI9ExecutingTaskStillTravelling(state: GameState): Violation[] {
  const violations: Violation[] = [];
  for (const e of state.employees.employees) {
    if (e.taskTicksRemaining !== null
      && (e.destinationX !== null || e.destinationZ !== null || e.itinerary !== null)) {
      violations.push({ kind: 'I9_executing_task_still_travelling', employeeId: e.id });
    }
  }
  return violations;
}

export function assertWorldInvariants(
  state: GameState,
  // #1089: vehicle x/z captured before this tick's locomotion step, so I4
  // can tell "moved" from "stationary" without re-deriving it from
  // vehicle.state. TickPipeline.ts's own runTick captures and passes this;
  // a caller with no snapshot to hand gets I4 vacuously satisfied.
  vehiclePositionsAtTickStart?: ReadonlyMap<number, { x: number; z: number }>,
): Violation[] {
  return [
    ...checkI1OccupantLocomotionMismatch(state),
    ...checkI2MountedPositionMismatch(state),
    ...checkI3OccupantCapacityViolation(state),
    ...checkI4VehicleMovedWithoutOccupant(state, vehiclePositionsAtTickStart),
    ...checkI5ReservationWithoutValidHolder(state),
    ...checkI6EmptyItinerary(state),
    ...checkI7DriveLegWithoutMount(state),
    ...checkI8PayloadNotInTransit(state),
    ...checkI9ExecutingTaskStillTravelling(state),
  ];
}
