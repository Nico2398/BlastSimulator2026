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
import { releaseDeadEmployeeActions, releaseInjuredEmployeeQueue, releaseInjuredEmployeesQueues, cancelAction, interruptActiveAction, releaseEmployeeFromWorld, fireEmployeeFromWorld } from '../../../src/core/engine/TaskCancellation.js';
import { reserveVehicle } from '../../../src/core/engine/VehicleReservation.js';
import { purchaseVehicle, getVehicleReservation } from '../../../src/core/entities/Vehicle.js';
import { createEmployeeState, hireEmployee, assignSkill } from '../../../src/core/entities/Employee.js';
import { board } from '../../../src/core/engine/Mount.js';
import { placeBuilding } from '../../../src/core/entities/Building.js';
import { addBlastFragments, pickupFragment, inTransitMassKg } from '../../../src/core/economy/Logistics.js';
import type { FragmentData } from '../../../src/core/mining/BlastExecution.js';
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
    reserveVehicle(state.vehicles, vehicle.id, 6);

    releaseDeadEmployeeActions(state, DEAD_ID);

    expect(getVehicleReservation(state.vehicles, vehicle.id)).toBeNull();
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

// ── releaseEmployeeFromWorld / fireEmployeeFromWorld (#1378) ────────────────

function makeCargoFragment(id: number, mass = 850): FragmentData {
  return {
    id,
    position: { x: 0, y: 0, z: 0 },
    volume: 0.3,
    mass,
    rockId: 'cruite',
    oreDensities: { dirtite: 0.3 },
    initialVelocity: { x: 0, y: 0, z: 0 },
    isProjection: false,
    halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
    shapeSeed: 1,
    origin: { x: 0, y: 0, z: 0 },
  };
}

