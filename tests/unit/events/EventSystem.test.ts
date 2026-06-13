import { describe, it, expect, beforeEach } from 'vitest';
import { Random } from '../../../src/core/math/Random.js';
import {
  createEventSystemState,
  tickEventSystem,
  clearPendingEvent,
  queueFollowUp,
  selectEvent,
  incrementActionCount,
} from '../../../src/core/events/EventSystem.js';
import { MIN_EVENT_INTERVAL_ACTIONS } from '../../../src/core/config/balance.js';
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

/** Create a fresh event-system state and find the union timer. */
function setupEventState() {
  const state = createEventSystemState();
  const timer = state.timers.find(t => t.category === 'union')!;
  return { state, timer };
}

describe('Event system engine', () => {
  beforeEach(() => {
    clearEvents();
  });

  it('event timer counts down each tick', () => {
    registerEvents([makeEvent('test1', 'union')]);
    const { state, timer } = setupEventState();
    const initial = timer.remaining;

    tickEventSystem(state, makeCtx(), new Random(42));
    expect(timer.remaining).toBe(initial - 1);
  });

  it('when timer reaches zero, an event is selected and fired', () => {
    registerEvents([makeEvent('test1', 'union')]);
    const { state, timer } = setupEventState();
    state.actionCountSinceEvent = MIN_EVENT_INTERVAL_ACTIONS;
    timer.remaining = 1;

    const ctx = makeCtx({ tickCount: 200 });
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

  it('same event cannot fire twice in a level', () => {
    registerEvents([makeEvent('once_only', 'union')]);
    const state = createEventSystemState();
    const unionTimer = state.timers.find(t => t.category === 'union')!;

    // Fire the event once
    state.actionCountSinceEvent = MIN_EVENT_INTERVAL_ACTIONS;
    unionTimer.remaining = 1;
    const first = tickEventSystem(state, makeCtx({ tickCount: 200 }), new Random(42));
    expect(first?.eventId).toBe('once_only');
    clearPendingEvent(state);

    // Attempt to fire again
    state.actionCountSinceEvent = MIN_EVENT_INTERVAL_ACTIONS;
    unionTimer.remaining = 1;
    const second = tickEventSystem(state, makeCtx({ tickCount: 400 }), new Random(42));
    expect(second).toBeNull();
    expect(state.firedEventIds).toContain('once_only');
  });

  it('firedEventIds survives JSON round-trip (save/load)', () => {
    const state = createEventSystemState();
    state.firedEventIds.push('persist_test');

    const serialized = JSON.stringify(state);
    const restored = JSON.parse(serialized) as typeof state;
    expect(restored.firedEventIds).toEqual(['persist_test']);
  });

  it('follow-up events are also deduplicated', () => {
    registerEvents([makeEvent('followup_ev', 'union')]);
    const state = createEventSystemState();

    // Queue the follow-up twice
    queueFollowUp(state, 'followup_ev');
    queueFollowUp(state, 'followup_ev');

    const first = tickEventSystem(state, makeCtx(), new Random(42));
    expect(first?.eventId).toBe('followup_ev');
    clearPendingEvent(state);

    // Second attempt should be skipped (already fired)
    const second = tickEventSystem(state, makeCtx(), new Random(42));
    expect(second).toBeNull();
  });

  it('firedEventIds resets to empty on createEventSystemState', () => {
    const state = createEventSystemState();
    expect(state.firedEventIds).toEqual([]);
  });

  it('selectEvent excludes already-fired events', () => {
    registerEvents([
      makeEvent('fired_ev', 'union'),
      makeEvent('fresh_ev', 'union'),
    ]);
    const ctx = makeCtx();
    const rng = new Random(42);

    const result = selectEvent('union', ctx, rng, ['fired_ev']);
    expect(result?.id).toBe('fresh_ev');
  });

  it('timer reset interval depends on player scores', () => {
    registerEvents([makeEvent('test1', 'union')]);
    const state = createEventSystemState();
    const unionTimer = state.timers.find(t => t.category === 'union')!;

    // Low well-being → shorter interval
    state.actionCountSinceEvent = MIN_EVENT_INTERVAL_ACTIONS;
    unionTimer.remaining = 1;
    const lowCtx = makeCtx({ scores: { ...createScoreState(), wellBeing: 10 }, tickCount: 200 });
    tickEventSystem(state, lowCtx, new Random(42));
    clearPendingEvent(state);
    const shortInterval = unionTimer.remaining;

    // Reset and try with high well-being
    state.actionCountSinceEvent = MIN_EVENT_INTERVAL_ACTIONS;
    unionTimer.remaining = 1;
    const highCtx = makeCtx({ scores: { ...createScoreState(), wellBeing: 90 }, tickCount: 400 });
    tickEventSystem(state, highCtx, new Random(42));
    clearPendingEvent(state);
    const longInterval = unionTimer.remaining;

    expect(shortInterval).toBeLessThan(longInterval);
  });

  it('lastEventTick is 0 in fresh state', () => {
    const state = createEventSystemState();
    expect(state.lastEventTick).toBe(0);
  });

  it('actionCountSinceEvent is 0 in fresh state', () => {
    const state = createEventSystemState();
    expect(state.actionCountSinceEvent).toBe(0);
  });

  it('incrementActionCount increments by 1', () => {
    const state = createEventSystemState();
    expect(state.actionCountSinceEvent).toBe(0);
    incrementActionCount(state);
    expect(state.actionCountSinceEvent).toBe(1);
  });

  it('incrementActionCount increments from non-zero', () => {
    const state = createEventSystemState();
    state.actionCountSinceEvent = 5;
    incrementActionCount(state);
    expect(state.actionCountSinceEvent).toBe(6);
  });

  it('lastEventTick and actionCountSinceEvent survive JSON round-trip', () => {
    const state = createEventSystemState();
    state.lastEventTick = 42;
    state.actionCountSinceEvent = 7;

    const serialized = JSON.stringify(state);
    const restored = JSON.parse(serialized) as typeof state;

    expect(restored.lastEventTick).toBe(42);
    expect(restored.actionCountSinceEvent).toBe(7);
  });

  // ── Cooldown gating tests ──

  it('cooldown blocks event when tick interval not met', () => {
    registerEvents([makeEvent('test1', 'union')]);
    const { state, timer } = setupEventState();
    state.lastEventTick = 190;
    state.actionCountSinceEvent = MIN_EVENT_INTERVAL_ACTIONS;
    timer.remaining = 1;

    const ctx = makeCtx({ tickCount: 200 });
    const fired = tickEventSystem(state, ctx, new Random(42));
    expect(fired).toBeNull();
    expect(timer.remaining).toBe(5);
  });

  it('cooldown blocks event when action count not met', () => {
    registerEvents([makeEvent('test1', 'union')]);
    const { state, timer } = setupEventState();
    state.actionCountSinceEvent = 0;
    timer.remaining = 1;

    const ctx = makeCtx({ tickCount: 200 });
    const fired = tickEventSystem(state, ctx, new Random(42));
    expect(fired).toBeNull();
    expect(timer.remaining).toBe(5);
  });

  it('cooldown allows event when both conditions met', () => {
    registerEvents([makeEvent('test1', 'union')]);
    const { state, timer } = setupEventState();
    state.actionCountSinceEvent = MIN_EVENT_INTERVAL_ACTIONS;
    timer.remaining = 1;

    const ctx = makeCtx({ tickCount: 200 });
    const fired = tickEventSystem(state, ctx, new Random(42));
    expect(fired).not.toBeNull();
    expect(fired!.eventId).toBe('test1');
  });

  it('random factor adds 0-60 extra ticks to event cooldown interval', () => {
    registerEvents([makeEvent('test1', 'union')]);

    // Seed 7 → rng.nextInt(0,60) = 0 → minInterval = 120 + 0 = 120
    // tickCount=150, lastEventTick=0 → ticksSinceLastEvent=150 ≥ 120 → passes
    const { state: state1, timer: timer1 } = setupEventState();
    state1.actionCountSinceEvent = MIN_EVENT_INTERVAL_ACTIONS;
    timer1.remaining = 1;
    const ctx1 = makeCtx({ tickCount: 150 });
    const fired1 = tickEventSystem(state1, ctx1, new Random(7));
    expect(fired1).not.toBeNull();
    expect(fired1!.eventId).toBe('test1');

    // Seed 43 → rng.nextInt(0,60) = 60 → minInterval = 120 + 60 = 180
    // tickCount=150, lastEventTick=0 → ticksSinceLastEvent=150 < 180 → blocked
    const { state: state2, timer: timer2 } = setupEventState();
    state2.actionCountSinceEvent = MIN_EVENT_INTERVAL_ACTIONS;
    timer2.remaining = 1;
    const ctx2 = makeCtx({ tickCount: 150 });
    const fired2 = tickEventSystem(state2, ctx2, new Random(43));
    expect(fired2).toBeNull();
  });

  it('timer resets to 5 on cooldown failure, not to modulated interval', () => {
    registerEvents([makeEvent('test1', 'union')]);
    const { state, timer } = setupEventState();
    state.lastEventTick = 190;
    state.actionCountSinceEvent = MIN_EVENT_INTERVAL_ACTIONS;
    timer.remaining = 1;

    const ctx = makeCtx({ tickCount: 200 });
    tickEventSystem(state, ctx, new Random(42));
    // Modulated interval for union at default scores (wellBeing: 50) would be ~25.
    // On cooldown failure it must be exactly 5.
    expect(timer.remaining).toBe(5);
  });

  it('actionCountSinceEvent resets to 0 after event fires', () => {
    registerEvents([makeEvent('test1', 'union')]);
    const { state, timer } = setupEventState();
    state.actionCountSinceEvent = MIN_EVENT_INTERVAL_ACTIONS;
    timer.remaining = 1;

    const ctx = makeCtx({ tickCount: 200 });
    tickEventSystem(state, ctx, new Random(42));
    expect(state.actionCountSinceEvent).toBe(0);
  });

  it('lastEventTick updates after event fires through timer', () => {
    registerEvents([makeEvent('test1', 'union')]);
    const { state, timer } = setupEventState();
    state.actionCountSinceEvent = MIN_EVENT_INTERVAL_ACTIONS;
    timer.remaining = 1;

    const ctx = makeCtx({ tickCount: 200 });
    tickEventSystem(state, ctx, new Random(42));
    expect(state.lastEventTick).toBe(200);
  });

  it('actionCountSinceEvent resets to 0 after follow-up event fires', () => {
    registerEvents([makeEvent('followup_ev', 'union')]);
    const state = createEventSystemState();
    state.actionCountSinceEvent = 5;
    queueFollowUp(state, 'followup_ev');

    const ctx = makeCtx({ tickCount: 200 });
    const fired = tickEventSystem(state, ctx, new Random(42));
    expect(fired).not.toBeNull();
    expect(fired!.eventId).toBe('followup_ev');
    expect(state.actionCountSinceEvent).toBe(0);
  });

  it('follow-up queue events bypass cooldown check', () => {
    registerEvents([makeEvent('followup_ev', 'union')]);
    const state = createEventSystemState();
    state.lastEventTick = 190;
    state.actionCountSinceEvent = 0;
    queueFollowUp(state, 'followup_ev');

    const ctx = makeCtx({ tickCount: 200 });
    const fired = tickEventSystem(state, ctx, new Random(42));
    expect(fired).not.toBeNull();
    expect(fired!.eventId).toBe('followup_ev');
  });

  // ── eventFreqMultiplier = 0 suppression ──

  it('tickEventSystem returns null when eventFreqMultiplier is 0', () => {
    const state = createEventSystemState(0);
    // Register an event that would normally fire
    registerEvents([makeEvent('suppressed_test', 'union')]);
    const unionTimer = state.timers.find(t => t.category === 'union')!;
    state.actionCountSinceEvent = MIN_EVENT_INTERVAL_ACTIONS;
    unionTimer.remaining = 1;

    const ctx = makeCtx({ tickCount: 200 });
    const fired = tickEventSystem(state, ctx, new Random(42));
    expect(fired).toBeNull();
    expect(state.pendingEvent).toBeNull();
  });

  it('tickEventSystem with eventFreqMultiplier=1 still fires events normally', () => {
    registerEvents([makeEvent('normal_test', 'union')]);
    const state = createEventSystemState(1); // default but explicit
    const unionTimer = state.timers.find(t => t.category === 'union')!;
    state.actionCountSinceEvent = MIN_EVENT_INTERVAL_ACTIONS;
    unionTimer.remaining = 1;

    const ctx = makeCtx({ tickCount: 200 });
    const fired = tickEventSystem(state, ctx, new Random(42));
    expect(fired).not.toBeNull();
    expect(fired!.eventId).toBe('normal_test');
  });
});
