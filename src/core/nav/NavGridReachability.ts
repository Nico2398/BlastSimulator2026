// BlastSimulator2026 — NavGrid reachability queries
//
// Flood-fill based reachability: nearest traversable cell, nearest cell
// actually path-connected to an anchor, and full reachable-set queries.
// Split out of NavGrid.ts to keep it under the 300-line file-size convention
// (dev-coding-conventions) — NavGrid keeps thin static wrappers around these
// so `NavGrid.findNearestReachableCell` etc. remain the public entry points.

import type { NavGrid } from './NavGrid.js';

/** True when a cell exists, is in bounds, and has finite moveCost (walkable/ramp/drill_hole). */
export function isTraversableCell(navGrid: NavGrid, x: number, z: number): boolean {
  const cell = navGrid.cellAt(x, z);
  return !!cell && cell.type !== 'blocked' && cell.type !== 'void';
}

/**
 * Find the nearest traversable cell (walkable/ramp/drill_hole — anything
 * with finite moveCost) to (x, z), searching outward in expanding square
 * rings. Returns (x, z) unchanged when it is already traversable, or when
 * nothing traversable turns up within maxRadius.
 *
 * Distance-only: does not check that the cell found is actually path-
 * connected to anywhere else. A blast crater can carve isolated traversable
 * pockets walled off by 'void' on every side — nearest-by-distance can land
 * on one of those. Callers that need an actually reachable point should use
 * findNearestReachableCell instead.
 */
export function findNearestTraversableCell(
  navGrid: NavGrid,
  x: number,
  z: number,
  maxRadius: number = Math.max(navGrid.width, navGrid.height),
): { x: number; z: number } {
  if (isTraversableCell(navGrid, x, z)) return { x, z };

  for (let r = 1; r <= maxRadius; r++) {
    let best: { x: number; z: number } | null = null;
    let bestDistSq = Infinity;
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue; // ring only
        const cx = x + dx;
        const cz = z + dz;
        if (!isTraversableCell(navGrid, cx, cz)) continue;
        const distSq = dx * dx + dz * dz;
        if (distSq < bestDistSq) {
          bestDistSq = distSq;
          best = { x: cx, z: cz };
        }
      }
    }
    if (best) return best;
  }

  return { x, z };
}

/**
 * Find the nearest cell to (targetX, targetZ) that is actually 8-directionally
 * path-connected to (anchorX, anchorZ) — same adjacency Pathfinding.findPath
 * walks, so a cell this returns is guaranteed reachable from the anchor,
 * unlike findNearestTraversableCell's plain distance search.
 *
 * Exists because a spawn/destination point picked without checking the
 * NavGrid — e.g. a vehicle purchase or employee hire landing at the world's
 * geometric centre — can resolve to a blast-cleared 'void' column, or to an
 * isolated traversable pocket a blast crater walled off from the rest of the
 * map with no floor at all, which arrival-gated actions (#437) can never
 * actually path to even after nudging to the "nearest" traversable cell.
 *
 * anchorX/anchorZ should be a point known to sit in the map's main
 * connected region (callers typically use a world corner). Falls back to
 * (targetX, targetZ) unchanged if the anchor itself resolves to no
 * traversable cell, or if the connected component containing it is empty.
 *
 * Same-bench-level preference (#458 T6.1/D13): this flood fill is a flat
 * 8-directional walkable/ramp/drill_hole adjacency check with no notion of
 * bench level, so it happily calls a cell "reachable" that sits across a
 * bench-level boundary from the anchor — connected by grid adjacency, but
 * only actually walkable via Pathfinding.findMultiLevelPath's ramp-entrance/
 * exit routing, which re-picks the cheapest candidate ramp fresh every tick
 * from the agent's current (sub-cell, continuously moving) position. When
 * two ramps have close-enough cost, that fresh-every-tick re-pick flips
 * between them as the agent moves, producing a stable walk-forward/
 * walk-back loop that never arrives (confirmed via direct reproduction: a
 * driver stuck oscillating between two points for 150+ ticks trying to
 * reach a vehicle across exactly this kind of boundary). Bigger levels
 * (#458 D13) carry far more natural relief than the old ones, so this
 * boundary comes up constantly rather than rarely. Preferring a
 * same-bench-level candidate whenever one exists sidesteps multi-level
 * routing for this call entirely, rather than attempting to stabilize its
 * ramp selection (a larger, riskier change to Pathfinding.ts's stateless,
 * recomputed-fresh-every-tick design).
 */
export function findNearestReachableCell(
  navGrid: NavGrid,
  anchorX: number,
  anchorZ: number,
  targetX: number,
  targetZ: number,
): { x: number; z: number } {
  const anchor = findNearestTraversableCell(navGrid, anchorX, anchorZ);
  if (!isTraversableCell(navGrid, anchor.x, anchor.z)) return { x: targetX, z: targetZ };

  // 8-directional flood fill from the anchor — same adjacency A* uses.
  const { width, count } = floodFillReachable(navGrid, anchor.x, anchor.z);
  const anchorLevel = navGrid.cellAt(anchor.x, anchor.z)?.benchLevel;

  let best = anchor;
  let bestDistSq = (anchor.x - targetX) ** 2 + (anchor.z - targetZ) ** 2;
  let bestSameLevel: { x: number; z: number } | null = null;
  let bestSameLevelDistSq = Infinity;

  // Consumed synchronously, immediately after the fill above — safe to read
  // queueArr directly (see the scratch-buffer note on floodFillReachable).
  for (let i = 0; i < count; i++) {
    const idx = queueArr[i]!;
    const x = navGrid.originX + (idx % width);
    const z = navGrid.originZ + ((idx / width) | 0);
    const distSq = (x - targetX) ** 2 + (z - targetZ) ** 2;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      best = { x, z };
    }
    if (anchorLevel !== undefined && navGrid.cellAt(x, z)?.benchLevel === anchorLevel && distSq < bestSameLevelDistSq) {
      bestSameLevelDistSq = distSq;
      bestSameLevel = { x, z };
    }
  }

  return bestSameLevel ?? best;
}

