// BlastSimulator2026 — Drill rig tier limit tables
// Shared lookups over a per-tier limit table (max depth, max diameter, ...).

import type { Vehicle, VehicleTier } from '../entities/Vehicle.js';

/** Best value of `limits` over the fleet's `drill_rig` vehicles; tier-1 value with none owned. */
export function fleetBestRigLimit(
  limits: Record<VehicleTier, number>,
  vehicles: ReadonlyArray<Pick<Vehicle, 'type' | 'tier'>>,
): number {
  let best = limits[1];
  for (const v of vehicles) {
    if (v.type !== 'drill_rig') continue;
    best = Math.max(best, limits[v.tier]);
  }
  return best;
}

/** Lowest tier whose limit (plus `tolerance`) reaches `needed`; the top tier when none does. */
export function lowestRigTierReaching(
  limits: Record<VehicleTier, number>,
  needed: number,
  tolerance = 0,
): VehicleTier {
  const tiers = Object.keys(limits).map(Number).sort((a, b) => a - b) as VehicleTier[];
  return tiers.find(t => limits[t] + tolerance >= needed) ?? tiers[tiers.length - 1]!;
}
