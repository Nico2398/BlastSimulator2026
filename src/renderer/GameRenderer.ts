// BlastSimulator2026 — Game Renderer
// Bridges MiningContext (game state) to all Three.js sub-renderers.
// Call syncFromContext() after each console command; update() each frame.

import * as THREE from 'three';
import type { MiningContext } from '../console/commands/mining.js';
import { ensureLandscape } from '../console/commands/world.js';
import type { GameState } from '../core/state/GameState.js';
import { type VoxelGrid, computeVoxelColumnSurfaceY } from '../core/world/VoxelGrid.js';
import { getBiome } from '../core/world/BiomeCatalog.js';
import { BIOME_GRADES, NEUTRAL_GRADE } from './post/AerialPerspectivePass.js';
import type { SceneManager } from './SceneManager.js';
import { TerrainMesh, type DirtyRegion } from './TerrainMesh.js';
import { BuildingMesh } from './BuildingMesh.js';
import { VehicleMesh } from './VehicleMesh.js';
import { CharacterMesh } from './CharacterMesh.js';
import { SkyboxWeather } from './SkyboxWeather.js';
import { FragmentMesh } from './FragmentMesh.js';
import { BlastEffects } from './BlastEffects.js';
import { LandscapeMesh } from './terrain/LandscapeMesh.js';
import { BlastPlanOverlay } from './BlastPlanOverlay.js';
import { GhostMesh } from './GhostMesh.js';
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

export class GameRenderer {
  private readonly sm: SceneManager;

  public terrain: TerrainMesh | null = null;
  private buildings: BuildingMesh | null = null;
  private vehicles: VehicleMesh | null = null;
  private characters: CharacterMesh | null = null;
  private skybox: SkyboxWeather | null = null;
  private fragments: FragmentMesh | null = null;
  private blastEffects: BlastEffects | null = null;
  private landscape: LandscapeMesh | null = null;
  private blastOverlay: BlastPlanOverlay | null = null;
  private ghosts: GhostMesh | null = null;
  private lastGrid: VoxelGrid | null = null;

  /** Seed of the currently loaded game — used to detect new_game calls. */
  private loadedSeed: number | null = null;
  private lastState: GameState | null = null;

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

    // Place vehicles at terrain surface height (not buried at y=0).
    // Also fold in the waiting-queue render offset (#411 round 2, anchored to
    // the shared target point since round 4) — this snap runs on every sync
    // (not just once per frame like update()'s lerp), so without it every
    // sync would stomp fused 'waiting' vehicles back to their raw, near-
    // identical GameState x/z.
    if (this.vehicles && this.lastGrid) {
      for (const v of ctx.state.vehicles.vehicles) {
        if (this.renderedVehicleIds.has(v.id)) {
          const surfaceY = this.getTerrainSurfaceY(v.x, v.z);
          const [renderX, renderZ] = this.vehicles.waitingRenderPosition(v, ctx.state.vehicles.vehicles);
          this.vehicles.snapPosition(v.id, renderX, surfaceY, renderZ);
        }
      }
    }

