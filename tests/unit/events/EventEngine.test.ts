// BlastSimulator2026 — Tests for EventEngine detectTrafficJam (Task 2.8)
//                      and detectUnqualifiedTask (Task 3.7)

import { describe, it, expect, beforeEach } from 'vitest';
import {
  detectTrafficJam,
  TRAFFIC_JAM_MIN_VEHICLES,
  TRAFFIC_JAM_MIN_TICKS,
  detectUnqualifiedTask,
} from '../../../src/core/events/EventEngine.js';
import {
  createEventSystemState,
  type EventSystemState,
} from '../../../src/core/events/EventSystem.js';
import type { Vehicle } from '../../../src/core/entities/Vehicle.js';
import { clearEvents, getEventById } from '../../../src/core/events/EventPool.js';
import { setupEvents } from '../../../src/core/events/index.js';

// ── Fixture builder ──────────────────────────────────────────────────────────

let _nextId = 1;

/**
 * Build a minimal Vehicle fixture that is already in the `waiting` state,
 * with a caller-supplied `waitingTicks` count and a fixed `targetX/targetZ`.
 */
function makeWaitingVehicle(
  targetX: number,
  targetZ: number,
  waitingTicks: number,
): Vehicle {
  return {
    id: _nextId++,
    type: 'debris_hauler',
    x: targetX - 1,
    z: targetZ,
    hp: 100,
    task: 'moving',
    targetX,
    targetZ,
    driverId: null,
    state: 'waiting',
    payloadKg: 0,
    waitingTicks,
  };
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
    const result = detectTrafficJam([], eventState, 100);
    expect(result).toBeNull();
  });

  // ── Test 2: below vehicle count threshold ──

  it('returns null when only 2 vehicles share the same target and have each waited ≥10 ticks', () => {
    const vehicles: Vehicle[] = [
      makeWaitingVehicle(5, 5, 10),
      makeWaitingVehicle(5, 5, 12),
    ];
    const result = detectTrafficJam(vehicles, eventState, 100);
    expect(result).toBeNull();
  });

  // ── Test 3: below tick threshold ──

  it('returns null when 3 vehicles share the same target but each has waited only 9 ticks', () => {
    const vehicles: Vehicle[] = [
      makeWaitingVehicle(3, 3, 9),
      makeWaitingVehicle(3, 3, 9),
      makeWaitingVehicle(3, 3, 9),
    ];
    const result = detectTrafficJam(vehicles, eventState, 100);
    expect(result).toBeNull();
  });

  // ── Test 4: jam fires — return value AND state.pendingEvent ──

  it('returns a FiredEvent with eventId "traffic_jam" when ≥3 vehicles share a target with ≥10 waiting ticks each', () => {
    const vehicles: Vehicle[] = [
      makeWaitingVehicle(7, 2, 10),
      makeWaitingVehicle(7, 2, 12),
      makeWaitingVehicle(7, 2, 15),
    ];
    const result = detectTrafficJam(vehicles, eventState, 42);

    expect(result).not.toBeNull();
    expect(result!.eventId).toBe('traffic_jam');
    expect(result!.firedAtTick).toBe(42);
  });

  it('sets state.pendingEvent when a traffic jam is detected', () => {
    const vehicles: Vehicle[] = [
      makeWaitingVehicle(7, 2, 10),
      makeWaitingVehicle(7, 2, 10),
      makeWaitingVehicle(7, 2, 10),
    ];
    detectTrafficJam(vehicles, eventState, 55);

    expect(eventState.pendingEvent).not.toBeNull();
    expect(eventState.pendingEvent!.eventId).toBe('traffic_jam');
    expect(eventState.pendingEvent!.firedAtTick).toBe(55);
  });

  // ── Test 5: mixed tick counts — only 2 of 3 qualify ──

  it('returns null when exactly 3 vehicles share a target but only 2 of them have waited ≥10 ticks (one has 9)', () => {
    const vehicles: Vehicle[] = [
      makeWaitingVehicle(4, 4, 9),  // below threshold — does NOT qualify
      makeWaitingVehicle(4, 4, 10), // qualifies
      makeWaitingVehicle(4, 4, 11), // qualifies — but total qualifiers = 2 < MIN_VEHICLES
    ];
    const result = detectTrafficJam(vehicles, eventState, 100);
    expect(result).toBeNull();
  });

  // ── Test 6: already pending event — no double-fire ──

  it('returns null without overwriting state.pendingEvent when an event is already pending', () => {
    const existingPending = { eventId: 'union_strike', firedAtTick: 90 };
    eventState.pendingEvent = existingPending;

    const vehicles: Vehicle[] = [
      makeWaitingVehicle(2, 2, 10),
      makeWaitingVehicle(2, 2, 10),
      makeWaitingVehicle(2, 2, 10),
    ];
    const result = detectTrafficJam(vehicles, eventState, 100);

    expect(result).toBeNull();
    // The pre-existing pending event must not have been overwritten
    expect(eventState.pendingEvent).toBe(existingPending);
  });

  // ── Test 7: vehicles on different targets ──

  it('returns null when 3 vehicles are each waiting on a different target cell', () => {
    const vehicles: Vehicle[] = [
      makeWaitingVehicle(1, 1, 10), // target (1, 1)
      makeWaitingVehicle(2, 2, 10), // target (2, 2)
      makeWaitingVehicle(3, 3, 10), // target (3, 3)
    ];
    const result = detectTrafficJam(vehicles, eventState, 100);
    expect(result).toBeNull();
  });

  // ── Test 8: 4 vehicles — threshold still met ──

  it('returns a FiredEvent when 4 vehicles all wait on the same target for ≥10 ticks (≥3 threshold satisfied)', () => {
    const vehicles: Vehicle[] = [
      makeWaitingVehicle(6, 1, 10),
      makeWaitingVehicle(6, 1, 11),
      makeWaitingVehicle(6, 1, 14),
      makeWaitingVehicle(6, 1, 20),
    ];
    const result = detectTrafficJam(vehicles, eventState, 200);

    expect(result).not.toBeNull();
    expect(result!.eventId).toBe('traffic_jam');
  });

  // ── Edge: vehicles not in waiting state are excluded from the count ──

  it('ignores vehicles that are moving or idle even if they share the target', () => {
    // Two genuinely waiting, one that happens to share the target but is moving
    const movingBystander = {
      ...makeWaitingVehicle(8, 0, 10),
      state: 'moving' as const,
    };
    const vehicles: Vehicle[] = [
      makeWaitingVehicle(8, 0, 10), // waiting — qualifies
      makeWaitingVehicle(8, 0, 10), // waiting — qualifies
      movingBystander,
    ];
    // Only 2 waiting vehicles qualify — below MIN_VEHICLES=3
    const result = detectTrafficJam(vehicles, eventState, 100);
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

// ── detectUnqualifiedTask ─────────────────────────────────────────────────────

describe('EventEngine — detectUnqualifiedTask (Task 3.7)', () => {
  let eventState: EventSystemState;

  beforeEach(() => {
    eventState = createEventSystemState();
  });

  // ── Test 1: empty list → null ──

  it('returns null when unqualifiedActionIds is empty', () => {
    const result = detectUnqualifiedTask([], eventState, 10);
    expect(result).toBeNull();
  });

  // ── Test 2: already pending event → null ──

  it('returns null when an event is already pending', () => {
    eventState.pendingEvent = { eventId: 'traffic_jam', firedAtTick: 5 };
    const result = detectUnqualifiedTask([42], eventState, 20);
    expect(result).toBeNull();
  });

  // ── Test 3: fires with correct eventId ──

  it('returns a FiredEvent with eventId "unqualified_task_error" when unqualifiedActionIds is non-empty', () => {
    const result = detectUnqualifiedTask([7], eventState, 30);
    expect(result).not.toBeNull();
    expect(result!.eventId).toBe('unqualified_task_error');
  });

  // ── Test 4: sets state.pendingEvent ──

  it('sets state.pendingEvent when unqualifiedActionIds is non-empty', () => {
    detectUnqualifiedTask([3, 9], eventState, 50);
    expect(eventState.pendingEvent).not.toBeNull();
    expect(eventState.pendingEvent!.eventId).toBe('unqualified_task_error');
  });

  // ── Test 5: correct firedAtTick ──

  it('includes the correct firedAtTick in the returned FiredEvent', () => {
    const result = detectUnqualifiedTask([1], eventState, 77);
    expect(result).not.toBeNull();
    expect(result!.firedAtTick).toBe(77);
  });

  // ── Test 6: does not overwrite pre-existing pendingEvent ──

  it('returns null without overwriting state.pendingEvent when one already exists', () => {
    const existingPending = { eventId: 'union_strike', firedAtTick: 15 };
    eventState.pendingEvent = existingPending;

    const result = detectUnqualifiedTask([5, 8, 13], eventState, 99);

    expect(result).toBeNull();
    // The pre-existing pending event must not have been replaced
    expect(eventState.pendingEvent).toBe(existingPending);
  });
});

// ── unqualified_task_error EventDef registration ──────────────────────────────

describe('EventPool — unqualified_task_error EventDef registration (Task 3.7)', () => {
  beforeEach(() => {
    clearEvents();
    setupEvents(); // must include UNQUALIFIED_TASK_EVENTS after implementation
  });

  // ── Test 7: retrievable from pool ──

  it('unqualified_task_error event is retrievable from the pool after setupEvents()', () => {
    const event = getEventById('unqualified_task_error');
    expect(event).toBeDefined();
  });

  // ── Test 8: non-empty titleKey ──

  it('unqualified_task_error event has a non-empty titleKey', () => {
    const event = getEventById('unqualified_task_error');
    expect(typeof event!.titleKey).toBe('string');
    expect(event!.titleKey.length).toBeGreaterThan(0);
  });

  // ── Test 9: non-empty descKey ──

  it('unqualified_task_error event has a non-empty descKey', () => {
    const event = getEventById('unqualified_task_error');
    expect(typeof event!.descKey).toBe('string');
    expect(event!.descKey.length).toBeGreaterThan(0);
  });

  // ── Test 10: at least 2 options ──

  it('unqualified_task_error event has at least 2 decision options', () => {
    const event = getEventById('unqualified_task_error');
    expect(event!.options.length).toBeGreaterThanOrEqual(2);
  });

  // ── Test 11: consequences for every option ──

  it('unqualified_task_error event has consequences for every option', () => {
    const event = getEventById('unqualified_task_error');
    expect(event!.consequences.length).toBe(event!.options.length);
  });
});
