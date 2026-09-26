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
  | { resolved: false };

/** Iteration cap for the convergence loop below, matching the previous window.__worldToScreen behaviour. */
export const TILE_RESOLUTION_MAX_ITERATIONS = 5;

/** Two heights within this many world units are the same guess, for oscillation detection below. */
const OSCILLATION_EPSILON = 1e-6;

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

  for (let i = 0; i < maxIterations; i++) {
    const ndc = project(targetX + 0.5, currentY, targetZ + 0.5);
    const hit = raycastForTile(ndc.x, ndc.y);

    if (hit !== null) {
      if (Math.floor(hit.x) === targetX && Math.floor(hit.z) === targetZ) {
        return { resolved: true, ndc };
      }
      const seenBefore = visitedHeights.some((h) => Math.abs(h - hit.y) < OSCILLATION_EPSILON);
      currentY = seenBefore ? (currentY + hit.y) / 2 : hit.y;
      visitedHeights.push(currentY);
    }
    // A null hit (occlusion/miss) is never accepted as success; retry with the
    // same height in case a later projection clears the occlusion.
  }

  return { resolved: false };
}
