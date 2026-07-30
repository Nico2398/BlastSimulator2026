// BlastSimulator2026 — Blast origin surface sampling helpers
// Split out of GameRenderer.ts (file-size convention) — these are pure
// helpers that decide where to anchor blast-effect visuals (dust cloud,
// detonation flash) on the terrain surface.

import type { VoxelGrid } from '../core/world/VoxelGrid.js';
import { BLAST_ORIGIN_SURFACE_SEARCH_MIN_RADIUS } from '../core/config/balance.js';

/** Min/max X and Z across a set of points — used to size the blast-origin surface search ring. */
export function boundingBoxXZ(
  points: readonly { x: number; z: number }[],
): { minX: number; maxX: number; minZ: number; maxZ: number } {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  return { minX, maxX, minZ, maxZ };
}

/**
 * Surface Y to anchor blast effects (dust cloud, detonation flash) at.
 * The blast centroid's own column is very likely fully cleared by the blast
 * that just happened (density 0 all the way down), so sampling it directly
 * usually returns 0 — burying the effect underground. Sampling a ring
 * around the centre and taking the highest surface found lands on the
 * surrounding, still-standing ground level instead.
 *
 * A fixed 3m ring only clears a small blast's own crater. A large,
 * tightly-spaced, multi-hole blast clears a crater far wider than that —
 * the whole ring can land inside it and still read back y=0. `minRadius`
 * should be sized to the blast's own footprint (e.g. half its bounding-box
 * diagonal) so the first ring already sits outside the crater; if it
 * doesn't (irregular crater edges, sloped walls), the search keeps
 * widening in `minRadius` steps up to the grid extent.
 *
 * `getSurfaceY` is the caller's terrain-height query (clamped to grid bounds,
 * returns 0 when the column is empty) — injected rather than reading the
 * grid directly so this stays a pure function of its inputs.
 */
export function getBlastOriginSurfaceY(
  grid: VoxelGrid,
  getSurfaceY: (x: number, z: number) => number,
  cx: number,
  cz: number,
  minRadius = BLAST_ORIGIN_SURFACE_SEARCH_MIN_RADIUS,
): number {
  const step = Math.max(1, minRadius);
  const maxRadius = Math.max(grid.sizeX, grid.sizeZ);
  for (let r = step; r <= maxRadius; r += step) {
    const offsets: readonly [number, number][] = [
      [r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r], [r, -r], [-r, r],
    ];
    let maxY = 0;
    for (const [dx, dz] of offsets) {
      maxY = Math.max(maxY, getSurfaceY(cx + dx, cz + dz));
    }
    if (maxY > 0) return maxY;
  }
  return getSurfaceY(cx, cz);
}
