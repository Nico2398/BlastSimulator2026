// @vitest-environment jsdom
// BlastSimulator2026 — Roster row class names
//
// EmployeePanel.makeEmployeeRow adds `collapsing` to a row's classList when
// the employee is mid-collapse, but no CSS rule renders it — a visual
// no-op (issue #405). This locks the class-list logic itself so a fix to
// styles.ts can be verified against a stable, DOM-independent contract.

import { describe, it, expect } from 'vitest';
import { getEmployeeRowClassNames } from '../../../src/ui/employeeDetailSections.js';
import type { Employee } from '../../../src/core/entities/Employee.js';

function makeEmployee(overrides?: Partial<Employee>): Employee {
  return {
    id: 1, name: 'Test Worker', role: 'driver', salary: 500, morale: 75,
    unionized: false, injured: false, alive: true, x: 0, z: 0,
    qualifications: [], trainingState: null, activeActionId: null,
    hunger: 100, fatigue: 100, breakNeed: 100, collapsing: false,
    interruptedActionPayload: null, ticksWorked: 0, restTicksRemaining: null,
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
