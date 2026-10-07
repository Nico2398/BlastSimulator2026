// BlastSimulator2026 — Explosive vs rock tier fit
// How far an explosive's tier falls short of the rock it must break.

import { type VoxelGrid, firstEmptyLayerAboveGround } from '../world/VoxelGrid.js';
import { getRock } from '../world/RockCatalog.js';
import { TIER_SHORTFALL_THRESHOLD_FACTOR } from '../config/balance.js';

/** Dominant rock of a column together with its hardness tier. */
export interface ColumnRock {
  rockId: string;
  tier: number;
}

/** Tiers by which the rock outclasses the explosive (0 when the explosive suffices). */
export function tierShortfall(explosiveTier: number, rockTier: number): number {
  return Math.max(0, rockTier - explosiveTier);
}

/** Breaking-threshold multiplier for a shortfall. */
export function tierThresholdFactor(shortfall: number): number {
  return TIER_SHORTFALL_THRESHOLD_FACTOR ** shortfall;
}

/** Hardness tier of a rock id (0 for air or an unknown id). */
function rockTierOf(rockId: string): number {
  return rockId === '' ? 0 : (getRock(rockId)?.hardnessTier ?? 0);
}

/** Hardness tier of the dominant rock in a voxel (0 for air). */
export function dominantRockTierAt(grid: VoxelGrid, x: number, y: number, z: number): number {
  return rockTierOf(grid.dominantRockAt(x, y, z));
}

/** Modal dominant rock along a column (higher tier wins ties); null when all air. */
export function dominantRockAlongColumn(
  grid: VoxelGrid,
  x: number,
  z: number,
  surfaceY: number,
  depth: number,
): ColumnRock | null {
  const counts = new Map<string, number>();
  for (let y = surfaceY - depth; y < surfaceY; y++) {
    const rockId = grid.dominantRockAt(x, y, z);
    if (rockId === '') continue;
    counts.set(rockId, (counts.get(rockId) ?? 0) + 1);
  }
  let best: ColumnRock | null = null;
  let bestCount = 0;
  for (const [rockId, count] of counts) {
    const tier = rockTierOf(rockId);
    if (count > bestCount || (count === bestCount && best !== null && tier > best.tier)) {
      best = { rockId, tier };
      bestCount = count;
    }
  }
  return best;
}

/** Dominant rock along a drill hole's column, from the ground surface down by the hole's depth. */
export function dominantRockUnderHole(
  grid: VoxelGrid,
  hole: { x: number; z: number; depth: number },
): ColumnRock | null {
  const x = Math.floor(hole.x);
  const z = Math.floor(hole.z);
  return dominantRockAlongColumn(grid, x, z, firstEmptyLayerAboveGround(grid, x, z), hole.depth);
}
