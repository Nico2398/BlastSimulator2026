// BlastSimulator2026 — Event shielding and judge handling from bribe protections (#1407)
import { describe, it, expect, beforeEach } from 'vitest';
import { Random } from '../../../src/core/math/Random.js';
import { registerEvents, clearEvents, type EventContext } from '../../../src/core/events/EventPool.js';
import { ev } from '../../../src/core/events/EventBuilder.js';
import { createScoreState } from '../../../src/core/scores/ScoreManager.js';
import {
  createEventSystemState,
  selectEvent,
  tickEventSystem,
} from '../../../src/core/events/EventSystem.js';
import { grantProtection, type ActiveProtection } from '../../../src/core/economy/BribeProtection.js';
import {
  JUDGE_LAWSUIT_TIMER_STRETCH,
  INSPECTION_EVENT_TAG,
  BRIBE_PROTECTION_MAX_LINGER_DAYS,
  MIN_EVENT_INTERVAL_TICKS,
  MIN_EVENT_INTERVAL_RANDOM_RANGE,
  MIN_EVENT_INTERVAL_ACTIONS,
  TICKS_PER_DAY,
} from '../../../src/core/config/balance.js';

function makeCtx(overrides: Partial<EventContext> = {}): EventContext {
  return {
    scores: createScoreState(),
    employeeCount: 10,
    deathCount: 0,
    corruptionLevel: 0,
    hasBuilding: () => false,
    hasDrillPlan: false,
    tickCount: 1_000_000,
    lawsuitCount: 0,
    activeContractCount: 0,
    weatherId: 'sunny',
    hasBlasted: false,
    ...overrides,
  };
}

const opts = { weight: () => 1, options: [{ cashDelta: 0 }, { cashDelta: 0 }] };

function prot(target: ActiveProtection['target'], expiresAtTick: number, dismissalsLeft = 0, shielded = true): ActiveProtection {
  return { target, expiresAtTick, dismissalsLeft, shielded };
}

describe('selectEvent with protections (#1407)', () => {
  beforeEach(() => {
    clearEvents();
    registerEvents([
      ev('t_union', 'union', opts),
      ev('t_politics', 'politics', opts),
      ev('t_inspect', 'lawsuit', { ...opts, tags: [INSPECTION_EVENT_TAG] }),
      ev('t_plain_suit', 'lawsuit', opts),
    ]);
  });

  it('union event is selectable without protection', () => {
    expect(selectEvent('union', makeCtx(), new Random(42))?.id).toBe('t_union');
  });

  it('union_leader protection makes every union event unselectable (null when all shielded)', () => {
    const ctx = makeCtx({ protections: [prot('union_leader', 2_000_000)] });
    for (let seed = 0; seed < 10; seed++) expect(selectEvent('union', ctx, new Random(seed))).toBeNull();
  });

  it('politician protection shields politics events', () => {
    const ctx = makeCtx({ protections: [prot('politician', 2_000_000)] });
    expect(selectEvent('politics', ctx, new Random(1))).toBeNull();
  });

  it('inspector shields only the tagged lawsuit, the untagged one still fires', () => {
    const ctx = makeCtx({ protections: [prot('inspector', 2_000_000)] });
    for (let seed = 0; seed < 30; seed++) {
      expect(selectEvent('lawsuit', ctx, new Random(seed))?.id).toBe('t_plain_suit');
    }
  });

  it('expired protection no longer shields', () => {
    const ctx = makeCtx({ protections: [prot('union_leader', 1_000_000)] });
    expect(selectEvent('union', ctx, new Random(42))?.id).toBe('t_union');
  });

  it('protections field is optional', () => {
    const ctx = makeCtx();
    expect(ctx.protections).toBeUndefined();
    expect(selectEvent('politics', ctx, new Random(1))?.id).toBe('t_politics');
  });

  it('other categories are unaffected by union_leader protection', () => {
    const ctx = makeCtx({ protections: [prot('union_leader', 2_000_000)] });
    expect(selectEvent('politics', ctx, new Random(1))?.id).toBe('t_politics');
  });
});

