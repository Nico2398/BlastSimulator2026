// BlastSimulator2026 — Employee activity derivation (redesign P6)
// What an employee is doing right now, read off the same fields the engine
// itself uses to drive them (ArrivalGate, TaskDispatch, GameLoop) — for the
// Crew panel's "current task" line. Locale-agnostic: returns a kind + raw
// data, never player-facing text.

import type { Employee } from './Employee.js';
import type { Vehicle } from './Vehicle.js';
import type { ActionType } from '../state/GameState.js';

export type EmployeeActivityKind = 'collapsed' | 'resting' | 'working' | 'driving' | 'walking' | 'idle';

export interface EmployeeActivity {
  kind: EmployeeActivityKind;
  /** Ticks left on the current task or rest, or null when not applicable. */
  ticksRemaining: number | null;
  /** Original duration of the current task, or null when not tracked (rest has none) or not applicable. */
  totalTicks: number | null;
  /** Dispatched-task type, set while working it or while walking to it. Null otherwise. */
  actionType: ActionType | null;
  /** Vehicle currently being driven, set only for 'driving'. */
  vehicleId: number | null;
}

const IDLE: EmployeeActivity = { kind: 'idle', ticksRemaining: null, totalTicks: null, actionType: null, vehicleId: null };

/**
 * What `employee` is doing right now, checked in the same priority order the
 * engine resolves these states in: a collapsed employee is never mid-task,
 * an arrived task takes over from the walk that led to it, and driving is
 * read off the fleet rather than the employee (nothing on Employee itself
 * marks "driving" — only the vehicle's own driverId does).
 */
export function computeEmployeeActivity(employee: Employee, vehicles: readonly Vehicle[]): EmployeeActivity {
  if (employee.collapsing) return { ...IDLE, kind: 'collapsed' };

  if (employee.restTicksRemaining !== null) {
    return { ...IDLE, kind: 'resting', ticksRemaining: employee.restTicksRemaining };
  }

  if (employee.taskTicksRemaining !== null) {
    return {
      kind: 'working',
      ticksRemaining: employee.taskTicksRemaining,
      totalTicks: employee.activeTaskTotalTicks ?? null,
      actionType: employee.pendingActionType,
      vehicleId: null,
    };
  }

  const driving = vehicles.find(v => v.driverId === employee.id);
  if (driving) return { ...IDLE, kind: 'driving', vehicleId: driving.id };

  if (employee.destinationX !== null || employee.destinationZ !== null) {
    return { ...IDLE, kind: 'walking', actionType: employee.pendingActionType };
  }

  return IDLE;
}
