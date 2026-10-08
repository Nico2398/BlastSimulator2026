import { describe, it, expect, beforeEach } from 'vitest';
import { applyEventEffects, type EventEffectSpec } from '../../../src/core/events/EventEffectCatalog.js';
import { effectChips, effectChipText } from '../../../src/core/events/EventEffectText.js';
import { applyInstantEffect } from '../../../src/core/events/EventEffectInstant.js';
import { workRate, isActive, salaryFactor, factorFor } from '../../../src/core/events/ActiveModifiers.js';
import { TICKS_PER_DAY } from '../../../src/core/config/balance.js';
import { makeEffectWorld } from '../../helpers/eventEffectWorld.js';
import { Random } from '../../../src/core/math/Random.js';

/** One representative spec per kind of the EventEffectSpec union. */
const ALL_SPECS: EventEffectSpec[] = [
  { type: 'work_stoppage', hours: 12 },
  { type: 'work_rate', pct: -50, hours: 24 },
  { type: 'morale_shift', perHour: -1, hours: 10 },
  { type: 'fatigue_relief' },
  { type: 'employee_leaves', pick: 'random' },
  { type: 'employee_joins' },
  { type: 'employee_injured' },
  { type: 'salary', pct: 10, days: 5 },
  { type: 'bonus_per_employee', amount: 100 },
  { type: 'recurring_charge', perDay: 500, days: 3 },
  { type: 'ban', what: 'blast', hours: 24 },
  { type: 'cost_factor', what: 'survey', pct: 50, days: 2 },
  { type: 'contract_price', pct: -20, days: 3 },
  { type: 'special_contract' },
  { type: 'cancel_contract', penalty: true },
  { type: 'vehicle_breakdown', hpLoss: 20, hours: 12 },
  { type: 'building_closed', hours: 12 },
  { type: 'forced_weather', weather: 'storm', hours: 6 },
  { type: 'event_weight', category: 'union', factor: 2, days: 4 },
];

