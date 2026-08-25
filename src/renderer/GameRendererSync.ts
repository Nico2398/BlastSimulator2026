// BlastSimulator2026 — GameRenderer per-call entity/state sync
// Extracted from GameRenderer.ts's private syncEntities()/buildSurveyOverlayOptions()/
// syncSurveyOverlay() — the console-driven "reflect current MiningContext onto
// the already-built scene" step shared by syncFromContext() and finishLevelLoad().

import type { GameState } from '../core/state/GameState.js';
import type { VoxelGrid } from '../core/world/VoxelGrid.js';
import type { WeatherCycleState, WeatherState } from '../core/weather/WeatherCycle.js';
import type { ZoneBounds } from '../core/entities/Zone.js';
import { isInZone } from '../core/entities/Zone.js';
import type { BuildingMesh } from './BuildingMesh.js';
import type { VehicleMesh } from './VehicleMesh.js';
import type { CharacterMesh } from './CharacterMesh.js';
import type { GhostMesh } from './GhostMesh.js';
import type { TaskProgressBar } from './TaskProgressBar.js';
import type { SkyboxWeather } from './SkyboxWeather.js';
import type { CloudLayer } from './ambient/CloudLayer.js';
import type { TerrainMesh } from './TerrainMesh.js';
import { syncEntitySets } from './EntitySync.js';
import { isSurveyStale } from '../core/mining/SurveyCalc.js';
import type { SurveyConfidenceOverlayOptions, SurveyConfidencePoint } from './SurveyConfidenceOverlay.js';

/**
 * Every GameRenderer field syncGameRendererEntities() reads or writes,
 * passed in place of `this` (#767).
 */
export interface SyncDeps {
  state: GameState;
  weatherCycle: WeatherCycleState | undefined;
  buildings: BuildingMesh | null;
  renderedBuildingIds: Set<number>;
  vehicles: VehicleMesh | null;
  renderedVehicleIds: Set<number>;
  characters: CharacterMesh | null;
  renderedEmployeeIds: Set<number>;
  lastGrid: VoxelGrid | null;
  ghosts: GhostMesh | null;
  lastGhostRevision: number;
  terrainMeshRevision: number;
  lastSyncedTerrainRevision: number;
  taskProgress: TaskProgressBar | null;
  skybox: SkyboxWeather | null;
  clouds: CloudLayer | null;
  zone: ZoneBounds | null;
  getTerrainSurfaceY: (x: number, z: number) => number;
  syncSurveyOverlay: (options: SurveyConfidenceOverlayOptions | null) => void;
}

/**
 * Fields syncGameRendererEntities() mutates that the caller (GameRenderer)
 * must write back. `lastWeather` is only present when the original's guard
 * (`this.skybox && ctx.weatherCycle`) would have reassigned it — a
 * null-skybox/present-weatherCycle call must leave the caller's existing
 * value untouched, matching the pre-split behaviour exactly.
 */
export interface SyncResult {
  lastGhostRevision: number;
  lastSyncedTerrainRevision: number;
  lastWeather?: WeatherState;
}