    // Place characters at terrain surface height (not buried at y=0)
    if (this.characters && this.lastGrid) {
      for (const e of ctx.state.employees.employees) {
        if (this.renderedEmployeeIds.has(e.id)) {
          const surfaceY = this.getTerrainSurfaceY(e.x, e.z);
          this.characters.snapPosition(e.id, e.x, surfaceY, e.z);
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

    // Blink employees still inside an active safety zone during clearing
    if (this.characters) {
      const zone = ctx.state.zone.activeZone;
      for (const e of ctx.state.employees.employees) {
        this.characters.setEvacuating(e.id, zone !== null && isInZone(e.x, e.z, zone));
      }
    }

    // Sync weather
    if (this.skybox && ctx.weatherCycle) {
      this.skybox.setWeather(ctx.weatherCycle.current);
    }

    // Sync survey confidence overlay
    this.syncSurveyOverlay(
      this.buildSurveyOverlayOptions(ctx.state),
    );
  }

  /** Per-frame update — call from the render loop. */
  update(dt: number): void {
    const cam = this.sm.camera;

    if (this.skybox) {
      this.skybox.update(dt, cam.position.x, cam.position.z);
      this.sm.postPipeline.aerial.setHazeColor(this.skybox.skyColor);
    }

    if (this.blastEffects) {
      this.blastEffects.update(dt);
    }

    if (this.characters && this.lastState) {
      this.characters.update(this.lastState.employees.employees, dt);
    }

    if (this.vehicles && this.lastState) {
      this.vehicles.update(this.lastState.vehicles.vehicles);
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
    const { drillHoles, chargesByHole, sequenceDelays } = ctx.state;
    if (drillHoles.length === 0) { this.blastOverlay.hide(); return; }

    const cx = drillHoles.reduce((s, h) => s + h.x, 0) / drillHoles.length;
    const cz = drillHoles.reduce((s, h) => s + h.z, 0) / drillHoles.length;
    const originSurfaceY = this.getTerrainSurfaceY(cx, cz);

    // Per-hole fragment-size / projection-speed predictions, tier-gated the
    // same as the console `preview` commands. Without these, BlastPlanOverlay's
    // fragment-size dots and projection arcs never render — their per-hole
    // fields stay undefined and the overlay's own guards skip them.
    let holeDetails: Record<string, import('../core/mining/Software.js').HolePreviewDetail> = {};
    if (ctx.softwareTier >= 2 && ctx.grid) {
      const plan = assembleBlastPlan(drillHoles, chargesByHole, sequenceDelays);
      holeDetails = previewHoleDetails(plan, ctx.grid, ctx.softwareTier);
    }

    this.blastOverlay.show({
      softwareTier: ctx.softwareTier,
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

  /**
   * Sync survey confidence overlay from the current game state.
   * Call from syncFromContext() to keep the overlay visible during gameplay.
   */
  syncSurveyOverlay(options: SurveyConfidenceOverlayOptions | null): void {
    if (!this.terrain) return;

    const overlay = this.terrain.getSurveyOverlay();
    if (options && options.points.length > 0) {
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
        const clampedX = Math.max(0, Math.min(grid.sizeX - 1, Math.floor(x)));
        const clampedZ = Math.max(0, Math.min(grid.sizeZ - 1, Math.floor(z)));
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

  /** Find the highest solid-voxel Y at the given (x, z) column. Returns 0 if no grid. */
  private getTerrainSurfaceY(x: number, z: number): number {
    if (!this.lastGrid) return 0;
    return computeVoxelColumnSurfaceY(this.lastGrid, x, z) + 1;
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

    // Spawn fragment meshes for the blasted rock
    if (this.fragments && ctx.lastBlastFragmentData && ctx.lastBlastFragmentData.length > 0) {
      this.fragments.clearAll();
      this.fragments.spawnFragments(ctx.lastBlastFragmentData);
    }

    if (!this.blastEffects || !ctx.state) return;

    // Compute blast origin from fragment centroid or grid centre
    let ox = this.lastGrid.sizeX / 2;
    let oz = this.lastGrid.sizeZ / 2;
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
  remeshTerrainRegion(region: DirtyRegion): void {
    this.terrain?.remeshRegion(region);
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
    this.terrain = new TerrainMesh(scene, grid);
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

    // Weather sky
    this.skybox = new SkyboxWeather(scene, sunLight, ambient, fill);

    // Fragments (empty until blast runs) — shares terrain's material so a
    // fresh cut face matches the rock it broke off from (#458 T4.1/D9).
    this.fragments = new FragmentMesh(scene, this.terrain.sharedMaterial);

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
    this.landscape.build(handle, ctx.grid.palette);

    // Aerial perspective's haze thickness and per-biome grade — set once per
    // level load, not per frame (#458 T5.2/A21).
    const { aerial } = this.sm.postPipeline;
    aerial.setHeightRef(handle.groundLevelY);
    aerial.setGrade(BIOME_GRADES[biome.id] ?? NEUTRAL_GRADE);
  }

  /**
   * Centre the camera on the loaded grid and pull back far enough to show all
   * of it. Aimed at the surface rather than y=0 so the benches sit mid-frame.
   */
  private frameCameraOnGrid(): void {
    const grid = this.lastGrid;
    if (!grid) return;
    const cx = grid.sizeX / 2;
    const cz = grid.sizeZ / 2;
    const span = Math.max(grid.sizeX, grid.sizeZ);
    this.sm.cameraController.frameSite(cx, this.getTerrainSurfaceY(cx, cz), cz, span);
  }

  private clearAll(): void {
    this.terrain?.dispose();
    this.buildings?.clearAll();
    this.vehicles?.clearAll();
    this.characters?.clearAll();
    this.skybox?.dispose();
    this.fragments?.dispose();
    this.blastEffects?.dispose();
    this.landscape?.dispose();
    this.blastOverlay?.dispose();
    this.ghosts?.dispose();

    this.terrain = null;
    this.buildings = null;
    this.vehicles = null;
    this.characters = null;
    this.skybox = null;
    this.fragments = null;
    this.blastEffects = null;
    this.landscape = null;
    this.blastOverlay = null;
    this.ghosts = null;
    this.lastGrid = null;

    this.renderedBuildingIds.clear();
    this.renderedVehicleIds.clear();
    this.renderedEmployeeIds.clear();
  }
}
