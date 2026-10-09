// BlastSimulator2026 — Timed world modifiers raised by event effects (#1414)

import type { EmployeeRole, EmployeeState } from '../entities/Employee.js';
import type { ActionType } from '../state/GameState.js';
import type { FinanceState } from '../economy/Finance.js';
import type { WeatherCycleState } from '../weather/WeatherCycle.js';
import type { EventCategory } from './EventPool.js';
import { deductExpense } from '../economy/Finance.js';
import { clampScore } from '../scores/ScoreManager.js';
import { ALL_WEATHER_STATES } from '../weather/WeatherCycle.js';
import {
  MAX_ACTIVE_MODIFIERS, MODIFIER_FACTOR_MAX, MODIFIER_FACTOR_MIN, TICKS_PER_DAY,
} from '../config/balance.js';

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
  /** What targetId names for out_of_service; absent otherwise. */
  targetKind?: 'vehicle' | 'building';
  /** Event category an event_weight modifier scales; null otherwise. */
  category: EventCategory | null;
  /** Meaning depends on kind: factor, per-hour drift, per-day charge, or weather index. */
  magnitude: number;
  startTick: number;
  /** Tick the modifier lapses; null = permanent. */
  endTick: number | null;
}

/** A modifier that has not lapsed at `tick`. */
function isLive(m: ActiveModifier, tick: number): boolean {
  return m.endTick === null || m.endTick > tick;
}

function sameTarget(a: Omit<ActiveModifier, 'id'>, b: Omit<ActiveModifier, 'id'>): boolean {
  return a.kind === b.kind && a.role === b.role && a.targetId === b.targetId && a.targetKind === b.targetKind && a.category === b.category;
}

function clampFactor(v: number): number {
  return Math.min(MODIFIER_FACTOR_MAX, Math.max(MODIFIER_FACTOR_MIN, v));
}

function appliesToRole(m: ActiveModifier, role: EmployeeRole | undefined): boolean {
  return m.role === null || role === undefined || m.role === role;
}

/**
 * Adds a modifier and returns its id. A modifier equal in kind/role/target/category
 * to a stored one extends it instead (latest magnitude, never an earlier endTick) and
 * returns the existing id; otherwise `nextId` is used and the caller bumps its counter.
 * The list never exceeds MAX_ACTIVE_MODIFIERS: the soonest-lapsing entry makes room.
 */
export function addModifier(
  list: ActiveModifier[], m: Omit<ActiveModifier, 'id'>, nextId: number,
): number {
  const existing = list.find(e => sameTarget(e, m));
  if (existing) {
    existing.endTick = existing.endTick === null || m.endTick === null ? null : Math.max(existing.endTick, m.endTick);
    existing.magnitude = m.magnitude;
    return existing.id;
  }
  if (list.length >= MAX_ACTIVE_MODIFIERS) {
    let soonest = 0;
    for (let i = 1; i < list.length; i++) {
      if ((list[i]!.endTick ?? Infinity) < (list[soonest]!.endTick ?? Infinity)) soonest = i;
    }
    list.splice(soonest, 1);
  }
  list.push({ ...m, id: nextId });
  return nextId;
}

/** Drops modifiers whose endTick has passed. */
export function pruneExpired(list: ActiveModifier[], tick: number): void {
  for (let i = list.length - 1; i >= 0; i--) {
    if (!isLive(list[i]!, tick)) list.splice(i, 1);
  }
}

/** Ticks left on a modifier, null when permanent. */
export function remainingTicks(m: ActiveModifier, tick: number): number | null {
  return m.endTick === null ? null : Math.max(0, m.endTick - tick);
}

/** Product of the magnitudes of every modifier matching `predicate`, clamped to the modifier factor bounds. */
function productOf(list: readonly ActiveModifier[], predicate: (m: ActiveModifier) => boolean): number {
  let factor = 1;
  for (const m of list) {
    if (predicate(m)) factor *= m.magnitude;
  }
  return clampFactor(factor);
}

/** Work-rate multiplier for a role; 0 during a stoppage. */
export function workRate(list: readonly ActiveModifier[], role: EmployeeRole, tick: number): number {
  if (isActive(list, 'work_stoppage', tick, role)) return 0;
  return productOf(list, m => m.kind === 'work_rate' && isLive(m, tick) && appliesToRole(m, role));
}

