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

export class GameRenderer {
  private readonly sm: SceneManager;

  private terrain: TerrainMesh | null = null;
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

    this.lastState = ctx.state;

    // Sync entities added since last call
    syncEntitySets(ctx.state, this.buildings, this.renderedBuildingIds, this.vehicles, this.renderedVehicleIds, this.characters, this.renderedEmployeeIds);

    // Sync ghost previews for pending actions
    if (this.ghosts) {
      this.ghosts.sync(ctx.state.ghostPreviews);
    }

    // Sync weather
    if (this.skybox && ctx.weatherCycle) {
      this.skybox.setWeather(ctx.weatherCycle.current);
    }
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

  /** Find the highest solid-voxel Y at the given (x, z) column. Returns 0 if no grid. */
  private getTerrainSurfaceY(x: number, z: number): number {
    if (!this.lastGrid) return 0;
    const gx = Math.max(0, Math.min(this.lastGrid.sizeX - 1, Math.floor(x)));
    const gz = Math.max(0, Math.min(this.lastGrid.sizeZ - 1, Math.floor(z)));
    for (let y = this.lastGrid.sizeY - 1; y >= 0; y--) {
      const v = this.lastGrid.getVoxel(gx, y, gz);
      if (v && v.density >= 0.5) return y + 1;
    }
    return 0;
  }

  /**
   * Trigger blast visual effects and rebuild terrain.
   * Call from main.ts immediately after a successful blast command.
   */
  onBlast(ctx: MiningContext): void {
    if (!this.terrain || !this.lastGrid) return;

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
    this.blastEffects.trigger({
      holes: [{ x: ox, y: 0, z: oz, delaySeconds: 0 }],
      energyLevel: 0.6,
      origin,
    });
  }

  /** Force a full terrain rebuild (e.g. after blast modifies voxels). */
  rebuildTerrain(): void {
    this.terrain?.buildAll();
  }

  dispose(): void {
    this.clearAll();
  }

  // ---------- Internal ----------

  private loadGame(state: GameState, grid: VoxelGrid): void {
    this.clearAll();

    const { scene, sun, ambient, cameraController } = this.sm;

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
      this.vehicles.addVehicle(v);
    }

    // Characters
    this.characters = new CharacterMesh(scene);
    for (const e of state.employees.employees) {
      this.characters.addEmployee(e);
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

    // Point camera at terrain centre
    cameraController.setTarget(grid.sizeX / 2, 0, grid.sizeZ / 2);
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
