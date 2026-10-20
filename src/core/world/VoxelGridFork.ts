// BlastSimulator2026 — independent voxel grid copy for dry-run simulation (#1968)

import type { VoxelGrid } from './VoxelGrid.js';

/** Independent copy of `grid` that a blast can mutate without touching the original. */
export function forkVoxelGrid(grid: VoxelGrid): VoxelGrid {
  void grid;
  throw new Error('not implemented');
}
