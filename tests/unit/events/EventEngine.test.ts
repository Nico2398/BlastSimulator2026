// BlastSimulator2026 — Tests for EventEngine detectTrafficJam (Task 2.8)

import { describe, it, expect, beforeEach } from 'vitest';
import {
  detectTrafficJam,
  detectOreReport,
  computeTrafficAdvisory,
  TRAFFIC_JAM_MIN_VEHICLES,
  TRAFFIC_JAM_MIN_TICKS,
} from '../../../src/core/events/EventEngine.js';
import {
  createEventSystemState,
  type EventSystemState,
} from '../../../src/core/events/EventSystem.js';
import type { Vehicle } from '../../../src/core/entities/Vehicle.js';
import type { Employee } from '../../../src/core/entities/Employee.js';
import { createEmployeeState, hireEmployee } from '../../../src/core/entities/Employee.js';
import { Random } from '../../../src/core/math/Random.js';
import { clearEvents, getEventById } from '../../../src/core/events/EventPool.js';
import { setupEvents } from '../../../src/core/events/index.js';

// ── Fixture builder ──────────────────────────────────────────────────────────

let _nextId = 1;

/**
 * #1138: a vehicle carries no state/waitingTicks/targetX/targetZ of its own
 * any more — detectTrafficJam/computeTrafficAdvisory now cluster on the
 * DRIVING EMPLOYEE's own `vehicleWaitingTicks` and current drive leg's
 * destX/destZ (EventEngine.ts's buildWaitingByTarget). Builds a
 * (vehicle, employee) pair: the employee is the occupant driving toward
 * (targetX, targetZ), waiting `waitingTicks` ticks so far.
 */
function makeWaitingVehicleAndDriver(
  targetX: number,
  targetZ: number,
  waitingTicks: number,
): { vehicle: Vehicle; employee: Employee } {
  const id = _nextId++;
  const employees = createEmployeeState();
  const { employee } = hireEmployee(employees, 'driller', new Random(id), targetX - 1, targetZ);
  // Each pair builds its own throwaway EmployeeState (ids always start at 1),
  // so employee.id must be forced unique across pairs before the vehicle and
  // employee are combined into one shared list — otherwise resolveVehicleDriver's
  // `employees.find(e => e.id === driverId)` matches the wrong employee object.
  employee.id = id;
  employee.vehicleWaitingTicks = waitingTicks;
  employee.itinerary = {
    legs: [{
      mode: 'drive', vehicleId: id, destX: targetX, destZ: targetZ,
      arrival: 'exact', onArrive: { kind: 'alight' }, estTicks: 5,
    }],
    goal: { kind: 'reposition', x: targetX, z: targetZ },
    workTicks: 0,
    estTotalTicks: 5,
  };

  const vehicle: Vehicle = {
    id, type: 'debris_hauler', tier: 1, x: targetX - 1, z: targetZ, hp: 100,
    payload: null,
    occupantIds: [employee.id],
  };
  return { vehicle, employee };
}

/** Splits an array of (vehicle, employee) pairs into two parallel arrays. */
function split(pairs: Array<{ vehicle: Vehicle; employee: Employee }>): { vehicles: Vehicle[]; employees: Employee[] } {
  return { vehicles: pairs.map(p => p.vehicle), employees: pairs.map(p => p.employee) };
}

/** A driverless vehicle — occupantIds empty, never a driving employee to read waiting-state off. */
function makeDriverlessVehicle(x: number, z: number): Vehicle {
  return { id: _nextId++, type: 'debris_hauler', tier: 1, x, z, hp: 100, payload: null, occupantIds: [] };
}

// ── detectTrafficJam ─────────────────────────────────────────────────────────

