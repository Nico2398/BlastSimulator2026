// Event weight (#2146): an event is major (a blocking modal) or minor (a non-blocking notice),
// decided by what its options can cost.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  eventWeight,
  isMajorEvent,
  defaultNoticeOption,
  cheapestEventOption,
  outcomeCostsCrew,
} from '../../../src/core/events/EventWeight.js';
import { EVENT_MAJOR_CASH_SHARE, EVENT_NOTICE_COUNTDOWN_TICKS } from '../../../src/core/config/balance.js';
import { setupEvents, clearEvents } from '../../../src/core/events/index.js';
import { getAllEvents, getEventById, type EventCategory, type EventConsequence } from '../../../src/core/events/EventPool.js';

const RICH = 1_000_000;

function def(consequences: EventConsequence[], category: EventCategory = 'weather') {
  return { category, consequences };
}

/** Every effect (and nested fallback effect) type an event's options can carry. */
function effectTypesOf(c: EventConsequence | undefined): string[] {
  if (!c) return [];
  return [...(c.effects ?? []).map(e => e.type), ...effectTypesOf(c.altConsequence)];
}

beforeEach(() => {
  clearEvents();
  setupEvents();
});
afterEach(() => clearEvents());

describe('balance constants (#2146)', () => {
  it('declares the cash share and the notice countdown', () => {
    expect(EVENT_MAJOR_CASH_SHARE).toBe(0.15);
    expect(EVENT_NOTICE_COUNTDOWN_TICKS).toBe(150);
  });
});

describe('eventWeight - stakes effects', () => {
  const stakes: Array<[string, NonNullable<EventConsequence['effects']>]> = [
    ['employee_leaves', [{ type: 'employee_leaves', pick: 'random' }]],
    ['ban', [{ type: 'ban', what: 'blast', hours: 4 }]],
    ['work_stoppage', [{ type: 'work_stoppage', hours: 4 }]],
    ['cancel_contract', [{ type: 'cancel_contract', penalty: false }]],
  ];

  for (const [name, effects] of stakes) {
    it(`is major when an option carries ${name}, however rich the player is`, () => {
      const d = def([{ cashDelta: 0 }, { effects }]);
      expect(eventWeight(d, RICH)).toBe('major');
      expect(isMajorEvent(d, RICH)).toBe(true);
    });

    it(`is major when only the fallback of a risky option carries ${name}`, () => {
      const d = def([{ cashDelta: 0, probability: 0.5, altConsequence: { effects } }]);
      expect(eventWeight(d, RICH)).toBe('major');
    });

    it(`is major when ${name} sits two fallbacks deep`, () => {
      const d = def([{ probability: 0.5, altConsequence: { probability: 0.5, altConsequence: { effects } } }]);
      expect(eventWeight(d, RICH)).toBe('major');
    });
  }

  it('stays minor when the effects are harmless (a morale shift)', () => {
    const d = def([{ effects: [{ type: 'morale_shift', perHour: 1, hours: 24 }] }, { cashDelta: 100 }]);
    expect(eventWeight(d, RICH)).toBe('minor');
    expect(isMajorEvent(d, RICH)).toBe(false);
  });
});

describe('eventWeight - cash cost against current cash', () => {
  it('is minor when the worst loss is below the cash share', () => {
    const cash = 100_000;
    const d = def([{ cashDelta: -Math.floor(EVENT_MAJOR_CASH_SHARE * cash) + 1 }, { cashDelta: 0 }]);
    expect(eventWeight(d, cash)).toBe('minor');
  });

  it('is minor when a loss equals the cash share exactly (the rule is strictly greater)', () => {
    const cash = 4_000;
    const d = def([{ cashDelta: -(EVENT_MAJOR_CASH_SHARE * cash) }]);
    expect(eventWeight(d, cash)).toBe('minor');
  });

  it('is major when a loss is above the cash share', () => {
    const cash = 4_000;
    const d = def([{ cashDelta: -(EVENT_MAJOR_CASH_SHARE * cash) - 1 }]);
    expect(eventWeight(d, cash)).toBe('major');
  });

  it('is major when only one of several options is costly', () => {
    const d = def([{ cashDelta: 500 }, { cashDelta: -1 }, { cashDelta: -90_000 }]);
    expect(eventWeight(d, 100_000)).toBe('major');
  });

  it('is major when the costly part is the fallback of a risky option', () => {
    const d = def([{ cashDelta: 0, probability: 0.5, altConsequence: { cashDelta: -90_000 } }]);
    expect(eventWeight(d, 100_000)).toBe('major');
  });

  it('weighs the same event differently as cash changes', () => {
    const d = def([{ cashDelta: -2_000 }]);
    expect(eventWeight(d, 100_000)).toBe('minor');
    expect(eventWeight(d, 5_000)).toBe('major');
  });

  it('treats zero cash as no headroom: any loss is major, no loss is minor', () => {
    expect(eventWeight(def([{ cashDelta: -1 }]), 0)).toBe('major');
    expect(eventWeight(def([{ cashDelta: 0 }, { cashDelta: 50 }]), 0)).toBe('minor');
  });

  it('treats negative cash as zero, not as a negative threshold', () => {
    expect(eventWeight(def([{ cashDelta: -1 }]), -50_000)).toBe('major');
    expect(eventWeight(def([{ cashDelta: 10 }]), -50_000)).toBe('minor');
  });

  it('is minor when no option costs anything, whatever the cash', () => {
    const d = def([{ cashDelta: 3_000 }, {}, { scoreDelta: { wellBeing: 5 } }]);
    expect(eventWeight(d, 0)).toBe('minor');
    expect(eventWeight(d, RICH)).toBe('minor');
  });
});

