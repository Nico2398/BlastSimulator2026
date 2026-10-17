// BlastSimulator2026 — Tests for union event definitions (task 6.3)
// Verifies representative events trigger correctly, respect prerequisites, and resolve.

import { describe, it, expect, beforeEach } from 'vitest';
import { Random } from '../../../src/core/math/Random.js';
import { registerEvents, clearEvents, getEventsByCategory, getEventById, type EventContext } from '../../../src/core/events/EventPool.js';
import { UNION_EVENTS_1 } from '../../../src/core/events/UnionEvents1.js';
import { UNION_EVENTS_2 } from '../../../src/core/events/UnionEvents2.js';
import { createScoreState } from '../../../src/core/scores/ScoreManager.js';
import { createFinanceState } from '../../../src/core/economy/Finance.js';
import { createEventSystemState, selectEvent, tickEventSystem } from '../../../src/core/events/EventSystem.js';
import { MIN_EVENT_INTERVAL_ACTIONS } from '../../../src/core/config/balance.js';
import { resolveEvent } from '../../../src/core/events/EventResolver.js';

function makeCtx(overrides: Partial<EventContext> = {}): EventContext {
  return {
    scores: createScoreState(),
    employeeCount: 10,
    deathCount: 0,
    corruptionLevel: 0,
    hasBuilding: () => false,
    hasDrillPlan: false,
    tickCount: 100,
    lawsuitCount: 0,
    activeContractCount: 0,
    weatherId: 'sunny',
    hasBlasted: false,
    ...overrides,
  };
}

describe('Union events (6.3)', () => {
  beforeEach(() => {
    clearEvents();
    registerEvents(UNION_EVENTS_1);
    registerEvents(UNION_EVENTS_2);
  });

  it('at least 50 union events are registered', () => {
    const events = getEventsByCategory('union');
    expect(events.length).toBeGreaterThanOrEqual(50);
  });

  it('all union events have 2-4 options', () => {
    const events = getEventsByCategory('union');
    for (const e of events) {
      expect(e.options.length).toBeGreaterThanOrEqual(2);
      expect(e.options.length).toBeLessThanOrEqual(4);
      expect(e.consequences.length).toBe(e.options.length);
    }
  });

  it('coffee uprising event fires and resolves with wellBeing boost', () => {
    const ev = getEventById('union_coffee_uprising')!;
    expect(ev).toBeDefined();
    expect(ev.category).toBe('union');

    const ctx = makeCtx();
    expect(ev.canFire(ctx)).toBe(true);

    // Resolve option 0 (buy espresso machine)
    const eventSystem = createEventSystemState();
    eventSystem.pendingEvent = { eventId: ev.id, firedAtTick: 10 };
    const finances = createFinanceState(100000);
    const scores = createScoreState();
    const result = resolveEvent(eventSystem, finances, scores, 0, 10, new Random(42));

    expect(result).not.toBeNull();
    expect(result!.cashChange).toBe(-8000);
    expect(scores.wellBeing).toBe(62); // 50 + 12
  });

  it('strike threat only fires when wellBeing < 35', () => {
    const ev = getEventById('union_strike_threat')!;
    expect(ev).toBeDefined();

    const highWB = makeCtx({ scores: { ...createScoreState(), wellBeing: 60 } });
    expect(ev.canFire(highWB)).toBe(false);

    const lowWB = makeCtx({ scores: { ...createScoreState(), wellBeing: 20 } });
    expect(ev.canFire(lowWB)).toBe(true);
  });

  it('overtime revolt requires employees and resolution affects scores', () => {
    const ev = getEventById('union_overtime_revolt')!;
    expect(ev).toBeDefined();

    // Needs > 3 employees
    const fewEmps = makeCtx({ employeeCount: 2 });
    expect(ev.canFire(fewEmps)).toBe(false);

    const enoughEmps = makeCtx({ employeeCount: 5 });
    expect(ev.canFire(enoughEmps)).toBe(true);

    // Resolve option 0 (accept demands)
    const eventSystem = createEventSystemState();
    eventSystem.pendingEvent = { eventId: ev.id, firedAtTick: 10 };
    const finances = createFinanceState(100000);
    const scores = createScoreState();
    const result = resolveEvent(eventSystem, finances, scores, 0, 10, new Random(42));

    expect(result!.cashChange).toBe(-15000);
    expect(scores.wellBeing).toBe(65); // 50 + 15
    expect(scores.safety).toBe(55); // 50 + 5
  });

  it('low wellBeing increases union event weights', () => {
    const ev = getEventById('union_coffee_uprising')!;
    const lowScores = { ...createScoreState(), wellBeing: 10 };
    const highScores = { ...createScoreState(), wellBeing: 90 };

    expect(ev.weightCoeff(lowScores)).toBeGreaterThan(ev.weightCoeff(highScores));
  });
});

