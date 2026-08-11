// BlastSimulator2026 — Task Progress Bar Renderer (#546)
// Billboarded fill-bar floating above each currently-working employee,
// keyed by employee id. Progress is read off computeEmployeeActivity()'s
// 'working' kind (ticksRemaining / totalTicks) — the same fields the Crew
// panel's "current task" line uses.

import * as THREE from 'three';
import type { Employee } from '../core/entities/Employee.js';
import type { Vehicle } from '../core/entities/Vehicle.js';

// ---------- Main class ----------

export class TaskProgressBar {
  constructor(_scene: THREE.Scene, _camera: THREE.Camera) {
    // TODO: implement
  }

  /** Number of progress bars currently rendered. */
  get count(): number {
    return 0;
  }

  /**
   * Sync progress-bar meshes against the current employee/vehicle roster.
   * Adds bars for newly-working employees and removes bars for employees no
   * longer working. `getAnchor` resolves an employee id to the CharacterMesh
   * Group to billboard above.
   */
  sync(
    _employees: Employee[],
    _vehicles: Vehicle[],
    _getAnchor: (id: number) => THREE.Group | null,
  ): void {
    // TODO: implement
  }

  /** Animate/refresh fill levels and billboard orientation. Call every frame with elapsed seconds. */
  update(_dt: number): void {
    // TODO: implement
  }

  /** Remove all progress-bar meshes from the scene. */
  clearAll(): void {
    // TODO: implement
  }

  dispose(): void {
    // TODO: implement
  }
}
