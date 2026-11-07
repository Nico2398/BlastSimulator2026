// Minor-event notices (#2146): a minor event fired by the timers or the follow-up queue becomes a
// non-blocking notice; an ignored one resolves itself to its default option when the countdown ends.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Random } from '../../../src/core/math/Random.js';
import {
  createEventSystemState,
  tickEventSystem,
  queueFollowUp,
  noticeTicksLeft,
  type EventSystemState,
  type MinorNotice,
} from '../../../src/core/events/EventSystem.js';
import {
  resolveNotice,
  expireNotices,
  applyResolutionToState,
} from '../../../src/core/events/EventNotices.js';
import type { ResolutionResult } from '../../../src/core/events/EventResolver.js';
import {
  registerEvents,
  clearEvents,
  type EventDef,
  type EventContext,
  type EventCategory,
  type EventConsequence,
} from '../../../src/core/events/EventPool.js';
import {
  EVENT_NOTICE_COUNTDOWN_TICKS,
  FOLLOWUP_DELAY_TICKS,
  MIN_EVENT_INTERVAL_ACTIONS,
} from '../../../src/core/config/balance.js';
import { createScoreState } from '../../../src/core/scores/ScoreManager.js';
import { createGame, type GameState } from '../../../src/core/state/GameState.js';
import { serialize, deserialize } from '../../../src/core/state/SaveLoad.js';

const COUNTDOWN = EVENT_NOTICE_COUNTDOWN_TICKS;
const RICH = 1_000_000;

function makeEvent(
  id: string,
  consequences: EventConsequence[],
  opts: { category?: EventCategory; followUpOnly?: boolean } = {},
): EventDef {
  return {
    id,
    category: opts.category ?? 'weather',
    titleKey: `event.${id}.title`,
    descKey: `event.${id}.desc`,
    options: consequences.map((_, i) => ({ labelKey: `event.${id}.opt${i}`, resultKey: `event.${id}.res${i}` })),
    consequences,
    weightCoeff: () => 1,
    canFire: () => true,
    ...(opts.followUpOnly ? { followUpOnly: true } : {}),
  };
}

/** Cheap to answer at ordinary cash; default option (highest cash among crew-keeping ones) is index 2. */
const MINOR_A = makeEvent('n_minor_a', [
  { cashDelta: -300, scoreDelta: { wellBeing: 5 } },
  { cashDelta: 0 },
  {
    cashDelta: 500,
    scoreDelta: { safety: -2 },
    corruptionDelta: 4,
    effects: [{ type: 'morale_shift', perHour: 1, hours: 24 }],
  },
]);
const MINOR_B = makeEvent('n_minor_b', [{ cashDelta: -50 }, { cashDelta: 70, scoreDelta: { ecology: 3 } }]);
/** The only free-for-crew answer is option 1. */
const MINOR_LEAVER = makeEvent('n_minor_leaver', [
  { cashDelta: 1000, effects: [{ type: 'employee_leaves', pick: 'random' }] },
  { cashDelta: -100 },
]);
const MINOR_RISKY = makeEvent('n_minor_risky', [
  { cashDelta: -10, probability: 0, altConsequence: { cashDelta: 40 } },
]);
const MINOR_FOLLOW = makeEvent('n_minor_follow', [{ cashDelta: 0, followUpEventId: 'n_follow_up' }, { cashDelta: -5 }]);
const FOLLOW_UP_MINOR = makeEvent('n_follow_up', [{ cashDelta: -10 }, { cashDelta: 0 }], { followUpOnly: true });
const MAJOR = makeEvent('n_major', [
  { cashDelta: -20 },
  { cashDelta: 0, effects: [{ type: 'work_stoppage', hours: 4 }] },
]);

beforeEach(() => {
  clearEvents();
  registerEvents([MINOR_A, MINOR_B, MINOR_LEAVER, MINOR_RISKY, MINOR_FOLLOW, FOLLOW_UP_MINOR, MAJOR]);
});
afterEach(() => clearEvents());

function makeCtx(overrides: Partial<EventContext> = {}): EventContext {
  return {
    scores: createScoreState(),
    employeeCount: 5,
    deathCount: 0,
    corruptionLevel: 0,
    hasBuilding: () => false,
    hasDrillPlan: false,
    tickCount: 1000,
    lawsuitCount: 0,
    activeContractCount: 0,
    weatherId: 'sunny',
    hasBlasted: false,
    ...overrides,
  };
}

