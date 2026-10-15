// BlastSimulator2026 — Employee facts for the inspector (#1762)
// Pure resolution of where an employee is and what their task targets. No DOM, no t().

import type { Employee } from '../core/entities/Employee.js';
import type { BuildingType } from '../core/entities/Building.js';
import type { GameState } from '../core/state/GameState.js';

/** A reference to another selectable entity. */
export type EntityRef = { kind: 'building' | 'vehicle' | 'ramp' | 'hole'; id: number };

export type EmployeeLocation =
  | { kind: 'inside'; building: EntityRef; buildingType: BuildingType; resting: boolean }
  | { kind: 'aboard'; vehicle: EntityRef }
  | { kind: 'stuck'; ticks: number; x: number; z: number }
  | { kind: 'walking'; x: number; z: number; purpose: 'rest' | 'school' | 'task' | 'other' }
  | { kind: 'bench'; bench: number; x: number; z: number }
  | { kind: 'coords'; x: number; z: number };

export function resolveEmployeeLocation(_e: Employee, _world: Pick<GameState, 'buildings' | 'navGrid'>): EmployeeLocation {
  throw new Error('not implemented');
}

/** The entity the pending task targets, or null when none or it no longer exists. */
export function resolveTaskTarget(_e: Employee, _world: Pick<GameState, 'buildings' | 'vehicles' | 'builtRamps'>): EntityRef | null {
  throw new Error('not implemented');
}

/** The school a training runs at (current or pending), or null. */
export function trainingSchool(_e: Employee): EntityRef | null {
  throw new Error('not implemented');
}
