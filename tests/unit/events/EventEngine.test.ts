// BlastSimulator2026 — Tests for EventEngine detectTrafficJam (Task 2.8)

import { describe, it, expect, beforeEach } from 'vitest';
import {
  detectTrafficJam,
  detectOreReport,
  TRAFFIC_JAM_MIN_TICKS,
} from '../../../src/core/events/EventEngine.js';
import { AGENT_OCCUPANCY_WAIT_TICKS } from '../../../src/core/config/balance.js';
import {
  createEventSystemState,
  type EventSystemState,
} from '../../../src/core/events/EventSystem.js';
import type { Employee, EmployeeState } from '../../../src/core/entities/Employee.js';
import { createEmployeeState, hireEmployee } from '../../../src/core/entities/Employee.js';
import type { BuiltRamp } from '../../../src/core/state/GameState.js';
import { findTrafficJams } from '../../../src/core/events/TrafficJams.js';
import { rampFootprint } from '../../../src/core/mining/RampWidening.js';
import { Random } from '../../../src/core/math/Random.js';
import { clearEvents, getEventById } from '../../../src/core/events/EventPool.js';
import { setupEvents } from '../../../src/core/events/index.js';

// ── detectTrafficJam ─────────────────────────────────────────────────────────

/** A ramp whose footprint is x 19..21, z 10..19. */
function jamRamp(): BuiltRamp {
  const def = { originX: 20, originZ: 10, direction: 'south' as const, length: 10, width: 3 as const, targetDepth: 5 };
  return { id: 1, def, width: 3, footprint: rampFootprint(def, 3) };
}

/** A stuck (waiting >= threshold) agent standing at (x, z), on foot or driving. */
function makeStuckAgent(es: EmployeeState, x: number, z: number, drive = false, ticks = TRAFFIC_JAM_MIN_TICKS): Employee {
  const { employee } = hireEmployee(es, 'driller', new Random(es.nextId), x, z);
  employee.x = x;
  employee.z = z;
  employee.vehicleWaitingTicks = ticks;
  employee.itinerary = {
    legs: [{
      mode: drive ? 'drive' : 'foot', ...(drive ? { vehicleId: employee.id } : {}),
      destX: 40, destZ: 40, arrival: 'exact', onArrive: { kind: 'none' }, estTicks: 5,
    }],
    goal: { kind: 'reposition', x: 40, z: 40 },
    workTicks: 0,
    estTotalTicks: 5,
  } as unknown as Employee['itinerary'];
  if (drive) employee.locomotion = { kind: 'mounted', vehicleId: employee.id };
  return employee;
}

