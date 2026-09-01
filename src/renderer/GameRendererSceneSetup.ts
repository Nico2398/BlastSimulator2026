// BlastSimulator2026 — GameRenderer scene setup/teardown
// Extracted from GameRenderer.ts: the staged level-load pipeline
// (buildPlayableMesh / buildLandscapeMesh / buildAmbient, #474), camera
// framing/pan-leash, and full scene teardown.
//
// Every function here takes `deps: SceneSetupDeps` in place of `this` and
// mutates the fields it changes directly on `deps` — the same object the
// caller built from its own fields — so after the call the caller copies
// `deps`'s fields back onto itself. This mirrors the original methods'
// `this.field = ...` mutations one-for-one, just against an explicit object
// instead of an implicit `this`.

import type { MiningContext } from '../console/commands/mining.js';
import { ensureLandscape, type LandscapeHandle } from '../console/commands/world.js';
import { getBiome } from '../core/world/BiomeCatalog.js';
import type { VoxelGrid } from '../core/world/VoxelGrid.js';
import { BIOME_GRADES, NEUTRAL_GRADE } from './post/AerialPerspectivePass.js';
import type { SceneManager } from './SceneManager.js';
import { TerrainMesh } from './TerrainMesh.js';
import { BuildingMesh } from './BuildingMesh.js';
import { VehicleMesh } from './VehicleMesh.js';
import { CharacterMesh } from './CharacterMesh.js';
import { TaskProgressBar } from './TaskProgressBar.js';
import { SkyboxWeather } from './SkyboxWeather.js';
import { WindState } from './ambient/WindState.js';
import { CloudLayer } from './ambient/CloudLayer.js';
import { BirdFlocks } from './ambient/BirdFlocks.js';
import { ChimneySmoke } from './ambient/ChimneySmoke.js';
import { WaterSurface } from './ambient/WaterSurface.js';
import { VegetationSway } from './ambient/VegetationSway.js';
import { DustDevils } from './ambient/DustDevils.js';
import { Fireflies } from './ambient/Fireflies.js';
import type { AmbientUniforms } from './ambient/AmbientUniforms.js';
import { FragmentMesh } from './FragmentMesh.js';
import { FragmentAnimator } from './FragmentAnimator.js';
import { BlastEffects } from './BlastEffects.js';
import { LandscapeMesh, type PlayableCut } from './terrain/LandscapeMesh.js';
import type { WorldBorderWall } from './WorldBorderWall.js';
import { BlastPlanOverlay } from './BlastPlanOverlay.js';
import { GhostMesh } from './GhostMesh.js';
import { buildingCenterSurfaceY } from './EntitySync.js';

/**
 * How far past the playable rect manual panning may wander (#458 T6.1/D13).
 * Copied verbatim from GameRenderer.ts — data, not logic.
 */
export const PAN_LEASH_MARGIN = 80;

/** Per-biome ambient extras (#458 T7.3). Copied verbatim from GameRenderer.ts. */
export const DUST_DEVIL_BIOMES: ReadonlySet<string> = new Set(['desert_badlands', 'red_canyon']);
export const FIREFLY_BIOMES: ReadonlySet<string> = new Set(['tropical_karst']);

/**
 * Mutable GameRenderer fields the scene-setup/teardown functions read/write,
 * passed in place of `this` (#767). The four cross-module callbacks defer to
 * GameRendererTerrain.ts, threaded through rather than imported directly to
 * avoid a cross-module import cycle (buildLandscapeMesh/buildPlayableMesh
 * need them; remeshTerrainRegion in the terrain module calls back into
 * refreshPanLeash here).
 */
