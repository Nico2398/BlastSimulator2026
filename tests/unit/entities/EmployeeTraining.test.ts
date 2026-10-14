// BlastSimulator2026 — Employee training: schools, plans, walk-in enrolment,
// and school occupancy (#1203). Courses grant qualifications only (#1388).
//
// Training is the only in-game route to a qualification no role is hired
// with, so these tests pin the two skills that depend on it entirely
// (driving.excavator, driving.drill_rig), the cost of raising proficiency,
// and — since #1203 — the walk-to-school-and-enter model this file's
// enrolInTraining/tickTraining section now tests end to end: enrolment sends
// the employee walking to the school (alighting first if mounted, #410's old
// instant-teleport superseded), the course only starts ticking once
// ArrivalGate confirms they have actually entered the building (#1202's
// occupancy/locomotion model, locomotion.kind === 'inside', mesh hidden), and
// a school at/over capacity refuses enrolment outright.

import { describe, it, expect, beforeEach } from 'vitest';
import { Random } from '../../../src/core/math/Random.js';
import { createGame, type GameState } from '../../../src/core/state/GameState.js';
import {
  hireEmployee,
  assignSkill,
  giveRaise,
  calculateQualificationBonus,
  calculateSalary,
  qualificationAtLevel,
  BASE_SALARIES,
  isOccupyingHost,
} from '../../../src/core/entities/Employee.js';
import type { Employee, SkillCategory } from '../../../src/core/entities/Employee.js';
import {
  trainableSkills,
  isTrainingBuilding,
  schoolFor,
  planTraining,
  heldCourseLevel,
  trainingRefusal,
  enrolInTraining,
  tickTraining,
  availableTrainingOffers,
  type EnrolInTrainingResult,
  type TrainingPlan,
} from '../../../src/core/entities/EmployeeTraining.js';
import {
  placeBuilding, destroyBuilding, getBuildingDef, getBuildingPeopleCapacity,
} from '../../../src/core/entities/Building.js';
import type { Building, BuildingType, BuildingTier } from '../../../src/core/entities/Building.js';
import { purchaseVehicle } from '../../../src/core/entities/Vehicle.js';
import { board } from '../../../src/core/engine/Mount.js';
import { tickLocomotion } from '../../../src/core/engine/Locomotion.js';
import { tickArrivalGate } from '../../../src/core/engine/ArrivalGate.js';
import { NavGrid, type NavCell } from '../../../src/core/nav/NavGrid.js';
import {
  XP_THRESHOLDS, TRAINING_BASE_FEE, TRAINING_BASE_TICKS, TRAINING_TIER_SPEED, QUALIFICATION_SALARY_BONUS,
  TRAINING_LEVEL_FEE, TRAINING_LEVEL_TICKS_MULT,
} from '../../../src/core/config/balance.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { t, setLocale } from '../../../src/core/i18n/I18n.js';

const SEED = 42;

function makeStateWithOne(role: 'driller' | 'surveyor' | 'driver' = 'driller') {
  const state = createGame({ seed: SEED });
  const { employee } = hireEmployee(state.employees, role, new Random(SEED));
  return { state, employee };
}

/** A full Building fixture — enrolInTraining takes a real Building, not a bare {id,type,tier,x,z}. */
function makeBuilding(overrides: Partial<Building> = {}): Building {
  return { id: 1, type: 'geology_lab', tier: 1, x: 40, z: 12, hp: 100, active: true, occupantIds: [], ...overrides };
}

/** Narrows `result` to the success variant, or fails the test with the refusal reason. */
function expectSuccess(result: EnrolInTrainingResult): asserts result is { success: true; fee: number; plan: TrainingPlan } {
  if (!result.success) throw new Error(`expected enrolInTraining to succeed, got: ${result.error}`);
}

/** Narrows `result` to the failure variant, or fails the test noting it unexpectedly succeeded. */
function expectFailure(result: EnrolInTrainingResult): asserts result is { success: false; error: string } {
  if (result.success) throw new Error('expected enrolInTraining to fail, but it succeeded');
}

/** A directly-editable flat, fully-walkable NavGrid (mirrors MoveTo.test.ts's identical helper). */
function makeFlatNavGrid(width: number, height: number): NavGrid {
  const cells: NavCell[][] = [];
  for (let z = 0; z < height; z++) {
    const row: NavCell[] = [];
    for (let x = 0; x < width; x++) {
      row.push({ type: 'walkable', moveCost: 1.0, benchLevel: 0, vehicleOccupied: false });
    }
    cells.push(row);
  }
  return new NavGrid(width, height, cells);
}

/**
 * A real, placed, tier-`tier` `type` school at (`x`, `z`) with its footprint
 * blocked on a flat, otherwise fully-walkable NavGrid — the fixture every
 * walk-to-school/arrival test below needs (mirrors MoveTo.test.ts's own
 * `setupSchool` helper for the identical moveTo({buildingId}) case).
 */
function setupSchool(type: BuildingType, tier: BuildingTier = 1, x = 10, z = 10) {
  const state = createGame({ seed: SEED });
  // Tier 2/3 placement is research-gated (isTierUnlocked) — a fixture that
  // wants a higher-tier school directly, without playing through research,
  // unlocks it up front rather than placeBuilding silently refusing.
  state.buildings.unlockedTiers[type] = tier;
  const school = placeBuilding(state.buildings, type, x, z, 64, 64, tier).building!;
  const grid = makeFlatNavGrid(32, 32);
  const def = getBuildingDef(type, tier);
  for (const [dx, dz] of def.footprint) {
    grid.cells[z + dz]![x + dx] = { type: 'blocked', moveCost: Infinity, benchLevel: 0, vehicleOccupied: false };
  }
  state.navGrid = grid;
  return { state, school };
}

/**
 * Ticks locomotion + the arrival gate until `employee` is inside a building
 * (or `maxTicks` is exhausted) — the walk-and-enter every enrolled trainee
 * takes before their course starts ticking down.
 */
function resolveArrival(state: GameState, employee: Employee, maxTicks = 300): void {
  for (let i = 0; i < maxTicks && employee.locomotion.kind !== 'inside'; i++) {
    tickLocomotion(state);
    tickArrivalGate(state);
  }
}

// ── Which school teaches what ────────────────────────────────────────────────

describe('trainableSkills', () => {
  it('the driving center teaches all four vehicle licences (#1339 adds the rock fragmenter) and repair (#1393)', () => {
    expect([...trainableSkills('driving_center')]).toEqual([
      'driving.truck', 'driving.excavator', 'driving.drill_rig', 'driving.rock_fragmenter', 'repair',
    ]);
  });

  it('repair is taught at the driving center and nowhere else (#1393)', () => {
    expect(schoolFor('repair')).toBe('driving_center');
  });

  it.each([
    ['blasting_academy', 'blasting'],
    ['management_office', 'management'],
    ['geology_lab', 'geology'],
  ] as Array<[BuildingType, SkillCategory]>)('%s teaches %s', (type, skill) => {
    expect(trainableSkills(type)).toContain(skill);
  });

  it('returns nothing for a building that is not a school', () => {
    expect(trainableSkills('freight_warehouse')).toEqual([]);
    expect(isTrainingBuilding('freight_warehouse')).toBe(false);
  });

  it('every skill category has a school, or it could never be obtained', () => {
    const ALL: SkillCategory[] = [
      'driving.truck', 'driving.excavator', 'driving.drill_rig', 'driving.rock_fragmenter',
      'blasting', 'management', 'geology', 'repair',
    ];
    for (const skill of ALL) {
      expect(schoolFor(skill), `${skill} has no school`).not.toBeNull();
    }
  });
});

