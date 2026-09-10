// BlastSimulator2026 — Employee non-working activity pictograms (#1013)
//
// Billboarded icon (Zzz for resting, etc.) floating above an employee who is
// not currently working, naming why — reuses the billboard/per-employee
// anchor precedent TaskProgressBar.ts established for the progress bar shown
// while an employee IS working (#546). The two are mutually exclusive per
// employee: 'working' keeps the progress bar and shows no pictogram here.
//
// skeleton-writer (#1013): stubs only, no logic yet — see this file's
// TODO markers. Implementation lands in the TDD implementer step.

import * as THREE from 'three';
import type { Employee } from '../core/entities/Employee.js';
import type { Vehicle } from '../core/entities/Vehicle.js';
import type { EmployeeActivity } from '../core/entities/EmployeeActivity.js';

/**
 * Which non-working pictogram an employee shows. Mirrors
 * EmployeeActivityKind's non-'working' kinds ('collapsed', 'resting',
 * 'driving', 'idle', 'walking'), plus 'walking_to_rest' — a walk toward a
 * rest destination reads as ordinary 'walking' in EmployeeActivityKind, but
 * gets its own pictogram here so the player can tell it apart from a walk to
 * a task.
 */
export type PictogramKind = 'collapsed' | 'resting' | 'walking_to_rest' | 'walking' | 'driving' | 'idle';

/**
 * Which pictogram (if any) `activity` should show. Null for 'working' —
 * that state keeps the progress bar, never an icon.
 */
export function pictogramKindFor(_activity: EmployeeActivity): PictogramKind | null {
  // TODO: implement
  throw new Error('not implemented');
}

/** Billboarded non-working-activity pictograms, one per employee, keyed by employee id. */
export class EmployeePictograms {
  // TODO: implement — store scene/camera and shared mesh resources here,
  // mirroring TaskProgressBar's constructor (#1013).
  constructor(_scene: THREE.Scene, _camera: THREE.Camera) {}

  /** Number of pictograms currently rendered. */
  get count(): number {
    // TODO: implement
    throw new Error('not implemented');
  }

  /**
   * Sync pictogram meshes against the current employee/vehicle roster. Adds
   * pictograms for newly-non-working employees and removes them for
   * employees now working or no longer present. `getAnchor` resolves an
   * employee id to the CharacterMesh Group to billboard above.
   */
  sync(
    _employees: readonly Employee[],
    _vehicles: readonly Vehicle[],
    _getAnchor: (id: number) => THREE.Group | null,
  ): void {
    // TODO: implement
  }

  /** Animate/refresh billboard orientation. Call every frame with elapsed seconds. */
  update(_dt: number): void {
    // TODO: implement
  }

  /** Remove all pictogram meshes from the scene. */
  clearAll(): void {
    // TODO: implement
  }

  dispose(): void {
    // TODO: implement
  }
}
