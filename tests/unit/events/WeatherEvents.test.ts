// BlastSimulator2026 — Tests for weather event definitions (task 6.5)

import { describe, it, expect, beforeEach } from 'vitest';
import { Random } from '../../../src/core/math/Random.js';
import { registerEvents, clearEvents, getEventsByCategory, getEventById, type EventContext } from '../../../src/core/events/EventPool.js';
import { WEATHER_EVENTS_1 } from '../../../src/core/events/WeatherEvents1.js';
import { WEATHER_EVENTS_2 } from '../../../src/core/events/WeatherEvents2.js';
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

describe('Weather events (6.5)', () => {
  beforeEach(() => {
    clearEvents();
    registerEvents(WEATHER_EVENTS_1);
    registerEvents(WEATHER_EVENTS_2);
  });

  it('at least 50 weather events are registered', () => {
    const events = getEventsByCategory('weather');
    expect(events.length).toBeGreaterThanOrEqual(50);
  });

  it('all weather events have 2-4 options', () => {
    const events = getEventsByCategory('weather');
    for (const e of events) {
      expect(e.options.length).toBeGreaterThanOrEqual(2);
      expect(e.options.length).toBeLessThanOrEqual(4);
      expect(e.consequences.length).toBe(e.options.length);
    }
  });

  it('pit flood event is influenced by weather state (rain/storm)', () => {
    const ev = getEventById('weather_pit_flood')!;
    expect(ev).toBeDefined();

    // Only fires during heavy rain or storm
    expect(ev.canFire(makeCtx({ weatherId: 'sunny' }))).toBe(false);
    expect(ev.canFire(makeCtx({ weatherId: 'heavy_rain' }))).toBe(true);
    expect(ev.canFire(makeCtx({ weatherId: 'storm' }))).toBe(true);
  });

  it('lightning strike requires storm AND explosive warehouse', () => {
    const ev = getEventById('weather_lightning_strike')!;
    expect(ev).toBeDefined();

    expect(ev.canFire(makeCtx({ weatherId: 'sunny' }))).toBe(false);
    expect(ev.canFire(makeCtx({ weatherId: 'storm' }))).toBe(false); // no building
    expect(ev.canFire(makeCtx({
      weatherId: 'storm',
      hasBuilding: (t) => t === 'explosive_warehouse',
    }))).toBe(true);
  });

  it('heatstroke event resolves with financial and score effects', () => {
    const ev = getEventById('weather_heatstroke')!;
    expect(ev).toBeDefined();

    const eventSystem = createEventSystemState();
    eventSystem.pendingEvent = { eventId: ev.id, firedAtTick: 10 };
    const finances = createFinanceState(200000);
    const scores = createScoreState();
    const result = resolveEvent(eventSystem, finances, scores, 0, 10, new Random(42));

    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
    // Should have some effect (cash or scores)
    const hasEffect = result!.cashChange !== 0 ||
      Object.keys(result!.scoreChanges).length > 0;
    expect(hasEffect).toBe(true);
  });

  it('weather events with weather-dependent canFire exist', () => {
    const events = getEventsByCategory('weather');
    const stormCtx = makeCtx({ weatherId: 'storm', hasBuilding: () => true });
    const sunnyCtx = makeCtx({ weatherId: 'sunny', hasBuilding: () => true });

    // Some weather events should only fire in specific weather
    const stormOnly = events.filter(e => e.canFire(stormCtx) && !e.canFire(sunnyCtx));
    expect(stormOnly.length).toBeGreaterThan(0);
  });
});
