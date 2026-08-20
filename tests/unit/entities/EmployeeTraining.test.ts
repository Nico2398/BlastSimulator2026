// BlastSimulator2026 — Employee training: schools, plans, and enrolment
//
// Training is the only in-game route to a qualification no role is hired with,
// so these tests pin the two skills that depend on it entirely
// (driving.excavator, driving.drill_rig) and the cost of raising proficiency.

import { describe, it, expect, beforeEach } from 'vitest';
import { Random } from '../../../src/core/math/Random.js';
import {
  createEmployeeState,
  hireEmployee,
  assignSkill,
  type EmployeeState,
} from '../../../src/core/entities/Employee.js';
import type { SkillCategory } from '../../../src/core/entities/Employee.js';
import {
  trainableSkills,
  isTrainingBuilding,
  schoolFor,
  planTraining,
  enrolInTraining,
  tickTraining,
  availableTrainingOffers,
  MAX_PROFICIENCY,
} from '../../../src/core/entities/EmployeeTraining.js';
import type { Building, BuildingType, BuildingTier } from '../../../src/core/entities/Building.js';
import { XP_THRESHOLDS } from '../../../src/core/config/balance.js';

const SEED = 42;

function makeStateWithOne(role: 'driller' | 'surveyor' | 'driver' = 'driller') {
  const state = createEmployeeState();
  const { employee } = hireEmployee(state, role, new Random(SEED));
  return { state, employee };
}

function school(type: BuildingType, tier: BuildingTier = 1, id = 1) {
  return { id, type, tier };
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
  let state: EmployeeState;

  beforeEach(() => { ({ state } = makeStateWithOne()); });

  it('a skill the employee lacks starts from level 0 and targets Rookie', () => {
    const emp = state.employees[0]!;
    const plan = planTraining(emp, 'driving.excavator', 1)!;
    expect(plan.currentLevel).toBe(0);
    expect(plan.targetLevel).toBe(1);
  });

  it('a skill the employee holds targets exactly one level up', () => {
    const emp = state.employees[0]!;
    assignSkill(state, emp.id, 'blasting', 3);
    expect(planTraining(emp, 'blasting', 1)!.targetLevel).toBe(4);
  });

  it('returns null at Master, so no fee is taken for nothing', () => {
    const emp = state.employees[0]!;
    assignSkill(state, emp.id, 'blasting', MAX_PROFICIENCY);
    expect(planTraining(emp, 'blasting', 1)).toBeNull();
  });

  it('higher levels cost more', () => {
    const emp = state.employees[0]!;
    const first = planTraining(emp, 'geology', 1)!.fee;
    assignSkill(state, emp.id, 'geology', 4);
    expect(planTraining(emp, 'geology', 1)!.fee).toBeGreaterThan(first);
  });

  it('a better school runs the same course faster', () => {
    const emp = state.employees[0]!;
    const t1 = planTraining(emp, 'geology', 1)!.ticks;
    const t3 = planTraining(emp, 'geology', 3)!.ticks;
    expect(t3).toBeLessThan(t1);
  });

  it('a course always takes at least one tick', () => {
    const emp = state.employees[0]!;
    expect(planTraining(emp, 'geology', 3)!.ticks).toBeGreaterThanOrEqual(1);
  });
});

// ── Enrolling ────────────────────────────────────────────────────────────────

