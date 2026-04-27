// BlastSimulator2026 — Vehicle Meshes
// Recognizable silhouettes, cartoon yellow. Tier 2/3 vehicles are scaled up
// and color-brightened via applyTierVariation().
//
// Shapes:
//   debris_hauler     → yellow box body + 4 wheel cylinders
//   rock_digger       → yellow box body + arm (cylinder) + bucket (small box)
//   drill_rig         → tall grey cylinder with yellow top
//   building_destroyer → low yellow box + front blade (flat box)
//   rock_fragmenter   → yellow box body + crusher head
//
// Vehicles move smoothly to their target position via lerp each frame.

import * as THREE from 'three';
import type { Vehicle, VehicleRole, VehicleTier } from '../core/entities/Vehicle.js';

// ---------- Colors ----------
const YELLOW = 0xf5c518;   // Caterpillar yellow
const DARK_GREY = 0x444444; // Tracks / wheels
const STEEL = 0x8888aa;     // Drill rig body
const ORANGE = 0xff7700;    // Accent / active highlight

// ---------- Tier variation ----------
const TIER_SCALE_MULT: Record<VehicleTier, number> = { 1: 1.0, 2: 1.15, 3: 1.3 };
const TIER_BRIGHT_SHIFT: Record<VehicleTier, number> = { 1: 0.0, 2: 0.12, 3: 0.26 };

// ---------- Vehicle visual builders ----------

type GroupBuilder = () => THREE.Group;

const VEHICLE_BUILDERS: Record<VehicleRole, GroupBuilder> = {
  debris_hauler: () => {
    const g = new THREE.Group();
    // Body
    const body = boxMesh(2.5, 1.2, 1.4, YELLOW);
    body.position.set(0, 0.8, 0);
    g.add(body);
    // Cabin
    const cab = boxMesh(0.9, 0.8, 1.3, YELLOW);
    cab.position.set(-0.6, 1.8, 0);
    g.add(cab);
    // 4 wheels
    for (const [wx, wz] of [[0.8, 0.8], [0.8, -0.8], [-0.8, 0.8], [-0.8, -0.8]] as const) {
      const wheel = cylinderMesh(0.35, 0.25, DARK_GREY);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(wx, 0.35, wz);
      g.add(wheel);
    }
    return g;
  },

  rock_digger: () => {
    const g = new THREE.Group();
    // Tracks (flat boxes)
    for (const wz of [0.7, -0.7] as const) {
      const track = boxMesh(2.2, 0.3, 0.4, DARK_GREY);
      track.position.set(0, 0.15, wz);
      g.add(track);
    }
    // Cab body
    const body = boxMesh(1.2, 1.0, 1.2, YELLOW);
    body.position.set(0, 0.8, 0);
    g.add(body);
    // Arm (cylinder pointing forward-up)
    const arm = cylinderMesh(0.12, 1.6, STEEL);
    arm.rotation.z = -Math.PI / 4;
    arm.position.set(0.9, 1.5, 0);
    g.add(arm);
    // Bucket
    const bucket = boxMesh(0.4, 0.25, 0.5, STEEL);
    bucket.position.set(1.7, 0.8, 0);
    g.add(bucket);
    return g;
  },

  drill_rig: () => {
    const g = new THREE.Group();
    // Base platform
    const base = boxMesh(1.5, 0.4, 1.5, DARK_GREY);
    base.position.y = 0.2;
    g.add(base);
    // Tower (tall cylinder)
    const tower = cylinderMesh(0.2, 5.0, STEEL);
    tower.position.y = 2.7;
    g.add(tower);
    // Top drum
    const drum = cylinderMesh(0.4, 0.4, YELLOW);
    drum.position.y = 5.4;
    g.add(drum);
    // Cross-struts
    for (const angle of [0, Math.PI / 2]) {
      const strut = boxMesh(0.06, 3.0, 0.06, DARK_GREY);
      strut.rotation.y = angle;
      strut.position.y = 2.5;
      g.add(strut);
    }
    return g;
  },

  building_destroyer: () => {
    const g = new THREE.Group();
    // Tracks
    for (const wz of [0.6, -0.6] as const) {
      const track = boxMesh(2.4, 0.35, 0.35, DARK_GREY);
      track.position.set(0, 0.175, wz);
      g.add(track);
    }
    // Body
    const body = boxMesh(1.6, 0.9, 1.0, YELLOW);
    body.position.set(0, 0.75, 0);
    g.add(body);
    // Engine hood
    const hood = boxMesh(0.7, 0.5, 0.9, ORANGE);
    hood.position.set(-0.65, 1.05, 0);
    g.add(hood);
    // Blade
    const blade = boxMesh(0.15, 0.9, 1.6, STEEL);
    blade.position.set(0.95, 0.65, 0);
    g.add(blade);
    return g;
  },

  rock_fragmenter: () => {
    const g = new THREE.Group();
    // Tracks
    for (const wz of [0.6, -0.6] as const) {
      const track = boxMesh(2.2, 0.35, 0.35, DARK_GREY);
      track.position.set(0, 0.175, wz);
      g.add(track);
    }
    // Body
    const body = boxMesh(1.5, 0.85, 1.0, YELLOW);
    body.position.set(0, 0.7, 0);
    g.add(body);
    // Crusher head
    const crusher = boxMesh(0.5, 0.7, 1.4, STEEL);
    crusher.position.set(0.9, 0.6, 0);
    g.add(crusher);
    return g;
  },
};

