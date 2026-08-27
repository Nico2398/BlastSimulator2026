// BlastSimulator2026 — CH1.4 Red-phase tests: PendingAction & dispatchPendingAction
//
// Covers: PendingAction interface, GameState.pendingActions,
//         dispatchPendingAction (new module: src/core/engine/TaskDispatch.ts)
//
// WHY THESE TESTS FAIL (Red phase):
//   src/core/engine/TaskDispatch.ts does not exist yet.  Vitest will fail to
//   resolve the module import at load time, causing ALL tests in this file to
//   fail with a "Cannot find module" / module-not-found error.  This is the
//   expected Red-phase outcome.
//
//   Additionally, GameState.pendingActions does not exist yet, so tests that
//   inspect that field would fail with TypeError even if the module were present.
//
// DO NOT implement anything here — only add implementation to src/.

import { describe, it, expect, beforeEach } from 'vitest';
import { Random } from '../../../src/core/math/Random.js';
import { createGame, type GameState } from '../../../src/core/state/GameState.js';
import {
  createEmployeeState,
  hireEmployee,
  assignSkill,
} from '../../../src/core/entities/Employee.js';
import type { SkillCategory } from '../../../src/core/entities/Employee.js';
// ── New module (CH1.4 — does not exist yet; ALL tests fail at import) ─────────
import { dispatchPendingAction, claimPendingAction, completePendingAction, cancelAction, clearActiveTaskFields, interruptActiveAction } from '../../../src/core/engine/TaskDispatch.js';
import type { PendingAction } from '../../../src/core/state/GameState.js';
import { SURVEY_COSTS } from '../../../src/core/config/balance.js';

// ── Deterministic fixture helpers ────────────────────────────────────────────

const SEED = 42;

/**
 * Build a minimal PendingAction object.
 * Uses plain object literals — does not depend on PendingAction being exported
 * from GameState yet (the type import is stripped by esbuild at runtime).
 */
function makePendingAction(overrides: Partial<{
  id: number;
  requiredSkill: string | null;
  targetX: number;
  targetZ: number;
  payload: Record<string, unknown>;
  targetEmployeeId: number | null;
}>): PendingAction {
  return {
    id: overrides.id ?? 1,
    requiredSkill: (overrides.requiredSkill === undefined ? 'blasting' : overrides.requiredSkill) as SkillCategory | null,
    targetX: overrides.targetX ?? 10,
    targetZ: overrides.targetZ ?? 20,
    payload: overrides.payload ?? {},
    targetEmployeeId: overrides.targetEmployeeId ?? null,
  } as unknown as PendingAction;
}

/** Return a GameState whose EmployeeState is pre-populated from a fresh createEmployeeState(). */
function makeGame(): GameState {
  const state = createGame({ seed: SEED });
  // Replace the employees sub-state with a clean one so tests control roster precisely
  state.employees = createEmployeeState();
  return state;
}

/** Add an employee with a specific skill qualification to a game state. */
function addQualifiedEmployee(
  state: GameState,
  skill: string,
  rngSeed: number = SEED,
): void {
  const rng = new Random(rngSeed);
  const { employee } = hireEmployee(state.employees, 'driller', rng);
  // These tests describe routing by skill, so the roster must hold exactly the
  // skill named here. Hiring grants the role's own qualification, which would
  // otherwise make an "unqualified" case accidentally qualified.
  employee.qualifications = [];
  // assignSkill may also be unimplemented — we fall back to direct mutation
  // so the TaskDispatch tests can still describe independent behaviour
  try {
    assignSkill(state.employees, employee.id, skill as SkillCategory, 1);
  } catch {
    // assignSkill not yet implemented: set qualifications directly so the
    // dispatchPendingAction tests can exercise the routing logic independently
    (employee as any).qualifications = [
      { category: skill, proficiencyLevel: 1, xp: 0 },
    ];
  }
}

/**
 * Simulates tickEmployees' claim-time field writes (GameLoop.ts) on top of
 * claimPendingAction — the latter only flips status/holderId, not the
 * employee's own walking/pending-task bookkeeping, which a real claim always
 * sets alongside it. Shared by the cancelAction (#548) and
 * interruptActiveAction (#549) suites below — both need the same claimed-and-
 * walking shape as their starting point.
 */
function simulateClaimWalking(
  state: GameState,
  actionId: number,
  employeeId: number,
  action: { targetX: number; targetZ: number; requiredSkill: string | null; type: string; payload: Record<string, unknown> },
  durationTicks = 10,
): void {
  claimPendingAction(state, actionId, employeeId);
  const emp = state.employees.employees.find(e => e.id === employeeId)!;
  emp.activeActionId = actionId;
  emp.destinationX = action.targetX;
  emp.destinationZ = action.targetZ;
  emp.pendingTaskDuration = durationTicks;
  emp.pendingActionType = action.type as any;
  emp.pendingActionPayload = action.payload;
  emp.activeTaskSkill = action.requiredSkill as any;
}

/**
 * Simulates ArrivalGate's promotion from "walking" to "in_progress"
 * (ArrivalGate.ts): destinationX/Z already nulled by movement, taskTicksRemaining
 * and activeTaskTotalTicks set from pendingTaskDuration, pendingTaskDuration
 * cleared, and the action's own status flips to 'in_progress'. Shared by the
 * cancelAction (#548) and interruptActiveAction (#549) suites below.
 */
function simulateArrival(state: GameState, actionId: number, employeeId: number): void {
  const emp = state.employees.employees.find(e => e.id === employeeId)!;
  emp.destinationX = null;
  emp.destinationZ = null;
  emp.taskTicksRemaining = emp.pendingTaskDuration;
  (emp as any).activeTaskTotalTicks = emp.pendingTaskDuration;
  emp.pendingTaskDuration = null;
  const action = state.pendingActions.find(a => a.id === actionId)!;
  action.status = 'in_progress';
}

// ── Section 1: GameState.pendingActions field ────────────────────────────────

describe('GameState.pendingActions (CH1.4)', () => {
  it('createGame initialises pendingActions as an empty array', () => {
    const state = makeGame();
    // pendingActions does not exist in GameState yet — test will fail until added
    expect((state as any).pendingActions).toEqual([]);
  });
});

// ── Section 2: dispatchPendingAction — unqualified roster ────────────────────