// ── What a course costs ──────────────────────────────────────────────────────

describe('planTraining', () => {
  let state: GameState;

  beforeEach(() => { ({ state } = makeStateWithOne()); });

  it('a skill the employee lacks yields an unlock plan to the school tier', () => {
    const emp = state.employees.employees[0]!;
    const plan = planTraining(emp, 'driving.excavator', 1)!;
    expect(plan.skill).toBe('driving.excavator');
    expect(plan.kind).toBe('unlock');
    expect(plan.grantsLevel).toBe(1);
    expect(plan.fee).toBe(TRAINING_BASE_FEE);
    expect(plan.salaryIncrease).toBe(QUALIFICATION_SALARY_BONUS[1]);
  });

  it('TRAINING_LEVEL_FEE is 2500 / 5000 / 7500 by level', () => {
    expect(TRAINING_LEVEL_FEE).toEqual({ 1: 2500, 2: 5000, 3: 7500 });
  });

  it.each([
    [1, 2500, 20],
    [2, 5000, 23],
    [3, 7500, 20],
  ] as const)('a tier-%i school unlocking geology costs $%i and takes %i ticks', (tier, fee, ticks) => {
    const emp = state.employees.employees[0]!; // driller: no geology
    const plan = planTraining(emp, 'geology', tier)!;
    expect(plan.kind).toBe('unlock');
    expect(plan.grantsLevel).toBe(tier);
    expect(plan.fee).toBe(fee);
    expect(plan.fee).toBe(TRAINING_LEVEL_FEE[tier]);
    expect(plan.ticks).toBe(ticks);
    expect(plan.ticks).toBe(Math.max(1, Math.round(TRAINING_BASE_TICKS * TRAINING_TIER_SPEED[tier] * TRAINING_LEVEL_TICKS_MULT[tier])));
  });

  it.each([1, 2, 3] as const)('an unlock at tier %i raises salary by that level\'s bonus', (tier) => {
    const emp = state.employees.employees[0]!;
    expect(planTraining(emp, 'geology', tier)!.salaryIncrease).toBe(QUALIFICATION_SALARY_BONUS[tier]);
  });

  it('a held level-1 skill is upgraded by a tier-2 school: grants 2, raise is the bonus difference', () => {
    const emp = state.employees.employees[0]!; // holds blasting at 1
    const plan = planTraining(emp, 'blasting', 2)!;
    expect(plan).not.toBeNull();
    expect(plan.kind).toBe('upgrade');
    expect(plan.grantsLevel).toBe(2);
    expect(plan.fee).toBe(5000);
    expect(plan.salaryIncrease).toBe(QUALIFICATION_SALARY_BONUS[2] - QUALIFICATION_SALARY_BONUS[1]);
  });

  it('a held level-1 skill is upgraded to 3 by a tier-3 school; level 2 likewise', () => {
    const emp = state.employees.employees[0]!;
    expect(planTraining(emp, 'blasting', 3)!.salaryIncrease).toBe(QUALIFICATION_SALARY_BONUS[3] - QUALIFICATION_SALARY_BONUS[1]);
    assignSkill(state.employees, emp.id, 'blasting', 2);
    const plan = planTraining(emp, 'blasting', 3)!;
    expect(plan.kind).toBe('upgrade');
    expect(plan.grantsLevel).toBe(3);
    expect(plan.salaryIncrease).toBe(QUALIFICATION_SALARY_BONUS[3] - QUALIFICATION_SALARY_BONUS[2]);
  });

  it('returns null for a skill held at the school tier or above (tier-1 school, level 1)', () => {
    const emp = state.employees.employees[0]!;
    expect(planTraining(emp, 'blasting', 1)).toBeNull();
  });

  it.each([
    [2, 2], [2, 3], [3, 3], [1, 2], [1, 4], [3, 5], [2, 4],
  ] as const)('tier-%i school returns null for a skill held at level %i', (tier, level) => {
    const emp = state.employees.employees[0]!;
    assignSkill(state.employees, emp.id, 'blasting', level);
    expect(planTraining(emp, 'blasting', tier)).toBeNull();
  });

  it('a held level 4/5 skill is never trainable', () => {
    const emp = state.employees.employees[0]!;
    for (const level of [4, 5] as const) {
      assignSkill(state.employees, emp.id, 'blasting', level);
      for (const tier of [1, 2, 3] as const) expect(planTraining(emp, 'blasting', tier)).toBeNull();
    }
  });

  it('the fee does not depend on the proficiency the employee holds in other skills', () => {
    const emp = state.employees.employees[0]!;
    const before = planTraining(emp, 'geology', 2)!.fee;
    assignSkill(state.employees, emp.id, 'blasting', 4);
    expect(planTraining(emp, 'geology', 2)!.fee).toBe(before);
  });

  it('a course always takes at least one tick', () => {
    const emp = state.employees.employees[0]!;
    for (const tier of [1, 2, 3] as const) expect(planTraining(emp, 'geology', tier)!.ticks).toBeGreaterThanOrEqual(1);
  });

});

describe('planTraining — driving licences', () => {
  it('a first licence at tier 1 unlocks with the Rookie bonus and no licence level', () => {
    const { employee } = makeStateWithOne('surveyor');
    const plan = planTraining(employee, 'driving.excavator', 1)!;
    expect(plan.kind).toBe('unlock');
    expect(plan.grantsLevel).toBe(1);
    expect(plan.salaryIncrease).toBe(QUALIFICATION_SALARY_BONUS[1]);
  });

  it.each([2, 3] as const)('a first licence at tier %i unlocks at licence level equal to the tier with the level-1 pay bonus only', (tier) => {
    const { employee } = makeStateWithOne('surveyor');
    const plan = planTraining(employee, 'driving.excavator', tier)!;
    expect(plan.kind).toBe('unlock');
    expect(plan.grantsLevel).toBe(tier);
    expect(plan.salaryIncrease).toBe(QUALIFICATION_SALARY_BONUS[1]);
  });

  it('a held level-1 licence is upgraded at tier 2 with no pay change', () => {
    const { employee } = makeStateWithOne('driller');
    holdRigLicence(employee);
    const plan = planTraining(employee, 'driving.drill_rig', 2)!;
    expect(plan.kind).toBe('upgrade');
    expect(plan.grantsLevel).toBe(2);
    expect(plan.fee).toBe(5000);
    expect(plan.salaryIncrease).toBe(0);
  });

  it('a held level-1 licence goes to 3 at a tier-3 school', () => {
    const { employee } = makeStateWithOne('driller');
    holdRigLicence(employee);
    const plan = planTraining(employee, 'driving.drill_rig', 3)!;
    expect(plan.grantsLevel).toBe(3);
    expect(plan.fee).toBe(7500);
    expect(plan.kind).toBe('upgrade');
  });

  it('a level-1 licence is refused by a tier-1 school (missing licenceLevel counts as 1)', () => {
    const { employee } = makeStateWithOne('driller');
    holdRigLicence(employee);
    expect(planTraining(employee, 'driving.drill_rig', 1)).toBeNull();
  });

  it('a level-2 licence is refused at tier 2 and raised at tier 3', () => {
    const { employee } = makeStateWithOne('driller');
    holdRigLicence(employee, 2);
    expect(planTraining(employee, 'driving.drill_rig', 2)).toBeNull();
    expect(planTraining(employee, 'driving.drill_rig', 3)!.grantsLevel).toBe(3);
  });

  it('a level-3 licence is refused by every tier', () => {
    const { employee } = makeStateWithOne('driller');
    holdRigLicence(employee, 3);
    for (const tier of [1, 2, 3] as const) expect(planTraining(employee, 'driving.drill_rig', tier)).toBeNull();
  });

  it('proficiency level never changes the planned licence upgrade', () => {
    const { employee } = makeStateWithOne('driller');
    const qual = holdRigLicence(employee);
    qual.proficiencyLevel = 5;
    expect(planTraining(employee, 'driving.drill_rig', 2)!.grantsLevel).toBe(2);
  });

  it('repair (at the Driving Center) uses the proficiency path, not the licence path', () => {
    const { employee } = makeStateWithOne('driller');
    employee.qualifications.push({ category: 'repair', proficiencyLevel: 1, xp: 0 });
    const plan = planTraining(employee, 'repair', 2)!;
    expect(plan.kind).toBe('upgrade');
    expect(plan.grantsLevel).toBe(2);
    expect(plan.salaryIncrease).toBe(QUALIFICATION_SALARY_BONUS[2] - QUALIFICATION_SALARY_BONUS[1]);
  });
});

