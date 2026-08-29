// BlastSimulator2026 — Tests for evacuation-hold bookkeeping
// (src/core/engine/EvacuationHold.ts, #557 and its follow-up file-size split).

import { describe, it, expect } from 'vitest';
import { createGame } from '../../../src/core/state/GameState.js';
import type { PendingAction } from '../../../src/core/state/GameState.js';
import {
  isEvacuationHoldActive, clearResolvedEvacuationHolds, discardStaleRestAction, releaseInZoneTaskQueueEntries,
} from '../../../src/core/engine/EvacuationHold.js';
import type { ZoneBounds } from '../../../src/core/entities/Zone.js';
import { hireEmployee } from '../../../src/core/entities/Employee.js';
import { Random } from '../../../src/core/math/Random.js';

const EVACUATION_SEED = 42;
const holdZone: ZoneBounds = { x1: 10, z1: 10, x2: 20, z2: 20 };

function makeAction(overrides: Partial<PendingAction> & { id: number }): PendingAction {
  return {
    type: 'general_work',
    requiredSkill: null,
    requiredVehicleRole: null,
    targetX: 0, targetZ: 0, targetY: 0,
    payload: {},
    targetEmployeeId: null,
    status: 'queued',
    holderId: null,
    ...overrides,
  };
}

describe('isEvacuationHoldActive', () => {
  it('true when the action carries the hold marker and a living employee is still inside the zone', () => {
    const state = createGame({ seed: EVACUATION_SEED });
    state.zone.activeZone = holdZone;
    const rng = new Random(EVACUATION_SEED);
    hireEmployee(state.employees, 'driller', rng, 15, 15); // still inside the zone
    const action = makeAction({ id: 1, payload: { evacuationHold: true } });

    expect(isEvacuationHoldActive(state, action)).toBe(true);
  });

  it('false once the zone has genuinely cleared of living employees, with no blast plan at all', () => {
    const state = createGame({ seed: EVACUATION_SEED });
    state.zone.activeZone = holdZone; // no employees at all -> trivially clear; no drillHoles either
    const action = makeAction({ id: 2, payload: { evacuationHold: true } });

    expect(isEvacuationHoldActive(state, action)).toBe(false);
  });

  it('true when the zone is clear of employees but a live, un-fired blast plan still overlaps it (#557 follow-up)', () => {
    const state = createGame({ seed: EVACUATION_SEED });
    state.zone.activeZone = holdZone; // no employees -> occupancy alone would say "clear"
    state.drillHoles.push({ id: 'H1', x: 15, z: 15, depth: 6, diameter: 0.089 }); // squarely inside holdZone
    const action = makeAction({ id: 3, payload: { evacuationHold: true } });

    expect(isEvacuationHoldActive(state, action)).toBe(true);
  });

  it('false when a blast plan exists elsewhere, its danger box never overlapping the hold zone', () => {
    const state = createGame({ seed: EVACUATION_SEED });
    state.zone.activeZone = holdZone;
    state.drillHoles.push({ id: 'H1', x: 500, z: 500, depth: 6, diameter: 0.089 }); // far away
    const action = makeAction({ id: 4, payload: { evacuationHold: true } });

    expect(isEvacuationHoldActive(state, action)).toBe(false);
  });

  it('false when the action carries no hold marker at all, even with the zone occupied (boundary)', () => {
    const state = createGame({ seed: EVACUATION_SEED });
    state.zone.activeZone = holdZone;
    const rng = new Random(EVACUATION_SEED);
    hireEmployee(state.employees, 'driller', rng, 15, 15);
    const action = makeAction({ id: 5, payload: {} });

    expect(isEvacuationHoldActive(state, action)).toBe(false);
  });

  it('false when no zone is active at all, even with the marker present (rejection)', () => {
    const state = createGame({ seed: EVACUATION_SEED });
    // state.zone.activeZone stays null — fresh game, nothing was ever evacuated.
    const action = makeAction({ id: 6, payload: { evacuationHold: true } });

    expect(isEvacuationHoldActive(state, action)).toBe(false);
  });

  it('never mutates the action payload — pure check', () => {
    const state = createGame({ seed: EVACUATION_SEED });
    state.zone.activeZone = holdZone; // no employees hired -> would read "clear"
    const payload = { evacuationHold: true };
    const action = makeAction({ id: 7, payload });

    isEvacuationHoldActive(state, action);

    expect(action.payload).toBe(payload); // same reference — never reassigned
    expect(action.payload['evacuationHold']).toBe(true);
  });
});

