// BlastSimulator2026 — Tests for EventEngine detectUnqualifiedTask (Task 3.7)
//                      and unqualified_task_error EventDef registration

import { describe, it, expect, beforeEach } from 'vitest';
import { detectUnqualifiedTask } from '../../../src/core/events/EventEngine.js';
import {
  createEventSystemState,
  type EventSystemState,
} from '../../../src/core/events/EventSystem.js';
import { clearEvents, getEventById } from '../../../src/core/events/EventPool.js';
import { setupEvents } from '../../../src/core/events/index.js';

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
    setupEvents();
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
