// Follow-up events (#1413): never picked by category timers; fire only when queued
// by a parent option, FOLLOWUP_DELAY_TICKS ticks after queueing (countdown counts only
// while no event is pending).

import { describe, it, expect, beforeEach } from 'vitest';
import { Random } from '../../../src/core/math/Random.js';
import {
  createEventSystemState,
  tickEventSystem,
  queueFollowUp,
  selectEvent,
  incrementActionCount,
  type EventSystemState,
} from '../../../src/core/events/EventSystem.js';
import { resolveEvent } from '../../../src/core/events/EventResolver.js';
import { setupEvents, clearEvents } from '../../../src/core/events/index.js';
import { getAllEvents, getEventById, type EventContext, type EventCategory } from '../../../src/core/events/EventPool.js';
import { FOLLOWUP_EVENTS } from '../../../src/core/events/FollowUpEvents.js';
import { FOLLOWUP_DELAY_TICKS } from '../../../src/core/config/balance.js';
import { createScoreState } from '../../../src/core/scores/ScoreManager.js';
import { createFinanceState } from '../../../src/core/economy/Finance.js';
import { createGame } from '../../../src/core/state/GameState.js';
import { serialize, deserialize } from '../../../src/core/state/SaveLoad.js';

const N = FOLLOWUP_DELAY_TICKS;
const FOLLOWUP_IDS = FOLLOWUP_EVENTS.map(e => e.id);
const TIMER_CATEGORIES: EventCategory[] = ['union', 'politics', 'weather', 'mafia', 'lawsuit'];

function makeCtx(overrides: Partial<EventContext> = {}): EventContext {
  const scores = createScoreState();
  scores.ecology = 20;
  scores.safety = 20;
  scores.wellBeing = 20;
  return {
    scores,
    employeeCount: 10,
    deathCount: 2,
    corruptionLevel: 50,
    hasBuilding: () => true,
    hasDrillPlan: true,
    tickCount: 1000,
    lawsuitCount: 1,
    activeContractCount: 1,
    weatherId: 'sunny',
    ...overrides,
  };
}

/** State whose category timers never fire, isolating the follow-up queue. */
function isolatedState(): EventSystemState {
  const s = createEventSystemState();
  for (const t of s.timers) t.remaining = 1_000_000_000;
  return s;
}

/** Tick n times, returning the tick index (1-based) of the first fire or null. */
function tickUntilFire(state: EventSystemState, n: number, startTick = 1000): number | null {
  const rng = new Random(1);
  for (let i = 1; i <= n; i++) {
    if (tickEventSystem(state, makeCtx({ tickCount: startTick + i }), rng)) return i;
  }
  return null;
}

beforeEach(() => {
  clearEvents();
  setupEvents();
});

describe('follow-up event definitions', () => {
  it('every FOLLOWUP_EVENTS entry is followUpOnly', () => {
    expect(FOLLOWUP_EVENTS.length).toBe(8);
    for (const e of FOLLOWUP_EVENTS) expect(e.followUpOnly, e.id).toBe(true);
  });

  it('every followUpEventId referenced by a pool event resolves to a followUpOnly event', () => {
    const referenced = new Set<string>();
    for (const e of getAllEvents()) {
      for (const c of e.consequences) {
        if (c.followUpEventId) referenced.add(c.followUpEventId);
        if (c.altConsequence?.followUpEventId) referenced.add(c.altConsequence.followUpEventId);
      }
    }
    expect(referenced.size).toBeGreaterThan(0);
    for (const id of referenced) {
      const def = getEventById(id);
      expect(def, id).toBeDefined();
      expect(def!.followUpOnly, id).toBe(true);
    }
  });

  it('only follow-up events carry followUpOnly', () => {
    for (const e of getAllEvents()) {
      if (e.followUpOnly) expect(FOLLOWUP_IDS).toContain(e.id);
    }
  });
});

