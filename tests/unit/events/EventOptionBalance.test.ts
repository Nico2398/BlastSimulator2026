// Event option balance (#1894): no option of an event may be Pareto-dominated by a sibling.
import { describe, it, expect, beforeEach } from 'vitest';
import { optionValue, dominates, findDominatedPairs } from '../../../src/core/events/EventOptionBalance.js';
import type { EventConsequence, EventDef } from '../../../src/core/events/EventPool.js';
import { getAllEvents, clearEvents } from '../../../src/core/events/EventPool.js';
import { setupEvents } from '../../../src/core/events/index.js';
import { EVENT_BALANCE_PERMANENT_DAYS, EVENT_BALANCE_REFERENCE_CREW } from '../../../src/core/config/balance.js';

function dim(c: EventConsequence, name: string): number {
  return optionValue(c).dims[name] ?? 0;
}

function evOf(consequences: EventConsequence[], id = 'test_ev'): EventDef {
  return {
    id,
    category: 'mining',
    titleKey: 't',
    descKey: 'd',
    options: consequences.map((_, i) => ({ labelKey: `o${i}`, resultKey: `r${i}` })),
    consequences,
    weightCoeff: () => 1,
    canFire: () => true,
  };
}

describe('optionValue', () => {
  it('cash dim equals cashDelta', () => {
    expect(dim({ cashDelta: -300 }, 'cash')).toBe(-300);
  });

  it('empty consequence has no non-zero dims', () => {
    const v = optionValue({});
    for (const x of Object.values(v.dims)) expect(x).toBeCloseTo(0, 9);
  });

  it('score deltas map to one dim per key, not sign-flipped (nuisance included)', () => {
    const v = optionValue({ scoreDelta: { wellBeing: 4, nuisance: -3 } });
    expect(v.dims['wellBeing']).toBe(4);
    expect(v.dims['nuisance']).toBe(-3);
  });

  it('corruption counts as a cost', () => {
    expect(dim({ corruptionDelta: 5 }, 'corruption')).toBe(-5);
  });

  it('exposure counts as a cost', () => {
    expect(dim({ exposureDelta: 0.2 }, 'exposure')).toBeCloseTo(-0.2, 9);
  });

  it('effectTag is ignored', () => {
    const a = optionValue({ cashDelta: 10, effectTag: 'x' });
    const b = optionValue({ cashDelta: 10 });
    expect(dominates(a, b)).toBe(false);
    expect(dominates(b, a)).toBe(false);
    expect(a.opaque).toBe(b.opaque);
  });

  it('probability weights main branch by p and alt by 1-p', () => {
    const c: EventConsequence = {
      cashDelta: 1000,
      probability: 0.25,
      altConsequence: { cashDelta: -400 },
    };
    expect(dim(c, 'cash')).toBeCloseTo(0.25 * 1000 + 0.75 * -400, 9);
  });

  it('missing alt counts as an empty consequence', () => {
    expect(dim({ cashDelta: 1000, probability: 0.5 }, 'cash')).toBeCloseTo(500, 9);
  });

  it('effects are weighted by branch weight', () => {
    const c: EventConsequence = {
      probability: 0.5,
      effects: [{ type: 'work_stoppage', hours: 10 }],
      altConsequence: { effects: [{ type: 'work_stoppage', hours: 2 }] },
    };
    expect(dim(c, 'work')).toBeCloseTo(-(0.5 * 10 + 0.5 * 2), 9);
  });

  it('work_stoppage -> work: -hours', () => {
    expect(dim({ effects: [{ type: 'work_stoppage', hours: 8 }] }, 'work')).toBeCloseTo(-8, 9);
  });

  it('work_rate -> work: pct/100*hours', () => {
    expect(dim({ effects: [{ type: 'work_rate', pct: 20, hours: 10 }] }, 'work')).toBeCloseTo(2, 9);
    expect(dim({ effects: [{ type: 'work_rate', pct: -50, hours: 10 }] }, 'work')).toBeCloseTo(-5, 9);
  });

  it('morale_shift -> morale: perHour*hours', () => {
    expect(dim({ effects: [{ type: 'morale_shift', perHour: 2, hours: 6 }] }, 'morale')).toBeCloseTo(12, 9);
  });

  it('crew effects: fatigue_relief +1, leaves -1, joins +1, injured -1', () => {
    expect(dim({ effects: [{ type: 'fatigue_relief' }] }, 'fatigue')).toBeCloseTo(1, 9);
    expect(dim({ effects: [{ type: 'employee_leaves', pick: 'random' }] }, 'crew')).toBeCloseTo(-1, 9);
    expect(dim({ effects: [{ type: 'employee_joins' }] }, 'crew')).toBeCloseTo(1, 9);
    expect(dim({ effects: [{ type: 'employee_injured' }] }, 'injury')).toBeCloseTo(-1, 9);
  });

  it('salary -> payroll: -pct*days, permanent uses EVENT_BALANCE_PERMANENT_DAYS', () => {
    expect(dim({ effects: [{ type: 'salary', pct: 10, days: 30 }] }, 'payroll')).toBeCloseTo(-300, 9);
    expect(dim({ effects: [{ type: 'salary', pct: 10, days: null }] }, 'payroll'))
      .toBeCloseTo(-10 * EVENT_BALANCE_PERMANENT_DAYS, 9);
  });

  it('bonus_per_employee -> cash: -amount*reference crew', () => {
    expect(dim({ effects: [{ type: 'bonus_per_employee', amount: 100 }] }, 'cash'))
      .toBeCloseTo(-100 * EVENT_BALANCE_REFERENCE_CREW, 9);
  });

  it('recurring_charge -> cash: -perDay*days', () => {
    expect(dim({ effects: [{ type: 'recurring_charge', perDay: 50, days: 10 }] }, 'cash')).toBeCloseTo(-500, 9);
  });

  it('ban -> ban: -hours', () => {
    expect(dim({ effects: [{ type: 'ban', what: 'blast', hours: 12 }] }, 'ban')).toBeCloseTo(-12, 9);
  });

  it('cost_factor -> costs: -pct*days; contract_price -> income: pct*days', () => {
    expect(dim({ effects: [{ type: 'cost_factor', what: 'survey', pct: 10, days: 5 }] }, 'costs')).toBeCloseTo(-50, 9);
    expect(dim({ effects: [{ type: 'contract_price', pct: 10, days: 5 }] }, 'income')).toBeCloseTo(50, 9);
  });

  it('contract effects: special +1 income, cancel -1 or -2 with penalty on contracts', () => {
    expect(dim({ effects: [{ type: 'special_contract' }] }, 'income')).toBeCloseTo(1, 9);
    expect(dim({ effects: [{ type: 'cancel_contract', penalty: false }] }, 'contracts')).toBeCloseTo(-1, 9);
    expect(dim({ effects: [{ type: 'cancel_contract', penalty: true }] }, 'contracts')).toBeCloseTo(-2, 9);
  });

  it('vehicle_breakdown and building_closed -> outOfService: -hours', () => {
    expect(dim({ effects: [{ type: 'vehicle_breakdown', hpLoss: 10, hours: 7 }] }, 'outOfService')).toBeCloseTo(-7, 9);
    expect(dim({ effects: [{ type: 'building_closed', hours: 9 }] }, 'outOfService')).toBeCloseTo(-9, 9);
  });

  it('follow-up event id goes into the opaque signature with branch weight', () => {
    const a = optionValue({ followUpEventId: 'x' });
    const b = optionValue({ followUpEventId: 'y' });
    const none = optionValue({});
    expect(a.opaque).toContain('fu:x@');
    expect(a.opaque).not.toBe(b.opaque);
    expect(a.opaque).not.toBe(none.opaque);
  });

  it('forced_weather and event_weight effects change the opaque signature', () => {
    const none = optionValue({});
    const w = optionValue({ effects: [{ type: 'forced_weather', weather: 'rain' as never, hours: 3 }] });
    const e = optionValue({ effects: [{ type: 'event_weight', category: 'union', factor: 2, days: 3 }] });
    expect(w.opaque).not.toBe(none.opaque);
    expect(e.opaque).not.toBe(none.opaque);
    expect(w.opaque).not.toBe(e.opaque);
  });
});

