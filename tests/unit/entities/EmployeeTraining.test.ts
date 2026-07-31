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
  MAX_PROFICIENCY,
} from '../../../src/core/entities/EmployeeTraining.js';
import type { BuildingType, BuildingTier } from '../../../src/core/entities/Building.js';

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

// ── Enrolling moves the employee to the school (#410) ────────────────────────
//
// Currently untouched: enrolInTraining never reads/writes employee.x/z, so a
// trained employee stays wherever they were hired instead of walking to the
// building teaching the course.

describe('enrolInTraining — the employee relocates to the training building', () => {
  it('sets the employee position to the training building position, not the pre-enrolment position', () => {
    const { state, employee } = makeStateWithOne('driller');
    employee.x = 3;
    employee.z = 3;

    const building = { id: 7, type: 'blasting_academy' as BuildingType, tier: 1 as BuildingTier, x: 40, z: 12 };
    const result = enrolInTraining(state, employee.id, building, 'blasting');
    expect(result.success, result.error).toBe(true);

    expect(employee.x).toBe(building.x);
    expect(employee.z).toBe(building.z);
  });

  it('relocates the employee even when the school sits at the origin', () => {
    const { state, employee } = makeStateWithOne('driver');
    employee.x = 25;
    employee.z = 25;

    const building = { id: 9, type: 'driving_center' as BuildingType, tier: 1 as BuildingTier, x: 0, z: 0 };
    const result = enrolInTraining(state, employee.id, building, 'driving.excavator');
    expect(result.success, result.error).toBe(true);

    expect(employee.x).toBe(0);
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
