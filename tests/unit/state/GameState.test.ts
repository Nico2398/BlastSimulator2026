import { describe, it, expect, beforeEach } from 'vitest';
import { createGame } from '../../../src/core/state/GameState.js';
import type { GameState, PendingAction, ActionType } from '../../../src/core/state/GameState.js';
import { tick } from '../../../src/core/state/GameLoop.js';
import { Random } from '../../../src/core/math/Random.js';
import {
  createEmployeeState,
  hireEmployee,
  assignSkill,
} from '../../../src/core/entities/Employee.js';
import type { SkillCategory } from '../../../src/core/entities/Employee.js';
// ── Task 3.8 imports ─────────────────────────────────────────────────────────
// `dispatchPendingAction` already exists. `claimPendingAction` does NOT exist
// yet.  We use a namespace import so that the missing named export resolves to
// `undefined` at runtime rather than throwing a hard SyntaxError at module-load
// time, allowing every test to fail individually at the assertion / call-site.
import * as TaskDispatch from '../../../src/core/engine/TaskDispatch.js';

const dispatchPendingAction = TaskDispatch.dispatchPendingAction;
// claimPendingAction is undefined until task 3.8 is implemented in src/
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const claimPendingAction = (TaskDispatch as any).claimPendingAction as
  | ((state: GameState, actionId: number) => PendingAction | null)
  | undefined;

describe('createGame', () => {
  it('returns a valid GameState with default fields', () => {
    const state = createGame({ seed: 42 });
    expect(state.seed).toBe(42);
    expect(state.time).toBe(0);
    expect(state.timeScale).toBe(1);
    expect(state.isPaused).toBe(false);
    expect(state.version).toBeDefined();
  });

  it('uses provided config values', () => {
    const state = createGame({ seed: 99 });
    expect(state.seed).toBe(99);
  });
});

describe('tick', () => {
  it('advances time by dt * timeScale', () => {
    const state = createGame({ seed: 42 });
    tick(state, 100);
    expect(state.time).toBe(100);
  });

  it('does not advance time when paused', () => {
    const state = createGame({ seed: 42 });
    state.isPaused = true;
    tick(state, 100);
    expect(state.time).toBe(0);
  });

  it('changing timeScale to 4 makes time advance 4x faster', () => {
    const state = createGame({ seed: 42 });
    state.timeScale = 4;
    tick(state, 100);
    expect(state.time).toBe(400);
  });

  it('increments tickCount each tick', () => {
    const state = createGame({ seed: 42 });
    tick(state, 50);
    tick(state, 50);
    expect(state.tickCount).toBe(2);
  });

  it('does not increment tickCount when paused', () => {
    const state = createGame({ seed: 42 });
    state.isPaused = true;
    tick(state, 50);
    expect(state.tickCount).toBe(0);
  });
});

// =============================================================================
// Task 3.8 — Ghost-preview list in GameState
// =============================================================================
//
// WHY THESE TESTS FAIL (Red phase):
//   1. `GameState` has no `ghostPreviews: GhostPreview[]` field yet.
//      Every assertion touching `state.ghostPreviews` will fail because the
//      field is `undefined` (not an array).
//   2. `TaskDispatch.ts` does not yet export `claimPendingAction`.
//      `claimPendingAction` above will be `undefined`; every test that calls
//      it will throw: "TypeError: claimPendingAction is not a function".
//   3. `dispatchPendingAction` does not yet write to `ghostPreviews`, so even
//      if the field existed the ghost-entry assertions would still fail.
//
// DO NOT implement anything here — only add implementation to src/.
// =============================================================================

// ── Shared seed & local expected shape (mirrors the future GhostPreview) ─────

const GHOST_SEED = 42;

/** Minimal expected shape of a GhostPreview entry (documented for implementer). */
interface GhostPreviewShape {
  id: number;
  type: ActionType;
  targetX: number;
  targetZ: number;
  targetY: number;
}

// ── Fixture helpers ───────────────────────────────────────────────────────────

/** Create a blank game state with an empty employee roster. */
function makeGame(): GameState {
  const state = createGame({ seed: GHOST_SEED });
  state.employees = createEmployeeState();
  return state;
}

