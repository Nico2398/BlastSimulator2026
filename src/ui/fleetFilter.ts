// BlastSimulator2026 — fleet list filter/sort criteria (#2161).

import { getVehicleDefByTier, vehicleDriverId, type Vehicle, type VehicleRole, type VehicleTier } from '../core/entities/Vehicle.js';
import { computeVehicleStatus, type VehicleStatusKind } from '../core/entities/VehicleStatus.js';
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

const STATUS_KINDS: Record<FleetStatusChoice, readonly VehicleStatusKind[]> = {
  working: ['working', 'hauling', 'moving'],
  waiting: ['waiting'],
  stuck: ['stuck'],
  damaged: ['broken'],
};

/** Read the bar selection: filter = role, groups tier/status, sort. */
export function fleetCriteriaFromSelection(selection: FilterBarSelection): FleetCriteria {
  const tier = Number(selection.groups['tier']);
  const status = selection.groups['status'];
  return {
    role: (selection.filter as VehicleRole | null) ?? null,
    tier: tier === 1 || tier === 2 || tier === 3 ? tier : null,
    status: (FLEET_STATUS_CHOICES as readonly string[]).includes(status ?? '') ? status as FleetStatusChoice : null,
    sort: (FLEET_SORT_KEYS as readonly string[]).includes(selection.sort ?? '') ? selection.sort as FleetSortKey : null,
  };
}

function matchesStatus(v: Vehicle, status: FleetStatusChoice, state: GameState): boolean {
  const driverId = vehicleDriverId(v);
  const occupant = driverId === null ? undefined : state.employees.employees.find(e => e.id === driverId);
  return STATUS_KINDS[status].includes(computeVehicleStatus(v, state.vehicles, occupant).kind);
}

function hpFraction(v: Vehicle): number {
  const maxHp = getVehicleDefByTier(v.type, v.tier).maxHp;
  return maxHp > 0 ? v.hp / maxHp : 0;
}

const SORTERS: Record<FleetSortKey, (a: Vehicle, b: Vehicle) => number> = {
  hp: (a, b) => hpFraction(a) - hpFraction(b),
  tier: (a, b) => b.tier - a.tier,
};

/** Vehicles matching every criterion, ordered by the sort key (stored order when none). */
export function filterVehicles(vehicles: readonly Vehicle[], criteria: FleetCriteria, state: GameState): Vehicle[] {
  const kept = vehicles.filter(v =>
    (criteria.role === null || v.type === criteria.role)
    && (criteria.tier === null || v.tier === criteria.tier)
    && (criteria.status === null || matchesStatus(v, criteria.status, state)));
  const cmp = criteria.sort === null ? null : SORTERS[criteria.sort];
  return cmp ? kept.sort((a, b) => cmp(a, b) || a.id - b.id) : kept;
}
