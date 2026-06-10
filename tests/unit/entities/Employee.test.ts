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
  tickNeedGauges,
  getNeedMultiplier,
  tickNeedMorale,
  replenishNeed,
  needsMoraleEffect,
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
  MORALE_THRESHOLDS,
  NEED_DRAIN_RATES,
  NEED_THRESHOLDS,
  NEED_PRODUCTIVITY_MULTIPLIERS,
  NEED_MORALE_PENALTIES,
  NEED_MORALE_DRAIN_MULTIPLIERS,
  // ── 7.4: needsMoraleEffect balance constants ──
  NEED_MORALE_EFFECT_THRESHOLDS,
  NEED_MORALE_EFFECT_PENALTIES,
  NEED_WELL_RESTED_THRESHOLD,
  NEED_WELL_RESTED_BONUS,
  // ── 7.5: replenishNeed building replenish rates ──
  BUILDING_REPLENISH_RATES,
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
// Task 7.1 — Need meters: Hunger, Fatigue, BreakNeed, Collapsing
//
// Functions under test:
//   tickNeeds(employee, isWorking)        — drain all needs by the appropriate rate
//   getNeedMultiplier(employee)           — returns productivity multiplier 0.0–1.0
//   tickNeedMorale(employee)              — returns morale delta (≤ 0) from low breakNeed
//   replenishNeed(employee, need, buildingTier, availableCapacity) → fills gauge at building tier rate, enforces capacity
// New Employee fields: hunger, fatigue, breakNeed (all 0–100), collapsing (boolean)
// New balance constants: NEED_DRAIN_RATES, NEED_THRESHOLDS
// ─────────────────────────────────────────────────────────────────────────────
describe('Employee — need meters (7.1)', () => {

  // ── Test 1 ──────────────────────────────────────────────────────────────────
  it('hireEmployee initialises breakNeed to 100 and collapsing to false', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);

    expect(employee.breakNeed).toBe(100);
    expect(employee.collapsing).toBe(false);
  });

  // ── Test 2 ──────────────────────────────────────────────────────────────────
  it('tickNeeds drains breakNeed at working rate (0.8) when isWorking is true', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);

    tickNeeds(employee, true);

    expect(employee.breakNeed).toBe(100 - NEED_DRAIN_RATES.breakNeed.working);
  });

  // ── Test 3 ──────────────────────────────────────────────────────────────────
  it('tickNeeds does not drain breakNeed when isWorking is false', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);

    tickNeeds(employee, false);

    expect(employee.breakNeed).toBe(100);
  });

  // ── Test 4 ──────────────────────────────────────────────────────────────────
  it('tickNeeds drains hunger at NEED_DRAIN_RATES.hunger.working (1/tick) when isWorking is true', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);

    tickNeeds(employee, true);

    expect(employee.hunger).toBe(100 - NEED_DRAIN_RATES.hunger.working);
  });

  // ── Test 5 ──────────────────────────────────────────────────────────────────
  it('tickNeeds drains hunger at NEED_DRAIN_RATES.hunger.idle (0.5/tick) when isWorking is false', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);

    tickNeeds(employee, false);

    expect(employee.hunger).toBe(100 - NEED_DRAIN_RATES.hunger.idle);
  });

  // ── Test 6 ──────────────────────────────────────────────────────────────────
  it('tickNeeds drains fatigue at NEED_DRAIN_RATES.fatigue.working when isWorking is true', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);

    tickNeeds(employee, true);

    expect(employee.fatigue).toBe(100 - NEED_DRAIN_RATES.fatigue.working);
  });

  // ── Test 7 ──────────────────────────────────────────────────────────────────
  it('tickNeeds never drains breakNeed below 0', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);
    employee.breakNeed = 0;

    tickNeeds(employee, true);

    expect(employee.breakNeed).toBe(0);
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
  it('getNeedMultiplier returns fatigue.low multiplier when fatigue is 35 (below NEED_THRESHOLDS.fatigue.low = 40)', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);
    employee.fatigue = 35; // 35 < 40 → low-tier penalty

    expect(getNeedMultiplier(employee)).toBe(NEED_PRODUCTIVITY_MULTIPLIERS.fatigue.low);
  });

  // ── Test 11 ─────────────────────────────────────────────────────────────────
  it('tickNeedMorale returns 0 when breakNeed is above low threshold (30)', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);
    employee.breakNeed = 35;

    expect(tickNeedMorale(employee)).toBe(0);
  });

  // ── Test 12 ─────────────────────────────────────────────────────────────────
  it('tickNeedMorale returns breakNeed penalty (-2) when breakNeed is below low threshold (30)', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);
    employee.breakNeed = 25;

    expect(tickNeedMorale(employee)).toBe(NEED_MORALE_PENALTIES.breakNeed);
    expect(NEED_MORALE_PENALTIES.breakNeed).toBe(-2);
  });

  // ── Test 13 ─────────────────────────────────────────────────────────────────
  it('tickNeedMorale returns 0 when breakNeed is exactly at low threshold (30)', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);
    employee.breakNeed = 30;

    expect(tickNeedMorale(employee)).toBe(0);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// Task 7.3 — tickNeedGauges: morale-adjusted drain rates