describe('enrolInTraining', () => {
  let state: EmployeeState;

  beforeEach(() => { ({ state } = makeStateWithOne()); });

  it('enrols at a school that teaches the skill', () => {
    const result = enrolInTraining(state, 1, school('geology_lab'), 'geology');
    expect(result.success).toBe(true);
    expect(result.fee).toBeGreaterThan(0);
    expect(state.employees[0]!.trainingState?.skill).toBe('geology');
  });

  it('refuses a school that does not teach the skill', () => {
    const result = enrolInTraining(state, 1, school('geology_lab'), 'driving.excavator');
    expect(result.success).toBe(false);
    expect(result.error).toContain('does not teach');
    expect(state.employees[0]!.trainingState).toBeNull();
  });

  it('refuses a building that is not a school at all', () => {
    expect(enrolInTraining(state, 1, school('freight_warehouse'), 'geology').success).toBe(false);
  });

  it('refuses an employee already in training', () => {
    enrolInTraining(state, 1, school('geology_lab'), 'geology');
    const second = enrolInTraining(state, 1, school('blasting_academy'), 'blasting');
    expect(second.success).toBe(false);
    expect(state.employees[0]!.trainingState!.skill).toBe('geology');
  });

  it('refuses an injured employee', () => {
    state.employees[0]!.injured = true;
    const result = enrolInTraining(state, 1, school('geology_lab'), 'geology');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Injured');
  });

  it('refuses an unknown employee', () => {
    expect(enrolInTraining(state, 999, school('geology_lab'), 'geology').success).toBe(false);
  });

  it('refuses when the employee is already a Master of the skill', () => {
    assignSkill(state, 1, 'blasting', MAX_PROFICIENCY);
    const result = enrolInTraining(state, 1, school('blasting_academy'), 'blasting');
    expect(result.success).toBe(false);
    expect(result.error).toContain('highest proficiency');
  });
});

// ── The skills that exist only through training ──────────────────────────────

