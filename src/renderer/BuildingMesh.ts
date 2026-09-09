// BlastSimulator2026 — Building Meshes
// Each building is a model from the library — one .glb per type and tier,
// sized to the footprint the game places it on (assets/models/blender/
// buildings.py reads the same BuildingDefs). Tier 2/3 models are taller and
// their `TintBody` walls brightened; a destroyed building becomes the shared
// rubble model stretched over its footprint. Entry/exit pins float above
// the roof corners so the two doors read from any camera angle.

import * as THREE from 'three';
import type { Building, BuildingType } from '../core/entities/Building.js';
import { getBuildingDef, getDefSize } from '../core/entities/Building.js';
import { tagPickable } from './Pickable.js';
import { modelLibrary, type ModelInstance, type ModelLibrary } from './models/ModelLibrary.js';
import { buildingModelId, BUILDING_RUIN_MODEL_ID } from './models/ModelIds.js';
import { createToonMaterial } from './models/CartoonMaterial.js';

// ---------- Stand-ins ----------

/** Wall material every building model exposes. */
export const BODY_TINT = 'TintBody';
/** Stand-in height while the asset is not loaded: a plinth plus one storey per tier. */
const FALLBACK_STOREY = 1.45;
const FALLBACK_BASE = 0.6;

// ---------- Entry / exit markers ----------

const ENTRY_COLOR  = 0x00cc44;
const EXIT_COLOR   = 0xff4400;
const MARKER_RADIUS = 0.18;
const MARKER_CLEARANCE = 0.35;

// ---------- Destroyed state ----------

/** The rubble model is built on a 2×2 footprint; height follows the shorter side within these bounds. */
const RUIN_MODEL_FOOTPRINT = 2;
const RUIN_HEIGHT_MIN = 0.6;
const RUIN_HEIGHT_MAX = 1.4;

interface BuildingEntry {
  group: THREE.Group;
  instance: ModelInstance;
  markers: THREE.Mesh[];
  building: Building;
}

// ---------- Main class ----------

export class BuildingMesh {
  private readonly scene: THREE.Scene;
  private readonly library: ModelLibrary;
  private readonly buildings = new Map<number, BuildingEntry>();

  constructor(scene: THREE.Scene, library: ModelLibrary = modelLibrary) {
    this.scene = scene;
    this.library = library;
  }

  /**
   * Add a building mesh to the scene.
   * Tier 2/3 buildings are taller and slightly brighter.
   * Entry (green) and exit (orange) markers are added above the roof.
   *
   * @param surfaceY - Terrain surface height under the building's footprint,
   *   as the lowest of its 4 bounding-box corners (`buildingFootprintSurfaceY`
   *   in EntitySync.ts) — a footprint spanning multiple voxel levels sits on
   *   its lowest corner rather than floating or burying the opposite one.
   *   Buildings are static once placed, so unlike vehicles/characters this is
   *   baked into the mesh at construction rather than corrected every frame,
   *   or the building renders at y=0 and sits buried underground (#408).
   */
  addBuilding(building: Building, surfaceY = 0): void {
    const def = getBuildingDef(building.type, building.tier);
    const { sizeX, sizeZ } = getDefSize(def);
    const group = new THREE.Group();
    const { instance, markers } = this.attachModel(group, building);

    // Position: grid cell centre in world coords, resting on the terrain surface
    group.position.set(building.x + sizeX / 2, surfaceY, building.z + sizeZ / 2);

    tagPickable(group, 'building', building.id);
    this.scene.add(group);
    this.buildings.set(building.id, { group, instance, markers, building });
  }

  /**
   * Update an existing building (e.g., damaged or tier upgraded).
   * Removes the old mesh and adds a fresh one.
   */
  updateBuilding(building: Building, surfaceY = 0): void {
    this.removeBuilding(building.id);
    this.addBuilding(building, surfaceY);
  }

  /** Remove a building mesh from the scene. */
  removeBuilding(id: number): void {
    const entry = this.buildings.get(id);
    if (entry) {
      this.scene.remove(entry.group);
      disposeEntry(entry);
      this.buildings.delete(id);
    }
  }

  /** Remove all building meshes. */
  clearAll(): void {
    for (const entry of this.buildings.values()) {
      this.scene.remove(entry.group);
      disposeEntry(entry);
    }
    this.buildings.clear();
  }