describe('dispatchPendingAction — no qualified employee on roster', () => {
  let state: GameState;

  beforeEach(() => {
    state = makeGame();
  });

  it('returns { success: false, error: "unqualified" } when roster is empty', () => {
    const action = makePendingAction({ requiredSkill: 'blasting' });
    const result = dispatchPendingAction(state, action);

    expect(result.success).toBe(false);
    expect(result.error).toBe('unqualified');
  });

  it('returns { success: false, error: "unqualified" } when no employee has the required skill', () => {
    // Add an employee with 'geology' — not the required 'blasting'
    addQualifiedEmployee(state, 'geology', SEED);

    const action = makePendingAction({ requiredSkill: 'blasting' });
    const result = dispatchPendingAction(state, action);

    expect(result.success).toBe(false);
    expect(result.error).toBe('unqualified');
  });

  it('does not push to pendingActions when the dispatch fails', () => {
    const action = makePendingAction({ requiredSkill: 'management' });
    dispatchPendingAction(state, action);

    const pending: PendingAction[] = (state as any).pendingActions;
    expect(pending).toHaveLength(0);
  });

  it('partial skill match (wrong sub-category) still yields unqualified', () => {
    // Employee has driving.truck but action requires driving.excavator
    addQualifiedEmployee(state, 'driving.truck', SEED);

    const action = makePendingAction({ requiredSkill: 'driving.excavator' });
    const result = dispatchPendingAction(state, action);

    expect(result.success).toBe(false);
    expect(result.error).toBe('unqualified');
  });
});

// ── Section 3: dispatchPendingAction — qualified roster ──────────────────────

describe('dispatchPendingAction — at least one qualified employee on roster', () => {
  let state: GameState;

  beforeEach(() => {
    state = makeGame();
  });

  it('returns { success: true } when a qualified employee exists', () => {
    addQualifiedEmployee(state, 'blasting', SEED);

    const action = makePendingAction({ requiredSkill: 'blasting' });
    const result = dispatchPendingAction(state, action);

    expect(result.success).toBe(true);
  });

  it('does not include an error property on successful dispatch', () => {
    addQualifiedEmployee(state, 'geology', SEED);

    const action = makePendingAction({ requiredSkill: 'geology' });
    const result = dispatchPendingAction(state, action);

    expect(result.error).toBeUndefined();
  });

  it('pushes the action into state.pendingActions on success', () => {
    addQualifiedEmployee(state, 'blasting', SEED);

    const action = makePendingAction({ id: 7, requiredSkill: 'blasting', targetX: 3, targetZ: 9 });
    dispatchPendingAction(state, action);

    const pending: PendingAction[] = (state as any).pendingActions;
    expect(pending).toHaveLength(1);
    expect(pending[0]!.id).toBe(7);
  });

  it('pushed action retains all original fields (id, requiredSkill, targetX, targetZ, payload)', () => {
    addQualifiedEmployee(state, 'management', SEED);

    const payload = { depth: 5, blastId: 'test-99' };
    const action = makePendingAction({
      id: 42, requiredSkill: 'management', targetX: 15, targetZ: 8, payload,
    });
    dispatchPendingAction(state, action);

    const stored: PendingAction = (state as any).pendingActions[0];
    expect(stored.id).toBe(42);
    expect((stored as any).requiredSkill).toBe('management');
    expect(stored.targetX).toBe(15);
    expect(stored.targetZ).toBe(8);
    expect(stored.payload).toEqual(payload);
  });

  it('dispatching multiple actions appends all of them in order', () => {
    addQualifiedEmployee(state, 'blasting', SEED);

    const a1 = makePendingAction({ id: 1, requiredSkill: 'blasting' });
    const a2 = makePendingAction({ id: 2, requiredSkill: 'blasting' });
    const a3 = makePendingAction({ id: 3, requiredSkill: 'blasting' });

    dispatchPendingAction(state, a1);
    dispatchPendingAction(state, a2);
    dispatchPendingAction(state, a3);

    const pending: PendingAction[] = (state as any).pendingActions;
    expect(pending).toHaveLength(3);
    expect(pending[0]!.id).toBe(1);
    expect(pending[1]!.id).toBe(2);
    expect(pending[2]!.id).toBe(3);
  });

  it('one employee with ANY matching skill in their qualifications satisfies the check', () => {
    // Employee has multiple skills; action requires one of them
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    (employee as any).qualifications = [
      { category: 'geology',    proficiencyLevel: 1, xp: 0 },
      { category: 'management', proficiencyLevel: 2, xp: 50 },
    ];

    const action = makePendingAction({ requiredSkill: 'management' });
    const result = dispatchPendingAction(state, action);

    expect(result.success).toBe(true);
  });
});

// ── Section 3b: dispatchPendingAction — targetEmployeeId narrows eligibility ──
//   Regression coverage for #406: a roster-wide "does anyone qualify" check is
//   not sufficient once targetEmployeeId is set — tickEmployees' idleMatch
//   (GameLoop.ts) can only ever be claimed by that one employee, so dispatch
//   must reject when THAT employee specifically lacks requiredSkill, even if a
//   different roster member holds it.

describe('dispatchPendingAction — targeted dispatch to a specific employee (#406)', () => {
  let state: GameState;

  beforeEach(() => {
    state = makeGame();
  });

  it('rejects when the targeted employee lacks requiredSkill, even though another roster member holds it', () => {
    // Driver (id 1): no geology. Blaster (id 2): holds geology.
    const rng = new Random(SEED);
    const { employee: driver } = hireEmployee(state.employees, 'driller', rng);
    driver.qualifications = [];
    const { employee: blaster } = hireEmployee(state.employees, 'driller', rng);
    blaster.qualifications = [];
    assignSkill(state.employees, blaster.id, 'geology', 1);

    const action = makePendingAction({
      requiredSkill: 'geology',
      targetEmployeeId: driver.id,
    });
    const result = dispatchPendingAction(state, action);

    expect(result.success).toBe(false);
    expect(result.error).toBe('unqualified');
    const pending: PendingAction[] = (state as any).pendingActions;
    expect(pending).toHaveLength(0);
  });

  it('accepts when the targeted employee itself holds requiredSkill', () => {
    const rng = new Random(SEED);
    const { employee: blaster } = hireEmployee(state.employees, 'driller', rng);
    blaster.qualifications = [];
    assignSkill(state.employees, blaster.id, 'geology', 1);

    const action = makePendingAction({
      requiredSkill: 'geology',
      targetEmployeeId: blaster.id,
    });
    const result = dispatchPendingAction(state, action);

    expect(result.success).toBe(true);
    const pending: PendingAction[] = (state as any).pendingActions;
    expect(pending).toHaveLength(1);
  });

  it('rejects when targetEmployeeId refers to nobody on the roster', () => {
    const action = makePendingAction({ requiredSkill: 'geology', targetEmployeeId: 999 });
    const result = dispatchPendingAction(state, action);

    expect(result.success).toBe(false);
    expect(result.error).toBe('unqualified');
  });
});

// ── Section 3c: dispatchPendingAction — requiredSkill === null branch ────────
//   "any alive employee qualifies" — success path and reject-when-nobody-alive.