describe('licences no role is hired with', () => {
  it.each(['driving.excavator', 'driving.drill_rig'] as SkillCategory[])(
    'a driver can obtain %s by finishing a driving-center course',
    (skill) => {
      const { state, employee } = makeStateWithOne('driver');
      expect(employee.qualifications.some(q => q.category === skill)).toBe(false);

      const result = enrolInTraining(state, employee.id, school('driving_center'), skill);
      expect(result.success).toBe(true);

      for (let i = 0; i < result.plan!.ticks; i++) tickTraining(state);

      expect(employee.qualifications.some(q => q.category === skill)).toBe(true);
      expect(employee.trainingState).toBeNull();
    },
  );

  it('a surveyor can be raised from Rookie to Master one course at a time', () => {
    const { state, employee } = makeStateWithOne('surveyor');
    expect(employee.qualifications.find(q => q.category === 'geology')!.proficiencyLevel).toBe(1);

    for (let level = 2; level <= MAX_PROFICIENCY; level++) {
      const result = enrolInTraining(state, employee.id, school('geology_lab', 3), 'geology');
      expect(result.success, `enrolling for level ${level}`).toBe(true);
      for (let i = 0; i < result.plan!.ticks; i++) tickTraining(state);
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
    const { state, employee } = makeStateWithOne('driller'); // holds blasting at level 1
    assignSkill(state, employee.id, 'blasting', 2);

    const result = enrolInTraining(state, employee.id, school('blasting_academy'), 'blasting');
    expect(result.success, result.error).toBe(true);
    for (let i = 0; i < result.plan!.ticks; i++) tickTraining(state);

    const qual = employee.qualifications.find(q => q.category === 'blasting')!;
    expect(qual.proficiencyLevel).toBe(3);
    expect(qual.xp).toBeGreaterThanOrEqual(XP_THRESHOLDS[3]);
  });

  it('never lowers xp that already exceeds the new level threshold before completion', () => {
    const { state, employee } = makeStateWithOne('driller');
    assignSkill(state, employee.id, 'blasting', 2);

    const result = enrolInTraining(state, employee.id, school('blasting_academy'), 'blasting');
    expect(result.success, result.error).toBe(true);

    // The employee already carries more xp than the level-3 threshold (300)
    // by the time the course completes — training must not claw it back down.
    const qual = employee.qualifications.find(q => q.category === 'blasting')!;
    qual.xp = 500;

    for (let i = 0; i < result.plan!.ticks; i++) tickTraining(state);

    expect(qual.proficiencyLevel).toBe(3);
    expect(qual.xp).toBe(500);
  });

  it('a brand-new qualification from training still starts at level 1 with 0 xp', () => {
    const { state, employee } = makeStateWithOne('driver'); // holds driving.truck only
    expect(employee.qualifications.some(q => q.category === 'driving.excavator')).toBe(false);

    const result = enrolInTraining(state, employee.id, school('driving_center'), 'driving.excavator');
    expect(result.success, result.error).toBe(true);
    for (let i = 0; i < result.plan!.ticks; i++) tickTraining(state);

    const qual = employee.qualifications.find(q => q.category === 'driving.excavator')!;
    expect(qual.proficiencyLevel).toBe(1);
    expect(qual.xp).toBe(XP_THRESHOLDS[1]);
  });

  it('training from level 4 to level 5 (MAX_PROFICIENCY) floors xp at the level-5 threshold', () => {
    const { state, employee } = makeStateWithOne('driller');
    assignSkill(state, employee.id, 'blasting', 4);

    const result = enrolInTraining(state, employee.id, school('blasting_academy'), 'blasting');
    expect(result.success, result.error).toBe(true);
    for (let i = 0; i < result.plan!.ticks; i++) tickTraining(state);

    const qual = employee.qualifications.find(q => q.category === 'blasting')!;
    expect(qual.proficiencyLevel).toBe(MAX_PROFICIENCY);
    expect(qual.xp).toBeGreaterThanOrEqual(XP_THRESHOLDS[5]);
  });
});

// ── Enrolling moves the employee to the school (#410) ────────────────────────
//
// Currently untouched: enrolInTraining never reads/writes employee.x/z, so a
// trained employee stays wherever they were hired instead of walking to the
// building teaching the course.
//
// The employee lands one tile outside the footprint (building.x - 1), not on
// the raw origin corner — that corner sits on the building's own opaque
// base-box footprint and renders fully occluded from every external camera
// angle (#410 iteration 2). At the x === 0 grid edge the offset flips to
// building.x + 1 so the employee never lands off-grid (#410 iteration 3).

describe('enrolInTraining — the employee relocates to the training building', () => {
  it('sets the employee position adjacent to the training building, not the pre-enrolment position', () => {
    const { state, employee } = makeStateWithOne('driller');
    employee.x = 3;
    employee.z = 3;

    const building = { id: 7, type: 'blasting_academy' as BuildingType, tier: 1 as BuildingTier, x: 40, z: 12 };
    const result = enrolInTraining(state, employee.id, building, 'blasting');
    expect(result.success, result.error).toBe(true);

    expect(employee.x).toBe(building.x - 1);
    expect(employee.z).toBe(building.z);
  });

  it('relocates the employee even when the school sits at the origin, without going off-grid', () => {
    const { state, employee } = makeStateWithOne('driver');
    employee.x = 25;
    employee.z = 25;

    const building = { id: 9, type: 'driving_center' as BuildingType, tier: 1 as BuildingTier, x: 0, z: 0 };
    const result = enrolInTraining(state, employee.id, building, 'driving.excavator');
    expect(result.success, result.error).toBe(true);

    // building.x - 1 would be -1 (off-grid), so the offset flips to +1.
    expect(employee.x).toBe(1);
    expect(employee.z).toBe(0);
  });

  it('does not move the employee when enrolment fails', () => {
    const { state, employee } = makeStateWithOne('driller');
    employee.x = 3;
    employee.z = 3;

    // freight_warehouse teaches nothing — enrolment must fail
    const building = { id: 5, type: 'freight_warehouse' as BuildingType, tier: 1 as BuildingTier, x: 40, z: 12 };
    const result = enrolInTraining(state, employee.id, building, 'blasting');
    expect(result.success).toBe(false);

    expect(employee.x).toBe(3);
    expect(employee.z).toBe(3);
  });
});

// ── availableTrainingOffers ──────────────────────────────────────────────────

function makeBuilding(overrides: Partial<Building> = {}): Building {
  return { id: 1, type: 'geology_lab', tier: 1, x: 0, z: 0, hp: 100, active: true, ...overrides };
}

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
