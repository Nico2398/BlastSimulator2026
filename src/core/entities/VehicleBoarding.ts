// BlastSimulator2026 — Vehicle boarding request
//
// Mirrors `assignDriver` (Vehicle.ts) but defers the actual driver
// assignment until the employee has physically arrived at the vehicle,
// via ArrivalGate.ts. This module only records the request/intent.

import type { GameState } from '../state/GameState.js';
import { ROLE_LICENCE_REQUIRED } from './Vehicle.js';

/**
 * Request that an employee board a vehicle as its driver. Validates licence
 * and availability eagerly (mirroring `assignDriver`), but does not assign
 * the driver immediately — instead marks the employee's pending boarding
 * intent, which ArrivalGate.tickArrivalGate resolves once the employee has
 * arrived at the vehicle's position.
 */
export function requestBoardVehicle(
  state: GameState,
  vehicleId: number,
  employeeId: number,
): { success: boolean; error?: string } {
  const vehicle = state.vehicles.vehicles.find(v => v.id === vehicleId);
  if (!vehicle) return { success: false, error: 'Vehicle not found' };

  const employee = state.employees.employees.find(e => e.id === employeeId);
  if (!employee || !employee.alive) return { success: false, error: 'Employee not found' };

  const requiredLicence = ROLE_LICENCE_REQUIRED[vehicle.type];
  const hasLicence = employee.qualifications.some(q => q.category === requiredLicence);
  if (!hasLicence) return { success: false, error: 'Employee lacks licence for this role' };

  const alreadyDriving = state.vehicles.vehicles.some(v => v.driverId === employeeId);
  if (alreadyDriving) return { success: false, error: 'Employee already driving another vehicle' };

  if (vehicle.driverId !== null) return { success: false, error: 'Vehicle already has a driver' };

  if (employee.pendingDriverVehicleId !== null) {
    return { success: false, error: 'Employee already walking to board a vehicle' };
  }

  // Defer the actual assignDriver() call (licence/availability re-checked
  // there too) until ArrivalGate confirms co-location — walking there is
  // what #437 adds; the checks above only gate *starting* the walk.
  employee.pendingDriverVehicleId = vehicleId;
  employee.destinationX = vehicle.x;
  employee.destinationZ = vehicle.z;

  return { success: true };
}
