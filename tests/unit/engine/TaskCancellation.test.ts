// BlastSimulator2026 — Tests for releaseDeadEmployeeActions
// (src/core/engine/TaskCancellation.ts, #557 review).
//
// interruptActiveAction and cancelAction from the same module predate this
// file and are covered in tests/unit/engine/TaskDispatch.test.ts (their
// original home before TaskCancellation.ts was split out) — this file covers
// only releaseDeadEmployeeActions, added alongside this review's fixes.

import { describe, it, expect } from 'vitest';
import { Random } from '../../../src/core/math/Random.js';
import { createGame } from '../../../src/core/state/GameState.js';
import type { PendingAction } from '../../../src/core/state/GameState.js';
import { releaseDeadEmployeeActions, cancelAction } from '../../../src/core/engine/TaskCancellation.js';
import { reserveVehicle } from '../../../src/core/engine/VehicleReservation.js';
import { purchaseVehicle } from '../../../src/core/entities/Vehicle.js';
import { createEmployeeState, hireEmployee } from '../../../src/core/entities/Employee.js';

const SEED = 42;
const DEAD_ID = 7;

/** Build a minimal PendingAction for tests. Defaults to 'queued'/unheld. */
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

describe('releaseDeadEmployeeActions (#557 review)', () => {
  it('discards a rest action targeted at the dead employee — record and ghost both removed', () => {
    const state = createGame({ seed: SEED });
    const rest = makeAction({ id: 1, type: 'rest', targetEmployeeId: DEAD_ID, status: 'assigned', holderId: DEAD_ID });
    state.pendingActions.push(rest);
    state.ghostPreviews.push({ id: 1, type: 'rest', targetX: 0, targetZ: 0, targetY: 0, claimed: true });

    releaseDeadEmployeeActions(state, DEAD_ID);

    expect(state.pendingActions.find(a => a.id === 1)).toBeUndefined();
    expect(state.ghostPreviews.find(g => g.id === 1)).toBeUndefined();
  });

  it('discards a rest action merely HELD (holderId) by the dead employee, even when targeted at someone else', () => {
    const state = createGame({ seed: SEED });
    const rest = makeAction({ id: 2, type: 'rest', targetEmployeeId: 999, status: 'assigned', holderId: DEAD_ID });
    state.pendingActions.push(rest);

    releaseDeadEmployeeActions(state, DEAD_ID);

    expect(state.pendingActions.find(a => a.id === 2)).toBeUndefined();
  });

  it('clears targetEmployeeId on a still-queued action targeted at the dead employee, opening it to the whole pool', () => {
    const state = createGame({ seed: SEED });
    const queued = makeAction({ id: 3, targetEmployeeId: DEAD_ID, status: 'queued' });
    state.pendingActions.push(queued);

    releaseDeadEmployeeActions(state, DEAD_ID);

    const stored = state.pendingActions.find(a => a.id === 3);
    expect(stored).toBeDefined();
    expect(stored!.status).toBe('queued');
    expect(stored!.targetEmployeeId).toBeNull();
  });

  it('releases a held (assigned) action back to the open pool: status queued, holder cleared, ghost unclaimed', () => {
    const state = createGame({ seed: SEED });
    const held = makeAction({ id: 4, status: 'assigned', holderId: DEAD_ID, targetEmployeeId: DEAD_ID });
    state.pendingActions.push(held);
    state.ghostPreviews.push({ id: 4, type: 'general_work', targetX: 0, targetZ: 0, targetY: 0, claimed: true });
    const before = state.ghostPreviewsRevision;

    releaseDeadEmployeeActions(state, DEAD_ID);

    const stored = state.pendingActions.find(a => a.id === 4)!;
    expect(stored.status).toBe('queued');
    expect(stored.holderId).toBeNull();
    // Opened to the whole pool, not left targeted at a corpse.
    expect(stored.targetEmployeeId).toBeNull();
    const ghost = state.ghostPreviews.find(g => g.id === 4)!;
    expect(ghost.claimed).toBe(false);
    expect(state.ghostPreviewsRevision).toBe(before + 1);
  });

  it('releases an "in_progress" held action the same way as "assigned"', () => {
    const state = createGame({ seed: SEED });
    const held = makeAction({ id: 5, status: 'in_progress', holderId: DEAD_ID });
    state.pendingActions.push(held);

    releaseDeadEmployeeActions(state, DEAD_ID);

    const stored = state.pendingActions.find(a => a.id === 5)!;
    expect(stored.status).toBe('queued');
    expect(stored.holderId).toBeNull();
  });

  it('releases the vehicle reservation held for a released action', () => {
    const state = createGame({ seed: SEED });
    const held = makeAction({ id: 6, status: 'assigned', holderId: DEAD_ID, requiredVehicleRole: 'drill_rig' });
    state.pendingActions.push(held);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);
    reserveVehicle(vehicle, 6);

    releaseDeadEmployeeActions(state, DEAD_ID);

    expect(vehicle.reservedForActionId).toBeNull();
  });

  it('leaves an action held by a DIFFERENT employee entirely untouched (boundary)', () => {
    const state = createGame({ seed: SEED });
    const other = makeAction({ id: 8, status: 'assigned', holderId: 999, targetEmployeeId: 999 });
    state.pendingActions.push(other);

    releaseDeadEmployeeActions(state, DEAD_ID);

    const stored = state.pendingActions.find(a => a.id === 8)!;
    expect(stored.status).toBe('assigned');
    expect(stored.holderId).toBe(999);
    expect(stored.targetEmployeeId).toBe(999);
  });

  it('is a safe no-op when the dead employee holds/targets nothing at all (rejection)', () => {
    const state = createGame({ seed: SEED });
    const untouched = makeAction({ id: 9, targetEmployeeId: 999, status: 'queued' });
    state.pendingActions.push(untouched);

    expect(() => releaseDeadEmployeeActions(state, DEAD_ID)).not.toThrow();
    expect(state.pendingActions).toHaveLength(1);
    expect(state.pendingActions[0]!.targetEmployeeId).toBe(999);
  });

  it('is a safe no-op on an entirely empty pendingActions array (boundary)', () => {
    const state = createGame({ seed: SEED });

    expect(() => releaseDeadEmployeeActions(state, DEAD_ID)).not.toThrow();
    expect(state.pendingActions).toHaveLength(0);
  });
});

