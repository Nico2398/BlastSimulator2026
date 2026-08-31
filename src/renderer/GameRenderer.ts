// BlastSimulator2026 — Game Renderer
// Bridges MiningContext (game state) to all Three.js sub-renderers.
// Call syncFromContext() after each console command; update() each frame.
//
// Split (#767) into GameRendererSync/Terrain/SceneSetup/BlastVisuals/Picking —
// this file keeps every field, every public method's exact signature, and
// update() (genuinely cross-cutting, touches nearly every sub-renderer each
// frame). Every extracted method becomes a thin wrapper: build a `*Deps`
// object from `this`, call the pure function, write whatever it mutated back
// onto `this`.

import * as THREE from 'three';
import type { MiningContext } from '../console/commands/mining.js';
import type { LandscapeHandle } from '../console/commands/world.js';
import type { GameState } from '../core/state/GameState.js';
import type { VoxelGrid } from '../core/world/VoxelGrid.js';
import type { WeatherState } from '../core/weather/WeatherCycle.js';
import type { SceneManager } from './SceneManager.js';
import type { TerrainMesh, DirtyRegion } from './TerrainMesh.js';
import type { BuildingMesh } from './BuildingMesh.js';
import type { VehicleMesh } from './VehicleMesh.js';
import type { CharacterMesh } from './CharacterMesh.js';
import type { SkyboxWeather } from './SkyboxWeather.js';
import type { WindState } from './ambient/WindState.js';
import type { CloudLayer } from './ambient/CloudLayer.js';
import type { BirdFlocks } from './ambient/BirdFlocks.js';
import type { ChimneySmoke } from './ambient/ChimneySmoke.js';
import type { WaterSurface } from './ambient/WaterSurface.js';
import type { VegetationSway } from './ambient/VegetationSway.js';
import type { DustDevils } from './ambient/DustDevils.js';
import type { Fireflies } from './ambient/Fireflies.js';
import { createAmbientUniforms, type AmbientUniforms } from './ambient/AmbientUniforms.js';
import type { FragmentMesh } from './FragmentMesh.js';
import type { BlastEffects } from './BlastEffects.js';
import type { FragmentAnimator } from './FragmentAnimator.js';
import type { LandscapeMesh } from './terrain/LandscapeMesh.js';
import type { WorldBorderWall } from './WorldBorderWall.js';
import type { BlastPlanOverlay } from './BlastPlanOverlay.js';
import type { GhostMesh } from './GhostMesh.js';
import type { TaskProgressBar } from './TaskProgressBar.js';
import type { SurveyConfidenceOverlayOptions } from './SurveyConfidenceOverlay.js';

import { syncGameRendererEntities, syncSurveyOverlay, buildSurveyOverlayOptions } from './GameRendererSync.js';
import {
  rebuildTerrain, remeshTerrainRegion, siteBoundsChanged, playableCut,
  landscapeEdgeHeightSampler, rebuildBorderWall, getTerrainSurfaceY,
  type TerrainDeps,
} from './GameRendererTerrain.js';
import {
  loadGame, buildPlayableMesh, buildLandscapeMesh, buildAmbient,
  frameCameraOnGrid, refreshPanLeash, clearAll,
  type SceneSetupDeps,
} from './GameRendererSceneSetup.js';
import { onBlast, showBlastPlanOverlay, notifyBlastScatter, type BlastVisualsDeps } from './GameRendererBlastVisuals.js';
import {
  raycastSurfaceY, raycastTerrainFromNDC, surfaceYAt, pickables,
  resolveFragmentId, entityWorldPosition, type PickingDeps,
} from './GameRendererPicking.js';

export class GameRenderer {
  private readonly sm: SceneManager;

