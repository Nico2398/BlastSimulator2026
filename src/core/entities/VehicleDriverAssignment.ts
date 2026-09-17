// BlastSimulator2026 — Vehicle driver assignment
// Split out of Vehicle.ts to keep it under the 300-line file-size convention
// (dev-coding-conventions). Pure code-move (#484) — licence mapping, driver
// assignment checks, and the excavator loading-rate helper, verbatim from
// Vehicle.ts.

import type { Employee, EmployeeState, SkillCategory } from '../entities/Employee.js';
import type { Vehicle, VehicleRole, VehicleState } from './Vehicle.js';
import { vehicleDriverId } from './Vehicle.js';
import { isMounted } from './EmployeeLocomotion.js';
import { EVACUATION_DRIVER_MAX_PATH_ATTEMPTS } from '../config/balance.js';

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
 * Shared by `Mount.board` (arrival-gated assignment) and
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

  const alreadyDriving = vehicleState.vehicles.some(v => vehicleDriverId(v) === employeeId);
  if (alreadyDriving) return { success: false, error: 'Employee already driving another vehicle' };

  if (vehicleDriverId(vehicle) !== null) return { success: false, error: 'Vehicle already has a driver' };

  return { success: true, vehicle, employee };
}

// ── Evacuation driver assignment (#1042) ──

/** Whether `employee` can reach `vehicle` in time to board and drive it clear. */
export type EvacuationDriverReachabilityCheck = (employee: Employee, vehicle: Vehicle) => boolean;

/**
 * Picks the best qualified candidate among `candidateEmployeeIds` to board
 * `vehicle` and drive it clear of an evacuating zone, or null when none
 * qualifies or can reach it.
 */
export function findBestEvacuationDriver(
  vehicle: Vehicle,
  vehicleState: VehicleState,
  employeeState: EmployeeState,
  candidateEmployeeIds: readonly number[],
  canReach: EvacuationDriverReachabilityCheck,
): Employee | null {
  const qualified = rankQualifiedDriversByDistance(vehicle, vehicleState, employeeState, candidateEmployeeIds);

  for (let i = 0; i < qualified.length && i < EVACUATION_DRIVER_MAX_PATH_ATTEMPTS; i++) {
    const candidate = qualified[i]!;
    if (canReach(candidate, vehicle)) return candidate;
  }

  return null;
}

/**
 * `candidateEmployeeIds` ranked nearest-first (lowest id breaking an exact
 * tie) and filtered down to those `canAssignDriver` actually accepts for
 * `vehicle` — licence, availability, and reservation, all cheap and exact,
 * applied to the whole pool before any caller spends a real `findPath` on
 * it (mirrors selectBestActionForEmployee's own pre-filter,
 * ActionSelection.ts). Shared by evacuation dispatch and the player's own
 * `reposition` order (#1092) — both want "the nearest employee who could
 * legally drive this", differing only in what they additionally require.
 */
function rankQualifiedDriversByDistance(
  vehicle: Vehicle,
  vehicleState: VehicleState,
  employeeState: EmployeeState,
  candidateEmployeeIds: readonly number[],
): Employee[] {
  const ranked = [...candidateEmployeeIds].sort((a, b) => {
    const empA = employeeState.employees.find(e => e.id === a);
    const empB = employeeState.employees.find(e => e.id === b);
    const distA = empA ? distanceSq(empA, vehicle) : Infinity;
    const distB = empB ? distanceSq(empB, vehicle) : Infinity;
    if (distA !== distB) return distA - distB;
    return a - b;
  });

  const qualified: Employee[] = [];
  for (const candidateId of ranked) {
    const check = canAssignDriver(vehicleState, employeeState, vehicle.id, candidateId);
    if (check.success) qualified.push(check.employee);
  }
  return qualified;
}

function distanceSq(employee: Employee, vehicle: Vehicle): number {
  const dx = employee.x - vehicle.x;
  const dz = employee.z - vehicle.z;
  return dx * dx + dz * dz;
}

// ── Reposition driver assignment (#1092) ──

/**
 * Picks a licensed, genuinely idle employee to drive `vehicle` to a
 * player-chosen parking spot (the `reposition` Goal — see
 * `gameplay-vehicle-fleet` phase 6), or null when none qualifies. Unlike
 * `findBestEvacuationDriver`, a reposition is player-initiated rather than
 * urgency-ranked against a caller-supplied candidate pool, so the pool is
 * the whole living roster and no `canReach` probe is spent up front —
 * `moveTo`'s own exact-fidelity plan is what refuses an unreachable
 * vehicle, and reports why.
 *
 * "Idle" is deliberately stricter than `canAssignDriver`'s availability
 * check: a player parking a vehicle must never pull an employee off work
 * they are already walking to, resting through, or collapsing from.
 */
export function findAvailableDriverForReposition(
  vehicle: Vehicle,
  vehicleState: VehicleState,
  employeeState: EmployeeState,
): Employee | null {
  const candidateIds = employeeState.employees
    .filter(e => isIdleForReposition(e, vehicle))
    .map(e => e.id);

  return rankQualifiedDriversByDistance(vehicle, vehicleState, employeeState, candidateIds)[0] ?? null;
}

/** Alive, doing nothing at all, and not sitting in (or walking to) some other vehicle. */
function isIdleForReposition(employee: Employee, vehicle: Vehicle): boolean {
  if (!employee.alive || employee.injured || employee.collapsing) return false;
  if (employee.activeActionId !== null || employee.itinerary !== null) return false;
  if (employee.restTicksRemaining !== null || employee.pendingRestDuration !== null) return false;
  if (employee.taskTicksRemaining !== null) return false;
  if (employee.destinationX !== null || employee.destinationZ !== null) return false;
  if (employee.pendingDriverVehicleId !== null && employee.pendingDriverVehicleId !== vehicle.id) return false;
  if (isMounted(employee.locomotion)) return false;
  return true;
}
