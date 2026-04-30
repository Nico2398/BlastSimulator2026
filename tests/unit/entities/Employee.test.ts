import { describe, it, expect, vi } from 'vitest';
import { Random } from '../../../src/core/math/Random.js';
import {
  createEmployeeState,
  hireEmployee,
  giveRaise,
  fireEmployee,
  processPayCycle,
  getEffectiveness,
  injureEmployee,
  assignSkill,
  gainXp,
  calculateSalary,
  BASE_SALARIES,
  PAY_CYCLE_TICKS,
  HIRING_COSTS,
  // ── 3.10: need-meter functions ──
  tickNeeds,
  getNeedMultiplier,
  tickNeedMorale,
  replenishNeed,
  type SkillQualification,
  type SkillCategory,
  type NeedKey,
} from '../../../src/core/entities/Employee.js';
import {
  XP_THRESHOLDS,
  QUALIFICATION_SALARY_BONUS,
  // ── 3.10: need-meter balance constants ──
  NEED_DRAIN_RATES,
  NEED_THRESHOLDS,
} from '../../../src/core/config/balance.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';

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

describe('gainXp() (3.3)', () => {
  // ── Test 1 ──────────────────────────────────────────────────────────────────
  it('returns null when the employee does not exist', () => {
    const state = createEmployeeState();

    const result = gainXp(state, 999, 'blasting', 50);

    expect(result).toBeNull();
  });

  // ── Test 2 ──────────────────────────────────────────────────────────────────
  it('returns null when the employee has no qualification for the given category', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'blaster', rng);
    // employee has an empty qualifications array — no 'blasting' entry

    const result = gainXp(state, employee.id, 'blasting', 50);

    expect(result).toBeNull();
  });

  // ── Test 3 ──────────────────────────────────────────────────────────────────
  it('adds XP to the matching qualification without leveling up (XP below threshold)', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'blaster', rng);
    assignSkill(state, employee.id, 'blasting', 1); // level 1, xp = 0

    gainXp(state, employee.id, 'blasting', 50); // 50 < XP_THRESHOLDS[2] (100)

    const qual = employee.qualifications.find(q => q.category === 'blasting')!;
    expect(qual.xp).toBe(50);
    expect(qual.proficiencyLevel).toBe(1);
  });

  // ── Test 4 ──────────────────────────────────────────────────────────────────
  it('returns leveledUp: false when no level-up occurred', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'blaster', rng);
    assignSkill(state, employee.id, 'blasting', 1);

    const result = gainXp(state, employee.id, 'blasting', 50);

    expect(result).not.toBeNull();
    expect(result!.leveledUp).toBe(false);
    expect(result!.oldLevel).toBe(1);
    expect(result!.newLevel).toBe(1);
  });

  // ── Test 5 ──────────────────────────────────────────────────────────────────
  it('levels up from 1 to 2 when XP crosses the 100 threshold', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'blaster', rng);
    assignSkill(state, employee.id, 'blasting', 1);

    gainXp(state, employee.id, 'blasting', XP_THRESHOLDS[2]); // exactly 100

    const qual = employee.qualifications.find(q => q.category === 'blasting')!;
    expect(qual.proficiencyLevel).toBe(2);
  });

  // ── Test 6 ──────────────────────────────────────────────────────────────────
  it('returns leveledUp: true with correct oldLevel and newLevel on level-up', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'blaster', rng);
    assignSkill(state, employee.id, 'blasting', 1);

    const result = gainXp(state, employee.id, 'blasting', XP_THRESHOLDS[2]); // 100

    expect(result).not.toBeNull();
    expect(result!.leveledUp).toBe(true);
    expect(result!.oldLevel).toBe(1);
    expect(result!.newLevel).toBe(2);
  });

  // ── Test 7 ──────────────────────────────────────────────────────────────────
  it('emits employee:levelup event with correct payload when an emitter is provided', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'blaster', rng);
    assignSkill(state, employee.id, 'blasting', 1);

    const emitter = new EventEmitter();
    const emitSpy = vi.spyOn(emitter, 'emit');

    gainXp(state, employee.id, 'blasting', XP_THRESHOLDS[2], emitter);

    expect(emitSpy).toHaveBeenCalledOnce();
    expect(emitSpy.mock.calls[0]![0]).toBe('employee:levelup');
    expect(emitSpy.mock.calls[0]![1]).toEqual({
      employeeId: employee.id,
      category: 'blasting',
      oldLevel: 1,
      newLevel: 2,
    });
  });

  // ── Test 8 ──────────────────────────────────────────────────────────────────
  it('does not emit event when no emitter is provided', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'blaster', rng);
    assignSkill(state, employee.id, 'blasting', 1);

    // Passing no emitter must not throw and must still return a valid result
    const result = gainXp(state, employee.id, 'blasting', XP_THRESHOLDS[2]);

    expect(result).not.toBeNull();
    expect(result!.leveledUp).toBe(true);
  });

  // ── Test 9 ──────────────────────────────────────────────────────────────────
  it('does not level up beyond level 5 (at level 5, XP accumulates but proficiency stays at 5)', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'blaster', rng);
    assignSkill(state, employee.id, 'blasting', 5);
    // Manually prime xp to the level-5 threshold so there is no ambiguity
    const qual = employee.qualifications.find(q => q.category === 'blasting')!;
    qual.xp = XP_THRESHOLDS[5]; // 1000

    gainXp(state, employee.id, 'blasting', 500);

    expect(qual.proficiencyLevel).toBe(5);
    expect(qual.xp).toBe(XP_THRESHOLDS[5] + 500); // xp still added: 1500
  });

  // ── Test 10 ─────────────────────────────────────────────────────────────────
  it('XP accumulates correctly across multiple calls (no level-up each time)', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'blaster', rng);
    assignSkill(state, employee.id, 'blasting', 1);

    gainXp(state, employee.id, 'blasting', 30);
    gainXp(state, employee.id, 'blasting', 30);
    gainXp(state, employee.id, 'blasting', 30);

    const qual = employee.qualifications.find(q => q.category === 'blasting')!;
    expect(qual.xp).toBe(90);              // 30 + 30 + 30
    expect(qual.proficiencyLevel).toBe(1); // 90 < threshold[2] (100), still level 1
  });

  // ── Test 11 ─────────────────────────────────────────────────────────────────
  it('handles multiple level-ups in a single gainXp call (XP jumps two levels at once)', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'blaster', rng);
    assignSkill(state, employee.id, 'blasting', 1); // start at level 1, xp = 0

    // XP_THRESHOLDS[3] === 300 — crosses both the level-2 (100) and level-3 (300) thresholds
    const result = gainXp(state, employee.id, 'blasting', XP_THRESHOLDS[3]);

    const qual = employee.qualifications.find(q => q.category === 'blasting')!;
    expect(qual.proficiencyLevel).toBe(3);
    expect(result).not.toBeNull();
    expect(result!.leveledUp).toBe(true);
    expect(result!.oldLevel).toBe(1);
    expect(result!.newLevel).toBe(3);
  });
});

