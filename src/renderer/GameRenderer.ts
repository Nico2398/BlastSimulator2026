// BlastSimulator2026 — Game Renderer
// Bridges MiningContext (game state) to all Three.js sub-renderers.
// Call syncFromContext() after each console command; update() each frame.

import * as THREE from 'three';
import type { MiningContext } from '../console/commands/mining.js';
import { ensureLandscape, type LandscapeHandle } from '../console/commands/world.js';
import type { GameState } from '../core/state/GameState.js';
import { type VoxelGrid, computeVoxelColumnSurfaceY, computeVoxelColumnSurfaceHeight } from '../core/world/VoxelGrid.js';
import { getBiome } from '../core/world/BiomeCatalog.js';
import type { WeatherState } from '../core/weather/WeatherCycle.js';
import { BIOME_GRADES, NEUTRAL_GRADE } from './post/AerialPerspectivePass.js';
import type { SceneManager } from './SceneManager.js';
import { TerrainMesh, type DirtyRegion } from './TerrainMesh.js';
import { BuildingMesh } from './BuildingMesh.js';
import { VehicleMesh } from './VehicleMesh.js';
import { CharacterMesh } from './CharacterMesh.js';
import { SkyboxWeather } from './SkyboxWeather.js';
import { WindState } from './ambient/WindState.js';
import { CloudLayer } from './ambient/CloudLayer.js';
import { BirdFlocks } from './ambient/BirdFlocks.js';
import { ChimneySmoke } from './ambient/ChimneySmoke.js';
import { WaterSurface } from './ambient/WaterSurface.js';
import { VegetationSway } from './ambient/VegetationSway.js';
import { DustDevils } from './ambient/DustDevils.js';
import { Fireflies } from './ambient/Fireflies.js';
import { createAmbientUniforms, type AmbientUniforms } from './ambient/AmbientUniforms.js';
import { FragmentMesh } from './FragmentMesh.js';
import { BlastEffects } from './BlastEffects.js';
import { FragmentAnimator } from './FragmentAnimator.js';
import { LandscapeMesh, type PlayableCut } from './terrain/LandscapeMesh.js';
import { WorldBorderWall } from './WorldBorderWall.js';
import { BlastPlanOverlay } from './BlastPlanOverlay.js';
import { GhostMesh } from './GhostMesh.js';
import { TaskProgressBar } from './TaskProgressBar.js';
import { syncEntitySets, buildingCenterSurfaceY } from './EntitySync.js';
import type { SurveyConfidenceOverlayOptions, SurveyConfidencePoint } from './SurveyConfidenceOverlay.js';
import { isSurveyStale } from '../core/mining/SurveyCalc.js';
import {
  BLAST_ORIGIN_SURFACE_SEARCH_MIN_RADIUS,
  BLAST_ORIGIN_SURFACE_SEARCH_MARGIN,
} from '../core/config/balance.js';
import { isInZone } from '../core/entities/Zone.js';
import { assembleBlastPlan } from '../core/mining/BlastPlan.js';
import { previewHoleDetails } from '../core/mining/Software.js';
import { boundingBoxXZ, getBlastOriginSurfaceY } from './BlastOriginSampling.js';

/**
 * How far past the playable rect manual panning may wander (#458 T6.1/D13:
 * "pan gets a soft leash to the playable rect ± margin"). No exact figure is
 * specified in the plan (default-and-record); 80m clears the boundary-shading
 * band (T5.3, ~5m) and reaches nearby landscape structures without letting
 * the camera drift into the empty far landscape.
 */
const PAN_LEASH_MARGIN = 80;

/**
 * Per-biome ambient extras (#458 T7.3, executor's pick, recorded here):
 * dust devils for the two arid biomes, fireflies for the one humid one.
 * Neither is universal — GameRenderer only builds the module whose biome
 * set contains the level's current biome id.
 */
