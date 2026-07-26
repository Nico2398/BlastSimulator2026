// BlastSimulator2026 — Game Renderer
// Bridges MiningContext (game state) to all Three.js sub-renderers.
// Call syncFromContext() after each console command; update() each frame.

import * as THREE from 'three';
import type { MiningContext } from '../console/commands/mining.js';
import type { GameState } from '../core/state/GameState.js';
import type { VoxelGrid } from '../core/world/VoxelGrid.js';
import { getMinePreset } from '../core/world/MineType.js';
import type { SceneManager } from './SceneManager.js';
import { TerrainMesh } from './TerrainMesh.js';
import { BuildingMesh } from './BuildingMesh.js';
import { VehicleMesh } from './VehicleMesh.js';
import { CharacterMesh } from './CharacterMesh.js';
import { SkyboxWeather } from './SkyboxWeather.js';
import { FragmentMesh } from './FragmentMesh.js';
import { BlastEffects } from './BlastEffects.js';
import { DistantScenery } from './DistantScenery.js';
import { BlastPlanOverlay } from './BlastPlanOverlay.js';
import { GhostMesh } from './GhostMesh.js';
import { syncEntitySets } from './EntitySync.js';
import type { SurveyConfidenceOverlayOptions, SurveyConfidencePoint } from './SurveyConfidenceOverlay.js';
import { isSurveyStale } from '../core/mining/SurveyCalc.js';
import { SOLID_VOXEL_DENSITY_THRESHOLD } from '../core/config/balance.js';
import { isInZone } from '../core/entities/Zone.js';

export class GameRenderer {
  private readonly sm: SceneManager;

  public terrain: TerrainMesh | null = null;
  private buildings: BuildingMesh | null = null;
  private vehicles: VehicleMesh | null = null;
  private characters: CharacterMesh | null = null;
  private skybox: SkyboxWeather | null = null;
  private fragments: FragmentMesh | null = null;
  private blastEffects: BlastEffects | null = null;
  private scenery: DistantScenery | null = null;
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