describe('eventWeight - engine-detected categories', () => {
  for (const category of ['traffic', 'mining', 'tutorial'] as const) {
    it(`${category} events are always major, even with free harmless options`, () => {
      const d = def([{ cashDelta: 100 }, {}], category);
      expect(eventWeight(d, RICH)).toBe('major');
      expect(isMajorEvent(d, RICH)).toBe(true);
    });
  }

  it('a harmless weather event is not forced major by its category', () => {
    expect(eventWeight(def([{ cashDelta: 100 }, {}], 'weather'), RICH)).toBe('minor');
  });
});

describe('eventWeight - the real pool', () => {
  it('weather_double_rainbow is minor for a player with ordinary cash', () => {
    const d = getEventById('weather_double_rainbow')!;
    expect(d).toBeDefined();
    expect(eventWeight(d, 50_000)).toBe('minor');
  });

  it('weather_double_rainbow turns major when its cost is out of proportion to cash', () => {
    const d = getEventById('weather_double_rainbow')!;
    expect(eventWeight(d, 1_000)).toBe('major');
  });

  it('every event carrying a work stoppage (a strike) is major', () => {
    const strikes = getAllEvents().filter(e => e.consequences.some(c => effectTypesOf(c).includes('work_stoppage')));
    expect(strikes.length).toBeGreaterThan(0);
    for (const e of strikes) expect(eventWeight(e, RICH), e.id).toBe('major');
  });

  it('every event carrying employee_leaves, ban or cancel_contract is major', () => {
    const heavy = new Set(['employee_leaves', 'ban', 'cancel_contract']);
    const events = getAllEvents().filter(e => e.consequences.some(c => effectTypesOf(c).some(t => heavy.has(t))));
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) expect(eventWeight(e, RICH), e.id).toBe('major');
  });

  it('the pool holds both weights at ordinary cash', () => {
    const weights = new Set(getAllEvents().map(e => eventWeight(e, 50_000)));
    expect(weights.has('minor')).toBe(true);
    expect(weights.has('major')).toBe(true);
  });

  it('every traffic, mining and tutorial event is major', () => {
    const forced = getAllEvents().filter(e => e.category === 'traffic' || e.category === 'mining' || e.category === 'tutorial');
    for (const e of forced) expect(eventWeight(e, RICH), e.id).toBe('major');
  });
});

describe('defaultNoticeOption', () => {
  it('is the cheapest option, which is the one with the highest cash delta', () => {
    expect(defaultNoticeOption({ consequences: [{ cashDelta: -2000 }, { cashDelta: 0 }, { cashDelta: 3000 }] })).toBe(2);
  });

  it('skips an option that makes an employee leave even when it pays the most', () => {
    const consequences: EventConsequence[] = [
      { cashDelta: 9000, effects: [{ type: 'employee_leaves', pick: 'random' }] },
      { cashDelta: -500 },
      { cashDelta: -100 },
    ];
    expect(defaultNoticeOption({ consequences })).toBe(2);
  });

  it('is option 0 for an event with a single option', () => {
    expect(defaultNoticeOption({ consequences: [{ cashDelta: -10 }] })).toBe(0);
  });

  it('is option 0 for an event with no consequences', () => {
    expect(defaultNoticeOption({ consequences: [] })).toBe(0);
  });

  it('agrees with cheapestEventOption on the real double rainbow', () => {
    const d = getEventById('weather_double_rainbow')!;
    expect(defaultNoticeOption(d)).toBe(cheapestEventOption(d.consequences));
  });

  it('breaks a cash tie toward the lowest index', () => {
    expect(defaultNoticeOption({ consequences: [{ cashDelta: 5 }, { cashDelta: 5 }] })).toBe(0);
  });
});

describe('cheapestEventOption and outcomeCostsCrew live in EventWeight (#2146)', () => {
  it('outcomeCostsCrew sees employee_leaves directly and through a fallback', () => {
    expect(outcomeCostsCrew({ effects: [{ type: 'employee_leaves' }] })).toBe(true);
    expect(outcomeCostsCrew({ altConsequence: { effects: [{ type: 'employee_leaves' }] } })).toBe(true);
    expect(outcomeCostsCrew({ effects: [{ type: 'ban' }] })).toBe(false);
    expect(outcomeCostsCrew(undefined)).toBe(false);
  });

  it('cheapestEventOption picks every option when all of them cost crew', () => {
    const leave = [{ type: 'employee_leaves' }];
    expect(cheapestEventOption([{ cashDelta: -5, effects: leave }, { cashDelta: -1, effects: leave }])).toBe(1);
  });
});