const DUST_DEVIL_BIOMES: ReadonlySet<string> = new Set(['desert_badlands', 'red_canyon']);
const FIREFLY_BIOMES: ReadonlySet<string> = new Set(['tropical_karst']);

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
      // A differently-sized grid needs a fresh landscape too — same rebuild
      // loadGame() does, but this branch fires even when loadGame() didn't
      // (campaign level swaps grid size while keeping the seed, #458 T3.2).
      this.rebuildLandscapeMesh(ctx);
      // A campaign level can swap in a differently-sized grid while keeping the
      // seed, so loadGame() never runs. Re-frame or the new site renders as a
      // small off-centre patch of the previous site's view.
      this.frameCameraOnGrid();
    }

    this.lastState = ctx.state;

    // Sync entities added since last call
    syncEntitySets(
      ctx.state, this.buildings, this.renderedBuildingIds,
      this.vehicles, this.renderedVehicleIds,
      this.characters, this.renderedEmployeeIds,
      (x, z) => this.getTerrainSurfaceY(x, z),
    );

    // Place vehicles at terrain surface height (not buried at y=0). This
    // corrects only the instant terrain-surface `y` value via setSurfaceY();
    // x/z motion (including the waiting-queue render offset, #411) is left
    // entirely to the per-frame tween inside VehicleMesh.update() (#520), so
    // this sync never stomps a mid-glide or fused 'waiting' vehicle's x/z.
    if (this.vehicles && this.lastGrid) {
      for (const v of ctx.state.vehicles.vehicles) {
        if (this.renderedVehicleIds.has(v.id)) {
          const surfaceY = this.getTerrainSurfaceY(v.x, v.z);
          this.vehicles.setSurfaceY(v.id, surfaceY);
        }
      }
    }

    // Place characters at terrain surface height (not buried at y=0)
    if (this.characters && this.lastGrid) {
      for (const e of ctx.state.employees.employees) {
        if (this.renderedEmployeeIds.has(e.id)) {
          const surfaceY = this.getTerrainSurfaceY(e.x, e.z);
          this.characters.setSurfaceY(e.id, surfaceY);
        }
      }
    }

    // Sync ghost previews for pending actions. Every dispatch sets targetY:0
    // (see employees.ts), so at the terrain's actual height that box renders
    // buried inside solid voxels — snap it onto the surface like vehicles and
    // characters above, or the ghost is queued but never visible (#406).
    if (this.ghosts) {
      const previews = this.lastGrid
        ? ctx.state.ghostPreviews.map(p => ({ ...p, targetY: this.getTerrainSurfaceY(p.targetX, p.targetZ) }))
        : ctx.state.ghostPreviews;
      this.ghosts.sync(previews);
    }

    // Task progress bars — reflect the current working/idle state each sync (#546)
    if (this.taskProgress && this.characters) {
      this.taskProgress.sync(
        ctx.state.employees.employees,
        ctx.state.vehicles.vehicles,
        id => this.characters!.getGroup(id),
      );
    }

    // Blink employees still inside an active safety zone during clearing
    if (this.characters) {
      const zone = ctx.state.zone.activeZone;
      for (const e of ctx.state.employees.employees) {
        this.characters.setEvacuating(e.id, zone !== null && isInZone(e.x, e.z, zone));
      }
    }

    // Sync weather
    if (this.skybox && ctx.weatherCycle) {
      this.lastWeather = ctx.weatherCycle.current;
      this.skybox.setWeather(ctx.weatherCycle.current);
      this.clouds?.setWeather(ctx.weatherCycle.current);
    }

    // Sync survey confidence overlay
    this.syncSurveyOverlay(
      this.buildSurveyOverlayOptions(ctx.state),
    );
  }

  /**
   * Jump the collapse straight to its end, leaving every fragment on the resting
   * place the blast already chose for it.
   *
   * The animation only ever walks rock to a destination core decided, so cutting
   * it short changes nothing about the game — which is what makes it safe for a
   * harness to do. Without a GPU a frame costs seconds while the animation clock
   * advances at most 0.1 s per frame, so a screenshot of a settled muck pile is
   * otherwise minutes of wall clock away.
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
    if (!this.blastOverlay || !ctx.state) return;
    const { drillHoles, chargesByHole, sequenceDelays, softwareTier } = ctx.state;
    if (drillHoles.length === 0) { this.blastOverlay.hide(); return; }

    const cx = drillHoles.reduce((s, h) => s + h.x, 0) / drillHoles.length;
    const cz = drillHoles.reduce((s, h) => s + h.z, 0) / drillHoles.length;
    const originSurfaceY = this.getTerrainSurfaceY(cx, cz);

    // Per-hole fragment-size / projection-speed predictions, tier-gated the
    // same as the console `preview` commands. Without these, BlastPlanOverlay's
    // fragment-size dots and projection arcs never render — their per-hole
    // fields stay undefined and the overlay's own guards skip them.
    let holeDetails: Record<string, import('../core/mining/Software.js').HolePreviewDetail> = {};
    if (softwareTier >= 2 && ctx.grid) {
      const plan = assembleBlastPlan(drillHoles, chargesByHole, sequenceDelays);
      holeDetails = previewHoleDetails(plan, ctx.grid, softwareTier);
    }

    this.blastOverlay.show({
      softwareTier,
      origin: new THREE.Vector3(cx, originSurfaceY, cz),
      holes: drillHoles.map(h => {
        const hd: import('./BlastPlanOverlay.js').HoleOverlayData = {
          hole: h,
          delayMs: sequenceDelays[h.id] ?? 0,
          surfaceY: this.getTerrainSurfaceY(h.x, h.z),
        };
        const charge = chargesByHole[h.id];
        if (charge) hd.charge = charge;
        const detail = holeDetails[h.id];
        if (detail?.fragSizeCm !== undefined) hd.predictedFragSizeCm = detail.fragSizeCm;
        if (detail?.projectionSpeedMs !== undefined) hd.projectionSpeed = detail.projectionSpeedMs;
        return hd;
      }),
    });
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
    this.syncSurveyOverlay(this.buildSurveyOverlayOptions(this.lastState));
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
    if (!this.terrain) return;

    const overlay = this.terrain.getSurveyOverlay();
    if (options && options.points.length > 0 && this.surveyOverlayPreference) {
      overlay.show(options);
    } else {
      overlay.hide();
    }
  }

  /**
   * Convert GameState.surveyResults into overlay options.
   * Returns null when there are no survey results.
   */
  private buildSurveyOverlayOptions(
    state: import('../core/state/GameState.js').GameState,
  ): SurveyConfidenceOverlayOptions | null {
    if (state.surveyResults.length === 0 || !this.lastGrid) return null;

    const currentTick = state.tickCount;
    const grid = this.lastGrid;
    const points: SurveyConfidencePoint[] = [];

    for (const survey of state.surveyResults) {
      const fresh = !isSurveyStale(survey, currentTick);

      for (const colKey of Object.keys(survey.estimates)) {
        const parts = colKey.split(',').map(Number);
        const x = parts[0]!;
        const z = parts[1]!;

        // Surface Y = topmost solid voxel + 1
        let surfaceY = 0;
        const clampedX = Math.max(grid.minX, Math.min(grid.maxX - 1, Math.floor(x)));
        const clampedZ = Math.max(grid.minZ, Math.min(grid.maxZ - 1, Math.floor(z)));
        for (let y = grid.sizeY - 1; y >= 0; y--) {
          const voxel = grid.getVoxel(clampedX, y, clampedZ);
          if (voxel && voxel.density > 0) {
            surfaceY = y + 1;
            break;
          }
        }

        points.push({
          x,
          z,
          surfaceY,
          confidence: survey.confidence,
          fresh,
        });
      }
    }

    if (points.length === 0) return null;

    return { points, opacity: 0.4 };
  }

  /**
   * Public wrapper around `getTerrainSurfaceY`, used by the scenario camera
   * bridge (`window.__cameraFocus`) so a scripted shot can centre on a world
   * (x, z) point at the correct terrain height without duplicating the voxel
   * lookup (#410).
   */
  surfaceYAt(x: number, z: number): number {
    return this.getTerrainSurfaceY(x, z);
  }

  /**
   * Exact rendered-mesh height at (x, z), found by raycasting straight down
   * through the terrain meshes — unlike surfaceYAt's voxel-column lookup,
   * this matches the smoothed mesh surface a pointer raycast actually hits.
   * Used as the starting guess for interaction mode's world-to-screen
   * bridge (window.__worldToScreen, main.ts) — see raycastTerrainFromNDC for
   * why a single vertical raycast still isn't the whole fix. Returns null
   * off the terrain (no grid, or (x, z) outside every chunk).
   */
  raycastSurfaceY(x: number, z: number): number | null {
    if (!this.terrain) return null;
    const raycaster = new THREE.Raycaster(new THREE.Vector3(x, 10_000, z), new THREE.Vector3(0, -1, 0));
    const hit = this.raycastTerrainOrLandscape(raycaster);
    return hit ? hit.point.y : null;
  }

  /**
   * Terrain-only hit for a camera ray through NDC (ndcX, ndcY) — the same
   * raycast a real pointer click resolves via ScenePicking/PlacementController,
   * without pulling in their entity/hover machinery.
   *
   * window.__worldToScreen needs this, not just raycastSurfaceY, because the
   * camera ray through a screen pixel is never vertical: on sloped ground the
   * point directly above/below (x, z) is not generally the same point the
   * camera's own oblique ray would hit when aimed at that pixel. A ground-level
   * camera (the game's default framing) makes this worse — near-horizontal rays
   * turn a sub-metre height gap into a many-tile miss. Callers converge on a
   * pixel that truly round-trips by re-deriving the height from this hit and
   * reprojecting, rather than trusting one vertical sample.
   */
  raycastTerrainFromNDC(ndcX: number, ndcY: number, camera: THREE.Camera): THREE.Vector3 | null {
    if (!this.terrain) return null;
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
    const hit = this.raycastTerrainOrLandscape(raycaster);
    return hit ? hit.point.clone() : null;
  }

  /**
   * First hit against the terrain meshes, falling back to the landscape
   * meshes past the site's claimed edge (#558) when terrain misses. Shared
   * by raycastSurfaceY (vertical ray) and raycastTerrainFromNDC (camera ray)
   * — both need the same terrain-then-landscape fallback, only the ray
   * differs.
   */
  private raycastTerrainOrLandscape(raycaster: THREE.Raycaster): THREE.Intersection | undefined {
    if (!this.terrain) return undefined;
    const hit = raycaster.intersectObjects(this.terrain.meshes, true)[0];
    if (hit) return hit;
    return this.landscape ? raycaster.intersectObjects(this.landscape.meshes, true)[0] : undefined;
  }

  /**
   * Every entity root object raycastable for scene picking (P2/P4): buildings,
   * vehicles, employees, the 8 fragment shape buckets, and the current blast
   * plan's drill holes. Terrain is raycast separately via `terrain.meshes` —
   * it's a fallback hit, not an entity, and callers usually want to know when
   * nothing else was hit.
   */
  pickables(): THREE.Object3D[] {
    return [
      ...(this.buildings?.pickables() ?? []),
      ...(this.vehicles?.pickables() ?? []),
      ...(this.characters?.pickables() ?? []),
      ...(this.fragments?.pickables() ?? []),
      ...(this.blastOverlay?.pickables() ?? []),
    ];
  }

  /** Resolve a fragment-bucket raycast hit (bucketIndex, instanceId) to the fragment id occupying that slot. */
  resolveFragmentId(bucketIndex: number, instanceId: number): number | null {
    return this.fragments?.fragmentIdAt(bucketIndex, instanceId) ?? null;
  }

  /**
   * Current world-space position of a live entity, for hover-tag/highlight
   * placement. Buildings/vehicles/employees read their Group's position
   * directly; fragments resolve through their InstancedMesh slot; holes
   * resolve through the blast plan overlay's per-hole surface anchor. Null
   * when the entity isn't currently rendered (removed, or never synced).
   */
  entityWorldPosition(kind: 'building' | 'vehicle' | 'employee' | 'fragment' | 'hole', id: number): THREE.Vector3 | null {
    switch (kind) {
      case 'building': return this.buildings?.getPosition(id) ?? null;
      case 'vehicle': return this.vehicles?.getPosition(id) ?? null;
      case 'employee': return this.characters?.getPosition(id) ?? null;
      case 'fragment': return this.fragments?.fragmentPosition(id) ?? null;
      case 'hole': return this.blastOverlay?.getHolePosition(id) ?? null;
    }
  }

  /** Find the highest solid-voxel Y at the given (x, z) column. Returns 0 if no grid. */
  private getTerrainSurfaceY(x: number, z: number): number {
    if (!this.lastGrid) return 0;
    return computeVoxelColumnSurfaceY(this.lastGrid, x, z) + 1;
  }

  /**
   * A blast fired at (originX, originZ) — scatters any nearby bird flock
   * (#458 T7.2/D12/A26). Call from main.ts's `emitter.on('blast:started', ...)`
   * subscription, which already carries the blast origin.
   */
  notifyBlastScatter(originX: number, originZ: number): void {
    this.birds?.onBlast(originX, originZ);
  }

  /**
   * Trigger blast visual effects and rebuild terrain.
   * Call from main.ts immediately after a successful blast command.
   */
  onBlast(ctx: MiningContext): void {
    console.log(`[GameRenderer] onBlast: lastGrid=${this.lastGrid?.id} fragments=${ctx.lastBlastFragments?.length ?? 0}`);
    if (!this.terrain || !this.lastGrid) return;

    // Clear the blast plan overlay (holes are consumed by blast)
    if (this.blastOverlay) {
      this.blastOverlay.hide();
    }

    // Terrain remesh already happened: executeBlast emits terrain:updated,
    // which main.ts's subscription turns into rebuildTerrain() synchronously
    // before this method ever runs (#458 T0.2) — no longer this method's job.

    // Spawn fragment meshes for the blasted rock, then play the collapse.
    // spawnFragments places them where they came to rest; the animator walks
    // them there from where they broke, so the player sees the face come down
    // instead of a finished muck pile appearing at the moment of detonation.
    if (this.fragments && ctx.lastBlastFragmentData && ctx.lastBlastFragmentData.length > 0) {
      this.fragments.clearAll();
      this.fragments.spawnFragments(ctx.lastBlastFragmentData);
      if (ctx.lastBlastFlights) this.fragmentAnimator?.begin(ctx.lastBlastFlights);
    }

    if (!this.blastEffects || !ctx.state) return;

    // Compute blast origin from fragment centroid or grid centre
    let ox = this.lastGrid.minX + this.lastGrid.sizeX / 2;
    let oz = this.lastGrid.minZ + this.lastGrid.sizeZ / 2;
    // Size the surface-sample ring to the blast's own footprint (half its
    // bounding-box diagonal + margin), so a large multi-hole blast's crater
    // doesn't swallow the whole sampling ring.
    let sampleRadius: number = BLAST_ORIGIN_SURFACE_SEARCH_MIN_RADIUS;
    if (ctx.lastBlastFragments && ctx.lastBlastFragments.length > 0) {
      ox = ctx.lastBlastFragments.reduce((s, p) => s + p.x, 0) / ctx.lastBlastFragments.length;
      oz = ctx.lastBlastFragments.reduce((s, p) => s + p.z, 0) / ctx.lastBlastFragments.length;
      const { minX, maxX, minZ, maxZ } = boundingBoxXZ(ctx.lastBlastFragments);
      const halfDiagonal = Math.hypot(maxX - minX, maxZ - minZ) / 2;
      sampleRadius = Math.max(
        BLAST_ORIGIN_SURFACE_SEARCH_MIN_RADIUS,
        halfDiagonal + BLAST_ORIGIN_SURFACE_SEARCH_MARGIN,
      );
    }
    // Anchor at the surrounding terrain surface, not y=0. A mine site rarely
    // sits at grid y=0 — it's typically well above it — so a hardcoded 0 here
    // buried the dust cloud and detonation flash inside solid terrain, fully
    // occluded and never visible on screen.
    const origin = new THREE.Vector3(
      ox,
      getBlastOriginSurfaceY(this.lastGrid, (x, z) => this.getTerrainSurfaceY(x, z), ox, oz, sampleRadius),
      oz,
    );

    // Build per-hole detonation list from sequence delays
    const holes: import('./BlastEffects.js').HoleDetonation[] = [];
    const sequenceDelays = ctx.state.sequenceDelays;

    // If we have sequence delays, use them for per-hole timing
    if (Object.keys(sequenceDelays).length > 0) {
      for (const [holeId, delayMs] of Object.entries(sequenceDelays)) {
        // Find hole position from last known drill holes
        const holePos = ctx.lastBlastHoles?.find(h => h.id === holeId)
          ?? ctx.state.drillHoles.find(h => h.id === holeId);
        if (holePos) {
          holes.push({
            x: holePos.x,
            y: this.getTerrainSurfaceY(holePos.x, holePos.z),
            z: holePos.z,
            delaySeconds: delayMs / 1000,
          });
        }
      }
    }

    // Fallback: single explosion at centroid if no per-hole data
    if (holes.length === 0) {
      holes.push({ x: ox, y: origin.y, z: oz, delaySeconds: 0 });
    }

    this.blastEffects.trigger({
      holes,
      energyLevel: 0.6,
      origin,
    });
  }

  /** Force a full terrain rebuild — grid identity changes only (new_game, campaign start, load). */
  rebuildTerrain(): void {
    console.log(`[GameRenderer] rebuildTerrain: lastGrid=${this.lastGrid?.id}`);
    this.terrain?.buildAll();
  }

  /**
   * Re-mesh only the chunks a terrain:updated region touches (#458 T3.1).
   * The main.ts subscription calls this for every mutation (blast, drill,
   * ramp) instead of rebuildTerrain() — a single-voxel drill dig no longer
   * pays for re-marching chunks its region never touched.
   */
  remeshTerrainRegion(ctx: MiningContext, region: DirtyRegion): void {
    this.terrain?.remeshRegion(region);
    if (!this.siteBoundsChanged(ctx.grid)) return;

    // A claim moves the site's bounding box: the camera leash has to let the
    // player follow the ground they just took, the landscape has to stop
    // covering it, and the wall has to be re-raised on the new frontier.
    this.refreshPanLeash();

    // A null ctx.landscape means the grid itself was just replaced (new game,
    // campaign level, load) and rebuildLandscapeMesh is about to run with a
    // fresh handle. Rebuilding here would cut the new site against the old
    // level's landscape and then be thrown away.
    if (!ctx.landscape || !ctx.grid || !this.landscape || !this.landscapeHandle) return;

    this.landscape.build(this.landscapeHandle, ctx.grid.palette, this.playableCut(ctx.grid));
    this.rebuildBorderWall(ctx);
  }

  /** True when the site's bounding box differs from the one the landscape and wall were built against. */
  private siteBoundsChanged(grid: VoxelGrid | null): boolean {
    const key = grid ? `${grid.minX},${grid.minZ},${grid.maxX},${grid.maxZ},${grid.chunkCount}` : '';
    if (key === this.lastCutBounds) return false;
    this.lastCutBounds = key;
    return true;
  }

  /** The site's live shape, for the landscape mesher to cut itself against (#473 D8). */
  private playableCut(grid: VoxelGrid): PlayableCut {
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
   * ctx.landscape, so calling this before rebuildLandscapeMesh() does not
   * duplicate the (expensive) structure-set build; rebuildLandscapeMesh()
   * simply gets the same cached handle back (#559).
   */
  private landscapeEdgeHeightSampler(ctx: MiningContext): ((x: number, z: number) => number) | null {
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
  private rebuildBorderWall(ctx: MiningContext): void {
    if (this.borderWall) this.sm.postPipeline.removeOverlayObject(this.borderWall.object3d);
    this.borderWall?.dispose();
    this.borderWall = null;

    const grid = ctx.grid;
    const area = ctx.playableArea;
    if (!grid || !area || !this.terrain) return;
    // Never trace the world's rivers from a render path just to find out
    // there is no wall to draw — rebuildLandscapeMesh hands over the set it
    // already built, and calls this again once it has.
    if (!area.hasStructures()) return;

    const frontier = area.protectedFrontier();
    if (frontier.length === 0) return;

    const bounds = this.terrain.getBounds();
    const groundY = this.landscapeHandle?.groundLevelY ?? 0;
    this.borderWall = new WorldBorderWall(this.sm.scene, {
      protectedRects: frontier.map(f => f.rect),
      siteRect: { minX: grid.minX, minZ: grid.minZ, maxX: grid.maxX, maxZ: grid.maxZ },
      minGroundY: bounds?.minY ?? groundY,
      maxGroundY: bounds?.maxY ?? groundY + 20,
    });
    this.sm.postPipeline.addOverlayObject(this.borderWall.object3d);
  }

  dispose(): void {
    this.clearAll();
  }

  // ---------- Internal ----------

  private loadGame(ctx: MiningContext): void {
    const state = ctx.state!;
    const grid = ctx.grid!;
    this.clearAll();

    const { scene, sunLight, ambient, fill, csm } = this.sm;

    // Terrain mesh (marching cubes)
    this.terrain = new TerrainMesh(scene, grid, ctx.state?.mineType);
    // Wire the landscape's theoretical height into the edge-normal sampler
    // BEFORE the first buildAll(), so the initial mesh already carries the
    // boundary-normal fix instead of needing a later remesh to pick it up
    // (#559).
    this.terrain.setEdgeHeightSampler(this.landscapeEdgeHeightSampler(ctx));
    this.terrain.buildAll();
    this.terrain.sharedMaterial.attachCSM(csm);

    // Bind the grid before sampling terrain height below — buildings, vehicles,
    // and characters loaded from a save (not just a fresh new_game) need
    // getTerrainSurfaceY() to see this grid, not the previous one (#408).
    this.lastGrid = grid;

    // Buildings
    this.buildings = new BuildingMesh(scene);
    for (const b of state.buildings.buildings) {
      const surfaceY = buildingCenterSurfaceY(b, (x, z) => this.getTerrainSurfaceY(x, z));
      this.buildings.addBuilding(b, surfaceY);
    }

    // Vehicles
    this.vehicles = new VehicleMesh(scene);
    for (const v of state.vehicles.vehicles) {
      const surfaceY = this.getTerrainSurfaceY(v.x, v.z);
      this.vehicles.addVehicle(v, surfaceY);
    }

    // Characters (placed at terrain surface height, not y=0)
    this.characters = new CharacterMesh(scene);
    for (const e of state.employees.employees) {
      const surfaceY = this.getTerrainSurfaceY(e.x, e.z);
      this.characters.addEmployee(e, surfaceY);
    }

    // Task progress bars — billboarded above working employees (#546)
    this.taskProgress = new TaskProgressBar(scene, this.sm.camera);

    // Weather sky
    this.skybox = new SkyboxWeather(scene, sunLight, ambient, fill);

    // Wind + clouds (#458 T7.1/D12): one WindState per level, seeded so every
    // ambient module (clouds now, birds/smoke/water/sway in T7.2) leans the
    // same way. Cloud disc centres on the playable rect, same point
    // frameCameraOnGrid() frames the camera on.
    this.windState = new WindState(state.seed);
    this.clouds = new CloudLayer(scene, state.seed, grid.minX + grid.sizeX / 2, grid.minZ + grid.sizeZ / 2);

    // Fragments (empty until blast runs) — shares terrain's material so a
    // fresh cut face matches the rock it broke off from (#458 T4.1/D9).
    this.fragments = new FragmentMesh(scene, this.terrain.sharedMaterial);
    this.fragmentAnimator = new FragmentAnimator(this.fragments);

    // Blast effects
    this.blastEffects = new BlastEffects(scene, this.sm.camera);

    // Landscape zone — real ground continuing past the playable rect (#458 T3.2)
    this.rebuildLandscapeMesh(ctx);

    // Blast plan overlay (hidden until shown)
    this.blastOverlay = new BlastPlanOverlay(scene);

    // Ghost previews (initially empty)
    this.ghosts = new GhostMesh(scene);

    // Frame the whole site
    this.frameCameraOnGrid();
  }

  /**
   * Build (or rebuild) the landscape mesh for the current grid (#458 T3.2).
   * Triggers ensureLandscape()'s lazy build — the first real consumer of it
   * (T2.1 kept it lazy specifically because nothing rendered it yet).
   * Command-mode scenarios never construct a GameRenderer at all, so this
   * cost never lands on the fast, frequently-run scenario suite; only the
   * browser game and interaction-mode/visual harnesses pay it.
   */
  private rebuildLandscapeMesh(ctx: MiningContext): void {
    if (!this.terrain || !ctx.state?.world || !ctx.grid) return;
    const biome = getBiome(ctx.state.mineType);
    if (!biome) return;

    const { sizeX, sizeY, sizeZ } = ctx.state.world;
    const handle = ensureLandscape(ctx, { seed: ctx.state.seed, climateBias: biome.climateCenter, sizeX, sizeY, sizeZ });
    if (!handle) return;

    if (!this.landscape) {
      this.landscape = new LandscapeMesh(this.sm.scene, this.terrain.sharedMaterial);
    }
    this.landscapeHandle = handle;
    // Idempotent re-apply: a campaign level swap rebuilds the grid (and
    // re-marches terrain) before landscape geometry catches up, so the
    // sampler installed at loadGame() time can go stale — re-set it here
    // whenever landscape geometry changes (#559).
    this.terrain.setEdgeHeightSampler((x, z) => handle.sampleColumn(x, z).height);
    // The landscape's StructureSet already carries every river, village and
    // landmark for this seed — hand it to the claim path rather than have it
    // trace them all a second time (#473 D6).
    ctx.playableArea?.adoptStructures(handle.structureSet);
    this.landscape.build(handle, ctx.grid.palette, this.playableCut(ctx.grid));
    // Record what we just cut against, so the next terrain:updated only
    // rebuilds when the site has actually moved since this build.
    this.siteBoundsChanged(ctx.grid);

    // Aerial perspective's haze thickness and per-biome grade — set once per
    // level load, not per frame (#458 T5.2/A21).
    const { aerial } = this.sm.postPipeline;
    aerial.setHeightRef(handle.groundLevelY);
    aerial.setGrade(BIOME_GRADES[biome.id] ?? NEUTRAL_GRADE);

    // Birds/smoke/water/vegetation (#458 T7.2/D12/A26) — rebuilt from the
    // landscape's own StructureSet every time this runs (a campaign level
    // swap can call rebuildLandscapeMesh again for the same GameRenderer, so
    // stale instances from the previous grid must go first or their meshes
    // pile up in the scene).
    // The "not here" marker: the frontier between claimable ground and the
    // generated structures a claim can never take (#473 D6/P4). Sized from
    // the terrain's own height range so it stands on the ground rather than
    // floating or being buried.
    this.rebuildBorderWall(ctx);

    this.birds?.dispose();
    this.smoke?.dispose();
    this.water?.dispose();
    this.vegetation?.dispose();
    this.dustDevils?.dispose();
    this.fireflies?.dispose();
    const centerX = ctx.grid.minX + ctx.grid.sizeX / 2;
    const centerZ = ctx.grid.minZ + ctx.grid.sizeZ / 2;
    const sampleHeight = (x: number, z: number) => handle.sampleColumn(x, z).height;
    this.birds = new BirdFlocks(this.sm.scene, ctx.state.seed, centerX, centerZ);
    this.smoke = new ChimneySmoke(this.sm.scene, ctx.state.seed, handle.structureSet.villages);
    this.water = new WaterSurface(this.sm.scene, biome.id, handle.structureSet.rivers, handle.structureSet.landmarks);
    this.vegetation = new VegetationSway(
      this.sm.scene, ctx.state.seed, this.ambientUniforms, handle.structureSet.trees,
      centerX, centerZ, handle.playableRect, sampleHeight,
    );
    // Per-biome ambient extras (#458 T7.3) — only the module matching this
    // level's biome gets built; the other stays null.
    this.dustDevils = DUST_DEVIL_BIOMES.has(biome.id)
      ? new DustDevils(this.sm.scene, ctx.state.seed, centerX, centerZ, sampleHeight)
      : null;
    this.fireflies = FIREFLY_BIOMES.has(biome.id)
      ? new Fireflies(this.sm.scene, ctx.state.seed, centerX, centerZ, sampleHeight)
      : null;
  }

  /**
   * Centre the camera on the loaded grid and pull back far enough to show all
   * of it. Aimed at the surface rather than y=0 so the benches sit mid-frame.
   */
  private frameCameraOnGrid(): void {
    const grid = this.lastGrid;
    if (!grid) return;
    const cx = grid.minX + grid.sizeX / 2;
    const cz = grid.minZ + grid.sizeZ / 2;
    const span = Math.max(grid.sizeX, grid.sizeZ);
    this.sm.cameraController.frameSite(cx, this.getTerrainSurfaceY(cx, cz), cz, span);
    // Manual panning may wander past the pit rim to glance at nearby
    // landscape, but not indefinitely — the landscape is viewable, not the
    // play focus (#458 T6.1/D13).
    this.refreshPanLeash();
  }

  /**
   * Re-leash the camera to the landscape's fixed generation extent (#558) —
   * NOT the site's live bounding box, which only grows as the player claims
   * chunks and would otherwise leash the player to ground already claimed
   * instead of the ground actually rendered. Centred on the level's ORIGINAL
   * playable rect, exactly like `buildLandscapeMap` centres its tiles, so the
   * leash stays fixed for the whole level. Cheap; safe to call every remesh.
   */
  private refreshPanLeash(): void {
    const handle = this.landscapeHandle;
    if (!handle) return;
    const rect = handle.playableRect;
    const centerX = (rect.minX + rect.maxX) / 2;
    const centerZ = (rect.minZ + rect.maxZ) / 2;
    const half = handle.map.extentHalf;
    this.sm.cameraController.setPanLeash(
      { minX: centerX - half, minZ: centerZ - half, maxX: centerX + half, maxZ: centerZ + half },
      PAN_LEASH_MARGIN,
    );
  }

  private clearAll(): void {
    this.terrain?.dispose();
    this.buildings?.clearAll();
    this.vehicles?.clearAll();
    this.characters?.clearAll();
    this.skybox?.dispose();
    this.clouds?.dispose();
    if (this.borderWall) this.sm.postPipeline.removeOverlayObject(this.borderWall.object3d);
    this.borderWall?.dispose();
    this.birds?.dispose();
    this.smoke?.dispose();
    this.water?.dispose();
    this.vegetation?.dispose();
    this.dustDevils?.dispose();
    this.fireflies?.dispose();
    this.fragments?.dispose();
    this.blastEffects?.dispose();
    this.landscape?.dispose();
    this.blastOverlay?.dispose();
    this.ghosts?.dispose();
    this.taskProgress?.dispose();

    this.terrain = null;
    this.landscapeHandle = null;
    this.lastCutBounds = '';
    this.buildings = null;
    this.vehicles = null;
    this.characters = null;
    this.skybox = null;
    this.borderWall = null;
    this.windState = null;
    this.clouds = null;
    this.birds = null;
    this.smoke = null;
    this.water = null;
    this.vegetation = null;
    this.dustDevils = null;
    this.fireflies = null;
    this.fragments = null;
    this.blastEffects = null;
    this.landscape = null;
    this.blastOverlay = null;
    this.ghosts = null;
    this.taskProgress = null;
    this.lastGrid = null;

    this.renderedBuildingIds.clear();
    this.renderedVehicleIds.clear();
    this.renderedEmployeeIds.clear();
  }
}
