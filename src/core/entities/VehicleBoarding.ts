// BlastSimulator2026 — Vehicle boarding request
//
// Mirrors `assignDriver` (Vehicle.ts) but defers the actual driver
// assignment until the employee has physically arrived at the vehicle,
// via ArrivalGate.ts. This module only records the request/intent.

import type { GameState } from '../state/GameState.js';

/**
 * Request that an employee board a vehicle as its driver. Validates licence
 * and availability eagerly (mirroring `assignDriver`), but does not assign
 * the driver immediately — instead marks the employee's pending boarding
 * intent, which ArrivalGate.tickArrivalGate resolves once the employee has
 * arrived at the vehicle's position.
 */
export function requestBoardVehicle(
  _state: GameState,
  _vehicleId: number,
  _employeeId: number,
): { success: boolean; error?: string } {
  throw new Error('not implemented: requestBoardVehicle');
}