describe('selectEvent never returns a follow-up', () => {
  it('across all timer categories, many seeds and score profiles', () => {
    const profiles = [20, 50, 90].map(v => {
      const s = createScoreState();
      s.ecology = v; s.safety = v; s.wellBeing = v; s.nuisance = v;
      return s;
    });
    for (const category of TIMER_CATEGORIES) {
      for (const scores of profiles) {
        for (let seed = 1; seed <= 150; seed++) {
          const picked = selectEvent(category, makeCtx({ scores }), new Random(seed));
          if (picked) expect(picked.followUpOnly, `${category} seed ${seed}`).not.toBe(true);
        }
      }
    }
  });

  it('returns null when only follow-up events remain in the category', () => {
    const fired = getAllEvents().filter(e => !e.followUpOnly).map(e => e.id);
    for (const category of TIMER_CATEGORIES) {
      expect(selectEvent(category, makeCtx(), new Random(3), fired)).toBeNull();
    }
  });
});

describe('long headless run', () => {
  it('never fires a follow-up when no parent queued it (esp. politics_mayor_wins)', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const state = createEventSystemState();
      const rng = new Random(seed);
      const finances = createFinanceState(1_000_000);
      const scores = createScoreState();
      scores.ecology = 20; scores.safety = 20; scores.wellBeing = 20;
      const queued = new Set<string>();
      const fired: string[] = [];
      for (let tick = 1; tick <= 20000; tick++) {
        incrementActionCount(state);
        const f = tickEventSystem(state, makeCtx({ scores: { ...scores }, tickCount: tick }), rng);
        if (!f) continue;
        fired.push(f.eventId);
        const def = getEventById(f.eventId)!;
        // Pick an option that does not queue a follow-up when one exists.
        let opt = def.consequences.findIndex(c => !c.followUpEventId && !c.altConsequence?.followUpEventId);
        if (opt < 0) opt = 0;
        const res = resolveEvent(state, finances, scores, opt, tick, rng);
        if (res?.followUpQueued) queued.add(res.followUpQueued);
      }
      expect(fired.length, `seed ${seed}`).toBeGreaterThan(5);
      for (const id of fired) {
        if (FOLLOWUP_IDS.includes(id)) {
          expect(queued.has(id), `seed ${seed}: ${id} fired without being queued`).toBe(true);
        }
      }
      expect(fired, `seed ${seed}`).not.toContain('politics_mayor_wins');
    }
  });
});