// ---------- Movement lerp speed ----------
// Fraction of remaining distance covered per frame (smooth follow)
const MOVE_LERP = 0.08;

// ---------- Main class ----------

export class VehicleMesh {
  private readonly scene: THREE.Scene;
  private readonly vehicles = new Map<number, { group: THREE.Group; vehicle: Vehicle }>();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  addVehicle(vehicle: Vehicle): void {
    const builder = VEHICLE_BUILDERS[vehicle.type];
    const group = builder();
    applyTierVariation(group, vehicle.tier);
    group.position.set(vehicle.x, 0, vehicle.z);
    this.scene.add(group);
    this.vehicles.set(vehicle.id, { group, vehicle });
  }

  /**
   * Update vehicle positions. Call every frame.
   * Lerps toward the target position to give smooth movement.
   */
  update(vehicles: Vehicle[]): void {
    for (const v of vehicles) {
      const entry = this.vehicles.get(v.id);
      if (!entry) continue;
      // Update stored reference
      entry.vehicle = v;
      // Lerp toward target
      entry.group.position.x += (v.x - entry.group.position.x) * MOVE_LERP;
      entry.group.position.z += (v.z - entry.group.position.z) * MOVE_LERP;
    }
  }

  /** Snap a vehicle directly to its position (no lerp — use after teleport). */
  snapPosition(vehicleId: number, x: number, z: number): void {
    const entry = this.vehicles.get(vehicleId);
    if (entry) {
      entry.group.position.set(x, 0, z);
    }
  }

  removeVehicle(vehicleId: number): void {
    const entry = this.vehicles.get(vehicleId);
    if (entry) {
      this.scene.remove(entry.group);
      disposeGroup(entry.group);
      this.vehicles.delete(vehicleId);
    }
  }

  clearAll(): void {
    for (const { group } of this.vehicles.values()) {
      this.scene.remove(group);
      disposeGroup(group);
    }
    this.vehicles.clear();
  }

  get count(): number {
    return this.vehicles.size;
  }

  dispose(): void {
    this.clearAll();
  }
}

// ---------- Helpers ----------

function boxMesh(w: number, h: number, d: number, color: number): THREE.Mesh {
  const geo = new THREE.BoxGeometry(w, h, d);
  const mat = new THREE.MeshPhongMaterial({ color, shininess: 25 });
  return new THREE.Mesh(geo, mat);
}

function cylinderMesh(radius: number, height: number, color: number): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(radius, radius, height, 8);
  const mat = new THREE.MeshPhongMaterial({ color, shininess: 20 });
  return new THREE.Mesh(geo, mat);
}

function disposeGroup(group: THREE.Group): void {
  for (const child of group.children) {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      (child.material as THREE.Material).dispose();
    }
  }
}

/**
 * Linearly brighten a packed hex color toward white.
 * @param hex   - e.g. 0xf5c518
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

function applyTierVariation(group: THREE.Group, tier: VehicleTier): void {
  group.scale.setScalar(TIER_SCALE_MULT[tier]);
  const shift = TIER_BRIGHT_SHIFT[tier];
  if (shift > 0) {
    group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        const mat = obj.material as THREE.MeshPhongMaterial;
        mat.color.setHex(brightenColor(mat.color.getHex(), shift));
      }
    });
  }
}
