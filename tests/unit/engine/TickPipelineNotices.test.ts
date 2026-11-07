// BlastSimulator2026 — runTick and minor-event notices (#2146): a minor event never holds the clock,
// a major one still does, and an ignored notice resolves itself when its countdown ends.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runTick } from '../../../src/core/engine/TickPipeline.js';
import { buildTickEventContext } from '../../../src/core/engine/TickEventContext.js';
import { createGame, type GameState } from '../../../src/core/state/GameState.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { Random } from '../../../src/core/math/Random.js';
import { registerEvents, clearEvents, type EventDef } from '../../../src/core/events/EventPool.js';
import { EVENT_NOTICE_COUNTDOWN_TICKS, MIN_EVENT_INTERVAL_ACTIONS } from '../../../src/core/config/balance.js';

const START_TICK = 5000;

const MINOR: EventDef = {
  id: 'tp_minor',
  category: 'weather',
  titleKey: 'event.tp_minor.title',
  descKey: 'event.tp_minor.desc',
  options: [
    { labelKey: 'event.tp_minor.opt0', resultKey: 'event.tp_minor.res0' },
    { labelKey: 'event.tp_minor.opt1', resultKey: 'event.tp_minor.res1' },
  ],
  consequences: [{ cashDelta: -300 }, { cashDelta: 200 }],
  weightCoeff: () => 1,
  canFire: () => true,
};

beforeEach(() => {
  clearEvents();
  registerEvents([MINOR]);
});
afterEach(() => clearEvents());

/** A game whose weather timer fires on the very next tick, with the cooldown open. */
function armedGame(cash: number): GameState {
  const state = createGame({ seed: 42 });
  state.cash = cash;
  state.tickCount = START_TICK;
  state.isPaused = false;
  for (const t of state.events.timers) t.remaining = 1_000_000_000;
  state.events.timers.find(t => t.category === 'weather')!.remaining = 1;
  state.events.actionCountSinceEvent = MIN_EVENT_INTERVAL_ACTIONS;
  state.events.lastEventTick = 0;
  return state;
}

function tick(state: GameState) {
  return runTick(state, null, new Random(state.seed + state.tickCount), new EventEmitter(), { checkInvariants: false });
}

describe('buildTickEventContext cash (#2146)', () => {
  it('carries the current cash into the event context', () => {
    const state = createGame({ seed: 42 });
    state.cash = 12_345;
    expect(buildTickEventContext(state).cash).toBe(12_345);
  });
});

describe('runTick - a minor event does not hold the clock', () => {
  it('reports the fired event, adds a notice, and does not pause', () => {
    const state = armedGame(1_000_000);
    const report = tick(state);
    expect(report.firedEvent?.eventId).toBe('tp_minor');
    expect(state.events.pendingEvent).toBeNull();
    expect(state.events.minorNotices).toHaveLength(1);
    expect(state.events.minorNotices[0]!.eventId).toBe('tp_minor');
    expect(state.isPaused).toBe(false);
    expect(report.paused).toBe(false);
  });

  it('stamps the notice with the firing tick and its expiry', () => {
    const state = armedGame(1_000_000);
    tick(state);
    const notice = state.events.minorNotices[0]!;
    expect(notice.firedAtTick).toBe(START_TICK + 1);
    expect(notice.expiresAtTick).toBe(START_TICK + 1 + EVENT_NOTICE_COUNTDOWN_TICKS);
  });

  it('the same event is major, pending and pausing, when the cash cannot absorb its cost', () => {
    const state = armedGame(50);
    const report = tick(state);
    expect(report.firedEvent?.eventId).toBe('tp_minor');
    expect(state.events.pendingEvent?.eventId).toBe('tp_minor');
    expect(state.events.minorNotices).toEqual([]);
    expect(state.isPaused).toBe(true);
    expect(report.paused).toBe(true);
  });

  it('ticks on while a notice waits', () => {
    const state = armedGame(1_000_000);
    tick(state);
    const after = state.tickCount;
    for (let i = 0; i < 10; i++) tick(state);
    expect(state.tickCount).toBe(after + 10);
    expect(state.isPaused).toBe(false);
    expect(state.events.minorNotices).toHaveLength(1);
  });
});

describe('runTick - an ignored notice resolves itself', () => {
  it('resolves to the default option once the countdown ends and does not pause', () => {
    const state = armedGame(1_000_000);
    tick(state);
    const fired = state.events.minorNotices[0]!.firedAtTick;
    // the countdown ends at fired + COUNTDOWN
    while (state.tickCount < fired + EVENT_NOTICE_COUNTDOWN_TICKS - 1) tick(state);
    expect(state.events.minorNotices).toHaveLength(1);
    const cashBefore = state.cash;
    tick(state);
    expect(state.tickCount).toBe(fired + EVENT_NOTICE_COUNTDOWN_TICKS);
    expect(state.events.minorNotices).toEqual([]);
    // default = option 1 (+200)
    expect(state.cash).toBe(cashBefore + 200);
    expect(state.events.lastNoticeOutcome).toMatchObject({ eventId: 'tp_minor', resultKey: 'event.tp_minor.res1', auto: true, seq: 1 });
    expect(state.isPaused).toBe(false);
  });

  it('leaves lastOutcome (the major modal outcome) alone', () => {
    const state = armedGame(1_000_000);
    state.events.minorNotices.push({
      eventId: 'tp_minor', firedAtTick: START_TICK - 10, expiresAtTick: START_TICK + 1, minor: true,
    });
    const outcome = { eventId: 'prev', resultKey: 'prev.res', effects: [] };
    state.events.lastOutcome = outcome;
    state.events.timers.find(t => t.category === 'weather')!.remaining = 1_000_000_000;
    tick(state);
    expect(state.events.minorNotices).toEqual([]);
    expect(state.events.lastOutcome).toBe(outcome);
    expect(state.events.lastNoticeOutcome?.auto).toBe(true);
  });

  it('keeps a notice that still has time left', () => {
    const state = armedGame(1_000_000);
    state.events.minorNotices.push({
      eventId: 'tp_minor', firedAtTick: START_TICK, expiresAtTick: START_TICK + 2, minor: true,
    });
    state.events.timers.find(t => t.category === 'weather')!.remaining = 1_000_000_000;
    tick(state);
    expect(state.events.minorNotices).toHaveLength(1);
    expect(state.events.lastNoticeOutcome).toBeNull();
    tick(state);
    expect(state.events.minorNotices).toEqual([]);
  });
});
