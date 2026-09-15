// BlastSimulator2026 — World-state invariant checks (#1084)
//
// Pure inspection of a GameState for internal-consistency violations —
// dangling references, mismatched positions, conflicting assignments — that
// should never occur if the mount/itinerary/task machinery is correct.
// Returns a list rather than throwing so callers (tick pipeline, tests) can
// decide how to react.

import type { GameState } from './GameState.js';
import type { Employee } from '../entities/Employee.js';

export type ViolationKind =
  | 'I1_dangling_driver_reference'
  | 'I2_driver_position_mismatch'
  | 'I3_employee_drives_two_vehicles'
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

function checkI1DanglingDriverReference(state: GameState): Violation[] {
  const violations: Violation[] = [];
  for (const v of state.vehicles.vehicles) {
    if (v.driverId !== null && !findLivingDriver(state, v.driverId)) {
      violations.push({ kind: 'I1_dangling_driver_reference', vehicleId: v.id, employeeId: v.driverId });
    }
  }
  return violations;
}

function checkI2DriverPositionMismatch(state: GameState): Violation[] {
  const violations: Violation[] = [];
  for (const v of state.vehicles.vehicles) {
    if (v.driverId === null) continue;
    const e = findLivingDriver(state, v.driverId);
    if (!e) continue;
    if (e.x !== v.x || e.z !== v.z) {
      violations.push({ kind: 'I2_driver_position_mismatch', vehicleId: v.id, employeeId: e.id });
    }
  }
  return violations;
}

function checkI3EmployeeDrivesTwoVehicles(state: GameState): Violation[] {
  const violations: Violation[] = [];
  const seen = new Set<number>();
  for (const v of state.vehicles.vehicles) {
    if (v.driverId === null) continue;
    if (seen.has(v.driverId)) {
      violations.push({ kind: 'I3_employee_drives_two_vehicles', vehicleId: v.id, employeeId: v.driverId });
    } else {
      seen.add(v.driverId);
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
    const holder = findLivingDriver(state, holderId);
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
    const tracked = state.logistics.fragments.find(f => f.fragment.id === v.haulingFragmentId);
    if (!tracked || tracked.state !== 'in_transit') {
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
    ...checkI1DanglingDriverReference(state),
    ...checkI2DriverPositionMismatch(state),
    ...checkI3EmployeeDrivesTwoVehicles(state),
    ...checkI4MovingVehicleWithoutDriver(state),
    ...checkI5ReservationWithoutValidHolder(state),
    ...checkI6DestinationPartiallySet(state),
    ...checkI7InProgressVehicleActionDriverMismatch(state),
    ...checkI8PayloadNotInTransit(state),
    ...checkI9ExecutingTaskStillTravelling(state),
  ];
}