  public terrain: TerrainMesh | null = null;
  private buildings: BuildingMesh | null = null;
  private vehicles: VehicleMesh | null = null;
  private characters: CharacterMesh | null = null;
  private skybox: SkyboxWeather | null = null;
  private windState: WindState | null = null;
  private clouds: CloudLayer | null = null;
  private birds: BirdFlocks | null = null;
  private smoke: ChimneySmoke | null = null;
  private water: WaterSurface | null = null;
  private vegetation: VegetationSway | null = null;
  private dustDevils: DustDevils | null = null;
  private fireflies: Fireflies | null = null;
  /** Shared {uTime, uWind} object every ambient shader material references (#458 T7.2/A26) — level-independent, created once. */
  private readonly ambientUniforms: AmbientUniforms = createAmbientUniforms();
  private fragments: FragmentMesh | null = null;
  private fragmentAnimator: FragmentAnimator | null = null;
  private blastEffects: BlastEffects | null = null;
  /** Public (like `terrain`) so aiming/raycasting can fall back to landscape meshes past the site's claimed edge (#558). */
  public landscape: LandscapeMesh | null = null;
  /** Kept so a claim can re-cut the landscape without rebuilding the (expensive) landscape map. */
  private landscapeHandle: LandscapeHandle | null = null;
  private borderWall: WorldBorderWall | null = null;
  /** Site bounding box the landscape and border wall were last built against, so a claim can be detected. */
  private lastCutBounds = '';
  private blastOverlay: BlastPlanOverlay | null = null;
  private ghosts: GhostMesh | null = null;
  private taskProgress: TaskProgressBar | null = null;
  private lastGrid: VoxelGrid | null = null;
  /** Last ghostPreviewsRevision synced — syncEntities() skips ghost-mesh resync when unchanged (#761). */
  private lastGhostRevision = -1;
  /** Bumped whenever the terrain mesh actually changes (remesh or full rebuild) — syncEntities() gates its ghost resync on it too, since a terrain change can move the surface Y a ghost preview snaps to (#761). */
  private terrainMeshRevision = 0;
  private lastSyncedTerrainRevision = -1;

  /** Seed of the currently loaded game — used to detect new_game calls. */
  private loadedSeed: number | null = null;
  private lastState: GameState | null = null;
  /** Current weather, mirrored from syncFromContext() so update()'s per-frame WindState tick has it without re-reading MiningContext. */
  private lastWeather: WeatherState = 'sunny';

  /**
   * Player-facing visibility preference for the survey confidence overlay
   * (#496) — a view-only toggle, not simulation state. Defaults to visible
   * so existing behaviour (overlay shown whenever a survey exists) is
   * unchanged until the player hides it.
   */
  private surveyOverlayPreference = true;

  // Track rendered entity IDs to detect additions
  private renderedBuildingIds = new Set<number>();
  private renderedVehicleIds = new Set<number>();
  private renderedEmployeeIds = new Set<number>();

  constructor(sceneManager: SceneManager) {
    this.sm = sceneManager;
  }

  /** ID of the currently-bound VoxelGrid, for diagnostics. Null if no grid is loaded. */
  get lastGridId(): number | null {
    return this.lastGrid?.id ?? null;
  }

  /** ghostPreviewsRevision last synced by syncEntities(), for diagnostics (#761). -1 before the first sync. */
  get lastGhostRevisionSynced(): number {
    return this.lastGhostRevision;
  }

  /** Current terrain-mesh revision, bumped by remeshTerrainRegion() etc, for diagnostics (#761). */
  get terrainMeshRevisionCount(): number {
    return this.terrainMeshRevision;
  }

  /** terrainMeshRevision last synced by syncEntities(), for diagnostics (#761). -1 before the first sync. */
  get lastTerrainRevisionSynced(): number {
    return this.lastSyncedTerrainRevision;
  }

  /** Number of task-progress bars currently rendered — for diagnostics. */
  get taskProgressBarCount(): number {
    return this.taskProgress?.count ?? 0;
  }