export interface SceneSetupDeps {
  sm: SceneManager;
  terrain: TerrainMesh | null;
  buildings: BuildingMesh | null;
  vehicles: VehicleMesh | null;
  characters: CharacterMesh | null;
  taskProgress: TaskProgressBar | null;
  skybox: SkyboxWeather | null;
  windState: WindState | null;
  clouds: CloudLayer | null;
  birds: BirdFlocks | null;
  smoke: ChimneySmoke | null;
  water: WaterSurface | null;
  vegetation: VegetationSway | null;
  dustDevils: DustDevils | null;
  fireflies: Fireflies | null;
  readonly ambientUniforms: AmbientUniforms;
  fragments: FragmentMesh | null;
  fragmentAnimator: FragmentAnimator | null;
  blastEffects: BlastEffects | null;
  landscape: LandscapeMesh | null;
  landscapeHandle: LandscapeHandle | null;
  borderWall: WorldBorderWall | null;
  blastOverlay: BlastPlanOverlay | null;
  ghosts: GhostMesh | null;
  lastGrid: VoxelGrid | null;
  lastCutBounds: string;
  terrainMeshRevision: number;
  lastGhostRevision: number;
  lastSyncedTerrainRevision: number;
  renderedBuildingIds: Set<number>;
  renderedVehicleIds: Set<number>;
  renderedEmployeeIds: Set<number>;
  getTerrainSurfaceY: (x: number, z: number) => number;
  landscapeEdgeHeightSampler: (ctx: MiningContext) => ((x: number, z: number) => number) | null;
  playableCut: (grid: VoxelGrid, edgeHeight?: (x: number, z: number) => number) => PlayableCut;
  rebuildBorderWall: (ctx: MiningContext) => void;
  siteBoundsChanged: (grid: VoxelGrid | null) => boolean;
}

/** Whole-scene rebuild on a new game/level (#474: runs all three load stages, then frames the camera). */
export function loadGame(deps: SceneSetupDeps, ctx: MiningContext): void {
  buildPlayableMesh(deps, ctx);
  buildLandscapeMesh(deps, ctx);
  buildAmbient(deps, ctx);
  frameCameraOnGrid(deps);
}

/**
 * Stage 1 of a level load (#474): clear the scene and rebuild everything
 * except the landscape zone and its ambient dressing — the playable
 * terrain mesh (marching cubes over the grid the player actually mines),
 * buildings, vehicles, characters, sky, wind/clouds, fragments, blast
 * effects and overlays. Public so the loading screen can pace this as its
 * own weighted phase (`enterLevel` in main.ts); `loadGame()` also calls it
 * directly for callers that still want the whole load in one shot (tests,
 * the debug-preview path that never drives the loading screen at all).
 */
