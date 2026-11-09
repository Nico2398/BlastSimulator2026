// BlastSimulator2026 — Dominant rock of a hole's column

import { type VoxelGrid, firstEmptyLayerAboveGround } from '../world/VoxelGrid.js';
import { getRock } from '../world/RockCatalog.js';

/** Dominant rock of a column together with its hardness tier. */
export interface ColumnRock {
  rockId: string;
  tier: number;
}

/** Hardness tier of a rock id (0 for air or an unknown id). */
function rockTierOf(rockId: string): number {
  return rockId === '' ? 0 : (getRock(rockId)?.hardnessTier ?? 0);
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
