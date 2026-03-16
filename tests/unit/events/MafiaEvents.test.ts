// BlastSimulator2026 — Tests for mafia event definitions (task 6.6)
// Verifies corruption prerequisite, escalation, and resolution.

import { describe, it, expect, beforeEach } from 'vitest';
import { Random } from '../../../src/core/math/Random.js';
import { registerEvents, clearEvents, getEventsByCategory, getEventById, type EventContext } from '../../../src/core/events/EventPool.js';
import { MAFIA_EVENTS_1 } from '../../../src/core/events/MafiaEvents1.js';
import { MAFIA_EVENTS_2 } from '../../../src/core/events/MafiaEvents2.js';
import { createScoreState } from '../../../src/core/scores/ScoreManager.js';
import { createFinanceState } from '../../../src/core/economy/Finance.js';
import { createEventSystemState } from '../../../src/core/events/EventSystem.js';
import { resolveEvent } from '../../../src/core/events/EventResolver.js';
import { selectEvent } from '../../../src/core/events/EventSystem.js';

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

describe('Mafia events (6.6)', () => {
  beforeEach(() => {
    clearEvents();
    registerEvents(MAFIA_EVENTS_1);
    registerEvents(MAFIA_EVENTS_2);
  });

  it('at least 50 mafia events are registered', () => {
    const events = getEventsByCategory('mafia');
    expect(events.length).toBeGreaterThanOrEqual(50);
  });

  it('all mafia events have 2-4 options', () => {
    const events = getEventsByCategory('mafia');
    for (const e of events) {
      expect(e.options.length).toBeGreaterThanOrEqual(2);
      expect(e.options.length).toBeLessThanOrEqual(4);
      expect(e.consequences.length).toBe(e.options.length);
    }
  });

  it('mafia events do NOT fire without corruption prerequisite', () => {
    const ctx = makeCtx({ corruptionLevel: 0 });

    // No mafia event should fire with zero corruption
    for (let seed = 0; seed < 20; seed++) {
      const selected = selectEvent('mafia', ctx, new Random(seed));
      expect(selected).toBeNull();
    }
  });

  it('mafia events fire once corruption level is sufficient', () => {
    const ctx = makeCtx({ corruptionLevel: 5 });

    let fired = false;
    for (let seed = 0; seed < 50; seed++) {
      const selected = selectEvent('mafia', ctx, new Random(seed));
      if (selected) {
        fired = true;
        expect(selected.category).toBe('mafia');
        break;
      }
    }
    expect(fired).toBe(true);
  });

  it('protection racket event resolves with corruption increase', () => {
    const ev = getEventById('mafia_protection_racket')!;
    expect(ev).toBeDefined();

    const eventSystem = createEventSystemState();
    eventSystem.pendingEvent = { eventId: ev.id, firedAtTick: 10 };
    const finances = createFinanceState(100000);
    const scores = createScoreState();
    const result = resolveEvent(eventSystem, finances, scores, 0, 10, new Random(42));

    expect(result).not.toBeNull();
    expect(result!.cashChange).toBe(-5000);
    expect(result!.corruptionChange).toBe(5);
  });

  it('smuggling opportunity has risk/reward tradeoffs', () => {
    const ev = getEventById('mafia_smuggling_opportunity')!;
    expect(ev).toBeDefined();

    // Option 0: high reward + corruption
    expect(ev.consequences[0]!.cashDelta).toBeGreaterThan(0);
    expect(ev.consequences[0]!.corruptionDelta).toBeGreaterThan(0);

    // Option 1: safe/clean option
    expect(ev.consequences[1]!.cashDelta).toBe(0);
  });

  it('escalation: later events require higher corruption', () => {
    const events = getEventsByCategory('mafia');
    const lowCorrupt = makeCtx({ corruptionLevel: 1 });
    const highCorrupt = makeCtx({ corruptionLevel: 10 });

    const firesAtLow = events.filter(e => e.canFire(lowCorrupt)).length;
    const firesAtHigh = events.filter(e => e.canFire(highCorrupt)).length;

    // More events should be available at higher corruption
    expect(firesAtHigh).toBeGreaterThanOrEqual(firesAtLow);
  });
});
