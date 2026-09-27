// BlastSimulator2026 — Employee training: schools, plans, walk-in enrolment,
// and school occupancy (#1203)
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
  MAX_PROFICIENCY,
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
import { XP_THRESHOLDS } from '../../../src/core/config/balance.js';

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
  it('the driving center teaches all three vehicle licences', () => {
    expect([...trainableSkills('driving_center')]).toEqual([
      'driving.truck', 'driving.excavator', 'driving.drill_rig',
    ]);
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
      'driving.truck', 'driving.excavator', 'driving.drill_rig',
      'blasting', 'management', 'geology',
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

  it('a skill the employee lacks starts from level 0 and targets Rookie', () => {
    const emp = state.employees.employees[0]!;
    const plan = planTraining(emp, 'driving.excavator', 1)!;
    expect(plan.currentLevel).toBe(0);
    expect(plan.targetLevel).toBe(1);
  });

  it('a skill the employee holds targets exactly one level up', () => {
    const emp = state.employees.employees[0]!;
    assignSkill(state.employees, emp.id, 'blasting', 3);
    expect(planTraining(emp, 'blasting', 1)!.targetLevel).toBe(4);
  });

  it('returns null at Master, so no fee is taken for nothing', () => {
    const emp = state.employees.employees[0]!;
    assignSkill(state.employees, emp.id, 'blasting', MAX_PROFICIENCY);
    expect(planTraining(emp, 'blasting', 1)).toBeNull();
  });

  it('higher levels cost more', () => {
    const emp = state.employees.employees[0]!;
    const first = planTraining(emp, 'geology', 1)!.fee;
    assignSkill(state.employees, emp.id, 'geology', 4);
    expect(planTraining(emp, 'geology', 1)!.fee).toBeGreaterThan(first);
  });

  it('a better school runs the same course faster', () => {
    const emp = state.employees.employees[0]!;
    const t1 = planTraining(emp, 'geology', 1)!.ticks;
    const t3 = planTraining(emp, 'geology', 3)!.ticks;
    expect(t3).toBeLessThan(t1);
  });

  it('a course always takes at least one tick', () => {
    const emp = state.employees.employees[0]!;
    expect(planTraining(emp, 'geology', 3)!.ticks).toBeGreaterThanOrEqual(1);
  });
});

// ── Enrolling — validation before any walk starts ─────────────────────────────

describe('enrolInTraining — validation', () => {
  let state: GameState;

  beforeEach(() => { ({ state } = makeStateWithOne()); });

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

  it('refuses when the employee is already a Master of the skill', () => {
    assignSkill(state.employees, 1, 'blasting', MAX_PROFICIENCY);
    const result = enrolInTraining(state, 1, makeBuilding({ type: 'blasting_academy' }), 'blasting');
    expectFailure(result);
    expect(result.error).toContain('highest proficiency');
  });
});

// ── Enrolling sends the employee walking to the school (#1203) ───────────────
//
// Supersedes the old instant-teleport model (#410, previously tested here):
// enrolment now queues a walk via moveTo; the countdown starts only once
// ArrivalGate confirms the employee has actually entered the building.

describe('enrolInTraining — walk-in and occupancy (#1203)', () => {
  it('on success, sets pendingTrainingState (not trainingState) and installs a walking itinerary — no instant relocation', () => {
    const { state, school } = setupSchool('blasting_academy');
    const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), 2, 2);

    const result = enrolInTraining(state, employee.id, school, 'blasting');
    expectSuccess(result);

    expect(employee.trainingState).toBeNull();
    expect(employee.pendingTrainingState).not.toBeNull();
    expect(employee.pendingTrainingState!.buildingId).toBe(school.id);
    expect(employee.pendingTrainingState!.skill).toBe('blasting');
    expect(employee.pendingTrainingState!.ticksRemaining).toBe(result.plan.ticks);
    expect(employee.pendingTrainingState!.fee).toBe(result.fee);
    // Not teleported next to the building — an itinerary is in flight, and
    // the employee's own position has not jumped.
    expect(employee.itinerary).not.toBeNull();
    expect({ x: employee.x, z: employee.z }).toEqual({ x: 2, z: 2 });
  });

  it('does not decrement the countdown while still walking (tickTraining only iterates trainingState !== null employees)', () => {
    const { state, school } = setupSchool('blasting_academy');
    const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), 2, 2);

    const result = enrolInTraining(state, employee.id, school, 'blasting');
    expectSuccess(result);
    const queuedTicks = employee.pendingTrainingState!.ticksRemaining;

    for (let i = 0; i < 3; i++) tickTraining(state);

    expect(employee.pendingTrainingState!.ticksRemaining).toBe(queuedTicks);
    expect(employee.trainingState).toBeNull();
  });

  it('on arrival, enters the school: pendingTrainingState is promoted into trainingState, locomotion is "inside" (mesh hidden)', () => {
    const { state, school } = setupSchool('blasting_academy');
    const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), 2, 2);

    const result = enrolInTraining(state, employee.id, school, 'blasting');
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
    expect(employee.trainingState!.skill).toBe('blasting');
    expect(employee.trainingState!.ticksRemaining).toBe(queuedTicks);
  });

  it('completes the course once ticksRemaining hits 0: reported in completed[], leaves the building back onto its ring, on foot', () => {
    const { state, school } = setupSchool('blasting_academy');
    const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), 2, 2);

    const result = enrolInTraining(state, employee.id, school, 'blasting');
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

    const result = enrolInTraining(state, employee.id, school, 'driving.excavator');

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
      const result = enrolInTraining(state, employee.id, school, 'driving.excavator');
      expectSuccess(result);
    }
    // Nobody has actually walked in yet — the block above is purely
    // reservation via pendingTrainingState.
    expect(school.occupantIds).toEqual([]);

    const { employee: late } = hireEmployee(state.employees, 'driver', new Random(SEED), 2, 2 + capacity);
    const result = enrolInTraining(state, late.id, school, 'driving.excavator');

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

    const result = enrolInTraining(state, employee.id, school, 'driving.excavator');

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
    const { state, school } = setupSchool('blasting_academy');
    const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), 2, 2);

    const result = enrolInTraining(state, employee.id, school, 'blasting');
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
  it.each(['driving.excavator', 'driving.drill_rig'] as SkillCategory[])(
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

  it('a surveyor can be raised from Rookie to Master one course at a time', () => {
    const { state, school } = setupSchool('geology_lab', 3);
    const { employee } = hireEmployee(state.employees, 'surveyor', new Random(SEED), 2, 2);
    expect(employee.qualifications.find(q => q.category === 'geology')!.proficiencyLevel).toBe(1);

    for (let level = 2; level <= MAX_PROFICIENCY; level++) {
      const result = enrolInTraining(state, employee.id, school, 'geology');
      expectSuccess(result);
      resolveArrival(state, employee);
      for (let i = 0; i < result.plan.ticks; i++) tickTraining(state);
      expect(employee.qualifications.find(q => q.category === 'geology')!.proficiencyLevel).toBe(level);
    }

    expect(planTraining(employee, 'geology', 3)).toBeNull();
  });
});