/**
 * A reachable-set query result. `has`/`size` mirror the `Set<string>` API
 * callers used to get back, without the per-cell string-key hashing —
 * `has(x, z)` takes coordinates directly rather than a `"x,z"` key.
 */
export interface ReachableSet {
  has(x: number, z: number): boolean;
  readonly size: number;
}

const EMPTY_REACHABLE_SET: ReachableSet = { has: () => false, size: 0 };

/**
 * Compute the set of all cells 8-directionally path-connected to
 * (anchorX, anchorZ) — same adjacency Pathfinding.findPath and
 * findNearestReachableCell walk.
 *
 * Returns an empty set when the anchor cell itself is non-traversable
 * (no nudge to the nearest traversable cell, unlike findNearestReachableCell —
 * this is a raw reachability query from the exact anchor given).
 */
export function computeReachableSet(navGrid: NavGrid, anchorX: number, anchorZ: number): ReachableSet {
  const ax = Math.round(anchorX);
  const az = Math.round(anchorZ);
  if (!isTraversableCell(navGrid, ax, az)) return EMPTY_REACHABLE_SET;

  const { width, height, count } = floodFillReachable(navGrid, ax, az);
  const { originX, originZ } = navGrid;
  // Independent snapshot: floodFillReachable's next call reuses the shared
  // scratch buffer, so a wrapper aliasing it directly would go stale (or
  // wrong) the moment another reachability query runs before this one is
  // done being read. A typed-array copy is still far cheaper — both to build
  // and to query — than the Set<string> this replaced.
  const visited = visitedArr.slice(0, width * height);

  return {
    has(x: number, z: number): boolean {
      const lx = x - originX;
      const lz = z - originZ;
      if (lx < 0 || lz < 0 || lx >= width || lz >= height) return false;
      return visited[lz * width + lx] === 1;
    },
    size: count,
  };
}

// ---------------------------------------------------------------------------
// Flood-fill scratch (#458 T6.2/D14)
// ---------------------------------------------------------------------------
//
// Same rationale as Pathfinding.ts's A* scratch arrays: a Set<string> per
// call means a string-keyed hash-table entry (allocation + hashing) for
// every one of potentially thousands of reachable cells on D13's bigger
// levels, discarded as garbage on return. A flat Uint8Array visited flag
// plus an Int32Array queue (packed row-major indices) replace it. Grown
// (never shrunk) to fit the largest grid seen; only the cells touched by the
// PREVIOUS call are cleared before reuse (via the queue itself), not the
// whole buffer, so a small flood fill on a big level stays cheap regardless
// of how large the level is.
let scratchCapacity = 0;
let visitedArr = new Uint8Array(0);
let queueArr = new Int32Array(0);
let lastFillCount = 0;

function ensureReachabilityScratch(size: number): void {
  if (size <= scratchCapacity) return;
  scratchCapacity = size;
  visitedArr = new Uint8Array(size);
  queueArr = new Int32Array(size);
  lastFillCount = 0; // fresh arrays are already all-zero; nothing to clear
}

const NEIGHBOUR_OFFSETS_8: readonly [number, number][] = [
  [0, -1], [0, 1], [-1, 0], [1, 0],   // cardinal
  [-1, -1], [1, -1], [-1, 1], [1, 1], // diagonal
];

/**
 * 8-directional flood fill from (anchorX, anchorZ), assumed already
 * traversable. Shared by findNearestReachableCell and computeReachableSet so
 * both agree on every fixture. Result is only valid until the next call —
 * callers must either consume it synchronously (findNearestReachableCell) or
 * copy what they need out of it (computeReachableSet).
 */
function floodFillReachable(
  navGrid: NavGrid,
  anchorX: number,
  anchorZ: number,
): { width: number; height: number; count: number } {
  const width = navGrid.width;
  const height = navGrid.height;
  ensureReachabilityScratch(width * height);

  // Clear only what the previous call actually touched, not the whole grid.
  for (let i = 0; i < lastFillCount; i++) visitedArr[queueArr[i]!] = 0;

  let count = 0;
  const startIdx = (anchorZ - navGrid.originZ) * width + (anchorX - navGrid.originX);
  visitedArr[startIdx] = 1;
  queueArr[count++] = startIdx;

  for (let head = 0; head < count; head++) {
    const idx = queueArr[head]!;
    const x = navGrid.originX + (idx % width);
    const z = navGrid.originZ + ((idx / width) | 0);
    for (const [dx, dz] of NEIGHBOUR_OFFSETS_8) {
      const nx = x + dx;
      const nz = z + dz;
      if (!isTraversableCell(navGrid, nx, nz)) continue;
      const neighborIdx = (nz - navGrid.originZ) * width + (nx - navGrid.originX);
      if (visitedArr[neighborIdx]) continue;
      visitedArr[neighborIdx] = 1;
      queueArr[count++] = neighborIdx;
    }
  }

  lastFillCount = count;
  return { width, height, count };
}
