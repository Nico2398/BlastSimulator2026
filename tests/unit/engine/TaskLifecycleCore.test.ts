// BlastSimulator2026 — Tests for TaskLifecycleCore's active-task-field
// clearing and completion helpers.

import { describe, it, expect } from 'vitest';
import { createGame, type PendingAction } from '../../../src/core/state/GameState.js';
import { completeIfOwnedRestAction } from '../../../src/core/engine/TaskLifecycleCore.js';

function makeAction(overrides: Partial<PendingAction> & { id: number; type: PendingAction['type'] }): PendingAction {
  return {
    requiredSkill: null,
    requiredVehicleRole: null,
    targetX: 0,
    targetZ: 0,
    targetY: 0,
    payload: {},
    targetEmployeeId: null,
    status: 'in_progress',
    holderId: null,
    ...overrides,
  };
}

describe('completeIfOwnedRestAction', () => {
  const SEED = 42;

  // ── Happy path ───────────────────────────────────────────────────────────
  it('completes and removes the action when it still names a rest action', () => {
    const state = createGame({ seed: SEED });
    const action = makeAction({ id: 1, type: 'rest' });
    state.pendingActions.push(action);

    const result = completeIfOwnedRestAction(state, 1);

    expect(result).toEqual(action);
    expect(state.pendingActions.find(a => a.id === 1)).toBeUndefined();
  });

  // ── Rejection: guard against the #928 stale-claim race ─────────────────
  // ArrivalGate.ts's own vehicle-gated arrival-promotion loop could, before
  // its own stale-claim guard was added, leave an employee's activeActionId
  // naming an unrelated, still-genuinely-in-progress action by rest-
  // completion time (RestCompletion.ts, ShiftCycle.ts). This must not delete
  // that unrelated action.
  it('does not complete or remove an action whose type is not rest', () => {
    const state = createGame({ seed: SEED });
    const action = makeAction({ id: 2, type: 'charge_hole' });
    state.pendingActions.push(action);

    const result = completeIfOwnedRestAction(state, 2);

    expect(result).toBeNull();
    expect(state.pendingActions.find(a => a.id === 2)).toBe(action);
  });

  // ── Boundary: null actionId is a safe no-op ─────────────────────────────
  it('returns null and does nothing when actionId is null', () => {
    const state = createGame({ seed: SEED });
    const action = makeAction({ id: 3, type: 'rest' });
    state.pendingActions.push(action);

    const result = completeIfOwnedRestAction(state, null);

    expect(result).toBeNull();
    expect(state.pendingActions.find(a => a.id === 3)).toBe(action);
  });
});