/** A fresh event state whose weather timer fires on the next tick and whose cooldown is open. */
function readyState(): EventSystemState {
  const s = createEventSystemState();
  s.actionCountSinceEvent = MIN_EVENT_INTERVAL_ACTIONS;
  s.timers.find(t => t.category === 'weather')!.remaining = 1;
  return s;
}

/** A state whose category timers never fire, isolating the follow-up queue. */
function isolatedState(): EventSystemState {
  const s = createEventSystemState();
  for (const t of s.timers) t.remaining = 1_000_000_000;
  return s;
}

function noticeOf(eventId: string, firedAtTick: number): MinorNotice {
  return { eventId, firedAtTick, expiresAtTick: firedAtTick + COUNTDOWN, minor: true };
}

function gameWith(...notices: MinorNotice[]): GameState {
  const g = createGame({ seed: 42 });
  g.cash = 10_000;
  g.events.minorNotices.push(...notices);
  return g;
}

const world = (g: GameState) => ({ state: g, grid: null });

describe('state defaults (#2146)', () => {
  it('a fresh event state has no notices and no notice outcome', () => {
    const s = createEventSystemState();
    expect(s.minorNotices).toEqual([]);
    expect(s.lastNoticeOutcome).toBeNull();
  });
});

describe('noticeTicksLeft', () => {
  const n = noticeOf('n_minor_a', 1000);

  it('is the whole countdown at the tick it fired', () => {
    expect(noticeTicksLeft(n, 1000)).toBe(COUNTDOWN);
  });

  it('counts down one per tick', () => {
    expect(noticeTicksLeft(n, 1040)).toBe(COUNTDOWN - 40);
    expect(noticeTicksLeft(n, 1000 + COUNTDOWN - 1)).toBe(1);
  });

  it('is zero at the expiry tick', () => {
    expect(noticeTicksLeft(n, 1000 + COUNTDOWN)).toBe(0);
  });

  it('never goes negative after the expiry tick', () => {
    expect(noticeTicksLeft(n, 1000 + COUNTDOWN + 500)).toBe(0);
  });
});

describe('tickEventSystem - a timer event is classified by weight', () => {
  beforeEach(() => {
    clearEvents();
    registerEvents([MINOR_A]);
  });

  it('a minor event leaves pendingEvent null and appends a notice', () => {
    const s = readyState();
    const fired = tickEventSystem(s, makeCtx({ cash: RICH }), new Random(42));
    expect(fired).not.toBeNull();
    expect(s.pendingEvent).toBeNull();
    expect(s.minorNotices).toHaveLength(1);
    expect(s.minorNotices[0]).toMatchObject({
      eventId: 'n_minor_a', firedAtTick: 1000, expiresAtTick: 1000 + COUNTDOWN, minor: true,
    });
  });

  it('still returns the FiredEvent, flagged minor', () => {
    const fired = tickEventSystem(readyState(), makeCtx({ cash: RICH }), new Random(42));
    expect(fired?.eventId).toBe('n_minor_a');
    expect(fired?.minor).toBe(true);
  });

  it('the same event is major (pending, no notice) when the context carries no cash', () => {
    const s = readyState();
    const fired = tickEventSystem(s, makeCtx(), new Random(42));
    expect(s.pendingEvent?.eventId).toBe('n_minor_a');
    expect(s.minorNotices).toEqual([]);
    expect(fired?.minor).toBeFalsy();
  });

  it('the same event is major when its cost outweighs the cash in the context', () => {
    const s = readyState();
    tickEventSystem(s, makeCtx({ cash: 100 }), new Random(42));
    expect(s.pendingEvent?.eventId).toBe('n_minor_a');
    expect(s.minorNotices).toEqual([]);
  });

  it('firing bookkeeping is identical for a minor and a major event', () => {
    const minor = readyState();
    const major = readyState();
    tickEventSystem(minor, makeCtx({ cash: RICH }), new Random(42));
    tickEventSystem(major, makeCtx(), new Random(42));
    const bookkeeping = (s: EventSystemState) => ({
      timers: s.timers,
      fired: s.firedEventIds,
      lastEventTick: s.lastEventTick,
      actions: s.actionCountSinceEvent,
      cooldown: s.cooldownMinIntervalTicks,
      unionLast: s.lastUnionEventTick,
    });
    expect(bookkeeping(minor)).toEqual(bookkeeping(major));
    expect(minor.firedEventIds).toContain('n_minor_a');
    expect(minor.lastEventTick).toBe(1000);
    expect(minor.actionCountSinceEvent).toBe(0);
  });

  it('a minor event does not fire twice (it counts as fired)', () => {
    const s = readyState();
    tickEventSystem(s, makeCtx({ cash: RICH }), new Random(42));
    s.timers.find(t => t.category === 'weather')!.remaining = 1;
    s.actionCountSinceEvent = MIN_EVENT_INTERVAL_ACTIONS;
    expect(tickEventSystem(s, makeCtx({ cash: RICH, tickCount: 9000 }), new Random(42))).toBeNull();
    expect(s.minorNotices).toHaveLength(1);
  });

  it('no event fires, so no notice appears, when event frequency is zero', () => {
    const s = readyState();
    s.eventFreqMultiplier = 0;
    expect(tickEventSystem(s, makeCtx({ cash: RICH }), new Random(42))).toBeNull();
    expect(s.minorNotices).toEqual([]);
  });
});

