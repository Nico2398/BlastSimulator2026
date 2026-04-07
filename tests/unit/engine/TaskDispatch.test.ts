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
import { dispatchPendingAction } from '../../../src/core/engine/TaskDispatch.js';
import type { PendingAction } from '../../../src/core/state/GameState.js';

// ── Deterministic fixture helpers ────────────────────────────────────────────

const SEED = 42;

/**
 * Build a minimal PendingAction object.
 * Uses plain object literals — does not depend on PendingAction being exported
 * from GameState yet (the type import is stripped by esbuild at runtime).
 */
function makePendingAction(overrides: Partial<{
  id: number;
  requiredSkill: string;
  targetX: number;
  targetZ: number;
  payload: Record<string, unknown>;
}>): PendingAction {
  return {
    id: overrides.id ?? 1,
    requiredSkill: (overrides.requiredSkill ?? 'blasting') as SkillCategory,
    targetX: overrides.targetX ?? 10,
    targetZ: overrides.targetZ ?? 20,
    payload: overrides.payload ?? {},
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
