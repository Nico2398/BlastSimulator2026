// BlastSimulator2026 — The lightning strike event was only about the magazine; it is retired (#2154)

import { describe, it, expect, beforeEach } from 'vitest';
import { registerEvents, clearEvents, getAllEvents, getEventById } from '../../../src/core/events/EventPool.js';
import { WEATHER_EVENTS_1 } from '../../../src/core/events/WeatherEvents1.js';
import { WEATHER_EVENTS_2 } from '../../../src/core/events/WeatherEvents2.js';

describe('weather_lightning_strike is retired (#2154)', () => {
  beforeEach(() => {
    clearEvents();
    registerEvents(WEATHER_EVENTS_1);
    registerEvents(WEATHER_EVENTS_2);
  });

  it('is not in the WEATHER_EVENTS_1 table', () => {
    expect(WEATHER_EVENTS_1.map((e) => e.id)).not.toContain('weather_lightning_strike');
  });

  it('is not registered', () => {
    expect(getEventById('weather_lightning_strike')).toBeUndefined();
    expect(getAllEvents().map((e) => e.id)).not.toContain('weather_lightning_strike');
  });

  it('no remaining weather event asks for the explosive warehouse', () => {
    const seen: string[] = [];
    const ctx = {
      scores: { wellBeing: 50, safety: 50, ecology: 50, nuisance: 50 },
      employeeCount: 10, deathCount: 0, corruptionLevel: 0, hasDrillPlan: false, tickCount: 100,
      lawsuitCount: 0, activeContractCount: 0, weatherId: 'storm', hasBlasted: false,
      hasBuilding: (type: string) => { seen.push(type); return true; },
    };
    for (const e of getAllEvents()) {
      try { e.canFire(ctx as unknown as Parameters<typeof e.canFire>[0]); } catch { /* unrelated to this check */ }
    }
    expect(seen).not.toContain('explosive_warehouse');
  });

  it('keeps the other storm events', () => {
    expect(getEventById('weather_pit_flood')).toBeDefined();
  });
});
