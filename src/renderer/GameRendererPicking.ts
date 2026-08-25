// BlastSimulator2026 — GameRenderer raycasting/scene-picking helpers
// Extracted from GameRenderer.ts: terrain-surface raycasting, entity
// pickables list, and fragment-id/entity-position resolution for hover and
// click handling.

import * as THREE from 'three';
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

/**
 * Exact rendered-mesh height at (x, z), found by raycasting straight down
 * through the terrain meshes — unlike surfaceYAt's voxel-column lookup,
 * this matches the smoothed mesh surface a pointer raycast actually hits.
 * Returns null off the terrain (no grid, or (x, z) outside every chunk).
 */
export function raycastSurfaceY(deps: PickingDeps, x: number, z: number): number | null {
  if (!deps.terrain) return null;
  const raycaster = new THREE.Raycaster(new THREE.Vector3(x, 10_000, z), new THREE.Vector3(0, -1, 0));
  const hit = raycastTerrainOrLandscape(deps, raycaster);
  return hit ? hit.point.y : null;
}

/**
 * Terrain-only hit for a camera ray through NDC (ndcX, ndcY) — the same
 * raycast a real pointer click resolves via ScenePicking/PlacementController,
 * without pulling in their entity/hover machinery.
 */
export function raycastTerrainFromNDC(
  deps: PickingDeps,
  ndcX: number,
  ndcY: number,
  camera: THREE.Camera,
): THREE.Vector3 | null {
  if (!deps.terrain) return null;
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
  const hit = raycastTerrainOrLandscape(deps, raycaster);
  return hit ? hit.point.clone() : null;
}

/**
 * First hit against the terrain meshes, falling back to the landscape
 * meshes past the site's claimed edge (#558) when terrain misses. Shared
 * by raycastSurfaceY (vertical ray) and raycastTerrainFromNDC (camera ray)
 * — both need the same terrain-then-landscape fallback, only the ray
 * differs.
 */
export function raycastTerrainOrLandscape(
  deps: PickingDeps,
  raycaster: THREE.Raycaster,
): THREE.Intersection | undefined {
  if (!deps.terrain) return undefined;
  const hit = raycaster.intersectObjects(deps.terrain.meshes, true)[0];
  if (hit) return hit;
  return deps.landscape ? raycaster.intersectObjects(deps.landscape.meshes, true)[0] : undefined;
}

/**
 * Public wrapper around `getTerrainSurfaceY`, used by the scenario camera
 * bridge (`window.__cameraFocus`) so a scripted shot can centre on a world
 * (x, z) point at the correct terrain height without duplicating the voxel
 * lookup (#410).
 */
export function surfaceYAt(deps: PickingDeps, x: number, z: number): number {
  return deps.getTerrainSurfaceY(x, z);
}

/**
 * Every entity root object raycastable for scene picking (P2/P4): buildings,
 * vehicles, employees, the 8 fragment shape buckets, and the current blast
 * plan's drill holes. Terrain is raycast separately via `terrain.meshes` —
 * it's a fallback hit, not an entity, and callers usually want to know when
 * nothing else was hit.
 */
export function pickables(deps: PickingDeps): THREE.Object3D[] {
  return [
    ...(deps.buildings?.pickables() ?? []),
    ...(deps.vehicles?.pickables() ?? []),
    ...(deps.characters?.pickables() ?? []),
    ...(deps.fragments?.pickables() ?? []),
    ...(deps.blastOverlay?.pickables() ?? []),
  ];
}

/** Resolve a fragment-bucket raycast hit (bucketIndex, instanceId) to the fragment id occupying that slot. */
export function resolveFragmentId(deps: PickingDeps, bucketIndex: number, instanceId: number): number | null {
  return deps.fragments?.fragmentIdAt(bucketIndex, instanceId) ?? null;
}

/**
 * Current world-space position of a live entity, for hover-tag/highlight
 * placement. Buildings/vehicles/employees read their Group's position
 * directly; fragments resolve through their InstancedMesh slot; holes
 * resolve through the blast plan overlay's per-hole surface anchor. Null
 * when the entity isn't currently rendered (removed, or never synced).
 */
export function entityWorldPosition(
  deps: PickingDeps,
  kind: 'building' | 'vehicle' | 'employee' | 'fragment' | 'hole',
  id: number,
): THREE.Vector3 | null {
  switch (kind) {
    case 'building': return deps.buildings?.getPosition(id) ?? null;
    case 'vehicle': return deps.vehicles?.getPosition(id) ?? null;
    case 'employee': return deps.characters?.getPosition(id) ?? null;
    case 'fragment': return deps.fragments?.fragmentPosition(id) ?? null;
    case 'hole': return deps.blastOverlay?.getHolePosition(id) ?? null;
  }
}
