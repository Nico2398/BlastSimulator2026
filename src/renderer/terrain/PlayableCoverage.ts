// BlastSimulator2026 — One authority for the ground the playable mesh covers (#907)
//
// TerrainMesh and LandscapeMesh both have to answer the same question — "which
// square metres of ground does the marching-cubes mesh draw?" — and every
// previous pass at the seam (#458 → #491 → #559 → #560) answered it twice, once
// in `TerrainMesh.rebuildChunk`'s march bounds and once in a hand-derived
// predicate beside it. The two drifted, and a square metre claimed by both (a
// doubled edge) or by neither (a slot you can see through) is what the player
// sees at the site boundary.
//
// So the march bounds ARE the predicate here: `meshedCellRect` is what
// `rebuildChunk` loops over, and `meshClaimsCell` is a point test against
// exactly that rect. Neither can move without the other.
//
// The unit is a **cell**, not a column: the 1 m square whose minimum corner is
// (x, z), which is precisely one marching-cubes cube column. `meshClaimsCell(x,
// z)` is therefore "TerrainMesh marches the cube at (x, ·, z)", and the
// landscape keeps a fine cell exactly when the answer is no.

import { chunkIndexOf, type VoxelGrid } from '../../core/world/VoxelGrid.js';
import { heightToVoxelYContinuous } from '../../core/world/WorldGen.js';

/** Half-open cell range (max exclusive), in world metres. */
export interface CellRect {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/**
 * Which cells `TerrainMesh.rebuildChunk` marches for chunk (cx, cz), or null
 * when the site does not own that chunk.
 *
 * The chunk's own owned rect, extended one cell west and north wherever no
 * owned chunk lies beyond that side. That halo is what seals the playable
 * volume: its outer column is not owned, so the cube straddling the boundary
 * marches into a wall face instead of leaving an open shell a blast at the
 * edge could be seen straight through. An owned neighbour marches those cubes
 * itself, so the halo is never added on a side that has one — marching them
 * twice would emit the interior wall between two claimed chunks.
 *
 * There is no matching halo on the east/south: the last owned cell (maxX - 1)
 * already reaches its high corner at x = maxX, one metre past the last owned
 * column, so the boundary cube on that side is the owned cell itself.
 */
export function meshedCellRect(grid: VoxelGrid, cx: number, cz: number): CellRect | null {
  const rect = grid.chunkRect(cx, cz);
  if (!rect) return null;
  return {
    minX: grid.hasChunk(cx - 1, cz) ? rect.minX : rect.minX - 1,
    minZ: grid.hasChunk(cx, cz - 1) ? rect.minZ : rect.minZ - 1,
    maxX: rect.maxX,
    maxZ: rect.maxZ,
  };
}

/**
 * Every chunk whose meshed rect can contain the cell at (x, z): the chunk that
 * owns it, plus the three whose west/north/north-west halo it could be. A halo
 * cell sits one metre west and/or north of an owned cell, so shifting the
 * lookup by (+1, 0), (0, +1) and (+1, +1) covers all of them — including the
 * diagonal corner cell, which a west-only and a north-only test both miss and
 * which `rebuildChunk` does march whenever both sides are unclaimed.
 */
const HALO_LOOKUP_OFFSETS: readonly (readonly [number, number])[] = [
  [0, 0], [1, 0], [0, 1], [1, 1],
];

/**
 * True when the playable mesh draws ground over the 1 m cell whose minimum
 * corner is (x, z) — i.e. when some owned chunk's `meshedCellRect` contains it.
 *
 * Non-integer coordinates are floored onto their cell, so a caller may pass a
 * sample point rather than a lattice node.
 */
export function meshClaimsCell(grid: VoxelGrid, x: number, z: number): boolean {
  const cellX = Math.floor(x);
  const cellZ = Math.floor(z);
  for (const [dx, dz] of HALO_LOOKUP_OFFSETS) {
    const rect = meshedCellRect(grid, chunkIndexOf(cellX + dx), chunkIndexOf(cellZ + dz));
    if (!rect) continue;
    if (cellX >= rect.minX && cellX < rect.maxX && cellZ >= rect.minZ && cellZ < rect.maxZ) return true;
  }
  return false;
}

/**
 * The surface height the playable mesh renders at an unowned halo column whose
 * neighbouring ground the landscape samples at `height`.
 *
 * The halo column stands in for ground the grid does not own, so the height to
 * put it at is the one the grid's own generator would have produced there —
 * `heightToVoxelYContinuous`, the clamp `TerrainGen` fills every real column
 * through. `height` already carries the ground offset (the landscape samples in
 * the same datum as playable voxel Y), so the offset passed here is zero and
 * only the clamp does any work.
 *
 * The clamp matters at the low corner of a level whose relief nearly fills its
 * grid: the ground beside the site dips below the world's floor datum, the march
 * has no cube below y = 0 to cross in, and an unclamped ring node asks for a
 * vertex the playable mesh cannot place — which is a hole. Clamping is the
 * answer, and clamping to the generator's own bound is what keeps the last metre
 * flat: the site's edge column was generated through exactly this call, so the
 * shared node lands on the same value instead of a metre below it, and the drop
 * to the true ground happens one node further out, inside the landscape's own
 * continuous sheet (#907).
 */
export function haloSurfaceHeight(grid: VoxelGrid, height: number): number {
  if (!Number.isFinite(height)) return height;
  return heightToVoxelYContinuous(height, 0, grid.sizeY);
}

/**
 * True when the lattice node (x, z) is a corner of some cell the playable mesh
 * draws — i.e. when the playable mesh puts a vertex column there and the
 * landscape, if it reaches that node at all, is meeting it.
 */
export function nodeTouchesMeshedCell(grid: VoxelGrid, x: number, z: number): boolean {
  return (
    meshClaimsCell(grid, x, z) || meshClaimsCell(grid, x - 1, z) ||
    meshClaimsCell(grid, x, z - 1) || meshClaimsCell(grid, x - 1, z - 1)
  );
}
