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
      { labelKey: 'event.test.opt0' },
      { labelKey: 'event.test.opt1' },
      { labelKey: 'event.test.opt2' },
    ],
    consequences: [
      { cashDelta: -5000, scoreDelta: { wellBeing: 10 } },
      { cashDelta: 0, scoreDelta: { wellBeing: -5 } },
      {
        cashDelta: -15000,
        corruptionDelta: 2,
        followUpEventId: 'test_followup',
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
});
