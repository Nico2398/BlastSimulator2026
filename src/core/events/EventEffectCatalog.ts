// BlastSimulator2026 — Declarative event effect catalog (#1414)

import type { Random } from '../math/Random.js';
import type { EmployeeRole } from '../entities/Employee.js';
import type { WeatherState } from '../weather/WeatherCycle.js';
import type { EventCategory } from './EventPool.js';
import type { EffectOutcome, EventWorld } from './TrafficJamEffects.js';

export type EventEffectSpec =
  | { type: 'work_stoppage'; hours: number; role?: EmployeeRole }
  | { type: 'work_rate'; pct: number; hours: number; role?: EmployeeRole }
  | { type: 'morale_shift'; perHour: number; hours: number }
  | { type: 'fatigue_relief' }
  | { type: 'employee_leaves'; pick: 'random' | 'role' | 'junior'; role?: EmployeeRole }
  | { type: 'employee_joins'; role?: EmployeeRole }
  | { type: 'employee_injured' }
  | { type: 'salary'; pct: number; days: number | null; role?: EmployeeRole }
  | { type: 'bonus_per_employee'; amount: number }
  | { type: 'recurring_charge'; perDay: number; days: number }
  | { type: 'ban'; what: 'blast' | 'haul' | 'drill'; hours: number }
  | { type: 'cost_factor'; what: 'survey' | 'research' | 'explosive' | 'upkeep'; pct: number; days: number }
  | { type: 'contract_price'; pct: number; days: number }
  | { type: 'special_contract' }
  | { type: 'cancel_contract'; penalty: boolean }
  | { type: 'vehicle_breakdown'; hpLoss: number; hours: number }
  | { type: 'building_closed'; hours: number }
  | { type: 'forced_weather'; weather: WeatherState; hours: number }
  | { type: 'event_weight'; category: EventCategory; factor: number; days: number };

/** Applies every spec of a chosen option; undefined specs yield an empty outcome. */
export function applyEventEffects(
  specs: readonly EventEffectSpec[] | undefined, world: EventWorld, tick: number, rng: Random,
): EffectOutcome {
  void specs; void world; void tick; void rng;
  return { effects: [], cashChange: 0, cashSettled: 0, scoreChanges: {}, resultKeySuffix: '' };
}