describe('heldCourseLevel', () => {
  it('is 0 when the skill is not held', () => {
    expect(heldCourseLevel([], 'geology')).toBe(0);
  });

  it('is the proficiency level for a non-driving skill', () => {
    expect(heldCourseLevel([{ category: 'geology', proficiencyLevel: 4, xp: 600 }], 'geology')).toBe(4);
  });

  it('is the licence level for a driving skill, ignoring proficiency', () => {
    expect(heldCourseLevel([{ category: 'driving.truck', proficiencyLevel: 5, xp: 1000, licenceLevel: 2 }], 'driving.truck')).toBe(2);
  });

  it('defaults a driving licence without licenceLevel to 1', () => {
    expect(heldCourseLevel([{ category: 'driving.truck', proficiencyLevel: 3, xp: 300 }], 'driving.truck')).toBe(1);
  });

  it('treats repair as a proficiency skill', () => {
    expect(heldCourseLevel([{ category: 'repair', proficiencyLevel: 3, xp: 300 }], 'repair')).toBe(3);
  });
});

describe('trainingRefusal', () => {
  it('tells a level-1 holder of a tier-1 school to find a higher school', () => {
    const { employee } = makeStateWithOne('driller');
    const refusal = trainingRefusal(employee, 'blasting', 1);
    expect(refusal.errorKey).toBe('employees.train_needs_higher_school');
    expect(refusal.error.length).toBeGreaterThan(0);
  });

  it('tells a level-2 holder of a tier-2 school to find a higher school', () => {
    const { employee, state } = makeStateWithOne('driller');
    assignSkill(state.employees, employee.id, 'blasting', 2);
    expect(trainingRefusal(employee, 'blasting', 2).errorKey).toBe('employees.train_needs_higher_school');
  });

  it('says top level for a holder of level 3 at any school', () => {
    const { employee, state } = makeStateWithOne('driller');
    assignSkill(state.employees, employee.id, 'blasting', 3);
    for (const tier of [1, 2, 3] as const) expect(trainingRefusal(employee, 'blasting', tier).errorKey).toBe('employees.train_top_level');
  });

  it('says top level for a held level 4/5', () => {
    const { employee, state } = makeStateWithOne('driller');
    assignSkill(state.employees, employee.id, 'blasting', 5);
    expect(trainingRefusal(employee, 'blasting', 1).errorKey).toBe('employees.train_top_level');
  });

  it('a level-3 driving licence is top level', () => {
    const { employee } = makeStateWithOne('driller');
    holdRigLicence(employee, 3);
    expect(trainingRefusal(employee, 'driving.drill_rig', 3).errorKey).toBe('employees.train_top_level');
  });

  it('carries params that resolve both keys in en and fr', () => {
    const { employee, state } = makeStateWithOne('driller');
    const needs = trainingRefusal(employee, 'blasting', 1);
    assignSkill(state.employees, employee.id, 'blasting', 3);
    const top = trainingRefusal(employee, 'blasting', 3);
    for (const locale of ['en', 'fr'] as const) {
      setLocale(locale);
      for (const r of [needs, top]) {
        expect(t(r.errorKey!, r.errorParams), `${r.errorKey} in ${locale}`).not.toBe(r.errorKey);
      }
    }
    setLocale('en');
  });
});


// ── Enrolling — validation before any walk starts ─────────────────────────────