describe('dispatchPendingAction — requiredSkill === null (any alive employee qualifies)', () => {
  let state: GameState;

  beforeEach(() => {
    state = makeGame();
  });

  it('returns { success: true } when at least one alive employee exists, regardless of skills', () => {
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.qualifications = [];

    const action = makePendingAction({ requiredSkill: null });
    const result = dispatchPendingAction(state, action);

    expect(result.success).toBe(true);
    const pending: PendingAction[] = (state as any).pendingActions;
    expect(pending).toHaveLength(1);
  });

  it('returns { success: false, error: "unqualified" } when the roster has nobody alive', () => {
    const action = makePendingAction({ requiredSkill: null });
    const result = dispatchPendingAction(state, action);

    expect(result.success).toBe(false);
    expect(result.error).toBe('unqualified');
    const pending: PendingAction[] = (state as any).pendingActions;
    expect(pending).toHaveLength(0);
  });

  it('targeted dispatch with requiredSkill null succeeds when the target is alive', () => {
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.qualifications = [];

    const action = makePendingAction({ requiredSkill: null, targetEmployeeId: employee.id });
    const result = dispatchPendingAction(state, action);

    expect(result.success).toBe(true);
  });
});

// ── Section 4: cross-SkillCategory dispatch coverage ─────────────────────────
//   Ensures dispatchPendingAction handles every SkillCategory value.

describe('dispatchPendingAction — all SkillCategory values are routable', () => {
  const SKILL_CASES: string[] = [
    'driving.truck', 'driving.excavator', 'driving.drill_rig',
    'blasting', 'management', 'geology',
  ];

  for (const skill of SKILL_CASES) {
    it(`routes successfully when a "${skill}" qualified employee exists`, () => {
      const state = makeGame();
      addQualifiedEmployee(state, skill, SEED);

      const action = makePendingAction({ id: 1, requiredSkill: skill });
      const result = dispatchPendingAction(state, action);

      expect(result.success).toBe(true);
      const pending: PendingAction[] = (state as any).pendingActions;
      expect(pending).toHaveLength(1);
    });

    it(`returns unqualified for "${skill}" when roster has no such skill`, () => {
      const state = makeGame();
      // Add an employee with a DIFFERENT skill to ensure roster is non-empty
      const otherSkill = skill === 'blasting' ? 'geology' : 'blasting';
      addQualifiedEmployee(state, otherSkill, SEED);

      const action = makePendingAction({ id: 1, requiredSkill: skill });
      const result = dispatchPendingAction(state, action);

      expect(result.success).toBe(false);
      expect(result.error).toBe('unqualified');
    });
  }
});

// ── Section 5: PendingAction lifecycle (#547) ────────────────────────────────
//   Claiming no longer deletes the record the instant an employee picks it up
//   — the action (and its ghost) stay visible through the walk and the work
//   itself, only disappearing on genuine completion.

describe('dispatchPendingAction — pushes lifecycle-ready records (#547)', () => {
  let state: GameState;

  beforeEach(() => {
    state = makeGame();
  });

  it('the pushed PendingAction starts life status:"queued", holderId:null', () => {
    addQualifiedEmployee(state, 'blasting', SEED);
    const action = makePendingAction({ id: 1, requiredSkill: 'blasting' });
    dispatchPendingAction(state, action);

    const stored: PendingAction = (state as any).pendingActions[0];
    expect(stored.status).toBe('queued');
    expect(stored.holderId).toBeNull();
  });

  it('the mirrored GhostPreview starts life claimed:false', () => {
    addQualifiedEmployee(state, 'blasting', SEED);
    const action = makePendingAction({ id: 2, requiredSkill: 'blasting', targetX: 4, targetZ: 7 });
    dispatchPendingAction(state, action);

    const ghost = (state as any).ghostPreviews.find((g: { id: number }) => g.id === 2);
    expect(ghost).toBeDefined();
    expect(ghost.claimed).toBe(false);
  });
});

describe('claimPendingAction (#547)', () => {
  let state: GameState;

  beforeEach(() => {
    state = makeGame();
  });

  it('transitions a queued action to "assigned" and stamps holderId, without removing it from pendingActions', () => {
    addQualifiedEmployee(state, 'blasting', SEED);
    const action = makePendingAction({ id: 10, requiredSkill: 'blasting' });
    dispatchPendingAction(state, action);

    const claimed = claimPendingAction(state, 10, 999);

    expect(claimed).not.toBeNull();
    expect(claimed!.status).toBe('assigned');
    expect(claimed!.holderId).toBe(999);
    // Still in the array — not spliced out (#547 is exactly about this).
    const pending: PendingAction[] = (state as any).pendingActions;
    expect(pending).toHaveLength(1);
    expect(pending[0]!.status).toBe('assigned');
    expect(pending[0]!.holderId).toBe(999);
  });

  it('flips the matching GhostPreview to claimed:true without removing it', () => {
    addQualifiedEmployee(state, 'blasting', SEED);
    const action = makePendingAction({ id: 11, requiredSkill: 'blasting' });
    dispatchPendingAction(state, action);

    claimPendingAction(state, 11, 5);

    const ghosts: Array<{ id: number; claimed: boolean }> = (state as any).ghostPreviews;
    expect(ghosts).toHaveLength(1);
    expect(ghosts[0]!.id).toBe(11);
    expect(ghosts[0]!.claimed).toBe(true);
  });

  it('returns null for an id with no matching pendingAction', () => {
    const result = claimPendingAction(state, 9999, 1);
    expect(result).toBeNull();
  });

  it('a second claim on an already-"assigned" action returns null and leaves the original holder intact', () => {
    addQualifiedEmployee(state, 'blasting', SEED);
    const action = makePendingAction({ id: 12, requiredSkill: 'blasting' });
    dispatchPendingAction(state, action);

    const first = claimPendingAction(state, 12, 1);
    expect(first).not.toBeNull();
    expect(first!.holderId).toBe(1);

    const second = claimPendingAction(state, 12, 2);

    expect(second).toBeNull();
    const stored = (state as any).pendingActions.find((a: PendingAction) => a.id === 12);
    expect(stored.holderId).toBe(1);
    expect(stored.status).toBe('assigned');
    // The ghost still reads as claimed by the original holder's claim, not the rejected second one.
    const ghost = (state as any).ghostPreviews.find((g: { id: number }) => g.id === 12);
    expect(ghost.claimed).toBe(true);
  });

  it('a second claim on an "in_progress" action also returns null and leaves the holder intact', () => {
    addQualifiedEmployee(state, 'blasting', SEED);
    const action = makePendingAction({ id: 13, requiredSkill: 'blasting' });
    dispatchPendingAction(state, action);
    claimPendingAction(state, 13, 1);
    // Simulate ArrivalGate's later 'assigned' -> 'in_progress' promotion.
    const stored = (state as any).pendingActions.find((a: PendingAction) => a.id === 13);
    stored.status = 'in_progress';

    const second = claimPendingAction(state, 13, 2);

    expect(second).toBeNull();
    expect(stored.holderId).toBe(1);
    expect(stored.status).toBe('in_progress');
  });
});

