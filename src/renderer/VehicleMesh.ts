// BlastSimulator2026 — Vehicle Meshes
// Each vehicle is a model from the library (one .glb per role, built in
// assets/models/blender/vehicles.py): dump truck, excavator, drill rig,
// bulldozer, mobile crusher. Tier 2/3 vehicles are scaled up and their
// `TintBody` paint brightened. Vehicles turn to face their direction of
// travel; wheel nodes spin with distance covered and the crusher's flywheel
// turns while it works.
//
// Vehicles move smoothly to their target position via a duration-aware
// tween each frame (#520 — see MovementInterpolation.ts).

import * as THREE from 'three';
import { brightenColor } from './MeshUtils.js';
import type { Vehicle, VehicleTier, VehicleOperationalState } from '../core/entities/Vehicle.js';
import { waitingQueueOffset, waitingRenderPosition } from './VehicleWaitingQueue.js';
import { tagPickable } from './Pickable.js';
import { createTween, stepTween, type MovementTween } from './MovementInterpolation.js';
import { headingFromDelta, turnToward } from './Heading.js';
import { modelLibrary, type ModelInstance, type ModelLibrary } from './models/ModelLibrary.js';
import { vehicleModelId } from './models/ModelIds.js';
import { createToonMaterial } from './models/CartoonMaterial.js';

// ---------- Tier variation ----------
const TIER_SCALE_MULT: Record<VehicleTier, number> = { 1: 1.0, 2: 1.15, 3: 1.3 };
const TIER_BRIGHT_SHIFT: Record<VehicleTier, number> = { 1: 0.0, 2: 0.12, 3: 0.26 };

/** Paint material every vehicle model exposes. */
export const BODY_TINT = 'TintBody';
/** Stand-in box while the asset is not loaded: a truck-sized envelope. */
const FALLBACK_SIZE = [2.6, 1.8, 1.5] as const;

// ---------- Motion ----------
/** Below this ground speed (m/s) a vehicle is parked. */
const MOVE_SPEED_MIN = 0.05;
/** Turn rate toward the direction of travel (rad/s) — slower than a worker, it is a truck. */
const TURN_RATE = 4;
/** Wheel radius the models are built with (m); spin = distance / radius. */
const WHEEL_RADIUS = 0.42;
/** Flywheel spin while working (rad/s). */
const FLYWHEEL_RATE = 6;

interface VehicleEntry {
  group: THREE.Group;
  instance: ModelInstance;
  vehicle: Vehicle;
  tween: MovementTween;
  wheels: THREE.Object3D[];
  flywheel: THREE.Object3D | null;
}

// ---------- Main class ----------

export class VehicleMesh {
  private readonly scene: THREE.Scene;
  private readonly library: ModelLibrary;
  private readonly vehicles = new Map<number, VehicleEntry>();

  constructor(scene: THREE.Scene, library: ModelLibrary = modelLibrary) {
    this.scene = scene;
    this.library = library;
  }

  /** Add a vehicle mesh to the scene at its position, optionally on a terrain surface. */
  addVehicle(vehicle: Vehicle, surfaceY: number = 0): void {
    const group = new THREE.Group();
    const entry = this.attachModel(group, vehicle);
    applyTierVariation(group, entry.instance, vehicle.tier);
    applyStateIndicator(group, vehicle.state, stateIndicatorHeight(entry.instance));
    const pool = [...Array.from(this.vehicles.values(), e => e.vehicle), vehicle];
    const [renderX, renderZ] = this.waitingRenderPosition(vehicle, pool);
    group.position.set(renderX, surfaceY, renderZ);
    tagPickable(group, 'vehicle', vehicle.id);
    this.scene.add(group);
    this.vehicles.set(vehicle.id, { ...entry, vehicle, tween: createTween(renderX, renderZ) });
  }

