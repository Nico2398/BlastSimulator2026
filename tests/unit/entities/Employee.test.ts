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
  type SkillQualification,
  type SkillCategory,
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

describe('Employee — skill qualification fields (3.1)', () => {
  const rng = new Random(1);

  it('newly hired employee has qualifications as an empty array', () => {
    const state = createEmployeeState();
    const { employee } = hireEmployee(state, 'driller', rng);

    expect(employee.qualifications).toBeDefined();
    expect(Array.isArray(employee.qualifications)).toBe(true);
    expect(employee.qualifications).toHaveLength(0);
  });

  it('newly hired employee has trainingState as null', () => {
    const state = createEmployeeState();
    const { employee } = hireEmployee(state, 'blaster', rng);

    expect(employee.trainingState).toBeNull();
  });

  it('a SkillQualification object has the correct shape: category, proficiencyLevel, xp', () => {
    const qual: SkillQualification = {
      category: 'blasting',
      proficiencyLevel: 3,
      xp: 150,
    };

    expect(qual.category).toBe('blasting');
    expect(qual.proficiencyLevel).toBe(3);
    expect(qual.xp).toBe(150);
  });

  it('all six SkillCategory values are valid string literals', () => {
    const categories: SkillCategory[] = [
      'driving.truck',
      'driving.excavator',
      'driving.drill_rig',
      'blasting',
      'management',
      'geology',
    ];

    expect(categories).toHaveLength(6);
    expect(categories).toContain('driving.truck');
    expect(categories).toContain('driving.excavator');
    expect(categories).toContain('driving.drill_rig');
    expect(categories).toContain('blasting');
    expect(categories).toContain('management');
    expect(categories).toContain('geology');
  });

  it('proficiency levels 1 through 5 are all valid values for proficiencyLevel', () => {
    const levels: SkillQualification['proficiencyLevel'][] = [1, 2, 3, 4, 5];

    expect(levels).toHaveLength(5);
    for (const level of levels) {
      const qual: SkillQualification = { category: 'geology', proficiencyLevel: level, xp: 0 };
      expect(qual.proficiencyLevel).toBe(level);
    }
  });
});