describe('completePendingAction (#547)', () => {
  let state: GameState;

  beforeEach(() => {
    state = makeGame();
  });

  it('removes the completed action from pendingActions and returns it', () => {
    addQualifiedEmployee(state, 'blasting', SEED);
    const action = makePendingAction({ id: 20, requiredSkill: 'blasting' });
    dispatchPendingAction(state, action);
    claimPendingAction(state, 20, 1);

    const removed = completePendingAction(state, 20);

    expect(removed).not.toBeNull();
    expect(removed!.id).toBe(20);
    const pending: PendingAction[] = (state as any).pendingActions;
    expect(pending.find(a => a.id === 20)).toBeUndefined();
  });

  it('removes the matching GhostPreview from ghostPreviews', () => {
    addQualifiedEmployee(state, 'blasting', SEED);
    const action = makePendingAction({ id: 21, requiredSkill: 'blasting' });
    dispatchPendingAction(state, action);

    completePendingAction(state, 21);

    const ghosts: Array<{ id: number }> = (state as any).ghostPreviews;
    expect(ghosts.find(g => g.id === 21)).toBeUndefined();
  });

  it('leaves unrelated actions and ghosts untouched', () => {
    addQualifiedEmployee(state, 'blasting', SEED);
    dispatchPendingAction(state, makePendingAction({ id: 22, requiredSkill: 'blasting' }));
    dispatchPendingAction(state, makePendingAction({ id: 23, requiredSkill: 'blasting' }));

    completePendingAction(state, 22);

    const pending: PendingAction[] = (state as any).pendingActions;
    const ghosts: Array<{ id: number }> = (state as any).ghostPreviews;
    expect(pending.find(a => a.id === 23)).toBeDefined();
    expect(ghosts.find(g => g.id === 23)).toBeDefined();
  });

  it('is a safe no-op returning null for an unknown action id', () => {
    addQualifiedEmployee(state, 'blasting', SEED);
    dispatchPendingAction(state, makePendingAction({ id: 24, requiredSkill: 'blasting' }));

    const result = completePendingAction(state, 999999);

    expect(result).toBeNull();
    const pending: PendingAction[] = (state as any).pendingActions;
    expect(pending).toHaveLength(1);
  });

  it('is a safe no-op returning null on an empty pendingActions array', () => {
    const result = completePendingAction(state, 1);
    expect(result).toBeNull();
  });
});

// ── Section 6: cancelAction (#548) ────────────────────────────────────────────
//   Cancel a PendingAction at any lifecycle stage (queued, assigned, in_progress),
//   releasing the employee cleanly, refunding any order-time cost, and removing
//   the ghost. Engine-owned 'rest' actions are never player-cancellable.

