// BlastSimulator2026 — GameRenderer terrain rebuild/remesh helpers (skeleton, #767)
// Extracted from GameRenderer.ts: full terrain rebuilds, dirty-region remesh,
// the site-bounds-changed check, the landscape mesher's playable-cut shape,
// the landscape edge-height sampler, and the border-wall rebuild.
//
// Skeleton phase only: signatures/types are final, bodies are stubs.
// Real logic moves here at implementation phase (#767).

import type { MiningContext } from '../console/commands/mining.js';
import type { LandscapeHandle } from '../console/commands/world.js';
import type { VoxelGrid } from '../core/world/VoxelGrid.js';
import type { SceneManager } from './SceneManager.js';
import type { TerrainMesh, DirtyRegion } from './TerrainMesh.js';
import type { LandscapeMesh, PlayableCut } from './terrain/LandscapeMesh.js';
import type { WorldBorderWall } from './WorldBorderWall.js';

/**
 * Mutable GameRenderer fields these terrain helpers read/write, passed in
 * place of `this` (#767). `refreshPanLeash` is threaded through as a
 * callback (rather than importing GameRendererSceneSetup directly) to avoid
 * a cross-module import cycle — remeshTerrainRegion calls it, but it lives
 * in GameRendererSceneSetup.ts.
 */
export interface TerrainDeps {
  terrain: TerrainMesh | null;
  lastGrid: VoxelGrid | null;
  terrainMeshRevision: number;
  lastCutBounds: string;
  landscape: LandscapeMesh | null;
  landscapeHandle: LandscapeHandle | null;
  borderWall: WorldBorderWall | null;
  sm: SceneManager;
  refreshPanLeash: () => void;
}

/** Force a full terrain rebuild — grid identity changes only (new_game, campaign start, load). */
export function rebuildTerrain(deps: TerrainDeps): void {
  void deps;
  // TODO: implement (#767)
  throw new Error('not implemented — see #767');
}

/** Re-mesh only the chunks a terrain:updated region touches (#458 T3.1). */
export function remeshTerrainRegion(deps: TerrainDeps, ctx: MiningContext, region: DirtyRegion): void {
  void deps;
  void ctx;
  void region;
  // TODO: implement (#767)
  throw new Error('not implemented — see #767');
}

/** True when the site's bounding box differs from the one the landscape and wall were built against. */
export function siteBoundsChanged(deps: TerrainDeps, grid: VoxelGrid | null): boolean {
  void deps;
  void grid;
  // TODO: implement (#767)
  return false;
}

/** The site's live shape, for the landscape mesher to cut itself against (#473 D8). */
export function playableCut(grid: VoxelGrid): PlayableCut {
  void grid;
  // TODO: implement (#767)
  throw new Error('not implemented — see #767');
}

/**
 * The landscape's theoretical height function, ready to hand to
 * TerrainMesh.setEdgeHeightSampler() — or null when no landscape can be
 * built yet (no world/biome).
 */
export function landscapeEdgeHeightSampler(ctx: MiningContext): ((x: number, z: number) => number) | null {
  void ctx;
  // TODO: implement (#767)
  return null;
}

/**
 * Raise the containment field on the frontier between claimable ground and
 * the protected structures beside the site (#473 P4).
 */
export function rebuildBorderWall(deps: TerrainDeps, ctx: MiningContext): void {
  void deps;
  void ctx;
  // TODO: implement (#767)
  throw new Error('not implemented — see #767');
}

/** Find the highest solid-voxel Y at the given (x, z) column. Returns 0 if no grid. */
export function getTerrainSurfaceY(deps: TerrainDeps, x: number, z: number): number {
  void deps;
  void x;
  void z;
  // TODO: implement (#767)
  return 0;
}
