// BlastSimulator2026 — GameRenderer per-call entity/state sync (skeleton, #767)
// Extracted from GameRenderer.ts's private syncEntities()/buildSurveyOverlayOptions()/
// syncSurveyOverlay() — the console-driven "reflect current MiningContext onto
// the already-built scene" step shared by syncFromContext() and finishLevelLoad().
//
// Skeleton phase only: signatures/types are final, bodies are stubs.
// Real logic moves here at implementation phase (#767).

import type { GameState } from '../core/state/GameState.js';
import type { VoxelGrid } from '../core/world/VoxelGrid.js';
import type { WeatherCycleState, WeatherState } from '../core/weather/WeatherCycle.js';
import type { ZoneBounds } from '../core/entities/Zone.js';
import type { BuildingMesh } from './BuildingMesh.js';
import type { VehicleMesh } from './VehicleMesh.js';
import type { CharacterMesh } from './CharacterMesh.js';
import type { GhostMesh } from './GhostMesh.js';
import type { TaskProgressBar } from './TaskProgressBar.js';
import type { SkyboxWeather } from './SkyboxWeather.js';
import type { CloudLayer } from './ambient/CloudLayer.js';
import type { TerrainMesh } from './TerrainMesh.js';
import type { SurveyConfidenceOverlayOptions } from './SurveyConfidenceOverlay.js';

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

/** Fields syncGameRendererEntities() mutates that the caller (GameRenderer) must write back. */
export interface SyncResult {
  lastGhostRevision: number;
  lastSyncedTerrainRevision: number;
  lastWeather: WeatherState;
}

/** Per-call entity/state sync shared by syncFromContext() and finishLevelLoad() (#474, extracted #767). */
export function syncGameRendererEntities(deps: SyncDeps): SyncResult {
  void deps;
  // TODO: implement (#767)
  throw new Error('not implemented — see #767');
}

/**
 * Convert GameState.surveyResults into overlay options. Returns null when
 * there are no survey results or no grid is bound.
 */
export function buildSurveyOverlayOptions(
  state: GameState,
  grid: VoxelGrid | null,
): SurveyConfidenceOverlayOptions | null {
  void state;
  void grid;
  // TODO: implement (#767)
  return null;
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
  void terrain;
  void options;
  void visibilityPreference;
  // TODO: implement (#767)
}
