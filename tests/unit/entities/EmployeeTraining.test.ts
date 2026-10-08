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
  BASE_SALARIES,
  isOccupyingHost,
} from '../../../src/core/entities/Employee.js';
import type { Employee, SkillCategory } from '../../../src/core/entities/Employee.js';
import {
  trainableSkills,
  isTrainingBuilding,
  schoolFor,
  planTraining,
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
} from '../../../src/core/config/balance.js';
import * as balance from '../../../src/core/config/balance.js';
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

  it('a skill the employee lacks yields a plan with fee, ticks and salary increase', () => {
    const emp = state.employees.employees[0]!;
    const plan = planTraining(emp, 'driving.excavator', 1)!;
    expect(plan.skill).toBe('driving.excavator');
    expect(plan.fee).toBe(TRAINING_BASE_FEE);
    expect(plan.ticks).toBe(Math.max(1, Math.round(TRAINING_BASE_TICKS * TRAINING_TIER_SPEED[1])));
    expect(plan.salaryIncrease).toBe(QUALIFICATION_SALARY_BONUS[1]);
  });

  it('the plan carries no level fields: courses only grant qualifications', () => {
    const emp = state.employees.employees[0]!;
    const plan = planTraining(emp, 'geology', 1)! as unknown as Record<string, unknown>;
    expect('currentLevel' in plan).toBe(false);
    expect('targetLevel' in plan).toBe(false);
  });

  it('returns null for a skill already held at Rookie', () => {
    const emp = state.employees.employees[0]!; // driller holds blasting at 1
    expect(planTraining(emp, 'blasting', 1)).toBeNull();
  });

  it.each([2, 3, 4, 5] as const)('returns null for a skill already held at level %i', (level) => {
    const emp = state.employees.employees[0]!;
    assignSkill(state.employees, emp.id, 'blasting', level);
    expect(planTraining(emp, 'blasting', 1)).toBeNull();
  });

  it('the fee is flat: every tier of school charges TRAINING_BASE_FEE', () => {
    const emp = state.employees.employees[0]!;
    for (const tier of [1, 2, 3] as const) {
      expect(planTraining(emp, 'geology', tier)!.fee).toBe(TRAINING_BASE_FEE);
    }
  });

  it('the fee does not depend on the proficiency the employee holds in other skills', () => {
    const emp = state.employees.employees[0]!;
    const before = planTraining(emp, 'geology', 1)!.fee;
    assignSkill(state.employees, emp.id, 'blasting', 4);
    expect(planTraining(emp, 'geology', 1)!.fee).toBe(before);
  });

  it('the salary increase is the Rookie qualification bonus whatever the school tier', () => {
    const emp = state.employees.employees[0]!;
    for (const tier of [1, 2, 3] as const) {
      expect(planTraining(emp, 'geology', tier)!.salaryIncrease).toBe(QUALIFICATION_SALARY_BONUS[1]);
    }
  });

  it('a better school runs the same course faster', () => {
    const emp = state.employees.employees[0]!;
    const t1 = planTraining(emp, 'geology', 1)!.ticks;
    const t3 = planTraining(emp, 'geology', 3)!.ticks;
    expect(t3).toBeLessThan(t1);
  });

  it.each([1, 2, 3] as const)('ticks at tier %i follow base ticks times tier speed, no level multiplier', (tier) => {
    const emp = state.employees.employees[0]!;
    expect(planTraining(emp, 'geology', tier)!.ticks)
      .toBe(Math.max(1, Math.round(TRAINING_BASE_TICKS * TRAINING_TIER_SPEED[tier])));
  });

  it('a course always takes at least one tick', () => {
    const emp = state.employees.employees[0]!;
    expect(planTraining(emp, 'geology', 3)!.ticks).toBeGreaterThanOrEqual(1);
  });

  it('TRAINING_LEVEL_COST_MULTIPLIER no longer exists in balance.ts', () => {
    expect('TRAINING_LEVEL_COST_MULTIPLIER' in balance).toBe(false);
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

  it.each([1, 3, 5] as const)('refuses a skill already held at level %i, with a translated error', (level) => {
    assignSkill(state.employees, 1, 'blasting', level);
    const building = makeBuilding({ type: 'blasting_academy' });
    const result = enrolInTraining(state, 1, building, 'blasting');
    expectFailure(result);
    expect(result.error.length).toBeGreaterThan(0);
    const key = (result as { errorKey?: string }).errorKey;
    expect(key, 'refusal must carry an errorKey').toBeDefined();
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

  it('a surveyor cannot buy a second course in the geology licence they hold', () => {
    const { state, school } = setupSchool('geology_lab', 3);
    const { employee } = hireEmployee(state.employees, 'surveyor', new Random(SEED), 2, 2);
    expect(employee.qualifications.find(q => q.category === 'geology')!.proficiencyLevel).toBe(1);
    expect(enrolInTraining(state, employee.id, school, 'geology').success).toBe(false);
    expect(planTraining(employee, 'geology', 3)).toBeNull();
  });
});

// ── Completion grants qualifications only (#1388) ───────────────────────────
//
// There is no promotion path: a course on a skill the employee lacks adds it at
// Rookie with 0 xp, and completion never touches an existing qualification.

/** Puts `employee` mid-course (inside `school`) on `skill`, one tick from done. */
function startFinalTick(employee: Employee, school: Building, skill: SkillCategory): void {
  employee.trainingState = { buildingId: school.id, skill, ticksRemaining: 1, fee: TRAINING_BASE_FEE };
}

describe('tickTraining grants qualifications only', () => {
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

// ── Licence level courses (#1524) ───────────────────────────────────────────
//
// A held driving.* licence below level 3 can be raised one level at a time at a
// Driving Center. The course changes licenceLevel only: proficiency and xp are
// productivity, owned by work.

function holdRigLicence(employee: Employee, licenceLevel?: 1 | 2 | 3) {
  employee.qualifications = employee.qualifications.filter(q => q.category !== 'driving.drill_rig');
  employee.qualifications.push({ category: 'driving.drill_rig', proficiencyLevel: 1, xp: 0 });
  const qual = employee.qualifications.find(q => q.category === 'driving.drill_rig')!;
  if (licenceLevel !== undefined) qual.licenceLevel = licenceLevel;
  return qual;
}

describe('planTraining — licence level raise (#1524)', () => {
  it('plans a raise to level 2 for a held level-1 licence (missing licenceLevel counts as 1)', () => {
    const { employee } = makeStateWithOne('driller');
    holdRigLicence(employee);
    const plan = planTraining(employee, 'driving.drill_rig', 1);
    expect(plan).not.toBeNull();
    expect(plan!.raisesLicenceTo).toBe(2);
    expect(plan!.fee).toBe(balance.LICENCE_COURSE_FEE[2]);
    expect(plan!.skill).toBe('driving.drill_rig');
  });

  it('plans a raise to level 3 for a held level-2 licence', () => {
    const { employee } = makeStateWithOne('driller');
    holdRigLicence(employee, 2);
    const plan = planTraining(employee, 'driving.drill_rig', 1);
    expect(plan!.raisesLicenceTo).toBe(3);
    expect(plan!.fee).toBe(balance.LICENCE_COURSE_FEE[3]);
  });

  it('scales course duration by LICENCE_COURSE_TICKS_MULT', () => {
    const { employee } = makeStateWithOne('driller');
    holdRigLicence(employee);
    const plan = planTraining(employee, 'driving.drill_rig', 1)!;
    expect(plan.ticks).toBe(Math.max(1, Math.round(TRAINING_BASE_TICKS * TRAINING_TIER_SPEED[1] * balance.LICENCE_COURSE_TICKS_MULT[2])));
  });

  it('refuses at level 3 (boundary)', () => {
    const { employee } = makeStateWithOne('driller');
    holdRigLicence(employee, 3);
    expect(planTraining(employee, 'driving.drill_rig', 1)).toBeNull();
  });

  it('refuses a held non-driving skill', () => {
    const { employee } = makeStateWithOne('surveyor');
    expect(planTraining(employee, 'geology', 1)).toBeNull();
  });

  it('a first-time licence course carries no raisesLicenceTo', () => {
    const { employee } = makeStateWithOne('surveyor');
    const plan = planTraining(employee, 'driving.drill_rig', 1)!;
    expect(plan.raisesLicenceTo).toBeUndefined();
  });

  it('proficiency level never changes the planned raise', () => {
    const { employee } = makeStateWithOne('driller');
    const qual = holdRigLicence(employee);
    qual.proficiencyLevel = 5;
    expect(planTraining(employee, 'driving.drill_rig', 1)!.raisesLicenceTo).toBe(2);
  });
});

describe('tickTraining — licence level course (#1524)', () => {
  it('enrols, completes, and raises licenceLevel only', () => {
    const { state, school } = setupSchool('driving_center');
    const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), 2, 2);
    const qual = holdRigLicence(employee);
    qual.proficiencyLevel = 3;
    qual.xp = XP_THRESHOLDS[3] + 5;

    const result = enrolInTraining(state, employee.id, school, 'driving.drill_rig');
    expectSuccess(result);
    expect(result.plan.raisesLicenceTo).toBe(2);
    resolveArrival(state, employee);
    for (let i = 0; i < result.plan.ticks; i++) tickTraining(state);

    const after = employee.qualifications.filter(q => q.category === 'driving.drill_rig');
    expect(after).toHaveLength(1);
    expect(after[0]!.licenceLevel).toBe(2);
    expect(after[0]!.proficiencyLevel).toBe(3);
    expect(after[0]!.xp).toBe(XP_THRESHOLDS[3] + 5);
    expect(employee.trainingState).toBeNull();
  });

  it('a second course takes level 2 to level 3, and a third is refused', () => {
    const { state, school } = setupSchool('driving_center');
    const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), 2, 2);
    holdRigLicence(employee, 2);

    const result = enrolInTraining(state, employee.id, school, 'driving.drill_rig');
    expectSuccess(result);
    resolveArrival(state, employee);
    for (let i = 0; i < result.plan.ticks; i++) tickTraining(state);

    expect(employee.qualifications.find(q => q.category === 'driving.drill_rig')!.licenceLevel).toBe(3);
    expect(enrolInTraining(state, employee.id, school, 'driving.drill_rig').success).toBe(false);
  });

  it('completion salary and held-skill list are otherwise untouched by a licence raise', () => {
    const { state, school } = setupSchool('driving_center');
    const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), 2, 2);
    holdRigLicence(employee);
    const skillsBefore = employee.qualifications.map(q => q.category).sort();

    const result = enrolInTraining(state, employee.id, school, 'driving.drill_rig');
    expectSuccess(result);
    resolveArrival(state, employee);
    for (let i = 0; i < result.plan.ticks; i++) tickTraining(state);

    expect(employee.qualifications.map(q => q.category).sort()).toEqual(skillsBefore);
  });

  it('a school that does not teach the licence still refuses the raise', () => {
    const { state, school } = setupSchool('geology_lab');
    const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), 2, 2);
    holdRigLicence(employee);
    expect(enrolInTraining(state, employee.id, school, 'driving.drill_rig').success).toBe(false);
  });
});
