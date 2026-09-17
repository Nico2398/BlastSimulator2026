// BlastSimulator2026 — Tests for releaseDeadEmployeeActions and
// cancelAction's holder-scoping behavior (src/core/engine/TaskCancellation.ts).
//
// interruptActiveAction and the rest of cancelAction's coverage predate this
// file and remain in tests/unit/engine/TaskDispatch.test.ts (their original
// home before TaskCancellation.ts was split out) — this file adds
// releaseDeadEmployeeActions (#557 review) and cancelAction's fix to not
// clear a different active action's holder fields (#939).

import { describe, it, expect, vi } from 'vitest';
import { Random } from '../../../src/core/math/Random.js';
import { createGame } from '../../../src/core/state/GameState.js';
import type { PendingAction } from '../../../src/core/state/GameState.js';
import { releaseDeadEmployeeActions, cancelAction, interruptActiveAction } from '../../../src/core/engine/TaskCancellation.js';
import { reserveVehicle } from '../../../src/core/engine/VehicleReservation.js';
import { purchaseVehicle } from '../../../src/core/entities/Vehicle.js';
import { createEmployeeState, hireEmployee } from '../../../src/core/entities/Employee.js';
import { findPath } from '../../../src/core/nav/Pathfinding.js';
import { NavGrid, type NavCell } from '../../../src/core/nav/NavGrid.js';
import * as PlanItineraryModule from '../../../src/core/engine/PlanItinerary.js';
import { ACTION_STUCK_BACKOFF_TICKS } from '../../../src/core/config/balance.js';

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
    queuedAtTick: 0,
    ...overrides,
  };
}

