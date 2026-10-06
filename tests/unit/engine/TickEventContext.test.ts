// BlastSimulator2026 — Unit tests: buildTickEventContext (#1086)
//
// Core-owned relocation of src/console/commands/eventResolution.ts's
// buildEventContext, now the tick pipeline's own live code path (runTick
// calls this, not the console-only original). Mirrors that original's own
// regression test (tests/unit/console/events-command.test.ts, #592):
// employeeCount used to read state.employees.employees.length unfiltered —
// killEmployee never splices the roster, only flips alive:false, so a
// corpse permanently inflated the count fed to every event's canFire/
// weightCoeff check.

import { describe, it, expect } from 'vitest';
import { buildTickEventContext } from '../../../src/core/engine/TickEventContext.js';
import { createGame } from '../../../src/core/state/GameState.js';
import { Random } from '../../../src/core/math/Random.js';
import { ALL_WEATHER_STATES } from '../../../src/core/weather/WeatherCycle.js';
import { setupEvents } from '../../../src/core/events/index.js';
import { hireEmployee, killEmployee } from '../../../src/core/entities/Employee.js';

import { getEventById, registerEvents } from '../../../src/core/events/EventPool.js';
import { LAWSUIT_EVENTS_1 } from '../../../src/core/events/LawsuitEvents1.js';

const SEED = 42;

describe('buildTickEventContext', () => {
  it('reports employeeCount over the living roster only, excluding a killed employee still physically present in the array', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    hireEmployee(state.employees, 'driller', rng, 0, 0);
    const { employee: toKill } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    hireEmployee(state.employees, 'driller', rng, 0, 0);
    killEmployee(state.employees, toKill.id);

    // killEmployee only flips alive:false — the roster still physically
    // holds all 3 entries.
    expect(state.employees.employees).toHaveLength(3);

    const ctx = buildTickEventContext(state);

    expect(ctx.employeeCount).toBe(2);
  });

  it('builds every other field from the current GameState', () => {
    const state = createGame({ seed: SEED });
    state.damage.deathCount = 2;
    state.corruption.level = 7;
    state.buildings.buildings.push({
      id: state.buildings.nextId++,
      type: 'living_quarters',
      tier: 1,
      x: 0, z: 0,
      hp: 100,
      active: true,
      occupantIds: [],
    });
    state.drillHoles.push({ id: 'h1', x: 0, z: 0, depth: 5, diameter: 0.1 });
    state.tickCount = 42;
    if (!getEventById('lawsuit_wrongful_death')) registerEvents([LAWSUIT_EVENTS_1[0]!]);
    state.events.firedEventIds.push('lawsuit_wrongful_death', 'not_a_registered_event');
    state.contracts.active.push({
      id: 1, type: 'ore_sale', materialId: 'iron', description: '', quantityKg: 100,
      deliveredKg: 0, pricePerKg: 5, deadlineTicks: 100, acceptedAtTick: 0,
      penaltyAmount: 0, earlyBonus: 0, completed: false, expired: false,
    });

    const ctx = buildTickEventContext(state);

    expect(ctx.deathCount).toBe(2);
    expect(ctx.corruptionLevel).toBe(7);
    expect(ctx.hasBuilding('living_quarters')).toBe(true);
    expect(ctx.hasBuilding('freight_warehouse')).toBe(false);
    expect(ctx.hasDrillPlan).toBe(true);
    expect(ctx.tickCount).toBe(42);
    // one registered lawsuit id fired; the unregistered id is ignored (#1412)
    expect(ctx.lawsuitCount).toBe(1);
    expect(ctx.activeContractCount).toBe(1);
    expect(ctx.weatherId).toBe(state.weather.current);
    expect(ctx.scores).toBe(state.scores);
  });
});

describe('buildTickEventContext weatherId (#1403)', () => {
  it.each(ALL_WEATHER_STATES)('reports %s from state.weather.current', (weather) => {
    const state = createGame({ seed: SEED });
    state.weather.current = weather;
    expect(buildTickEventContext(state).weatherId).toBe(weather);
  });

  it('never reports the placeholder "clear"', () => {
    const state = createGame({ seed: SEED });
    for (const weather of ALL_WEATHER_STATES) {
      state.weather.current = weather;
      expect(buildTickEventContext(state).weatherId).not.toBe('clear');
    }
  });
});

describe('buildTickEventContext lawsuitCount (#1412)', () => {
  it('is 0 when no event has fired', () => {
    const state = createGame({ seed: SEED });
    expect(buildTickEventContext(state).lawsuitCount).toBe(0);
  });

  it('counts fired event ids whose category is lawsuit', () => {
    const state = createGame({ seed: SEED });
    setupEvents();
    state.events.firedEventIds = ['lawsuit_dust_fashion', 'lawsuit_wrongful_death'];
    expect(buildTickEventContext(state).lawsuitCount).toBe(2);
  });

  it('excludes non-lawsuit and unknown ids', () => {
    const state = createGame({ seed: SEED });
    setupEvents();
    state.events.firedEventIds = ['lawsuit_dust_fashion', 'union_coffee_uprising', 'no_such_event'];
    expect(buildTickEventContext(state).lawsuitCount).toBe(1);
  });

  it('ignores judge corruption attempts', () => {
    const state = createGame({ seed: SEED });
    setupEvents();
    state.corruption.attempts.push({ target: 'judge', tick: 1, cost: 0, success: true });
    state.corruption.attempts.push({ target: 'judge', tick: 2, cost: 0, success: false });
    expect(buildTickEventContext(state).lawsuitCount).toBe(0);
  });
});

describe('buildTickEventContext hasBlasted (#1412)', () => {
  it('is false when no blast has happened', () => {
    const state = createGame({ seed: SEED });
    state.damage.blastCount = 0;
    expect(buildTickEventContext(state).hasBlasted).toBe(false);
  });

  it('is true after one blast', () => {
    const state = createGame({ seed: SEED });
    state.damage.blastCount = 1;
    expect(buildTickEventContext(state).hasBlasted).toBe(true);
  });

  it('is true after many blasts', () => {
    const state = createGame({ seed: SEED });
    state.damage.blastCount = 7;
    expect(buildTickEventContext(state).hasBlasted).toBe(true);
  });
});