describe('enrolInTraining — validation', () => {
  let state: GameState;

  beforeEach(() => { ({ state } = makeStateWithOne()); });

  it('enrols at a driving center for the repair skill (#1393)', () => {
    const building = makeBuilding({ type: 'driving_center' });
    state.buildings.buildings.push(building);
    expectSuccess(enrolInTraining(state, 1, building, 'repair'));
  });

  it('enrols at a school that teaches the skill: success, fee, and pendingTrainingState (not trainingState) set', () => {
    const building = makeBuilding({ type: 'geology_lab' });
    state.buildings.buildings.push(building);
    const result = enrolInTraining(state, 1, building, 'geology');
    expectSuccess(result);
    expect(result.fee).toBeGreaterThan(0);
    const emp = state.employees.employees[0]!;
    expect(emp.trainingState).toBeNull();
    expect(emp.pendingTrainingState?.skill).toBe('geology');
  });

  it('refuses a school that does not teach the skill', () => {
    const result = enrolInTraining(state, 1, makeBuilding({ type: 'geology_lab' }), 'driving.excavator');
    expectFailure(result);
    expect(result.error).toContain('does not teach');
    if (!result.success) {
      expect(result.errorKey).toBe('employees.train_building_no_teach');
      expect(result.errorParams).toEqual({ buildingId: 1, skill: 'driving.excavator' });
    }
    expect(state.employees.employees[0]!.trainingState).toBeNull();
    expect(state.employees.employees[0]!.pendingTrainingState).toBeNull();
  });

  it('refuses a building that is not a school at all', () => {
    expect(enrolInTraining(state, 1, makeBuilding({ type: 'freight_warehouse' }), 'geology').success).toBe(false);
  });

  it('refuses an employee already enrolled — mid-walk (pendingTrainingState set)', () => {
    const building = makeBuilding({ id: 1, type: 'geology_lab' });
    state.buildings.buildings.push(building);
    const first = enrolInTraining(state, 1, building, 'geology');
    expectSuccess(first);

    const second = enrolInTraining(state, 1, makeBuilding({ id: 2, type: 'blasting_academy' }), 'blasting');
    expectFailure(second);
    expect(state.employees.employees[0]!.pendingTrainingState!.skill).toBe('geology');
  });

  it('refuses an employee already enrolled — inside, mid-course (trainingState set)', () => {
    const emp = state.employees.employees[0]!;
    emp.trainingState = { buildingId: 77, skill: 'geology', ticksRemaining: 5, fee: 100 };

    const result = enrolInTraining(state, 1, makeBuilding({ id: 2, type: 'blasting_academy' }), 'blasting');
    expectFailure(result);
    expect(emp.trainingState.skill).toBe('geology');
  });

  it('refuses an injured employee', () => {
    state.employees.employees[0]!.injured = true;
    const result = enrolInTraining(state, 1, makeBuilding({ type: 'geology_lab' }), 'geology');
    expectFailure(result);
    expect(result.error).toContain('Injured');
  });

  it('refuses an unknown employee', () => {
    expect(enrolInTraining(state, 999, makeBuilding({ type: 'geology_lab' }), 'geology').success).toBe(false);
  });

  it.each([
    [1, 1, 'employees.train_needs_higher_school'],
    [1, 3, 'employees.train_top_level'],
    [1, 5, 'employees.train_top_level'],
    [2, 2, 'employees.train_needs_higher_school'],
    [3, 3, 'employees.train_top_level'],
  ] as const)('a tier-%i school refuses a skill held at level %i with %s, translated', (tier, level, expectedKey) => {
    assignSkill(state.employees, 1, 'blasting', level);
    const building = makeBuilding({ type: 'blasting_academy', tier });
    const result = enrolInTraining(state, 1, building, 'blasting');
    expectFailure(result);
    expect(result.error.length).toBeGreaterThan(0);
    const key = (result as { errorKey?: string }).errorKey;
    expect(key).toBe(expectedKey);
    for (const locale of ['en', 'fr'] as const) {
      setLocale(locale);
      const params = (result as { errorParams?: Record<string, string | number> }).errorParams;
      expect(t(key!, params), `${key} must resolve in ${locale}`).not.toBe(key);
    }
    setLocale('en');
    const emp = state.employees.employees[0]!;
    expect(emp.pendingTrainingState).toBeNull();
    expect(emp.trainingState).toBeNull();
    expect(emp.qualifications.find(q => q.category === 'blasting')!.proficiencyLevel).toBe(level);
  });

  it('a tier-2 school accepts a level-1 holder and stores grantsLevel on the pending state', () => {
    const building = makeBuilding({ type: 'blasting_academy', tier: 2 });
    state.buildings.buildings.push(building);
    const result = enrolInTraining(state, 1, building, 'blasting');
    expectSuccess(result);
    expect(result.plan.kind).toBe('upgrade');
    expect(result.plan.grantsLevel).toBe(2);
    expect(result.fee).toBe(5000);
    expect(state.employees.employees[0]!.pendingTrainingState!.grantsLevel).toBe(2);
  });

  it('an unlock stores grantsLevel equal to the school tier', () => {
    const building = makeBuilding({ type: 'geology_lab', tier: 3 });
    state.buildings.buildings.push(building);
    expectSuccess(enrolInTraining(state, 1, building, 'geology'));
    expect(state.employees.employees[0]!.pendingTrainingState!.grantsLevel).toBe(3);
  });
});

// ── Enrolling sends the employee walking to the school (#1203) ───────────────
//
// Supersedes the old instant-teleport model (#410, previously tested here):
// enrolment now queues a walk via moveTo; the countdown starts only once
// ArrivalGate confirms the employee has actually entered the building.

describe('enrolInTraining — walk-in and occupancy (#1203)', () => {
  it('on success, sets pendingTrainingState (not trainingState) and installs a walking itinerary — no instant relocation', () => {
    const { state, school } = setupSchool('geology_lab');
    const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), 2, 2);

    const result = enrolInTraining(state, employee.id, school, 'geology');
    expectSuccess(result);

    expect(employee.trainingState).toBeNull();
    expect(employee.pendingTrainingState).not.toBeNull();
    expect(employee.pendingTrainingState!.buildingId).toBe(school.id);
    expect(employee.pendingTrainingState!.skill).toBe('geology');
    expect(employee.pendingTrainingState!.ticksRemaining).toBe(result.plan.ticks);
    expect(employee.pendingTrainingState!.fee).toBe(result.fee);
    // Not teleported next to the building — an itinerary is in flight, and
    // the employee's own position has not jumped.
    expect(employee.itinerary).not.toBeNull();
    expect({ x: employee.x, z: employee.z }).toEqual({ x: 2, z: 2 });
  });

  it('does not decrement the countdown while still walking (tickTraining only iterates trainingState !== null employees)', () => {
    const { state, school } = setupSchool('geology_lab');
    const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), 2, 2);

    const result = enrolInTraining(state, employee.id, school, 'geology');
    expectSuccess(result);
    const queuedTicks = employee.pendingTrainingState!.ticksRemaining;

    for (let i = 0; i < 3; i++) tickTraining(state);

    expect(employee.pendingTrainingState!.ticksRemaining).toBe(queuedTicks);
    expect(employee.trainingState).toBeNull();
  });

  it('on arrival, enters the school: pendingTrainingState is promoted into trainingState, locomotion is "inside" (mesh hidden)', () => {
    const { state, school } = setupSchool('geology_lab');
    const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), 2, 2);

    const result = enrolInTraining(state, employee.id, school, 'geology');
    expectSuccess(result);
    const queuedTicks = employee.pendingTrainingState!.ticksRemaining;

    resolveArrival(state, employee);

    expect(employee.locomotion).toEqual({ kind: 'inside', buildingId: school.id });
    // isOccupyingHost is the predicate the renderer/minimap use to decide
    // "no body of their own in the world" — the mesh-hidden signal.
    expect(isOccupyingHost(employee.locomotion)).toBe(true);
    expect(employee.pendingTrainingState).toBeNull();
    expect(employee.trainingState).not.toBeNull();
    expect(employee.trainingState!.buildingId).toBe(school.id);
    expect(employee.trainingState!.skill).toBe('geology');
    expect(employee.trainingState!.ticksRemaining).toBe(queuedTicks);
  });

  it('completes the course once ticksRemaining hits 0: reported in completed[], leaves the building back onto its ring, on foot', () => {
    const { state, school } = setupSchool('geology_lab');
    const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), 2, 2);

    const result = enrolInTraining(state, employee.id, school, 'geology');
    expectSuccess(result);
    resolveArrival(state, employee);
    expect(employee.locomotion.kind).toBe('inside');

    let lastCompleted: ReturnType<typeof tickTraining>['completed'] = [];
    for (let i = 0; i < result.plan.ticks; i++) {
      ({ completed: lastCompleted } = tickTraining(state));
    }

    expect(lastCompleted.some(c => c.employeeId === employee.id)).toBe(true);
    expect(employee.trainingState).toBeNull();
    // leaveBuilding puts them back on foot on the building's ring, not inside.
    expect(employee.locomotion).toEqual({ kind: 'on_foot' });
    expect(isOccupyingHost(employee.locomotion)).toBe(false);
    expect(school.occupantIds).not.toContain(employee.id);
  });
});

// ── A school at capacity refuses enrolment (#1203) ────────────────────────────