describe('EventEngine — detectTrafficJam (#1208 chokepoints)', () => {
  let eventState: EventSystemState;
  let es: EmployeeState;

  beforeEach(() => {
    eventState = createEventSystemState();
    es = createEmployeeState();
  });

  const queue = (n: number, drive = false, z0 = 14.5): Employee[] =>
    Array.from({ length: n }, (_, i) => makeStuckAgent(es, 20.5, z0 + i * 0.5, drive));

  it('keeps TRAFFIC_JAM_MIN_TICKS strictly below AGENT_OCCUPANCY_WAIT_TICKS', () => {
    expect(TRAFFIC_JAM_MIN_TICKS).toBeLessThan(AGENT_OCCUPANCY_WAIT_TICKS);
  });

  it('returns null with no ramps and no employees', () => {
    expect(detectTrafficJam([], [], eventState, 100)).toBeNull();
  });

  it('returns null with only 2 stuck agents on a ramp', () => {
    expect(detectTrafficJam([jamRamp()], queue(2), eventState, 100)).toBeNull();
    expect(eventState.pendingEvent).toBeNull();
  });

  it('returns null when 3 agents have waited only TRAFFIC_JAM_MIN_TICKS - 1', () => {
    const agents = [14.5, 15.5, 16.5].map(z => makeStuckAgent(es, 20.5, z, true, TRAFFIC_JAM_MIN_TICKS - 1));
    expect(detectTrafficJam([jamRamp()], agents, eventState, 100)).toBeNull();
  });

  it('fires traffic_jam carrying the jam when 3 drivers queue on a ramp', () => {
    const result = detectTrafficJam([jamRamp()], queue(3, true), eventState, 42);
    expect(result).not.toBeNull();
    expect(result!.eventId).toBe('traffic_jam');
    expect(result!.firedAtTick).toBe(42);
    expect(result!.jam?.key).toBe('ramp:1');
    expect(result!.jam?.rampId).toBe(1);
    expect(result!.jam?.agentIds).toHaveLength(3);
  });

  it('sets state.pendingEvent (with the jam) when a jam is detected', () => {
    detectTrafficJam([jamRamp()], queue(3, true), eventState, 55);
    expect(eventState.pendingEvent).toEqual({
      eventId: 'traffic_jam', firedAtTick: 55, jam: expect.objectContaining({ key: 'ramp:1' }),
    });
  });

  it('a foot-only queue raises the event', () => {
    const result = detectTrafficJam([jamRamp()], queue(3, false), eventState, 7);
    expect(result?.eventId).toBe('traffic_jam');
    expect(result?.jam?.vehicleCount).toBe(0);
  });

  it('a passage jam away from any ramp is still found but raises no event', () => {
    const agents = [60.5, 61.5, 62.5].map(x => makeStuckAgent(es, x, 60.5));
    const jams = findTrafficJams([jamRamp()], agents, undefined, 9);
    expect(jams[0]?.kind).toBe('passage');
    expect(jams[0]?.rampId).toBeNull();
    expect(detectTrafficJam([jamRamp()], agents, eventState, 9)).toBeNull();
    expect(eventState.pendingEvent).toBeNull();
  });

  it('a 2+2 split across two ramps raises nothing', () => {
    const def2 = { originX: 50, originZ: 10, direction: 'south' as const, length: 10, width: 3 as const, targetDepth: 5 };
    const ramp2: BuiltRamp = { id: 2, def: def2, width: 3, footprint: rampFootprint(def2, 3) };
    const agents = [
      makeStuckAgent(es, 20.5, 14.5), makeStuckAgent(es, 20.5, 15.5),
      makeStuckAgent(es, 50.5, 14.5), makeStuckAgent(es, 50.5, 15.5),
    ];
    expect(detectTrafficJam([jamRamp(), ramp2], agents, eventState, 100)).toBeNull();
  });

  it('does not fire for a silenced jam key', () => {
    eventState.jamSilencedUntil['ramp:1'] = 500;
    expect(detectTrafficJam([jamRamp()], queue(3, true), eventState, 100)).toBeNull();
    expect(eventState.pendingEvent).toBeNull();
  });

  it('fires again once the silence has expired', () => {
    eventState.jamSilencedUntil['ramp:1'] = 100;
    expect(detectTrafficJam([jamRamp()], queue(3, true), eventState, 100)).not.toBeNull();
  });

  it('returns null without overwriting state.pendingEvent when an event is already pending', () => {
    const existingPending = { eventId: 'union_strike', firedAtTick: 90 };
    eventState.pendingEvent = existingPending;
    expect(detectTrafficJam([jamRamp()], queue(3, true), eventState, 100)).toBeNull();
    expect(eventState.pendingEvent).toBe(existingPending);
  });

  it('returns null when eventFreqMultiplier is 0 even with a qualifying jam', () => {
    eventState = createEventSystemState(0);
    expect(detectTrafficJam([jamRamp()], queue(3, true), eventState, 100)).toBeNull();
    expect(eventState.pendingEvent).toBeNull();
  });
});

// ── traffic_jam EventDef registration ────────────────────────────────────────