describe('cancelAction (#548)', () => {
  let state: GameState;

  beforeEach(() => {
    state = makeGame();
  });

  it('removes a queued, unheld action from pendingActions and ghostPreviews, refunding 0', () => {
    addQualifiedEmployee(state, 'blasting', SEED);
    const action = makePendingAction({ id: 1, requiredSkill: 'blasting' });
    dispatchPendingAction(state, action);

    const result = cancelAction(state, 1);

    expect(result.success).toBe(true);
    expect(result.refunded).toBe(0);
    expect((state as any).pendingActions.find((a: PendingAction) => a.id === 1)).toBeUndefined();
    expect((state as any).ghostPreviews.find((g: { id: number }) => g.id === 1)).toBeUndefined();
  });

  it('resets an assigned (claimed, walking) action holder\'s task-walking fields to null', () => {
    addQualifiedEmployee(state, 'blasting', SEED);
    const empId = state.employees.employees[0]!.id;
    const action = makePendingAction({ id: 2, requiredSkill: 'blasting', targetX: 12, targetZ: 8 });
    dispatchPendingAction(state, action);
    simulateClaimWalking(state, 2, empId, {
      targetX: 12, targetZ: 8, requiredSkill: 'blasting', type: 'general_work', payload: {},
    });

    const result = cancelAction(state, 2);

    expect(result.success).toBe(true);
    const emp = state.employees.employees.find(e => e.id === empId)!;
    expect(emp.activeActionId).toBeNull();
    expect(emp.destinationX).toBeNull();
    expect(emp.destinationZ).toBeNull();
    expect(emp.pendingTaskDuration).toBeNull();
    expect(emp.pendingActionType).toBeNull();
    expect(emp.pendingActionPayload).toBeNull();
    expect(emp.activeTaskSkill).toBeNull();
    expect((state as any).pendingActions.find((a: PendingAction) => a.id === 2)).toBeUndefined();
    expect((state as any).ghostPreviews.find((g: { id: number }) => g.id === 2)).toBeUndefined();
  });

  it('additionally clears taskTicksRemaining/activeTaskTotalTicks for an in-progress action', () => {
    addQualifiedEmployee(state, 'blasting', SEED);
    const empId = state.employees.employees[0]!.id;
    const action = makePendingAction({ id: 3, requiredSkill: 'blasting', targetX: 4, targetZ: 4 });
    dispatchPendingAction(state, action);
    simulateClaimWalking(state, 3, empId, {
      targetX: 4, targetZ: 4, requiredSkill: 'blasting', type: 'general_work', payload: {},
    });
    simulateArrival(state, 3, empId);

    const emp = state.employees.employees.find(e => e.id === empId)!;
    expect(emp.taskTicksRemaining).not.toBeNull();

    const result = cancelAction(state, 3);

    expect(result.success).toBe(true);
    expect(emp.activeActionId).toBeNull();
    expect(emp.taskTicksRemaining).toBeNull();
    expect((emp as any).activeTaskTotalTicks == null).toBe(true);
    expect(emp.activeTaskSkill).toBeNull();
    expect((state as any).pendingActions.find((a: PendingAction) => a.id === 3)).toBeUndefined();
  });

  it('returns { success: false, error: "not-found" } for an unknown action id, leaving state untouched', () => {
    addQualifiedEmployee(state, 'blasting', SEED);
    dispatchPendingAction(state, makePendingAction({ id: 4, requiredSkill: 'blasting' }));

    const result = cancelAction(state, 9999);

    expect(result.success).toBe(false);
    expect(result.error).toBe('not-found');
    const pending: PendingAction[] = (state as any).pendingActions;
    expect(pending).toHaveLength(1);
    expect(pending[0]!.id).toBe(4);
  });

  it('rejects a type:"rest" action with { success: false, error: "not-cancellable" }, leaving it and its holder untouched', () => {
    addQualifiedEmployee(state, 'blasting', SEED);
    const empId = state.employees.employees[0]!.id;
    const emp = state.employees.employees.find(e => e.id === empId)!;

    const restAction: PendingAction = {
      id: 5,
      type: 'rest',
      requiredSkill: null,
      requiredVehicleRole: null,
      targetX: 0, targetZ: 0, targetY: 0,
      payload: {},
      targetEmployeeId: empId,
      status: 'assigned',
      holderId: empId,
    };
    (state as any).pendingActions.push(restAction);
    emp.activeActionId = 5;
    emp.destinationX = 0;
    emp.destinationZ = 0;

    const result = cancelAction(state, 5);

    expect(result.success).toBe(false);
    expect(result.error).toBe('not-cancellable');
    // Nothing changes — the action stays exactly as it was, and the holder
    // keeps their assignment.
    const stored = (state as any).pendingActions.find((a: PendingAction) => a.id === 5);
    expect(stored).toBeDefined();
    expect(stored.status).toBe('assigned');
    expect(stored.holderId).toBe(empId);
    expect(emp.activeActionId).toBe(5);
    expect(emp.destinationX).toBe(0);
    expect(emp.destinationZ).toBe(0);
  });

  it('refunds SURVEY_COSTS[method] and credits state.cash for a queued survey action with a payload.method', () => {
    addQualifiedEmployee(state, 'geology', SEED);
    const beforeCash = state.cash;
    const action = makePendingAction({
      id: 6, requiredSkill: 'geology', payload: { method: 'seismic', centerX: 10, centerZ: 10 },
    });
    (action as any).type = 'survey';
    dispatchPendingAction(state, action);

    const result = cancelAction(state, 6);

    expect(result.success).toBe(true);
    expect(result.refunded).toBe(SURVEY_COSTS.seismic);
    expect(state.cash).toBe(beforeCash + SURVEY_COSTS.seismic);
    const refundTx = state.finances.transactions.find(t => t.category === 'refund');
    expect(refundTx).toBeDefined();
    expect(refundTx!.amount).toBe(SURVEY_COSTS.seismic);
  });

  it('refunds 0 and adds no finance transaction for a non-survey action (general_work)', () => {
    addQualifiedEmployee(state, 'blasting', SEED);
    const beforeCash = state.cash;
    const beforeTxCount = state.finances.transactions.length;
    const action = makePendingAction({ id: 7, requiredSkill: 'blasting' });
    dispatchPendingAction(state, action);

    const result = cancelAction(state, 7);

    expect(result.success).toBe(true);
    expect(result.refunded).toBe(0);
    expect(state.cash).toBe(beforeCash);
    expect(state.finances.transactions).toHaveLength(beforeTxCount);
  });

  it('a second cancel of the same id returns { success: false, error: "not-found" }', () => {
    addQualifiedEmployee(state, 'blasting', SEED);
    const action = makePendingAction({ id: 8, requiredSkill: 'blasting' });
    dispatchPendingAction(state, action);

    const first = cancelAction(state, 8);
    expect(first.success).toBe(true);

    const second = cancelAction(state, 8);
    expect(second.success).toBe(false);
    expect(second.error).toBe('not-found');
  });

  it('resets moveConsecutiveFailures and isMoveStuck on a stuck-mid-walk holder', () => {
    addQualifiedEmployee(state, 'blasting', SEED);
    const empId = state.employees.employees[0]!.id;
    const action = makePendingAction({ id: 9, requiredSkill: 'blasting', targetX: 99, targetZ: 99 });
    dispatchPendingAction(state, action);
    simulateClaimWalking(state, 9, empId, {
      targetX: 99, targetZ: 99, requiredSkill: 'blasting', type: 'general_work', payload: {},
    });
    const emp = state.employees.employees.find(e => e.id === empId)!;
    emp.moveConsecutiveFailures = 3;
    emp.isMoveStuck = true;

    const result = cancelAction(state, 9);

    expect(result.success).toBe(true);
    expect(emp.moveConsecutiveFailures).toBe(0);
    expect(emp.isMoveStuck).toBe(false);
  });
});

describe('clearActiveTaskFields (#548 — shared by cancelAction and tickTaskProgress completion)', () => {
  it('nulls activeActionId/taskTicksRemaining/activeTaskSkill/pendingActionType/pendingActionPayload and deletes activeTaskTotalTicks', () => {
    const state = makeGame();
    addQualifiedEmployee(state, 'blasting', SEED);
    const emp = state.employees.employees[0]!;
    emp.activeActionId = 42;
    emp.taskTicksRemaining = 3;
    (emp as any).activeTaskTotalTicks = 10;
    emp.activeTaskSkill = 'blasting';
    emp.pendingActionType = 'general_work' as any;
    emp.pendingActionPayload = { foo: 'bar' };

    clearActiveTaskFields(emp);

    expect(emp.activeActionId).toBeNull();
    expect(emp.taskTicksRemaining).toBeNull();
    expect('activeTaskTotalTicks' in emp).toBe(false);
    expect(emp.activeTaskSkill).toBeNull();
    expect(emp.pendingActionType).toBeNull();
    expect(emp.pendingActionPayload).toBeNull();
  });

  it('leaves walk/stuck fields (destinationX, moveConsecutiveFailures, isMoveStuck, pendingTaskDuration) untouched — cancelAction clears those itself', () => {
    const state = makeGame();
    addQualifiedEmployee(state, 'blasting', SEED);
    const emp = state.employees.employees[0]!;
    emp.destinationX = 5;
    emp.destinationZ = 7;
    emp.moveConsecutiveFailures = 2;
    emp.isMoveStuck = true;
    emp.pendingTaskDuration = 8;

    clearActiveTaskFields(emp);

    expect(emp.destinationX).toBe(5);
    expect(emp.destinationZ).toBe(7);
    expect(emp.moveConsecutiveFailures).toBe(2);
    expect(emp.isMoveStuck).toBe(true);
    expect(emp.pendingTaskDuration).toBe(8);
  });
});

// ── Section 7: interruptActiveAction (#549) ──────────────────────────────────
//   Needs-driven interruption (collapse, hunger/fatigue forcing a rest):
//   releases the employee's ONE active action back to 'queued' (holder/ghost
//   cleared) instead of completing/removing it, preserves its payload on
//   interruptedActionPayload, and leaves taskQueue untouched so the
//   employee's remaining queued work survives.

