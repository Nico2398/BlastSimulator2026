// BlastSimulator2026 — Task Progress Bar Renderer (#546, #1012)
// Two bar families, both billboarded fill-bars whose progress is read off
// computeEmployeeActivity()'s 'working' kind (ticksRemaining / totalTicks) —
// the same fields the Crew panel's "current task" line uses:
// - Worker-anchored bars, floating above each currently-working employee for
//   every `working` kind except `place_building`, keyed by employee id.
// - Site-anchored bars (#1012), for `place_building` construction actions,
//   keyed by the `PendingAction`'s own id and anchored to the site's ghost
//   mesh instead of the worker — so the bar survives the claiming employee
//   walking away or being reassigned mid-build.

import * as THREE from 'three';
import type { Employee } from '../core/entities/Employee.js';
import type { Vehicle } from '../core/entities/Vehicle.js';
import type { PendingAction } from '../core/state/GameState.js';
import { computeEmployeeActivity, taskProgressFraction } from '../core/entities/EmployeeActivity.js';
import { createFillTween, stepFillTween, type FillTween } from './TaskFillEasing.js';
import { GHOST_SIZE } from './GhostMesh.js';

// ---------- Config ----------

const TRACK_COLOR = 0x11161c; // --bsx-well
const FILL_COLOR  = 0x4fc76b; // --bsx-positive

