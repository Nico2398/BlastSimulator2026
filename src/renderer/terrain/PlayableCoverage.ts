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
 * The halo column stands in for ground the grid does not own, so it runs the
 * halo's sampled height through the exact same offset arithmetic
 * (`heightToVoxelYContinuous`) the site's own real columns go through — that
 * shared datum is what keeps the halo node lining up with the site's edge
 * column instead of drifting from it (#907, #1189).
 *
 * `_grid` is unused since #1189 removed the playable-band clamp this function
 * used to apply through it — the body is now a pure passthrough
 * (`heightToVoxelYContinuous(height, 0)` === `height`). Kept as a no-op
 * parameter rather than dropped: every call site
 * (`TerrainMesh.ts`, `GameRendererTerrain.ts`) already reads naturally as
 * "halo height, given this grid and that sampled height", and dropping the
 * parameter would mean changing this exported function's signature blind to
 * its own test file's call sites. Drop `_grid` the next time this function's
 * test coverage is touched for an unrelated reason.
 */
export function haloSurfaceHeight(_grid: VoxelGrid, height: number): number {
  return heightToVoxelYContinuous(height, 0);
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