export function buildPlayableMesh(deps: SceneSetupDeps, ctx: MiningContext): void {
  const state = ctx.state!;
  const grid = ctx.grid!;
  clearAll(deps);

  const { scene, sunLight, ambient, fill, csm } = deps.sm;

  // Terrain mesh (marching cubes)
  deps.terrain = new TerrainMesh(scene, grid, ctx.state?.mineType);
  // Wire the landscape's theoretical height into the edge-normal sampler
  // BEFORE the first buildAll(), so the initial mesh already carries the
  // boundary-normal fix instead of needing a later remesh to pick it up
  // (#559).
  deps.terrain.setEdgeHeightSampler(deps.landscapeEdgeHeightSampler(ctx));
  deps.terrain.buildAll();
  deps.terrainMeshRevision++;
  deps.terrain.sharedMaterial.attachCSM(csm);

  // Bind the grid before sampling terrain height below — buildings, vehicles,
  // and characters loaded from a save (not just a fresh new_game) need
  // getTerrainSurfaceY() to see this grid, not the previous one (#408).
  deps.lastGrid = grid;

  // Buildings
  deps.buildings = new BuildingMesh(scene);
  for (const b of state.buildings.buildings) {
    const surfaceY = buildingCenterSurfaceY(b, deps.getTerrainSurfaceY);
    deps.buildings.addBuilding(b, surfaceY);
  }

  // Vehicles
  deps.vehicles = new VehicleMesh(scene);
  for (const v of state.vehicles.vehicles) {
    const surfaceY = deps.getTerrainSurfaceY(v.x, v.z);
    deps.vehicles.addVehicle(v, surfaceY);
  }

  // Characters (placed at terrain surface height, not y=0)
  deps.characters = new CharacterMesh(scene);
  for (const e of state.employees.employees) {
    const surfaceY = deps.getTerrainSurfaceY(e.x, e.z);
    deps.characters.addEmployee(e, surfaceY);
  }

  // Task progress bars — billboarded above working employees (#546)
  deps.taskProgress = new TaskProgressBar(scene, deps.sm.camera);

  // Weather sky
  deps.skybox = new SkyboxWeather(scene, sunLight, ambient, fill);

  // Wind + clouds (#458 T7.1/D12): one WindState per level, seeded so every
  // ambient module (clouds now, birds/smoke/water/sway in T7.2) leans the
  // same way. Cloud disc centres on the playable rect, same point
  // frameCameraOnGrid() frames the camera on.
  deps.windState = new WindState(state.seed);
  deps.clouds = new CloudLayer(scene, state.seed, grid.minX + grid.sizeX / 2, grid.minZ + grid.sizeZ / 2);

  // Fragments (empty until blast runs) — shares terrain's material so a
  // fresh cut face matches the rock it broke off from (#458 T4.1/D9).
  deps.fragments = new FragmentMesh(scene, deps.terrain.sharedMaterial);
  deps.fragmentAnimator = new FragmentAnimator(deps.fragments);

  // Blast effects
  deps.blastEffects = new BlastEffects(scene, deps.sm.camera);

  // Blast plan overlay (hidden until shown)
  deps.blastOverlay = new BlastPlanOverlay(scene);

  // Ghost previews (initially empty)
  deps.ghosts = new GhostMesh(scene);
}

/**
 * Stage 2 of a level load (#474): the landscape zone — its coarse map
 * (built lazily by ensureLandscape(), cached on ctx.landscape so this is a
 * cache hit if a caller already forced it, e.g. main.ts's own "landscape
 * map" phase or buildPlayableMesh()'s edge-height sampler above), the
 * marching-cubes mesh past the playable rect, aerial-perspective
 * calibration, and the border wall. Split from buildAmbient() below
 * because it costs meaningfully more (a full landscape mesh vs. a handful
 * of particle systems) and the loading screen weights the two
 * differently. Command-mode scenarios never construct a GameRenderer at
 * all, so this cost never lands on the fast, frequently-run scenario
 * suite; only the browser game and interaction-mode/visual harnesses pay
 * it.
 */
export function buildLandscapeMesh(deps: SceneSetupDeps, ctx: MiningContext): void {
  if (!deps.terrain || !ctx.state?.world || !ctx.grid) return;
  const biome = getBiome(ctx.state.mineType);
  if (!biome) return;

  const { sizeX, sizeY, sizeZ } = ctx.state.world;
  const handle = ensureLandscape(ctx, { seed: ctx.state.seed, climateBias: biome.climateCenter, sizeX, sizeY, sizeZ });
  if (!handle) return;

  if (!deps.landscape) {
    deps.landscape = new LandscapeMesh(deps.sm.scene, deps.terrain.sharedMaterial);
  }
  deps.landscapeHandle = handle;
  // Idempotent re-apply: a campaign level swap rebuilds the grid (and
  // re-marches terrain) before landscape geometry catches up, so the
  // sampler installed at loadGame() time can go stale — re-set it here
  // whenever landscape geometry changes (#559).
  deps.terrain.setEdgeHeightSampler((x, z) => handle.sampleColumn(x, z).height);
  // The landscape's StructureSet already carries every river, village and
  // landmark for this seed — hand it to the claim path rather than have it
  // trace them all a second time (#473 D6).
  ctx.playableArea?.adoptStructures(handle.structureSet);
  deps.landscape.build(handle, ctx.grid.palette, deps.playableCut(ctx.grid, (x, z) => handle.sampleColumn(x, z).height));
  // Record what we just cut against, so the next terrain:updated only
  // rebuilds when the site has actually moved since this build.
  deps.siteBoundsChanged(ctx.grid);

  // Aerial perspective's haze thickness and per-biome grade — set once per
  // level load, not per frame (#458 T5.2/A21).
  const { aerial } = deps.sm.postPipeline;
  aerial.setHeightRef(handle.groundLevelY);
  aerial.setGrade(BIOME_GRADES[biome.id] ?? NEUTRAL_GRADE);

  // The "not here" marker: the frontier between claimable ground and the
  // generated structures a claim can never take (#473 D6/P4). Sized from
  // the terrain's own height range so it stands on the ground rather than
  // floating or being buried.
  deps.rebuildBorderWall(ctx);
}