describe('EventEngine — detectTrafficJam (Task 2.8)', () => {
  let eventState: EventSystemState;

  beforeEach(() => {
    _nextId = 1;
    eventState = createEventSystemState();
  });

  // ── Exported constants ──

  it('exports TRAFFIC_JAM_MIN_VEHICLES constant equal to 3', () => {
    expect(TRAFFIC_JAM_MIN_VEHICLES).toBe(3);
  });

  it('exports TRAFFIC_JAM_MIN_TICKS constant equal to 10', () => {
    expect(TRAFFIC_JAM_MIN_TICKS).toBe(10);
  });

  // ── Test 1: empty fleet ──

  it('returns null when the vehicle list is empty', () => {
    const result = detectTrafficJam([], [], eventState, 100);
    expect(result).toBeNull();
  });

  // ── Test 2: below vehicle count threshold ──

  it('returns null when only 2 vehicles share the same target and have each waited ≥10 ticks', () => {
    const { vehicles, employees } = split([
      makeWaitingVehicleAndDriver(5, 5, 10),
      makeWaitingVehicleAndDriver(5, 5, 12),
    ]);
    const result = detectTrafficJam(vehicles, employees, eventState, 100);
    expect(result).toBeNull();
  });

  // ── Test 3: below tick threshold ──

  it('returns null when 3 vehicles share the same target but each has waited only 9 ticks', () => {
    const { vehicles, employees } = split([
      makeWaitingVehicleAndDriver(3, 3, 9),
      makeWaitingVehicleAndDriver(3, 3, 9),
      makeWaitingVehicleAndDriver(3, 3, 9),
    ]);
    const result = detectTrafficJam(vehicles, employees, eventState, 100);
    expect(result).toBeNull();
  });

  // ── Test 4: jam fires — return value AND state.pendingEvent ──

  it('returns a FiredEvent with eventId "traffic_jam" when ≥3 vehicles share a target with ≥10 waiting ticks each', () => {
    const { vehicles, employees } = split([
      makeWaitingVehicleAndDriver(7, 2, 10),
      makeWaitingVehicleAndDriver(7, 2, 12),
      makeWaitingVehicleAndDriver(7, 2, 15),
    ]);
    const result = detectTrafficJam(vehicles, employees, eventState, 42);

    expect(result).not.toBeNull();
    expect(result!.eventId).toBe('traffic_jam');
    expect(result!.firedAtTick).toBe(42);
  });

  it('sets state.pendingEvent when a traffic jam is detected', () => {
    const { vehicles, employees } = split([
      makeWaitingVehicleAndDriver(7, 2, 10),
      makeWaitingVehicleAndDriver(7, 2, 10),
      makeWaitingVehicleAndDriver(7, 2, 10),
    ]);
    detectTrafficJam(vehicles, employees, eventState, 55);

    expect(eventState.pendingEvent).not.toBeNull();
    expect(eventState.pendingEvent!.eventId).toBe('traffic_jam');
    expect(eventState.pendingEvent!.firedAtTick).toBe(55);
  });

  // ── Test 5: mixed tick counts — only 2 of 3 qualify ──

  it('returns null when exactly 3 vehicles share a target but only 2 of them have waited ≥10 ticks (one has 9)', () => {
    const { vehicles, employees } = split([
      makeWaitingVehicleAndDriver(4, 4, 9),  // below threshold — does NOT qualify
      makeWaitingVehicleAndDriver(4, 4, 10), // qualifies
      makeWaitingVehicleAndDriver(4, 4, 11), // qualifies — but total qualifiers = 2 < MIN_VEHICLES
    ]);
    const result = detectTrafficJam(vehicles, employees, eventState, 100);
    expect(result).toBeNull();
  });

  // ── Test 6: already pending event — no double-fire ──

  it('returns null without overwriting state.pendingEvent when an event is already pending', () => {
    const existingPending = { eventId: 'union_strike', firedAtTick: 90 };
    eventState.pendingEvent = existingPending;

    const { vehicles, employees } = split([
      makeWaitingVehicleAndDriver(2, 2, 10),
      makeWaitingVehicleAndDriver(2, 2, 10),
      makeWaitingVehicleAndDriver(2, 2, 10),
    ]);
    const result = detectTrafficJam(vehicles, employees, eventState, 100);

    expect(result).toBeNull();
    // The pre-existing pending event must not have been overwritten
    expect(eventState.pendingEvent).toBe(existingPending);
  });

  // ── Test 7: vehicles on different targets ──

  it('returns null when 3 vehicles are each waiting on a different target cell', () => {
    const { vehicles, employees } = split([
      makeWaitingVehicleAndDriver(1, 1, 10), // target (1, 1)
      makeWaitingVehicleAndDriver(2, 2, 10), // target (2, 2)
      makeWaitingVehicleAndDriver(3, 3, 10), // target (3, 3)
    ]);
    const result = detectTrafficJam(vehicles, employees, eventState, 100);
    expect(result).toBeNull();
  });

  // ── Test 8: 4 vehicles — threshold still met ──

  it('returns a FiredEvent when 4 vehicles all wait on the same target for ≥10 ticks (≥3 threshold satisfied)', () => {
    const { vehicles, employees } = split([
      makeWaitingVehicleAndDriver(6, 1, 10),
      makeWaitingVehicleAndDriver(6, 1, 11),
      makeWaitingVehicleAndDriver(6, 1, 14),
      makeWaitingVehicleAndDriver(6, 1, 20),
    ]);
    const result = detectTrafficJam(vehicles, employees, eventState, 200);

    expect(result).not.toBeNull();
    expect(result!.eventId).toBe('traffic_jam');
  });

  // ── Edge: vehicles with no waiting driver are excluded from the count ──

  it('ignores a driverless vehicle even if it sits on the shared target', () => {
    // Two genuinely waiting, one driverless bystander sharing the same cell.
    const { vehicles, employees } = split([
      makeWaitingVehicleAndDriver(8, 0, 10), // waiting — qualifies
      makeWaitingVehicleAndDriver(8, 0, 10), // waiting — qualifies
    ]);
    vehicles.push(makeDriverlessVehicle(8, 0));
    // Only 2 waiting vehicles qualify — below MIN_VEHICLES=3
    const result = detectTrafficJam(vehicles, employees, eventState, 100);
    expect(result).toBeNull();
  });

  it('ignores a driving employee whose current leg is not a drive leg', () => {
    const { vehicles, employees } = split([
      makeWaitingVehicleAndDriver(9, 0, 10),
      makeWaitingVehicleAndDriver(9, 0, 10),
    ]);
    const { vehicle: thirdVehicle, employee: thirdEmployee } = makeWaitingVehicleAndDriver(9, 0, 10);
    thirdEmployee.itinerary!.legs[0]!.mode = 'foot';
    vehicles.push(thirdVehicle);
    employees.push(thirdEmployee);

    const result = detectTrafficJam(vehicles, employees, eventState, 100);
    expect(result).toBeNull();
  });

  // ── eventFreqMultiplier = 0 suppression ──

  it('returns null when eventFreqMultiplier is 0 even with qualifying vehicles', () => {
    eventState = createEventSystemState(0);
    const { vehicles, employees } = split([
      makeWaitingVehicleAndDriver(5, 5, 15),
      makeWaitingVehicleAndDriver(5, 5, 15),
      makeWaitingVehicleAndDriver(5, 5, 15),
    ]);
    const result = detectTrafficJam(vehicles, employees, eventState, 100);
    expect(result).toBeNull();
    expect(eventState.pendingEvent).toBeNull();
  });

  // ── issue #591: a single occupancy-stuck vehicle is not a traffic jam ─────
  // #1138: isMoveStuck now lives on the driving Employee, not the vehicle —
  // detectTrafficJam stays keyed on vehicleWaitingTicks alone, unaffected by
  // isMoveStuck. TRAFFIC_JAM_MIN_VEHICLES still requires 3+ vehicles sharing a
  // target, regardless of any one of them being individually stuck.

  it('does not fire for a single stuck (isMoveStuck) vehicle, however long it has waited', () => {
    const { vehicle, employee } = makeWaitingVehicleAndDriver(5, 5, 500);
    employee.isMoveStuck = true;
    const result = detectTrafficJam([vehicle], [employee], eventState, 100);
    expect(result).toBeNull();
    expect(eventState.pendingEvent).toBeNull();
  });

  it('still requires 3+ vehicles even when 2 of them are individually stuck', () => {
    const { vehicles, employees } = split([
      makeWaitingVehicleAndDriver(5, 5, 50),
      makeWaitingVehicleAndDriver(5, 5, 50),
    ]);
    employees[0]!.isMoveStuck = true;
    employees[1]!.isMoveStuck = true;
    const result = detectTrafficJam(vehicles, employees, eventState, 100);
    expect(result).toBeNull();
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

// ── computeTrafficAdvisory ───────────────────────────────────────────────────

describe('EventEngine — computeTrafficAdvisory', () => {
  beforeEach(() => { _nextId = 1; });

  it('reports nothing with no waiting vehicles', () => {
    expect(computeTrafficAdvisory([], [])).toEqual([]);
  });

  it('reports nothing below MIN_VEHICLES on the same target', () => {
    const { vehicles, employees } = split([
      makeWaitingVehicleAndDriver(10, 10, TRAFFIC_JAM_MIN_TICKS),
      makeWaitingVehicleAndDriver(10, 10, TRAFFIC_JAM_MIN_TICKS),
    ]);
    expect(computeTrafficAdvisory(vehicles, employees)).toEqual([]);
  });

  it('reports nothing below MIN_TICKS even with enough vehicles', () => {
    const { vehicles, employees } = split(
      Array.from({ length: TRAFFIC_JAM_MIN_VEHICLES }, () =>
        makeWaitingVehicleAndDriver(10, 10, TRAFFIC_JAM_MIN_TICKS - 1)),
    );
    expect(computeTrafficAdvisory(vehicles, employees)).toEqual([]);
  });

  it('reports a cluster once both thresholds are met', () => {
    const { vehicles, employees } = split(
      Array.from({ length: TRAFFIC_JAM_MIN_VEHICLES }, () =>
        makeWaitingVehicleAndDriver(10, 10, TRAFFIC_JAM_MIN_TICKS)),
    );
    expect(computeTrafficAdvisory(vehicles, employees)).toEqual([{ targetX: 10, targetZ: 10, count: TRAFFIC_JAM_MIN_VEHICLES }]);
  });

  it('keeps separate targets as separate clusters', () => {
    const { vehicles, employees } = split([
      ...Array.from({ length: TRAFFIC_JAM_MIN_VEHICLES }, () => makeWaitingVehicleAndDriver(10, 10, TRAFFIC_JAM_MIN_TICKS)),
      ...Array.from({ length: TRAFFIC_JAM_MIN_VEHICLES }, () => makeWaitingVehicleAndDriver(20, 20, TRAFFIC_JAM_MIN_TICKS)),
    ]);
    const result = computeTrafficAdvisory(vehicles, employees);
    expect(result).toHaveLength(2);
    expect(result.map(r => r.count)).toEqual([TRAFFIC_JAM_MIN_VEHICLES, TRAFFIC_JAM_MIN_VEHICLES]);
  });

  it('is read-only — never touches EventSystemState, unlike detectTrafficJam', () => {
    // No EventSystemState is even passed in — this is the whole point: the
    // banner must work independent of pendingEvent/eventFreqMultiplier gating.
    const { vehicles, employees } = split(
      Array.from({ length: TRAFFIC_JAM_MIN_VEHICLES }, () =>
        makeWaitingVehicleAndDriver(10, 10, TRAFFIC_JAM_MIN_TICKS)),
    );
    expect(() => computeTrafficAdvisory(vehicles, employees)).not.toThrow();
  });

  it('ignores a driverless vehicle even if it sits on the shared target', () => {
    const { vehicles, employees } = split(
      Array.from({ length: TRAFFIC_JAM_MIN_VEHICLES }, () => makeWaitingVehicleAndDriver(10, 10, TRAFFIC_JAM_MIN_TICKS)),
    );
    vehicles.push(makeDriverlessVehicle(10, 10));
    expect(computeTrafficAdvisory(vehicles, employees)).toEqual([{ targetX: 10, targetZ: 10, count: TRAFFIC_JAM_MIN_VEHICLES }]);
  });
});