describe('union events scale with membership (#1873)', () => {
  beforeEach(() => {
    clearEvents();
    registerEvents(UNION_EVENTS_1);
    registerEvents(UNION_EVENTS_2);
  });

  const hasStoppage = (e: { consequences: Array<{ effects?: Array<{ type: string }>; altConsequence?: { effects?: Array<{ type: string }> } }> }) =>
    e.consequences.some(c =>
      (c.effects ?? []).some(x => x.type === 'work_stoppage')
      || (c.altConsequence?.effects ?? []).some(x => x.type === 'work_stoppage'));

  const lowWellBeing = () => ({ ...createScoreState(), wellBeing: 10 });

  it('a strike-capable union event exists (sanity)', () => {
    expect(getEventsByCategory('union').some(hasStoppage)).toBe(true);
  });

  it('with zero members no selected union event can cause a work stoppage', () => {
    for (let seed = 1; seed <= 400; seed++) {
      const ev = selectEvent('union', makeCtx({ unionMemberCount: 0, employeeCount: 5, scores: lowWellBeing() }), new Random(seed));
      expect(ev).not.toBeNull();
      expect(hasStoppage(ev!), `${ev!.id} seed ${seed}`).toBe(false);
    }
  });

  it('with a member a strike event can be selected', () => {
    let seen = false;
    for (let seed = 1; seed <= 600 && !seen; seed++) {
      const ev = selectEvent('union', makeCtx({ unionMemberCount: 1, employeeCount: 5, scores: lowWellBeing() }), new Random(seed));
      if (ev && hasStoppage(ev)) seen = true;
    }
    expect(seen).toBe(true);
  });

  it('an undefined member count behaves as legacy: strikes can still occur', () => {
    let seen = false;
    for (let seed = 1; seed <= 600 && !seen; seed++) {
      const ev = selectEvent('union', makeCtx({ employeeCount: 5, scores: lowWellBeing() }), new Random(seed));
      if (ev && hasStoppage(ev)) seen = true;
    }
    expect(seen).toBe(true);
  });

  it('still returns null with no employees at all (#1412)', () => {
    expect(selectEvent('union', makeCtx({ employeeCount: 0, unionMemberCount: 0 }), new Random(1))).toBeNull();
  });

  function countUnionFires(unionMemberCount: number | undefined): number {
    const state = createEventSystemState();
    const rng = new Random(99);
    let fired = 0;
    const ticks = 6000;
    for (let tick = 1; tick <= ticks; tick++) {
      state.actionCountSinceEvent = Math.max(state.actionCountSinceEvent, MIN_EVENT_INTERVAL_ACTIONS);
      const ctx = makeCtx({ tickCount: tick, employeeCount: 10, unionMemberCount, scores: lowWellBeing() });
      const f = tickEventSystem(state, ctx, rng);
      if (f && getEventById(f.eventId)?.category === 'union') fired++;
      state.pendingEvent = null; // resolve instantly
    }
    return fired;
  }

  it('an all-member crew gets at least twice the union events of a zero-member crew', () => {
    const none = countUnionFires(0);
    const all = countUnionFires(10);
    expect(all).toBeGreaterThanOrEqual(2 * Math.max(none, 1));
  });
});
