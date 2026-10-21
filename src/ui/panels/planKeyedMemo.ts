// BlastSimulator2026 — Shared cache for plan-derived predictions rebuilt per frame (#2003)
// The predictions run the blast's energy propagation, so the UI recomputes one only when
// the grid or the inputs' key changed, not on every update.
import type { VoxelGrid } from '../../core/world/VoxelGrid.js';
import type { BlastPlan } from '../../core/mining/BlastPlan.js';

/** Key over the inputs every plan prediction reads: holes, charges, wet holes, terrain edits. */
export function planInputsKey(plan: BlastPlan, wet: ReadonlySet<string>, grid: VoxelGrid): string {
  return JSON.stringify([plan.holes, plan.charges, [...wet].sort(), grid.editRevision]);
}

/** Holds one computed value, reused while the same grid and key come back. */
export class PlanKeyedMemo<T> {
  private key = '';
  private grid: VoxelGrid | null = null;
  private value: T | undefined;
  private filled = false;

  get(grid: VoxelGrid, key: string, compute: () => T): T {
    if (this.filled && grid === this.grid && key === this.key) return this.value as T;
    this.grid = grid;
    this.key = key;
    this.value = compute();
    this.filled = true;
    return this.value;
  }
}