describe('dominates', () => {
  const v = (c: EventConsequence) => optionValue(c);

  it('cash-only: more cash dominates less', () => {
    expect(dominates(v({ cashDelta: -100 }), v({ cashDelta: -500 }))).toBe(true);
    expect(dominates(v({ cashDelta: -500 }), v({ cashDelta: -100 }))).toBe(false);
  });

  it('identical options tie', () => {
    expect(dominates(v({ cashDelta: 5 }), v({ cashDelta: 5 }))).toBe(false);
  });

  it('tradeoff is incomparable both ways', () => {
    const a = v({ cashDelta: -1000, scoreDelta: { safety: 10 } });
    const b = v({ cashDelta: 0, scoreDelta: { safety: -10 } });
    expect(dominates(a, b)).toBe(false);
    expect(dominates(b, a)).toBe(false);
  });

  it('corruption is a cost: clean option dominates equal-cash corrupt one', () => {
    expect(dominates(v({ cashDelta: 100 }), v({ cashDelta: 100, corruptionDelta: 3 }))).toBe(true);
    expect(dominates(v({ cashDelta: 100, corruptionDelta: 3 }), v({ cashDelta: 100 }))).toBe(false);
  });

  it('corruption for cash is a tradeoff', () => {
    expect(dominates(v({ cashDelta: 500, corruptionDelta: 3 }), v({ cashDelta: 100 }))).toBe(false);
    expect(dominates(v({ cashDelta: 100 }), v({ cashDelta: 500, corruptionDelta: 3 }))).toBe(false);
  });

  it('missing dim counts as zero (union of dims)', () => {
    expect(dominates(v({ scoreDelta: { safety: 2 } }), v({}))).toBe(true);
    expect(dominates(v({}), v({ scoreDelta: { safety: -2 } }))).toBe(true);
    expect(dominates(v({ scoreDelta: { safety: 2 } }), v({ cashDelta: 5 }))).toBe(false);
  });

  it('expected value with probability and alt is used', () => {
    const risky = v({ cashDelta: 1000, probability: 0.5, altConsequence: { cashDelta: -1000 } }); // EV 0
    expect(dominates(v({ cashDelta: 1 }), risky)).toBe(true);
    expect(dominates(risky, v({ cashDelta: 1 }))).toBe(false);
  });

  it('lasting stoppage is dominated by no stoppage', () => {
    const stop = v({ cashDelta: 0, effects: [{ type: 'work_stoppage', hours: 24 }] });
    const none = v({ cashDelta: 0 });
    expect(dominates(none, stop)).toBe(true);
    expect(dominates(stop, none)).toBe(false);
  });

  it('differing follow-up events are incomparable even if numbers favour one', () => {
    const a = v({ cashDelta: 100, followUpEventId: 'a' });
    const b = v({ cashDelta: -100, followUpEventId: 'b' });
    expect(dominates(a, b)).toBe(false);
    expect(dominates(b, a)).toBe(false);
  });

  it('same follow-up event compares numerically', () => {
    const a = v({ cashDelta: 100, followUpEventId: 'a' });
    const b = v({ cashDelta: -100, followUpEventId: 'a' });
    expect(dominates(a, b)).toBe(true);
  });

  it('tolerance: differences under 1e-9 tie', () => {
    expect(dominates(v({ cashDelta: 1 + 1e-12 }), v({ cashDelta: 1 }))).toBe(false);
  });
});