  /** Number of ghost-preview meshes currently rendered — for diagnostics. */
  get ghostCount(): number {
    return this.ghosts?.count ?? 0;
  }

  /**
   * Sync rendered scene from the current MiningContext.
   * Call after every console command.
   */
  syncFromContext(ctx: MiningContext): void {
    if (!ctx.state || !ctx.grid) return;

    // New game (or first load) — rebuild everything
    if (this.loadedSeed !== ctx.state.seed) {
      this.loadGame(ctx);
      this.loadedSeed = ctx.state.seed;
    }

    // Grid reference may have changed (e.g. campaign start generates a new grid
    // while keeping the same seed). Detect and rebind if so.
    if (this.lastGrid !== ctx.grid) {
      console.log(`[GameRenderer] syncFromContext: grid changed! old=${this.lastGrid?.id} new=${ctx.grid.id}`);
      this.lastGrid = ctx.grid;
      // TerrainMesh holds a grid reference — rebind it so it reads from the new grid
      this.terrain?.setGrid(ctx.grid);
      this.terrain?.buildAll();
      this.terrainMeshRevision++;
      // A differently-sized grid needs a fresh landscape too — same rebuild
      // loadGame() does, but this branch fires even when loadGame() didn't
      // (campaign level swaps grid size while keeping the seed, #458 T3.2).
      this.buildLandscapeMesh(ctx);
      this.buildAmbient(ctx);
      // A campaign level can swap in a differently-sized grid while keeping the
      // seed, so loadGame() never runs. Re-frame or the new site renders as a
      // small off-centre patch of the previous site's view.
      this.frameCameraOnGrid();
    }

    this.lastState = ctx.state;
    this.syncEntities(ctx);
  }

  /**
   * Completes a staged level load driven phase-by-phase by the loading
   * screen (#474): `enterLevel` in main.ts runs buildPlayableMesh() /
   * buildLandscapeMesh() / buildAmbient() as separate weighted LoadPhases,
   * bypassing syncFromContext() entirely so each gets its own presented
   * frame. Frames the camera, then records the same bookkeeping
   * syncFromContext() sets after loadGame(), and runs the same per-call sync.
   */
  finishLevelLoad(ctx: MiningContext): void {
    if (!ctx.state || !ctx.grid) return;
    this.frameCameraOnGrid();
    this.loadedSeed = ctx.state.seed;
    this.lastState = ctx.state;
    this.syncEntities(ctx);
  }

  /** Per-call entity/state sync shared by syncFromContext() and finishLevelLoad() (#474, extracted #767). */
  private syncEntities(ctx: MiningContext): void {
    if (!ctx.state) return;
    const result = syncGameRendererEntities({
      state: ctx.state,
      weatherCycle: ctx.weatherCycle,
      buildings: this.buildings,
      renderedBuildingIds: this.renderedBuildingIds,
      vehicles: this.vehicles,
      renderedVehicleIds: this.renderedVehicleIds,
      characters: this.characters,
      renderedEmployeeIds: this.renderedEmployeeIds,
      lastGrid: this.lastGrid,
      ghosts: this.ghosts,
      lastGhostRevision: this.lastGhostRevision,
      terrainMeshRevision: this.terrainMeshRevision,
      lastSyncedTerrainRevision: this.lastSyncedTerrainRevision,
      taskProgress: this.taskProgress,
      skybox: this.skybox,
      clouds: this.clouds,
      zone: ctx.state.zone.activeZone,
      getTerrainSurfaceY: (x, z) => this.getTerrainSurfaceY(x, z),
      syncSurveyOverlay: options => this.syncSurveyOverlay(options),
    });
    this.lastGhostRevision = result.lastGhostRevision;
    this.lastSyncedTerrainRevision = result.lastSyncedTerrainRevision;
    // Matches the pre-split guard (`this.skybox && ctx.weatherCycle`) exactly:
    // syncGameRendererEntities() only returns lastWeather when that guard held.
    if (result.lastWeather !== undefined) {
      this.lastWeather = result.lastWeather;
    }
  }

