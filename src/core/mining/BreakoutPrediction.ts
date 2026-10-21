// BlastSimulator2026 — Predicts how much of a planned blast breaks out vs stays sealed (#2003)
// Runs the same read-only energy pass and fragmentation as the executor (liftUnderminedBurden
// included), so the prediction and `executeBlast`'s `brokeOut` agree.
import { hasChargedHole, type BlastPlan } from './BlastPlan.js';
import { buildPlanEnergyField } from './BlastExecution.js';
import { identifyFragmentedVoxels } from './VoxelFragmentation.js';
import { sealedShare } from './BlastRatingCaps.js';
import { BLAST_SEALED_SHARE_PARTIAL } from '../config/balance.js';
import type { VoxelGrid } from '../world/VoxelGrid.js';

export interface BreakoutPrediction {
  brokenVoxels: number;
  sealedVoxels: number;
  /** 0..1 share of broken rock that stays sealed under intact cap. */
  sealedShare: number;
  /** Charged holes whose charge sits too deep to break out. */
  tooDeepHoleIds: string[];
  chargedHoleCount: number;
}

/** Predicts the breakout of `plan` on `grid`; null when no hole is charged. Never mutates `grid`. */
export function predictBreakout(
  plan: BlastPlan,
  grid: VoxelGrid,
  wetHoleIds?: ReadonlySet<string>,
): BreakoutPrediction | null {
  if (!hasChargedHole(plan)) return null;
  const field = buildPlanEnergyField(plan, grid, wetHoleIds);
  if (!field) return null;
  const { fragmented } = identifyFragmentedVoxels(field, grid, false);

  // Broken rows per column, then the highest solid row left intact in that column.
  const columns = new Map<string, { x: number; z: number; rows: number[] }>();
  const brokenKeys = new Set<string>();
  for (const { x, y, z } of fragmented) {
    brokenKeys.add(`${x},${y},${z}`);
    const key = `${x},${z}`;
    const col = columns.get(key);
    if (col) col.rows.push(y);
    else columns.set(key, { x, z, rows: [y] });
  }

  const { box } = field;
  const intactTop = (x: number, z: number): number => {
    for (let y = box.maxY - 1; y >= box.minY; y--) {
      if (grid.isSolidAt(x, y, z) && !brokenKeys.has(`${x},${y},${z}`)) return y;
    }
    return -Infinity;
  };

  // A broken voxel is sealed when intact rock still sits above it in its column.
  let sealedVoxels = 0;
  const sealedColumns = new Set<string>();
  for (const [key, { x, z, rows }] of columns) {
    const top = intactTop(x, z);
    const sealedHere = rows.filter(y => y < top).length;
    if (sealedHere > 0) { sealedVoxels += sealedHere; sealedColumns.add(key); }
  }

  const charged = plan.holes.filter(h => plan.charges[h.id] !== undefined);
  const tooDeepHoleIds = charged
    .filter(h => sealedColumns.has(`${Math.floor(h.x)},${Math.floor(h.z)}`))
    .map(h => h.id);
  return {
    brokenVoxels: fragmented.length,
    sealedVoxels,
    sealedShare: sealedShare(sealedVoxels, fragmented.length),
    tooDeepHoleIds,
    chargedHoleCount: charged.length,
  };
}

/**
 * 'none' when nothing breaks out of the too-deep holes; 'partial' when the sealed share reaches
 * BLAST_SEALED_SHARE_PARTIAL; null when no warning is due.
 */
export function breakoutWarningKind(prediction: BreakoutPrediction): 'none' | 'partial' | null {
  if (prediction.brokenVoxels > 0 && prediction.sealedVoxels >= prediction.brokenVoxels) return 'none';
  return prediction.sealedShare >= BLAST_SEALED_SHARE_PARTIAL ? 'partial' : null;
}
