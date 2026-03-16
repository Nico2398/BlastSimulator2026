// BlastSimulator2026 — Tests for lawsuit event definitions (task 6.7)
// Verifies events trigger based on accident history, scale with severity, and resolve.

import { describe, it, expect, beforeEach } from 'vitest';
import { Random } from '../../../src/core/math/Random.js';
import { registerEvents, clearEvents, getEventsByCategory, getEventById, type EventContext } from '../../../src/core/events/EventPool.js';
import { LAWSUIT_EVENTS_1 } from '../../../src/core/events/LawsuitEvents1.js';
import { LAWSUIT_EVENTS_2 } from '../../../src/core/events/LawsuitEvents2.js';
import { createScoreState } from '../../../src/core/scores/ScoreManager.js';
import { createFinanceState } from '../../../src/core/economy/Finance.js';
import { createEventSystemState } from '../../../src/core/events/EventSystem.js';
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
    ...overrides,
  };
}

describe('Lawsuit events (6.7)', () => {
  beforeEach(() => {
    clearEvents();
    registerEvents(LAWSUIT_EVENTS_1);
    registerEvents(LAWSUIT_EVENTS_2);
  });

  it('at least 50 lawsuit events are registered', () => {
    const events = getEventsByCategory('lawsuit');
    expect(events.length).toBeGreaterThanOrEqual(50);
  });

  it('all lawsuit events have 2-4 options', () => {
    const events = getEventsByCategory('lawsuit');
    for (const e of events) {
      expect(e.options.length).toBeGreaterThanOrEqual(2);
      expect(e.options.length).toBeLessThanOrEqual(4);
      expect(e.consequences.length).toBe(e.options.length);
    }
  });

  it('wrongful death suit requires at least 1 death', () => {
    const ev = getEventById('lawsuit_wrongful_death')!;
    expect(ev).toBeDefined();

    expect(ev.canFire(makeCtx({ deathCount: 0 }))).toBe(false);
    expect(ev.canFire(makeCtx({ deathCount: 1 }))).toBe(true);
  });

  it('class action requires low safety and enough employees', () => {
    const ev = getEventById('lawsuit_class_action')!;
    expect(ev).toBeDefined();

    // Needs safety < 30 and >= 5 employees
    const safe = makeCtx({ scores: { ...createScoreState(), safety: 50 } });
    expect(ev.canFire(safe)).toBe(false);

    const dangerous = makeCtx({
      scores: { ...createScoreState(), safety: 20 },
      employeeCount: 10,
    });
    expect(ev.canFire(dangerous)).toBe(true);
  });

  it('wrongful death suit resolves with large financial consequences', () => {
    const ev = getEventById('lawsuit_wrongful_death')!;
    const eventSystem = createEventSystemState();
    eventSystem.pendingEvent = { eventId: ev.id, firedAtTick: 10 };
    const finances = createFinanceState(500000);
    const scores = createScoreState();
    const result = resolveEvent(eventSystem, finances, scores, 0, 10, new Random(42));

    expect(result).not.toBeNull();
    expect(result!.cashChange).toBe(-200000);
    expect(result!.success).toBe(true);
  });

  it('settlement/corruption decision options exist', () => {
    const ev = getEventById('lawsuit_wrongful_death')!;
    // Option 0: settle, Option 1: corruption/intimidation
    expect(ev.consequences[0]!.cashDelta).toBeLessThan(0); // settlement costs money
    expect(ev.consequences[1]!.corruptionDelta).toBeGreaterThan(0); // corrupt option
  });

  it('lawsuit weights increase with low scores (safety, nuisance, ecology)', () => {
    const events = getEventsByCategory('lawsuit');
    const badScores = { wellBeing: 10, safety: 10, ecology: 10, nuisance: 10 };
    const goodScores = { wellBeing: 90, safety: 90, ecology: 90, nuisance: 90 };

    // Most lawsuit events should be more likely when scores are low
    const moreWeightWhenBad = events.filter(
      e => e.weightCoeff(badScores) > e.weightCoeff(goodScores),
    );
    expect(moreWeightWhenBad.length).toBeGreaterThan(events.length / 2);
  });
});