describe('releaseEmployeeFromWorld (#1378)', () => {
  function setup() {
    const state = createGame({ seed: SEED });
    state.employees = createEmployeeState();
    state.navGrid = makeFlatGrid(20, 20);
    return state;
  }
  function hire(state: ReturnType<typeof createGame>, role: 'driver' | 'driller' = 'driller', x = 5, z = 5) {
    return hireEmployee(state.employees, role, new Random(SEED), x, z).employee;
  }

  it('alights a driver from the vehicle: occupantIds empty, locomotion on_foot', () => {
    const state = setup();
    const driver = hire(state, 'driver');
    assignSkill(state.employees, driver.id, 'driving.truck', 1);
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 5, 5);
    expect(board(state, vehicle.id, driver.id).success).toBe(true);

    releaseEmployeeFromWorld(state, driver.id);

    expect(vehicle.occupantIds).toEqual([]);
    expect(driver.locomotion).toEqual({ kind: 'on_foot' });
  });

  it('returns every item of a multi-fragment cargo to the ground and keeps I8 intact (#1370)', () => {
    const state = setup();
    state.logistics.storageCapacityKg = 5000;
    addBlastFragments(state.logistics, [makeCargoFragment(1, 850), makeCargoFragment(2, 400), makeCargoFragment(3, 300)]);
    const driver = hire(state, 'driver');
    assignSkill(state.employees, driver.id, 'driving.truck', 1);
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 5, 5);
    expect(board(state, vehicle.id, driver.id).success).toBe(true);
    for (const id of [1, 2, 3]) pickupFragment(state.logistics, id, String(vehicle.id));
    vehicle.cargo = [{ fragmentId: 1, massKg: 850 }, { fragmentId: 2, massKg: 400 }, { fragmentId: 3, massKg: 300 }];

    releaseEmployeeFromWorld(state, driver.id);

    expect(vehicle.cargo).toEqual([]);
    for (const id of [1, 2, 3]) {
      const f = state.logistics.fragments.find(t => t.fragment.id === id)!;
      expect(f.state).toBe('on_ground');
      expect(f.vehicleId).toBeNull();
    }
    expect(state.logistics.fragments.filter(f => f.state === 'in_transit')).toHaveLength(0);
    expect(inTransitMassKg(state.logistics)).toBe(0);
  });

  it('returns the payload a driven hauler carries to the ground', () => {
    const state = setup();
    state.logistics.storageCapacityKg = 5000;
    addBlastFragments(state.logistics, [makeCargoFragment(1, 850)]);
    const driver = hire(state, 'driver');
    assignSkill(state.employees, driver.id, 'driving.truck', 1);
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 5, 5);
    expect(board(state, vehicle.id, driver.id).success).toBe(true);
    pickupFragment(state.logistics, 1, String(vehicle.id));
    vehicle.cargo = [{ fragmentId: 1, massKg: 850 }];

    releaseEmployeeFromWorld(state, driver.id);

    expect(vehicle.cargo).toEqual([]);
    expect(vehicle.occupantIds).toEqual([]);
    const cargo = state.logistics.fragments.find(f => f.fragment.id === 1)!;
    expect(cargo.state).toBe('on_ground');
    expect(cargo.vehicleId).toBeNull();
  });

  it('removes a passenger from occupantIds and leaves the driver aboard', () => {
    const state = setup();
    const driver = hire(state, 'driver');
    const passenger = hire(state, 'driller');
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 5, 5);
    vehicle.occupantIds = [driver.id, passenger.id];
    driver.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
    passenger.locomotion = { kind: 'mounted', vehicleId: vehicle.id };

    releaseEmployeeFromWorld(state, passenger.id);

    expect(vehicle.occupantIds).toEqual([driver.id]);
    expect(passenger.locomotion).toEqual({ kind: 'on_foot' });
    expect(driver.locomotion).toEqual({ kind: 'mounted', vehicleId: vehicle.id });
  });

  it('removes a building occupant from the building and puts them on foot', () => {
    const state = setup();
    const building = placeBuilding(state.buildings, 'driving_center', 8, 8, 20, 20).building!;
    const emp = hire(state, 'driller', 7, 7);
    building.occupantIds = [emp.id];
    emp.locomotion = { kind: 'inside', buildingId: building.id };

    releaseEmployeeFromWorld(state, emp.id);

    expect(building.occupantIds).toEqual([]);
    expect(emp.locomotion).toEqual({ kind: 'on_foot' });
  });

  it('returns a held action to the pool: queued, holder cleared, ghost unclaimed', () => {
    const state = setup();
    const emp = hire(state);
    const action = makeAction({ id: 10, status: 'in_progress', holderId: emp.id });
    state.pendingActions.push(action);
    state.ghostPreviews.push({ id: 10, type: 'general_work', targetX: 0, targetZ: 0, targetY: 0, claimed: true });
    emp.activeActionId = action.id;
    emp.taskTicksRemaining = 5;

    releaseEmployeeFromWorld(state, emp.id);

    const stored = state.pendingActions.find(a => a.id === 10)!;
    expect(stored.status).toBe('queued');
    expect(stored.holderId).toBeNull();
    expect(state.ghostPreviews.find(g => g.id === 10)!.claimed).toBe(false);
    expect(emp.activeActionId).toBeNull();
    expect(emp.taskTicksRemaining).toBeNull();
  });

  it('clears targetEmployeeId on a queued action targeting the employee, leaving it queued', () => {
    const state = setup();
    const emp = hire(state);
    state.pendingActions.push(makeAction({ id: 11, targetEmployeeId: emp.id }));

    releaseEmployeeFromWorld(state, emp.id);

    const stored = state.pendingActions.find(a => a.id === 11)!;
    expect(stored.status).toBe('queued');
    expect(stored.targetEmployeeId).toBeNull();
  });

  it('releases the vehicle reservation of a held vehicle-gated action', () => {
    const state = setup();
    const emp = hire(state);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);
    state.pendingActions.push(makeAction({ id: 12, status: 'assigned', holderId: emp.id, requiredVehicleRole: 'drill_rig' }));
    emp.activeActionId = 12;
    reserveVehicle(state.vehicles, vehicle.id, 12);

    releaseEmployeeFromWorld(state, emp.id);

    expect(getVehicleReservation(state.vehicles, vehicle.id)).toBeNull();
  });

  it('drops the task queue and itinerary', () => {
    const state = setup();
    const emp = hire(state);
    emp.taskQueue = [21, 22];
    emp.pendingTaskDuration = 4;

    releaseEmployeeFromWorld(state, emp.id);

    expect(emp.taskQueue).toEqual([]);
    expect(emp.itinerary).toBeNull();
    expect(emp.pendingTaskDuration).toBeNull();
  });

  it('works for a dead employee (alive false) and for one no longer in the roster', () => {
    const state = setup();
    const driver = hire(state, 'driver');
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 5, 5);
    vehicle.occupantIds = [driver.id];
    driver.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
    driver.alive = false;
    state.pendingActions.push(makeAction({ id: 30, status: 'assigned', holderId: driver.id }));

    releaseEmployeeFromWorld(state, driver.id);
    expect(vehicle.occupantIds).toEqual([]);
    expect(state.pendingActions.find(a => a.id === 30)!.status).toBe('queued');

    // Gone from the roster: held action and targeted action still released.
    state.pendingActions.push(makeAction({ id: 31, status: 'assigned', holderId: 777, targetEmployeeId: 777 }));
    releaseEmployeeFromWorld(state, 777);
    const stored = state.pendingActions.find(a => a.id === 31)!;
    expect(stored.status).toBe('queued');
    expect(stored.holderId).toBeNull();
    expect(stored.targetEmployeeId).toBeNull();
  });

  it('is idempotent: a second call changes nothing and does not throw', () => {
    const state = setup();
    const driver = hire(state, 'driver');
    assignSkill(state.employees, driver.id, 'driving.truck', 1);
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 5, 5);
    board(state, vehicle.id, driver.id);
    state.pendingActions.push(makeAction({ id: 40, status: 'assigned', holderId: driver.id }));
    driver.taskQueue = [41];

    releaseEmployeeFromWorld(state, driver.id);
    const snapshot = JSON.stringify([state.pendingActions, state.vehicles, state.employees]);
    expect(() => releaseEmployeeFromWorld(state, driver.id)).not.toThrow();

    expect(JSON.stringify([state.pendingActions, state.vehicles, state.employees])).toBe(snapshot);
  });

  it('does nothing to the world when the employee holds, rides and targets nothing', () => {
    const state = setup();
    const emp = hire(state);
    const other = hire(state, 'driller', 9, 9);
    const untouched = makeAction({ id: 50, status: 'assigned', holderId: other.id, targetEmployeeId: other.id });
    state.pendingActions.push(untouched);
    const before = JSON.stringify([state.pendingActions, state.vehicles, state.buildings, other]);

    releaseEmployeeFromWorld(state, emp.id);

    expect(JSON.stringify([state.pendingActions, state.vehicles, state.buildings, other])).toBe(before);
    expect(emp.locomotion).toEqual({ kind: 'on_foot' });
  });
});

