// BlastSimulator2026 — GameRenderer raycasting/scene-picking helpers (skeleton, #767)
// Extracted from GameRenderer.ts: terrain-surface raycasting, entity
// pickables list, and fragment-id/entity-position resolution for hover and
// click handling.
//
// Skeleton phase only: signatures/types are final, bodies are stubs.
// Real logic moves here at implementation phase (#767).

import type * as THREE from 'three';
import type { TerrainMesh } from './TerrainMesh.js';
import type { LandscapeMesh } from './terrain/LandscapeMesh.js';
import type { BuildingMesh } from './BuildingMesh.js';
import type { VehicleMesh } from './VehicleMesh.js';
import type { CharacterMesh } from './CharacterMesh.js';
import type { FragmentMesh } from './FragmentMesh.js';
import type { BlastPlanOverlay } from './BlastPlanOverlay.js';

/** Mutable GameRenderer fields these picking helpers read, passed in place of `this` (#767). */
export interface PickingDeps {
  terrain: TerrainMesh | null;
  landscape: LandscapeMesh | null;
  buildings: BuildingMesh | null;
  vehicles: VehicleMesh | null;
  characters: CharacterMesh | null;
  fragments: FragmentMesh | null;
  blastOverlay: BlastPlanOverlay | null;
  getTerrainSurfaceY: (x: number, z: number) => number;
}

/** Exact rendered-mesh height at (x, z), found by raycasting straight down. Null off the terrain. */
export function raycastSurfaceY(deps: PickingDeps, x: number, z: number): number | null {
  void deps;
  void x;
  void z;
  // TODO: implement (#767)
  return null;
}

/** Terrain-only hit for a camera ray through NDC (ndcX, ndcY). */
export function raycastTerrainFromNDC(
  deps: PickingDeps,
  ndcX: number,
  ndcY: number,
  camera: THREE.Camera,
): THREE.Vector3 | null {
  void deps;
  void ndcX;
  void ndcY;
  void camera;
  // TODO: implement (#767)
  return null;
}

/** First hit against the terrain meshes, falling back to the landscape meshes past the site's claimed edge (#558). */
export function raycastTerrainOrLandscape(
  deps: PickingDeps,
  raycaster: THREE.Raycaster,
): THREE.Intersection | undefined {
  void deps;
  void raycaster;
  // TODO: implement (#767)
  return undefined;
}

/** Public wrapper around getTerrainSurfaceY, used by the scenario camera bridge (#410). */
export function surfaceYAt(deps: PickingDeps, x: number, z: number): number {
  void deps;
  void x;
  void z;
  // TODO: implement (#767)
  return 0;
}

/** Every entity root object raycastable for scene picking (P2/P4). */
export function pickables(deps: PickingDeps): THREE.Object3D[] {
  void deps;
  // TODO: implement (#767)
  return [];
}

/** Resolve a fragment-bucket raycast hit (bucketIndex, instanceId) to the fragment id occupying that slot. */
export function resolveFragmentId(deps: PickingDeps, bucketIndex: number, instanceId: number): number | null {
  void deps;
  void bucketIndex;
  void instanceId;
  // TODO: implement (#767)
  return null;
}

/** Current world-space position of a live entity, for hover-tag/highlight placement. */
export function entityWorldPosition(
  deps: PickingDeps,
  kind: 'building' | 'vehicle' | 'employee' | 'fragment' | 'hole',
  id: number,
): THREE.Vector3 | null {
  void deps;
  void kind;
  void id;
  // TODO: implement (#767)
  return null;
}