/** Salary multiplier for a role. */
export function salaryFactor(list: readonly ActiveModifier[], role: EmployeeRole): number {
  return productOf(list, m => m.kind === 'salary_factor' && appliesToRole(m, role));
}

/** True when a live modifier of this kind (optionally for this role) exists. */
export function isActive(
  list: readonly ActiveModifier[], kind: ModifierKind, tick: number, role?: EmployeeRole,
): boolean {
  return list.some(m => m.kind === kind && isLive(m, tick) && appliesToRole(m, role));
}

/** Product of live magnitudes of this kind, clamped to the modifier factor bounds. */
export function factorFor(list: readonly ActiveModifier[], kind: ModifierKind, tick: number): number {
  return productOf(list, m => m.kind === kind && isLive(m, tick));
}

/** Frequency factor the live event_weight modifiers give one event category. */
export function eventWeightFactor(list: readonly ActiveModifier[], category: EventCategory, tick: number): number {
  return productOf(list, m => m.kind === 'event_weight' && m.category === category && isLive(m, tick));
}

/** Action types each ban kind keeps employees from claiming. */
const BANNED_ACTIONS: Partial<Record<ModifierKind, readonly ActionType[]>> = {
  drill_ban: ['drill_hole'],
  haul_pause: ['haul_debris', 'fragment_debris'],
};

/** True when this employee role may not claim an action of this type: rest is never blocked; a stoppage blocks the rest, a drill ban or haul pause its own types. */
export function actionBlocked(list: readonly ActiveModifier[], type: ActionType, tick: number, role: EmployeeRole): boolean {
  if (type === 'rest') return false;
  return isActive(list, 'work_stoppage', tick, role)
    || list.some(m => isLive(m, tick) && BANNED_ACTIONS[m.kind]?.includes(type) === true);
}

/** Holds the weather cycle on the state a live forced_weather modifier names; the cycle's own PRNG stream is left alone. */
export function holdForcedWeather(cycle: WeatherCycleState, list: readonly ActiveModifier[], tick: number): void {
  const forced = [...list].reverse().find(m => m.kind === 'forced_weather' && isLive(m, tick));
  const weather = forced ? ALL_WEATHER_STATES[forced.magnitude] : undefined;
  if (weather === undefined || cycle.current === weather) return;
  cycle.current = weather;
  cycle.ticksRemaining = Math.max(cycle.ticksRemaining, 1);
}

/** What one tick of modifier upkeep touches. */
interface ModifierTickState {
  tickCount: number;
  cash: number;
  finances: FinanceState;
  events: { activeModifiers: ActiveModifier[] };
  employees: EmployeeState;
}

/** Per-tick upkeep: lapsed modifiers drop, live recurring charges are paid, live morale drift is applied. */
export function tickModifiers(state: ModifierTickState): void {
  const list = state.events.activeModifiers;
  pruneExpired(list, state.tickCount);
  for (const m of list) {
    if (m.kind === 'recurring_charge') {
      deductExpense(state, m.magnitude / TICKS_PER_DAY, 'fines', `Event charge: ${m.sourceEventId}`);
    } else if (m.kind === 'morale_drift') {
      for (const emp of state.employees.employees) {
        if (emp.alive) emp.morale = clampScore(emp.morale + m.magnitude);
      }
    }
  }
}

/** Ids of vehicles or buildings a live out_of_service modifier takes out of use at `tick`. */
export function outOfServiceIds(
  list: readonly ActiveModifier[], kind: 'vehicle' | 'building', tick: number,
): ReadonlySet<number> {
  void list; void kind; void tick;
  return new Set<number>(); // TODO: implement
}

/** True when a live out_of_service modifier names this vehicle or building. */
export function isOutOfService(
  list: readonly ActiveModifier[], kind: 'vehicle' | 'building', id: number, tick: number,
): boolean {
  void list; void kind; void id; void tick;
  return false; // TODO: implement
}

/** A base price scaled by a modifier factor, rounded to whole cash. */
export function scaledCost(base: number, factor: number): number {
  void factor;
  return base; // TODO: implement
}