const BAR_WIDTH  = 0.6;  // world units — proportionate to CharacterMesh's ~0.4-wide capsule
const BAR_HEIGHT = 0.08;
/** Height above the anchor's local origin — clears the worker model's hard hat (ridge top ~1.33). */
const BAR_Y_OFFSET = 1.55;
/** Height above a construction site's ghost-mesh anchor — clears the ghost volume so the bar isn't occluded by it (#1012). */
const SITE_BAR_Y_OFFSET = GHOST_SIZE / 2 + 0.5;
const FILL_Z_OFFSET = 0.001; // keep fill in front of track, avoid z-fighting
/** Drawn after (near-)everything else, paired with depthTest:false on the bar materials, so a bar is never occluded by the ghost volume or building geometry it's anchored to/near (#1012). */
const BAR_RENDER_ORDER = 999;

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
  /** Bars anchored to a construction site (`place_building` PendingAction id) rather than a worker (#1012). */
  private readonly siteBars = new Map<number, Bar>();

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
      depthTest: false,
    });
    this.fillMaterial = new THREE.MeshBasicMaterial({
      color: FILL_COLOR,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      depthTest: false,
    });
  }

  /** Number of progress bars currently rendered. */
  get count(): number {
    return this.bars.size + this.siteBars.size;
  }

  /**
   * Sync progress-bar meshes against the current employee/vehicle roster and
   * the pending-action pool. Adds/removes worker-anchored bars for
   * newly-working/no-longer-working employees via `getWorkerAnchor`, and
   * site-anchored bars for in-progress `place_building` actions via
   * `getSiteAnchor` (#1012) — the latter survive the claiming worker walking
   * away or being reassigned, since they key off the action rather than the
   * employee.
   */
  sync(
    employees: readonly Employee[],
    vehicles: readonly Vehicle[],
    pendingActions: readonly PendingAction[],
    getWorkerAnchor: (id: number) => THREE.Group | null,
    getSiteAnchor: (actionId: number) => THREE.Object3D | null,
  ): void {
    const liveIds = new Set<number>();
    const employeeById = new Map<number, Employee>(employees.map(e => [e.id, e]));

    for (const employee of employees) {
      liveIds.add(employee.id);

      const activity = computeEmployeeActivity(employee, vehicles);
      const anchor = getWorkerAnchor(employee.id);
      const fraction = activity.kind === 'working' && activity.actionType !== 'place_building'
        ? taskProgressFraction(activity)
        : null;

      if (fraction === null || anchor === null) {
        this.removeBar(employee.id);
        continue;
      }

      // getOrCreateBar snaps a fresh bar immediately, no easing-in from zero.
      const bar = this.getOrCreateBar(this.bars, employee.id, BAR_Y_OFFSET, fraction);
      // Retarget (no-op for a fresh bar, since it's already snapped above) and
      // reparent. dt=0 makes a forward retarget a no-op for an existing bar
      // (actual easing happens per-frame in update()) but still snaps
      // immediately for a backward retarget (task changed, cancelled, or
      // re-dispatched) — stepFillTween's backward branch ignores dt, so this
      // doesn't have to wait for the next update().
      this.retargetBar(bar, fraction, anchor);
    }

    // Sweep any bar whose employee is no longer in the roster at all (death/removal).
    for (const id of Array.from(this.bars.keys())) {
      if (!liveIds.has(id)) this.removeBar(id);
    }

    // Site-anchored bars for in-progress `place_building` actions (#1012) —
    // keyed by the action's own id rather than the claiming employee's, so
    // the bar survives the worker walking away or being reassigned.
    const liveSiteIds = new Set<number>();
    for (const action of pendingActions) {
      if (action.type !== 'place_building') continue;
      liveSiteIds.add(action.id);

      const anchor = getSiteAnchor(action.id);
      if (anchor === null) {
        // Site not synced yet this frame, or gone.
        this.removeSiteBar(action.id);
        continue;
      }

      const holder = action.holderId !== null
        ? employeeById.get(action.holderId) ?? null
        : null;
      const activity = holder ? computeEmployeeActivity(holder, vehicles) : null;
      const fraction = activity && activity.kind === 'working' && activity.actionType === 'place_building'
        ? taskProgressFraction(activity)
        : null;

      const existing = this.siteBars.get(action.id);
      if (fraction === null) {
        if (existing) {
          // Freeze in place — no holder/progress this frame, but the bar
          // already exists (worker walked away or was reassigned mid-build).
          // Keep it anchored and visible; don't touch its fraction.
          if (existing.group.parent !== anchor) anchor.add(existing.group);
        }
        continue;
      }

      const bar = this.getOrCreateBar(this.siteBars, action.id, SITE_BAR_Y_OFFSET, fraction);
      this.retargetBar(bar, fraction, anchor);
    }

    // Sweep any site bar whose action is no longer an active place_building action.
    for (const id of Array.from(this.siteBars.keys())) {
      if (!liveSiteIds.has(id)) this.removeSiteBar(id);
    }
  }

  /** Animate/refresh fill levels and billboard orientation. Call every frame with elapsed seconds. */
  update(dt: number): void {
    for (const bar of this.bars.values()) {
      this.stepBar(bar, dt);
    }
    for (const bar of this.siteBars.values()) {
      this.stepBar(bar, dt);
    }
  }

  /** Remove all progress-bar meshes from the scene. */
  clearAll(): void {
    for (const id of Array.from(this.bars.keys())) {
      this.removeBar(id);
    }
    for (const id of Array.from(this.siteBars.keys())) {
      this.removeSiteBar(id);
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

  /**
   * Retarget an existing bar to `fraction` (snap via dt=0 — actual easing
   * happens per-frame in `update()` via `stepBar`) and reparent it under
   * `anchor` if it isn't already there. Shared by the worker-loop and
   * site-loop create-or-update branches in `sync()` (#1012).
   */
  private retargetBar(bar: Bar, fraction: number, anchor: THREE.Object3D): void {
    bar.targetFraction = fraction;
    bar.easedFraction = stepFillTween(bar.tween, bar.easedFraction, fraction, 0);
    bar.fillMesh.scale.x = bar.easedFraction;
    if (bar.group.parent !== anchor) {
      anchor.add(bar.group);
    }
  }

  /** Per-frame easing step, fill-scale update and billboard orientation. Shared by both bar maps in `update()`. */
  private stepBar(bar: Bar, dt: number): void {
    bar.easedFraction = stepFillTween(bar.tween, bar.easedFraction, bar.targetFraction, dt);
    bar.fillMesh.scale.x = bar.easedFraction;
    bar.group.quaternion.copy(this.camera.quaternion);
  }

  /**
   * Look up an existing bar in `map` for `id`, or create and register one via
   * `createBar`, snapped immediately to `fraction` (no easing-in from zero
   * on first appearance). Shared by the worker-loop and site-loop
   * create-or-update branches in `sync()` (#1012).
   */
  private getOrCreateBar(map: Map<number, Bar>, id: number, yOffset: number, fraction: number): Bar {
    let bar = map.get(id);
    if (!bar) {
      bar = this.createBar(yOffset);
      bar.tween = createFillTween(fraction);
      bar.easedFraction = fraction;
      bar.targetFraction = fraction;
      bar.fillMesh.scale.x = fraction;
      map.set(id, bar);
    }
    return bar;
  }

  private createBar(yOffset: number): Bar {
    const group = new THREE.Group();
    group.position.set(0, yOffset, 0);
    // Parented into the scene root on creation; sync() immediately reparents
    // it under the resolved anchor group (THREE.Object3D.add() detaches from
    // whatever parent it already has), so this is only ever a transient home.
    this.scene.add(group);

    const trackMesh = new THREE.Mesh(this.trackGeometry, this.trackMaterial);
    trackMesh.renderOrder = BAR_RENDER_ORDER;
    group.add(trackMesh);

    const fillMesh = new THREE.Mesh(this.fillGeometry, this.fillMaterial);
    fillMesh.position.set(-BAR_WIDTH / 2, 0, FILL_Z_OFFSET);
    fillMesh.scale.x = 0;
    fillMesh.renderOrder = BAR_RENDER_ORDER;
    group.add(fillMesh);

    return { group, fillMesh, tween: createFillTween(0), easedFraction: 0, targetFraction: 0 };
  }

  /** Detach and forget the bar for `id` in `map`, if any. Shared by removeBar/removeSiteBar. */
  private removeFromMap(map: Map<number, Bar>, id: number): void {
    const bar = map.get(id);
    if (!bar) return;
    bar.group.removeFromParent();
    map.delete(id);
  }

  private removeBar(id: number): void {
    this.removeFromMap(this.bars, id);
  }

  /** Remove the site-anchored bar for pending-action id `id`, if any (#1012). Mirrors removeBar(). */
  private removeSiteBar(id: number): void {
    this.removeFromMap(this.siteBars, id);
  }
}