  /**
   * Jump the collapse straight to its end — the animation only ever walks
   * rock to a destination core already decided, so cutting it short is safe
   * for a harness (a settled muck pile is otherwise minutes of wall clock
   * away without a GPU, at 0.1s/frame of animation clock).
   */
  skipFragmentPlayback(): void {
    this.fragmentAnimator?.finish();
  }

  /** Hold the collapse `t` seconds in, for a harness stepping through it. */
  seekFragmentPlayback(t: number): void {
    this.fragmentAnimator?.seek(t);
  }

  /** How long the last blast's collapse runs for, in seconds. */
  get fragmentPlaybackDuration(): number {
    return this.fragmentAnimator?.durationS ?? 0;
  }

  /** Ambient shader clock, in game-time seconds — advances at state.timeScale, frozen while paused (#490). */
  get ambientClockSeconds(): number {
    return this.ambientUniforms.uTime.value;
  }

  /** Per-frame update — call from the render loop. */
  update(dt: number): void {
    // Ambient decoration (wind, clouds, birds, smoke, water, dust devils, fireflies,
    // vegetation sway via ambientUniforms.uTime) runs on game time: it scales with
    // state.timeScale and freezes with state.isPaused, so speeding up or pausing the
    // sim speeds up or freezes the decoration by the same factor. Everything else in
    // this method (fragment collapse playback, skybox, blast effects, characters,
    // ghosts, border wall, vehicles) is deliberately real-time and stays on raw dt.
    const gameDt = this.lastState && !this.lastState.isPaused
      ? dt * this.lastState.timeScale
      : 0;
    const cam = this.sm.camera;

    // Rock still falling from the last blast.
    this.fragmentAnimator?.update(dt);

    if (this.skybox) {
      this.skybox.update(dt, cam.position.x, cam.position.z, this.sm.cameraController.distance);
      this.sm.postPipeline.aerial.setHazeColor(this.skybox.skyColor);
    }

    // Wind + clouds (#458 T7.1/D12): one WindState update feeds every ambient
    // module's drift; CloudLayer's own offset/coverage then drive the
    // terrain material's cloud-shadow term directly, so visible clouds and
    // their ground shadows share the exact same scroll — never desynced.
    if (this.windState && this.clouds) {
      this.windState.update(gameDt, this.lastWeather);
      this.clouds.update(gameDt, this.windState.vector);
      const uniforms = this.terrain?.sharedMaterial.customUniforms;
      if (uniforms) {
        (uniforms['uCloudOffset']!.value as THREE.Vector2).copy(this.clouds.cloudOffset);
        uniforms['uCloudCoverage']!.value = this.clouds.cloudCoverage;
      }
    }

    // Birds/smoke/water/vegetation (#458 T7.2/D12/A26). Vegetation needs no
    // per-frame call — its sway lives entirely in the shared ambientUniforms
    // every tree/grass material already references; updating those two
    // values here is the whole update.
    if (this.windState) {
      const wind = this.windState.vector;
      this.ambientUniforms.uTime.value += gameDt;
      this.borderWall?.update(dt, this.sm.cameraController.viewTarget);
      this.ambientUniforms.uWind.value.set(wind.x, wind.z);
      this.birds?.update(gameDt);
      this.smoke?.update(gameDt, wind, cam.position);
      this.water?.update(gameDt, wind);
      this.dustDevils?.update(gameDt);
      this.fireflies?.update(gameDt);
    }

    if (this.blastEffects) {
      this.blastEffects.update(dt);
    }

    if (this.characters && this.lastState) {
      this.characters.update(this.lastState.employees.employees, dt);
    }

    this.taskProgress?.update(dt);

    if (this.vehicles && this.lastState) {
      this.vehicles.update(this.lastState.vehicles.vehicles, dt);
    }

    if (this.ghosts) {
      this.ghosts.update(dt);
    }
  }

