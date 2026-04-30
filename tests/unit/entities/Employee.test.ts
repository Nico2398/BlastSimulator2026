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
  // ── 3.13: task-duration function ──
  computeTaskDuration,
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
  NEED_PRODUCTIVITY_MULTIPLIERS,
  NEED_MORALE_PENALTIES,
  // ── 3.13: proficiency multipliers ──
  PROFICIENCY_MULTIPLIERS,
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
  it('getNeedMultiplier returns hunger.low multiplier when hunger is 25 (below NEED_THRESHOLDS.hunger.low = 30)', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);
    employee.hunger = 25; // 25 < 30 → low-tier penalty

    expect(getNeedMultiplier(employee)).toBe(NEED_PRODUCTIVITY_MULTIPLIERS.hunger.low);
  });

  // ── Test 10 ─────────────────────────────────────────────────────────────────
  it('getNeedMultiplier returns hunger.critical multiplier when hunger is 5 (below NEED_THRESHOLDS.hunger.critical = 10)', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);
    employee.hunger = 5; // 5 < 10 → critical-tier penalty

    expect(getNeedMultiplier(employee)).toBe(NEED_PRODUCTIVITY_MULTIPLIERS.hunger.critical);
  });

  // ── Test 11 ─────────────────────────────────────────────────────────────────
  it('getNeedMultiplier returns fatigue.low multiplier when fatigue is 35 (below NEED_THRESHOLDS.fatigue.low = 40)', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);
    employee.fatigue = 35; // 35 < 40 → low-tier penalty

    expect(getNeedMultiplier(employee)).toBe(NEED_PRODUCTIVITY_MULTIPLIERS.fatigue.low);
  });

  // ── Test 12 ─────────────────────────────────────────────────────────────────
  it('getNeedMultiplier returns fatigue.critical multiplier when fatigue is 10 (below NEED_THRESHOLDS.fatigue.critical = 15)', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);
    employee.fatigue = 10; // 10 < 15 → critical-tier penalty

    expect(getNeedMultiplier(employee)).toBe(NEED_PRODUCTIVITY_MULTIPLIERS.fatigue.critical);
  });

  // ── Test 13 ─────────────────────────────────────────────────────────────────
  it('getNeedMultiplier stacks hunger and fatigue penalties multiplicatively', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);
    employee.hunger  = 25; // below 30 → hunger.low multiplier
    employee.fatigue = 35; // below 40 → fatigue.low multiplier

    expect(getNeedMultiplier(employee)).toBeCloseTo(
      NEED_PRODUCTIVITY_MULTIPLIERS.hunger.low * NEED_PRODUCTIVITY_MULTIPLIERS.fatigue.low,
      10,
    );
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
  it('tickNeedMorale returns social penalty when social is 15 (below NEED_THRESHOLDS.social.low = 20)', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);
    employee.social = 15; // 15 < 20 → social morale penalty

    expect(tickNeedMorale(employee)).toBe(NEED_MORALE_PENALTIES.social);
  });

  // ── Test 16 ─────────────────────────────────────────────────────────────────
  it('tickNeedMorale returns comfort penalty when comfort is 25 (below NEED_THRESHOLDS.comfort.low = 30)', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);
    employee.comfort = 25; // 25 < 30 → comfort morale penalty

    expect(tickNeedMorale(employee)).toBe(NEED_MORALE_PENALTIES.comfort);
  });

  // ── Test 17 ─────────────────────────────────────────────────────────────────
  it('tickNeedMorale stacks both social and comfort penalties when both needs are low', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);
    employee.social  = 15; // below 20 → social penalty
    employee.comfort = 25; // below 30 → comfort penalty

    expect(tickNeedMorale(employee)).toBe(NEED_MORALE_PENALTIES.social + NEED_MORALE_PENALTIES.comfort);
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

