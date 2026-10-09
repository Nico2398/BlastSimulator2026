// BlastSimulator2026 — Declarative event effect catalog (#1414)

import type { Random } from '../math/Random.js';
import type { EmployeeRole } from '../entities/Employee.js';
import type { WeatherState } from '../weather/WeatherCycle.js';
import type { EventCategory } from './EventPool.js';
import type { EffectOutcome, EventWorld } from './TrafficJamEffects.js';
import { addModifier, holdForcedWeather, type ActiveModifier, type ModifierKind } from './ActiveModifiers.js';
import { applyInstantEffect } from './EventEffectInstant.js';
import { ALL_WEATHER_STATES } from '../weather/WeatherCycle.js';
import { EVENT_EFFECT_BUILDING_HP_LOSS, TICKS_PER_DAY } from '../config/balance.js';

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

type ModifierDraft = Omit<ActiveModifier, 'id'>;

const COST_FACTOR_KIND = {
  survey: 'survey_cost', research: 'research_cost', explosive: 'explosive_price', upkeep: 'upkeep_surcharge',
} as const satisfies Record<'survey' | 'research' | 'explosive' | 'upkeep', ModifierKind>;

const BAN_KIND = { blast: 'blast_ban', haul: 'haul_pause', drill: 'drill_ban' } as const satisfies Record<'blast' | 'haul' | 'drill', ModifierKind>;

/** Percent change to a multiplier: -40 -> 0.6. */
const factorOfPct = (pct: number): number => 1 + pct / 100;

/** The modifier a timed spec raises, or null when the spec is instant or an asset effect. */
function timedModifier(spec: EventEffectSpec, tick: number, base: Pick<ModifierDraft, 'sourceEventId'>): ModifierDraft | null {
  const draft = (kind: ModifierKind, magnitude: number, ticks: number | null, over: Partial<ModifierDraft> = {}): ModifierDraft => ({
    ...base, kind, role: null, targetId: null, category: null, magnitude, startTick: tick,
    endTick: ticks === null ? null : tick + ticks, ...over,
  });
  switch (spec.type) {
    case 'work_stoppage': return draft('work_stoppage', 0, spec.hours, { role: spec.role ?? null });
    case 'work_rate': return draft('work_rate', factorOfPct(spec.pct), spec.hours, { role: spec.role ?? null });
    case 'morale_shift': return draft('morale_drift', spec.perHour, spec.hours);
    case 'salary':
      return draft('salary_factor', factorOfPct(spec.pct), spec.days === null ? null : spec.days * TICKS_PER_DAY, { role: spec.role ?? null });
    case 'recurring_charge': return draft('recurring_charge', spec.perDay, spec.days * TICKS_PER_DAY);
    case 'ban': return draft(BAN_KIND[spec.what], 1, spec.hours);
    case 'cost_factor': return draft(COST_FACTOR_KIND[spec.what], factorOfPct(spec.pct), spec.days * TICKS_PER_DAY);
    case 'contract_price': return draft('contract_price', factorOfPct(spec.pct), spec.days * TICKS_PER_DAY);
    case 'forced_weather': return draft('forced_weather', ALL_WEATHER_STATES.indexOf(spec.weather), spec.hours);
    case 'event_weight': return draft('event_weight', spec.factor, spec.days * TICKS_PER_DAY, { category: spec.category });
    default: return null;
  }
}

/** Takes a random vehicle or building out of service and damages it; 'none' when the site owns none (the caller falls back to the '_alt' result text), null when the spec is not an asset effect. */
function assetModifier(spec: EventEffectSpec, world: EventWorld, tick: number, rng: Random, base: Pick<ModifierDraft, 'sourceEventId'>): ModifierDraft | 'none' | null {
  if (spec.type !== 'vehicle_breakdown' && spec.type !== 'building_closed') return null;
  const { vehicles, buildings } = world.state;
  const owned = spec.type === 'vehicle_breakdown' ? vehicles.vehicles : buildings.buildings;
  if (owned.length === 0) return 'none';
  const target = owned[rng.nextInt(0, owned.length - 1)]!;
  target.hp = Math.max(1, target.hp - (spec.type === 'vehicle_breakdown' ? spec.hpLoss : EVENT_EFFECT_BUILDING_HP_LOSS));
  return {
    ...base, kind: 'out_of_service', role: null, targetId: target.id,
    targetKind: spec.type === 'vehicle_breakdown' ? 'vehicle' : 'building',
    category: null, magnitude: 1, startTick: tick, endTick: tick + spec.hours,
  };
}

/** Applies every spec of a chosen option; undefined specs yield an empty outcome. Timed specs are registered on state.events. */
export function applyEventEffects(
  specs: readonly EventEffectSpec[] | undefined, world: EventWorld, tick: number, rng: Random,
): EffectOutcome {
  const total: EffectOutcome = { effects: [], cashChange: 0, cashSettled: 0, scoreChanges: {}, resultKeySuffix: '' };
  const events = world.state.events;
  const base = { sourceEventId: events.pendingEvent?.eventId ?? '' };
  for (const spec of specs ?? []) {
    const asset = assetModifier(spec, world, tick, rng, base);
    const draft = asset === null ? timedModifier(spec, tick, base) : asset;
    if (draft === 'none') {
      total.resultKeySuffix = '_alt';
    } else if (draft !== null) {
      const id = addModifier(events.activeModifiers, draft, events.nextModifierId);
      if (id === events.nextModifierId) events.nextModifierId++;
    } else {
      const out = applyInstantEffect(spec, world, tick, rng);
      total.cashChange += out.cashChange;
      total.cashSettled += out.cashSettled;
      for (const [k, d] of Object.entries(out.scoreChanges) as [keyof typeof out.scoreChanges, number][]) {
        total.scoreChanges[k] = (total.scoreChanges[k] ?? 0) + d;
      }
      if (out.resultKeySuffix === '_alt') total.resultKeySuffix = '_alt';
    }
  }
  holdForcedWeather(world.state.weather, events.activeModifiers, tick);
  return total;
}
