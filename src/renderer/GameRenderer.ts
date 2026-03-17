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
    this.syncEntities(ctx.state);

    // Sync weather
    if (this.skybox && ctx.weatherCycle) {
      this.skybox.setWeather(ctx.weatherCycle.current);
    }
  }

  private syncEntities(state: GameState): void {
    if (this.buildings) {
      for (const b of state.buildings.buildings) {
        if (!this.renderedBuildingIds.has(b.id)) {
          this.buildings.addBuilding(b);
          this.renderedBuildingIds.add(b.id);
        } else {
          this.buildings.updateBuilding(b);
        }
      }
      // Remove destroyed buildings
      for (const id of [...this.renderedBuildingIds]) {
        if (!state.buildings.buildings.find(b => b.id === id)) {
          this.buildings.removeBuilding(id);
          this.renderedBuildingIds.delete(id);
        }
      }
    }

    if (this.vehicles) {
      for (const v of state.vehicles.vehicles) {
        if (!this.renderedVehicleIds.has(v.id)) {
          this.vehicles.addVehicle(v);
          this.renderedVehicleIds.add(v.id);
        }
      }
      for (const id of [...this.renderedVehicleIds]) {
        if (!state.vehicles.vehicles.find(v => v.id === id)) {
          this.vehicles.removeVehicle(id);
          this.renderedVehicleIds.delete(id);
        }
      }
    }

    if (this.characters) {
      for (const e of state.employees.employees) {
        if (!this.renderedEmployeeIds.has(e.id)) {
          this.characters.addEmployee(e);
          this.renderedEmployeeIds.add(e.id);
        }
      }
      for (const id of [...this.renderedEmployeeIds]) {
        if (!state.employees.employees.find(e => e.id === id)) {
          this.characters.removeEmployee(id);
          this.renderedEmployeeIds.delete(id);
        }
      }
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

    this.blastOverlay.show({
      softwareTier: ctx.softwareTier,
      origin: new THREE.Vector3(cx, 0, cz),
      holes: drillHoles.map(h => {
        const hd: import('./BlastPlanOverlay.js').HoleOverlayData = {
          hole: h,
          delayMs: sequenceDelays[h.id] ?? 0,
        };
        const charge = chargesByHole[h.id];
        if (charge) hd.charge = charge;
        return hd;
      }),
    });
  }

  /**
   * Trigger blast visual effects and rebuild terrain.
   * Call from main.ts immediately after a successful blast command.
   */
  onBlast(ctx: MiningContext): void {
    if (!this.terrain || !this.lastGrid) return;

    // Rebuild terrain to show crater
    this.terrain.buildAll();

    if (!this.blastEffects || !ctx.state) return;

    // Build hole detonations from the (now-cleared) state context
    // Use drill holes from before the blast — they're cleared after execution.
    // Fall back to a generic effect centred on the grid.
    const gx = (this.lastGrid.sizeX / 2);
    const gz = (this.lastGrid.sizeZ / 2);
    const origin = new THREE.Vector3(gx, 0, gz);
    this.blastEffects.trigger({
      holes: [{ x: gx, y: 0, z: gz, delaySeconds: 0 }],
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

    this.terrain = null;
    this.buildings = null;
    this.vehicles = null;
    this.characters = null;
    this.skybox = null;
    this.fragments = null;
    this.blastEffects = null;
    this.scenery = null;
    this.blastOverlay = null;
    this.lastGrid = null;

    this.renderedBuildingIds.clear();
    this.renderedVehicleIds.clear();
    this.renderedEmployeeIds.clear();
  }
}