describe('EventPool — traffic_jam EventDef registration (Task 2.8)', () => {
  beforeEach(() => {
    clearEvents();
    setupEvents(); // must include TRAFFIC_JAM_EVENTS after implementation
  });

  it('traffic_jam event is retrievable from the pool after setupEvents()', () => {
    const event = getEventById('traffic_jam');
    expect(event).toBeDefined();
  });

  it('traffic_jam event has category "traffic"', () => {
    const event = getEventById('traffic_jam');
    expect(event!.category).toBe('traffic');
  });

  it('traffic_jam event has a non-empty titleKey', () => {
    const event = getEventById('traffic_jam');
    expect(typeof event!.titleKey).toBe('string');
    expect(event!.titleKey.length).toBeGreaterThan(0);
  });

  it('traffic_jam event has a non-empty descKey', () => {
    const event = getEventById('traffic_jam');
    expect(typeof event!.descKey).toBe('string');
    expect(event!.descKey.length).toBeGreaterThan(0);
  });

  it('traffic_jam event has at least 2 decision options', () => {
    const event = getEventById('traffic_jam');
    expect(event!.options.length).toBeGreaterThanOrEqual(2);
  });

  it('traffic_jam event has consequences for every option', () => {
    const event = getEventById('traffic_jam');
    expect(event!.consequences.length).toBe(event!.options.length);
  });
});

// ── detectOreReport ───────────────────────────────────────────────────────────

describe('EventEngine — detectOreReport (Task 4.8)', () => {
  let eventState: EventSystemState;

  beforeEach(() => {
    eventState = createEventSystemState();
  });

  // ── Test: no event when no condition is met ──

  it('returns null when no ore report condition is met', () => {
    const report = {
      oreYields: { dirtite: 500 },
      totalYieldKg: 500,
      estimatedYieldKg: 500,
      yieldRatio: 1.0,
      hasTreranium: false,
      absurdiumFraction: 0,
    };
    const result = detectOreReport(report, eventState, 100);
    expect(result).toBeNull();
  });

  // ── Test: Lucky Strike (yieldRatio > 1.2) ──

  it('fires lucky_strike when yieldRatio > 1.2', () => {
    const report = {
      oreYields: { dirtite: 1300 },
      totalYieldKg: 1300,
      estimatedYieldKg: 1000,
      yieldRatio: 1.3,
      hasTreranium: false,
      absurdiumFraction: 0,
    };
    const result = detectOreReport(report, eventState, 200);
    expect(result).not.toBeNull();
    expect(result!.eventId).toBe('lucky_strike');
    expect(result!.firedAtTick).toBe(200);
  });

  it('sets state.pendingEvent for lucky_strike', () => {
    const report = {
      oreYields: { rustite: 2500 },
      totalYieldKg: 2500,
      estimatedYieldKg: 1800,
      yieldRatio: 1.39,
      hasTreranium: false,
      absurdiumFraction: 0,
    };
    detectOreReport(report, eventState, 50);
    expect(eventState.pendingEvent).not.toBeNull();
    expect(eventState.pendingEvent!.eventId).toBe('lucky_strike');
  });

  // ── Test: Barren Blast (yieldRatio < 0.5) ──

  it('fires barren_blast when yieldRatio < 0.5', () => {
    const report = {
      oreYields: { dirtite: 200 },
      totalYieldKg: 200,
      estimatedYieldKg: 600,
      yieldRatio: 0.33,
      hasTreranium: false,
      absurdiumFraction: 0,
    };
    const result = detectOreReport(report, eventState, 300);
    expect(result).not.toBeNull();
    expect(result!.eventId).toBe('barren_blast');
  });

  // ── Test: Legendary Vein (hasTreranium) — highest priority ──

  it('fires legendary_vein when hasTreranium is true (overrides other conditions)', () => {
    const report = {
      oreYields: { treranium: 10, dirtite: 100 },
      totalYieldKg: 110,
      estimatedYieldKg: 100,
      yieldRatio: 1.1,
      hasTreranium: true,
      absurdiumFraction: 0,
    };
    const result = detectOreReport(report, eventState, 400);
    expect(result).not.toBeNull();
    expect(result!.eventId).toBe('legendary_vein');
  });

  // ── Test: Absurdium Jackpot (absurdiumFraction > 0.3) ──

  it('fires absurdium_jackpot when absurdiumFraction >= threshold', () => {
    const report = {
      oreYields: { absurdium: 400, dirtite: 600 },
      totalYieldKg: 1000,
      estimatedYieldKg: 1000,
      yieldRatio: 1.0,
      hasTreranium: false,
      absurdiumFraction: 0.4,
    };
    const result = detectOreReport(report, eventState, 500);
    expect(result).not.toBeNull();
    expect(result!.eventId).toBe('absurdium_jackpot');
  });

  // ── Test: legendary_vein overrides absurdium_jackpot ──

  it('legendary_vein fires instead of absurdium_jackpot when both conditions are true', () => {
    const report = {
      oreYields: { treranium: 5, absurdium: 400, dirtite: 600 },
      totalYieldKg: 1005,
      estimatedYieldKg: 1000,
      yieldRatio: 1.005,
      hasTreranium: true,
      absurdiumFraction: 0.4,
    };
    const result = detectOreReport(report, eventState, 600);
    expect(result).not.toBeNull();
    expect(result!.eventId).toBe('legendary_vein');
  });

  // ── Test: already pending event — no double-fire ──

  it('returns null when an event is already pending', () => {
    eventState.pendingEvent = { eventId: 'union_strike', firedAtTick: 700 };
    const report = {
      oreYields: { dirtite: 1300 },
      totalYieldKg: 1300,
      estimatedYieldKg: 1000,
      yieldRatio: 1.3,
      hasTreranium: false,
      absurdiumFraction: 0,
    };
    const result = detectOreReport(report, eventState, 800);
    expect(result).toBeNull();
    expect(eventState.pendingEvent!.eventId).toBe('union_strike');
  });

  // ── eventFreqMultiplier = 0 suppression ──

  it('returns null when eventFreqMultiplier is 0 even with qualifying ore report', () => {
    eventState = createEventSystemState(0);
    const report = {
      oreYields: { dirtite: 1300 },
      totalYieldKg: 1300,
      estimatedYieldKg: 1000,
      yieldRatio: 1.3,
      hasTreranium: false,
      absurdiumFraction: 0,
    };
    const result = detectOreReport(report, eventState, 200);
    expect(result).toBeNull();
    expect(eventState.pendingEvent).toBeNull();
  });
});