describe('tickEventSystem - notices and a pending major coexist', () => {
  it('a notice does not stop the next event firing: two notices at once', () => {
    clearEvents();
    registerEvents([MINOR_A, MINOR_B]);
    const s = readyState();
    tickEventSystem(s, makeCtx({ cash: RICH, tickCount: 1000 }), new Random(42));
    s.timers.find(t => t.category === 'weather')!.remaining = 1;
    s.actionCountSinceEvent = MIN_EVENT_INTERVAL_ACTIONS;
    const second = tickEventSystem(s, makeCtx({ cash: RICH, tickCount: 9000 }), new Random(42));
    expect(second?.minor).toBe(true);
    expect(s.pendingEvent).toBeNull();
    expect(s.minorNotices.map(n => n.eventId).sort()).toEqual(['n_minor_a', 'n_minor_b']);
    expect(s.minorNotices.map(n => n.firedAtTick)).toEqual([1000, 9000]);
  });

  it('a major event fires while a notice waits, and the notice stays', () => {
    clearEvents();
    registerEvents([MINOR_A, MAJOR]);
    const s = readyState();
    s.minorNotices.push(noticeOf('n_minor_a', 900));
    s.firedEventIds.push('n_minor_a');
    tickEventSystem(s, makeCtx({ cash: RICH }), new Random(42));
    expect(s.pendingEvent?.eventId).toBe('n_major');
    expect(s.minorNotices).toHaveLength(1);
    expect(s.minorNotices[0]!.eventId).toBe('n_minor_a');
  });

  it('while a major is pending nothing new fires, notice or not', () => {
    clearEvents();
    registerEvents([MINOR_B]);
    const s = readyState();
    s.pendingEvent = { eventId: 'n_major', firedAtTick: 990 };
    expect(tickEventSystem(s, makeCtx({ cash: RICH }), new Random(42))).toBeNull();
    expect(s.minorNotices).toEqual([]);
    expect(s.pendingEvent.eventId).toBe('n_major');
  });
});

describe('tickEventSystem - follow-ups classify the same way', () => {
  it('a minor follow-up becomes a notice when its delay ends', () => {
    const s = isolatedState();
    queueFollowUp(s, 'n_follow_up');
    const rng = new Random(1);
    let fired: ReturnType<typeof tickEventSystem> = null;
    for (let i = 1; i <= FOLLOWUP_DELAY_TICKS && !fired; i++) {
      fired = tickEventSystem(s, makeCtx({ cash: RICH, tickCount: 1000 + i }), rng);
    }
    expect(fired?.eventId).toBe('n_follow_up');
    expect(fired?.minor).toBe(true);
    expect(s.pendingEvent).toBeNull();
    expect(s.minorNotices).toHaveLength(1);
    expect(s.minorNotices[0]).toMatchObject({ eventId: 'n_follow_up', minor: true });
    expect(s.minorNotices[0]!.expiresAtTick).toBe(s.minorNotices[0]!.firedAtTick + COUNTDOWN);
    expect(s.followUpQueue).toEqual([]);
    expect(s.firedEventIds).toContain('n_follow_up');
  });

  it('the same follow-up is pending when the cost is major for the cash on hand', () => {
    const s = isolatedState();
    queueFollowUp(s, 'n_follow_up');
    const rng = new Random(1);
    for (let i = 1; i <= FOLLOWUP_DELAY_TICKS; i++) tickEventSystem(s, makeCtx({ tickCount: 1000 + i }), rng);
    expect(s.pendingEvent?.eventId).toBe('n_follow_up');
    expect(s.minorNotices).toEqual([]);
  });
});

