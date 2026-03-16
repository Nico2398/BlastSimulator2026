import { describe, it, expect, beforeEach } from 'vitest';
import { Random } from '../../../src/core/math/Random.js';
import {
  createEventSystemState,
  tickEventSystem,
  clearPendingEvent,
  queueFollowUp,
  selectEvent,
  BASE_TIMER,
} from '../../../src/core/events/EventSystem.js';
import {
  registerEvents,
  clearEvents,
  type EventDef,
  type EventContext,
} from '../../../src/core/events/EventPool.js';
import { createScoreState } from '../../../src/core/scores/ScoreManager.js';

function makeCtx(overrides: Partial<EventContext> = {}): EventContext {
  return {
    scores: createScoreState(),
    employeeCount: 5,
    deathCount: 0,
    corruptionLevel: 0,
    hasBuilding: () => false,
    hasDrillPlan: false,
    tickCount: 100,
    lawsuitCount: 0,
    activeContractCount: 0,
    weatherId: 'sunny',
    ...overrides,
  };
}

function makeEvent(id: string, category: 'union' | 'politics', weight: number = 1): EventDef {
  return {
    id, category,
    titleKey: `event.${id}.title`,
    descKey: `event.${id}.desc`,
    options: [{ labelKey: `event.${id}.opt1` }, { labelKey: `event.${id}.opt2` }],
    consequences: [{ cashDelta: -100 }, { cashDelta: 0 }],
    weightCoeff: () => weight,
    canFire: () => true,
  };
}

describe('Event system engine', () => {
  beforeEach(() => {
    clearEvents();
  });

  it('event timer counts down each tick', () => {
    registerEvents([makeEvent('test1', 'union')]);
    const state = createEventSystemState();
    const unionTimer = state.timers.find(t => t.category === 'union')!;
    const initial = unionTimer.remaining;

    tickEventSystem(state, makeCtx(), new Random(42));
    expect(unionTimer.remaining).toBe(initial - 1);
  });

  it('when timer reaches zero, an event is selected and fired', () => {
    registerEvents([makeEvent('test1', 'union')]);
    const state = createEventSystemState();
    const unionTimer = state.timers.find(t => t.category === 'union')!;
    unionTimer.remaining = 1; // Will fire next tick

    const ctx = makeCtx();
    const fired = tickEventSystem(state, ctx, new Random(42));
    expect(fired).not.toBeNull();
    expect(fired!.eventId).toBe('test1');
    expect(state.pendingEvent).not.toBeNull();
  });

  it('event selection respects probability weights', () => {
    registerEvents([
      makeEvent('rare', 'union', 0.1),
      makeEvent('common', 'union', 10),
    ]);

    const ctx = makeCtx();
    const counts: Record<string, number> = { rare: 0, common: 0 };

    for (let seed = 0; seed < 100; seed++) {
      const rng = new Random(seed);
      const selected = selectEvent('union', ctx, rng);
      if (selected) counts[selected.id]!++;
    }

    expect(counts['common']).toBeGreaterThan(counts['rare']!);
    expect(counts['common']).toBeGreaterThan(80); // Should be ~99%
  });

  it('player scores modify probability weights correctly', () => {
    const scoreDepEvent: EventDef = {
      ...makeEvent('scored', 'union'),
      // Weight increases as wellBeing decreases
      weightCoeff: (scores) => 1 + 2 * (1 - scores.wellBeing / 100),
    };
    registerEvents([scoreDepEvent]);

    const lowWB = makeCtx({ scores: { ...createScoreState(), wellBeing: 10 } });
    const highWB = makeCtx({ scores: { ...createScoreState(), wellBeing: 90 } });

    const lowWeight = scoreDepEvent.weightCoeff(lowWB.scores);
    const highWeight = scoreDepEvent.weightCoeff(highWB.scores);

    expect(lowWeight).toBeGreaterThan(highWeight);
    expect(lowWeight).toBeCloseTo(2.8, 1);
    expect(highWeight).toBeCloseTo(1.2, 1);
  });

  it('unavailable events (prerequisites not met) are excluded', () => {
    const blockedEvent: EventDef = {
      ...makeEvent('blocked', 'union'),
      canFire: () => false,
    };
    const openEvent = makeEvent('open', 'union');
    registerEvents([blockedEvent, openEvent]);

    const ctx = makeCtx();
    const rng = new Random(42);
    const selected = selectEvent('union', ctx, rng);
    expect(selected?.id).toBe('open');
  });

  it('timer reset interval depends on player scores', () => {
    registerEvents([makeEvent('test1', 'union')]);
    const state = createEventSystemState();
    const unionTimer = state.timers.find(t => t.category === 'union')!;
    unionTimer.remaining = 1;

    // Low well-being → shorter interval
    const lowCtx = makeCtx({ scores: { ...createScoreState(), wellBeing: 10 } });
    tickEventSystem(state, lowCtx, new Random(42));
    clearPendingEvent(state);
    const shortInterval = unionTimer.remaining;

    // Reset and try with high well-being
    unionTimer.remaining = 1;
    const highCtx = makeCtx({ scores: { ...createScoreState(), wellBeing: 90 } });
    tickEventSystem(state, highCtx, new Random(42));
    clearPendingEvent(state);
    const longInterval = unionTimer.remaining;

    expect(shortInterval).toBeLessThan(longInterval);
  });
});