describe('fireEmployeeFromWorld (#1378)', () => {
  function setup() {
    const state = createGame({ seed: SEED });
    state.employees = createEmployeeState();
    state.navGrid = makeFlatGrid(20, 20);
    return state;
  }

  it('removes the employee from the roster and releases them from the world', () => {
    const state = setup();
    const { employee } = hireEmployee(state.employees, 'driver', new Random(SEED), 5, 5);
    assignSkill(state.employees, employee.id, 'driving.truck', 1);
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 5, 5);
    board(state, vehicle.id, employee.id);
    state.pendingActions.push(makeAction({ id: 60, status: 'assigned', holderId: employee.id }));
    employee.activeActionId = 60;

    const result = fireEmployeeFromWorld(state, employee.id);

    expect(result.success).toBe(true);
    expect(state.employees.employees.find(e => e.id === employee.id)).toBeUndefined();
    expect(vehicle.occupantIds).toEqual([]);
    expect(state.pendingActions.find(a => a.id === 60)!.status).toBe('queued');
  });

  it('fails for an unknown employee with the existing error and changes nothing', () => {
    const state = setup();
    state.pendingActions.push(makeAction({ id: 61, status: 'assigned', holderId: 999 }));

    const result = fireEmployeeFromWorld(state, 999);

    expect(result).toMatchObject({ success: false, error: 'Employee not found' });
    expect(state.pendingActions.find(a => a.id === 61)!.status).toBe('assigned');
  });

  it('refuses a unionized employee: error unchanged, roster and held action untouched', () => {
    const state = setup();
    const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), 5, 5);
    employee.unionized = true;
    state.pendingActions.push(makeAction({ id: 62, status: 'assigned', holderId: employee.id }));
    employee.activeActionId = 62;
    employee.taskQueue = [63];

    const result = fireEmployeeFromWorld(state, employee.id);

    expect(result).toMatchObject({ success: false, error: 'Cannot fire unionized employee' });
    expect(state.employees.employees).toContain(employee);
    expect(state.pendingActions.find(a => a.id === 62)!.holderId).toBe(employee.id);
    expect(employee.activeActionId).toBe(62);
    expect(employee.taskQueue).toEqual([63]);
  });

  it('force: true fires a unionized employee and releases them', () => {
    const state = setup();
    const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), 5, 5);
    employee.unionized = true;
    state.pendingActions.push(makeAction({ id: 64, status: 'assigned', holderId: employee.id }));

    const result = fireEmployeeFromWorld(state, employee.id, { force: true });

    expect(result.success).toBe(true);
    expect(state.employees.employees.find(e => e.id === employee.id)).toBeUndefined();
    expect(state.pendingActions.find(a => a.id === 64)!.holderId).toBeNull();
  });
});