/** Flat, fully-walkable NavGrid of the given size (mirrors ActionSelection.test.ts's own helper). */
function makeFlatGrid(width: number, height: number): NavGrid {
  const cells: NavCell[][] = [];
  for (let z = 0; z < height; z++) {
    const row: NavCell[] = [];
    for (let x = 0; x < width; x++) row.push({ type: 'walkable', moveCost: 1.0, benchLevel: 0, vehicleOccupied: false });
    cells.push(row);
  }
  return new NavGrid(width, height, cells);
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

// ── hasCloserIdleCandidate must call the REAL distance oracle
// (PlanItinerary.ts's estimateLegDistance) with the real per-call
// avoidVehicles/agentId, not TaskCancellation.ts's own hand-rolled
// walkingDistanceEstimate helper hardcoding avoidVehicles:true / agentId:-1
// (#1128). walkingDistanceEstimate itself is being deleted by the
// implementation that follows this test-writing pass, so every test below
// drives hasCloserIdleCandidate only through interruptActiveAction — the one
// exported entry point that reaches it (hasCloserIdleCandidate itself stays
// private) — exactly like the #556/#867/#954 pin/release regression suites in
// TaskDispatch.test.ts already do.
//
// Shared setup shape for every test below: a 'general_work' action already
// mid-walk-only-pinned to `pinned` (targetEmployeeId === pinned.id,
// payload.walkOnlyPinnedBy === pinned.id, pinned.taskTicksRemaining === null,
// pinned.pendingTaskDuration !== null) — the exact state that routes a REPEAT
// interruptActiveAction call into the `hasCloserIdleCandidate` branch
// (TaskCancellation.ts's own doc comment on interruptActiveAction explains
// why: first interruption pins, a second one either releases or re-pins based
// on hasCloserIdleCandidate's verdict).
describe('hasCloserIdleCandidate\'s real distance-oracle semantics, via interruptActiveAction\'s repeat walk-only-pin release (#1128)', () => {
  /** Hire one real employee at (x, z) into state.employees and return them. */
  function hireAt(state: ReturnType<typeof createGame>, seed: number, x: number, z: number) {
    const rng = new Random(seed);
    const { employee } = hireEmployee(state.employees, 'driller', rng, x, z);
    return employee;
  }

  it('computes avoidVehicles from the target\'s REAL vehicle occupancy, not a hardcoded true — releases the pin to a genuinely closer idle candidate once the occupied target becomes reachable', () => {
    // The action's own target cell is itself sitting under a vehicle (e.g. a
    // drill_rig parked exactly where a hole needs charging) — mirrors
    // PlanItinerary.ts's own buildFootOnlyItinerary convention:
    // avoidVehicles = !isDestinationOccupied(target), so a leg whose OWN
    // destination is occupied must flip to false to ever reach it at all.
    //
    // Under the current hardcoded avoidVehicles:true, BOTH the pinned
    // employee's own distance and every idle candidate's distance to this
    // target resolve to Infinity (findExactPath refuses an impassable goal
    // cell) — `Infinity < Infinity` is false, so hasCloserIdleCandidate
    // (wrongly) reports no closer candidate and the pin never releases. With
    // avoidVehicles correctly derived as false here, the target becomes a
    // real, reachable cell again: `closer` (one cell away) gets a small
    // finite distance strictly less than `pinned`'s (clear across the grid),
    // so the pin DOES release.
    const state = createGame({ seed: SEED });
    state.employees = createEmployeeState();
    const pinned = hireAt(state, SEED, 0, 0);
    const closer = hireAt(state, SEED + 1, 9, 10);

    const grid = makeFlatGrid(20, 20);
    grid.cells[10]![10]!.vehicleOccupied = true; // the action's own target cell
    state.navGrid = grid;

    const action = makeAction({
      id: 500, targetX: 10, targetZ: 10,
      status: 'assigned', holderId: pinned.id, targetEmployeeId: pinned.id,
      payload: { walkOnlyPinnedBy: pinned.id },
    });
    state.pendingActions.push(action);

    pinned.activeActionId = action.id;
    pinned.pendingTaskDuration = 10; // mid-walk-only phase (taskTicksRemaining stays null)

    interruptActiveAction(state, pinned, action.id);

    const stored = state.pendingActions.find(a => a.id === action.id)!;
    expect(stored.targetEmployeeId).toBeNull();
    expect(closer.id).not.toBe(pinned.id); // sanity: two distinct candidates were actually compared
  });

  it('threads each candidate\'s own real employee id as the agentId passed to the distance oracle, never a hardcoded -1', () => {
    const state = createGame({ seed: SEED });
    state.employees = createEmployeeState();
    const pinned = hireAt(state, SEED, 0, 0);
    const closer = hireAt(state, SEED + 1, 1, 1);
    state.navGrid = makeFlatGrid(20, 20);

    const action = makeAction({
      id: 501, targetX: 10, targetZ: 10,
      status: 'assigned', holderId: pinned.id, targetEmployeeId: pinned.id,
      payload: { walkOnlyPinnedBy: pinned.id },
    });
    state.pendingActions.push(action);

    pinned.activeActionId = action.id;
    pinned.pendingTaskDuration = 10;

    const spy = vi.spyOn(PlanItineraryModule, 'estimateLegDistance');

    interruptActiveAction(state, pinned, action.id);

    // The old hand-rolled walkingDistanceEstimate never calls into
    // PlanItinerary.ts at all — this spy sees zero calls today, which is the
    // expected red-phase failure below.
    expect(spy.mock.calls.length).toBeGreaterThan(0);

    const agentIdsUsed = spy.mock.calls.map(call => call[2]);
    expect(agentIdsUsed).not.toContain(-1);
    expect(agentIdsUsed).toContain(pinned.id);
    expect(agentIdsUsed).toContain(closer.id);

    spy.mockRestore();
  });

  // ── #1113 regression, re-expressed against the new call path ────────────
  // (mirrors #1109's fix to resolveActionCost/ActionSelection.ts). The
  // deleted walkingDistanceEstimate used to trust findPath's silent
  // out-of-bounds clamp; estimateLegDistance (PlanItinerary.ts) never does,
  // since it always calls findExactPath. This proves that protection still
  // holds once hasCloserIdleCandidate calls the real oracle instead.
  it('an out-of-bounds action target resolves to null/Infinity through the real oracle, never a distance computed against findPath\'s silently clamped endpoint (#1113)', () => {
    const state = createGame({ seed: SEED });
    state.employees = createEmployeeState();
    const pinned = hireAt(state, SEED, 0, 0);
    hireAt(state, SEED + 1, 1, 1); // nominally "closer" by straight-line to the shared out-of-bounds target
    state.navGrid = makeFlatGrid(30, 30);

    const outOfBoundsX = 500, outOfBoundsZ = 500;
    const plainPath = findPath(state.navGrid, {
      agentId: -1, fromX: 0, fromZ: 0, toX: outOfBoundsX, toZ: outOfBoundsZ, avoidVehicles: true,
    });
    expect(plainPath.found).toBe(true); // findPath itself still clamps silently — the trap this regression guards against

    const action = makeAction({
      id: 502, targetX: outOfBoundsX, targetZ: outOfBoundsZ,
      status: 'assigned', holderId: pinned.id, targetEmployeeId: pinned.id,
      payload: { walkOnlyPinnedBy: pinned.id },
    });
    state.pendingActions.push(action);

    pinned.activeActionId = action.id;
    pinned.pendingTaskDuration = 10;

    const spy = vi.spyOn(PlanItineraryModule, 'estimateLegDistance');

    interruptActiveAction(state, pinned, action.id);

    // Fails today for the same reason as the agentId test above: the real
    // oracle is never called at all by the current hand-rolled fallback.
    expect(spy.mock.calls.length).toBeGreaterThan(0);
    for (const result of spy.mock.results) {
      expect(result.value).toBeNull(); // never a distance against a clamped endpoint
    }

    // Both pinned and the candidate resolve to the same unreachable Infinity
    // for this shared out-of-bounds target, so the pin is never released to
    // an out-of-bounds phantom "closer" candidate.
    const stored = state.pendingActions.find(a => a.id === action.id)!;
    expect(stored.targetEmployeeId).toBe(pinned.id);

    spy.mockRestore();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// interruptActiveAction — stuck-abandon backoff stamp (#1130)
//
// options.forceOpenPool is the "sustained, confirmed impasse" signal
// Locomotion.ts's abandon-after-stuck path already uses (see this file's own
// header comment on that option). #1130 adds a second effect alongside the
// existing unconditional release-to-pool: stamp
// PendingAction.stuckBackoffUntilTick = state.tickCount + ACTION_STUCK_BACKOFF_TICKS
// on the released action, so the very next dispatch pass — run by the same
// vehicle that just abandoned it, an instant later — can't reclaim the
// identical action. An ordinary (non-forced) interruption must never stamp
// this: it may still resolve on its own, and backing it off would delay
// legitimate rework for no reason.
// ═══════════════════════════════════════════════════════════════════════════

describe('interruptActiveAction — stuck-abandon backoff stamp (#1130)', () => {
  function hireAt(state: ReturnType<typeof createGame>, x: number, z: number) {
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, x, z);
    return employee;
  }

  it('stamps stuckBackoffUntilTick = state.tickCount + ACTION_STUCK_BACKOFF_TICKS when called with forceOpenPool: true (happy path)', () => {
    const state = createGame({ seed: SEED });
    state.employees = createEmployeeState();
    state.tickCount = 1000;
    const emp = hireAt(state, 0, 0);
    const action = makeAction({ id: 600, requiredSkill: null, holderId: emp.id, status: 'assigned' });
    state.pendingActions.push(action);
    emp.activeActionId = action.id;
    emp.pendingTaskDuration = 10; // mid-walk phase

    interruptActiveAction(state, emp, action.id, { forceOpenPool: true });

    const stored = state.pendingActions.find(a => a.id === action.id)!;
    expect(stored.stuckBackoffUntilTick).toBe(1000 + ACTION_STUCK_BACKOFF_TICKS);
    expect(stored.status).toBe('queued');
  });

  it('does not stamp stuckBackoffUntilTick for an ordinary interruption (forceOpenPool omitted) — only a confirmed impasse backs off', () => {
    const state = createGame({ seed: SEED });
    state.employees = createEmployeeState();
    state.tickCount = 1000;
    const emp = hireAt(state, 0, 0);
    const action = makeAction({ id: 601, requiredSkill: null, holderId: emp.id, status: 'assigned' });
    state.pendingActions.push(action);
    emp.activeActionId = action.id;
    emp.pendingTaskDuration = 10;

    interruptActiveAction(state, emp, action.id);

    const stored = state.pendingActions.find(a => a.id === action.id)!;
    expect(stored.stuckBackoffUntilTick == null).toBe(true);
  });

  it('stamps a fresh window on a REPEAT forced interruption of the same action, based on the tick it happens at', () => {
    const state = createGame({ seed: SEED });
    state.employees = createEmployeeState();
    state.tickCount = 1000;
    const emp = hireAt(state, 0, 0);
    const action = makeAction({ id: 602, requiredSkill: null, holderId: emp.id, status: 'assigned' });
    state.pendingActions.push(action);
    emp.activeActionId = action.id;
    emp.pendingTaskDuration = 10;

    interruptActiveAction(state, emp, action.id, { forceOpenPool: true });
    expect(state.pendingActions.find(a => a.id === action.id)!.stuckBackoffUntilTick).toBe(1000 + ACTION_STUCK_BACKOFF_TICKS);

    // Reclaimed and re-abandoned later, at a different tick.
    state.tickCount = 2000;
    emp.activeActionId = action.id;
    action.holderId = emp.id;
    action.status = 'assigned';
    emp.pendingTaskDuration = 10;

    interruptActiveAction(state, emp, action.id, { forceOpenPool: true });

    expect(state.pendingActions.find(a => a.id === action.id)!.stuckBackoffUntilTick).toBe(2000 + ACTION_STUCK_BACKOFF_TICKS);
  });
});
