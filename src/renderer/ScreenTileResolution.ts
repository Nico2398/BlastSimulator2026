// BlastSimulator2026 — Screen-point-for-tile resolver (#1227)
// Pure, framework-agnostic counterpart to the real-pointer picking path:
// given a target world tile (targetX, targetZ) and an NDC projector, finds
// an NDC point whose combined entity+terrain raycast (raycastForTile) picks
// that same tile back — instead of window.__worldToScreen's old
// closest-to-centre heuristic, which never verified the round trip. Consumed
// by src/main.ts's dragTiles/pickTile interaction actions and by
// tests/unit/renderer/ScreenTileResolution.test.ts. No Three.js/DOM
// dependency: callers inject projection and raycasting as plain functions.

/** Projects a world-space point to NDC (x, y in [-1, 1], z = raycast depth). */
export type ProjectToNDC = (x: number, y: number, z: number) => { x: number; y: number; z: number };

/**
 * Combined entity+terrain raycast from an NDC point, mirroring what a real
 * pointer click resolves via ScenePicking/PlacementController — the same
 * pick a dragTiles/pickTile action must reproduce. Returns the world point
 * hit, or null on a miss or an occluding entity.
 */
export type RaycastForTile = (ndcX: number, ndcY: number) => { x: number; y: number; z: number } | null;

/** Outcome of resolving a world tile to a screen (NDC) point. */
export type ScreenTileResolution =
  | { resolved: true; ndc: { x: number; y: number; z: number } }
  | { resolved: false; reason?: 'grazing-angle-cycle' };

/**
 * Iteration cap for the convergence loop below. A period-3 grazing-angle
 * cycle spends its first 3 iterations just closing the cycle before any
 * damping can begin, so the old budget of 5 left at most 2 damping attempts;
 * 8 leaves up to 5, enough for the shrinking relaxation in dampedHeight to
 * converge when the geometry allows it.
 */
export const TILE_RESOLUTION_MAX_ITERATIONS = 8;

/**
 * Two heights within this many world units are the same guess, for oscillation
 * detection below. A real raycast repeat never lands back at machine precision —
 * mesh interpolation and floating-point noise put "the same" height a few
 * tenths of a unit off its earlier visit — so the tolerance has to be wide
 * enough to catch that noise. It still stays well under one voxel level
 * (`BUILDING_PLACEMENT_MAX_HEIGHT_SPREAD = 1` in src/core/config/balance.ts),
 * so it never mistakes two genuinely different terrain levels for a repeat.
 */
const OSCILLATION_EPSILON = 0.25;

/**
 * Minimum number of distinct heights between two visits to the same height
 * for a repeat to be classified as a grazing-angle cycle (period-3+) rather
 * than the ordinary period-2 bench-edge oscillation.
 */
const GRAZING_CYCLE_MIN_SPAN = 3;

/**
 * Blends a repeated height guess toward the new raycast hit, damped by how
 * many times this height has already repeated — replaces the fixed 50/50
 * blend for cycles the plain average cannot break. The first repeat still
 * gets the flat 50/50 blend (unchanged from before, correct for period-2
 * cycles); each subsequent repeat applies a shrinking correction so a
 * longer cycle relaxes toward the hit instead of ping-ponging forever.
 */
export function dampedHeight(currentY: number, hitY: number, repeatCount: number): number {
  if (repeatCount <= 1) {
    return (currentY + hitY) / 2;
  }
  return currentY + (hitY - currentY) / (repeatCount + 1);
}

/**
 * Classifies why the convergence loop in resolveScreenPointForTile exhausted
 * its iterations without resolving, from the span between a height's first
 * appearance and its first repeat. A span of 3 or more distinct heights
 * before the first repeat is the signature of a period-3+ cycle, which only
 * arises from a grazing camera-to-tile viewing angle.
 */
export function classifyUnresolvedReason(cycleSpanAtFirstRepeat: number | null): 'grazing-angle-cycle' | undefined {
  if (cycleSpanAtFirstRepeat !== null && cycleSpanAtFirstRepeat >= GRAZING_CYCLE_MIN_SPAN) {
    return 'grazing-angle-cycle';
  }
  return undefined;
}

/**
 * Finds an NDC point that projects near (targetX, startY, targetZ) and whose
 * `raycastForTile` pick resolves back to that same (targetX, targetZ) tile —
 * unlike the old convergence loop, which accepted the NDC candidate closest
 * to the tile centre without checking it actually picks that tile.
 */
export function resolveScreenPointForTile(
  project: ProjectToNDC,
  raycastForTile: RaycastForTile,
  targetX: number,
  targetZ: number,
  startY: number,
  maxIterations: number = TILE_RESOLUTION_MAX_ITERATIONS,
): ScreenTileResolution {
  let currentY = startY;
  // A stepped/terraced surface (a bench edge, a pit wall) can make direct
  // height replacement ping-pong forever between two guesses — each one's
  // raycast reports back the other's height, so the loop revisits the same
  // two points and never spends an iteration on the ground between them.
  // Tracking every height this loop has already tried and damping (instead
  // of jumping straight back) the moment one repeats breaks that cycle,
  // without changing behaviour for the common case where each guess is new.
  const visitedHeights: number[] = [startY];
  let repeatCount = 0;
  let cycleSpanAtFirstRepeat: number | null = null;

  for (let i = 0; i < maxIterations; i++) {
    const ndc = project(targetX + 0.5, currentY, targetZ + 0.5);
    const hit = raycastForTile(ndc.x, ndc.y);

    if (hit !== null) {
      if (Math.floor(hit.x) === targetX && Math.floor(hit.z) === targetZ) {
        return { resolved: true, ndc };
      }
      const seenBefore = visitedHeights.some((h) => Math.abs(h - hit.y) < OSCILLATION_EPSILON);
      if (seenBefore) {
        repeatCount++;
        if (cycleSpanAtFirstRepeat === null) {
          cycleSpanAtFirstRepeat = visitedHeights.length;
        }
        currentY = dampedHeight(currentY, hit.y, repeatCount);
      } else {
        currentY = hit.y;
      }
      visitedHeights.push(currentY);
    }
    // A null hit (occlusion/miss) is never accepted as success; retry with the
    // same height in case a later projection clears the occlusion.
  }

  const reason = classifyUnresolvedReason(cycleSpanAtFirstRepeat);
  return reason === undefined ? { resolved: false } : { resolved: false, reason };
}
