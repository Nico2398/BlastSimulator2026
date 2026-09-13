// BlastSimulator2026 — tutorialStepHelpers hire-step completion regression tests (#409)
//
// Bug: createHireStep used to complete on `employees.length > prevCount &&
// employees.some(e => e.role === role)`. If an employee of the target role
// already existed at snapshot time, the very next hire of an UNRELATED role
// wrongly satisfied both clauses — count went up, and "some employee has this
// role" was already true before the hire. The fix (captureHireStepSnapshot /
// isHireStepComplete) must key off employee IDS: complete only when an
// employee holding `role` has an id that was NOT present at snapshot time.
//
// captureHireStepSnapshot / isHireStepComplete are not exported directly;
// they're exercised through the public `createHireStep` factory, exactly as
// tutorialSteps.test.ts exercises step-specific completion logic.

import { describe, it, expect } from 'vitest';
import {
  createHireStep, hasPendingActionOfType, hasPlannedBuildingOfType,
} from '../../../src/ui/tutorialStepHelpers.js';
import type { GameState, PendingAction } from '../../../src/core/state/GameState.js';
import type { EmployeeRole } from '../../../src/core/entities/Employee.js';

/** Minimal employee shape sufficient for getEmployees() in tutorialStepHelpers.ts. */
interface MinimalEmployee {
  id: number;
  role: EmployeeRole;
}

function stateWithEmployees(employees: MinimalEmployee[]): GameState {
  return { employees: { employees } } as unknown as GameState;
}

describe('tutorialStepHelpers — hire step completion (#409 regression)', () => {
  const step = createHireStep('hire-driller', 'tutorial.hire_driller_title', 'tutorial.hire_driller_text', 'driller');

  // ── 1 — regression case: role already staffed, unrelated hire follows ────
  it('does not complete when an unrelated role is hired after the target role was already staffed', () => {
    // Driller already exists when the step opens (e.g. async survey lag left
    // one on the roster already). Snapshot captures that.
    const before = stateWithEmployees([{ id: 1, role: 'driller' }]);
    const snap = step.captureSnapshot!(before);

    // Player hires a surveyor next — count increases, but no NEW driller
    // appeared. The old buggy check (count up + some driller exists) would
    // wrongly report complete here.
    const after = stateWithEmployees([
      { id: 1, role: 'driller' },
      { id: 2, role: 'surveyor' },
    ]);

    expect(step.isComplete(after, snap)).toBe(false);
  });

  // ── 2 — happy path: genuinely new hire of the target role ────────────────
  it('completes when a genuinely new employee of the target role is hired', () => {
    const before = stateWithEmployees([{ id: 1, role: 'surveyor' }]);
    const snap = step.captureSnapshot!(before);

    const after = stateWithEmployees([
      { id: 1, role: 'surveyor' },
      { id: 2, role: 'driller' },
    ]);

    expect(step.isComplete(after, snap)).toBe(true);
  });

  // ── 3 — boundary: nothing hired at all ────────────────────────────────────
  it('does not complete when no employee has been hired since the snapshot', () => {
    const before = stateWithEmployees([{ id: 1, role: 'surveyor' }]);
    const snap = step.captureSnapshot!(before);

    // State unchanged — player hasn't acted yet.
    expect(step.isComplete(before, snap)).toBe(false);
  });

  it('does not complete from a zero-employee snapshot when nobody is hired', () => {
    const before = stateWithEmployees([]);
    const snap = step.captureSnapshot!(before);

    expect(step.isComplete(before, snap)).toBe(false);
  });

  // ── 4 — boundary: pre-existing id of target role must not count as new ───
  it('does not falsely flag a pre-existing employee of the target role as a new hire', () => {
    const before = stateWithEmployees([{ id: 1, role: 'driller' }]);
    const snap = step.captureSnapshot!(before);

    // Same driller, same id, nothing else changed — not a new hire.
    const after = stateWithEmployees([{ id: 1, role: 'driller' }]);

    expect(step.isComplete(after, snap)).toBe(false);
  });

  it('completes when a new-id employee of the target role is hired even though the old one is still present unchanged', () => {
    const before = stateWithEmployees([{ id: 1, role: 'driller' }]);
    const snap = step.captureSnapshot!(before);

    // id 1 unchanged AND a genuinely new id 2 of the target role appears.
    const after = stateWithEmployees([
      { id: 1, role: 'driller' },
      { id: 2, role: 'driller' },
    ]);

    expect(step.isComplete(after, snap)).toBe(true);
  });

  it('does not complete when the pre-existing employee of the target role is removed and no new one takes its place', () => {
    const before = stateWithEmployees([{ id: 1, role: 'driller' }]);
    const snap = step.captureSnapshot!(before);

    // Roster shrinks — the only driller is gone, nobody new hired.
    const after = stateWithEmployees([]);

    expect(step.isComplete(after, snap)).toBe(false);
  });

  it('completes when the pre-existing employee of the target role is replaced by a new-id employee of that role', () => {
    const before = stateWithEmployees([{ id: 1, role: 'driller' }]);
    const snap = step.captureSnapshot!(before);

    // id 1 (fired) is gone; a distinct new id 2 with the target role is hired.
    const after = stateWithEmployees([{ id: 2, role: 'driller' }]);

    expect(step.isComplete(after, snap)).toBe(true);
  });

  // ── captureSnapshot shape ──────────────────────────────────────────────
  it('captureSnapshot records the ids of employees already holding the target role', () => {
    const before = stateWithEmployees([
      { id: 1, role: 'driller' },
      { id: 2, role: 'surveyor' },
      { id: 3, role: 'driller' },
    ]);
    const snap = step.captureSnapshot!(before) as { prevIdsWithRole: number[] };

    expect(snap.prevIdsWithRole).toEqual(expect.arrayContaining([1, 3]));
    expect(snap.prevIdsWithRole).not.toContain(2);
    expect(snap.prevIdsWithRole.length).toBe(2);
  });
});