/**
 * Build a fully-specified PendingAction.
 * Providing explicit `type` lets ghost-preview tests verify the field is
 * copied correctly from the action onto the GhostPreview entry.
 */
function makeAction(overrides: Partial<PendingAction> = {}): PendingAction {
  return {
    id: 1,
    type: 'drill_hole' as ActionType,
    requiredSkill: 'blasting' as SkillCategory,
    requiredVehicleRole: null,
    targetX: 10,
    targetZ: 20,
    targetY: 5,
    payload: {},
    ...overrides,
  } as PendingAction;
}

/**
 * Add a qualified employee to `state.employees` for the given skill.
 * Falls back to direct mutation if `assignSkill` is not yet implemented.
 */
function addQualifiedEmployee(
  state: GameState,
  skill: SkillCategory,
  rngSeed: number = GHOST_SEED,
): void {
  const rng = new Random(rngSeed);
  const { employee } = hireEmployee(state.employees, 'driller', rng);
  try {
    assignSkill(state.employees, employee.id, skill, 1);
  } catch {
    // assignSkill may not be implemented yet — set qualifications directly
    (employee as Record<string, unknown>).qualifications = [
      { category: skill, proficiencyLevel: 1, xp: 0 },
    ];
  }
}

// ── 3.8.1 — createGame initialises ghostPreviews ──────────────────────────────

describe('createGame — ghostPreviews (task 3.8)', () => {
  it('initialises ghostPreviews as an empty array', () => {
    // FAILS: `ghostPreviews` does not exist on GameState yet → value is undefined
    const state = createGame({ seed: GHOST_SEED });
    expect((state as any).ghostPreviews).toEqual([]);
  });
});

// ── 3.8.2 — dispatchPendingAction adds a ghost entry on success ───────────────

describe('dispatchPendingAction — ghost preview side-effect (task 3.8)', () => {
  let state: GameState;

  beforeEach(() => {
    state = makeGame();
    addQualifiedEmployee(state, 'blasting');
  });

  it('adds one GhostPreview entry to ghostPreviews on a successful dispatch', () => {
    // FAILS: ghostPreviews is undefined and dispatchPendingAction does not write to it
    dispatchPendingAction(state, makeAction({ id: 1 }));

    expect((state as any).ghostPreviews).toHaveLength(1);
  });

  it('ghost entry id matches the dispatched action id', () => {
    // FAILS: ghostPreviews is undefined
    dispatchPendingAction(state, makeAction({ id: 7 }));

    const ghost: GhostPreviewShape = (state as any).ghostPreviews[0];
    expect(ghost.id).toBe(7);
  });

  it('ghost entry type matches the dispatched action type', () => {
    // FAILS: ghostPreviews is undefined
    dispatchPendingAction(state, makeAction({ id: 1, type: 'charge_hole' }));

    const ghost: GhostPreviewShape = (state as any).ghostPreviews[0];
    expect(ghost.type).toBe('charge_hole');
  });

  it('ghost entry carries the correct targetX, targetZ, targetY', () => {
    // FAILS: ghostPreviews is undefined
    dispatchPendingAction(
      state,
      makeAction({ id: 1, targetX: 3, targetZ: 9, targetY: 2 }),
    );

    const ghost: GhostPreviewShape = (state as any).ghostPreviews[0];
    expect(ghost.targetX).toBe(3);
    expect(ghost.targetZ).toBe(9);
    expect(ghost.targetY).toBe(2);
  });

  it('failed dispatch (unqualified roster) does NOT add a ghost entry', () => {
    // FAILS: ghostPreviews is undefined (but the assertion would also fail
    // because dispatchPendingAction must not write to ghostPreviews on failure)
    const freshState = makeGame(); // no qualified employees
    dispatchPendingAction(freshState, makeAction({ requiredSkill: 'blasting' }));

    expect((freshState as any).ghostPreviews).toHaveLength(0);
  });

  it('dispatching N actions creates exactly N ghost entries', () => {
    // FAILS: ghostPreviews is undefined
    dispatchPendingAction(state, makeAction({ id: 1 }));
    dispatchPendingAction(state, makeAction({ id: 2 }));
    dispatchPendingAction(state, makeAction({ id: 3 }));

    expect((state as any).ghostPreviews).toHaveLength(3);
  });

  it('ghost entries appear in dispatch order', () => {
    // FAILS: ghostPreviews is undefined
    dispatchPendingAction(state, makeAction({ id: 10 }));
    dispatchPendingAction(state, makeAction({ id: 20 }));

    const ghosts: GhostPreviewShape[] = (state as any).ghostPreviews;
    expect(ghosts[0]?.id).toBe(10);
    expect(ghosts[1]?.id).toBe(20);
  });
});

