// BlastSimulator2026 — Demolition duration (#1392). Pure.

import type { BuildingTier } from './Building.js';
import type { VehicleTier } from './Vehicle.js';
import {
  DEMOLITION_BASE_TICKS_PER_FOOTPRINT_CELL,
  DEMOLITION_TIER_MULTIPLIER,
  DEMOLITION_VEHICLE_TIER_SPEED,
} from '../config/balance.js';

/** Ticks a building_destroyer needs to demolish a building of the given footprint and tier. */
export function computeDemolitionDurationTicks(
  footprintCells: number,
  buildingTier: BuildingTier,
  vehicleTier: VehicleTier,
): number {
  const raw = footprintCells * DEMOLITION_BASE_TICKS_PER_FOOTPRINT_CELL
    * DEMOLITION_TIER_MULTIPLIER[buildingTier]
    / DEMOLITION_VEHICLE_TIER_SPEED[vehicleTier];
  return Math.max(1, Math.ceil(raw));
}