describe('queueFollowUp delay', () => {
  it('fires on exactly the FOLLOWUP_DELAY_TICKS-th tick, not before or after', () => {
    const state = isolatedState();
    queueFollowUp(state, 'politics_mayor_wins');
    const fireTick = tickUntilFire(state, N + 5);
    expect(fireTick).toBe(N);
    expect(state.pendingEvent?.eventId).toBe('politics_mayor_wins');
  });

  it('does not fire on the first tick', () => {
    const state = isolatedState();
    queueFollowUp(state, 'politics_mayor_wins');
    expect(tickUntilFire(state, 1)).toBeNull();
    expect(state.followUpQueue).toEqual(['politics_mayor_wins']);
  });

  it('countdown pauses while an event is pending', () => {
    const state = isolatedState();
    state.pendingEvent = { eventId: 'union_coffee_uprising', firedAtTick: 1 };
    queueFollowUp(state, 'politics_mayor_wins');
    expect(tickUntilFire(state, 3 * N)).toBeNull();
    expect(state.pendingEvent.eventId).toBe('union_coffee_uprising');
    state.pendingEvent = null;
    expect(tickUntilFire(state, N + 5)).toBe(N);
  });

  it('only ticks without a pending event count toward the delay', () => {
    const state = isolatedState();
    queueFollowUp(state, 'politics_mayor_wins');
    expect(tickUntilFire(state, 10)).toBeNull();
    state.pendingEvent = { eventId: 'union_coffee_uprising', firedAtTick: 1 };
    expect(tickUntilFire(state, 50)).toBeNull();
    state.pendingEvent = null;
    expect(tickUntilFire(state, N + 5)).toBe(N - 10);
  });

  it('drops a queued id already fired and never fires it twice', () => {
    const state = isolatedState();
    state.firedEventIds.push('politics_mayor_wins');
    queueFollowUp(state, 'politics_mayor_wins');
    queueFollowUp(state, 'lawsuit_class_action_mega');
    const rng = new Random(1);
    const firedIds: string[] = [];
    for (let i = 1; i <= 4 * N; i++) {
      const f = tickEventSystem(state, makeCtx({ tickCount: 1000 + i }), rng);
      if (f) {
        firedIds.push(f.eventId);
        state.pendingEvent = null;
      }
      if (i < N) expect(f).toBeNull();
    }
    expect(firedIds).toEqual(['lawsuit_class_action_mega']);
    expect(state.followUpQueue).toEqual([]);
    expect(state.firedEventIds.filter(id => id === 'politics_mayor_wins')).toHaveLength(1);
  });

  it('drops unknown and non-followUpOnly ids without crashing; later valid one still fires', () => {
    const state = isolatedState();
    queueFollowUp(state, 'no_such_event');
    queueFollowUp(state, 'union_coffee_uprising');
    queueFollowUp(state, 'politics_mayor_wins');
    const rng = new Random(1);
    const firedIds: string[] = [];
    expect(() => {
      for (let i = 1; i <= 6 * N; i++) {
        const f = tickEventSystem(state, makeCtx({ tickCount: 1000 + i }), rng);
        if (f) {
          firedIds.push(f.eventId);
          state.pendingEvent = null;
        }
      }
    }).not.toThrow();
    expect(firedIds).toEqual(['politics_mayor_wins']);
    expect(state.firedEventIds).not.toContain('no_such_event');
    expect(state.firedEventIds).not.toContain('union_coffee_uprising');
    expect(state.followUpQueue).toEqual([]);
  });

  it('fired follow-up records itself and resets cooldown bookkeeping', () => {
    const state = isolatedState();
    state.lastEventTick = 0;
    state.actionCountSinceEvent = 7;
    state.cooldownMinIntervalTicks = 99;
    queueFollowUp(state, 'politics_mayor_wins');
    const fireTick = tickUntilFire(state, N + 5, 500);
    expect(fireTick).toBe(N);
    expect(state.firedEventIds).toContain('politics_mayor_wins');
    expect(state.lastEventTick).toBe(500 + N);
    expect(state.actionCountSinceEvent).toBe(0);
    expect(state.cooldownMinIntervalTicks).toBeNull();
    expect(state.pendingEvent).toEqual({ eventId: 'politics_mayor_wins', firedAtTick: 500 + N });
  });
});

describe('parent resolution queues the follow-up', () => {
  it("resolving politics_mayor_antimine's do-nothing option queues politics_mayor_wins, which fires after the delay", () => {
    const state = isolatedState();
    state.pendingEvent = { eventId: 'politics_mayor_antimine', firedAtTick: 10 };
    const res = resolveEvent(state, createFinanceState(1_000_000), createScoreState(), 2, 11, new Random(5));
    expect(res?.followUpQueued).toBe('politics_mayor_wins');
    expect(state.followUpQueue).toContain('politics_mayor_wins');
    expect(tickUntilFire(state, N + 5)).toBe(N);
    expect(state.pendingEvent?.eventId).toBe('politics_mayor_wins');
  });
});

describe('save/load', () => {
  it('round-trips followUpQueue and followUpDelayTicks', () => {
    const game = createGame({ seed: 42 });
    game.events.followUpQueue = ['politics_mayor_wins', 'weather_lawsuit_debris'];
    game.events.followUpDelayTicks = 17;
    const restored = deserialize(serialize(game));
    expect(restored.events.followUpQueue).toEqual(['politics_mayor_wins', 'weather_lawsuit_debris']);
    expect(restored.events.followUpDelayTicks).toBe(17);
  });

  it('a legacy save lacking followUpDelayTicks loads with 0', () => {
    const game = createGame({ seed: 42 });
    const parsed = JSON.parse(serialize(game)) as Record<string, unknown>;
    delete (parsed['events'] as Record<string, unknown>)['followUpDelayTicks'];
    const restored = deserialize(JSON.stringify(parsed));
    expect(restored.events.followUpDelayTicks).toBe(0);
  });
});