  /** Swap any stand-in box for the real model once its asset has loaded. */
  refreshModels(): void {
    for (const entry of this.buildings.values()) {
      if (!entry.instance.isFallback || !this.library.has(modelIdFor(entry.building))) continue;
      entry.group.clear();
      disposeEntry(entry);
      const fresh = this.attachModel(entry.group, entry.building);
      entry.instance = fresh.instance;
      entry.markers = fresh.markers;
    }
  }

  get count(): number {
    return this.buildings.size;
  }

  /** Root objects raycastable for scene picking — one Group per building, tagged in addBuilding(). */
  pickables(): THREE.Object3D[] {
    return Array.from(this.buildings.values(), e => e.group);
  }

  /** Current world-space position of a building's root Group, or null if it isn't rendered. */
  getPosition(id: number): THREE.Vector3 | null {
    return this.buildings.get(id)?.group.position.clone() ?? null;
  }

  /** The model instance drawn for a building, or null — exposes tint materials to tests. */
  getInstance(id: number): ModelInstance | null {
    return this.buildings.get(id)?.instance ?? null;
  }

  dispose(): void {
    this.clearAll();
  }

  /** Instantiate the building's model (or the ruin at hp 0), tint it, and pin its doors. */
  private attachModel(group: THREE.Group, building: Building): { instance: ModelInstance; markers: THREE.Mesh[] } {
    const def = getBuildingDef(building.type, building.tier);
    const { sizeX, sizeZ } = getDefSize(def);
    const isDestroyed = building.hp <= 0;
    const instance = this.library.instantiate(modelIdFor(building), {
      size: [sizeX, isDestroyed ? RUIN_HEIGHT_MIN : FALLBACK_BASE + FALLBACK_STOREY * building.tier, sizeZ],
      tint: BODY_TINT,
    });
    group.add(instance.root);

    if (isDestroyed) {
      // Rubble stretched over the footprint; taller for a bigger building.
      const height = THREE.MathUtils.clamp(Math.min(sizeX, sizeZ) / 2.5, RUIN_HEIGHT_MIN, RUIN_HEIGHT_MAX);
      instance.root.scale.set(sizeX / RUIN_MODEL_FOOTPRINT, height, sizeZ / RUIN_MODEL_FOOTPRINT);
      return { instance, markers: [] };
    }

    // Entry / exit pins — group is centred on footprint, so convert def offsets.
    // They sit above the tallest geometry (#410) so no roof can hide them.
    const roofY = instance.bounds.max.y;
    const ex = def.entryPoint[0] + 0.5 - sizeX / 2;
    const ez = def.entryPoint[1] + 0.5 - sizeZ / 2;
    const xx = def.exitPoint[0]  + 0.5 - sizeX / 2;
    const xz = def.exitPoint[1]  + 0.5 - sizeZ / 2;
    const markers = [makeMarker(ex, ez, ENTRY_COLOR, roofY), makeMarker(xx, xz, EXIT_COLOR, roofY)];
    for (const marker of markers) group.add(marker);
    return { instance, markers };
  }
}

// ---------- Helpers ----------

function modelIdFor(building: Building): string {
  return building.hp <= 0
    ? BUILDING_RUIN_MODEL_ID
    : buildingModelId(building.type as BuildingType, building.tier);
}

function disposeEntry(entry: BuildingEntry): void {
  entry.instance.dispose();
  for (const marker of entry.markers) {
    marker.geometry.dispose();
    (marker.material as THREE.Material).dispose();
  }
}

/**
 * A small toon-shaded pin floating over an entry or exit cell, above the
 * roof so it is never enclosed by the building.
 * @param localX  - X in the building group's local coordinate space (centred on footprint).
 * @param localZ  - Z in the building group's local coordinate space.
 * @param color   - 0x00cc44 for entry (green), 0xff4400 for exit (orange).
 * @param roofY   - Y of the building's highest point in local space.
 */
function makeMarker(localX: number, localZ: number, color: number, roofY: number): THREE.Mesh {
  const geo = new THREE.SphereGeometry(MARKER_RADIUS, 12, 8);
  const mat = createToonMaterial({ color: new THREE.Color(color), name: 'doorMarker' });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(localX, roofY + MARKER_CLEARANCE, localZ);
  return mesh;
}