// ── 3.8.3 — claimPendingAction removes action and ghost, returns action ───────

describe('claimPendingAction (task 3.8)', () => {
  let state: GameState;

  beforeEach(() => {
    state = makeGame();
    addQualifiedEmployee(state, 'blasting');
    // Dispatch a known action so pendingActions and ghostPreviews are pre-populated
    dispatchPendingAction(state, makeAction({ id: 99, targetX: 1, targetZ: 2, targetY: 0 }));
  });

  it('removes the action from pendingActions', () => {
    // FAILS: claimPendingAction is not a function (not yet exported)
    claimPendingAction!(state, 99);

    expect((state as any).pendingActions).toHaveLength(0);
  });

  it('removes the corresponding ghost from ghostPreviews', () => {
    // FAILS: claimPendingAction is not a function (not yet exported)
    claimPendingAction!(state, 99);

    expect((state as any).ghostPreviews).toHaveLength(0);
  });

  it('returns the claimed PendingAction object', () => {
    // FAILS: claimPendingAction is not a function (not yet exported)
    const claimed = claimPendingAction!(state, 99);

    expect(claimed).not.toBeNull();
    expect(claimed!.id).toBe(99);
  });

  it('returned action retains all original fields', () => {
    // FAILS: claimPendingAction is not a function (not yet exported)
    const claimed = claimPendingAction!(state, 99);

    expect(claimed!.targetX).toBe(1);
    expect(claimed!.targetZ).toBe(2);
    expect(claimed!.targetY).toBe(0);
  });

  it('returns null when actionId does not exist in pendingActions', () => {
    // FAILS: claimPendingAction is not a function (not yet exported)
    const result = claimPendingAction!(state, 9999);

    expect(result).toBeNull();
  });

  it('does not modify pendingActions when actionId is not found', () => {
    // FAILS: claimPendingAction is not a function (not yet exported)
    claimPendingAction!(state, 9999);

    expect((state as any).pendingActions).toHaveLength(1);
  });

  it('does not modify ghostPreviews when actionId is not found', () => {
    // FAILS: claimPendingAction is not a function (not yet exported)
    claimPendingAction!(state, 9999);

    expect((state as any).ghostPreviews).toHaveLength(1);
  });

  it('claiming one action out of many removes only that action from pendingActions', () => {
    // FAILS: claimPendingAction is not a function (not yet exported)
    // Add two more actions (id 100 and 101) on top of the id-99 from beforeEach
    dispatchPendingAction(state, makeAction({ id: 100 }));
    dispatchPendingAction(state, makeAction({ id: 101 }));

    claimPendingAction!(state, 100);

    const pending: PendingAction[] = (state as any).pendingActions;
    expect(pending).toHaveLength(2);
    expect(pending.map(a => a.id)).not.toContain(100);
    expect(pending.map(a => a.id)).toContain(99);
    expect(pending.map(a => a.id)).toContain(101);
  });

  it('claiming one action out of many removes only that ghost from ghostPreviews', () => {
    // FAILS: claimPendingAction is not a function (not yet exported)
    dispatchPendingAction(state, makeAction({ id: 100 }));
    dispatchPendingAction(state, makeAction({ id: 101 }));

    claimPendingAction!(state, 100);

    const ghosts: GhostPreviewShape[] = (state as any).ghostPreviews;
    expect(ghosts).toHaveLength(2);
    expect(ghosts.map(g => g.id)).not.toContain(100);
    expect(ghosts.map(g => g.id)).toContain(99);
    expect(ghosts.map(g => g.id)).toContain(101);
  });
});
