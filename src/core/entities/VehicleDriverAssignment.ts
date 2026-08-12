// BlastSimulator2026 — Vehicle driver assignment
// Split out of Vehicle.ts to keep it under the 300-line file-size convention
// (dev-coding-conventions). Pure code-move (#484) — licence mapping, driver
// assignment checks, and the excavator loading-rate helper, verbatim from
// Vehicle.ts.

import type { EmployeeState, SkillCategory } from '../entities/Employee.js';
import type { Vehicle, VehicleRole, VehicleState } from './Vehicle.js';
import { getVehicleDef } from './Vehicle.js';

// ── Licence mapping ──

/** Qualification category a driver needs for each vehicle role. */
export const ROLE_LICENCE_REQUIRED: Record<VehicleRole, SkillCategory> = {
  debris_hauler: 'driving.truck',
  building_destroyer: 'driving.truck',
  rock_digger: 'driving.excavator',
  rock_fragmenter: 'driving.excavator',
  drill_rig: 'driving.drill_rig',
};

/**
 * Validate that an employee may become a vehicle's driver: vehicle exists,
 * employee exists and is alive, holds the role's required licence, isn't
 * already driving another vehicle, and the vehicle has no driver yet.
 * Shared by `assignDriver` (immediate assignment) and
 * `VehicleBoarding.requestBoardVehicle` (deferred, arrival-gated assignment,
 * #437) so the two stay in lockstep — same checks, same order, same error
 * strings — without duplicating the logic itself.
 */
export function canAssignDriver(
  vehicleState: VehicleState,
  employeeState: EmployeeState,
  vehicleId: number,
  employeeId: number,
): { success: true; vehicle: Vehicle; employee: EmployeeState['employees'][number] } | { success: false; error: string } {
  const vehicle = vehicleState.vehicles.find(v => v.id === vehicleId);
  if (!vehicle) return { success: false, error: 'Vehicle not found' };

  const employee = employeeState.employees.find(e => e.id === employeeId);
  if (!employee || !employee.alive) return { success: false, error: 'Employee not found' };

  const requiredLicence = ROLE_LICENCE_REQUIRED[vehicle.type];
  const hasLicence = employee.qualifications.some(q => q.category === requiredLicence);
  if (!hasLicence) return { success: false, error: 'Employee lacks licence for this role' };

  // A vehicle reserved for a vehicle-gated PendingAction (#550) may only be
  // boarded by the employee that reservation belongs to — anyone else (a
  // different employee, or a manual `vehicle driver` re-target) is blocked.
  // The reserving employee's own boarding succeeds because GameLoop sets
  // employee.activeActionId to the reserving action before requesting it.
  if (vehicle.reservedForActionId !== null && vehicle.reservedForActionId !== employee.activeActionId) {
    return { success: false, error: 'Vehicle is reserved for another task' };
  }

  const alreadyDriving = vehicleState.vehicles.some(v => v.driverId === employeeId);
  if (alreadyDriving) return { success: false, error: 'Employee already driving another vehicle' };

  if (vehicle.driverId !== null) return { success: false, error: 'Vehicle already has a driver' };

  return { success: true, vehicle, employee };
}

/** Assign a driver (employee) to a vehicle, enforcing licence and availability checks. */
export function assignDriver(
  vehicleState: VehicleState,
  employeeState: EmployeeState,
  vehicleId: number,
  employeeId: number,
): { success: boolean; error?: string } {
  const check = canAssignDriver(vehicleState, employeeState, vehicleId, employeeId);
  if (!check.success) return check;

  check.vehicle.driverId = employeeId;
  return { success: true };
}

/**
 * Returns the loading rate (kg/tick) for a rock_digger, or 0 for any other role.
 *
 * @note Function name intentionally kept as `getExcavatorLoadingRate` for
 *       public-API backward compatibility — do not rename without updating all callers.
 */
export function getExcavatorLoadingRate(vehicle: Vehicle): number {
  if (vehicle.type !== 'rock_digger') return 0;
  return getVehicleDef('rock_digger').capacity;
}