  /**
   * Show blast plan overlay from current drill/charge/sequence state.
   * Call from main.ts after drill_plan, charge, or sequence commands.
   */
  showBlastPlanOverlay(ctx: MiningContext): void {
    showBlastPlanOverlay(this.blastVisualsDeps(), ctx);
  }

  /** Player-facing visibility preference for the survey confidence overlay (#496). */
  get surveyOverlayVisible(): boolean {
    return this.surveyOverlayPreference;
  }

  /**
   * Set the player-facing visibility preference for the survey confidence
   * overlay (#496) and immediately re-sync it against the last known state,
   * so hiding/showing takes effect without waiting for the next natural sync
   * cycle. Safe to call before any game is loaded (lastState is null).
   */
  setSurveyOverlayVisible(visible: boolean): void {
    this.surveyOverlayPreference = visible;
    if (!this.lastState) return;
    this.syncSurveyOverlay(buildSurveyOverlayOptions(this.lastState, this.lastGrid));
  }

  /** Flip the survey confidence overlay's visibility preference (#496) and return the new value, so callers (e.g. the keyboard shortcut) don't have to read-flip-set by hand. */
  toggleSurveyOverlayVisible(): boolean {
    this.setSurveyOverlayVisible(!this.surveyOverlayPreference);
    return this.surveyOverlayPreference;
  }

  /**
   * Sync survey confidence overlay from the current game state.
   * Call from syncFromContext() to keep the overlay visible during gameplay.
   * Gated on both "is there data" (options) and the player's visibility
   * preference (#496) — either being false hides the overlay.
   */
  syncSurveyOverlay(options: SurveyConfidenceOverlayOptions | null): void {
    syncSurveyOverlay(this.terrain, options, this.surveyOverlayPreference);
  }

  /** Public wrapper around `getTerrainSurfaceY`, for the scenario camera bridge (`window.__cameraFocus`, #410). See GameRendererPicking.ts. */
  surfaceYAt(x: number, z: number): number {
    return surfaceYAt(this.pickingDeps(), x, z);
  }

  /** Exact rendered-mesh height at (x, z) via a vertical raycast. Returns null off the terrain. See GameRendererPicking.ts. */
  raycastSurfaceY(x: number, z: number): number | null {
    return raycastSurfaceY(this.pickingDeps(), x, z);
  }

  /** Terrain-only hit for a camera ray through NDC (ndcX, ndcY) — the world-to-screen bridge's starting guess. See GameRendererPicking.ts. */
  raycastTerrainFromNDC(ndcX: number, ndcY: number, camera: THREE.Camera): THREE.Vector3 | null {
    return raycastTerrainFromNDC(this.pickingDeps(), ndcX, ndcY, camera);
  }

  /** Every entity root object raycastable for scene picking (P2/P4). See GameRendererPicking.ts. */
  pickables(): THREE.Object3D[] {
    return pickables(this.pickingDeps());
  }

  /** Resolve a fragment-bucket raycast hit (bucketIndex, instanceId) to the fragment id occupying that slot. */
  resolveFragmentId(bucketIndex: number, instanceId: number): number | null {
    return resolveFragmentId(this.pickingDeps(), bucketIndex, instanceId);
  }

  /** Current world-space position of a live entity, for hover-tag/highlight placement. See GameRendererPicking.ts. */
  entityWorldPosition(kind: 'building' | 'vehicle' | 'employee' | 'fragment' | 'hole', id: number): THREE.Vector3 | null {
    return entityWorldPosition(this.pickingDeps(), kind, id);
  }

  /** Find the highest solid-voxel Y at the given (x, z) column. Returns 0 if no grid. */
  private getTerrainSurfaceY(x: number, z: number): number {
    return getTerrainSurfaceY(this.lastGrid, x, z);
  }