describe('expireNotices', () => {
  it('resolves a notice whose countdown has ended to its default option and removes it', () => {
    const g = gameWith(noticeOf('n_minor_a', 1000));
    g.tickCount = 1000 + COUNTDOWN;
    expireNotices(g, new Random(42), world(g));
    expect(g.events.minorNotices).toEqual([]);
    // default = cheapest option = index 2: +500 cash, safety -2, corruption +4, a morale modifier
    expect(g.cash).toBe(10_500);
    expect(g.scores.safety).toBe(48);
    expect(g.corruption.level).toBe(4);
    expect(g.events.activeModifiers.length).toBe(1);
  });

  it('records lastNoticeOutcome as an automatic answer with the option result key', () => {
    const g = gameWith(noticeOf('n_minor_a', 1000));
    g.tickCount = 1000 + COUNTDOWN;
    expireNotices(g, new Random(42), world(g));
    expect(g.events.lastNoticeOutcome).toEqual({
      eventId: 'n_minor_a', resultKey: 'event.n_minor_a.res2', auto: true, seq: 1,
    });
  });

  it('leaves a notice with time left untouched', () => {
    const g = gameWith(noticeOf('n_minor_a', 1000));
    g.tickCount = 1000 + COUNTDOWN - 1;
    expireNotices(g, new Random(42), world(g));
    expect(g.events.minorNotices).toHaveLength(1);
    expect(g.cash).toBe(10_000);
    expect(g.events.lastNoticeOutcome).toBeNull();
  });

  it('resolves a notice that is long overdue', () => {
    const g = gameWith(noticeOf('n_minor_a', 1000));
    g.tickCount = 9000;
    expireNotices(g, new Random(42), world(g));
    expect(g.events.minorNotices).toEqual([]);
    expect(g.events.lastNoticeOutcome?.auto).toBe(true);
  });

  it('resolves only the due notice when two are waiting', () => {
    const g = gameWith(noticeOf('n_minor_a', 1000), noticeOf('n_minor_b', 1100));
    g.tickCount = 1000 + COUNTDOWN;
    expireNotices(g, new Random(42), world(g));
    expect(g.events.minorNotices.map(n => n.eventId)).toEqual(['n_minor_b']);
    expect(g.events.lastNoticeOutcome?.eventId).toBe('n_minor_a');
  });

  it('resolves two due notices in one call, each seen once, seq counting both', () => {
    const g = gameWith(noticeOf('n_minor_a', 1000), noticeOf('n_minor_b', 1000));
    g.tickCount = 1000 + COUNTDOWN;
    expireNotices(g, new Random(42), world(g));
    expect(g.events.minorNotices).toEqual([]);
    expect(g.events.lastNoticeOutcome?.seq).toBe(2);
    // a: +500, b: default is index 1 (+70)
    expect(g.cash).toBe(10_000 + 500 + 70);
    expect(g.scores.ecology).toBe(53);
  });

  it('continues seq from the previous notice outcome', () => {
    const g = gameWith(noticeOf('n_minor_a', 1000));
    g.events.lastNoticeOutcome = { eventId: 'old', resultKey: 'k', auto: false, seq: 7 };
    g.tickCount = 1000 + COUNTDOWN;
    expireNotices(g, new Random(42), world(g));
    expect(g.events.lastNoticeOutcome?.seq).toBe(8);
  });

  it('does not touch lastOutcome (the major modal) or the pending major', () => {
    const g = gameWith(noticeOf('n_minor_a', 1000));
    const outcome = { eventId: 'prev', resultKey: 'prev.res', effects: [] };
    g.events.lastOutcome = outcome;
    g.events.pendingEvent = { eventId: 'n_major', firedAtTick: 1100 };
    g.tickCount = 1000 + COUNTDOWN;
    expireNotices(g, new Random(42), world(g));
    expect(g.events.lastOutcome).toBe(outcome);
    expect(g.events.pendingEvent).toEqual({ eventId: 'n_major', firedAtTick: 1100 });
  });

  it('answers with the cheapest option that keeps the crew, never the paying leaver option', () => {
    const g = gameWith(noticeOf('n_minor_leaver', 1000));
    g.tickCount = 1000 + COUNTDOWN;
    expireNotices(g, new Random(42), world(g));
    expect(g.cash).toBe(9_900);
    expect(g.events.lastNoticeOutcome?.resultKey).toBe('event.n_minor_leaver.res1');
  });

  it('is a no-op with no notices', () => {
    const g = gameWith();
    g.tickCount = 5000;
    expireNotices(g, new Random(42), world(g));
    expect(g.cash).toBe(10_000);
    expect(g.events.lastNoticeOutcome).toBeNull();
  });

  it('queues a follow-up an automatic answer asks for', () => {
    const g = gameWith(noticeOf('n_minor_follow', 1000));
    g.tickCount = 1000 + COUNTDOWN;
    expireNotices(g, new Random(42), world(g));
    // default = index 0 (cash 0 beats -5), which queues the follow-up
    expect(g.events.lastNoticeOutcome?.resultKey).toBe('event.n_minor_follow.res0');
    expect(g.events.followUpQueue).toEqual(['n_follow_up']);
  });
});