describe('interruptActiveAction (#549)', () => {
  let state: GameState;

  beforeEach(() => {
    state = makeGame();
  });

  it('happy path: releases the active action back to "queued", clears holderId/ghost.claimed, stores the payload, and leaves taskQueue untouched', () => {
    addQualifiedEmployee(state, 'blasting', SEED);
    const empId = state.employees.employees[0]!.id;
    const emp = state.employees.employees.find(e => e.id === empId)!;
    const payload = { blastId: 'test-1' };
    const action = makePendingAction({ id: 30, requiredSkill: 'blasting', targetX: 5, targetZ: 6, payload });
    dispatchPendingAction(state, action);
    simulateClaimWalking(state, 30, empId, {
      targetX: 5, targetZ: 6, requiredSkill: 'blasting', type: 'general_work', payload,
    });
    emp.taskQueue = [31, 32];

    interruptActiveAction(state, emp, 30);

    const stored = (state as any).pendingActions.find((a: PendingAction) => a.id === 30);
    expect(stored.status).toBe('queued');
    expect(stored.holderId).toBeNull();
    // targetEmployeeId is left exactly as it was set on dispatch (null here —
    // an open-pool action returns to the open pool).
    expect(stored.targetEmployeeId).toBeNull();

    const ghost = (state as any).ghostPreviews.find((g: { id: number }) => g.id === 30);
    expect(ghost.claimed).toBe(false);

    expect((emp as any).interruptedActionPayload).toEqual(payload);
    expect(emp.activeActionId).toBeNull();
    expect(emp.destinationX).toBeNull();
    expect(emp.destinationZ).toBeNull();
    expect(emp.pendingTaskDuration).toBeNull();
    expect(emp.pendingActionType).toBeNull();
    expect(emp.pendingActionPayload).toBeNull();
    expect(emp.activeTaskSkill).toBeNull();
    // taskQueue (the employee's own queued-but-not-yet-active work) survives
    // the interruption untouched.
    expect(emp.taskQueue).toEqual([31, 32]);
  });

  it('preserves a targeted action\'s targetEmployeeId (stays reserved for its target) on release', () => {
    addQualifiedEmployee(state, 'blasting', SEED);
    const empId = state.employees.employees[0]!.id;
    const emp = state.employees.employees.find(e => e.id === empId)!;
    const action = makePendingAction({ id: 33, requiredSkill: 'blasting', targetEmployeeId: empId });
    dispatchPendingAction(state, action);
    simulateClaimWalking(state, 33, empId, {
      targetX: 10, targetZ: 20, requiredSkill: 'blasting', type: 'general_work', payload: {},
    });

    interruptActiveAction(state, emp, 33);

    const stored = (state as any).pendingActions.find((a: PendingAction) => a.id === 33);
    expect(stored.status).toBe('queued');
    expect(stored.targetEmployeeId).toBe(empId);
  });

  it('no-op on the action record when actionId is null, but still clears the employee\'s walk/task-claim fields', () => {
    addQualifiedEmployee(state, 'blasting', SEED);
    const empId = state.employees.employees[0]!.id;
    const emp = state.employees.employees.find(e => e.id === empId)!;
    emp.activeActionId = null;
    emp.destinationX = 4;
    emp.destinationZ = 4;
    emp.pendingTaskDuration = 10;
    emp.pendingActionType = 'general_work' as any;
    emp.pendingActionPayload = { some: 'value' };
    emp.activeTaskSkill = 'blasting';
    emp.moveConsecutiveFailures = 2;
    emp.isMoveStuck = true;

    interruptActiveAction(state, emp, null);

    expect((emp as any).interruptedActionPayload).toBeNull();
    expect(emp.activeActionId).toBeNull();
    expect(emp.destinationX).toBeNull();
    expect(emp.destinationZ).toBeNull();
    expect(emp.pendingTaskDuration).toBeNull();
    expect(emp.pendingActionType).toBeNull();
    expect(emp.pendingActionPayload).toBeNull();
    expect(emp.activeTaskSkill).toBeNull();
    expect(emp.moveConsecutiveFailures).toBe(0);
    expect(emp.isMoveStuck).toBe(false);
  });

  it('no-op on the action record when the action was already removed from pendingActions (e.g. completed elsewhere), but still clears the employee\'s fields', () => {
    addQualifiedEmployee(state, 'blasting', SEED);
    const empId = state.employees.employees[0]!.id;
    const emp = state.employees.employees.find(e => e.id === empId)!;
    const action = makePendingAction({ id: 34, requiredSkill: 'blasting' });
    dispatchPendingAction(state, action);
    simulateClaimWalking(state, 34, empId, {
      targetX: 1, targetZ: 1, requiredSkill: 'blasting', type: 'general_work', payload: {},
    });
    // Simulate the action having already been completed/removed by another
    // path before interruptActiveAction runs.
    completePendingAction(state, 34);

    interruptActiveAction(state, emp, 34);

    expect((state as any).pendingActions.find((a: PendingAction) => a.id === 34)).toBeUndefined();
    expect((emp as any).interruptedActionPayload).toBeNull();
    expect(emp.activeActionId).toBeNull();
    expect(emp.destinationX).toBeNull();
    expect(emp.destinationZ).toBeNull();
    expect(emp.pendingTaskDuration).toBeNull();
    expect(emp.pendingActionType).toBeNull();
    expect(emp.pendingActionPayload).toBeNull();
    expect(emp.activeTaskSkill).toBeNull();
  });

  it('stashes the employee\'s remaining work-ticks onto the released action\'s payload.durationTicks when arrived and mid-task (progress preserved on resume)', () => {
    addQualifiedEmployee(state, 'blasting', SEED);
    const empId = state.employees.employees[0]!.id;
    const emp = state.employees.employees.find(e => e.id === empId)!;
    const action = makePendingAction({ id: 35, requiredSkill: 'blasting', targetX: 7, targetZ: 7 });
    dispatchPendingAction(state, action);
    // Originally a 24-tick task, claimed and arrived at...
    simulateClaimWalking(state, 35, empId, {
      targetX: 7, targetZ: 7, requiredSkill: 'blasting', type: 'general_work', payload: {},
    }, 24);
    simulateArrival(state, 35, empId);
    // ...with 9 ticks of work left when the interruption hits.
    emp.taskTicksRemaining = 9;

    interruptActiveAction(state, emp, 35);

    const stored = (state as any).pendingActions.find((a: PendingAction) => a.id === 35);
    expect(stored.payload.durationTicks).toBe(9);
  });

  it('does not stash payload.durationTicks when the employee was still walking (taskTicksRemaining null)', () => {
    addQualifiedEmployee(state, 'blasting', SEED);
    const empId = state.employees.employees[0]!.id;
    const emp = state.employees.employees.find(e => e.id === empId)!;
    const action = makePendingAction({ id: 36, requiredSkill: 'blasting', targetX: 8, targetZ: 8 });
    dispatchPendingAction(state, action);
    simulateClaimWalking(state, 36, empId, {
      targetX: 8, targetZ: 8, requiredSkill: 'blasting', type: 'general_work', payload: {},
    });
    expect(emp.taskTicksRemaining).toBeNull();

    interruptActiveAction(state, emp, 36);

    const stored = (state as any).pendingActions.find((a: PendingAction) => a.id === 36);
    expect(stored.payload.durationTicks).toBeUndefined();
  });

  it('does not stash payload.durationTicks when taskTicksRemaining is exactly 0', () => {
    addQualifiedEmployee(state, 'blasting', SEED);
    const empId = state.employees.employees[0]!.id;
    const emp = state.employees.employees.find(e => e.id === empId)!;
    const action = makePendingAction({ id: 37, requiredSkill: 'blasting', targetX: 9, targetZ: 9 });
    dispatchPendingAction(state, action);
    simulateClaimWalking(state, 37, empId, {
      targetX: 9, targetZ: 9, requiredSkill: 'blasting', type: 'general_work', payload: {},
    }, 5);
    simulateArrival(state, 37, empId);
    emp.taskTicksRemaining = 0;

    interruptActiveAction(state, emp, 37);

    const stored = (state as any).pendingActions.find((a: PendingAction) => a.id === 37);
    expect(stored.payload.durationTicks).toBeUndefined();
  });
});