/**
 * Dispose the 6 per-biome/per-level ambient modules, shared by buildAmbient()
 * (which immediately rebuilds all 6 afterward) and clearAll() (which nulls
 * them afterward) — both need the same stale-instance teardown so meshes from
 * the previous grid don't pile up in the scene. Pre-existing duplication in
 * the original monolith, extracted here (#767 refactor pass).
 */
function disposeAmbientModules(deps: Pick<SceneSetupDeps, 'birds' | 'smoke' | 'water' | 'vegetation' | 'dustDevils' | 'fireflies'>): void {
  deps.birds?.dispose();
  deps.smoke?.dispose();
  deps.water?.dispose();
  deps.vegetation?.dispose();
  deps.dustDevils?.dispose();
  deps.fireflies?.dispose();
}

/**
 * Stage 3 of a level load (#474): birds, chimney smoke, water, vegetation
 * sway, and the per-biome dust-devil/firefly extras — rebuilt from the
 * landscape's own StructureSet every time this runs (a campaign level swap
 * can call this again for the same GameRenderer, so stale instances from
 * the previous grid must go first or their meshes pile up in the scene).
 * Requires buildLandscapeMesh() to have already cached ctx.landscape this
 * load — the cheapest of the three staged rebuilds, so it carries the
 * loading screen's lightest weight.
 */
export function buildAmbient(deps: SceneSetupDeps, ctx: MiningContext): void {
  if (!ctx.state?.world || !ctx.grid || !ctx.landscape) return;
  const biome = getBiome(ctx.state.mineType);
  if (!biome) return;
  const handle = ctx.landscape;

  disposeAmbientModules(deps);
  const centerX = ctx.grid.minX + ctx.grid.sizeX / 2;
  const centerZ = ctx.grid.minZ + ctx.grid.sizeZ / 2;
  const sampleHeight = (x: number, z: number) => handle.sampleColumn(x, z).height;
  deps.birds = new BirdFlocks(deps.sm.scene, ctx.state.seed, centerX, centerZ);
  deps.smoke = new ChimneySmoke(deps.sm.scene, ctx.state.seed, handle.structureSet.villages);
  deps.water = new WaterSurface(deps.sm.scene, biome.id, handle.structureSet.rivers, handle.structureSet.landmarks);
  deps.vegetation = new VegetationSway(
    deps.sm.scene, ctx.state.seed, deps.ambientUniforms, handle.structureSet.trees,
    centerX, centerZ, handle.playableRect, sampleHeight,
  );
  // Per-biome ambient extras (#458 T7.3) — only the module matching this
  // level's biome gets built; the other stays null.
  deps.dustDevils = DUST_DEVIL_BIOMES.has(biome.id)
    ? new DustDevils(deps.sm.scene, ctx.state.seed, centerX, centerZ, sampleHeight)
    : null;
  deps.fireflies = FIREFLY_BIOMES.has(biome.id)
    ? new Fireflies(deps.sm.scene, ctx.state.seed, centerX, centerZ, sampleHeight)
    : null;
}