describe('enrolInTraining — school at capacity (#1203)', () => {
  it('refuses enrolment once occupantIds already fill the school\'s people capacity', () => {
    const { state, school } = setupSchool('driving_center');
    const capacity = getBuildingPeopleCapacity(school.type, school.tier);
    // Synthetic occupant ids — isSchoolFull only cares about the count.
    school.occupantIds = Array.from({ length: capacity }, (_, i) => -(i + 1));
    const { employee } = hireEmployee(state.employees, 'driver', new Random(SEED), 2, 2);

    const result = enrolInTraining(state, employee.id, school, 'driving.rock_fragmenter');

    expectFailure(result);
    expect(result.error.toLowerCase()).toContain('full');
    expect(employee.pendingTrainingState).toBeNull();
    expect(employee.itinerary).toBeNull();
    expect({ x: employee.x, z: employee.z }).toEqual({ x: 2, z: 2 });
  });

  it('reservation counts walkers, not just occupants: enrolling exactly `capacity` employees all succeed, and one more fails, even though none has arrived yet', () => {
    const { state, school } = setupSchool('driving_center');
    const capacity = getBuildingPeopleCapacity(school.type, school.tier);

    for (let i = 0; i < capacity; i++) {
      const { employee } = hireEmployee(state.employees, 'driver', new Random(SEED), 2, 2 + i);
      const result = enrolInTraining(state, employee.id, school, 'driving.rock_fragmenter');
      expectSuccess(result);
    }
    // Nobody has actually walked in yet — the block above is purely
    // reservation via pendingTrainingState.
    expect(school.occupantIds).toEqual([]);

    const { employee: late } = hireEmployee(state.employees, 'driver', new Random(SEED), 2, 2 + capacity);
    const result = enrolInTraining(state, late.id, school, 'driving.rock_fragmenter');

    expectFailure(result);
    expect(result.error.toLowerCase()).toContain('full');
    expect(late.pendingTrainingState).toBeNull();
  });
});

// ── A mounted employee alights first (#1203) ──────────────────────────────────

describe('enrolInTraining — a mounted employee', () => {
  it('ends up alighted, on foot, walking toward the school — no dangling mount state', () => {
    const { state, school } = setupSchool('driving_center');
    const { employee } = hireEmployee(state.employees, 'driver', new Random(SEED), 2, 2);
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 2, 2);
    expect(board(state, vehicle.id, employee.id).success).toBe(true);
    expect(employee.locomotion).toEqual({ kind: 'mounted', vehicleId: vehicle.id });

    const result = enrolInTraining(state, employee.id, school, 'driving.rock_fragmenter');

    expectSuccess(result);
    expect(employee.locomotion).toEqual({ kind: 'on_foot' });
    expect(vehicle.occupantIds).not.toContain(employee.id);
    expect(employee.itinerary).not.toBeNull();
    expect(employee.pendingTrainingState).not.toBeNull();
  });
});

// ── The school teaching a mid-course trainee is demolished (#1203) ───────────

describe('tickTraining — school destroyed mid-course', () => {
  it('cancels the course with a full refund instead of ticking it down or granting anything, once the building no longer exists', () => {
    const { state, school } = setupSchool('geology_lab');
    const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), 2, 2);

    const result = enrolInTraining(state, employee.id, school, 'geology');
    expectSuccess(result);
    resolveArrival(state, employee);
    expect(employee.trainingState).not.toBeNull();
    const fee = result.fee;

    destroyBuilding(state.buildings, school.id);

    const { completed, cancelled } = tickTraining(state);

    expect(completed).toHaveLength(0);
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0]!.employeeId).toBe(employee.id);
    expect(cancelled[0]!.refund).toBe(fee);
    expect(employee.trainingState).toBeNull();
  });
});

// ── The skills that exist only through training ──────────────────────────────

describe('licences no role is hired with', () => {
  it.each(['driving.rock_fragmenter', 'driving.drill_rig'] as SkillCategory[])(
    'a driver can obtain %s by walking to, entering, and finishing a driving-center course',
    (skill) => {
      const { state, school } = setupSchool('driving_center');
      const { employee } = hireEmployee(state.employees, 'driver', new Random(SEED), 2, 2);
      expect(employee.qualifications.some(q => q.category === skill)).toBe(false);

      const result = enrolInTraining(state, employee.id, school, skill);
      expectSuccess(result);
      resolveArrival(state, employee);
      expect(employee.locomotion.kind).toBe('inside');

      for (let i = 0; i < result.plan.ticks; i++) tickTraining(state);

      expect(employee.qualifications.some(q => q.category === skill)).toBe(true);
      expect(employee.trainingState).toBeNull();
      expect(employee.locomotion.kind).toBe('on_foot');
    },
  );

  it('a surveyor cannot repeat the geology level they hold at a tier-1 school', () => {
    const { state, school } = setupSchool('geology_lab', 1);
    const { employee } = hireEmployee(state.employees, 'surveyor', new Random(SEED), 2, 2);
    expect(employee.qualifications.find(q => q.category === 'geology')!.proficiencyLevel).toBe(1);
    expect(enrolInTraining(state, employee.id, school, 'geology').success).toBe(false);
    expect(planTraining(employee, 'geology', 1)).toBeNull();
  });

  it('a tier-3 geology lab raises a level-1 surveyor to level 3', () => {
    const { state, school } = setupSchool('geology_lab', 3);
    const { employee } = hireEmployee(state.employees, 'surveyor', new Random(SEED), 2, 2);
    expect(planTraining(employee, 'geology', 3)!.grantsLevel).toBe(3);
    expectSuccess(enrolInTraining(state, employee.id, school, 'geology'));
  });
});

// ── Level-1 course completion (#1388) ───────────────────────────────────────
//
// A level-1 course on a skill the employee lacks adds it at Rookie with 0 xp;
// completion never touches a skill already held at that level or above.

/** Puts `employee` mid-course (inside `school`) on `skill`, one tick from done, granting `grantsLevel`. */
function startFinalTick(employee: Employee, school: Building, skill: SkillCategory, grantsLevel: 1 | 2 | 3 = 1): void {
  employee.trainingState = { buildingId: school.id, skill, ticksRemaining: 1, fee: TRAINING_BASE_FEE, grantsLevel };
}

/** As `startFinalTick`, but a course saved before `grantsLevel` existed. */
function startLegacyFinalTick(employee: Employee, school: Building, skill: SkillCategory): void {
  employee.trainingState = { buildingId: school.id, skill, ticksRemaining: 1, fee: TRAINING_BASE_FEE };
}