// ── Section 8: ghostPreviewsRevision dirty-check counter (#761) ─────────────
//   GameRenderer.syncEntities() re-syncs ~1000 ghost-preview meshes on every
//   console command unconditionally today, which stalls interaction-mode
//   scenarios (issue #761). The fix gates that resync on a monotonic
//   revision counter TaskDispatch bumps at its four ghostPreviews-mutating
//   sites: dispatchPendingAction (the push), claimPendingAction,
//   completePendingAction, and interruptActiveAction. These tests describe
//   the counter's contract independent of the renderer — GameRenderer's own
//   gating is covered separately in tests/unit/renderer/GameRenderer.test.ts.

describe('GameState.ghostPreviewsRevision (#761)', () => {
  it('starts at 0 on a fresh GameState', () => {
    const state = makeGame();
    expect(state.ghostPreviewsRevision).toBe(0);
  });
});

describe('ghostPreviewsRevision — bumped by exactly the four ghostPreviews-mutating call sites (#761)', () => {
  let state: GameState;

  beforeEach(() => {
    state = makeGame();
  });

  it('dispatchPendingAction increments ghostPreviewsRevision by exactly 1 on a successful dispatch', () => {
    addQualifiedEmployee(state, 'blasting', SEED);
    const before = state.ghostPreviewsRevision;

    dispatchPendingAction(state, makePendingAction({ id: 100, requiredSkill: 'blasting' }));

    expect(state.ghostPreviewsRevision).toBe(before + 1);
  });

  it('a rejected dispatch (no qualified employee, nothing pushed) leaves ghostPreviewsRevision unchanged', () => {
    const before = state.ghostPreviewsRevision;

    dispatchPendingAction(state, makePendingAction({ id: 101, requiredSkill: 'blasting' }));

    expect(state.ghostPreviewsRevision).toBe(before);
  });

  it('claimPendingAction increments ghostPreviewsRevision by exactly 1', () => {
    addQualifiedEmployee(state, 'blasting', SEED);
    dispatchPendingAction(state, makePendingAction({ id: 102, requiredSkill: 'blasting' }));
    const before = state.ghostPreviewsRevision;

    claimPendingAction(state, 102, 999);

    expect(state.ghostPreviewsRevision).toBe(before + 1);
  });

  it('a no-op claim (unknown action id) leaves ghostPreviewsRevision unchanged', () => {
    const before = state.ghostPreviewsRevision;

    claimPendingAction(state, 9999, 1);

    expect(state.ghostPreviewsRevision).toBe(before);
  });

  it('completePendingAction increments ghostPreviewsRevision by exactly 1', () => {
    addQualifiedEmployee(state, 'blasting', SEED);
    dispatchPendingAction(state, makePendingAction({ id: 103, requiredSkill: 'blasting' }));
    const before = state.ghostPreviewsRevision;

    completePendingAction(state, 103);

    expect(state.ghostPreviewsRevision).toBe(before + 1);
  });

  it('a no-op complete (unknown action id) leaves ghostPreviewsRevision unchanged', () => {
    const before = state.ghostPreviewsRevision;

    completePendingAction(state, 9999);

    expect(state.ghostPreviewsRevision).toBe(before);
  });

  it('interruptActiveAction increments ghostPreviewsRevision by exactly 1 when releasing a claimed action', () => {
    addQualifiedEmployee(state, 'blasting', SEED);
    const empId = state.employees.employees[0]!.id;
    const emp = state.employees.employees.find(e => e.id === empId)!;
    const action = makePendingAction({ id: 104, requiredSkill: 'blasting', targetX: 5, targetZ: 6 });
    dispatchPendingAction(state, action);
    simulateClaimWalking(state, 104, empId, {
      targetX: 5, targetZ: 6, requiredSkill: 'blasting', type: 'general_work', payload: {},
    });
    const before = state.ghostPreviewsRevision;

    interruptActiveAction(state, emp, 104);

    expect(state.ghostPreviewsRevision).toBe(before + 1);
  });

  it('interruptActiveAction(actionId: null) touches no ghost and leaves ghostPreviewsRevision unchanged', () => {
    addQualifiedEmployee(state, 'blasting', SEED);
    const emp = state.employees.employees[0]!;
    const before = state.ghostPreviewsRevision;

    interruptActiveAction(state, emp, null);

    expect(state.ghostPreviewsRevision).toBe(before);
  });

  it('interruptActiveAction on an already-completed (removed) action leaves ghostPreviewsRevision unchanged beyond the completion itself', () => {
    addQualifiedEmployee(state, 'blasting', SEED);
    const empId = state.employees.employees[0]!.id;
    const emp = state.employees.employees.find(e => e.id === empId)!;
    const action = makePendingAction({ id: 106, requiredSkill: 'blasting' });
    dispatchPendingAction(state, action);
    simulateClaimWalking(state, 106, empId, {
      targetX: 10, targetZ: 20, requiredSkill: 'blasting', type: 'general_work', payload: {},
    });
    completePendingAction(state, 106);
    const before = state.ghostPreviewsRevision;

    interruptActiveAction(state, emp, 106);

    expect(state.ghostPreviewsRevision).toBe(before);
  });

  it('an unrelated state mutation (advancing tickCount/time, no ghost-preview mutation) does not change ghostPreviewsRevision', () => {
    const before = state.ghostPreviewsRevision;

    state.tickCount += 1;
    state.time += 1000;

    expect(state.ghostPreviewsRevision).toBe(before);
  });

  it('accumulates exactly one increment per mutating call across a dispatch → claim → complete cycle', () => {
    addQualifiedEmployee(state, 'blasting', SEED);
    const empId = state.employees.employees[0]!.id;
    const before = state.ghostPreviewsRevision;

    dispatchPendingAction(state, makePendingAction({ id: 105, requiredSkill: 'blasting' })); // +1
    claimPendingAction(state, 105, empId); // +1
    completePendingAction(state, 105); // +1

    expect(state.ghostPreviewsRevision).toBe(before + 3);
  });
});

