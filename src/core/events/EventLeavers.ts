// BlastSimulator2026 — Which employee an employee_leaves event option takes, drawn when the event fires (#1908)

import type { Random } from '../math/Random.js';
import type { Employee, EmployeeRole } from '../entities/Employee.js';
import type { EventEffectSpec } from './EventEffectCatalog.js';
import type { EventDef } from './EventPool.js';
import type { FiredEvent } from './EventSystem.js';

/** The employee an employee_leaves spec picks, or undefined when nobody matches. */
export function pickLeaver(
  spec: Extract<EventEffectSpec, { type: 'employee_leaves' }>, staff: readonly Employee[], rng: Random,
): Employee | undefined {
  void spec; void staff; void rng;
  return undefined;
}

/** The leaver drawn for one option; employeeId is null when nobody matched. */
export interface LeaverDraw {
  optionIndex: number;
  employeeId: number | null;
}

/** One draw per option holding an employee_leaves spec. */
export function drawLeavers(def: EventDef, staff: readonly Employee[], rng: Random): LeaverDraw[] {
  void def; void staff; void rng;
  return [];
}

/** Draws the leavers for def and stores them on the pending event. No-op without both. */
export function storeLeavers(
  pending: FiredEvent | null, def: EventDef | undefined, staff: readonly Employee[], rng: Random,
): void {
  void pending; void def; void staff; void rng;
}

/** Who an option takes: a named employee, or 'nobody' when no one matched. */
export type LeaverLabel = { name: string; role: EmployeeRole } | 'nobody';

/** The label for one option of the pending event; undefined when the option draws no leaver. */
export function leaverLabel(
  pending: FiredEvent | null, optionIndex: number, staff: readonly Employee[],
): LeaverLabel | undefined {
  void pending; void optionIndex; void staff;
  return undefined;
}
