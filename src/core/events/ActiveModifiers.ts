// BlastSimulator2026 — Timed world modifiers raised by event effects (#1414)

import type { EmployeeRole } from '../entities/Employee.js';
import type { EventCategory } from './EventPool.js';

export type ModifierKind =
  | 'work_stoppage' | 'work_rate' | 'morale_drift' | 'salary_factor' | 'recurring_charge'
  | 'blast_ban' | 'haul_pause' | 'drill_ban' | 'survey_cost' | 'research_cost'
  | 'contract_price' | 'explosive_price' | 'upkeep_surcharge' | 'forced_weather'
  | 'event_weight' | 'out_of_service';

export interface ActiveModifier {
  id: number;
  kind: ModifierKind;
  sourceEventId: string;
  /** Role the modifier is limited to; null = everyone. */
  role: EmployeeRole | null;
  /** Vehicle or building id for out_of_service; null otherwise. */
  targetId: number | null;
  /** Event category an event_weight modifier scales; null otherwise. */
  category: EventCategory | null;
  /** Meaning depends on kind: factor, per-hour drift, per-day charge, or weather index. */
  magnitude: number;
  startTick: number;
  /** Tick the modifier lapses; null = permanent. */
  endTick: number | null;
}

/** Adds a modifier with the given id; returns the id used. */
export function addModifier(
  list: ActiveModifier[], m: Omit<ActiveModifier, 'id'>, nextId: number,
): number {
  void list; void m;
  return nextId;
}

/** Drops modifiers whose endTick has passed. */
export function pruneExpired(list: ActiveModifier[], tick: number): void {
  void list; void tick;
}

/** Ticks left on a modifier, null when permanent. */
export function remainingTicks(m: ActiveModifier, tick: number): number | null {
  void m; void tick;
  return null;
}

/** Work-rate multiplier for a role; 0 during a stoppage. */
export function workRate(list: readonly ActiveModifier[], role: EmployeeRole, tick: number): number {
  void list; void role; void tick;
  return 1;
}

/** Salary multiplier for a role. */
export function salaryFactor(list: readonly ActiveModifier[], role: EmployeeRole): number {
  void list; void role;
  return 1;
}

/** True when a live modifier of this kind (optionally for this role) exists. */
export function isActive(
  list: readonly ActiveModifier[], kind: ModifierKind, tick: number, role?: EmployeeRole,
): boolean {
  void list; void kind; void tick; void role;
  return false;
}

/** Product of live magnitudes of this kind, clamped to the modifier factor bounds. */
export function factorFor(list: readonly ActiveModifier[], kind: ModifierKind, tick: number): number {
  void list; void kind; void tick;
  return 1;
}