describe('tickEventSystem with a judge protection (#1407)', () => {
  beforeEach(() => {
    clearEvents();
    registerEvents([ev('t_suit_a', 'lawsuit', opts), ev('t_suit_b', 'lawsuit', opts)]);
  });

  /** State whose lawsuit timer fires on the next tick and whose cooldown is long past. */
  function armed() {
    const state = createEventSystemState();
    for (const t of state.timers) t.remaining = t.category === 'lawsuit' ? 1 : 1_000_000;
    state.actionCountSinceEvent = 1000;
    state.lastEventTick = 0;
    return state;
  }
  const lawsuitTimer = (s: ReturnType<typeof armed>) => s.timers.find(t => t.category === 'lawsuit')!;

  it('consumes the next lawsuit: nothing pending, id marked fired, timer reset, dismissal spent', () => {
    const state = armed();
    const protections = [prot('judge', 2_000_000, 1)];
    const fired = tickEventSystem(state, makeCtx({ protections }), new Random(42));
    expect(fired).toBeNull();
    expect(state.pendingEvent).toBeNull();
    expect(state.firedEventIds).toHaveLength(1);
    expect(['t_suit_a', 't_suit_b']).toContain(state.firedEventIds[0]);
    expect(lawsuitTimer(state).remaining).toBeGreaterThan(1);
    expect(protections[0]!.dismissalsLeft).toBe(0);
  });

  it('the second lawsuit fires normally', () => {
    const state = armed();
    const protections = [prot('judge', 5_000_000, 1)];
    tickEventSystem(state, makeCtx({ protections }), new Random(42));
    lawsuitTimer(state).remaining = 1;
    state.actionCountSinceEvent = 1000;
    const fired = tickEventSystem(state, makeCtx({ protections, tickCount: 2_000_000 }), new Random(7));
    expect(fired).not.toBeNull();
    expect(state.pendingEvent).not.toBeNull();
    expect(state.firedEventIds).toHaveLength(2);
    expect(new Set(state.firedEventIds).size).toBe(2);
  });

  it('without protection the first lawsuit fires normally', () => {
    const state = armed();
    const fired = tickEventSystem(state, makeCtx(), new Random(42));
    expect(fired).not.toBeNull();
    expect(state.pendingEvent).toBe(fired);
  });

  it('expired judge protection does not dismiss', () => {
    const state = armed();
    const fired = tickEventSystem(state, makeCtx({ protections: [prot('judge', 1_000_000, 1)] }), new Random(42));
    expect(fired).not.toBeNull();
  });

  it('judge stretches the lawsuit timer reset by JUDGE_LAWSUIT_TIMER_STRETCH', () => {
    const plain = armed();
    tickEventSystem(plain, makeCtx(), new Random(42));
    const stretched = armed();
    tickEventSystem(stretched, makeCtx({ protections: [prot('judge', 2_000_000, 0)] }), new Random(42));
    const ratio = lawsuitTimer(stretched).remaining / lawsuitTimer(plain).remaining;
    expect(ratio).toBeGreaterThan(JUDGE_LAWSUIT_TIMER_STRETCH - 0.05);
    expect(ratio).toBeLessThan(JUDGE_LAWSUIT_TIMER_STRETCH + 0.05);
  });

  it('judge does not stretch other timers', () => {
    const plain = armed();
    const other = armed();
    plain.timers.find(t => t.category === 'weather')!.remaining = 1;
    other.timers.find(t => t.category === 'weather')!.remaining = 1;
    lawsuitTimer(plain).remaining = 1_000_000;
    lawsuitTimer(other).remaining = 1_000_000;
    tickEventSystem(plain, makeCtx(), new Random(42));
    tickEventSystem(other, makeCtx({ protections: [prot('judge', 2_000_000, 0)] }), new Random(42));
    const w = (s: ReturnType<typeof armed>) => s.timers.find(t => t.category === 'weather')!.remaining;
    expect(w(other)).toBe(w(plain));
  });
});