  /**
   * Sync rendered scene from the current MiningContext.
   * Call after every console command.
   */
  syncFromContext(ctx: MiningContext): void {
    if (!ctx.state || !ctx.grid) return;

    // New game (or first load) — rebuild everything
    if (this.loadedSeed !== ctx.state.seed) {
      this.loadGame(ctx.state, ctx.grid);
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
      // A campaign level can swap in a differently-sized grid while keeping the
      // seed, so loadGame() never runs. Re-frame or the new site renders as a
      // small off-centre patch of the previous site's view.
      this.frameCameraOnGrid();
    }

    this.lastState = ctx.state;

    // Sync entities added since last call
    syncEntitySets(ctx.state, this.buildings, this.renderedBuildingIds, this.vehicles, this.renderedVehicleIds, this.characters, this.renderedEmployeeIds);

    // Place vehicles at terrain surface height (not buried at y=0)
    if (this.vehicles && this.lastGrid) {
      for (const v of ctx.state.vehicles.vehicles) {
        if (this.renderedVehicleIds.has(v.id)) {
          const surfaceY = this.getTerrainSurfaceY(v.x, v.z);
          this.vehicles.snapPosition(v.id, v.x, surfaceY, v.z);
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

    // Sync ghost previews for pending actions
    if (this.ghosts) {
      this.ghosts.sync(ctx.state.ghostPreviews);
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

    return { points, opacity: 0.6 };
  }

  /** Find the highest solid-voxel Y at the given (x, z) column. Returns 0 if no grid. */
  private getTerrainSurfaceY(x: number, z: number): number {
    if (!this.lastGrid) return 0;
    const gx = Math.max(0, Math.min(this.lastGrid.sizeX - 1, Math.floor(x)));
    const gz = Math.max(0, Math.min(this.lastGrid.sizeZ - 1, Math.floor(z)));
    for (let y = this.lastGrid.sizeY - 1; y >= 0; y--) {
      const v = this.lastGrid.getVoxel(gx, y, gz);
      if (v && v.density >= SOLID_VOXEL_DENSITY_THRESHOLD) return y + 1;
    }
    return 0;
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

    // Localized terrain remesh: only rebuild chunks containing affected voxels.
    // Fragment positions tell us exactly which voxels were blasted.
    if (ctx.lastBlastFragments && ctx.lastBlastFragments.length > 0) {
      this.terrain.update(ctx.lastBlastFragments);
    } else {
      // Fallback: full rebuild (e.g. if fragment data unavailable)
      this.terrain.buildAll();
    }

    // Spawn fragment meshes for the blasted rock
    if (this.fragments && ctx.lastBlastFragmentData && ctx.lastBlastFragmentData.length > 0) {
      this.fragments.clearAll();
      this.fragments.spawnFragments(ctx.lastBlastFragmentData);
    }

    if (!this.blastEffects || !ctx.state) return;

    // Compute blast origin from fragment centroid or grid centre
    let ox = this.lastGrid.sizeX / 2;
    let oz = this.lastGrid.sizeZ / 2;
    if (ctx.lastBlastFragments && ctx.lastBlastFragments.length > 0) {
      ox = ctx.lastBlastFragments.reduce((s, p) => s + p.x, 0) / ctx.lastBlastFragments.length;
      oz = ctx.lastBlastFragments.reduce((s, p) => s + p.z, 0) / ctx.lastBlastFragments.length;
    }
    const origin = new THREE.Vector3(ox, 0, oz);

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
      holes.push({ x: ox, y: 0, z: oz, delaySeconds: 0 });
    }

    this.blastEffects.trigger({
      holes,
      energyLevel: 0.6,
      origin,
    });
  }

  /** Force a full terrain rebuild (e.g. after blast modifies voxels). */
  rebuildTerrain(): void {
    console.log(`[GameRenderer] rebuildTerrain: lastGrid=${this.lastGrid?.id}`);
    this.terrain?.buildAll();
  }

  dispose(): void {
    this.clearAll();
  }

  // ---------- Internal ----------

  private loadGame(state: GameState, grid: VoxelGrid): void {
    this.clearAll();

    const { scene, sun, ambient } = this.sm;

    // Terrain mesh (marching cubes)
    this.terrain = new TerrainMesh(scene, grid);
    this.terrain.buildAll();

    // Buildings
    this.buildings = new BuildingMesh(scene);
    for (const b of state.buildings.buildings) {
      this.buildings.addBuilding(b);
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
    this.skybox = new SkyboxWeather(scene, sun, ambient);

    // Fragments (empty until blast runs)
    this.fragments = new FragmentMesh(scene);

    // Blast effects
    this.blastEffects = new BlastEffects(scene, this.sm.camera);

    this.lastGrid = grid;

    // Distant scenery
    const preset = getMinePreset(state.mineType);
    if (preset) {
      this.scenery = new DistantScenery(scene);
      this.scenery.generate(preset, grid.sizeX / 2, grid.sizeZ / 2);
    }

    // Blast plan overlay (hidden until shown)
    this.blastOverlay = new BlastPlanOverlay(scene);

    // Ghost previews (initially empty)
    this.ghosts = new GhostMesh(scene);

    // Frame the whole site
    this.frameCameraOnGrid();
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
    this.scenery?.clear();
    this.blastOverlay?.dispose();
    this.ghosts?.dispose();

    this.terrain = null;
    this.buildings = null;
    this.vehicles = null;
    this.characters = null;
    this.skybox = null;
    this.fragments = null;
    this.blastEffects = null;
    this.scenery = null;
    this.blastOverlay = null;
    this.ghosts = null;
    this.lastGrid = null;

    this.renderedBuildingIds.clear();
    this.renderedVehicleIds.clear();
    this.renderedEmployeeIds.clear();
  }
}
