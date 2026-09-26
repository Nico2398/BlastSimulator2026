// BlastSimulator2026 — Shared per-employee billboard roster bookkeeping
// (#1013 refactor)
//
// TaskProgressBar and EmployeePictograms each key one billboarded Object3D
// per employee id and need the same lifecycle around that map: create/update
// on sync(), detach-and-forget on removal, and a sweep of ids no longer in
// the roster at all. Neither class's per-item logic (bar tween/easing vs.
// glyph/material swap) is shared — only this bookkeeping is, so it is
// factored out on its own rather than folded into a class that would have to
// know about either.

import * as THREE from 'three';
import type { Employee } from '../core/entities/Employee.js';
import type { VehicleState } from '../core/entities/Vehicle.js';
import { computeEmployeeActivity, type EmployeeActivity } from '../core/entities/EmployeeActivity.js';

/**
 * Map<employee id, item> plus the remove/sweep/clear lifecycle both
 * TaskProgressBar and EmployeePictograms need around it. TaskProgressBar also
 * reuses it for its site-anchored construction bars (#1012), whose keys are
 * `PendingAction` ids rather than employee ids — same lifecycle, other id
 * space. Generic over the
 * per-item type `T`; `objectOf` tells the roster which Object3D to detach
 * from its parent on removal, since each caller's item shape differs (a Bar
 * wraps a `group`, a Pictogram wraps a `mesh`).
 */
export class EmployeeBillboardRoster<T> {
  private readonly items = new Map<number, T>();

  /**
   * `disposeOf` is optional and called (after detaching, before dropping)
   * only by callers whose per-item Object3D owns resources besides its
   * shared geometry — BuildingOccupancyLabels' canvas-texture material is
   * unique per building id, unlike EmployeePictograms/TaskProgressBar's
   * shared-material items, which pass nothing and keep their existing
   * behaviour (#1205).
   */
  constructor(
    private readonly objectOf: (item: T) => THREE.Object3D,
    private readonly disposeOf?: (item: T) => void,
  ) {}

  get count(): number {
    return this.items.size;
  }

  get(id: number): T | undefined {
    return this.items.get(id);
  }

  set(id: number, item: T): void {
    this.items.set(id, item);
  }

  values(): IterableIterator<T> {
    return this.items.values();
  }

  /** Detach `id`'s item from its parent, dispose it if the caller asked, and drop it. No-op if absent. */
  remove(id: number): void {
    const item = this.items.get(id);
    if (!item) return;
    this.objectOf(item).removeFromParent();
    this.disposeOf?.(item);
    this.items.delete(id);
  }

  /** Remove every item whose id is not in `liveIds` (death/removal from the roster). */
  sweep(liveIds: ReadonlySet<number>): void {
    for (const id of Array.from(this.items.keys())) {
      if (!liveIds.has(id)) this.remove(id);
    }
  }

  /** Remove every item. */
  clearAll(): void {
    for (const id of Array.from(this.items.keys())) {
      this.remove(id);
    }
  }
}

/**
 * Resolve each employee's current activity while building the live-id set
 * sync()'s dead-roster sweep needs — the preamble TaskProgressBar's and
 * EmployeePictograms's sync() bodies both open with, before diverging on
 * what they do with the resolved activity.
 */
export function forEachEmployeeActivity(
  employees: readonly Employee[],
  vehicleState: VehicleState,
  liveIds: Set<number>,
  fn: (employee: Employee, activity: EmployeeActivity) => void,
): void {
  for (const employee of employees) {
    liveIds.add(employee.id);
    fn(employee, computeEmployeeActivity(employee, vehicleState));
  }
}