describe('calculateSalary() (3.4)', () => {
  // ── Test 1 ──────────────────────────────────────────────────────────────────
  it('returns BASE_SALARIES[role] for an employee with no qualifications', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);
    // Ensure qualifications array is empty (freshly hired)
    employee.qualifications = [];

    const salary = calculateSalary(employee);

    expect(salary).toBe(BASE_SALARIES['driller']);
  });

  // ── Test 2 ──────────────────────────────────────────────────────────────────
  it('a newly hired employee has employee.salary equal to BASE_SALARIES[role]', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'blaster', rng);

    // No qualifications assigned yet — salary should match the role's base salary
    expect(employee.salary).toBe(BASE_SALARIES['blaster']);
  });

  // ── Test 3 ──────────────────────────────────────────────────────────────────
  it('returns base + QUALIFICATION_SALARY_BONUS[1] for exactly one level-1 qualification', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);
    assignSkill(state, employee.id, 'blasting', 1);

    const salary = calculateSalary(employee);
    const expected = BASE_SALARIES['driller'] + QUALIFICATION_SALARY_BONUS[1];

    expect(salary).toBe(expected);
  });

  // ── Test 4 ──────────────────────────────────────────────────────────────────
  it('an employee with one level-1 qualification has salary greater than base salary alone', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);
    assignSkill(state, employee.id, 'geology', 1);

    const salary = calculateSalary(employee);

    expect(salary).toBeGreaterThan(BASE_SALARIES['driller']);
  });

  // ── Test 5 ──────────────────────────────────────────────────────────────────
  it('two qualifications yield a higher salary than one qualification', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);

    assignSkill(state, employee.id, 'blasting', 1);
    const salaryOneQual = calculateSalary(employee);

    assignSkill(state, employee.id, 'geology', 1);
    const salaryTwoQuals = calculateSalary(employee);

    expect(salaryTwoQuals).toBeGreaterThan(salaryOneQual);
  });

  // ── Test 6 ──────────────────────────────────────────────────────────────────
  it('a higher-level qualification produces a higher salary than the same qualification at a lower level', () => {
    const state = createEmployeeState();
    const rng = new Random(1);

    const { employee: empLow } = hireEmployee(state, 'driller', rng);
    assignSkill(state, empLow.id, 'blasting', 1);
    const salaryLevel1 = calculateSalary(empLow);

    const { employee: empHigh } = hireEmployee(state, 'driller', rng);
    assignSkill(state, empHigh.id, 'blasting', 3);
    const salaryLevel3 = calculateSalary(empHigh);

    expect(salaryLevel3).toBeGreaterThan(salaryLevel1);
  });

  // ── Test 7 ──────────────────────────────────────────────────────────────────
  it('sums all qualification bonuses: base + QUALIFICATION_SALARY_BONUS[level] for each qual', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'surveyor', rng);
    assignSkill(state, employee.id, 'geology', 2);
    assignSkill(state, employee.id, 'management', 4);

    const expected =
      BASE_SALARIES['surveyor'] +
      QUALIFICATION_SALARY_BONUS[2] +
      QUALIFICATION_SALARY_BONUS[4];

    expect(calculateSalary(employee)).toBe(expected);
  });

  // ── Test 8 ──────────────────────────────────────────────────────────────────
  it('employee.salary is recalculated upward when assignSkill() is called', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'blaster', rng);
    const salaryBefore = employee.salary;

    assignSkill(state, employee.id, 'blasting', 1);

    expect(employee.salary).toBeGreaterThan(salaryBefore);
    expect(employee.salary).toBe(BASE_SALARIES['blaster'] + QUALIFICATION_SALARY_BONUS[1]);
  });

  // ── Test 9 ──────────────────────────────────────────────────────────────────
  it('employee.salary is recalculated upward when gainXp() causes a level-up', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'blaster', rng);
    assignSkill(state, employee.id, 'blasting', 1);
    const salaryAtLevel1 = employee.salary;

    // Enough XP to level up from 1 → 2
    gainXp(state, employee.id, 'blasting', XP_THRESHOLDS[2]);

    expect(employee.salary).toBeGreaterThan(salaryAtLevel1);
    expect(employee.salary).toBe(BASE_SALARIES['blaster'] + QUALIFICATION_SALARY_BONUS[2]);
  });

  // ── Test 10 ─────────────────────────────────────────────────────────────────
  it('QUALIFICATION_SALARY_BONUS values are strictly increasing from level 1 through 5', () => {
    expect(QUALIFICATION_SALARY_BONUS[2]).toBeGreaterThan(QUALIFICATION_SALARY_BONUS[1]);
    expect(QUALIFICATION_SALARY_BONUS[3]).toBeGreaterThan(QUALIFICATION_SALARY_BONUS[2]);
    expect(QUALIFICATION_SALARY_BONUS[4]).toBeGreaterThan(QUALIFICATION_SALARY_BONUS[3]);
    expect(QUALIFICATION_SALARY_BONUS[5]).toBeGreaterThan(QUALIFICATION_SALARY_BONUS[4]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 3.10 — Need meters: Hunger, Fatigue, Social, Comfort
//
// Functions under test:
//   tickNeeds(employee, isWorking)  — drain all needs by the appropriate rate
//   getNeedMultiplier(employee)     — returns productivity multiplier 0.0–1.0
//   tickNeedMorale(employee)        — returns morale delta (≤ 0) from low needs
//   replenishNeed(employee, need, amount) — restore a gauge, capped at 100
// New Employee fields: hunger, fatigue, social, comfort (all 0–100)
// New balance constants: NEED_DRAIN_RATES, NEED_THRESHOLDS
// ─────────────────────────────────────────────────────────────────────────────
describe('Employee — need meters (3.10)', () => {

  // ── Test 1 ──────────────────────────────────────────────────────────────────
  it('hireEmployee initialises hunger, fatigue, social, and comfort all to 100', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);

    expect(employee.hunger).toBe(100);
    expect(employee.fatigue).toBe(100);
    expect(employee.social).toBe(100);
    expect(employee.comfort).toBe(100);
  });

  // ── Test 2 ──────────────────────────────────────────────────────────────────
  it('tickNeeds drains hunger at NEED_DRAIN_RATES.hunger.working (1/tick) when isWorking is true', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);

    tickNeeds(employee, true);

    expect(employee.hunger).toBe(100 - NEED_DRAIN_RATES.hunger.working);
  });

  // ── Test 3 ──────────────────────────────────────────────────────────────────
  it('tickNeeds drains hunger at NEED_DRAIN_RATES.hunger.idle (0.5/tick) when isWorking is false', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);

    tickNeeds(employee, false);

    expect(employee.hunger).toBe(100 - NEED_DRAIN_RATES.hunger.idle);
  });

  // ── Test 4 ──────────────────────────────────────────────────────────────────
  it('tickNeeds drains fatigue at NEED_DRAIN_RATES.fatigue.working when isWorking is true', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);

    tickNeeds(employee, true);

    expect(employee.fatigue).toBe(100 - NEED_DRAIN_RATES.fatigue.working);
  });

  // ── Test 5 ──────────────────────────────────────────────────────────────────
  it('tickNeeds always drains social by NEED_DRAIN_RATES.social.idle regardless of isWorking', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);

    // Isolation drain applies on every tick — isWorking: true is used here
    tickNeeds(employee, true);

    expect(employee.social).toBe(100 - NEED_DRAIN_RATES.social.idle);
  });

  // ── Test 6 ──────────────────────────────────────────────────────────────────
  it('tickNeeds always drains comfort by NEED_DRAIN_RATES.comfort.idle regardless of isWorking', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);

    tickNeeds(employee, true);

    expect(employee.comfort).toBe(100 - NEED_DRAIN_RATES.comfort.idle);
  });

  // ── Test 7 ──────────────────────────────────────────────────────────────────
  it('tickNeeds never drains any need below 0 when needs are already at 0', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);

    // Force all needs to the floor
    employee.hunger  = 0;
    employee.fatigue = 0;
    employee.social  = 0;
    employee.comfort = 0;

    tickNeeds(employee, true);

    expect(employee.hunger).toBe(0);
    expect(employee.fatigue).toBe(0);
    expect(employee.social).toBe(0);
    expect(employee.comfort).toBe(0);
  });

  // ── Test 8 ──────────────────────────────────────────────────────────────────
  it('getNeedMultiplier returns 1.0 when all needs are at 100 (no penalties active)', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);
    // All needs initialised to 100 by hireEmployee — no threshold is breached

    expect(getNeedMultiplier(employee)).toBe(1.0);
  });

  // ── Test 9 ──────────────────────────────────────────────────────────────────
  it('getNeedMultiplier returns 0.80 when hunger is 25 (below NEED_THRESHOLDS.hunger.low = 30)', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);
    employee.hunger = 25; // 25 < 30 → ×0.80 penalty

    expect(getNeedMultiplier(employee)).toBe(0.80);
  });

  // ── Test 10 ─────────────────────────────────────────────────────────────────
  it('getNeedMultiplier returns 0.60 when hunger is 5 (below NEED_THRESHOLDS.hunger.critical = 10)', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);
    employee.hunger = 5; // 5 < 10 → ×0.60 penalty

    expect(getNeedMultiplier(employee)).toBe(0.60);
  });

  // ── Test 11 ─────────────────────────────────────────────────────────────────
  it('getNeedMultiplier returns 0.75 when fatigue is 35 (below NEED_THRESHOLDS.fatigue.low = 40)', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);
    employee.fatigue = 35; // 35 < 40 → ×0.75 penalty

    expect(getNeedMultiplier(employee)).toBe(0.75);
  });

  // ── Test 12 ─────────────────────────────────────────────────────────────────
  it('getNeedMultiplier returns 0.50 when fatigue is 10 (below NEED_THRESHOLDS.fatigue.critical = 15)', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);
    employee.fatigue = 10; // 10 < 15 → ×0.50 penalty

    expect(getNeedMultiplier(employee)).toBe(0.50);
  });

  // ── Test 13 ─────────────────────────────────────────────────────────────────
  it('getNeedMultiplier stacks hunger and fatigue penalties multiplicatively (×0.80 × ×0.75 = ×0.60)', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);
    employee.hunger  = 25; // below 30 → ×0.80
    employee.fatigue = 35; // below 40 → ×0.75

    // Stacked: 0.80 × 0.75 = 0.60
    expect(getNeedMultiplier(employee)).toBeCloseTo(0.80 * 0.75, 10);
  });

  // ── Test 14 ─────────────────────────────────────────────────────────────────
  it('tickNeedMorale returns 0 when all needs are above their morale-penalty thresholds', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);
    // All needs are 100 — well above both social < 20 and comfort < 30

    expect(tickNeedMorale(employee)).toBe(0);
  });

  // ── Test 15 ─────────────────────────────────────────────────────────────────
  it('tickNeedMorale returns −2 when social is 15 (below NEED_THRESHOLDS.social.low = 20)', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);
    employee.social = 15; // 15 < 20 → −2/tick morale penalty

    expect(tickNeedMorale(employee)).toBe(-2);
  });

  // ── Test 16 ─────────────────────────────────────────────────────────────────
  it('tickNeedMorale returns −1 when comfort is 25 (below NEED_THRESHOLDS.comfort.low = 30)', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);
    employee.comfort = 25; // 25 < 30 → −1/tick morale penalty

    expect(tickNeedMorale(employee)).toBe(-1);
  });

  // ── Test 17 ─────────────────────────────────────────────────────────────────
  it('tickNeedMorale stacks both social and comfort penalties to −3 when both needs are low', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);
    employee.social  = 15; // below 20 → −2
    employee.comfort = 25; // below 30 → −1

    expect(tickNeedMorale(employee)).toBe(-3);
  });

  // ── Test 18 ─────────────────────────────────────────────────────────────────
  it('replenishNeed increases the target need gauge by the given amount', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);
    employee.hunger = 50;

    replenishNeed(employee, 'hunger' as NeedKey, 30);

    expect(employee.hunger).toBe(80);
  });

  // ── Test 19 ─────────────────────────────────────────────────────────────────
  it('replenishNeed caps the need at 100 and never exceeds it', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);
    employee.hunger = 80;

    replenishNeed(employee, 'hunger' as NeedKey, 50); // 80 + 50 = 130, capped to 100

    expect(employee.hunger).toBe(100);
  });
});