// ── Ore report EventDef registration ──────────────────────────────────────────

describe('EventPool — ore report EventDef registration (Task 4.8)', () => {
  beforeEach(() => {
    clearEvents();
    setupEvents();
  });

  const eventIds = ['lucky_strike', 'barren_blast', 'legendary_vein', 'absurdium_jackpot'];

  for (const eventId of eventIds) {
    it(`${eventId} event is retrievable from the pool after setupEvents()`, () => {
      const event = getEventById(eventId);
      expect(event).toBeDefined();
    });

    it(`${eventId} event has category "mining"`, () => {
      const event = getEventById(eventId);
      expect(event!.category).toBe('mining');
    });

    it(`${eventId} event has a non-empty titleKey`, () => {
      const event = getEventById(eventId);
      expect(typeof event!.titleKey).toBe('string');
      expect(event!.titleKey.length).toBeGreaterThan(0);
    });

    it(`${eventId} event has a non-empty descKey`, () => {
      const event = getEventById(eventId);
      expect(typeof event!.descKey).toBe('string');
      expect(event!.descKey.length).toBeGreaterThan(0);
    });

    it(`${eventId} event has at least 2 decision options`, () => {
      const event = getEventById(eventId);
      expect(event!.options.length).toBeGreaterThanOrEqual(2);
    });

    it(`${eventId} event has consequences for every option`, () => {
      const event = getEventById(eventId);
      expect(event!.consequences.length).toBe(event!.options.length);
    });
  }
});
