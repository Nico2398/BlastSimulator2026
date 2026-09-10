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
import type { Vehicle } from '../core/entities/Vehicle.js';
import { computeEmployeeActivity, type EmployeeActivity } from '../core/entities/EmployeeActivity.js';

/**
 * Map<employee id, item> plus the remove/sweep/clear lifecycle both
 * TaskProgressBar and EmployeePictograms need around it. Generic over the
 * per-item type `T`; `objectOf` tells the roster which Object3D to detach
 * from its parent on removal, since each caller's item shape differs (a Bar
 * wraps a `group`, a Pictogram wraps a `mesh`).
 */
export class EmployeeBillboardRoster<T> {
  private readonly items = new Map<number, T>();

  constructor(private readonly objectOf: (item: T) => THREE.Object3D) {}

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

  /** Detach `id`'s item from its parent and drop it. No-op if absent. */
  remove(id: number): void {
    const item = this.items.get(id);
    if (!item) return;
    this.objectOf(item).removeFromParent();
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
  vehicles: readonly Vehicle[],
  liveIds: Set<number>,
  fn: (employee: Employee, activity: EmployeeActivity) => void,
): void {
  for (const employee of employees) {
    liveIds.add(employee.id);
    fn(employee, computeEmployeeActivity(employee, vehicles));
  }
}
