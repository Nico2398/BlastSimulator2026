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

/**
 * Finds an NDC point that projects near (targetX, startY, targetZ) and whose
 * `raycastForTile` pick resolves back to that same (targetX, targetZ) tile —
 * unlike the old convergence loop, which accepted the NDC candidate closest
 * to the tile centre without checking it actually picks that tile.
 */
export function resolveScreenPointForTile(
  _project: ProjectToNDC,
  _raycastForTile: RaycastForTile,
  _targetX: number,
  _targetZ: number,
  _startY: number,
  _maxIterations: number = TILE_RESOLUTION_MAX_ITERATIONS,
): ScreenTileResolution {
  // TODO: implement
  throw new Error('not implemented');
}