describe('resolveNotice', () => {
  it('resolves the chosen option: effects apply, notice removed, recorded as the player\'s answer', () => {
    const g = gameWith(noticeOf('n_minor_a', 1000));
    const result = resolveNotice(g, 'n_minor_a', 0, new Random(42), world(g));
    expect(result).not.toBeNull();
    expect(result!.eventId).toBe('n_minor_a');
    expect(result!.optionIndex).toBe(0);
    expect(g.events.minorNotices).toEqual([]);
    expect(g.cash).toBe(9_700);
    expect(g.scores.wellBeing).toBe(55);
    expect(g.events.lastNoticeOutcome).toEqual({
      eventId: 'n_minor_a', resultKey: 'event.n_minor_a.res0', auto: false, seq: 1,
    });
  });

  it('records auto:true when asked to', () => {
    const g = gameWith(noticeOf('n_minor_a', 1000));
    resolveNotice(g, 'n_minor_a', 1, new Random(42), world(g), true);
    expect(g.events.lastNoticeOutcome?.auto).toBe(true);
  });

  it('applies corruption and modifiers of the chosen option', () => {
    const g = gameWith(noticeOf('n_minor_a', 1000));
    resolveNotice(g, 'n_minor_a', 2, new Random(42), world(g));
    expect(g.corruption.level).toBe(4);
    expect(g.events.activeModifiers.length).toBe(1);
    expect(g.cash).toBe(10_500);
  });

  it('resolves only the named notice when two wait', () => {
    const g = gameWith(noticeOf('n_minor_a', 1000), noticeOf('n_minor_b', 1010));
    resolveNotice(g, 'n_minor_b', 1, new Random(42), world(g));
    expect(g.events.minorNotices.map(n => n.eventId)).toEqual(['n_minor_a']);
    expect(g.cash).toBe(10_070);
  });

  it('increments seq per resolved notice', () => {
    const g = gameWith(noticeOf('n_minor_a', 1000), noticeOf('n_minor_b', 1010));
    resolveNotice(g, 'n_minor_a', 1, new Random(42), world(g));
    expect(g.events.lastNoticeOutcome?.seq).toBe(1);
    resolveNotice(g, 'n_minor_b', 0, new Random(42), world(g));
    expect(g.events.lastNoticeOutcome?.seq).toBe(2);
    expect(g.events.lastNoticeOutcome?.eventId).toBe('n_minor_b');
  });

  it('leaves the pending major, lastOutcome and isPaused as they were', () => {
    const g = gameWith(noticeOf('n_minor_a', 1000));
    const outcome = { eventId: 'prev', resultKey: 'prev.res', effects: [] };
    g.events.lastOutcome = outcome;
    g.events.pendingEvent = { eventId: 'n_major', firedAtTick: 1100 };
    g.isPaused = true;
    resolveNotice(g, 'n_minor_a', 0, new Random(42), world(g));
    expect(g.events.pendingEvent).toEqual({ eventId: 'n_major', firedAtTick: 1100 });
    expect(g.events.lastOutcome).toBe(outcome);
    expect(g.isPaused).toBe(true);
  });

  it('leaves isPaused false when it was false', () => {
    const g = gameWith(noticeOf('n_minor_a', 1000));
    g.isPaused = false;
    resolveNotice(g, 'n_minor_a', 0, new Random(42), world(g));
    expect(g.isPaused).toBe(false);
  });

  it('rolls a risky option through its fallback like a major would', () => {
    const g = gameWith(noticeOf('n_minor_risky', 1000));
    resolveNotice(g, 'n_minor_risky', 0, new Random(42), world(g));
    expect(g.cash).toBe(10_040);
    expect(g.events.lastNoticeOutcome?.resultKey).toBe('event.n_minor_risky.res0_alt');
  });

  it('queues the follow-up the option names', () => {
    const g = gameWith(noticeOf('n_minor_follow', 1000));
    resolveNotice(g, 'n_minor_follow', 0, new Random(42), world(g));
    expect(g.events.followUpQueue).toEqual(['n_follow_up']);
  });

  it('returns null and changes nothing for an event with no notice', () => {
    const g = gameWith(noticeOf('n_minor_a', 1000));
    expect(resolveNotice(g, 'n_minor_b', 0, new Random(42), world(g))).toBeNull();
    expect(g.events.minorNotices).toHaveLength(1);
    expect(g.cash).toBe(10_000);
    expect(g.events.lastNoticeOutcome).toBeNull();
  });

  it('returns null and keeps the notice for an out-of-range option', () => {
    const g = gameWith(noticeOf('n_minor_a', 1000));
    expect(resolveNotice(g, 'n_minor_a', 3, new Random(42), world(g))).toBeNull();
    expect(resolveNotice(g, 'n_minor_a', -1, new Random(42), world(g))).toBeNull();
    expect(g.events.minorNotices).toHaveLength(1);
    expect(g.cash).toBe(10_000);
    expect(g.events.lastNoticeOutcome).toBeNull();
  });

  it('an answered notice is not resolved again when its countdown would have ended', () => {
    const g = gameWith(noticeOf('n_minor_a', 1000));
    resolveNotice(g, 'n_minor_a', 0, new Random(42), world(g));
    g.tickCount = 1000 + COUNTDOWN;
    expireNotices(g, new Random(42), world(g));
    expect(g.cash).toBe(9_700);
    expect(g.events.lastNoticeOutcome?.seq).toBe(1);
  });
});

