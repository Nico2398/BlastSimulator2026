// BlastSimulator2026 — progress of the work a mounted employee does from a vehicle (#2226)

import type { Employee } from './Employee.js';
import type { VehicleState } from './Vehicle.js';

/**
 * Fraction (0-1) of the work a mounted employee is doing: the timed task's own fraction, else the
 * load dwell of the itinerary leg being served (#2199). Null when there is nothing meaningful to show.
 */
export function mountedWorkFraction(_employee: Employee, _vehicleState: VehicleState): number | null {
  throw new Error('not implemented');
}
