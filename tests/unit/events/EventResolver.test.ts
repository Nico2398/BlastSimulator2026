import { describe, it, expect, beforeEach } from 'vitest';
import { Random } from '../../../src/core/math/Random.js';
import { resolveEvent } from '../../../src/core/events/EventResolver.js';
import {
  createEventSystemState,
  type EventSystemState,
} from '../../../src/core/events/EventSystem.js';
import {
  registerEvents,
  clearEvents,
  type EventDef,
} from '../../../src/core/events/EventPool.js';
import { createScoreState } from '../../../src/core/scores/ScoreManager.js';
import { createFinanceState } from '../../../src/core/economy/Finance.js';

function makeTestEvent(): EventDef {
  return {
    id: 'test_resolve',
    category: 'union',
    titleKey: 'event.test.title',
    descKey: 'event.test.desc',
    options: [
      { labelKey: 'event.test.opt0', resultKey: 'event.test_resolve.res0' },
      { labelKey: 'event.test.opt1', resultKey: 'event.test_resolve.res1' },
      { labelKey: 'event.test.opt2', resultKey: 'event.test_resolve.res2' },
      // Option 3 — probability 0 forces the alt branch deterministically,
      // regardless of rng seed (chance(0) is always false).
      { labelKey: 'event.test.opt3', resultKey: 'event.test_resolve.res3' },
      // Option 4 — probability 1.0 forces the main branch deterministically
      // even though a probability + altConsequence is present (chance(1) is
      // always true since Random.next() never returns exactly 1).
      { labelKey: 'event.test.opt4', resultKey: 'event.test_resolve.res4' },
    ],
    consequences: [
      { cashDelta: -5000, scoreDelta: { wellBeing: 10 } },
      { cashDelta: 0, scoreDelta: { wellBeing: -5 } },
      {
        cashDelta: -15000,
        corruptionDelta: 2,
        followUpEventId: 'test_followup',
      },
      {
        cashDelta: 100,
        probability: 0,
        altConsequence: { cashDelta: -999, scoreDelta: { safety: -1 } },
      },
      {
        cashDelta: 200,
        probability: 1.0,
        altConsequence: { cashDelta: -1 },
      },
    ],
    weightCoeff: () => 1,
    canFire: () => true,
  };
}

describe('Event resolution system', () => {
  let eventSystem: EventSystemState;

  beforeEach(() => {
    clearEvents();
    registerEvents([makeTestEvent()]);
    eventSystem = createEventSystemState();
    eventSystem.pendingEvent = { eventId: 'test_resolve', firedAtTick: 10 };
  });

  it('resolving event with option 0 applies option 0 consequences', () => {
    const finances = createFinanceState(50000);
    const scores = createScoreState();
    const rng = new Random(42);

    const result = resolveEvent(eventSystem, finances, scores, 0, 10, rng);
    expect(result).not.toBeNull();
    expect(result!.eventId).toBe('test_resolve');
    expect(result!.optionIndex).toBe(0);
    expect(result!.cashChange).toBe(-5000);
    expect(finances.cash).toBe(45000);
  });

  it('score changes from resolution are applied', () => {
    const finances = createFinanceState(50000);
    const scores = createScoreState(); // wellBeing starts at 50
    const rng = new Random(42);

    resolveEvent(eventSystem, finances, scores, 0, 10, rng);
    expect(scores.wellBeing).toBe(60); // +10
  });

  it('financial effects from resolution are applied', () => {
    const finances = createFinanceState(50000);
    const scores = createScoreState();
    const rng = new Random(42);

    resolveEvent(eventSystem, finances, scores, 0, 10, rng);
    expect(finances.cash).toBe(45000);
    expect(finances.transactions.length).toBe(1);
    expect(finances.transactions[0]!.type).toBe('expense');
  });

  it('follow-up events are queued when specified', () => {
    const finances = createFinanceState(50000);
    const scores = createScoreState();
    const rng = new Random(42);

    const result = resolveEvent(eventSystem, finances, scores, 2, 10, rng);
    expect(result!.followUpQueued).toBe('test_followup');
    expect(eventSystem.followUpQueue).toContain('test_followup');
    expect(result!.corruptionChange).toBe(2);
  });

  // ── resultKey branch reporting (#421) ────────────────────────────────────
  // The resolver must report which branch of a probabilistic consequence
  // actually fired, so the console/UI can look up the matching outcome
  // sentence: the plain `event.<id>.res<i>` key for the main branch, or
  // `event.<id>.res<i>_alt` when the alternate consequence fires instead.

  it('resultKey is the plain key (no _alt) for a non-probabilistic option', () => {
    const finances = createFinanceState(50000);
    const scores = createScoreState();
    const rng = new Random(42);

    const result = resolveEvent(eventSystem, finances, scores, 0, 10, rng);
    expect(result!.resultKey).toBe('event.test_resolve.res0');
  });

  it('resultKey appends _alt when the alternate consequence fires (probability 0 forces failure)', () => {
    const finances = createFinanceState(50000);
    const scores = createScoreState();
    const rng = new Random(42);

    const result = resolveEvent(eventSystem, finances, scores, 3, 10, rng);
    expect(result!.resultKey).toBe('event.test_resolve.res3_alt');
    // The alt consequence's own effects must be applied, not the main branch's.
    expect(result!.cashChange).toBe(-999);
    expect(finances.cash).toBe(50000 - 999);
  });

  it('resultKey stays plain when a probabilistic option succeeds (probability 1.0 forces success)', () => {
    const finances = createFinanceState(50000);
    const scores = createScoreState();
    const rng = new Random(42);

    const result = resolveEvent(eventSystem, finances, scores, 4, 10, rng);
    expect(result!.resultKey).toBe('event.test_resolve.res4');
    expect(result!.cashChange).toBe(200);
    expect(finances.cash).toBe(50200);
  });
});
