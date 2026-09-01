// BlastSimulator2026 — Task Progress Bar Renderer (#546)
// Billboarded fill-bar floating above each currently-working employee,
// keyed by employee id. Progress is read off computeEmployeeActivity()'s
// 'working' kind (ticksRemaining / totalTicks) — the same fields the Crew
// panel's "current task" line uses.

import * as THREE from 'three';
import type { Employee } from '../core/entities/Employee.js';
import type { Vehicle } from '../core/entities/Vehicle.js';
import { computeEmployeeActivity, taskProgressFraction } from '../core/entities/EmployeeActivity.js';
import { createFillTween, stepFillTween, type FillTween } from './TaskFillEasing.js';

// ---------- Config ----------

const TRACK_COLOR = 0x11161c; // --bsx-well
const FILL_COLOR  = 0x4fc76b; // --bsx-positive

const BAR_WIDTH  = 0.6;  // world units — proportionate to CharacterMesh's ~0.4-wide capsule
const BAR_HEIGHT = 0.08;
/** Height above the anchor's local origin — clears the character's hard hat (capsule top ~1.0). */
const BAR_Y_OFFSET = 1.35;
const FILL_Z_OFFSET = 0.001; // keep fill in front of track, avoid z-fighting

interface Bar {
  group: THREE.Group;
  fillMesh: THREE.Mesh;
  tween: FillTween;
  easedFraction: number;
  targetFraction: number;
}

// ---------- Main class ----------

export class TaskProgressBar {
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.Camera;
  private readonly bars = new Map<number, Bar>();

  // ---------- Shared resources (built once per instance, reused across every bar) ----------
  private readonly trackGeometry: THREE.PlaneGeometry;
  private readonly fillGeometry: THREE.PlaneGeometry;
  private readonly trackMaterial: THREE.MeshBasicMaterial;
  private readonly fillMaterial: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene, camera: THREE.Camera) {
    this.scene = scene;
    this.camera = camera;

    this.trackGeometry = new THREE.PlaneGeometry(BAR_WIDTH, BAR_HEIGHT);
    this.fillGeometry = new THREE.PlaneGeometry(BAR_WIDTH, BAR_HEIGHT);
    // Pivot at the fill's own left edge so scaling scale.x grows it rightward
    // from a fixed left edge instead of from center.
    this.fillGeometry.translate(BAR_WIDTH / 2, 0, 0);

    this.trackMaterial = new THREE.MeshBasicMaterial({
      color: TRACK_COLOR,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    this.fillMaterial = new THREE.MeshBasicMaterial({
      color: FILL_COLOR,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
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
    employees: readonly Employee[],
    vehicles: readonly Vehicle[],
    getAnchor: (id: number) => THREE.Group | null,
  ): void {
    const liveIds = new Set<number>();

    for (const employee of employees) {
      liveIds.add(employee.id);

      const activity = computeEmployeeActivity(employee, vehicles);
      const anchor = getAnchor(employee.id);
      const fraction = activity.kind === 'working' ? taskProgressFraction(activity) : null;

      if (fraction === null || anchor === null) {
        this.removeBar(employee.id);
        continue;
      }

      let bar = this.bars.get(employee.id);
      if (!bar) {
        // First appearance — snap immediately, no easing-in from zero.
        bar = this.createBar();
        bar.tween = createFillTween(fraction);
        bar.easedFraction = fraction;
        bar.targetFraction = fraction;
        bar.fillMesh.scale.x = fraction;
        this.bars.set(employee.id, bar);
      } else {
        // Existing bar: only retarget here. dt=0 makes this a no-op for a
        // forward retarget (actual easing happens per-frame in update()) but
        // still snaps immediately for a backward retarget (task changed,
        // cancelled, or re-dispatched) — stepFillTween's backward branch
        // ignores dt, so this doesn't have to wait for the next update().
        bar.targetFraction = fraction;
        bar.easedFraction = stepFillTween(bar.tween, bar.easedFraction, fraction, 0);
        bar.fillMesh.scale.x = bar.easedFraction;
      }
      if (bar.group.parent !== anchor) {
        anchor.add(bar.group);
      }
    }

    // Sweep any bar whose employee is no longer in the roster at all (death/removal).
    for (const id of Array.from(this.bars.keys())) {
      if (!liveIds.has(id)) this.removeBar(id);
    }
  }

  /** Animate/refresh fill levels and billboard orientation. Call every frame with elapsed seconds. */
  update(dt: number): void {
    for (const bar of this.bars.values()) {
      bar.easedFraction = stepFillTween(bar.tween, bar.easedFraction, bar.targetFraction, dt);
      bar.fillMesh.scale.x = bar.easedFraction;
      bar.group.quaternion.copy(this.camera.quaternion);
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
    this.trackGeometry.dispose();
    this.fillGeometry.dispose();
    this.trackMaterial.dispose();
    this.fillMaterial.dispose();
  }

  // ---------- Helpers ----------

  private createBar(): Bar {
    const group = new THREE.Group();
    group.position.set(0, BAR_Y_OFFSET, 0);
    // Parented into the scene root on creation; sync() immediately reparents
    // it under the resolved anchor group (THREE.Object3D.add() detaches from
    // whatever parent it already has), so this is only ever a transient home.
    this.scene.add(group);

    const trackMesh = new THREE.Mesh(this.trackGeometry, this.trackMaterial);
    group.add(trackMesh);

    const fillMesh = new THREE.Mesh(this.fillGeometry, this.fillMaterial);
    fillMesh.position.set(-BAR_WIDTH / 2, 0, FILL_Z_OFFSET);
    fillMesh.scale.x = 0;
    group.add(fillMesh);

    return { group, fillMesh, tween: createFillTween(0), easedFraction: 0, targetFraction: 0 };
  }

  private removeBar(id: number): void {
    const bar = this.bars.get(id);
    if (!bar) return;
    bar.group.removeFromParent();
    this.bars.delete(id);
  }
}
