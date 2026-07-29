// @vitest-environment jsdom
// BlastSimulator2026 — Roster row class names
//
// EmployeePanel.makeEmployeeRow adds `collapsing` to a row's classList when
// the employee is mid-collapse; styles.ts renders it with a red border/tint
// (issue #405). This locks the class-list logic itself against a stable,
// DOM-independent contract, decoupled from the CSS rule that paints it.

import { describe, it, expect } from 'vitest';
import {
  getEmployeeRowClassNames,
  needValueClass,
  applyNeedValueClass,
  makeTaskQueue,
} from '../../../src/ui/employeeDetailSections.js';
import type { Employee } from '../../../src/core/entities/Employee.js';
import type { GameState, PendingAction } from '../../../src/core/state/GameState.js';

function makeEmployee(overrides?: Partial<Employee>): Employee {
  return {
    id: 1, name: 'Test Worker', role: 'driver', salary: 500, morale: 75,
    unionized: false, injured: false, alive: true, x: 0, z: 0,
    qualifications: [], trainingState: null, activeActionId: null,
    hunger: 100, fatigue: 100, breakNeed: 100, collapsing: false,
    interruptedActionPayload: null, ticksWorked: 0, restTicksRemaining: null, restNeedKey: null,
    ...overrides,
  };
}

describe('getEmployeeRowClassNames', () => {
  it('includes collapsing when the employee is mid-collapse', () => {
    const classNames = getEmployeeRowClassNames(makeEmployee({ collapsing: true }));
    expect(classNames).toContain('collapsing');
  });

  it('omits collapsing for an employee not collapsing (boundary: default state)', () => {
    const classNames = getEmployeeRowClassNames(makeEmployee({ collapsing: false }));
    expect(classNames).not.toContain('collapsing');
  });

  it('omits collapsing for a dead, non-collapsing employee (rejection: unrelated bad state)', () => {
    const classNames = getEmployeeRowClassNames(makeEmployee({ collapsing: false, alive: false }));
    expect(classNames).not.toContain('collapsing');
  });
});

// needValueClass thresholds: green (good) >50, amber (warn) 30–50, red (bad) <30.
describe('needValueClass', () => {
  it('boundary: value=50 is warn, not good (only >50 is good)', () => {
    expect(needValueClass(50)).toBe('warn');
  });

  it('boundary: value=50.01 is good (just above the >50 threshold)', () => {
    expect(needValueClass(50.01)).toBe('good');
  });

  it('boundary: value=30 is warn, not bad (>=30 is warn)', () => {
    expect(needValueClass(30)).toBe('warn');
  });

  it('boundary: value=29.99 is bad (just below the >=30 threshold)', () => {
    expect(needValueClass(29.99)).toBe('bad');
  });

  it('value=100 is good', () => {
    expect(needValueClass(100)).toBe('good');
  });

  it('value=0 is bad', () => {
    expect(needValueClass(0)).toBe('bad');
  });
});

describe('applyNeedValueClass', () => {
  it('replaces a prior threshold class with the current one', () => {
    const el = document.createElement('span');
    applyNeedValueClass(el, 80); // good
    expect(el.classList.contains('good')).toBe(true);

    applyNeedValueClass(el, 20); // bad — should replace 'good', not accumulate
    expect(el.classList.contains('good')).toBe(false);
    expect(el.classList.contains('warn')).toBe(false);
    expect(el.classList.contains('bad')).toBe(true);
  });

  it('applies warn at the value=30 boundary', () => {
    const el = document.createElement('span');
    applyNeedValueClass(el, 30);
    expect(el.classList.contains('warn')).toBe(true);
    expect(el.classList.contains('bad')).toBe(false);
  });
});

// makeTaskQueue lists the pending actions an employee could take. Actions pinned
// to another employee via targetEmployeeId used to be listed in every row, so a
// healthy worker's panel showed a collapsed colleague's rest task as queued work.
describe('makeTaskQueue — queued actions are scoped to the employee', () => {
  function makeAction(id: number, targetEmployeeId: number | null): PendingAction {
    return {
      id, type: 'rest', requiredSkill: null, requiredVehicleRole: null,
      targetX: 0, targetZ: 0, targetY: 0, payload: {}, targetEmployeeId,
    };
  }

  function makeState(actions: PendingAction[]): GameState {
    return { pendingActions: actions } as unknown as GameState;
  }

  it("omits an action pinned to another employee", () => {
    const el = makeTaskQueue(makeEmployee({ id: 1 }), makeState([makeAction(7, 2)]));

    expect(el.textContent).not.toContain('#7');
    expect(el.querySelector('.bs-queue-empty')).not.toBeNull();
  });

  it('lists an action pinned to this employee', () => {
    const el = makeTaskQueue(makeEmployee({ id: 1 }), makeState([makeAction(7, 1)]));

    expect(el.textContent).toContain('#7');
  });

  it('lists an unpinned action, which anyone qualified may claim', () => {
    const el = makeTaskQueue(makeEmployee({ id: 1 }), makeState([makeAction(7, null)]));

    expect(el.textContent).toContain('#7');
  });
});

describe('makeTaskQueue — the active action is not repeated in the queue list', () => {
  it('lists the claimed action only under ACTIVE', () => {
    const action = {
      id: 3, type: 'rest' as const, requiredSkill: null, requiredVehicleRole: null,
      targetX: 0, targetZ: 0, targetY: 0, payload: {}, targetEmployeeId: 1,
    };
    const state = { pendingActions: [action] } as unknown as GameState;

    const el = makeTaskQueue(makeEmployee({ id: 1, activeActionId: 3 }), state);

    const entries = Array.from(el.querySelectorAll('.bs-task-entry'));
    expect(entries).toHaveLength(1);
    expect(entries[0]!.className).toContain('current');
    expect(entries[0]!.textContent).toContain('#3');
  });
});
