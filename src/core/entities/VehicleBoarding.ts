// BlastSimulator2026 — Vehicle boarding request
//
// Shares its licence/availability validation with `assignDriver` (Vehicle.ts)
// via `canAssignDriver`, but defers the actual driver assignment until the
// employee has physically arrived at the vehicle, via ArrivalGate.ts. This
// module only records the request/intent.

import type { GameState } from '../state/GameState.js';
import type { Employee } from './Employee.js';
import type { Vehicle } from './Vehicle.js';
import { canAssignDriver } from './Vehicle.js';

/**
 * Whether `employeeId` may start walking to board `vehicleId`: `canAssignDriver`'s
 * licence/availability checks, plus not already walking to board some other
 * vehicle. The single source of truth for boarding eligibility — `requestBoardVehicle`
 * enforces it before recording an employee's boarding intent, so every caller
 * of that function inherits the same rule instead of re-deriving it. Since
 * #921 removed the player-facing driver picker, that means
 * `VehicleReservation.ts`'s automatic claim-and-walk flow and the console
 * `vehicle board` command (`console/commands/vehicle.ts`) — there is no UI
 * caller left.
 */
export function canBoardVehicle(
  state: GameState,
  vehicleId: number,
  employeeId: number,
): { success: true; vehicle: Vehicle; employee: Employee } | { success: false; error: string } {
  const check = canAssignDriver(state.vehicles, state.employees, vehicleId, employeeId);
  if (!check.success) return check;

  if (check.employee.pendingDriverVehicleId !== null) {
    return { success: false, error: 'Employee already walking to board a vehicle' };
  }

  return check;
}

/**
 * Request that an employee board a vehicle as its driver. Validates via
 * `canBoardVehicle`, but does not assign the driver immediately — instead
 * marks the employee's pending boarding intent, which ArrivalGate.tickArrivalGate
 * resolves once the employee has arrived at the vehicle's position.
 */
export function requestBoardVehicle(
  state: GameState,
  vehicleId: number,
  employeeId: number,
): { success: boolean; error?: string } {
  const check = canBoardVehicle(state, vehicleId, employeeId);
  if (!check.success) return check;

  // Defer the actual assignDriver() call (which re-runs canAssignDriver) until
  // ArrivalGate confirms co-location — walking there is what #437 adds; the
  // checks above only gate *starting* the walk.
  check.employee.pendingDriverVehicleId = vehicleId;
  check.employee.destinationX = check.vehicle.x;
  check.employee.destinationZ = check.vehicle.z;

  return { success: true };
}