describe('tickTraining — level-1 course completion', () => {
  it('a brand-new qualification starts at level 1 with 0 xp', () => {
    const { state, school } = setupSchool('driving_center');
    const { employee } = hireEmployee(state.employees, 'driver', new Random(SEED), 2, 2); // truck + excavator, not the fragmenter
    expect(employee.qualifications.some(q => q.category === 'driving.rock_fragmenter')).toBe(false);

    const result = enrolInTraining(state, employee.id, school, 'driving.rock_fragmenter');
    expectSuccess(result);
    resolveArrival(state, employee);
    for (let i = 0; i < result.plan.ticks; i++) tickTraining(state);

    const qual = employee.qualifications.find(q => q.category === 'driving.rock_fragmenter')!;
    expect(qual).toEqual({ category: 'driving.rock_fragmenter', proficiencyLevel: 1, xp: 0 });
  });

  it('completion reports the course as new at level 1', () => {
    const { state, school } = setupSchool('geology_lab');
    const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), 2, 2);
    const result = enrolInTraining(state, employee.id, school, 'geology');
    expectSuccess(result);
    resolveArrival(state, employee);
    let last: ReturnType<typeof tickTraining>['completed'] = [];
    for (let i = 0; i < result.plan.ticks; i++) ({ completed: last } = tickTraining(state));
    expect(last).toHaveLength(1);
    expect(last[0]).toMatchObject({ employeeId: employee.id, skill: 'geology', level: 1, isNew: true });
  });

  it('emits employee:trained with the new skill at level 1', () => {
    const { state, school } = setupSchool('geology_lab');
    const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), 2, 2);
    const emitter = new EventEmitter();
    const seen: unknown[] = [];
    emitter.on('employee:trained', (p: unknown) => seen.push(p));
    startFinalTick(employee, school, 'geology');
    tickTraining(state, emitter);
    expect(seen).toEqual([{ employeeId: employee.id, skill: 'geology', level: 1, isNew: true }]);
  });

  it('recomputes salary by exactly the planned increase', () => {
    const { state, school } = setupSchool('geology_lab');
    const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), 2, 2);
    const plan = planTraining(employee, 'geology', 1)!;
    const before = employee.salary;
    startFinalTick(employee, school, 'geology');
    tickTraining(state);
    expect(employee.salary - before).toBe(plan.salaryIncrease);
    expect(employee.salary).toBe(BASE_SALARIES[employee.role] + calculateQualificationBonus(employee));
  });

  it('completing on an already-held skill is skipped: level, xp and salary untouched, no completion reported', () => {
    const { state, school } = setupSchool('blasting_academy');
    const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), 2, 2);
    assignSkill(state.employees, employee.id, 'blasting', 3);
    const qual = employee.qualifications.find(q => q.category === 'blasting')!;
    qual.xp = XP_THRESHOLDS[3] + 7;
    const salaryBefore = employee.salary;

    startFinalTick(employee, school, 'blasting');
    const { completed } = tickTraining(state);

    expect(completed).toEqual([]);
    expect(qual.proficiencyLevel).toBe(3);
    expect(qual.xp).toBe(XP_THRESHOLDS[3] + 7);
    expect(employee.qualifications.filter(q => q.category === 'blasting')).toHaveLength(1);
    expect(employee.salary).toBe(salaryBefore);
  });
});

// ── availableTrainingOffers ──────────────────────────────────────────────────

describe('availableTrainingOffers', () => {
  it('returns nothing with no buildings', () => {
    expect(availableTrainingOffers([])).toEqual([]);
  });

  it('returns nothing when the only building on site teaches nothing', () => {
    expect(availableTrainingOffers([makeBuilding({ type: 'freight_warehouse' })])).toEqual([]);
  });

  it('offers every skill a school on site teaches', () => {
    const offers = availableTrainingOffers([
      makeBuilding({ id: 1, type: 'geology_lab' }),
      makeBuilding({ id: 2, type: 'blasting_academy' }),
    ]);
    expect(offers).toHaveLength(2);
    expect(offers.map(o => o.skill).sort()).toEqual(['blasting', 'geology']);
  });

  it('picks the higher-tier school when two schools teach the same skill', () => {
    const offers = availableTrainingOffers([
      makeBuilding({ id: 1, type: 'geology_lab', tier: 1 }),
      makeBuilding({ id: 2, type: 'geology_lab', tier: 3 }),
    ]);
    expect(offers).toHaveLength(1);
    expect(offers[0]!.building.id).toBe(2);
  });

  it('a driving_center offers all four licences and repair from one building', () => {
    const offers = availableTrainingOffers([makeBuilding({ type: 'driving_center' })]);
    expect(offers.map(o => o.skill).sort()).toEqual(['driving.drill_rig', 'driving.excavator', 'driving.rock_fragmenter', 'driving.truck', 'repair']);
  });
});

// ── Raises survive enrolment-driven course completion (#1383) ───────────────

describe('tickTraining keeps accumulated raises (#1383)', () => {
  it('a new-skill course completion keeps the raise', () => {
    const { state, school } = setupSchool('geology_lab');
    const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), 2, 2);
    giveRaise(state.employees, employee.id, 250);

    const result = enrolInTraining(state, employee.id, school, 'geology');
    expectSuccess(result);
    resolveArrival(state, employee);
    for (let i = 0; i < result.plan.ticks; i++) tickTraining(state);

    expect(employee.raises).toBe(250);
    expect(employee.salary).toBe(BASE_SALARIES[employee.role] + calculateQualificationBonus(employee) + 250);
  });

  it('a second new skill completion keeps the raise', () => {
    const { state, school } = setupSchool('driving_center');
    const { employee } = hireEmployee(state.employees, 'driver', new Random(SEED), 2, 2);
    giveRaise(state.employees, employee.id, 250);

    const result = enrolInTraining(state, employee.id, school, 'driving.rock_fragmenter');
    expectSuccess(result);
    resolveArrival(state, employee);
    for (let i = 0; i < result.plan.ticks; i++) tickTraining(state);

    expect(employee.qualifications.some(q => q.category === 'driving.rock_fragmenter')).toBe(true);
    expect(employee.salary).toBe(BASE_SALARIES[employee.role] + calculateQualificationBonus(employee) + 250);
  });
});

// ── Level courses: a tier-N school brings a skill to level N (#1726) ─────────

function holdRigLicence(employee: Employee, licenceLevel?: 1 | 2 | 3) {
  employee.qualifications = employee.qualifications.filter(q => q.category !== 'driving.drill_rig');
  employee.qualifications.push({ category: 'driving.drill_rig', proficiencyLevel: 1, xp: 0 });
  const qual = employee.qualifications.find(q => q.category === 'driving.drill_rig')!;
  if (licenceLevel !== undefined) qual.licenceLevel = licenceLevel;
  return qual;
}

/** Enrols, walks in and runs the whole course; returns the result. */
function runCourse(state: GameState, employee: Employee, school: Building, skill: SkillCategory, emitter?: EventEmitter) {
  const result = enrolInTraining(state, employee.id, school, skill);
  expectSuccess(result);
  resolveArrival(state, employee);
  const completed: ReturnType<typeof tickTraining>['completed'] = [];
  for (let i = 0; i < result.plan.ticks; i++) completed.push(...tickTraining(state, emitter).completed);
  return { result, completed };
}