/** Per-call entity/state sync shared by syncFromContext() and finishLevelLoad() (#474, extracted #767). */
export function syncGameRendererEntities(deps: SyncDeps): SyncResult {
  const state = deps.state;
  let lastGhostRevision = deps.lastGhostRevision;
  let lastSyncedTerrainRevision = deps.lastSyncedTerrainRevision;
  let lastWeather: WeatherState | undefined;

  // Sync entities added since last call
  syncEntitySets(
    state, deps.buildings, deps.renderedBuildingIds,
    deps.vehicles, deps.renderedVehicleIds,
    deps.characters, deps.renderedEmployeeIds,
    deps.getTerrainSurfaceY,
  );

  // Place vehicles at terrain surface height (not buried at y=0). This
  // corrects only the instant terrain-surface `y` value via setSurfaceY();
  // x/z motion (including the waiting-queue render offset, #411) is left
  // entirely to the per-frame tween inside VehicleMesh.update() (#520), so
  // this sync never stomps a mid-glide or fused 'waiting' vehicle's x/z.
  if (deps.vehicles && deps.lastGrid) {
    for (const v of state.vehicles.vehicles) {
      if (deps.renderedVehicleIds.has(v.id)) {
        const surfaceY = deps.getTerrainSurfaceY(v.x, v.z);
        deps.vehicles.setSurfaceY(v.id, surfaceY);
      }
    }
  }

  // Place characters at terrain surface height (not buried at y=0)
  if (deps.characters && deps.lastGrid) {
    for (const e of state.employees.employees) {
      if (deps.renderedEmployeeIds.has(e.id)) {
        const surfaceY = deps.getTerrainSurfaceY(e.x, e.z);
        deps.characters.setSurfaceY(e.id, surfaceY);
      }
    }
  }

  // Sync ghost previews for pending actions. Every dispatch sets targetY:0
  // (see employees.ts), so at the terrain's actual height that box renders
  // buried inside solid voxels — snap it onto the surface like vehicles and
  // characters above, or the ghost is queued but never visible (#406).
  //
  // Gated behind a cheap revision dirty-check (#761): the remap +
  // GhostMesh.sync() below is wasted work when neither the ghost-preview
  // queue nor the terrain mesh changed since the last sync — with ~1000
  // queued previews mid-scenario, resyncing on every unrelated console
  // command (movement ticks, drilling, etc.) was measurably expensive.
  if (deps.ghosts) {
    const ghostsDirty = state.ghostPreviewsRevision !== lastGhostRevision;
    const terrainDirty = deps.terrainMeshRevision !== lastSyncedTerrainRevision;
    if (ghostsDirty || terrainDirty) {
      const previews = deps.lastGrid
        ? state.ghostPreviews.map(p => ({ ...p, targetY: deps.getTerrainSurfaceY(p.targetX, p.targetZ) }))
        : state.ghostPreviews;
      deps.ghosts.sync(previews);
      lastGhostRevision = state.ghostPreviewsRevision;
      lastSyncedTerrainRevision = deps.terrainMeshRevision;
    }
  }

  // Task progress bars — reflect the current working/idle state each sync (#546)
  if (deps.taskProgress && deps.characters) {
    deps.taskProgress.sync(
      state.employees.employees,
      state.vehicles.vehicles,
      id => deps.characters!.getGroup(id),
    );
  }

  // Blink employees still inside an active safety zone during clearing
  if (deps.characters) {
    const zone = deps.zone;
    for (const e of state.employees.employees) {
      deps.characters.setEvacuating(e.id, zone !== null && isInZone(e.x, e.z, zone));
    }
  }

  // Sync weather
  if (deps.skybox && deps.weatherCycle) {
    lastWeather = deps.weatherCycle.current;
    deps.skybox.setWeather(deps.weatherCycle.current);
    deps.clouds?.setWeather(deps.weatherCycle.current);
  }

  // Sync survey confidence overlay
  deps.syncSurveyOverlay(
    buildSurveyOverlayOptions(state, deps.lastGrid),
  );

  return {
    lastGhostRevision,
    lastSyncedTerrainRevision,
    ...(lastWeather !== undefined ? { lastWeather } : {}),
  };
}

/**
 * Convert GameState.surveyResults into overlay options. Returns null when
 * there are no survey results or no grid is bound.
 */
export function buildSurveyOverlayOptions(
  state: GameState,
  grid: VoxelGrid | null,
): SurveyConfidenceOverlayOptions | null {
  if (state.surveyResults.length === 0 || !grid) return null;

  const currentTick = state.tickCount;
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
 * Sync survey confidence overlay from the current game state. Gated on both
 * "is there data" (options) and the player's visibility preference (#496) —
 * either being false hides the overlay.
 */
export function syncSurveyOverlay(
  terrain: TerrainMesh | null,
  options: SurveyConfidenceOverlayOptions | null,
  visibilityPreference: boolean,
): void {
  if (!terrain) return;

  const overlay = terrain.getSurveyOverlay();
  if (options && options.points.length > 0 && visibilityPreference) {
    overlay.show(options);
  } else {
    overlay.hide();
  }
}
