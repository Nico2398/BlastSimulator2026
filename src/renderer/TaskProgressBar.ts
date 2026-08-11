// BlastSimulator2026 — Task Progress Bar Renderer (#546)
// Billboarded fill-bar floating above each currently-working employee,
// keyed by employee id. Progress is read off computeEmployeeActivity()'s
// 'working' kind (ticksRemaining / totalTicks) — the same fields the Crew
// panel's "current task" line uses.

import * as THREE from 'three';
import type { Employee } from '../core/entities/Employee.js';
import type { Vehicle } from '../core/entities/Vehicle.js';
import { computeEmployeeActivity } from '../core/entities/EmployeeActivity.js';

// ---------- Config ----------

const TRACK_COLOR = 0x11161c; // --bsx-well
const FILL_COLOR  = 0x4fc76b; // --bsx-positive

const BAR_WIDTH  = 0.6;  // world units — proportionate to CharacterMesh's ~0.4-wide capsule
const BAR_HEIGHT = 0.08;
/** Height above the anchor's local origin — clears the character's hard hat (capsule top ~1.0). */
const BAR_Y_OFFSET = 1.35;
const FILL_Z_OFFSET = 0.001; // keep fill in front of track, avoid z-fighting

// ---------- Shared resources (built once, reused across every bar) ----------

const trackGeometry = new THREE.PlaneGeometry(BAR_WIDTH, BAR_HEIGHT);
const fillGeometry = new THREE.PlaneGeometry(BAR_WIDTH, BAR_HEIGHT);
// Pivot at the fill's own left edge so scaling scale.x grows it rightward
// from a fixed left edge instead of from center.
fillGeometry.translate(BAR_WIDTH / 2, 0, 0);

const trackMaterial = new THREE.MeshBasicMaterial({
  color: TRACK_COLOR,
  transparent: true,
  opacity: 0.85,
  depthWrite: false,
});
const fillMaterial = new THREE.MeshBasicMaterial({
  color: FILL_COLOR,
  transparent: true,
  opacity: 0.95,
  depthWrite: false,
});

interface Bar {
  group: THREE.Group;
  fillMesh: THREE.Mesh;
}

// ---------- Main class ----------

export class TaskProgressBar {
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.Camera;
  private readonly bars = new Map<number, Bar>();

  constructor(scene: THREE.Scene, camera: THREE.Camera) {
    this.scene = scene;
    this.camera = camera;
  }

  /** Number of progress bars currently rendered. */
  get count(): number {
    return this.bars.size;
  }

  /**
   * Sync progress-bar meshes against the current employee/vehicle roster.
   * Adds bars for newly-working employees and removes bars for employees no
   * longer working. `getAnchor` resolves an employee id to the CharacterMesh
   * Group to billboard above.
   */
  sync(
    employees: Employee[],
    vehicles: readonly Vehicle[],
    getAnchor: (id: number) => THREE.Group | null,
  ): void {
    const liveIds = new Set<number>();

    for (const employee of employees) {
      liveIds.add(employee.id);

      const activity = computeEmployeeActivity(employee, vehicles);
      const anchor = getAnchor(employee.id);
      const hasProgress = activity.kind === 'working'
        && typeof activity.totalTicks === 'number'
        && activity.totalTicks > 0
        && anchor !== null;

      if (!hasProgress) {
        this.removeBar(employee.id);
        continue;
      }

      let bar = this.bars.get(employee.id);
      if (!bar) {
        bar = this.createBar();
        this.bars.set(employee.id, bar);
      }
      if (bar.group.parent !== anchor) {
        anchor!.add(bar.group);
      }

      const totalTicks = activity.totalTicks as number;
      const ticksRemaining = activity.ticksRemaining ?? 0;
      const fraction = (totalTicks - ticksRemaining) / totalTicks;
      bar.fillMesh.scale.x = Math.min(1, Math.max(0, fraction));
    }

    // Sweep any bar whose employee is no longer in the roster at all (death/removal).
    for (const id of Array.from(this.bars.keys())) {
      if (!liveIds.has(id)) this.removeBar(id);
    }
  }

  /** Animate/refresh fill levels and billboard orientation. Call every frame with elapsed seconds. */
  update(_dt: number): void {
    for (const { group } of this.bars.values()) {
      group.quaternion.copy(this.camera.quaternion);
    }
  }

  /** Remove all progress-bar meshes from the scene. */
  clearAll(): void {
    for (const id of Array.from(this.bars.keys())) {
      this.removeBar(id);
    }
  }

  dispose(): void {
    this.clearAll();
    trackGeometry.dispose();
    fillGeometry.dispose();
    trackMaterial.dispose();
    fillMaterial.dispose();
  }

  // ---------- Helpers ----------

  private createBar(): Bar {
    const group = new THREE.Group();
    group.position.set(0, BAR_Y_OFFSET, 0);
    // Parented into the scene root on creation; sync() immediately reparents
    // it under the resolved anchor group (THREE.Object3D.add() detaches from
    // whatever parent it already has), so this is only ever a transient home.
    this.scene.add(group);

    const trackMesh = new THREE.Mesh(trackGeometry, trackMaterial);
    group.add(trackMesh);

    const fillMesh = new THREE.Mesh(fillGeometry, fillMaterial);
    fillMesh.position.set(-BAR_WIDTH / 2, 0, FILL_Z_OFFSET);
    fillMesh.scale.x = 0;
    group.add(fillMesh);

    return { group, fillMesh };
  }

  private removeBar(id: number): void {
    const bar = this.bars.get(id);
    if (!bar) return;
    bar.group.removeFromParent();
    this.bars.delete(id);
  }
}