  /** A blast fired at (originX, originZ) — scatters any nearby bird flock (#458 T7.2/D12/A26). See GameRendererBlastVisuals.ts. */
  notifyBlastScatter(originX: number, originZ: number): void {
    notifyBlastScatter(this.blastVisualsDeps(), originX, originZ);
  }

  /** Trigger blast visual effects. Call from main.ts immediately after a successful blast command. See GameRendererBlastVisuals.ts. */
  onBlast(ctx: MiningContext): void {
    onBlast(this.blastVisualsDeps(), ctx);
  }

  /** Force a full terrain rebuild — grid identity changes only (new_game, campaign start, load). See GameRendererTerrain.ts. */
  rebuildTerrain(): void {
    const deps = this.terrainDeps();
    rebuildTerrain(deps);
    this.applyTerrainDeps(deps);
  }

  /** Re-mesh only the chunks a terrain:updated region touches (#458 T3.1). See GameRendererTerrain.ts. */
  remeshTerrainRegion(ctx: MiningContext, region: DirtyRegion): void {
    const deps = this.terrainDeps();
    remeshTerrainRegion(deps, ctx, region);
    this.applyTerrainDeps(deps);
  }

  dispose(): void {
    this.clearAll();
  }

  // ---------- Internal ----------

  /** Whole-scene rebuild on a new game/level (#474). See GameRendererSceneSetup.ts. */
  private loadGame(ctx: MiningContext): void {
    const deps = this.sceneSetupDeps();
    loadGame(deps, ctx);
    this.applySceneSetupDeps(deps);
  }

  /** Stage 1 of a level load (#474): playable terrain mesh, buildings, vehicles, characters, sky, fragments, overlays. See GameRendererSceneSetup.ts. */
  buildPlayableMesh(ctx: MiningContext): void {
    const deps = this.sceneSetupDeps();
    buildPlayableMesh(deps, ctx);
    this.applySceneSetupDeps(deps);
  }

  /** Stage 2 of a level load (#474): the landscape zone, aerial-perspective calibration, and the border wall. See GameRendererSceneSetup.ts. */
  buildLandscapeMesh(ctx: MiningContext): void {
    const deps = this.sceneSetupDeps();
    buildLandscapeMesh(deps, ctx);
    this.applySceneSetupDeps(deps);
  }

  /** Stage 3 of a level load (#474): birds, chimney smoke, water, vegetation sway, per-biome dust-devil/firefly extras. See GameRendererSceneSetup.ts. */
  buildAmbient(ctx: MiningContext): void {
    const deps = this.sceneSetupDeps();
    buildAmbient(deps, ctx);
    this.applySceneSetupDeps(deps);
  }

  /** Centre the camera on the loaded grid and pull back far enough to show all of it. See GameRendererSceneSetup.ts. */
  private frameCameraOnGrid(): void {
    const deps = this.sceneSetupDeps();
    frameCameraOnGrid(deps);
    this.applySceneSetupDeps(deps);
  }

  /**
   * Re-leash the camera to the landscape's fixed generation extent (#558).
   * Threaded into TerrainDeps as a callback so GameRendererTerrain.ts's
   * remeshTerrainRegion can call it without importing
   * GameRendererSceneSetup.ts directly (would cycle).
   */
  private refreshPanLeash(): void {
    const deps = this.sceneSetupDeps();
    refreshPanLeash(deps);
    this.applySceneSetupDeps(deps);
  }

  private clearAll(): void {
    const deps = this.sceneSetupDeps();
    clearAll(deps);
    this.applySceneSetupDeps(deps);
  }