describe('clearResolvedEvacuationHolds', () => {
  it('strips the hold marker from every action once the zone has genuinely cleared, keeping the rest of the payload', () => {
    const state = createGame({ seed: EVACUATION_SEED });
    state.zone.activeZone = holdZone; // no employees hired -> trivially clear
    state.pendingActions.push(makeAction({ id: 1, payload: { evacuationHold: true, other: 'kept' } }));

    clearResolvedEvacuationHolds(state);

    const stored = state.pendingActions.find(a => a.id === 1)!;
    expect(stored.payload['evacuationHold']).toBeUndefined();
    expect(stored.payload['other']).toBe('kept');
  });

  it('leaves the marker in place while a living employee is still inside the zone (rejection)', () => {
    const state = createGame({ seed: EVACUATION_SEED });
    state.zone.activeZone = holdZone;
    const rng = new Random(EVACUATION_SEED);
    hireEmployee(state.employees, 'driller', rng, 15, 15); // still in zone
    state.pendingActions.push(makeAction({ id: 2, payload: { evacuationHold: true } }));

    clearResolvedEvacuationHolds(state);

    expect(state.pendingActions.find(a => a.id === 2)!.payload['evacuationHold']).toBe(true);
  });

  it('leaves the marker in place while a live blast plan still overlaps the zone, even with every employee clear (#557 follow-up)', () => {
    const state = createGame({ seed: EVACUATION_SEED });
    state.zone.activeZone = holdZone; // no employees -> occupancy alone would strip it
    state.drillHoles.push({ id: 'H1', x: 15, z: 15, depth: 6, diameter: 0.089 });
    state.pendingActions.push(makeAction({ id: 3, payload: { evacuationHold: true } }));

    clearResolvedEvacuationHolds(state);

    expect(state.pendingActions.find(a => a.id === 3)!.payload['evacuationHold']).toBe(true);
  });

  it('is a no-op with no active zone at all (boundary)', () => {
    const state = createGame({ seed: EVACUATION_SEED });
    state.pendingActions.push(makeAction({ id: 4, payload: { evacuationHold: true } }));

    clearResolvedEvacuationHolds(state);

    expect(state.pendingActions.find(a => a.id === 4)!.payload['evacuationHold']).toBe(true);
  });

  it('never re-arms on a later, unrelated re-entry into the same zone footprint — the marker stays stripped for good', () => {
    const state = createGame({ seed: EVACUATION_SEED });
    state.zone.activeZone = holdZone;
    state.pendingActions.push(makeAction({ id: 5, payload: { evacuationHold: true } }));

    clearResolvedEvacuationHolds(state); // zone genuinely clear right now -> strips it

    const rng = new Random(EVACUATION_SEED);
    hireEmployee(state.employees, 'driller', rng, 15, 15); // a LATER, unrelated re-entry into the same zone

    expect(isEvacuationHoldActive(state, state.pendingActions.find(a => a.id === 5)!)).toBe(false);
  });
});

describe('discardStaleRestAction', () => {
  it('removes the action from pendingActions and clears the employee\'s rest-mode fields', () => {
    const state = createGame({ seed: EVACUATION_SEED });
    const rng = new Random(EVACUATION_SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 15, 15);
    employee.pendingRestDuration = 4;
    employee.pendingRestNeedKey = 'hunger';
    const action = makeAction({
      id: 1, type: 'rest', targetEmployeeId: employee.id, holderId: employee.id, status: 'assigned',
    });
    state.pendingActions.push(action);

    discardStaleRestAction(state, employee, action.id);

    expect(state.pendingActions.find(a => a.id === 1)).toBeUndefined();
    expect(employee.pendingRestDuration).toBeNull();
    expect(employee.pendingRestNeedKey).toBeNull();
    expect(employee.restTicksRemaining).toBeNull();
  });
});

describe('releaseInZoneTaskQueueEntries', () => {
  it('discards an in-zone rest entry, releases an in-zone non-rest entry to the open pool, and leaves an out-of-zone entry untouched', () => {
    const state = createGame({ seed: EVACUATION_SEED });
    const rng = new Random(EVACUATION_SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 15, 15);

    const staleRest = makeAction({
      id: 1, type: 'rest', targetX: 15, targetZ: 15, targetEmployeeId: employee.id,
      holderId: employee.id, status: 'assigned',
    });
    const staleWork = makeAction({
      id: 2, type: 'dig_ramp_segment', targetX: 16, targetZ: 16, targetEmployeeId: null,
      holderId: employee.id, status: 'assigned',
    });
    const untouched = makeAction({
      id: 3, type: 'dig_ramp_segment', targetX: 50, targetZ: 50, targetEmployeeId: employee.id,
      holderId: employee.id, status: 'assigned',
    });
    state.pendingActions.push(staleRest, staleWork, untouched);
    employee.taskQueue = [1, 2, 3];

    releaseInZoneTaskQueueEntries(state, employee, holdZone);

    expect(state.pendingActions.find(a => a.id === 1)).toBeUndefined(); // rest -> discarded
    const work = state.pendingActions.find(a => a.id === 2)!;
    expect(work.status).toBe('queued'); // non-rest -> released to open pool
    expect(work.holderId).toBeNull();
    const kept = state.pendingActions.find(a => a.id === 3)!;
    expect(kept.status).toBe('assigned'); // outside the zone -> untouched
    expect(kept.holderId).toBe(employee.id);
    expect(employee.taskQueue).toEqual([3]);
  });

  it('is a no-op on an empty taskQueue (boundary)', () => {
    const state = createGame({ seed: EVACUATION_SEED });
    const rng = new Random(EVACUATION_SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 15, 15);
    employee.taskQueue = [];

    expect(() => releaseInZoneTaskQueueEntries(state, employee, holdZone)).not.toThrow();
    expect(employee.taskQueue).toEqual([]);
  });
});