describe('applyEventEffects', () => {
  it('returns an empty outcome for undefined specs', () => {
    const { world, rng } = makeEffectWorld();
    const out = applyEventEffects(undefined, world, 0, rng);
    expect(out.effects).toEqual([]);
    expect(out.cashChange).toBe(0);
    expect(out.resultKeySuffix).toBe('');
  });

  it.each(ALL_SPECS.map(s => [s.type, s] as const))('applies spec %s without throwing', (_t, spec) => {
    const { world, rng } = makeEffectWorld();
    expect(() => applyEventEffects([spec], world, 10, rng)).not.toThrow();
  });

  it('every EventEffectSpec kind is covered by the fixture list', () => {
    expect(new Set(ALL_SPECS.map(s => s.type)).size).toBe(19);
  });

  describe('timed modifiers', () => {
    let fx: ReturnType<typeof makeEffectWorld>;
    beforeEach(() => { fx = makeEffectWorld(); });
    const mods = () => fx.state.events.activeModifiers;

    it('work_stoppage adds an all-role stoppage lasting `hours` ticks', () => {
      applyEventEffects([{ type: 'work_stoppage', hours: 48 }], fx.world, 100, fx.rng);
      const m = mods().find(x => x.kind === 'work_stoppage')!;
      expect(m.role).toBeNull();
      expect(m.startTick).toBe(100);
      expect(m.endTick).toBe(148);
      expect(workRate(mods(), 'driller', 101)).toBe(0);
    });

    it('work_stoppage with a role limits to that role', () => {
      applyEventEffects([{ type: 'work_stoppage', hours: 10, role: 'driller' }], fx.world, 0, fx.rng);
      expect(workRate(mods(), 'driller', 1)).toBe(0);
      expect(workRate(mods(), 'driver', 1)).toBe(1);
    });

    it('work_rate pct -40 gives a 0.6 factor', () => {
      applyEventEffects([{ type: 'work_rate', pct: -40, hours: 60 }], fx.world, 0, fx.rng);
      expect(workRate(mods(), 'blaster', 59)).toBeCloseTo(0.6);
      expect(workRate(mods(), 'blaster', 60)).toBe(1);
    });

    it.each([['blast', 'blast_ban'], ['haul', 'haul_pause'], ['drill', 'drill_ban']] as const)(
      'ban %s adds %s', (what, kind) => {
        applyEventEffects([{ type: 'ban', what, hours: 24 }], fx.world, 0, fx.rng);
        expect(isActive(mods(), kind, 5)).toBe(true);
        expect(isActive(mods(), kind, 24)).toBe(false);
      });

    it('salary pct 20 for 5 days raises the factor for the span', () => {
      applyEventEffects([{ type: 'salary', pct: 20, days: 5 }], fx.world, 0, fx.rng);
      expect(salaryFactor(mods(), 'driller')).toBeCloseTo(1.2);
      const m = mods().find(x => x.kind === 'salary_factor')!;
      expect(m.endTick).toBe(5 * TICKS_PER_DAY);
    });

    it('salary with days null is permanent', () => {
      applyEventEffects([{ type: 'salary', pct: 10, days: null }], fx.world, 0, fx.rng);
      expect(mods().find(x => x.kind === 'salary_factor')!.endTick).toBeNull();
    });

    it('contract_price pct -25 for 2 days scales the contract price factor', () => {
      applyEventEffects([{ type: 'contract_price', pct: -25, days: 2 }], fx.world, 0, fx.rng);
      expect(factorFor(mods(), 'contract_price', 10)).toBeCloseTo(0.75);
      expect(mods().find(x => x.kind === 'contract_price')!.endTick).toBe(2 * TICKS_PER_DAY);
    });

    it('event_weight stores category and factor', () => {
      applyEventEffects([{ type: 'event_weight', category: 'mafia', factor: 3, days: 1 }], fx.world, 0, fx.rng);
      const m = mods().find(x => x.kind === 'event_weight')!;
      expect(m.category).toBe('mafia');
      expect(m.magnitude).toBe(3);
      expect(m.endTick).toBe(TICKS_PER_DAY);
    });

    it('forced_weather adds a forced_weather modifier for the hours', () => {
      applyEventEffects([{ type: 'forced_weather', weather: 'storm', hours: 6 }], fx.world, 4, fx.rng);
      const m = mods().find(x => x.kind === 'forced_weather')!;
      expect(m.endTick).toBe(10);
    });

    it('recurring_charge adds a per-day charge modifier', () => {
      applyEventEffects([{ type: 'recurring_charge', perDay: 750, days: 3 }], fx.world, 0, fx.rng);
      const m = mods().find(x => x.kind === 'recurring_charge')!;
      expect(m.magnitude).toBe(750);
      expect(m.endTick).toBe(3 * TICKS_PER_DAY);
    });

    it('cost_factor adds the matching cost kind', () => {
      applyEventEffects([{ type: 'cost_factor', what: 'explosive', pct: 30, days: 2 }], fx.world, 0, fx.rng);
      expect(factorFor(mods(), 'explosive_price', 5)).toBeCloseTo(1.3);
    });

    it('morale_shift adds a morale_drift modifier', () => {
      applyEventEffects([{ type: 'morale_shift', perHour: -2, hours: 5 }], fx.world, 0, fx.rng);
      const m = mods().find(x => x.kind === 'morale_drift')!;
      expect(m.magnitude).toBe(-2);
      expect(m.endTick).toBe(5);
    });

    it('registers the raised modifier ids from nextModifierId upward', () => {
      const before = fx.state.events.nextModifierId;
      applyEventEffects([{ type: 'work_stoppage', hours: 1 }, { type: 'ban', what: 'blast', hours: 1 }], fx.world, 0, fx.rng);
      expect(fx.state.events.nextModifierId).toBe(before + 2);
      expect(mods().map(m => m.id)).toEqual([before, before + 1]);
    });

    it('describes each effect in plain text (no empty effects)', () => {
      // The outcome carries structured chips (effectChips), not pre-formatted English in EffectOutcome.effects.
      const chips = effectChips(ALL_SPECS);
      expect(chips).toHaveLength(ALL_SPECS.length);
      for (const chip of chips) expect((effectChipText(chip) ?? '').length).toBeGreaterThan(0);
    });
  });

  describe('_alt fallbacks', () => {
    it('employee_leaves with no employees falls back to _alt', () => {
      const { world, rng } = makeEffectWorld({ empty: true });
      const out = applyEventEffects([{ type: 'employee_leaves', pick: 'random' }], world, 0, rng);
      expect(out.resultKeySuffix).toBe('_alt');
    });
    it('employee_leaves for an absent role falls back to _alt', () => {
      const { world, rng, state } = makeEffectWorld();
      state.employees.employees = state.employees.employees.filter(e => e.role !== 'surveyor');
      const out = applyEventEffects([{ type: 'employee_leaves', pick: 'role', role: 'surveyor' }], world, 0, rng);
      expect(out.resultKeySuffix).toBe('_alt');
    });
    it('vehicle_breakdown with no vehicles falls back to _alt', () => {
      const { world, rng } = makeEffectWorld({ empty: true });
      const out = applyEventEffects([{ type: 'vehicle_breakdown', hpLoss: 10, hours: 6 }], world, 0, rng);
      expect(out.resultKeySuffix).toBe('_alt');
    });
    it('cancel_contract with no active contract falls back to _alt', () => {
      const { world, rng } = makeEffectWorld();
      const out = applyEventEffects([{ type: 'cancel_contract', penalty: false }], world, 0, rng);
      expect(out.resultKeySuffix).toBe('_alt');
    });
    it('employee_injured with no employees falls back to _alt', () => {
      const { world, rng } = makeEffectWorld({ empty: true });
      expect(applyEventEffects([{ type: 'employee_injured' }], world, 0, rng).resultKeySuffix).toBe('_alt');
    });
    it('a spec that succeeds leaves the suffix empty', () => {
      const { world, rng } = makeEffectWorld();
      expect(applyEventEffects([{ type: 'work_stoppage', hours: 1 }], world, 0, rng).resultKeySuffix).toBe('');
    });
  });

  it('is deterministic for a seeded rng', () => {
    const run = () => {
      const fx = makeEffectWorld({ seed: 7 });
      const out = applyEventEffects(
        [{ type: 'employee_leaves', pick: 'random' }, { type: 'employee_injured' }], fx.world, 3, new Random(99));
      return { out, ids: fx.state.employees.employees.filter(e => e.alive && !e.injured).map(e => e.id) };
    };
    expect(run()).toEqual(run());
  });

  it('applyInstantEffect mirrors applyEventEffects for an instant spec', () => {
    const fx = makeEffectWorld();
    const out = applyInstantEffect({ type: 'bonus_per_employee', amount: 100 }, fx.world, 0, fx.rng);
    expect(out.cashChange + out.cashSettled).not.toBe(0);
  });
});
