// BlastSimulator2026 — Sealed fragment detection (#1774)

import { computeVoxelColumnSurfaceY } from '../world/VoxelGrid.js';
import type { VoxelGrid } from '../world/VoxelGrid.js';
import type { Vec3 } from '../math/Vec3.js';

/**
 * True when the fragment sits below its column's intact top solid voxel
 * (buried under rock, unreachable). False when the column has no ground.
 */
export function isFragmentSealed(grid: VoxelGrid, position: Vec3): boolean {
  const top = computeVoxelColumnSurfaceY(grid, Math.floor(position.x), Math.floor(position.z));
  return top !== null && position.y < top;
}