// ── Task 3.13 — computeTaskDuration ─────────────────────────────────────────
describe('Employee — computeTaskDuration (3.13)', () => {

  // ── Test 1 ──────────────────────────────────────────────────────────────────
  it('baseline: Rookie (level 1), all multipliers 1.0 → returns baseDuration unchanged', () => {
    // ceil(100 * PROFICIENCY_MULTIPLIERS[1] / (1.0 * 1.0 * 1.0))
    // = ceil(100 * 1.00 / 1.0) = 100
    const result = computeTaskDuration(100, 1, 1.0, 1.0, 1.0);
    expect(result).toBe(Math.ceil(100 * PROFICIENCY_MULTIPLIERS[1] / (1.0 * 1.0 * 1.0)));
    expect(result).toBe(100);
  });

  // ── Test 2 ──────────────────────────────────────────────────────────────────
  it('proficiency level 5: Master, all other multipliers 1.0 → returns ceil(baseDuration * 0.40)', () => {
    // ceil(100 * PROFICIENCY_MULTIPLIERS[5] / (1.0 * 1.0 * 1.0))
    // = ceil(100 * 0.40 / 1.0) = 40
    const result = computeTaskDuration(100, 5, 1.0, 1.0, 1.0);
    expect(result).toBe(Math.ceil(100 * PROFICIENCY_MULTIPLIERS[5] / (1.0 * 1.0 * 1.0)));
    expect(result).toBe(40);
  });

  // ── Test 3 ──────────────────────────────────────────────────────────────────
  it('proficiency level 2: Competent, all other multipliers 1.0 → returns ceil(baseDuration * 0.85)', () => {
    // ceil(100 * PROFICIENCY_MULTIPLIERS[2] / (1.0 * 1.0 * 1.0))
    // = ceil(100 * 0.85 / 1.0) = 85
    const result = computeTaskDuration(100, 2, 1.0, 1.0, 1.0);
    expect(result).toBe(Math.ceil(100 * PROFICIENCY_MULTIPLIERS[2] / (1.0 * 1.0 * 1.0)));
    expect(result).toBe(85);
  });

  // ── Test 4 ──────────────────────────────────────────────────────────────────
  it('hungry worker: level 1, needMultiplier=0.80 → returns ceil(baseDuration * 1.00 / 0.80)', () => {
    // Productivity penalty < 1.0 increases duration
    // ceil(100 * 1.00 / (0.80 * 1.0 * 1.0)) = ceil(125) = 125
    const result = computeTaskDuration(100, 1, 0.80, 1.0, 1.0);
    expect(result).toBe(Math.ceil(100 * PROFICIENCY_MULTIPLIERS[1] / (0.80 * 1.0 * 1.0)));
    expect(result).toBe(125);
  });

  // ── Test 5 ──────────────────────────────────────────────────────────────────
  it('starving worker: level 1, needMultiplier=0.60 → returns ceil(baseDuration * 1.00 / 0.60)', () => {
    // ceil(100 * 1.00 / (0.60 * 1.0 * 1.0)) = ceil(166.666...) = 167
    const result = computeTaskDuration(100, 1, 0.60, 1.0, 1.0);
    expect(result).toBe(Math.ceil(100 * PROFICIENCY_MULTIPLIERS[1] / (0.60 * 1.0 * 1.0)));
    expect(result).toBe(167);
  });

  // ── Test 6 ──────────────────────────────────────────────────────────────────
  it('LQ Tier 3 bonus: level 1, lqMultiplier=1.10 → returns ceil(baseDuration / 1.10)', () => {
    // lqMultiplier > 1.0 reduces duration (productivity bonus)
    // ceil(100 * 1.00 / (1.0 * 1.10 * 1.0)) = ceil(90.909...) = 91
    const result = computeTaskDuration(100, 1, 1.0, 1.10, 1.0);
    expect(result).toBe(Math.ceil(100 * PROFICIENCY_MULTIPLIERS[1] / (1.0 * 1.10 * 1.0)));
    expect(result).toBe(91);
  });

  // ── Test 7 ──────────────────────────────────────────────────────────────────
  it('LQ penalty: level 1, lqMultiplier=0.85 → returns ceil(baseDuration / 0.85)', () => {
    // lqMultiplier < 1.0 increases duration (productivity penalty)
    // ceil(100 * 1.00 / (1.0 * 0.85 * 1.0)) = ceil(117.647...) = 118
    const result = computeTaskDuration(100, 1, 1.0, 0.85, 1.0);
    expect(result).toBe(Math.ceil(100 * PROFICIENCY_MULTIPLIERS[1] / (1.0 * 0.85 * 1.0)));
    expect(result).toBe(118);
  });

  // ── Test 8 ──────────────────────────────────────────────────────────────────
  it('event boost: level 1, eventMultiplier=1.20 → returns ceil(baseDuration / 1.20)', () => {
    // eventMultiplier > 1.0 reduces duration (union happy hour, etc.)
    // ceil(100 * 1.00 / (1.0 * 1.0 * 1.20)) = ceil(83.333...) = 84
    const result = computeTaskDuration(100, 1, 1.0, 1.0, 1.20);
    expect(result).toBe(Math.ceil(100 * PROFICIENCY_MULTIPLIERS[1] / (1.0 * 1.0 * 1.20)));
    expect(result).toBe(84);
  });

  // ── Test 9 ──────────────────────────────────────────────────────────────────
  it('event penalty: level 1, eventMultiplier=0.85 → returns ceil(baseDuration / 0.85)', () => {
    // eventMultiplier < 1.0 increases duration (heatwave, etc.)
    // ceil(100 * 1.00 / (1.0 * 1.0 * 0.85)) = ceil(117.647...) = 118
    const result = computeTaskDuration(100, 1, 1.0, 1.0, 0.85);
    expect(result).toBe(Math.ceil(100 * PROFICIENCY_MULTIPLIERS[1] / (1.0 * 1.0 * 0.85)));
    expect(result).toBe(118);
  });

  // ── Test 10 ─────────────────────────────────────────────────────────────────
  it('all modifiers combined: level 5, needMultiplier=0.80, lqMultiplier=1.10, eventMultiplier=1.20', () => {
    // ceil(100 * 0.40 / (0.80 * 1.10 * 1.20))
    // = ceil(40 / 1.056) = ceil(37.878...) = 38
    const result = computeTaskDuration(100, 5, 0.80, 1.10, 1.20);
    expect(result).toBe(Math.ceil(100 * PROFICIENCY_MULTIPLIERS[5] / (0.80 * 1.10 * 1.20)));
    expect(result).toBe(38);
  });

  // ── Test 11 ─────────────────────────────────────────────────────────────────
  it('minimum of 1: baseDuration=1, level 5, all multipliers 1.0 → result is at least 1', () => {
    // ceil(1 * 0.40 / 1.0) = ceil(0.40) = 1 → enforces floor of 1
    const result = computeTaskDuration(1, 5, 1.0, 1.0, 1.0);
    expect(result).toBeGreaterThanOrEqual(1);
    expect(result).toBe(1);
  });

  // ── Test 12 ─────────────────────────────────────────────────────────────────
  it('integer result: result is always a whole number (Math.ceil output)', () => {
    // Non-round calculation: ceil(7 * 0.85 / 1.0) = ceil(5.95) = 6
    const result = computeTaskDuration(7, 2, 1.0, 1.0, 1.0);
    expect(Number.isInteger(result)).toBe(true);
    expect(result).toBe(Math.ceil(7 * PROFICIENCY_MULTIPLIERS[2] / (1.0 * 1.0 * 1.0)));
    expect(result).toBe(6);
  });

  // ── Test 13 ─────────────────────────────────────────────────────────────────
  it('baseDuration=1: level 1, all multipliers 1.0 → returns exactly 1', () => {
    // ceil(1 * 1.00 / (1.0 * 1.0 * 1.0)) = ceil(1.0) = 1
    const result = computeTaskDuration(1, 1, 1.0, 1.0, 1.0);
    expect(result).toBe(1);
  });

});