// ── cancelAction must only touch the fields of the action being cancelled ──
// (#939) ─────────────────────────────────────────────────────────────────────
//
// action.holderId !== null is true both for an employee's real active action
// (employee.activeActionId === action.id) AND for an action
// reserveOnePoolActionAhead (EmployeeDispatchSteps.ts) claimed one step ahead
// into employee.taskQueue while the employee is still busy on a DIFFERENT
// active action — claimOnePoolCandidate -> claimPendingAction sets
// action.holderId = employee.id and action.status = 'assigned' without ever
// touching employee.activeActionId. cancelAction must only clear the holder's
// walk/task-progress bookkeeping when the action being cancelled IS the
// employee's genuinely active one (employee.activeActionId === action.id) —
// never unconditionally, just because holderId is non-null.
//
// Uses a real hired Employee (via hireEmployee/createEmployeeState, the same
// pattern TaskDispatch.test.ts uses) rather than a hand-built object, since
// the defect is specifically about employee.activeActionId vs. the cancelled
// action's own id.
describe('cancelAction — must not clear a DIFFERENT active action\'s holder fields (#939)', () => {
  /** Hire one real employee into state.employees and return them. */
  function hireOneEmployee(state: ReturnType<typeof createGame>) {
    state.employees = createEmployeeState();
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    return employee;
  }

  it('cancelling a taskQueue-reserved action (B) leaves the employee\'s genuinely active action (A) and its walk/task fields completely untouched', () => {
    const state = createGame({ seed: SEED });
    const employee = hireOneEmployee(state);

    const actionA = makeAction({
      id: 100, status: 'in_progress', holderId: employee.id,
    });
    const actionB = makeAction({
      id: 101, status: 'assigned', holderId: employee.id,
    });
    state.pendingActions.push(actionA, actionB);

    employee.activeActionId = actionA.id;
    employee.taskTicksRemaining = 5;
    employee.taskQueue = [actionB.id];

    const result = cancelAction(state, actionB.id);

    expect(result.success).toBe(true);
    expect(result.action?.id).toBe(actionB.id);

    // B removed.
    expect(state.pendingActions.find(a => a.id === actionB.id)).toBeUndefined();

    // A — the employee's REAL active action — is untouched.
    const storedA = state.pendingActions.find(a => a.id === actionA.id);
    expect(storedA).toBeDefined();
    expect(storedA!.status).toBe('in_progress');
    expect(storedA!.holderId).toBe(employee.id);

    // The defect: cancelAction currently clears these unconditionally
    // whenever action.holderId !== null, even though A — not B — is the
    // action these fields actually describe.
    expect(employee.activeActionId).toBe(actionA.id);
    expect(employee.taskTicksRemaining).toBe(5);

    // B popped from the queue.
    expect(employee.taskQueue).not.toContain(actionB.id);
  });

  it('cancelling the genuinely active action (A) itself still clears the holder\'s active fields, leaving a separately taskQueue-reserved action (B) untouched', () => {
    const state = createGame({ seed: SEED });
    const employee = hireOneEmployee(state);

    const actionA = makeAction({
      id: 102, status: 'in_progress', holderId: employee.id,
    });
    const actionB = makeAction({
      id: 103, status: 'assigned', holderId: employee.id,
    });
    state.pendingActions.push(actionA, actionB);

    employee.activeActionId = actionA.id;
    employee.taskTicksRemaining = 5;
    employee.taskQueue = [actionB.id];

    const result = cancelAction(state, actionA.id);

    expect(result.success).toBe(true);
    expect(result.action?.id).toBe(actionA.id);

    // A removed.
    expect(state.pendingActions.find(a => a.id === actionA.id)).toBeUndefined();

    // Holder's active fields cleared — this IS the mirror (unchanged) branch.
    expect(employee.activeActionId).toBeNull();
    expect(employee.taskTicksRemaining).toBeNull();

    // B — merely reserved ahead — is left completely alone.
    const storedB = state.pendingActions.find(a => a.id === actionB.id);
    expect(storedB).toBeDefined();
    expect(storedB!.status).toBe('assigned');
    expect(storedB!.holderId).toBe(employee.id);
    expect(employee.taskQueue).toEqual([actionB.id]);
  });

  it('cancelling one of several taskQueue-reserved actions removes only its own id, preserving the order of the rest (boundary)', () => {
    const state = createGame({ seed: SEED });
    const employee = hireOneEmployee(state);

    const actionA = makeAction({ id: 104, status: 'in_progress', holderId: employee.id });
    const actionB = makeAction({ id: 105, status: 'assigned', holderId: employee.id });
    const actionC = makeAction({ id: 106, status: 'assigned', holderId: employee.id });
    const actionD = makeAction({ id: 107, status: 'assigned', holderId: employee.id });
    state.pendingActions.push(actionA, actionB, actionC, actionD);

    employee.activeActionId = actionA.id;
    employee.taskTicksRemaining = 5;
    employee.taskQueue = [actionB.id, actionC.id, actionD.id];

    const result = cancelAction(state, actionC.id);

    expect(result.success).toBe(true);
    expect(employee.taskQueue).toEqual([actionB.id, actionD.id]);

    // A still untouched.
    expect(employee.activeActionId).toBe(actionA.id);
    expect(employee.taskTicksRemaining).toBe(5);
    const storedA = state.pendingActions.find(a => a.id === actionA.id);
    expect(storedA!.status).toBe('in_progress');
  });
});