//
// Function under test:
//   tickNeedGauges(employee, isWorking)
// Drain rates are multiplied by a morale-dependent factor:
//   morale > 70 → NEED_MORALE_DRAIN_MULTIPLIERS.high (0.85)
//   morale < 30 → NEED_MORALE_DRAIN_MULTIPLIERS.low  (1.20)
//   otherwise   → NEED_MORALE_DRAIN_MULTIPLIERS.normal (1.00)
// All gauges clamped to minimum 0.
// ─────────────────────────────────────────────────────────────────────────────
describe('Employee — tickNeedGauges (7.3)', () => {

  // ── Test 1 ──────────────────────────────────────────────────────────────────
  it('high morale (>70) reduces drain rate when working', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);
    employee.morale = 80; // > 70 → high morale
    const hungerBefore = employee.hunger;
    const fatigueBefore = employee.fatigue;
    const breakNeedBefore = employee.breakNeed;

    tickNeedGauges(employee, true);

    const expectedHunger = hungerBefore - NEED_DRAIN_RATES.hunger.working * NEED_MORALE_DRAIN_MULTIPLIERS.high;
    const expectedFatigue = fatigueBefore - NEED_DRAIN_RATES.fatigue.working * NEED_MORALE_DRAIN_MULTIPLIERS.high;
    const expectedBreakNeed = breakNeedBefore - NEED_DRAIN_RATES.breakNeed.working * NEED_MORALE_DRAIN_MULTIPLIERS.high;
    expect(employee.hunger).toBeCloseTo(expectedHunger, 5);
    expect(employee.fatigue).toBeCloseTo(expectedFatigue, 5);
    expect(employee.breakNeed).toBeCloseTo(expectedBreakNeed, 5);
  });

  // ── Test 2 ──────────────────────────────────────────────────────────────────
  it('low morale (<30) increases drain rate when working', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);
    employee.morale = 20; // < 30 → low morale

    tickNeedGauges(employee, true);

    expect(employee.hunger).toBeCloseTo(100 - NEED_DRAIN_RATES.hunger.working * NEED_MORALE_DRAIN_MULTIPLIERS.low, 5);
    expect(employee.fatigue).toBeCloseTo(100 - NEED_DRAIN_RATES.fatigue.working * NEED_MORALE_DRAIN_MULTIPLIERS.low, 5);
    expect(employee.breakNeed).toBeCloseTo(100 - NEED_DRAIN_RATES.breakNeed.working * NEED_MORALE_DRAIN_MULTIPLIERS.low, 5);
  });

  // ── Test 3 ──────────────────────────────────────────────────────────────────
  it('normal morale (30-70) uses standard drain rate when working', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);
    employee.morale = 50; // normal range

    tickNeedGauges(employee, true);

    expect(employee.hunger).toBeCloseTo(100 - NEED_DRAIN_RATES.hunger.working * NEED_MORALE_DRAIN_MULTIPLIERS.normal, 5);
    expect(employee.fatigue).toBeCloseTo(100 - NEED_DRAIN_RATES.fatigue.working * NEED_MORALE_DRAIN_MULTIPLIERS.normal, 5);
    expect(employee.breakNeed).toBeCloseTo(100 - NEED_DRAIN_RATES.breakNeed.working * NEED_MORALE_DRAIN_MULTIPLIERS.normal, 5);
  });

  // ── Test 4 ──────────────────────────────────────────────────────────────────
  it('boundary: morale = 70 uses normal multiplier (not high)', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);
    employee.morale = 70; // exactly at boundary — should be normal

    tickNeedGauges(employee, true);

    expect(employee.hunger).toBeCloseTo(100 - NEED_DRAIN_RATES.hunger.working * 1.0, 5);
  });

  // ── Test 5 ──────────────────────────────────────────────────────────────────
  it('boundary: morale = 30 uses normal multiplier (not low)', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);
    employee.morale = 30; // exactly at boundary — should be normal

    tickNeedGauges(employee, true);

    expect(employee.hunger).toBeCloseTo(100 - NEED_DRAIN_RATES.hunger.working * 1.0, 5);
  });

  // ── Test 6 ──────────────────────────────────────────────────────────────────
  it('high morale reduces drain rate when idle', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);
    employee.morale = 80;

    tickNeedGauges(employee, false); // idle

    expect(employee.hunger).toBeCloseTo(100 - NEED_DRAIN_RATES.hunger.idle * NEED_MORALE_DRAIN_MULTIPLIERS.high, 5);
    expect(employee.fatigue).toBeCloseTo(100 - NEED_DRAIN_RATES.fatigue.idle * NEED_MORALE_DRAIN_MULTIPLIERS.high, 5);
    // breakNeed idle rate is 0, so 0 * 0.85 = 0, stays at 100
    expect(employee.breakNeed).toBe(100);
  });

  // ── Test 7 ──────────────────────────────────────────────────────────────────
  it('low morale increases drain rate when idle', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);
    employee.morale = 20;

    tickNeedGauges(employee, false); // idle

    expect(employee.hunger).toBeCloseTo(100 - NEED_DRAIN_RATES.hunger.idle * NEED_MORALE_DRAIN_MULTIPLIERS.low, 5);
    expect(employee.fatigue).toBeCloseTo(100 - NEED_DRAIN_RATES.fatigue.idle * NEED_MORALE_DRAIN_MULTIPLIERS.low, 5);
    expect(employee.breakNeed).toBe(100); // idle rate 0 × 1.20 = 0
  });

  // ── Test 8 ──────────────────────────────────────────────────────────────────
  it('gauges are clamped to 0 and never go negative', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);
    employee.hunger = 0;
    employee.fatigue = 0;
    employee.breakNeed = 0;
    employee.morale = 20; // low morale — would drain faster

    tickNeedGauges(employee, true);

    expect(employee.hunger).toBe(0);
    expect(employee.fatigue).toBe(0);
    expect(employee.breakNeed).toBe(0);
  });

  // ── Test 9 ──────────────────────────────────────────────────────────────────
  it('breakNeed does not drain when idle regardless of morale', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);
    employee.morale = 20; // low morale
    employee.breakNeed = 100;

    tickNeedGauges(employee, false); // idle

    expect(employee.breakNeed).toBe(100); // idle rate = 0
  });

  // ── Test 10 ─────────────────────────────────────────────────────────────────
  it('extreme morale values: 0 (low) and 100 (high) both apply correct multipliers', () => {
    const state1 = createEmployeeState();
    const rng1 = new Random(1);
    const { employee: emp1 } = hireEmployee(state1, 'driller', rng1);
    emp1.morale = 0;

    const state2 = createEmployeeState();
    const rng2 = new Random(1);
    const { employee: emp2 } = hireEmployee(state2, 'driller', rng2);
    emp2.morale = 100;

    tickNeedGauges(emp1, true);
    tickNeedGauges(emp2, true);

    // morale=0: ×1.20
    expect(emp1.hunger).toBeCloseTo(100 - NEED_DRAIN_RATES.hunger.working * NEED_MORALE_DRAIN_MULTIPLIERS.low, 5);
    // morale=100: ×0.85
    expect(emp2.hunger).toBeCloseTo(100 - NEED_DRAIN_RATES.hunger.working * NEED_MORALE_DRAIN_MULTIPLIERS.high, 5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 7.4 — needsMoraleEffect: morale delta from all three need gauges
//
// Function under test:
//   needsMoraleEffect(employee) → number
// Pure function returning the tick-level morale delta from hunger, fatigue,
// and breakNeed gauges. Each gauge applies a tiered penalty:
//   gauge >= 50:  0        (comfortable)
//   gauge >= 30: -0.5      (uncomfortable)
//   gauge >= 15: -1.5      (suffering)
//   gauge <  15: -3.0      (critical)
//
// If all three gauges are > NEED_WELL_RESTED_THRESHOLD (80), a +1 bonus is
// applied (well-rested bonus).
// ─────────────────────────────────────────────────────────────────────────────
describe('Employee — needsMoraleEffect (7.4)', () => {

  // ── Test 1 ──────────────────────────────────────────────────────────────────
  it('all gauges at 100 → returns +1 (well-rested bonus)', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);
    // All gauges default to 100
    const result = needsMoraleEffect(employee);
    // comfortable (0) + comfortable (0) + comfortable (0) + well-rested (+1) = +1
    expect(result).toBe(1);
  });

  // ── Test 2 ──────────────────────────────────────────────────────────────────
  it('all gauges at 100, well-rested bonus equals NEED_WELL_RESTED_BONUS', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);
    const result = needsMoraleEffect(employee);
    expect(result).toBe(NEED_WELL_RESTED_BONUS);
  });

  // ── Test 3 ──────────────────────────────────────────────────────────────────
  it('single gauge critical (hunger=10, others 100) → returns -3.0', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);
    employee.hunger = 10;
    // hunger: critical (-3.0), fatigue: comfortable (0), breakNeed: comfortable (0)
    const result = needsMoraleEffect(employee);
    expect(result).toBeCloseTo(-3.0, 5);
  });

  // ── Test 4 ──────────────────────────────────────────────────────────────────
  it('two critical gauges (fatigue=5, breakNeed=10, hunger=100) → returns -6.0', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);
    employee.fatigue = 5;
    employee.breakNeed = 10;
    // fatigue: critical (-3.0), breakNeed: critical (-3.0), hunger: comfortable (0)
    const result = needsMoraleEffect(employee);
    expect(result).toBeCloseTo(-6.0, 5);
  });

  // ── Test 5 ──────────────────────────────────────────────────────────────────
  it('all three gauges critical (0, 0, 0) → returns -9.0', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);
    employee.hunger = 0;
    employee.fatigue = 0;
    employee.breakNeed = 0;
    // critical (-3.0) × 3 = -9.0
    const result = needsMoraleEffect(employee);
    expect(result).toBeCloseTo(-9.0, 5);
  });

  // ── Test 6 ──────────────────────────────────────────────────────────────────
  it('mixed gauges (hunger=40, fatigue=100, breakNeed=20) → returns -2.0', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);
    employee.hunger = 40;    // 40 >= 30 → uncomfortable (-0.5)
    employee.fatigue = 100;  // 100 >= 50 → comfortable (0)
    employee.breakNeed = 20; // 20 >= 15 → suffering (-1.5)
    // -0.5 + 0 + -1.5 = -2.0
    const result = needsMoraleEffect(employee);
    expect(result).toBeCloseTo(-2.0, 5);
  });

  // ── Test 7 ──────────────────────────────────────────────────────────────────
  it('borderline comfortable (50, 50, 50) → returns 0', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);
    employee.hunger = 50;
    employee.fatigue = 50;
    employee.breakNeed = 50;
    // All comfortable (0) — no well-rested bonus (50 is not > 80)
    const result = needsMoraleEffect(employee);
    expect(result).toBe(0);
  });

  // ── Test 8 ──────────────────────────────────────────────────────────────────
  it('borderline well-rested threshold (80, 80, 80) → returns 0', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);
    employee.hunger = 80;
    employee.fatigue = 80;
    employee.breakNeed = 80;
    // All comfortable (0) — no well-rested bonus (80 is not > 80)
    const result = needsMoraleEffect(employee);
    expect(result).toBe(0);
  });

  // ── Test 9 ──────────────────────────────────────────────────────────────────
  it('well-rested threshold crossed (81, 81, 81) → returns +1', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);
    employee.hunger = 81;
    employee.fatigue = 81;
    employee.breakNeed = 81;
    // All comfortable (0) + well-rested (+1) = +1
    const result = needsMoraleEffect(employee);
    expect(result).toBe(1);
  });

  // ── Test 10 ─────────────────────────────────────────────────────────────────
  it('one gauge just below well-rested (79, 100, 100) → returns 0', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);
    employee.hunger = 79;
    employee.fatigue = 100;
    employee.breakNeed = 100;
    // All comfortable (0) — no bonus because 79 is not > 80
    const result = needsMoraleEffect(employee);
    expect(result).toBe(0);
  });

  // ── Test 11 ─────────────────────────────────────────────────────────────────
  it('suffering threshold edge (15, 15, 15) → returns -4.5', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);
    employee.hunger = 15;
    employee.fatigue = 15;
    employee.breakNeed = 15;
    // All suffering (-1.5 × 3) = -4.5
    const result = needsMoraleEffect(employee);
    expect(result).toBeCloseTo(-4.5, 5);
  });

  // ── Test 12 ─────────────────────────────────────────────────────────────────
  it('below suffering / critical (14, 14, 14) → returns -9.0', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);
    employee.hunger = 14;
    employee.fatigue = 14;
    employee.breakNeed = 14;
    // All critical (-3.0 × 3) = -9.0
    const result = needsMoraleEffect(employee);
    expect(result).toBeCloseTo(-9.0, 5);
  });

  // ── Test 13 ─────────────────────────────────────────────────────────────────
  it('uncomfortable threshold edge (30, 30, 30) → returns -1.5', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);
    employee.hunger = 30;
    employee.fatigue = 30;
    employee.breakNeed = 30;
    // All uncomfortable (-0.5 × 3) = -1.5
    const result = needsMoraleEffect(employee);
    expect(result).toBeCloseTo(-1.5, 5);
  });

  // ── Test 14 ─────────────────────────────────────────────────────────────────
  it('below uncomfortable (29, 29, 29) → returns -4.5', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);
    employee.hunger = 29;
    employee.fatigue = 29;
    employee.breakNeed = 29;
    // All suffering (-1.5 × 3) = -4.5
    const result = needsMoraleEffect(employee);
    expect(result).toBeCloseTo(-4.5, 5);
  });

  // ── Test 15 ─────────────────────────────────────────────────────────────────
  it('pure function — does not mutate employee', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);
    employee.hunger = 10;
    employee.fatigue = 20;
    employee.breakNeed = 30;
    employee.morale = 60;

    const oldMorale = employee.morale;
    const oldHunger = employee.hunger;
    const oldFatigue = employee.fatigue;
    const oldBreakNeed = employee.breakNeed;

    needsMoraleEffect(employee); // call the pure function

    // Verify nothing was mutated
    expect(employee.morale).toBe(oldMorale);
    expect(employee.hunger).toBe(oldHunger);
    expect(employee.fatigue).toBe(oldFatigue);
    expect(employee.breakNeed).toBe(oldBreakNeed);
  });

  // ── Test 16 ─────────────────────────────────────────────────────────────────
  it('well-rested bonus does not mask critical gauge', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);
    employee.hunger = 85;    // comfortable (0)
    employee.fatigue = 85;   // comfortable (0)
    employee.breakNeed = 10; // critical (-3.0)
    // Sum = -3.0, no bonus because breakNeed (10) is not > 80
    const result = needsMoraleEffect(employee);
    expect(result).toBeCloseTo(-3.0, 5);
  });

  // ── Test 17 ─────────────────────────────────────────────────────────────────
  it('exactly at comfortable threshold (50, 50, 50) with no bonus → return exactly 0', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);
    employee.hunger = NEED_MORALE_EFFECT_THRESHOLDS.comfortable;
    employee.fatigue = NEED_MORALE_EFFECT_THRESHOLDS.comfortable;
    employee.breakNeed = NEED_MORALE_EFFECT_THRESHOLDS.comfortable;
    // gauge=50 is the comfortable threshold; 50 >= 50 → comfortable (0)
    const result = needsMoraleEffect(employee);
    expect(NEED_MORALE_EFFECT_THRESHOLDS.comfortable).toBe(50);
    expect(result).toBe(0);
  });

  // ── Test 18 ─────────────────────────────────────────────────────────────────
  it('all three above well-rested threshold (82, 82, 82) → bonus positive', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);
    employee.hunger = 82;
    employee.fatigue = 82;
    employee.breakNeed = 82;
    // All comfortable (0) + well-rested (+1) = +1
    const result = needsMoraleEffect(employee);
    expect(result).toBe(1);
  });

  // ── Test 19 ─────────────────────────────────────────────────────────────────
  it('uses the correct constant values from balance.ts', () => {
    // Verify penalty constants
    expect(NEED_MORALE_EFFECT_PENALTIES.comfortable).toBe(0);
    expect(NEED_MORALE_EFFECT_PENALTIES.uncomfortable).toBe(-0.5);
    expect(NEED_MORALE_EFFECT_PENALTIES.suffering).toBe(-1.5);
    expect(NEED_MORALE_EFFECT_PENALTIES.critical).toBe(-3.0);
    // Verify well-rested bonus constant
    expect(NEED_WELL_RESTED_BONUS).toBe(1);
    // Verify threshold constants
    expect(NEED_MORALE_EFFECT_THRESHOLDS.comfortable).toBe(50);
    expect(NEED_MORALE_EFFECT_THRESHOLDS.uncomfortable).toBe(30);
    expect(NEED_MORALE_EFFECT_THRESHOLDS.suffering).toBe(15);
    expect(NEED_WELL_RESTED_THRESHOLD).toBe(80);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 7.5 — replenishNeed: fill gauge at building tier rate, enforce capacity
//
// Function under test:
//   replenishNeed(employee, need, buildingTier, availableCapacity) → boolean
// Uses BUILDING_REPLENISH_RATES to determine per-tick fill rate by tier.
// Returns true if the replenishment was applied (capacity was > 0),
// false if availableCapacity <= 0 (no capacity to consume).
// Gauge is capped at 100.
// ─────────────────────────────────────────────────────────────────────────────
describe('Employee — replenishNeed (7.5)', () => {

  // ── Test 1 ──────────────────────────────────────────────────────────────────
  it('replenishes hunger at tier-1 rate (+12), returns true', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);
    employee.hunger = 50;
    const result = replenishNeed(employee, 'hunger', 1, 5);
    expect(result).toBe(true);
    expect(employee.hunger).toBe(62);
  });

  // ── Test 2 ──────────────────────────────────────────────────────────────────
  it('replenishes fatigue at tier-2 rate (+14), returns true', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);
    employee.fatigue = 40;
    const result = replenishNeed(employee, 'fatigue', 2, 3);
    expect(result).toBe(true);
    expect(employee.fatigue).toBe(54);
  });

  // ── Test 3 ──────────────────────────────────────────────────────────────────
  it('replenishes breakNeed at tier-3 rate (+22), returns true', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);
    employee.breakNeed = 30;
    const result = replenishNeed(employee, 'breakNeed', 3, 1);
    expect(result).toBe(true);
    expect(employee.breakNeed).toBe(52);
  });

  // ── Test 4 ──────────────────────────────────────────────────────────────────
  it('availableCapacity = 0 → returns false, gauge unchanged', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);
    employee.hunger = 50;
    const result = replenishNeed(employee, 'hunger', 1, 0);
    expect(result).toBe(false);
    expect(employee.hunger).toBe(50);
  });

  // ── Test 5 ──────────────────────────────────────────────────────────────────
  it('availableCapacity < 0 → returns false, gauge unchanged', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);
    employee.fatigue = 60;
    const result = replenishNeed(employee, 'fatigue', 2, -1);
    expect(result).toBe(false);
    expect(employee.fatigue).toBe(60);
  });

  // ── Test 6 ──────────────────────────────────────────────────────────────────
  it('gauge near 100 + rate that would overflow → clamped to 100', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);
    employee.hunger = 95;
    const result = replenishNeed(employee, 'hunger', 1, 5);
    expect(result).toBe(true);
    expect(employee.hunger).toBe(100);
  });

  // ── Test 7 ──────────────────────────────────────────────────────────────────
  it('gauge already at 100 → returns true (capacity consumed), stays at 100', () => {
    const state = createEmployeeState();
    const rng = new Random(1);
    const { employee } = hireEmployee(state, 'driller', rng);
    employee.hunger = 100;
    const result = replenishNeed(employee, 'hunger', 1, 5);
    expect(result).toBe(true);
    expect(employee.hunger).toBe(100);
  });

  // ── Test 8 ──────────────────────────────────────────────────────────────────
  it('all tiers produce distinct hunger rates: 12, 18, 25', () => {
    expect(BUILDING_REPLENISH_RATES.hunger[1]).toBe(12);
    expect(BUILDING_REPLENISH_RATES.hunger[2]).toBe(18);
    expect(BUILDING_REPLENISH_RATES.hunger[3]).toBe(25);
  });

  // ── Test 9 ──────────────────────────────────────────────────────────────────
  it('all tiers produce distinct fatigue rates: 8, 14, 20', () => {
    expect(BUILDING_REPLENISH_RATES.fatigue[1]).toBe(8);
    expect(BUILDING_REPLENISH_RATES.fatigue[2]).toBe(14);
    expect(BUILDING_REPLENISH_RATES.fatigue[3]).toBe(20);
  });

  // ── Test 10 ─────────────────────────────────────────────────────────────────
  it('all tiers produce distinct breakNeed rates: 10, 16, 22', () => {
    expect(BUILDING_REPLENISH_RATES.breakNeed[1]).toBe(10);
    expect(BUILDING_REPLENISH_RATES.breakNeed[2]).toBe(16);
    expect(BUILDING_REPLENISH_RATES.breakNeed[3]).toBe(22);
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
