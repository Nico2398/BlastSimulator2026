import { describe, it, expect } from 'vitest';
import { Random } from '../../../src/core/math/Random.js';
import {
  createEmployeeState,
  hireEmployee,
  bestAvailableManagerLevel,
  qualificationAtLevel,
  type Employee,
  type EmployeeRole,
} from '../../../src/core/entities/Employee.js';

function make(role: EmployeeRole, level: 1 | 2 | 3 | 4 | 5 | null = 1, category: 'management' | 'geology' = 'management'): Employee {
  const state = createEmployeeState();
  const { employee } = hireEmployee(state, role, new Random(42));
  employee.qualifications = level === null ? [] : [qualificationAtLevel(category, level)];
  return employee;
}

describe('bestAvailableManagerLevel (#1340)', () => {
  it('is null for an empty roster', () => {
    expect(bestAvailableManagerLevel([])).toBeNull();
  });

  it('is null when no employee is a manager', () => {
    expect(bestAvailableManagerLevel([make('driller'), make('surveyor')])).toBeNull();
  });

  it('is null when the only manager is dead', () => {
    const m = make('manager', 3);
    m.alive = false;
    expect(bestAvailableManagerLevel([m])).toBeNull();
  });

  it('is null when the only manager is injured', () => {
    const m = make('manager', 3);
    m.injured = true;
    expect(bestAvailableManagerLevel([m])).toBeNull();
  });

  it('is null when the only manager is in training', () => {
    const m = make('manager', 3);
    m.trainingState = { buildingId: 1, skill: 'management', ticksRemaining: 5, fee: 0 };
    expect(bestAvailableManagerLevel([m])).toBeNull();
  });

  it('is null for a manager with no management qualification', () => {
    expect(bestAvailableManagerLevel([make('manager', null)])).toBeNull();
    expect(bestAvailableManagerLevel([make('manager', 4, 'geology')])).toBeNull();
  });

  it('returns the level of a single eligible manager', () => {
    expect(bestAvailableManagerLevel([make('manager', 1)])).toBe(1);
  });

  it('returns the maximum management level across eligible managers', () => {
    expect(bestAvailableManagerLevel([make('manager', 2), make('manager', 4), make('manager', 3)])).toBe(4);
  });

  it('ignores an injured L5 manager in favour of a healthy L2', () => {
    const hurt = make('manager', 5);
    hurt.injured = true;
    expect(bestAvailableManagerLevel([hurt, make('manager', 2)])).toBe(2);
  });

  it('ignores non-manager roles that hold management', () => {
    expect(bestAvailableManagerLevel([make('driller', 5), make('manager', 1)])).toBe(1);
  });
});