// ── Section 9: dispatchPendingAction copies footprint onto the ghost (#556) ──
//   A `place_building` action's payload carries a `footprint` (cell offsets
//   from targetX/targetZ) so the ghost renders the real building's outline
//   (GhostMesh.ts) instead of a single point. Every other action type's ghost
//   must NOT carry a footprint, even when its payload happens to have a field
//   by that name.

describe('dispatchPendingAction — copies place_building footprint onto the ghost (#556)', () => {
  let state: GameState;

  beforeEach(() => {
    state = makeGame();
  });

  it('a dispatched place_building action with payload.footprint gets a matching GhostPreview.footprint', () => {
    addQualifiedEmployee(state, 'blasting', SEED); // requiredSkill: null below — any alive employee qualifies
    const footprint: Array<[number, number]> = [[0, 0], [1, 0], [0, 1], [1, 1]];
    const action = makePendingAction({
      id: 200, requiredSkill: null, targetX: 5, targetZ: 6,
      payload: { buildingOrderId: 1, cost: 8000, footprint, durationTicks: 40 },
    });
    (action as any).type = 'place_building';

    dispatchPendingAction(state, action);

    const ghost = (state as any).ghostPreviews.find((g: { id: number }) => g.id === 200);
    expect(ghost).toBeDefined();
    expect(ghost.footprint).toEqual(footprint);
  });

  it('a dispatched non-place_building action never carries a footprint on its ghost, even with a payload.footprint field', () => {
    addQualifiedEmployee(state, 'blasting', SEED);
    const action = makePendingAction({
      id: 201, requiredSkill: 'blasting',
      payload: { footprint: [[0, 0], [1, 0]] },
    });
    (action as any).type = 'general_work';

    dispatchPendingAction(state, action);

    const ghost = (state as any).ghostPreviews.find((g: { id: number }) => g.id === 201);
    expect(ghost).toBeDefined();
    expect(ghost.footprint).toBeUndefined();
  });

  it('every other action type dispatched alongside a place_building one keeps footprint: undefined on its own ghost', () => {
    addQualifiedEmployee(state, 'blasting', SEED);
    const footprint: Array<[number, number]> = [[0, 0], [1, 0], [0, 1], [1, 1]];
    const buildAction = makePendingAction({
      id: 202, requiredSkill: null, payload: { footprint },
    });
    (buildAction as any).type = 'place_building';
    const drillAction = makePendingAction({ id: 203, requiredSkill: 'blasting', payload: {} });
    (drillAction as any).type = 'drill_hole';

    dispatchPendingAction(state, buildAction);
    dispatchPendingAction(state, drillAction);

    const buildGhost = (state as any).ghostPreviews.find((g: { id: number }) => g.id === 202);
    const drillGhost = (state as any).ghostPreviews.find((g: { id: number }) => g.id === 203);
    expect(buildGhost.footprint).toEqual(footprint);
    expect(drillGhost.footprint).toBeUndefined();
  });

  it('a place_building action whose payload has no footprint leaves the ghost footprint undefined (boundary)', () => {
    addQualifiedEmployee(state, 'blasting', SEED);
    const action = makePendingAction({ id: 204, requiredSkill: null, payload: { cost: 5000 } });
    (action as any).type = 'place_building';

    dispatchPendingAction(state, action);

    const ghost = (state as any).ghostPreviews.find((g: { id: number }) => g.id === 204);
    expect(ghost.footprint).toBeUndefined();
  });
});

// ── Section 10: cancelAction refunds a queued place_building action (#556) ──
//   Mirrors dig_ramp_segment's segmentCost refund (Section 6 above) — a
//   cancelled construction site refunds its payload's `cost` in full via
//   actionOrderCost (TaskCancellation.ts).

describe('cancelAction — refunds a queued place_building action in full (#556)', () => {
  let state: GameState;

  beforeEach(() => {
    state = makeGame();
  });

  it('refunds payload.cost and credits state.cash for a queued place_building action', () => {
    addQualifiedEmployee(state, 'blasting', SEED);
    const beforeCash = state.cash;
    const action = makePendingAction({
      id: 300, requiredSkill: null,
      payload: { buildingOrderId: 1, cost: 15000, footprint: [[0, 0]], durationTicks: 40 },
    });
    (action as any).type = 'place_building';
    dispatchPendingAction(state, action);

    const result = cancelAction(state, 300);

    expect(result.success).toBe(true);
    expect(result.refunded).toBe(15000);
    expect(state.cash).toBe(beforeCash + 15000);
    const refundTx = state.finances.transactions.find(t => t.category === 'refund');
    expect(refundTx).toBeDefined();
    expect(refundTx!.amount).toBe(15000);
  });

  it('refunds 0 when payload.cost is absent (boundary — no charge to give back)', () => {
    addQualifiedEmployee(state, 'blasting', SEED);
    const beforeCash = state.cash;
    const action = makePendingAction({ id: 301, requiredSkill: null, payload: {} });
    (action as any).type = 'place_building';
    dispatchPendingAction(state, action);

    const result = cancelAction(state, 301);

    expect(result.success).toBe(true);
    expect(result.refunded).toBe(0);
    expect(state.cash).toBe(beforeCash);
  });

  it('removes the plannedBuilding\'s pendingAction and ghost on cancel, same as any other action type', () => {
    addQualifiedEmployee(state, 'blasting', SEED);
    const action = makePendingAction({
      id: 302, requiredSkill: null, payload: { cost: 9000, footprint: [[0, 0]] },
    });
    (action as any).type = 'place_building';
    dispatchPendingAction(state, action);

    cancelAction(state, 302);

    expect((state as any).pendingActions.find((a: PendingAction) => a.id === 302)).toBeUndefined();
    expect((state as any).ghostPreviews.find((g: { id: number }) => g.id === 302)).toBeUndefined();
  });
});
