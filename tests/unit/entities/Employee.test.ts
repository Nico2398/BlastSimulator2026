import { describe, it, expect } from 'vitest';
import { Random } from '../../../src/core/math/Random.js';
import {
  createEmployeeState,
  hireEmployee,
  giveRaise,
  fireEmployee,
  processPayCycle,
  getEffectiveness,
  injureEmployee,
  PAY_CYCLE_TICKS,
  HIRING_COSTS,
} from '../../../src/core/entities/Employee.js';

describe('Employee system', () => {
  it('hiring adds employee and deducts hiring cost', () => {
    const state = createEmployeeState();
    const rng = new Random(42);
    const { employee, hiringCost } = hireEmployee(state, 'driller', rng);

    expect(state.employees.length).toBe(1);
    expect(employee.role).toBe('driller');
    expect(employee.name).toBeTruthy();
    expect(hiringCost).toBe(HIRING_COSTS['driller']);
  });

  it('salaries are paid each pay cycle', () => {
    const state = createEmployeeState();
    const rng = new Random(42);
    hireEmployee(state, 'driller', rng);
    const salary = state.employees[0]!.salary;

    // Not yet a full cycle
    for (let i = 0; i < PAY_CYCLE_TICKS - 1; i++) {
      expect(processPayCycle(state)).toBe(0);
    }

    // Full cycle — pay salaries
    const paid = processPayCycle(state);
    expect(paid).toBe(salary);
  });

  it('giving a raise increases salary and morale', () => {
    const state = createEmployeeState();
    const rng = new Random(42);
    hireEmployee(state, 'driller', rng);
    const emp = state.employees[0]!;
    const origSalary = emp.salary;
    const origMorale = emp.morale;

    giveRaise(state, emp.id, 200);
    expect(emp.salary).toBe(origSalary + 200);
    expect(emp.morale).toBeGreaterThan(origMorale);
  });

  it('low morale reduces employee effectiveness', () => {
    const state = createEmployeeState();
    const rng = new Random(42);
    hireEmployee(state, 'driller', rng);
    const emp = state.employees[0]!;

    const normalEff = getEffectiveness(emp);
    emp.morale = 10;
    const lowEff = getEffectiveness(emp);

    expect(lowEff).toBeLessThan(normalEff);
    expect(lowEff).toBeGreaterThan(0);
  });

  it('injured employee cannot work until healed', () => {
    const state = createEmployeeState();
    const rng = new Random(42);
    hireEmployee(state, 'driver', rng);
    const emp = state.employees[0]!;

    injureEmployee(state, emp.id);
    expect(emp.injured).toBe(true);
    expect(getEffectiveness(emp)).toBe(0);
  });

  it('unionized employee cannot be fired (returns error)', () => {
    const state = createEmployeeState();
    // Find a seed that produces a unionized employee
    for (let seed = 0; seed < 100; seed++) {
      const s = createEmployeeState();
      const rng = new Random(seed);
      hireEmployee(s, 'driller', rng);
      if (s.employees[0]!.unionized) {
        const result = fireEmployee(s, s.employees[0]!.id);
        expect(result.success).toBe(false);
        expect(result.error).toContain('unionized');
        return;
      }
    }
    expect.unreachable('No unionized employee found in 100 seeds');
  });
});