  /**
   * Update vehicle positions. Call every frame.
   * Eases toward the target position (duration-aware tween, #520) to give
   * smooth movement.
   */
  update(vehicles: Vehicle[], dt: number): void {
    for (const v of vehicles) {
      const entry = this.vehicles.get(v.id);
      if (!entry) continue;
      // Update stored reference
      entry.vehicle = v;
      // Ease toward target (+ queue offset for fused 'waiting' vehicles, #411 round 2)
      const [targetX, targetZ] = this.waitingRenderPosition(v, vehicles);
      const fromX = entry.group.position.x;
      const fromZ = entry.group.position.z;
      const eased = stepTween(entry.tween, fromX, fromZ, targetX, targetZ, dt);
      entry.group.position.x = eased.x;
      entry.group.position.z = eased.z;
      this.animateMotion(entry, eased.x - fromX, eased.z - fromZ, dt);
      applyStateIndicator(entry.group, v.state);
    }
  }

  /**
   * Render-only offset for a 'waiting' vehicle sharing its target cell with
   * others (#411 round 2) — thin delegate to VehicleWaitingQueue.ts, kept as
   * an instance method so callers/tests don't need a second import.
   */
  waitingQueueOffset(vehicle: Vehicle, pool: Vehicle[]): readonly [number, number] {
    return waitingQueueOffset(vehicle, pool);
  }

  /**
   * Render position for a vehicle, folding in the waiting-queue slot offset
   * (#411 round 4) — thin delegate to VehicleWaitingQueue.ts.
   */
  waitingRenderPosition(vehicle: Vehicle, pool: Vehicle[]): readonly [number, number] {
    return waitingRenderPosition(vehicle, pool);
  }

  /** Snap a vehicle directly to its world position (no tween — use after teleport or initial placement). */
  snapPosition(vehicleId: number, x: number, y: number, z: number): void {
    const entry = this.vehicles.get(vehicleId);
    if (entry) {
      entry.group.position.set(x, y, z);
      entry.tween = createTween(x, z);
    }
  }

  /**
   * Correct a vehicle's terrain-surface Y immediately, leaving x/z motion
   * to the eased tween (#520 — GameRenderer.syncFromContext() should no
   * longer hard-snap x/z every sync).
   */
  setSurfaceY(vehicleId: number, y: number): void {
    const entry = this.vehicles.get(vehicleId);
    if (entry) {
      entry.group.position.y = y;
    }
  }

  removeVehicle(vehicleId: number): void {
    const entry = this.vehicles.get(vehicleId);
    if (entry) {
      this.scene.remove(entry.group);
      disposeEntry(entry);
      this.vehicles.delete(vehicleId);
    }
  }

  clearAll(): void {
    for (const entry of this.vehicles.values()) {
      this.scene.remove(entry.group);
      disposeEntry(entry);
    }
    this.vehicles.clear();
  }

  /** Swap any stand-in box for the real model once its asset has loaded. */
  refreshModels(): void {
    for (const entry of this.vehicles.values()) {
      if (!entry.instance.isFallback || !this.library.has(vehicleModelId(entry.vehicle.type))) continue;
      entry.group.remove(entry.instance.root);
      entry.instance.dispose();
      const fresh = this.attachModel(entry.group, entry.vehicle);
      entry.instance = fresh.instance;
      entry.wheels = fresh.wheels;
      entry.flywheel = fresh.flywheel;
      applyTierVariation(entry.group, entry.instance, entry.vehicle.tier);
      applyStateIndicator(entry.group, entry.vehicle.state, stateIndicatorHeight(entry.instance));
    }
  }

  get count(): number {
    return this.vehicles.size;
  }

  /** Root objects raycastable for scene picking — one Group per vehicle, tagged in addVehicle(). */
  pickables(): THREE.Object3D[] {
    return Array.from(this.vehicles.values(), e => e.group);
  }

  /** Current world-space position of a vehicle's root Group, or null if it isn't rendered. */
  getPosition(id: number): THREE.Vector3 | null {
    return this.vehicles.get(id)?.group.position.clone() ?? null;
  }

  /** The model instance drawn for a vehicle, or null — exposes tint materials and nodes to tests. */
  getInstance(id: number): ModelInstance | null {
    return this.vehicles.get(id)?.instance ?? null;
  }

  dispose(): void {
    this.clearAll();
  }

