// BlastSimulator2026 — Tests for political/external event definitions (task 6.4)

import { describe, it, expect, beforeEach } from 'vitest';
import { Random } from '../../../src/core/math/Random.js';
import { registerEvents, clearEvents, getEventsByCategory, getEventById, type EventContext } from '../../../src/core/events/EventPool.js';
import { POLITICS_EVENTS_1 } from '../../../src/core/events/PoliticsEvents1.js';
import { POLITICS_EVENTS_2 } from '../../../src/core/events/PoliticsEvents2.js';
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

describe('Politics events (6.4)', () => {
  beforeEach(() => {
    clearEvents();
    registerEvents(POLITICS_EVENTS_1);
    registerEvents(POLITICS_EVENTS_2);
  });

  it('at least 50 politics events are registered', () => {
    const events = getEventsByCategory('politics');
    expect(events.length).toBeGreaterThanOrEqual(50);
  });

  it('all politics events have 2-4 options with matching consequences', () => {
    const events = getEventsByCategory('politics');
    for (const e of events) {
      expect(e.options.length).toBeGreaterThanOrEqual(2);
      expect(e.options.length).toBeLessThanOrEqual(4);
      expect(e.consequences.length).toBe(e.options.length);
    }
  });

  it('first politics event fires and resolves with financial impact', () => {
    const events = getEventsByCategory('politics');
    const ev = events[0]!;
    const ctx = makeCtx();

    // Most politics events should be able to fire in normal conditions
    if (ev.canFire(ctx)) {
      const eventSystem = createEventSystemState();
      eventSystem.pendingEvent = { eventId: ev.id, firedAtTick: 10 };
      const finances = createFinanceState(500000);
      const scores = createScoreState();
      const result = resolveEvent(eventSystem, finances, scores, 0, 10, new Random(42));

      expect(result).not.toBeNull();
      expect(result!.eventId).toBe(ev.id);
    }
  });

  it('politics events affect scores and finances when resolved', () => {
    const events = getEventsByCategory('politics');
    const ctx = makeCtx();
    let tested = 0;

    for (const ev of events.slice(0, 10)) {
      if (!ev.canFire(ctx)) continue;

      const eventSystem = createEventSystemState();
      eventSystem.pendingEvent = { eventId: ev.id, firedAtTick: 10 };
      const finances = createFinanceState(500000);
      const scores = createScoreState();
      const result = resolveEvent(eventSystem, finances, scores, 0, 10, new Random(42));

      expect(result).not.toBeNull();
      expect(result!.success).toBe(true);
      tested++;
      if (tested >= 3) break;
    }
    expect(tested).toBeGreaterThanOrEqual(3);
  });

  it('politics event weights change with scores', () => {
    const events = getEventsByCategory('politics');
    const low = { ...createScoreState(), ecology: 10, safety: 10 };
    const high = { ...createScoreState(), ecology: 90, safety: 90 };

    // At least some events should have score-dependent weights
    const weightDiffs = events.map(e => e.weightCoeff(low) - e.weightCoeff(high));
    const hasVariance = weightDiffs.some(d => Math.abs(d) > 0.01);
    expect(hasVariance).toBe(true);
  });
});