describe('tickTraining — non-driving level courses (#1726)', () => {
  it('a tier-2 school unlocking a skill grants level 2 with the level-2 xp threshold', () => {
    const { state, school } = setupSchool('geology_lab', 2);
    const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), 2, 2);
    const { completed } = runCourse(state, employee, school, 'geology');
    expect(employee.qualifications.find(q => q.category === 'geology')).toEqual(qualificationAtLevel('geology', 2));
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({ skill: 'geology', level: 2, isNew: true });
    expect(employee.salary).toBe(calculateSalary(employee));
  });

  it('a tier-3 school unlocking a skill grants level 3', () => {
    const { state, school } = setupSchool('geology_lab', 3);
    const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), 2, 2);
    runCourse(state, employee, school, 'geology');
    expect(employee.qualifications.find(q => q.category === 'geology')).toEqual(qualificationAtLevel('geology', 3));
  });

  it('a tier-1 school unlocking a skill still grants level 1 with 0 xp', () => {
    const { state, school } = setupSchool('geology_lab', 1);
    const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), 2, 2);
    runCourse(state, employee, school, 'geology');
    expect(employee.qualifications.find(q => q.category === 'geology')).toEqual({ category: 'geology', proficiencyLevel: 1, xp: 0 });
  });

  it('an upgrade at tier 2 sets proficiency 2, lifts xp to the level-2 threshold and reports isNew false', () => {
    const { state, school } = setupSchool('blasting_academy', 2);
    const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), 2, 2);
    const qual = employee.qualifications.find(q => q.category === 'blasting')!;
    qual.xp = 10;
    const salaryBefore = employee.salary;
    const { completed } = runCourse(state, employee, school, 'blasting');
    expect(qual.proficiencyLevel).toBe(2);
    expect(qual.xp).toBe(XP_THRESHOLDS[2]);
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({ skill: 'blasting', level: 2, isNew: false });
    expect(employee.salary - salaryBefore).toBe(QUALIFICATION_SALARY_BONUS[2] - QUALIFICATION_SALARY_BONUS[1]);
    expect(employee.salary).toBe(calculateSalary(employee));
  });

  it('an upgrade keeps xp already above the new level\'s threshold', () => {
    const { state, school } = setupSchool('blasting_academy', 2);
    const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), 2, 2);
    const qual = employee.qualifications.find(q => q.category === 'blasting')!;
    qual.xp = XP_THRESHOLDS[2] + 50;
    runCourse(state, employee, school, 'blasting');
    expect(qual.proficiencyLevel).toBe(2);
    expect(qual.xp).toBe(XP_THRESHOLDS[2] + 50);
  });

  it('a level-1 holder goes straight to 3 at a tier-3 school', () => {
    const { state, school } = setupSchool('blasting_academy', 3);
    const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), 2, 2);
    const qual = employee.qualifications.find(q => q.category === 'blasting')!;
    runCourse(state, employee, school, 'blasting');
    expect(qual.proficiencyLevel).toBe(3);
    expect(qual.xp).toBe(XP_THRESHOLDS[3]);
  });

  it('emits employee:trained with the granted level and isNew', () => {
    const { state, school } = setupSchool('blasting_academy', 2);
    const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), 2, 2);
    const emitter = new EventEmitter();
    const seen: unknown[] = [];
    emitter.on('employee:trained', (p: unknown) => seen.push(p));
    runCourse(state, employee, school, 'blasting', emitter);
    expect(seen).toEqual([{ employeeId: employee.id, skill: 'blasting', level: 2, isNew: false }]);
  });

  it('emits isNew true for a tier-2 unlock', () => {
    const { state, school } = setupSchool('geology_lab', 2);
    const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), 2, 2);
    const emitter = new EventEmitter();
    const seen: unknown[] = [];
    emitter.on('employee:trained', (p: unknown) => seen.push(p));
    runCourse(state, employee, school, 'geology', emitter);
    expect(seen).toEqual([{ employeeId: employee.id, skill: 'geology', level: 2, isNew: true }]);
  });

  it('keeps accumulated raises through an upgrade', () => {
    const { state, school } = setupSchool('blasting_academy', 2);
    const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), 2, 2);
    giveRaise(state.employees, employee.id, 250);
    runCourse(state, employee, school, 'blasting');
    expect(employee.raises).toBe(250);
    expect(employee.salary).toBe(calculateSalary(employee));
  });

  it('a course whose level the employee reached mid-course completes silently (stale)', () => {
    const { state, school } = setupSchool('blasting_academy', 2);
    const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), 2, 2);
    assignSkill(state.employees, employee.id, 'blasting', 3);
    const qual = employee.qualifications.find(q => q.category === 'blasting')!;
    qual.xp = XP_THRESHOLDS[3] + 4;
    const salaryBefore = employee.salary;
    employee.trainingState = { buildingId: school.id, skill: 'blasting', ticksRemaining: 1, fee: 5000, grantsLevel: 2 };
    const emitter = new EventEmitter();
    const seen: unknown[] = [];
    emitter.on('employee:trained', (p: unknown) => seen.push(p));
    const { completed } = tickTraining(state, emitter);
    expect(completed).toEqual([]);
    expect(seen).toEqual([]);
    expect(employee.trainingState).toBeNull();
    expect(qual.proficiencyLevel).toBe(3);
    expect(qual.xp).toBe(XP_THRESHOLDS[3] + 4);
    expect(employee.salary).toBe(salaryBefore);
  });

  it('a stale unlock (skill acquired mid-course at the same level) changes nothing', () => {
    const { state, school } = setupSchool('geology_lab', 1);
    const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), 2, 2);
    assignSkill(state.employees, employee.id, 'geology', 1);
    employee.trainingState = { buildingId: school.id, skill: 'geology', ticksRemaining: 1, fee: 2500, grantsLevel: 1 };
    expect(tickTraining(state).completed).toEqual([]);
    expect(employee.qualifications.filter(q => q.category === 'geology')).toHaveLength(1);
  });
});

