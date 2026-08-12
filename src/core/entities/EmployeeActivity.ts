// BlastSimulator2026 — Employee activity derivation (redesign P6)
// What an employee is doing right now, read off the same fields the engine
// itself uses to drive them (ArrivalGate, TaskDispatch, GameLoop) — for the
// Crew panel's "current task" line. Locale-agnostic: returns a kind + raw
// data, never player-facing text.

import type { Employee } from './Employee.js';
import type { Vehicle } from './Vehicle.js';
import type { ActionType } from '../state/GameState.js';

export type EmployeeActivityKind = 'collapsed' | 'resting' | 'working' | 'driving' | 'driving_to_task' | 'walking' | 'idle';

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

  const drivenVehicle = vehicles.find(v => v.driverId === employee.id);
  // `?? null`: a fixture/old-save Vehicle predating reservedForActionId
  // (#550) carries it as undefined, not null — treated the same as
  // "unreserved" rather than misreported as vehicle-gated.
  if (drivenVehicle && (drivenVehicle.reservedForActionId ?? null) !== null) {
    // taskTicksRemaining !== null is caught by the 'working' branch above,
    // which takes priority — this only ever fires while still en route
    // (walking/boarding done, vehicle driving, work not yet started).
    return { ...IDLE, kind: 'driving_to_task', vehicleId: drivenVehicle.id };
  }
  if (drivenVehicle) return { ...IDLE, kind: 'driving', vehicleId: drivenVehicle.id };

  if (employee.destinationX !== null || employee.destinationZ !== null) {
    return { ...IDLE, kind: 'walking', actionType: employee.pendingActionType };
  }

  return IDLE;
}

/**
 * Fraction of the current task's total duration completed, clamped to
 * [0, 1]. Null when `activity` isn't an active timed task — the same
 * 'working' + totalTicks > 0 guard the Crew panel's progress line and the
 * floating task-progress bar both need before they have anything to show.
 */
export function taskProgressFraction(activity: EmployeeActivity): number | null {
  if (activity.kind !== 'working' || activity.totalTicks === null || activity.totalTicks <= 0) return null;
  const ticksRemaining = activity.ticksRemaining ?? 0;
  return Math.min(1, Math.max(0, (activity.totalTicks - ticksRemaining) / activity.totalTicks));
}
