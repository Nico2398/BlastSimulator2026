// BlastSimulator2026 — Employee facts for the inspector (#1762)
// Pure resolution of where an employee is and what their task targets. No DOM, no t().

import type { Employee } from '../core/entities/Employee.js';
import type { BuildingType } from '../core/entities/Building.js';
import type { GameState } from '../core/state/GameState.js';

/**
 * A reference to another selectable entity. Only kinds resolvable from an employee's state appear here;
 * hole and fragment task targets are not resolved to a link (they render as plain text).
 */
export type EntityRef = { kind: 'building' | 'vehicle' | 'ramp'; id: number };

type EmployeeLocation =
  | { kind: 'inside'; building: EntityRef; buildingType: BuildingType; resting: boolean }
  | { kind: 'aboard'; vehicle: EntityRef }
  | { kind: 'stuck'; ticks: number; x: number; z: number }
  | { kind: 'walking'; x: number; z: number; purpose: 'rest' | 'school' | 'task' | 'other' }
  | { kind: 'bench'; bench: number; x: number; z: number }
  | { kind: 'coords'; x: number; z: number };

export function resolveEmployeeLocation(e: Employee, world: Pick<GameState, 'buildings' | 'navGrid'>): EmployeeLocation {
  if (e.locomotion.kind === 'inside') {
    const id = e.locomotion.buildingId;
    const building = world.buildings.buildings.find(b => b.id === id);
    if (building) {
      return { kind: 'inside', building: { kind: 'building', id }, buildingType: building.type, resting: e.restTicksRemaining !== null };
    }
  }
  if (e.locomotion.kind === 'mounted') return { kind: 'aboard', vehicle: { kind: 'vehicle', id: e.locomotion.vehicleId } };
  if (e.isMoveStuck) return { kind: 'stuck', ticks: e.moveConsecutiveFailures, x: e.x, z: e.z };
  if (e.destinationX !== null || e.destinationZ !== null) {
    const purpose = e.pendingRestDuration !== null ? 'rest'
      : e.pendingTrainingState ? 'school'
      : e.pendingActionType ? 'task'
      : 'other';
    return { kind: 'walking', x: e.destinationX ?? e.x, z: e.destinationZ ?? e.z, purpose };
  }
  const bench = world.navGrid?.cellAt(e.x, e.z)?.benchLevel;
  return bench !== undefined ? { kind: 'bench', bench, x: e.x, z: e.z } : { kind: 'coords', x: e.x, z: e.z };
}

/** The entity the pending task targets, or null when none or it no longer exists. */
export function resolveTaskTarget(e: Employee, world: Pick<GameState, 'buildings' | 'vehicles' | 'builtRamps'>): EntityRef | null {
  const payload = e.pendingActionPayload;
  if (!payload) return null;
  const buildingId = payload['buildingId'];
  if (typeof buildingId === 'number') {
    return world.buildings.buildings.some(b => b.id === buildingId) ? { kind: 'building', id: buildingId } : null;
  }
  const vehicleId = payload['vehicleId'];
  if (typeof vehicleId === 'number') {
    return world.vehicles.vehicles.some(v => v.id === vehicleId) ? { kind: 'vehicle', id: vehicleId } : null;
  }
  const rampId = payload['rampId'];
  if (typeof rampId === 'number') {
    return world.builtRamps.some(r => r.id === rampId) ? { kind: 'ramp', id: rampId } : null;
  }
  return null;
}

/** The school a training runs at (current or pending), or null. */
export function trainingSchool(e: Employee): EntityRef | null {
  const training = e.trainingState ?? e.pendingTrainingState;
  return training ? { kind: 'building', id: training.buildingId } : null;
}
