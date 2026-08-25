// BlastSimulator2026 — GameRenderer terrain rebuild/remesh helpers
// Extracted from GameRenderer.ts: full terrain rebuilds, dirty-region remesh,
// the site-bounds-changed check, the landscape mesher's playable-cut shape,
// the landscape edge-height sampler, and the border-wall rebuild.
//
// Every function here takes `deps: TerrainDeps` in place of `this` and
// mutates the fields it changes directly on `deps` (terrainMeshRevision,
// lastCutBounds, borderWall) — the same object the caller built from its own
// fields, so after the call the caller copies `deps`'s fields back onto
// itself. This mirrors the original methods' `this.field = ...` mutations
// one-for-one, just against an explicit object instead of an implicit `this`.

import type { MiningContext } from '../console/commands/mining.js';
import type { LandscapeHandle } from '../console/commands/world.js';
import { ensureLandscape } from '../console/commands/world.js';
import { getBiome } from '../core/world/BiomeCatalog.js';
import { type VoxelGrid, computeVoxelColumnSurfaceY, computeVoxelColumnSurfaceHeight } from '../core/world/VoxelGrid.js';
import type { SceneManager } from './SceneManager.js';
import type { TerrainMesh, DirtyRegion } from './TerrainMesh.js';
import type { LandscapeMesh, PlayableCut } from './terrain/LandscapeMesh.js';
import { WorldBorderWall } from './WorldBorderWall.js';

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
  console.log(`[GameRenderer] rebuildTerrain: lastGrid=${deps.lastGrid?.id}`);
  deps.terrain?.buildAll();
  deps.terrainMeshRevision++;
}

/**
 * Re-mesh only the chunks a terrain:updated region touches (#458 T3.1).
 * The main.ts subscription calls this for every mutation (blast, drill,
 * ramp) instead of rebuildTerrain() — a single-voxel drill dig no longer
 * pays for re-marching chunks its region never touched.
 */
export function remeshTerrainRegion(deps: TerrainDeps, ctx: MiningContext, region: DirtyRegion): void {
  deps.terrain?.remeshRegion(region);
  deps.terrainMeshRevision++;
  if (!siteBoundsChanged(deps, ctx.grid)) return;

  // A claim moves the site's bounding box: the camera leash has to let the
  // player follow the ground they just took, the landscape has to stop
  // covering it, and the wall has to be re-raised on the new frontier.
  deps.refreshPanLeash();

  // A null ctx.landscape means the grid itself was just replaced (new game,
  // campaign level, load) and buildLandscapeMesh is about to run with a
  // fresh handle. Rebuilding here would cut the new site against the old
  // level's landscape and then be thrown away.
  if (!ctx.landscape || !ctx.grid || !deps.landscape || !deps.landscapeHandle) return;

  deps.landscape.build(deps.landscapeHandle, ctx.grid.palette, playableCut(ctx.grid));
  rebuildBorderWall(deps, ctx);
}

/** True when the site's bounding box differs from the one the landscape and wall were built against. */
export function siteBoundsChanged(deps: TerrainDeps, grid: VoxelGrid | null): boolean {
  const key = grid ? `${grid.minX},${grid.minZ},${grid.maxX},${grid.maxZ},${grid.chunkCount}` : '';
  if (key === deps.lastCutBounds) return false;
  deps.lastCutBounds = key;
  return true;
}

/** The site's live shape, for the landscape mesher to cut itself against (#473 D8). */
export function playableCut(grid: VoxelGrid): PlayableCut {
  return {
    rect: { minX: grid.minX, minZ: grid.minZ, maxX: grid.maxX, maxZ: grid.maxZ },
    ownsColumn: (x, z) => grid.containsColumn(x, z),
    // Live surface height, so the landscape's claim-boundary ring matches
    // whatever the playable marching-cubes mesh renders there right now —
    // before or after a blast — instead of the static WorldGen prediction.
    boundaryHeightAt: (x, z) => computeVoxelColumnSurfaceHeight(grid, x, z),
    meshClaimsColumn: (x, z) => grid.claimsColumnForMeshing(x, z),
  };
}

/**
 * The landscape's theoretical height function, ready to hand to
 * TerrainMesh.setEdgeHeightSampler() — or null when no landscape can be
 * built yet (no world/biome). Calls ensureLandscape(), which caches on
 * ctx.landscape, so calling this before buildLandscapeMesh() does not
 * duplicate the (expensive) structure-set build; buildLandscapeMesh()
 * simply gets the same cached handle back (#559).
 */
export function landscapeEdgeHeightSampler(ctx: MiningContext): ((x: number, z: number) => number) | null {
  if (!ctx.state?.world || !ctx.grid) return null;
  const biome = getBiome(ctx.state.mineType);
  if (!biome) return null;
  const { sizeX, sizeY, sizeZ } = ctx.state.world;
  const handle = ensureLandscape(ctx, { seed: ctx.state.seed, climateBias: biome.climateCenter, sizeX, sizeY, sizeZ });
  if (!handle) return null;
  return (x, z) => handle.sampleColumn(x, z).height;
}

/**
 * Raise the containment field on the frontier between claimable ground and
 * the protected structures beside the site (#473 P4). Nothing is drawn when
 * no protected chunk borders the site — open ground gets no wall, which is
 * the whole point of the change.
 */
export function rebuildBorderWall(deps: TerrainDeps, ctx: MiningContext): void {
  if (deps.borderWall) deps.sm.postPipeline.removeOverlayObject(deps.borderWall.object3d);
  deps.borderWall?.dispose();
  deps.borderWall = null;

  const grid = ctx.grid;
  const area = ctx.playableArea;
  if (!grid || !area || !deps.terrain) return;
  // Never trace the world's rivers from a render path just to find out
  // there is no wall to draw — buildLandscapeMesh hands over the set it
  // already built, and calls this again once it has.
  if (!area.hasStructures()) return;

  const frontier = area.protectedFrontier();
  if (frontier.length === 0) return;

  const bounds = deps.terrain.getBounds();
  const groundY = deps.landscapeHandle?.groundLevelY ?? 0;
  deps.borderWall = new WorldBorderWall(deps.sm.scene, {
    protectedRects: frontier.map(f => f.rect),
    siteRect: { minX: grid.minX, minZ: grid.minZ, maxX: grid.maxX, maxZ: grid.maxZ },
    minGroundY: bounds?.minY ?? groundY,
    maxGroundY: bounds?.maxY ?? groundY + 20,
  });
  deps.sm.postPipeline.addOverlayObject(deps.borderWall.object3d);
}

/**
 * Find the highest solid-voxel Y at the given (x, z) column. Returns 0 if no
 * grid. Takes `grid` directly rather than the full `TerrainDeps` — this is
 * the hottest of these helpers (called per building/vehicle/employee/ghost
 * on every sync), so it skips building a throwaway deps object just to read
 * one field.
 */
export function getTerrainSurfaceY(grid: VoxelGrid | null, x: number, z: number): number {
  if (!grid) return 0;
  return computeVoxelColumnSurfaceY(grid, x, z) + 1;
}