  /**
   * Threaded into SceneSetupDeps so buildLandscapeMesh can call it without
   * importing GameRendererTerrain.ts's rebuildBorderWall's own module
   * cyclically — both live behind this same-class indirection. Takes the
   * in-flight `sceneDeps` (not `this`) so it reads/writes the same object
   * loadGame()'s chained call is mutating — building a TerrainDeps from
   * stale `this` fields here caused #767's stale-closure regression.
   */
  private rebuildBorderWallCallback(sceneDeps: SceneSetupDeps, ctx: MiningContext): void {
    const deps = this.terrainDepsFrom(sceneDeps);
    rebuildBorderWall(deps, ctx);
    this.copyTerrainDepsInto(sceneDeps, deps);
  }

  /** Threaded into SceneSetupDeps for the same reason as rebuildBorderWallCallback above. */
  private siteBoundsChangedCallback(sceneDeps: SceneSetupDeps, grid: VoxelGrid | null): boolean {
    const deps = this.terrainDepsFrom(sceneDeps);
    const changed = siteBoundsChanged(deps, grid);
    this.copyTerrainDepsInto(sceneDeps, deps);
    return changed;
  }

  /** Build a TerrainDeps view onto an in-flight SceneSetupDeps's live fields, instead of `this`'s possibly-stale ones. */
  private terrainDepsFrom(sceneDeps: SceneSetupDeps): TerrainDeps {
    return {
      terrain: sceneDeps.terrain,
      lastGrid: sceneDeps.lastGrid,
      terrainMeshRevision: sceneDeps.terrainMeshRevision,
      lastCutBounds: sceneDeps.lastCutBounds,
      landscape: sceneDeps.landscape,
      landscapeHandle: sceneDeps.landscapeHandle,
      borderWall: sceneDeps.borderWall,
      sm: this.sm,
      refreshPanLeash: () => this.refreshPanLeash(),
    };
  }

  /** Copy a TerrainDeps' mutated fields back onto the in-flight SceneSetupDeps it was built from. */
  private copyTerrainDepsInto(sceneDeps: SceneSetupDeps, deps: TerrainDeps): void {
    sceneDeps.terrain = deps.terrain;
    sceneDeps.lastGrid = deps.lastGrid;
    sceneDeps.terrainMeshRevision = deps.terrainMeshRevision;
    sceneDeps.lastCutBounds = deps.lastCutBounds;
    sceneDeps.landscape = deps.landscape;
    sceneDeps.landscapeHandle = deps.landscapeHandle;
    sceneDeps.borderWall = deps.borderWall;
  }

  private terrainDeps(): TerrainDeps {
    return {
      terrain: this.terrain,
      lastGrid: this.lastGrid,
      terrainMeshRevision: this.terrainMeshRevision,
      lastCutBounds: this.lastCutBounds,
      landscape: this.landscape,
      landscapeHandle: this.landscapeHandle,
      borderWall: this.borderWall,
      sm: this.sm,
      refreshPanLeash: () => this.refreshPanLeash(),
    };
  }

  private applyTerrainDeps(deps: TerrainDeps): void {
    this.terrain = deps.terrain;
    this.lastGrid = deps.lastGrid;
    this.terrainMeshRevision = deps.terrainMeshRevision;
    this.lastCutBounds = deps.lastCutBounds;
    this.landscape = deps.landscape;
    this.landscapeHandle = deps.landscapeHandle;
    this.borderWall = deps.borderWall;
  }

