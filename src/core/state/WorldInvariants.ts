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
import { VEHICLE_SEAT_COUNT } from '../config/balance.js';
import { resolveReservationHolder } from '../engine/VehicleReservation.js';
import { findInTransitFragment } from '../economy/Logistics.js';

export type ViolationKind =
  | 'I1_occupant_locomotion_mismatch'
  | 'I2_mounted_position_mismatch'
  | 'I3_employee_drives_two_vehicles'
  | 'I3_seat_capacity_exceeded'
  | 'I4_moving_vehicle_without_driver'
  | 'I5_reservation_without_valid_holder'
  | 'I6_destination_partially_set'
  | 'I7_in_progress_vehicle_action_driver_mismatch'
  | 'I8_payload_not_in_transit'
  | 'I9_executing_task_still_travelling';

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

function checkI4MovingVehicleWithoutDriver(state: GameState): Violation[] {
  const violations: Violation[] = [];
  for (const v of state.vehicles.vehicles) {
    const isMoving = v.state === 'moving' || v.haulingPhase !== null || v.breakPhase !== null;
    if (isMoving && v.driverId === null) {
      violations.push({ kind: 'I4_moving_vehicle_without_driver', vehicleId: v.id });
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
    const holderId = action.holderId ?? v.driverId;
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
    const valid = v.driverId === holderId || holder.pendingDriverVehicleId === v.id;
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

function checkI6DestinationPartiallySet(state: GameState): Violation[] {
  const violations: Violation[] = [];
  for (const e of state.employees.employees) {
    const xSet = e.destinationX !== null;
    const zSet = e.destinationZ !== null;
    if (xSet !== zSet) {
      violations.push({ kind: 'I6_destination_partially_set', employeeId: e.id });
    }
  }
  return violations;
}

function checkI7InProgressVehicleActionDriverMismatch(state: GameState): Violation[] {
  const violations: Violation[] = [];
  for (const action of state.pendingActions) {
    if (action.requiredVehicleRole === null || action.status !== 'in_progress' || action.holderId == null) continue;
    const v = state.vehicles.vehicles.find(veh => veh.reservedForActionId === action.id);
    if (!v) continue;
    if (v.driverId !== action.holderId) {
      violations.push({
        kind: 'I7_in_progress_vehicle_action_driver_mismatch',
        vehicleId: v.id,
        actionId: action.id,
        employeeId: action.holderId,
      });
    }
  }
  return violations;
}

function checkI8PayloadNotInTransit(state: GameState): Violation[] {
  const violations: Violation[] = [];
  for (const v of state.vehicles.vehicles) {
    if (v.payloadKg <= 0) continue;
    if (v.haulingFragmentId === null) {
      violations.push({ kind: 'I8_payload_not_in_transit', vehicleId: v.id });
      continue;
    }
    const tracked = findInTransitFragment(state.logistics, v.haulingFragmentId);
    if (!tracked) {
      violations.push({ kind: 'I8_payload_not_in_transit', vehicleId: v.id, fragmentId: v.haulingFragmentId });
    }
  }
  return violations;
}

function checkI9ExecutingTaskStillTravelling(state: GameState): Violation[] {
  const violations: Violation[] = [];
  for (const e of state.employees.employees) {
    if (e.taskTicksRemaining !== null && (e.destinationX !== null || e.destinationZ !== null)) {
      violations.push({ kind: 'I9_executing_task_still_travelling', employeeId: e.id });
    }
  }
  return violations;
}

export function assertWorldInvariants(state: GameState): Violation[] {
  return [
    ...checkI1OccupantLocomotionMismatch(state),
    ...checkI2MountedPositionMismatch(state),
    ...checkI3OccupantCapacityViolation(state),
    ...checkI4MovingVehicleWithoutDriver(state),
    ...checkI5ReservationWithoutValidHolder(state),
    ...checkI6DestinationPartiallySet(state),
    ...checkI7InProgressVehicleActionDriverMismatch(state),
    ...checkI8PayloadNotInTransit(state),
    ...checkI9ExecutingTaskStillTravelling(state),
  ];
}