describe('applyResolutionToState', () => {
  function result(over: Partial<ResolutionResult>): ResolutionResult {
    return {
      success: true, eventId: 'x', optionIndex: 0, resultKey: 'k', effects: [],
      cashChange: 0, cashSettled: 0, scoreChanges: {}, corruptionChange: 0, followUpQueued: null,
      effectChips: [], ...over,
    };
  }

  it('adds the cash change to the flat cash and the corruption change to the corruption level', () => {
    const g = createGame({ seed: 42 });
    g.cash = 1000;
    applyResolutionToState(g, result({ cashChange: -250, corruptionChange: 3 }));
    expect(g.cash).toBe(750);
    expect(g.corruption.level).toBe(3);
  });

  it('never re-applies cash a world effect already settled', () => {
    const g = createGame({ seed: 42 });
    g.cash = 1000;
    applyResolutionToState(g, result({ cashChange: 100, cashSettled: -400 }));
    expect(g.cash).toBe(1100);
  });

  it('is a no-op for an empty resolution', () => {
    const g = createGame({ seed: 42 });
    g.cash = 1000;
    applyResolutionToState(g, result({}));
    expect(g.cash).toBe(1000);
    expect(g.corruption.level).toBe(0);
  });
});

describe('save/load (#2146)', () => {
  it('round-trips notices and the last notice outcome', () => {
    const g = gameWith(noticeOf('n_minor_a', 1000));
    g.events.lastNoticeOutcome = { eventId: 'n_minor_b', resultKey: 'k', auto: true, seq: 3 };
    const restored = deserialize(serialize(g));
    expect(restored.events.minorNotices).toEqual([noticeOf('n_minor_a', 1000)]);
    expect(restored.events.lastNoticeOutcome).toEqual({ eventId: 'n_minor_b', resultKey: 'k', auto: true, seq: 3 });
  });

  it('a save lacking minorNotices and lastNoticeOutcome loads with [] and null', () => {
    const g = createGame({ seed: 42 });
    const parsed = JSON.parse(serialize(g)) as Record<string, unknown>;
    const events = parsed['events'] as Record<string, unknown>;
    delete events['minorNotices'];
    delete events['lastNoticeOutcome'];
    const restored = deserialize(JSON.stringify(parsed));
    expect(restored.events.minorNotices).toEqual([]);
    expect(restored.events.lastNoticeOutcome).toBeNull();
  });
});
