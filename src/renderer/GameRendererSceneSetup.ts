// BlastSimulator2026 — GameRenderer scene setup/teardown (skeleton, #767)
// Extracted from GameRenderer.ts: the staged level-load pipeline
// (buildPlayableMesh / buildLandscapeMesh / buildAmbient, #474), camera
// framing/pan-leash, and full scene teardown.
//
// Skeleton phase only: signatures/types are final, bodies are stubs.
// Real logic moves here at implementation phase (#767).

import type { MiningContext } from '../console/commands/mining.js';
import type { LandscapeHandle } from '../console/commands/world.js';
import type { VoxelGrid } from '../core/world/VoxelGrid.js';
import type { SceneManager } from './SceneManager.js';
import type { TerrainMesh } from './TerrainMesh.js';
import type { BuildingMesh } from './BuildingMesh.js';
import type { VehicleMesh } from './VehicleMesh.js';
import type { CharacterMesh } from './CharacterMesh.js';
import type { TaskProgressBar } from './TaskProgressBar.js';
import type { SkyboxWeather } from './SkyboxWeather.js';
import type { WindState } from './ambient/WindState.js';
import type { CloudLayer } from './ambient/CloudLayer.js';
import type { BirdFlocks } from './ambient/BirdFlocks.js';
import type { ChimneySmoke } from './ambient/ChimneySmoke.js';
import type { WaterSurface } from './ambient/WaterSurface.js';
import type { VegetationSway } from './ambient/VegetationSway.js';
import type { DustDevils } from './ambient/DustDevils.js';
import type { Fireflies } from './ambient/Fireflies.js';
import type { AmbientUniforms } from './ambient/AmbientUniforms.js';
import type { FragmentMesh } from './FragmentMesh.js';
import type { FragmentAnimator } from './FragmentAnimator.js';
import type { BlastEffects } from './BlastEffects.js';
import type { LandscapeMesh, PlayableCut } from './terrain/LandscapeMesh.js';
import type { WorldBorderWall } from './WorldBorderWall.js';
import type { BlastPlanOverlay } from './BlastPlanOverlay.js';
import type { GhostMesh } from './GhostMesh.js';

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
  playableCut: (grid: VoxelGrid) => PlayableCut;
  rebuildBorderWall: (ctx: MiningContext) => void;
  siteBoundsChanged: (grid: VoxelGrid | null) => boolean;
}

/** Whole-scene rebuild on a new game/level (#474: runs all three load stages, then frames the camera). */
export function loadGame(deps: SceneSetupDeps, ctx: MiningContext): void {
  void deps;
  void ctx;
  // TODO: implement (#767)
  throw new Error('not implemented — see #767');
}

/** Stage 1 of a level load (#474): playable terrain mesh, buildings, vehicles, characters, sky, fragments, overlays. */
export function buildPlayableMesh(deps: SceneSetupDeps, ctx: MiningContext): void {
  void deps;
  void ctx;
  // TODO: implement (#767)
  throw new Error('not implemented — see #767');
}

/** Stage 2 of a level load (#474): the landscape zone, aerial-perspective calibration, and the border wall. */
export function buildLandscapeMesh(deps: SceneSetupDeps, ctx: MiningContext): void {
  void deps;
  void ctx;
  // TODO: implement (#767)
  throw new Error('not implemented — see #767');
}

/** Stage 3 of a level load (#474): birds, chimney smoke, water, vegetation sway, per-biome dust-devil/firefly extras. */
export function buildAmbient(deps: SceneSetupDeps, ctx: MiningContext): void {
  void deps;
  void ctx;
  // TODO: implement (#767)
  throw new Error('not implemented — see #767');
}

/** Centre the camera on the loaded grid and pull back far enough to show all of it. */
export function frameCameraOnGrid(deps: SceneSetupDeps): void {
  void deps;
  // TODO: implement (#767)
  throw new Error('not implemented — see #767');
}

/** Re-leash the camera to the landscape's fixed generation extent (#558). */
export function refreshPanLeash(deps: SceneSetupDeps): void {
  void deps;
  // TODO: implement (#767)
  throw new Error('not implemented — see #767');
}

/** Dispose every scene object and reset load/sync bookkeeping fields. */
export function clearAll(deps: SceneSetupDeps): void {
  void deps;
  // TODO: implement (#767)
  throw new Error('not implemented — see #767');
}