describe('tickTraining — driving licence courses (#1726)', () => {
  it('a tier-2 Driving Center raises a level-1 licence to 2, leaving proficiency and xp untouched', () => {
    const { state, school } = setupSchool('driving_center', 2);
    const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), 2, 2);
    const qual = holdRigLicence(employee);
    qual.proficiencyLevel = 3;
    qual.xp = XP_THRESHOLDS[3] + 5;
    employee.salary = calculateSalary(employee); // fixture edit above moved the bonus; start in sync
    const salaryBefore = employee.salary;

    const { result, completed } = runCourse(state, employee, school, 'driving.drill_rig');
    expect(result.plan.grantsLevel).toBe(2);

    const after = employee.qualifications.filter(q => q.category === 'driving.drill_rig');
    expect(after).toHaveLength(1);
    expect(after[0]!.licenceLevel).toBe(2);
    expect(after[0]!.proficiencyLevel).toBe(3);
    expect(after[0]!.xp).toBe(XP_THRESHOLDS[3] + 5);
    expect(employee.salary).toBe(salaryBefore);
    expect(completed[0]).toMatchObject({ skill: 'driving.drill_rig', level: 2, isNew: false });
  });

  it('a tier-3 Driving Center takes a level-1 licence to 3 in one course', () => {
    const { state, school } = setupSchool('driving_center', 3);
    const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), 2, 2);
    holdRigLicence(employee);
    runCourse(state, employee, school, 'driving.drill_rig');
    expect(employee.qualifications.find(q => q.category === 'driving.drill_rig')!.licenceLevel).toBe(3);
  });

  it('a tier-1 Driving Center refuses a licence already held at level 1', () => {
    const { state, school } = setupSchool('driving_center', 1);
    const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), 2, 2);
    holdRigLicence(employee);
    const result = enrolInTraining(state, employee.id, school, 'driving.drill_rig');
    expectFailure(result);
    expect((result as { errorKey?: string }).errorKey).toBe('employees.train_needs_higher_school');
  });

  it('a tier-2 Driving Center refuses a level-2 licence and a level-3 licence', () => {
    const { state, school } = setupSchool('driving_center', 2);
    const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), 2, 2);
    holdRigLicence(employee, 2);
    expect((enrolInTraining(state, employee.id, school, 'driving.drill_rig') as { errorKey?: string }).errorKey)
      .toBe('employees.train_needs_higher_school');
    holdRigLicence(employee, 3);
    expect((enrolInTraining(state, employee.id, school, 'driving.drill_rig') as { errorKey?: string }).errorKey)
      .toBe('employees.train_top_level');
  });

  it('a first licence at tier 2 pushes proficiency 1, xp 0 and licenceLevel 2, with the level-1 pay bonus', () => {
    const { state, school } = setupSchool('driving_center', 2);
    const { employee } = hireEmployee(state.employees, 'driver', new Random(SEED), 2, 2);
    const salaryBefore = employee.salary;
    const { completed } = runCourse(state, employee, school, 'driving.rock_fragmenter');
    expect(employee.qualifications.find(q => q.category === 'driving.rock_fragmenter'))
      .toEqual({ category: 'driving.rock_fragmenter', proficiencyLevel: 1, xp: 0, licenceLevel: 2 });
    expect(employee.salary - salaryBefore).toBe(QUALIFICATION_SALARY_BONUS[1]);
    expect(completed[0]).toMatchObject({ skill: 'driving.rock_fragmenter', level: 2, isNew: true });
  });

  it('a first licence at tier 1 omits licenceLevel', () => {
    const { state, school } = setupSchool('driving_center', 1);
    const { employee } = hireEmployee(state.employees, 'driver', new Random(SEED), 2, 2);
    runCourse(state, employee, school, 'driving.rock_fragmenter');
    const qual = employee.qualifications.find(q => q.category === 'driving.rock_fragmenter')!;
    expect(qual).toEqual({ category: 'driving.rock_fragmenter', proficiencyLevel: 1, xp: 0 });
    expect('licenceLevel' in qual).toBe(false);
  });

  it('a first licence at tier 3 gets licenceLevel 3', () => {
    const { state, school } = setupSchool('driving_center', 3);
    const { employee } = hireEmployee(state.employees, 'driver', new Random(SEED), 2, 2);
    runCourse(state, employee, school, 'driving.rock_fragmenter');
    expect(employee.qualifications.find(q => q.category === 'driving.rock_fragmenter')!.licenceLevel).toBe(3);
  });

  it('emits the licence level as the trained level for a driving upgrade', () => {
    const { state, school } = setupSchool('driving_center', 2);
    const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), 2, 2);
    const qual = holdRigLicence(employee);
    qual.proficiencyLevel = 4;
    qual.xp = XP_THRESHOLDS[4];
    const emitter = new EventEmitter();
    const seen: unknown[] = [];
    emitter.on('employee:trained', (p: unknown) => seen.push(p));
    runCourse(state, employee, school, 'driving.drill_rig', emitter);
    expect(seen).toEqual([{ employeeId: employee.id, skill: 'driving.drill_rig', level: 2, isNew: false }]);
  });

  it('a stale licence course (licence already at or above the grant) completes silently', () => {
    const { state, school } = setupSchool('driving_center', 2);
    const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), 2, 2);
    const qual = holdRigLicence(employee, 3);
    employee.trainingState = { buildingId: school.id, skill: 'driving.drill_rig', ticksRemaining: 1, fee: 5000, grantsLevel: 2 };
    expect(tickTraining(state).completed).toEqual([]);
    expect(qual.licenceLevel).toBe(3);
  });

  it('repair at the Driving Center upgrades proficiency, not a licence level', () => {
    const { state, school } = setupSchool('driving_center', 2);
    const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), 2, 2);
    employee.qualifications.push({ category: 'repair', proficiencyLevel: 1, xp: 0 });
    runCourse(state, employee, school, 'repair');
    const qual = employee.qualifications.find(q => q.category === 'repair')!;
    expect(qual.proficiencyLevel).toBe(2);
    expect(qual.xp).toBe(XP_THRESHOLDS[2]);
    expect('licenceLevel' in qual).toBe(false);
  });

  it('a school that does not teach the licence still refuses', () => {
    const { state, school } = setupSchool('geology_lab', 3);
    const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), 2, 2);
    holdRigLicence(employee);
    expect(enrolInTraining(state, employee.id, school, 'driving.drill_rig').success).toBe(false);
  });

  it('two consecutive courses (tier 2 then tier 3) take licence 1 to 2 to 3, then refuse', () => {
    const { state, school } = setupSchool('driving_center', 3);
    const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), 2, 2);
    holdRigLicence(employee, 2);
    runCourse(state, employee, school, 'driving.drill_rig');
    expect(employee.qualifications.find(q => q.category === 'driving.drill_rig')!.licenceLevel).toBe(3);
    expect(enrolInTraining(state, employee.id, school, 'driving.drill_rig').success).toBe(false);
  });
});

describe('tickTraining — legacy training state (no grantsLevel)', () => {
  it('a legacy unlock completes as a level-1 qualification', () => {
    const { state, school } = setupSchool('geology_lab', 2);
    const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), 2, 2);
    startLegacyFinalTick(employee, school, 'geology');
    const { completed } = tickTraining(state);
    expect(completed[0]).toMatchObject({ skill: 'geology', level: 1, isNew: true });
    expect(employee.qualifications.find(q => q.category === 'geology')).toEqual({ category: 'geology', proficiencyLevel: 1, xp: 0 });
  });

  it('a legacy raisesLicenceTo course still raises the licence only', () => {
    const { state, school } = setupSchool('driving_center', 2);
    const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), 2, 2);
    const qual = holdRigLicence(employee);
    qual.proficiencyLevel = 3;
    qual.xp = XP_THRESHOLDS[3];
    employee.trainingState = { buildingId: school.id, skill: 'driving.drill_rig', ticksRemaining: 1, fee: 5000, raisesLicenceTo: 2 };
    const { completed } = tickTraining(state);
    expect(completed[0]).toMatchObject({ skill: 'driving.drill_rig', level: 2, isNew: false });
    expect(qual.licenceLevel).toBe(2);
    expect(qual.proficiencyLevel).toBe(3);
    expect(qual.xp).toBe(XP_THRESHOLDS[3]);
  });

  it('a legacy course on an already-held skill completes silently', () => {
    const { state, school } = setupSchool('blasting_academy', 2);
    const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), 2, 2);
    startLegacyFinalTick(employee, school, 'blasting');
    expect(tickTraining(state).completed).toEqual([]);
  });
});

describe('availableTrainingOffers — highest tier (#1726)', () => {
  it('offers the highest-tier school for a skill so the best level is reachable', () => {
    const offers = availableTrainingOffers([
      makeBuilding({ id: 1, type: 'blasting_academy', tier: 3 }),
      makeBuilding({ id: 2, type: 'blasting_academy', tier: 1 }),
      makeBuilding({ id: 3, type: 'blasting_academy', tier: 2 }),
    ]);
    expect(offers).toHaveLength(1);
    expect(offers[0]!.building.tier).toBe(3);
  });
});