describe('protection granted the tick an event fires (#1816)', () => {
  const T0 = 5_000;
  const LONGEST_ROLL = MIN_EVENT_INTERVAL_TICKS + MIN_EVENT_INTERVAL_RANDOM_RANGE - 1;
  const LINGER = BRIBE_PROTECTION_MAX_LINGER_DAYS * TICKS_PER_DAY;
  /** Tick at which the action gate finally opens: past the longest cooldown roll and every paid window. */
  const GATE_OPEN = T0 + 200;

  beforeEach(() => {
    clearEvents();
    registerEvents([
      ev('t_union', 'union', opts),
      ev('t_politics', 'politics', opts),
      ev('t_inspect', 'lawsuit', { ...opts, tags: [INSPECTION_EVENT_TAG] }),
      ev('t_suit', 'lawsuit', opts),
    ]);
  });

  /** State just after an event fired at T0: worst-case cooldown roll, no commands issued yet. */
  function justFired() {
    const state = createEventSystemState();
    for (const t of state.timers) t.remaining = 1_000_000;
    state.lastEventTick = T0;
    state.actionCountSinceEvent = 0;
    state.cooldownMinIntervalTicks = LONGEST_ROLL;
    return state;
  }

  /** Force the category timer to be due on the next tick. */
  function arm(state: ReturnType<typeof justFired>, category: string): void {
    state.timers.find(t => t.category === category)!.remaining = 1;
  }

  /** Tick once per game tick in (from, to], re-arming the timer each tick; stops when something is pending. */
  function driveTicks(
    state: ReturnType<typeof justFired>, protections: ActiveProtection[], category: string,
    from: number, to: number, gateOpensAt: number,
  ): void {
    for (let tick = from + 1; tick <= to; tick++) {
      if (tick >= gateOpensAt) state.actionCountSinceEvent = MIN_EVENT_INTERVAL_ACTIONS;
      arm(state, category);
      tickEventSystem(state, makeCtx({ protections, tickCount: tick }), new Random(tick));
      if (state.pendingEvent) return;
    }
  }

  it('judge: the next lawsuit selected is dismissed even though the paid window ended before the gates opened', () => {
    const state = justFired();
    const protections: ActiveProtection[] = [];
    grantProtection(protections, 'judge', T0);
    expect(protections[0]!.expiresAtTick).toBeLessThan(GATE_OPEN);
    driveTicks(state, protections, 'lawsuit', T0, GATE_OPEN, GATE_OPEN);
    expect(state.pendingEvent).toBeNull();
    expect(state.firedEventIds).toHaveLength(1);
    expect(protections[0]!.dismissalsLeft).toBe(0);
    expect(protections[0]!.shielded).toBe(true);
  });

  it('judge: the lawsuit after the dismissed one reaches the player', () => {
    const state = justFired();
    const protections: ActiveProtection[] = [];
    grantProtection(protections, 'judge', T0);
    driveTicks(state, protections, 'lawsuit', T0, GATE_OPEN, GATE_OPEN);
    expect(state.pendingEvent).toBeNull();
    driveTicks(state, protections, 'lawsuit', GATE_OPEN, GATE_OPEN + 40, GATE_OPEN);
    expect(state.pendingEvent).not.toBeNull();
    expect(state.firedEventIds).toHaveLength(2);
  });

  const BLOCKERS: Array<{ target: ActiveProtection['target']; category: string; eventId: string }> = [
    { target: 'union_leader', category: 'union', eventId: 't_union' },
    { target: 'politician', category: 'politics', eventId: 't_politics' },
    { target: 'inspector', category: 'lawsuit', eventId: 't_inspect' },
  ];
  // The inspector case needs the untagged lawsuit out of the pool so only the shielded kind can fire.
  const poolFor = (eventId: string) => {
    if (eventId === 't_inspect') { clearEvents(); registerEvents([ev('t_inspect', 'lawsuit', { ...opts, tags: [INSPECTION_EVENT_TAG] })]); }
  };

  for (const { target, category, eventId } of BLOCKERS) {
    describe(target, () => {
      it('the next event of its kind never becomes pending while the protection is active', () => {
        poolFor(eventId);
        const state = justFired();
        const protections: ActiveProtection[] = [];
        grantProtection(protections, target, T0);
        expect(protections[0]!.expiresAtTick).toBeLessThan(GATE_OPEN);
        // Gate opens at GATE_OPEN: that tick the protection shields; the next tick it has expired.
        driveTicks(state, protections, category, T0, GATE_OPEN, GATE_OPEN);
        expect(state.pendingEvent).toBeNull();
        expect(state.firedEventIds).not.toContain(eventId);
        expect(protections.map(p => p.target)).toContain(target);
        expect(protections[0]!.shielded).toBe(true);
      });

      it('after it shielded once, the protection expires normally and the postponed event fires', () => {
        poolFor(eventId);
        const state = justFired();
        const protections: ActiveProtection[] = [];
        grantProtection(protections, target, T0);
        driveTicks(state, protections, category, T0, GATE_OPEN, GATE_OPEN);
        expect(state.pendingEvent).toBeNull();
        driveTicks(state, protections, category, GATE_OPEN, GATE_OPEN + 10, GATE_OPEN);
        expect(protections).toHaveLength(0);
        expect(state.pendingEvent?.eventId).toBe(eventId);
      });

      it('a protection that never shielded anything ends at the linger cap', () => {
        poolFor(eventId);
        const state = justFired();
        const protections: ActiveProtection[] = [];
        const p = grantProtection(protections, target, T0)!;
        const capTick = p.expiresAtTick + LINGER;
        // Gate stays shut until the cap, so nothing is ever selected and the protection never shields.
        driveTicks(state, protections, category, T0, capTick - 1, capTick + 1_000_000);
        expect(state.pendingEvent).toBeNull();
        expect(protections).toHaveLength(1);
        expect(protections[0]!.shielded).toBe(false);
        state.actionCountSinceEvent = MIN_EVENT_INTERVAL_ACTIONS;
        arm(state, category);
        tickEventSystem(state, makeCtx({ protections, tickCount: capTick }), new Random(1));
        expect(protections).toHaveLength(0);
        expect(state.pendingEvent?.eventId).toBe(eventId);
      });
    });
  }

  it('selectEvent marks the blocking protection shielded when it hides an eligible event, and still returns null', () => {
    const protections: ActiveProtection[] = [];
    grantProtection(protections, 'union_leader', T0);
    const ctx = makeCtx({ protections, tickCount: T0 + 150 });
    expect(selectEvent('union', ctx, new Random(3))).toBeNull();
    expect(protections[0]!.shielded).toBe(true);
  });

  it('selectEvent leaves the protection unshielded when it hides nothing', () => {
    const protections: ActiveProtection[] = [];
    grantProtection(protections, 'union_leader', T0);
    const ctx = makeCtx({ protections, tickCount: T0 + 150 });
    expect(selectEvent('politics', ctx, new Random(3))?.id).toBe('t_politics');
    expect(protections[0]!.shielded).toBe(false);
  });

  it('selectEvent still picks from the open set when the protection hides the tagged event', () => {
    const protections: ActiveProtection[] = [];
    grantProtection(protections, 'inspector', T0);
    const ctx = makeCtx({ protections, tickCount: T0 + 10 });
    for (let seed = 0; seed < 10; seed++) expect(selectEvent('lawsuit', ctx, new Random(seed))?.id).toBe('t_suit');
    expect(protections[0]!.shielded).toBe(true);
  });
});