/**
 * Centre the camera on the loaded grid and pull back far enough to show all
 * of it. Aimed at the surface rather than y=0 so the benches sit mid-frame.
 */
export function frameCameraOnGrid(deps: SceneSetupDeps): void {
  const grid = deps.lastGrid;
  if (!grid) return;
  const cx = grid.minX + grid.sizeX / 2;
  const cz = grid.minZ + grid.sizeZ / 2;
  const span = Math.max(grid.sizeX, grid.sizeZ);
  deps.sm.cameraController.frameSite(cx, deps.getTerrainSurfaceY(cx, cz), cz, span);
  // Manual panning may wander past the pit rim to glance at nearby
  // landscape, but not indefinitely — the landscape is viewable, not the
  // play focus (#458 T6.1/D13).
  refreshPanLeash(deps);
}

/**
 * Re-leash the camera to the landscape's fixed generation extent (#558) —
 * NOT the site's live bounding box, which only grows as the player claims
 * chunks and would otherwise leash the player to ground already claimed
 * instead of the ground actually rendered. Centred on the level's ORIGINAL
 * playable rect, exactly like `buildLandscapeMap` centres its tiles, so the
 * leash stays fixed for the whole level. Cheap; safe to call every remesh.
 */
export function refreshPanLeash(deps: SceneSetupDeps): void {
  const handle = deps.landscapeHandle;
  if (!handle) return;
  const rect = handle.playableRect;
  const centerX = (rect.minX + rect.maxX) / 2;
  const centerZ = (rect.minZ + rect.maxZ) / 2;
  const half = handle.map.extentHalf;
  deps.sm.cameraController.setPanLeash(
    { minX: centerX - half, minZ: centerZ - half, maxX: centerX + half, maxZ: centerZ + half },
    PAN_LEASH_MARGIN,
  );
}

/** Dispose every scene object and reset load/sync bookkeeping fields. */
export function clearAll(deps: SceneSetupDeps): void {
  deps.terrain?.dispose();
  deps.buildings?.clearAll();
  deps.vehicles?.clearAll();
  deps.characters?.clearAll();
  deps.skybox?.dispose();
  deps.clouds?.dispose();
  if (deps.borderWall) deps.sm.postPipeline.removeOverlayObject(deps.borderWall.object3d);
  deps.borderWall?.dispose();
  disposeAmbientModules(deps);
  deps.fragments?.dispose();
  deps.blastEffects?.dispose();
  deps.landscape?.dispose();
  deps.blastOverlay?.dispose();
  deps.ghosts?.dispose();
  deps.taskProgress?.dispose();

  deps.terrain = null;
  deps.landscapeHandle = null;
  deps.lastCutBounds = '';
  // Force one resync on the next syncEntities() call after a fresh load —
  // the reset game state's ghostPreviewsRevision restarts at 0, which would
  // otherwise equal a stale lastGhostRevision left over from the previous
  // level (#761).
  deps.lastGhostRevision = -1;
  deps.lastSyncedTerrainRevision = -1;
  deps.buildings = null;
  deps.vehicles = null;
  deps.characters = null;
  deps.skybox = null;
  deps.borderWall = null;
  deps.windState = null;
  deps.clouds = null;
  deps.birds = null;
  deps.smoke = null;
  deps.water = null;
  deps.vegetation = null;
  deps.dustDevils = null;
  deps.fireflies = null;
  deps.fragments = null;
  deps.blastEffects = null;
  deps.landscape = null;
  deps.blastOverlay = null;
  deps.ghosts = null;
  deps.taskProgress = null;
  deps.lastGrid = null;

  deps.renderedBuildingIds.clear();
  deps.renderedVehicleIds.clear();
  deps.renderedEmployeeIds.clear();
}