describe('releaseInjuredEmployeeQueue (#1381)', () => {
  function setup() {
    const state = createGame({ seed: SEED });
    state.employees = createEmployeeState();
    const hire = () => hireEmployee(state.employees, 'driller', new Random(SEED)).employee;
    return { state, hire };
  }

  it('releases a queued, assigned action to the pool: queued, no holder, empty taskQueue', () => {
    const { state, hire } = setup();
    const emp = hire();
    state.pendingActions.push(makeAction({ id: 1, status: 'assigned', holderId: emp.id }));
    emp.taskQueue = [1];
    emp.injured = true;

    releaseInjuredEmployeeQueue(state, emp.id);

    const a = state.pendingActions.find(x => x.id === 1)!;
    expect(a.status).toBe('queued');
    expect(a.holderId).toBeNull();
    expect(emp.taskQueue).toEqual([]);
  });

  it('leaves activeActionId and the in-progress action untouched', () => {
    const { state, hire } = setup();
    const emp = hire();
    state.pendingActions.push(
      makeAction({ id: 1, status: 'in_progress', holderId: emp.id }),
      makeAction({ id: 2, status: 'assigned', holderId: emp.id }),
    );
    emp.activeActionId = 1;
    emp.taskTicksRemaining = 5;
    emp.taskQueue = [2];
    emp.injured = true;

    releaseInjuredEmployeeQueue(state, emp.id);

    const active = state.pendingActions.find(x => x.id === 1)!;
    expect(active.status).toBe('in_progress');
    expect(active.holderId).toBe(emp.id);
    expect(emp.activeActionId).toBe(1);
    expect(emp.taskTicksRemaining).toBe(5);
    expect(state.pendingActions.find(x => x.id === 2)!.status).toBe('queued');
    expect(emp.taskQueue).toEqual([]);
  });

  it('drops the vehicle reservation of a released vehicle-gated action', () => {
    const { state, hire } = setup();
    const emp = hire();
    state.pendingActions.push(makeAction({ id: 3, status: 'assigned', holderId: emp.id, requiredVehicleRole: 'drill_rig' }));
    emp.taskQueue = [3];
    emp.injured = true;
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);
    reserveVehicle(state.vehicles, vehicle.id, 3);

    releaseInjuredEmployeeQueue(state, emp.id);

    expect(getVehicleReservation(state.vehicles, vehicle.id)).toBeNull();
    expect(state.pendingActions.find(x => x.id === 3)!.status).toBe('queued');
  });

  it('keeps the reservation of a haul committed to its own cargo (existing release behaviour)', () => {
    const { state, hire } = setup();
    const emp = hire();
    state.pendingActions.push(makeAction({
      id: 4, type: 'haul_debris', status: 'assigned', holderId: emp.id,
      requiredVehicleRole: 'debris_hauler', payload: { fragmentId: 9 },
    }));
    emp.taskQueue = [4];
    emp.injured = true;
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 0, 0);
    reserveVehicle(state.vehicles, vehicle.id, 4);
    vehicle.cargo = [{ fragmentId: 9, massKg: 100 }];

    releaseInjuredEmployeeQueue(state, emp.id);

    expect(getVehicleReservation(state.vehicles, vehicle.id)).toBe(4);
    expect(vehicle.cargo.length).toBeGreaterThan(0);
    expect(state.pendingActions.find(x => x.id === 4)!.status).toBe('queued');
  });

  it('unclaims the ghost preview and bumps ghostPreviewsRevision', () => {
    const { state, hire } = setup();
    const emp = hire();
    state.pendingActions.push(makeAction({ id: 5, status: 'assigned', holderId: emp.id }));
    state.ghostPreviews.push({ id: 5, type: 'general_work', targetX: 0, targetZ: 0, targetY: 0, claimed: true });
    emp.taskQueue = [5];
    emp.injured = true;
    const before = state.ghostPreviewsRevision;

    releaseInjuredEmployeeQueue(state, emp.id);

    expect(state.ghostPreviews.find(g => g.id === 5)!.claimed).toBe(false);
    expect(state.ghostPreviewsRevision).toBeGreaterThan(before);
  });

  it('clears targetEmployeeId on a queued action targeted at the injured employee', () => {
    const { state, hire } = setup();
    const emp = hire();
    state.pendingActions.push(makeAction({ id: 6, status: 'assigned', holderId: emp.id, targetEmployeeId: emp.id }));
    emp.taskQueue = [6];
    emp.injured = true;

    releaseInjuredEmployeeQueue(state, emp.id);

    expect(state.pendingActions.find(x => x.id === 6)!.targetEmployeeId).toBeNull();
  });

  it('clears targetEmployeeId on a queued, unheld non-rest action targeted at the injured employee', () => {
    const { state, hire } = setup();
    const emp = hire();
    state.pendingActions.push(makeAction({ id: 9, status: 'queued', holderId: null, targetEmployeeId: emp.id }));
    emp.injured = true;

    releaseInjuredEmployeeQueue(state, emp.id);

    expect(state.pendingActions.find(x => x.id === 9)!.targetEmployeeId).toBeNull();
  });

  it('leaves a rest queue entry alone', () => {
    const { state, hire } = setup();
    const emp = hire();
    state.pendingActions.push(makeAction({ id: 7, type: 'rest', status: 'assigned', holderId: emp.id, targetEmployeeId: emp.id }));
    emp.taskQueue = [7];
    emp.injured = true;

    releaseInjuredEmployeeQueue(state, emp.id);

    const rest = state.pendingActions.find(x => x.id === 7)!;
    expect(rest.status).toBe('assigned');
    expect(rest.holderId).toBe(emp.id);
    expect(emp.taskQueue).toEqual([7]);
  });

  it('drops a queue id with no matching action without throwing', () => {
    const { state, hire } = setup();
    const emp = hire();
    emp.taskQueue = [404];
    emp.injured = true;

    expect(() => releaseInjuredEmployeeQueue(state, emp.id)).not.toThrow();
    expect(emp.taskQueue).toEqual([]);
  });

  it('is idempotent', () => {
    const { state, hire } = setup();
    const emp = hire();
    state.pendingActions.push(makeAction({ id: 8, status: 'assigned', holderId: emp.id }));
    state.ghostPreviews.push({ id: 8, type: 'general_work', targetX: 0, targetZ: 0, targetY: 0, claimed: true });
    emp.taskQueue = [8];
    emp.injured = true;

    releaseInjuredEmployeeQueue(state, emp.id);
    const rev = state.ghostPreviewsRevision;
    releaseInjuredEmployeeQueue(state, emp.id);

    expect(state.ghostPreviewsRevision).toBe(rev);
    expect(state.pendingActions.find(x => x.id === 8)!.status).toBe('queued');
    expect(emp.taskQueue).toEqual([]);
  });
});