// ── Completion floors xp at the new level's threshold (#620) ────────────────
//
// gainXp derives proficiencyLevel from cumulative qual.xp against
// XP_THRESHOLDS. tickTraining's existing-qualification branch used to raise
// proficiencyLevel directly without touching xp, so a trained employee held
// xp: 0 at their new level while a naturally-progressed peer at the same
// level already carried partial progress — training silently cost ~half a
// level's worth of progress toward the next one.

describe('tickTraining floors qual.xp at the new level threshold', () => {
  it('training from level 2 to level 3 raises xp to at least the level-3 threshold', () => {
    const { state, school } = setupSchool('blasting_academy');
    const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), 2, 2); // holds blasting at level 1
    assignSkill(state.employees, employee.id, 'blasting', 2);

    const result = enrolInTraining(state, employee.id, school, 'blasting');
    expectSuccess(result);
    resolveArrival(state, employee);
    for (let i = 0; i < result.plan.ticks; i++) tickTraining(state);

    const qual = employee.qualifications.find(q => q.category === 'blasting')!;
    expect(qual.proficiencyLevel).toBe(3);
    expect(qual.xp).toBeGreaterThanOrEqual(XP_THRESHOLDS[3]);
  });

  it('never lowers xp that already exceeds the new level threshold before completion', () => {
    const { state, school } = setupSchool('blasting_academy');
    const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), 2, 2);
    assignSkill(state.employees, employee.id, 'blasting', 2);

    const result = enrolInTraining(state, employee.id, school, 'blasting');
    expectSuccess(result);
    resolveArrival(state, employee);

    // The employee already carries more xp than the level-3 threshold (300)
    // by the time the course completes — training must not claw it back down.
    const qual = employee.qualifications.find(q => q.category === 'blasting')!;
    qual.xp = 500;

    for (let i = 0; i < result.plan.ticks; i++) tickTraining(state);

    expect(qual.proficiencyLevel).toBe(3);
    expect(qual.xp).toBe(500);
  });

  it('a brand-new qualification from training still starts at level 1 with 0 xp', () => {
    const { state, school } = setupSchool('driving_center');
    const { employee } = hireEmployee(state.employees, 'driver', new Random(SEED), 2, 2); // holds driving.truck only
    expect(employee.qualifications.some(q => q.category === 'driving.excavator')).toBe(false);

    const result = enrolInTraining(state, employee.id, school, 'driving.excavator');
    expectSuccess(result);
    resolveArrival(state, employee);
    for (let i = 0; i < result.plan.ticks; i++) tickTraining(state);

    const qual = employee.qualifications.find(q => q.category === 'driving.excavator')!;
    expect(qual.proficiencyLevel).toBe(1);
    expect(qual.xp).toBe(XP_THRESHOLDS[1]);
  });

  it('training from level 4 to level 5 (MAX_PROFICIENCY) floors xp at the level-5 threshold', () => {
    const { state, school } = setupSchool('blasting_academy');
    const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), 2, 2);
    assignSkill(state.employees, employee.id, 'blasting', 4);

    const result = enrolInTraining(state, employee.id, school, 'blasting');
    expectSuccess(result);
    resolveArrival(state, employee);
    for (let i = 0; i < result.plan.ticks; i++) tickTraining(state);

    const qual = employee.qualifications.find(q => q.category === 'blasting')!;
    expect(qual.proficiencyLevel).toBe(MAX_PROFICIENCY);
    expect(qual.xp).toBeGreaterThanOrEqual(XP_THRESHOLDS[5]);
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

  it('a driving_center offers all three licences from one building', () => {
    const offers = availableTrainingOffers([makeBuilding({ type: 'driving_center' })]);
    expect(offers.map(o => o.skill).sort()).toEqual(['driving.drill_rig', 'driving.excavator', 'driving.truck']);
  });
});
