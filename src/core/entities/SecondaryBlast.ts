// BlastSimulator2026 — Secondary blasts
// A destroyed explosive warehouse holding stock detonates, hurting what is near it.

import type { AccidentRecord, DamageState } from './Damage.js';
import type { BuildingState } from './Building.js';
import type { VehicleState } from './Vehicle.js';
import type { EmployeeState } from './Employee.js';

/** Emitted when an `explosive_warehouse` with stored explosives is destroyed. */
export interface SecondaryBlastEvent {
  buildingId: number;
  x: number;
  z: number;
  explosivesKg: number;
}

export interface SecondaryBlastOutcome {
  event: SecondaryBlastEvent;
  radiusM: number;
  accidents: AccidentRecord[];
  /** Further warehouses the detonation destroyed, to be resolved in turn. */
  chained: SecondaryBlastEvent[];
}

/** Detonation radius in metres for a stored explosive mass. */
export function secondaryBlastRadiusM(_kg: number): number {
  // TODO: implement
  return undefined as unknown as number;
}

/** Resolve each event (and its chain) against buildings, vehicles and employees. */
export function resolveSecondaryBlasts(
  _events: SecondaryBlastEvent[],
  _buildings: BuildingState,
  _vehicles: VehicleState,
  _employees: EmployeeState,
  _damage: DamageState,
  _tick: number,
): SecondaryBlastOutcome[] {
  // TODO: implement
  return undefined as unknown as SecondaryBlastOutcome[];
}