describe('findDominatedPairs', () => {
  it('returns [] when options trade off', () => {
    const ev = evOf([{ cashDelta: -100, scoreDelta: { safety: 5 } }, { cashDelta: 0 }]);
    expect(findDominatedPairs(ev)).toEqual([]);
  });

  it('reports winner and loser indices with the event id', () => {
    const ev = evOf([{ cashDelta: -500 }, { cashDelta: -100 }], 'e1');
    expect(findDominatedPairs(ev)).toEqual([{ eventId: 'e1', winner: 1, loser: 0 }]);
  });

  it('reports every dominated pair', () => {
    const ev = evOf([{ cashDelta: 0 }, { cashDelta: -10 }, { cashDelta: -20 }], 'e2');
    const pairs = findDominatedPairs(ev);
    expect(pairs).toHaveLength(3);
    expect(pairs).toContainEqual({ eventId: 'e2', winner: 0, loser: 1 });
    expect(pairs).toContainEqual({ eventId: 'e2', winner: 0, loser: 2 });
    expect(pairs).toContainEqual({ eventId: 'e2', winner: 1, loser: 2 });
  });

  it('identical options are not dominated', () => {
    expect(findDominatedPairs(evOf([{ cashDelta: 5 }, { cashDelta: 5 }]))).toEqual([]);
  });

  it('single-option event has none', () => {
    expect(findDominatedPairs(evOf([{ cashDelta: 5 }]))).toEqual([]);
  });
});

describe('event pool option balance (#1894)', () => {
  beforeEach(() => {
    clearEvents();
    setupEvents();
  });

  it('no option of any event is dominated by a sibling option', () => {
    const offenders = getAllEvents().flatMap(ev =>
      findDominatedPairs(ev).map(p => `${p.eventId}#${p.winner}>${p.loser}`));
    expect(offenders, `dominated options: ${offenders.join(', ')}`).toEqual([]);
  });
});
