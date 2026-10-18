// BlastSimulator2026 — Which employee an employee_leaves event option takes, drawn when the event fires (#1908)

import type { Random } from '../math/Random.js';
import { getLivingEmployees, type Employee, type EmployeeRole } from '../entities/Employee.js';
import type { EventEffectSpec } from './EventEffectCatalog.js';
import { getEventById, type EventDef } from './EventPool.js';
import type { EventSystemState, FiredEvent } from './EventSystem.js';

type LeaveSpec = Extract<EventEffectSpec, { type: 'employee_leaves' }>;

/** The employee an employee_leaves spec picks, or undefined when nobody matches. */
export function pickLeaver(
  spec: LeaveSpec, staff: readonly Employee[], rng: Random,
): Employee | undefined {
  const pool = spec.pick === 'role' ? staff.filter(e => e.role === spec.role) : staff;
  if (pool.length === 0) return undefined;
  if (spec.pick === 'junior') {
    // Most recently hired; ids only grow, so the highest id breaks a same-tick tie.
    return pool.reduce((a, b) => ((b.hiredAtTick ?? 0) > (a.hiredAtTick ?? 0) || ((b.hiredAtTick ?? 0) === (a.hiredAtTick ?? 0) && b.id > a.id) ? b : a));
  }
  return pool[rng.nextInt(0, pool.length - 1)];
}

/** The leaver drawn for one option; employeeId is null when nobody matched. */
export interface LeaverDraw {
  optionIndex: number;
  employeeId: number | null;
}

/** One draw per option holding an employee_leaves spec. */
export function drawLeavers(def: EventDef, staff: readonly Employee[], rng: Random): LeaverDraw[] {
  const draws: LeaverDraw[] = [];
  def.consequences.forEach((consequence, optionIndex) => {
    const spec = consequence.effects?.find((e): e is LeaveSpec => e.type === 'employee_leaves');
    if (spec) draws.push({ optionIndex, employeeId: pickLeaver(spec, staff, rng)?.id ?? null });
  });
  return draws;
}

/** Draws the leavers for def and stores them on the pending event. No-op without both. */
export function storeLeavers(
  pending: FiredEvent | null, def: EventDef | undefined, staff: readonly Employee[], rng: Random,
): void {
  if (!pending || !def) return;
  const draws = drawLeavers(def, staff, rng);
  if (draws.length > 0) pending.leavers = draws;
}

/** Draws the leavers for the event that just fired (the pending one) from the living staff. No-op without a pending event or its def. */
export function drawPendingLeavers(
  events: Pick<EventSystemState, 'pendingEvent'>, employees: readonly Employee[], rng: Random,
): void {
  const pending = events.pendingEvent;
  if (!pending) return;
  storeLeavers(pending, getEventById(pending.eventId), getLivingEmployees(employees), rng);
}

/** The draw stored for one option of the pending event, if that option draws a leaver. */
export function leaverDraw(pending: FiredEvent | null, optionIndex: number): LeaverDraw | undefined {
  return pending?.leavers?.find(d => d.optionIndex === optionIndex);
}

/** Who an option takes: a named employee, or 'nobody' when no one matched. */
export type LeaverLabel = { name: string; role: EmployeeRole } | 'nobody';

/** The label for one option of the pending event; undefined when the option draws no leaver. */
export function leaverLabel(
  pending: FiredEvent | null, optionIndex: number, staff: readonly Employee[],
): LeaverLabel | undefined {
  const draw = leaverDraw(pending, optionIndex);
  if (!draw) return undefined;
  const who = draw.employeeId === null ? undefined : staff.find(e => e.id === draw.employeeId && e.alive);
  return who ? { name: who.name, role: who.role } : 'nobody';
}