// #1014: hasPendingActionOfType / hasPlannedBuildingOfType back the tutorial
// waiting-state's `spentWhen` checks (tutorialStages.ts) — a step's issued
// order counts as "spent" once the simulation genuinely owns it.

function stateWithPendingActions(actions: Partial<PendingAction>[]): GameState {
  return {
    pendingActions: actions.map((a, i) => ({
      id: i + 1, type: 'survey', requiredSkill: null, requiredVehicleRole: null,
      targetX: 0, targetZ: 0, targetY: 0, payload: {}, targetEmployeeId: null,
      status: 'queued', holderId: null, queuedAtTick: 0,
      ...a,
    })),
  } as unknown as GameState;
}

describe('hasPendingActionOfType (#1014)', () => {
  it('reports true when a pending action of the given type is queued', () => {
    const state = stateWithPendingActions([{ type: 'survey' }]);
    expect(hasPendingActionOfType(state, 'survey')).toBe(true);
  });

  it('reports false when no pending action of that type exists', () => {
    const state = stateWithPendingActions([{ type: 'drill_hole' }]);
    expect(hasPendingActionOfType(state, 'survey')).toBe(false);
  });

  it('reports false for an empty pendingActions array', () => {
    const state = stateWithPendingActions([]);
    expect(hasPendingActionOfType(state, 'survey')).toBe(false);
  });

  it('counts a claimed (assigned/in_progress) action too, not only a queued one', () => {
    const state = stateWithPendingActions([{ type: 'haul_debris', status: 'in_progress', holderId: 7 }]);
    expect(hasPendingActionOfType(state, 'haul_debris')).toBe(true);
  });

  it('does not confuse two different action types present at once', () => {
    const state = stateWithPendingActions([{ type: 'drill_hole' }, { type: 'charge_hole' }]);
    expect(hasPendingActionOfType(state, 'survey')).toBe(false);
    expect(hasPendingActionOfType(state, 'charge_hole')).toBe(true);
  });
});

function stateWithPlannedBuildings(types: string[]): GameState {
  return {
    plannedBuildings: types.map((type, i) => ({
      id: i + 1, buildingId: i + 1, type, tier: 1, x: 0, z: 0, actionId: i + 1, cost: 100,
    })),
  } as unknown as GameState;
}

describe('hasPlannedBuildingOfType (#1014)', () => {
  it('reports true when a building of the given type is ordered but not yet built', () => {
    const state = stateWithPlannedBuildings(['living_quarters']);
    expect(hasPlannedBuildingOfType(state, 'living_quarters')).toBe(true);
  });

  it('reports false when no planned building of that type exists', () => {
    const state = stateWithPlannedBuildings(['freight_warehouse']);
    expect(hasPlannedBuildingOfType(state, 'living_quarters')).toBe(false);
  });

  it('reports false once the plannedBuildings list is empty (order landed, or never issued)', () => {
    const state = stateWithPlannedBuildings([]);
    expect(hasPlannedBuildingOfType(state, 'living_quarters')).toBe(false);
  });

  it('does not confuse two different building types present at once', () => {
    const state = stateWithPlannedBuildings(['driving_center', 'freight_warehouse']);
    expect(hasPlannedBuildingOfType(state, 'living_quarters')).toBe(false);
    expect(hasPlannedBuildingOfType(state, 'freight_warehouse')).toBe(true);
  });
});
