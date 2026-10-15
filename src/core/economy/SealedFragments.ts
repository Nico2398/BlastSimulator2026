// BlastSimulator2026 — Sealed fragment detection (#1774)

import type { VoxelGrid } from '../world/VoxelGrid.js';
import type { Vec3 } from '../math/Vec3.js';

/**
 * True when the fragment sits below its column's intact top solid voxel
 * (buried under rock, unreachable). False when the column has no ground.
 */
export function isFragmentSealed(_grid: VoxelGrid, _position: Vec3): boolean {
  // TODO: implement
  return false;
}