  private attachModel(group: THREE.Group, vehicle: Vehicle): Omit<VehicleEntry, 'vehicle' | 'tween'> {
    const instance = this.library.instantiate(vehicleModelId(vehicle.type), { size: FALLBACK_SIZE, tint: BODY_TINT });
    group.add(instance.root);
    const wheels: THREE.Object3D[] = [];
    instance.root.traverse(obj => {
      if (obj.name.startsWith('Wheel') && obj.parent === instance.root) wheels.push(obj);
    });
    return { group, instance, wheels, flywheel: instance.node('Flywheel') };
  }

  /** Turn toward the direction of travel, spin wheels by distance, run the flywheel while working. */
  private animateMotion(entry: VehicleEntry, dx: number, dz: number, dt: number): void {
    if (dt <= 0) return;
    const dist = Math.hypot(dx, dz);
    if (dist / dt > MOVE_SPEED_MIN) {
      entry.group.rotation.y = turnToward(entry.group.rotation.y, headingFromDelta(dx, dz), TURN_RATE * dt);
      // Axles run along the model's Z; rolling forward turns them negative.
      for (const wheel of entry.wheels) wheel.rotation.z -= dist / WHEEL_RADIUS;
    }
    if (entry.flywheel && entry.vehicle.state === 'working') entry.flywheel.rotation.z += FLYWHEEL_RATE * dt;
  }
}

// ---------- Helpers ----------

function disposeEntry(entry: VehicleEntry): void {
  entry.instance.dispose();
  const marker = findStateIndicator(entry.group);
  if (marker) {
    marker.geometry.dispose();
    (marker.material as THREE.Material).dispose();
  }
}

/** Where the state marker floats: just above the model, in the group's unscaled space. */
function stateIndicatorHeight(instance: ModelInstance): number {
  return instance.bounds.max.y + STATE_INDICATOR_CLEARANCE;
}

// ---------- State indicator ----------

/** Marker color per VehicleOperationalState. */
export const STATE_COLOR_MAP: Record<VehicleOperationalState, number> = {
  idle: 0x999999,     // grey — not working
  moving: 0x3399ff,   // blue — en route
  working: 0x33cc33,  // green — actively working
  waiting: 0xffcc00,  // amber — blocked/waiting
  broken: 0xff3333,   // red — broken down
};

const STATE_INDICATOR_RADIUS = 0.25;
/** Gap between the model's top and the marker. */
const STATE_INDICATOR_CLEARANCE = 0.5;
/** Marker height when no model bounds are known (the legacy placeholder's roof line). */
const STATE_INDICATOR_DEFAULT_Y = 3.2;

function findStateIndicator(group: THREE.Group): THREE.Mesh | undefined {
  return group.children.find(
    (child): child is THREE.Mesh => child instanceof THREE.Mesh && child.userData['isStateIndicator'] === true,
  );
}

/**
 * Adds or updates a small colored marker on a vehicle's group reflecting its
 * operational state. Idempotent — reuses the existing marker mesh (tagged
 * group.userData.isStateIndicator) rather than adding a duplicate; `y`
 * repositions it when given.
 */
export function applyStateIndicator(group: THREE.Group, state: VehicleOperationalState, y?: number): void {
  const color = STATE_COLOR_MAP[state];
  let marker = findStateIndicator(group);

  if (!marker) {
    marker = new THREE.Mesh(
      new THREE.SphereGeometry(STATE_INDICATOR_RADIUS, 12, 8),
      createToonMaterial({ color: new THREE.Color(color), name: 'stateIndicator' }),
    );
    marker.userData['isStateIndicator'] = true;
    marker.position.set(0, y ?? STATE_INDICATOR_DEFAULT_Y, 0);
    group.add(marker);
    return;
  }

  if (y !== undefined) marker.position.y = y;
  (marker.material as THREE.MeshToonMaterial).color.setHex(color);
}

function applyTierVariation(group: THREE.Group, instance: ModelInstance, tier: VehicleTier): void {
  group.scale.setScalar(TIER_SCALE_MULT[tier]);
  const shift = TIER_BRIGHT_SHIFT[tier];
  const paint = instance.tints.get(BODY_TINT);
  if (shift > 0 && paint) {
    paint.color.setHex(brightenColor(paint.color.getHex(), shift));
  }
}