describe('releaseInjuredEmployeesQueues sweep (#1381)', () => {
  function setup() {
    const state = createGame({ seed: SEED });
    state.employees = createEmployeeState();
    const rng = new Random(SEED);
    const hire = () => hireEmployee(state.employees, 'driller', rng).employee;
    return { state, hire };
  }

  it('releases the queues of several injured employees', () => {
    const { state, hire } = setup();
    const a = hire();
    const b = hire();
    state.pendingActions.push(
      makeAction({ id: 1, status: 'assigned', holderId: a.id }),
      makeAction({ id: 2, status: 'assigned', holderId: b.id }),
    );
    a.taskQueue = [1]; b.taskQueue = [2];
    a.injured = true; b.injured = true;

    releaseInjuredEmployeesQueues(state);

    expect(state.pendingActions.every(x => x.status === 'queued' && x.holderId === null)).toBe(true);
    expect(a.taskQueue).toEqual([]);
    expect(b.taskQueue).toEqual([]);
  });

  it('does not sweep a healed employee', () => {
    const { state, hire } = setup();
    const a = hire();
    state.pendingActions.push(makeAction({ id: 1, status: 'assigned', holderId: a.id }));
    a.taskQueue = [1];
    a.injured = false;

    releaseInjuredEmployeesQueues(state);

    expect(state.pendingActions[0]!.status).toBe('assigned');
    expect(a.taskQueue).toEqual([1]);
  });

  it('does not sweep a dead employee', () => {
    const { state, hire } = setup();
    const a = hire();
    state.pendingActions.push(makeAction({ id: 1, status: 'assigned', holderId: a.id }));
    a.taskQueue = [1];
    a.injured = true;
    a.alive = false;

    releaseInjuredEmployeesQueues(state);

    expect(state.pendingActions[0]!.status).toBe('assigned');
    expect(a.taskQueue).toEqual([1]);
  });

  it('releases a targeted queued action for an injured employee with an empty taskQueue', () => {
    const { state, hire } = setup();
    const a = hire();
    state.pendingActions.push(makeAction({ id: 1, status: 'queued', holderId: null, targetEmployeeId: a.id }));
    a.taskQueue = [];
    a.injured = true;

    releaseInjuredEmployeesQueues(state);

    expect(state.pendingActions[0]!.targetEmployeeId).toBeNull();
  });

  it('leaves a rest-only queue untouched', () => {
    const { state, hire } = setup();
    const a = hire();
    state.pendingActions.push(makeAction({ id: 1, type: 'rest', status: 'assigned', holderId: a.id, targetEmployeeId: a.id }));
    a.taskQueue = [1];
    a.injured = true;

    releaseInjuredEmployeesQueues(state);

    expect(state.pendingActions[0]!.status).toBe('assigned');
    expect(state.pendingActions[0]!.holderId).toBe(a.id);
    expect(a.taskQueue).toEqual([1]);
  });

  it('is idempotent across repeated sweeps', () => {
    const { state, hire } = setup();
    const a = hire();
    state.pendingActions.push(makeAction({ id: 1, status: 'assigned', holderId: a.id }));
    a.taskQueue = [1];
    a.injured = true;

    releaseInjuredEmployeesQueues(state);
    releaseInjuredEmployeesQueues(state);

    expect(state.pendingActions[0]!.status).toBe('queued');
    expect(state.pendingActions[0]!.holderId).toBeNull();
    expect(a.taskQueue).toEqual([]);
  });
});
