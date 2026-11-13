// BlastSimulator2026 — progress of the work a mounted employee does from a vehicle (#2226)

import type { Employee } from './Employee.js';
import type { VehicleState } from './Vehicle.js';
import { computeEmployeeActivity, taskProgressFraction } from './EmployeeActivity.js';

/**
 * Fraction (0-1) of the work a mounted employee is doing: the timed task's own fraction, else the
 * load dwell of the itinerary leg being served (#2199). Null when there is nothing meaningful to show.
 */
export function mountedWorkFraction(employee: Employee, vehicleState: VehicleState): number | null {
  const activity = computeEmployeeActivity(employee, vehicleState);
  if (activity.kind === 'working') {
    return activity.actionType === 'place_building' ? null : taskProgressFraction(activity);
  }
  const leg = employee.itinerary?.legs[0];
  if (!leg || leg.dwellTicks === undefined || leg.dwellTicks <= 0 || leg.dwellLeft === undefined) return null;
  return Math.min(1, Math.max(0, (leg.dwellTicks - leg.dwellLeft) / leg.dwellTicks));
}
