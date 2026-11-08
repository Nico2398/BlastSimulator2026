// BlastSimulator2026 — fleet list filter/sort criteria (#2161).

import type { Vehicle, VehicleRole, VehicleTier } from '../core/entities/Vehicle.js';
import type { GameState } from '../core/state/GameState.js';
import type { FilterBarSelection } from './filterBar.js';

export const FLEET_SORT_KEYS = ['hp', 'tier'] as const;
type FleetSortKey = typeof FLEET_SORT_KEYS[number];
export const FLEET_STATUS_CHOICES = ['working', 'waiting', 'stuck', 'damaged'] as const;
export type FleetStatusChoice = typeof FLEET_STATUS_CHOICES[number];

export interface FleetCriteria {
  role: VehicleRole | null;
  tier: VehicleTier | null;
  status: FleetStatusChoice | null;
  sort: FleetSortKey | null;
}

/** Read the bar selection: filter = role, groups tier/status, sort. */
export function fleetCriteriaFromSelection(_selection: FilterBarSelection): FleetCriteria {
  throw new Error('not implemented');
}

/** Vehicles matching every criterion, ordered by the sort key (stored order when none). */
export function filterVehicles(_vehicles: readonly Vehicle[], _criteria: FleetCriteria, _state: GameState): Vehicle[] {
  throw new Error('not implemented');
}
