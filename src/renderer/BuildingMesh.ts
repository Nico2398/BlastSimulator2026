// BlastSimulator2026 — Building Meshes
// Each building type is represented by a distinctive colored box placeholder.
// Tier 2/3 buildings are taller and brightened; entry/exit points shown as markers.
//
// Design: bright cartoon colors, distinctive shapes per building type.

import * as THREE from 'three';
import type { Building, BuildingType } from '../core/entities/Building.js';
import { getBuildingDef, getDefSize } from '../core/entities/Building.js';

// ---------- Per-type visual config ----------

interface BuildingVisual {
  /** Base color hex (tier 1). */
  color: number;
  /** Base height in game units (1 unit = 1 voxel). */
  height: number;
  /** Optional accent element stacked on top (roof, chimney, etc.). */
  accent?: { color: number; height: number; scaleXZ: number };
}

const BUILDING_VISUALS: Record<BuildingType, BuildingVisual> = {
  driving_center:       { color: 0x44aaff, height: 3 },
  blasting_academy:     { color: 0xff6600, height: 3, accent: { color: 0xff3300, height: 1,   scaleXZ: 0.7  } },
  management_office:    { color: 0x77bbdd, height: 3, accent: { color: 0xaaddff, height: 0.5, scaleXZ: 0.95 } },
  geology_lab:          { color: 0x996633, height: 3 },
  research_center:      { color: 0x9944cc, height: 4, accent: { color: 0xcc66ff, height: 1,   scaleXZ: 0.8  } },
  living_quarters:      { color: 0x4488cc, height: 4, accent: { color: 0x994422, height: 1.5, scaleXZ: 0.9  } },
  explosive_warehouse:  { color: 0xff2222, height: 3 },
  freight_warehouse:    { color: 0x888888, height: 5 },
  vehicle_depot:        { color: 0xddaa22, height: 4 },
};

// ---------- Tier scaling ----------

/** Height multiplier per tier: taller buildings at higher tiers. */
const TIER_HEIGHT_MULT: Record<1 | 2 | 3, number> = { 1: 1.0, 2: 1.5, 3: 2.0 };
/** Colour brightening shift per tier (0 = no shift, 1 = white). */
const TIER_BRIGHT_SHIFT: Record<1 | 2 | 3, number> = { 1: 0.0, 2: 0.12, 3: 0.26 };

// ---------- Entry / exit markers ----------

const ENTRY_COLOR  = 0x00cc44;
const EXIT_COLOR   = 0xff4400;
const MARKER_SIZE   = 0.35;
const MARKER_HEIGHT = 0.5;

// ---------- Destroyed state ----------

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
   * Tier 2/3 buildings are taller and slightly brighter.
   * Entry (green) and exit (orange) markers are added at ground level.
   */
  addBuilding(building: Building): void {
    const def = getBuildingDef(building.type, building.tier);
    const vis = BUILDING_VISUALS[building.type];
    const group = new THREE.Group();

    const isDestroyed = building.hp <= 0;
    const tier = building.tier as 1 | 2 | 3;
    const heightMult  = TIER_HEIGHT_MULT[tier];
    const brightShift = TIER_BRIGHT_SHIFT[tier];
    const scaledHeight = vis.height * heightMult;

    const baseColor = isDestroyed ? DESTROYED_COLOR : brightenColor(vis.color, brightShift);

    // Use cached bounding-box size derived from the def's footprint
    const { sizeX, sizeZ } = getDefSize(def);

    // Base box — spans the full footprint
    const baseGeo = new THREE.BoxGeometry(sizeX, scaledHeight, sizeZ);
    const baseMat = new THREE.MeshPhongMaterial({ color: baseColor, shininess: 20 });
    const baseMesh = new THREE.Mesh(baseGeo, baseMat);
    baseMesh.position.y = scaledHeight / 2;
    group.add(baseMesh);

    // Accent element (roof, chimney, etc.) — only for intact buildings
    if (vis.accent && !isDestroyed) {
      const ac = vis.accent;
      const acHeight = ac.height * heightMult;
      const acGeo = new THREE.BoxGeometry(sizeX * ac.scaleXZ, acHeight, sizeZ * ac.scaleXZ);
      const acMat = new THREE.MeshPhongMaterial({
        color: brightenColor(ac.color, brightShift),
        shininess: 15,
      });
      const acMesh = new THREE.Mesh(acGeo, acMat);
      acMesh.position.y = scaledHeight + acHeight / 2;
      group.add(acMesh);
    }

    // Entry / exit markers — group is centred on footprint, so convert def offsets
    if (!isDestroyed) {
      const ex = def.entryPoint[0] + 0.5 - sizeX / 2;
      const ez = def.entryPoint[1] + 0.5 - sizeZ / 2;
      const xx = def.exitPoint[0]  + 0.5 - sizeX / 2;
      const xz = def.exitPoint[1]  + 0.5 - sizeZ / 2;
      group.add(makeMarker(ex, ez, ENTRY_COLOR));
      group.add(makeMarker(xx, xz, EXIT_COLOR));
    }

    // Position: grid cell centre in world coords
    group.position.set(building.x + sizeX / 2, 0, building.z + sizeZ / 2);

    this.scene.add(group);
    this.buildings.set(building.id, group);
  }

  /**
   * Update an existing building (e.g., damaged or tier upgraded).
   * Removes the old mesh and adds a fresh one.
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

/**
 * Linearly brighten a packed hex colour toward white.
 * @param hex   - e.g. 0xff6600
 * @param shift - 0 = unchanged, 1 = white
 */
function brightenColor(hex: number, shift: number): number {
  if (shift <= 0) return hex;
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8)  & 0xff;
  const b =  hex        & 0xff;
  return (
    (Math.round(r + (0xff - r) * shift) << 16) |
    (Math.round(g + (0xff - g) * shift) << 8)  |
     Math.round(b + (0xff - b) * shift)
  );
}

/**
 * Small flat cube marking an entry or exit point.
 * @param localX - X in the building group's local coordinate space (centred on footprint).
 * @param localZ - Z in the building group's local coordinate space.
 * @param color  - 0x00cc44 for entry (green), 0xff4400 for exit (orange).
 */
function makeMarker(localX: number, localZ: number, color: number): THREE.Mesh {
  const geo = new THREE.BoxGeometry(MARKER_SIZE, MARKER_HEIGHT, MARKER_SIZE);
  const mat = new THREE.MeshPhongMaterial({ color, shininess: 60 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(localX, MARKER_HEIGHT / 2, localZ);
  return mesh;
}