  private sceneSetupDeps(): SceneSetupDeps {
    const deps: SceneSetupDeps = {
      sm: this.sm,
      terrain: this.terrain,
      buildings: this.buildings,
      vehicles: this.vehicles,
      characters: this.characters,
      taskProgress: this.taskProgress,
      skybox: this.skybox,
      windState: this.windState,
      clouds: this.clouds,
      birds: this.birds,
      smoke: this.smoke,
      water: this.water,
      vegetation: this.vegetation,
      dustDevils: this.dustDevils,
      fireflies: this.fireflies,
      ambientUniforms: this.ambientUniforms,
      fragments: this.fragments,
      fragmentAnimator: this.fragmentAnimator,
      blastEffects: this.blastEffects,
      landscape: this.landscape,
      landscapeHandle: this.landscapeHandle,
      borderWall: this.borderWall,
      blastOverlay: this.blastOverlay,
      ghosts: this.ghosts,
      lastGrid: this.lastGrid,
      lastCutBounds: this.lastCutBounds,
      terrainMeshRevision: this.terrainMeshRevision,
      lastGhostRevision: this.lastGhostRevision,
      lastSyncedTerrainRevision: this.lastSyncedTerrainRevision,
      renderedBuildingIds: this.renderedBuildingIds,
      renderedVehicleIds: this.renderedVehicleIds,
      renderedEmployeeIds: this.renderedEmployeeIds,
      // Placeholders — reassigned below once `deps` exists, so these three
      // callbacks close over the in-flight `deps` object instead of `this`.
      // loadGame()'s chained buildPlayableMesh -> buildLandscapeMesh ->
      // buildAmbient -> frameCameraOnGrid call shares one `deps` without any
      // intermediate applySceneSetupDeps(), so a `this`-bound callback would
      // read fields `deps` had already moved past (#767 regression).
      getTerrainSurfaceY: () => 0,
      landscapeEdgeHeightSampler: ctx => landscapeEdgeHeightSampler(ctx),
      playableCut: (grid, edgeHeight) => playableCut(grid, edgeHeight),
      rebuildBorderWall: () => {},
      siteBoundsChanged: () => false,
    };
    deps.getTerrainSurfaceY = (x, z) => getTerrainSurfaceY(deps.lastGrid, x, z);
    deps.rebuildBorderWall = ctx => this.rebuildBorderWallCallback(deps, ctx);
    deps.siteBoundsChanged = grid => this.siteBoundsChangedCallback(deps, grid);
    return deps;
  }

  private applySceneSetupDeps(deps: SceneSetupDeps): void {
    this.terrain = deps.terrain;
    this.buildings = deps.buildings;
    this.vehicles = deps.vehicles;
    this.characters = deps.characters;
    this.taskProgress = deps.taskProgress;
    this.skybox = deps.skybox;
    this.windState = deps.windState;
    this.clouds = deps.clouds;
    this.birds = deps.birds;
    this.smoke = deps.smoke;
    this.water = deps.water;
    this.vegetation = deps.vegetation;
    this.dustDevils = deps.dustDevils;
    this.fireflies = deps.fireflies;
    this.fragments = deps.fragments;
    this.fragmentAnimator = deps.fragmentAnimator;
    this.blastEffects = deps.blastEffects;
    this.landscape = deps.landscape;
    this.landscapeHandle = deps.landscapeHandle;
    this.borderWall = deps.borderWall;
    this.blastOverlay = deps.blastOverlay;
    this.ghosts = deps.ghosts;
    this.lastGrid = deps.lastGrid;
    this.lastCutBounds = deps.lastCutBounds;
    this.terrainMeshRevision = deps.terrainMeshRevision;
    this.lastGhostRevision = deps.lastGhostRevision;
    this.lastSyncedTerrainRevision = deps.lastSyncedTerrainRevision;
  }

  private blastVisualsDeps(): BlastVisualsDeps {
    return {
      terrain: this.terrain,
      lastGrid: this.lastGrid,
      blastOverlay: this.blastOverlay,
      fragments: this.fragments,
      fragmentAnimator: this.fragmentAnimator,
      blastEffects: this.blastEffects,
      birds: this.birds,
      getTerrainSurfaceY: (x, z) => this.getTerrainSurfaceY(x, z),
    };
  }

  private pickingDeps(): PickingDeps {
    return {
      terrain: this.terrain,
      landscape: this.landscape,
      buildings: this.buildings,
      vehicles: this.vehicles,
      characters: this.characters,
      fragments: this.fragments,
      blastOverlay: this.blastOverlay,
      getTerrainSurfaceY: (x, z) => this.getTerrainSurfaceY(x, z),
    };
  }
}
