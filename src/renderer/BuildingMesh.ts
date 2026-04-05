// BlastSimulator2026 — Building Meshes (Placeholders)
// Each building type is represented by a distinctive colored box/cylinder placeholder.
// Buildings sit on the terrain at their grid position with correct footprint.
//
// Design: bright cartoon colors, distinctive shapes per building type.
// Worker quarters = blue house shape; magazine = red danger box; etc.

import * as THREE from 'three';
import type { Building, BuildingType } from '../core/entities/Building.js';
import { getBuildingDef } from '../core/entities/Building.js';

// ---------- Placeholder config per building type ----------

interface BuildingVisual {
  /** Base color hex. */
  color: number;
  /** Height in game units (1 unit = 1 voxel/metre). */
  height: number;
  /** Optional second tier (stacked element) for visual interest. */
  tier2?: {
    color: number;
    height: number;
    /** Scale relative to base footprint (0–1). */
    scaleXZ: number;
  };
}

const BUILDING_VISUALS: Record<BuildingType, BuildingVisual> = {
  driving_center:       { color: 0x44aaff, height: 3 },
  blasting_academy:     { color: 0xff6600, height: 3, tier2: { color: 0xff3300, height: 1, scaleXZ: 0.7 } },
  management_office:    { color: 0x77bbdd, height: 3, tier2: { color: 0xaaddff, height: 0.5, scaleXZ: 0.95 } },
  geology_lab:          { color: 0x996633, height: 3 },
  research_center:      { color: 0x9944cc, height: 4, tier2: { color: 0xcc66ff, height: 1, scaleXZ: 0.8 } },
  living_quarters:      { color: 0x4488cc, height: 4, tier2: { color: 0x994422, height: 1.5, scaleXZ: 0.9 } },
  explosive_warehouse:  { color: 0xff2222, height: 3 },
  freight_warehouse:    { color: 0x888888, height: 5 },
  vehicle_depot:        { color: 0xddaa22, height: 4 },
};

// ---------- Destroyed building appearance ----------
const DESTROYED_COLOR = 0x333333;

// ---------- Main class ----------

export class BuildingMesh {
  private readonly scene: THREE.Scene;
  private readonly buildings = new Map<number, THREE.Group>();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /**
   * Add a building mesh to the scene.
   * Position is at grid cell (building.x, building.z), sitting on y=0.
   */
  addBuilding(building: Building): void {
    const def = getBuildingDef(building.type, building.tier);
    const vis = BUILDING_VISUALS[building.type];
    const group = new THREE.Group();

    const isDestroyed = building.hp <= 0;
    const baseColor = isDestroyed ? DESTROYED_COLOR : vis.color;

    // Compute bounding-box size from footprint
    const xs = def.footprint.map(([dx]) => dx);
    const zs = def.footprint.map(([, dz]) => dz);
    const sizeX = Math.max(...xs) + 1;
    const sizeZ = Math.max(...zs) + 1;

    // Base box — spans the full footprint
    const baseGeo = new THREE.BoxGeometry(sizeX, vis.height, sizeZ);
    const baseMat = new THREE.MeshPhongMaterial({ color: baseColor, shininess: 20 });
    const baseMesh = new THREE.Mesh(baseGeo, baseMat);
    baseMesh.position.y = vis.height / 2; // sit on ground
    group.add(baseMesh);

    // Optional tier 2 (roof, chimney, cross, etc.)
    if (vis.tier2 && !isDestroyed) {
      const t2 = vis.tier2;
      const t2Geo = new THREE.BoxGeometry(
        sizeX * t2.scaleXZ,
        t2.height,
        sizeZ * t2.scaleXZ,
      );
      const t2Mat = new THREE.MeshPhongMaterial({ color: t2.color, shininess: 15 });
      const t2Mesh = new THREE.Mesh(t2Geo, t2Mat);
      t2Mesh.position.y = vis.height + t2.height / 2;
      group.add(t2Mesh);
    }

    // Position: grid cell centre in world coords
    // Building.x/z are the top-left corner; centre = x + sizeX/2, z + sizeZ/2
    group.position.set(building.x + sizeX / 2, 0, building.z + sizeZ / 2);

    this.scene.add(group);
    this.buildings.set(building.id, group);
  }

  /**
   * Update an existing building (e.g., damaged or destroyed).
   * Rebuilds the mesh in place.
   */
  updateBuilding(building: Building): void {
    this.removeBuilding(building.id);
    this.addBuilding(building);
  }

  /** Remove a building mesh from the scene. */
  removeBuilding(id: number): void {
    const group = this.buildings.get(id);
    if (group) {
      this.scene.remove(group);
      disposeGroup(group);
      this.buildings.delete(id);
    }
  }

  /** Remove all building meshes. */
  clearAll(): void {
    for (const group of this.buildings.values()) {
      this.scene.remove(group);
      disposeGroup(group);
    }
    this.buildings.clear();
  }

  get count(): number {
    return this.buildings.size;
  }

  dispose(): void {
    this.clearAll();
  }
}

// ---------- Helpers ----------

function disposeGroup(group: THREE.Group): void {
  for (const child of group.children) {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      if (Array.isArray(child.material)) {
        child.material.forEach((m) => m.dispose());
      } else {
        (child.material as THREE.Material).dispose();
      }
    }
  }
}
