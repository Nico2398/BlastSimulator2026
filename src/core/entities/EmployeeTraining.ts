// BlastSimulator2026 — Employee training
//
// A course at a tier-N school brings a skill to level N (never above the tier):
// it unlocks a missing skill or upgrades a held one. Higher levels come from
// working (XP), not from schools. Roles arrive holding their own licences
// (ROLE_STARTING_QUALIFICATIONS); `driving.rock_fragmenter` belongs to no hiring
// role, so without a reachable course nobody could hold it.

import type { Employee, EmployeeState, SkillCategory, TrainingState, LicenceLevel } from './Employee.js';
import { licenceLevelOfSkill } from './VehicleDriverAssignment.js';
import { calculateSalary, qualificationAtLevel, isLicenceSkill } from './Employee.js';
import type { Building, BuildingType, BuildingTier } from './Building.js';
import { t } from '../i18n/I18n.js';
import { getBuildingPeopleCapacity, isOperating } from './Building.js';
import type { GameState } from '../state/GameState.js';
import type { EventEmitter } from '../state/EventEmitter.js';
import { alightIfMounted, leaveBuilding } from '../engine/Mount.js';
import { moveTo } from '../engine/MoveTo.js';
import type { RefusalKey } from '../i18n/Refusal.js';
import {
  TRAINING_BUILDING_SKILLS,
  TRAINING_BASE_TICKS,
  TRAINING_TIER_SPEED,
  TRAINING_LEVEL_FEE,
  TRAINING_LEVEL_TICKS_MULT,
  QUALIFICATION_SALARY_BONUS,
  XP_THRESHOLDS,
} from '../config/balance.js';

export type ProficiencyLevel = 1 | 2 | 3 | 4 | 5;

/** Skills taught at a building type, empty when it is not a school. */
export function trainableSkills(type: BuildingType): readonly SkillCategory[] {
  const skills = (TRAINING_BUILDING_SKILLS as Record<string, readonly string[]>)[type];
  return (skills ?? []) as readonly SkillCategory[];
}

/** Whether this building type teaches anything. */
export function isTrainingBuilding(type: BuildingType): boolean {
  return trainableSkills(type).length > 0;
}

/** The building type that teaches a skill, or null when nothing does. */
export function schoolFor(skill: SkillCategory): BuildingType | null {
  for (const type of Object.keys(TRAINING_BUILDING_SKILLS) as BuildingType[]) {
    if (trainableSkills(type).includes(skill)) return type;
  }
  return null;
}

/**
 * Whether `employee` is currently enrolled in a course — either walking to
 * the school (`pendingTrainingState`) or already inside it, mid-course
 * (`trainingState`). An absent `pendingTrainingState` (old saves, hand-built
 * fixtures) reads the same as null — never fabricated into "enrolled".
 */
export function isEnrolledInTraining(employee: Employee): boolean {
  return employee.trainingState !== null || (employee.pendingTrainingState ?? null) !== null;
}

/**
 * Whether `building` has no free seat left to enrol another trainee —
 * counting both who is already inside (`occupantIds`) and everyone already
 * walking there (`pendingTrainingState`), so two enrolments claimed on the
 * same tick can never together overshoot capacity even though neither has
 * arrived yet.
 */
export function isSchoolFull(
  state: GameState,
  building: { id: number; type: BuildingType; tier: BuildingTier; occupantIds: readonly number[] },
): boolean {
  const capacity = getBuildingPeopleCapacity(building.type, building.tier);
  const walkingIn = state.employees.employees.filter(
    e => (e.pendingTrainingState ?? null)?.buildingId === building.id,
  ).length;
  return building.occupantIds.length + walkingIn >= capacity;
}

/** One skill a school on site teaches, paired with the building that teaches it. */
export interface SkillOffer {
  skill: SkillCategory;
  building: Building;
}

/**
 * Every skill some built school currently teaches, each paired with its best
 * school on site — a better school teaches the same course faster, so a
 * lower-tier duplicate of one already built is never worth offering.
 */
export function availableTrainingOffers(buildings: readonly Building[]): SkillOffer[] {
  const best = new Map<SkillCategory, Building>();
  for (const building of buildings) {
    if (!isOperating(building)) continue;
    for (const skill of trainableSkills(building.type)) {
      const current = best.get(skill);
      if (!current || building.tier > current.tier) best.set(skill, building);
    }
  }
  return [...best.entries()].map(([skill, building]) => ({ skill, building }));
}

/** What a course would cost and grant. */
export interface TrainingPlan {
  skill: SkillCategory;
  /** Level the course brings the skill to: the school's tier. */
  grantsLevel: 1 | 2 | 3;
  /** Whether the course unlocks a missing skill or upgrades a held one. */
  kind: 'unlock' | 'upgrade';
  ticks: number;
  fee: number;
  /** Salary raise (per pay cycle) the course causes on grant. */
  salaryIncrease: number;
}

/**
 * Level at which `qualifications` hold `skill`: the licence level for driving
 * skills (default 1), else the proficiency level; 0 when not held.
 */
export function heldCourseLevel(
  qualifications: readonly Employee['qualifications'][number][],
  skill: SkillCategory,
): 0 | ProficiencyLevel {
  const held = qualifications.find(q => q.category === skill);
  if (!held) return 0;
  return isLicenceSkill(skill) ? (licenceLevelOfSkill(qualifications, skill) as ProficiencyLevel) : held.proficiencyLevel;
}

/** Refusal of a course the school's tier cannot give (held level >= tier, or tier 3 reached). */
export function trainingRefusal(
  employee: Employee,
  skill: SkillCategory,
  tier: BuildingTier,
): { error: string; kind: 'top_level' | 'needs_higher_school' } & RefusalKey {
  const held = heldCourseLevel(employee.qualifications, skill);
  if (held >= 3 || tier >= 3) {
    return {
      kind: 'top_level',
      error: `${employee.name} already holds ${skill} at the highest level a school teaches`,
      errorKey: 'employees.train_top_level',
      errorParams: { name: employee.name, skill },
    };
  }
  const schoolType = schoolFor(skill);
  const school = schoolType ? t(`building.${schoolType}.name`) : '';
  return {
    kind: 'needs_higher_school',
    error: `${employee.name} already holds ${skill} at level ${held}; a higher-tier ${schoolType ?? ''} is needed`,
    errorKey: 'employees.train_needs_higher_school',
    errorParams: { name: employee.name, skill, level: held, school },
  };
}

/**
 * Cost and duration of a course in a skill: a tier-N school brings it to level N.
 *
 * @returns The plan, or null when the employee already holds the skill at the
 *   school's tier or above — see `trainingRefusal` for the reason.
 */
export function planTraining(
  employee: Employee,
  skill: SkillCategory,
  tier: BuildingTier,
): TrainingPlan | null {
  const held = heldCourseLevel(employee.qualifications, skill);
  if (held >= tier) return null;
  const unlock = held === 0;
  const bonusAt = (level: 0 | ProficiencyLevel): number => (level === 0 ? 0 : QUALIFICATION_SALARY_BONUS[level]);
  return {
    skill,
    grantsLevel: tier,
    kind: unlock ? 'unlock' : 'upgrade',
    // A driving licence is a pass, not a rank: the unlock pays the level-1 bonus and raises pay nothing.
    salaryIncrease: isLicenceSkill(skill) ? (unlock ? bonusAt(1) : 0) : bonusAt(tier) - bonusAt(held),
    ...courseTerms(tier),
  };
}

/** Duration and fee of a course at a school of this tier. */
export function courseTerms(tier: BuildingTier): { ticks: number; fee: number } {
  return {
    ticks: Math.max(1, Math.round(TRAINING_BASE_TICKS * TRAINING_TIER_SPEED[tier] * TRAINING_LEVEL_TICKS_MULT[tier])),
    fee: TRAINING_LEVEL_FEE[tier],
  };
}

export type EnrolInTrainingResult =
  | { success: true; fee: number; plan: TrainingPlan }
  | ({ success: false; error: string } & RefusalKey);

/**
 * Begin training an employee at a building.
 * Fails if employee not found / not alive, or already in training.
 */
export function startTraining(
  state: EmployeeState,
  employeeId: number,
  buildingId: number,
  skill: SkillCategory,
  durationTicks: number,
  fee: number,
): { success: boolean; fee?: number; error?: string } {
  const emp = state.employees.find(e => e.id === employeeId);
  if (!emp || !emp.alive) {
    return { success: false, error: 'Employee not found or not alive' };
  }
  if (emp.trainingState !== null) {
    return { success: false, error: 'Employee already in training' };
  }
  emp.trainingState = { buildingId, skill, ticksRemaining: durationTicks, fee };
  return { success: true, fee };
}

/**
 * Enrol an employee on the course that teaches a skill they lack, at a specific school.
 *
 * Validates what `startTraining` alone cannot: that the building teaches this
 * skill, that the employee lacks the qualification, and (#1203) that the school has
 * a free seat. Deducting the fee is the caller's job — this module does not
 * touch cash.
 *
 * On success the employee is sent walking to the school rather than
 * teleported — enrolment queues the walk-in via `moveTo`; arrival, entry, and
 * the in-course occupancy are owned by ArrivalGate.tickArrivalGate and
 * #1202's occupancy/locomotion model.
 */
export function enrolInTraining(
  state: GameState,
  employeeId: number,
  building: Building,
  skill: SkillCategory,
  emitter?: EventEmitter,
): EnrolInTrainingResult {
  const employee = state.employees.employees.find(e => e.id === employeeId);
  if (!employee || !employee.alive) return { success: false, error: 'Employee not found or not alive', errorKey: 'employees.employee_not_found', errorParams: { id: employeeId } };
  if (isEnrolledInTraining(employee)) return { success: false, error: 'Employee already in training', errorKey: 'employees.train_already_enrolled', errorParams: { name: employee.name } };
  if (employee.injured) return { success: false, error: 'Injured employees cannot train', errorKey: 'employees.train_injured', errorParams: { name: employee.name } };
  if (!isOperating(building)) {
    return {
      success: false,
      error: `${building.type} #${building.id} is closed`,
      errorKey: 'employees.train_school_closed',
      errorParams: { buildingType: building.type, buildingId: building.id, skill },
    };
  }
  if (!trainableSkills(building.type).includes(skill)) {
    return {
      success: false,
      error: `${building.type} does not teach ${skill}`,
      errorKey: 'employees.train_building_no_teach',
      errorParams: { buildingId: building.id, skill },
    };
  }

  const plan = planTraining(employee, skill, building.tier);
  if (!plan) return { success: false, ...trainingRefusal(employee, skill, building.tier) };

  if (isSchoolFull(state, building)) {
    return {
      success: false,
      error: `${building.type} #${building.id} is full — no seats free to train ${skill}`,
      errorKey: 'employees.train_school_full',
      errorParams: { buildingType: building.type, buildingId: building.id, skill },
    };
  }

  // The walk is taken on foot — a mounted employee alights first, mirroring
  // moveTo's own building-target overload, which otherwise refuses a mounted
  // employee outright rather than parking their vehicle for them.
  alightIfMounted(state, employee, emitter);

  const moveResult = moveTo(state, employeeId, { buildingId: building.id });
  if (!moveResult.success) return { success: false, error: moveResult.error };

  // Only the walk-in is queued here — arrival (moving this into
  // `trainingState`) is ArrivalGate.tickArrivalGate's job, mirroring
  // pendingRestDuration's claim-time/arrival-time split.
  employee.pendingTrainingState = { buildingId: building.id, skill, ticksRemaining: plan.ticks, fee: plan.fee, grantsLevel: plan.grantsLevel };

  return { success: true, fee: plan.fee, plan };
}

/** One course that finished on this tick: a new qualification (isNew true) or a raise of a held one (isNew false); `level` is the level reached (licence level for driving). */
export interface TrainingCompletion {
  employeeId: number;
  employeeName: string;
  skill: SkillCategory;
  level: ProficiencyLevel;
  /** True when the course taught a skill the employee did not hold; false for a raise. */
  isNew: boolean;
}

/** One course cancelled mid-course (#1203) — the school it was taught at was demolished. */
export interface TrainingCancellation {
  employeeId: number;
  employeeName: string;
  skill: SkillCategory;
  buildingId: number;
  refund: number;
}

/**
 * Tick every employee in training. On completion the skill reaches the course's
 * `grantsLevel` (the school's tier); a held skill is only ever raised. Also reports courses cancelled mid-way
 * (#1203 — the school teaching them was demolished), each refunding its fee.
 */
export function tickTraining(
  state: GameState,
  emitter?: EventEmitter,
): { completed: TrainingCompletion[]; cancelled: TrainingCancellation[] } {
  const completed: TrainingCompletion[] = [];
  const cancelled: TrainingCancellation[] = [];

  for (const emp of state.employees.employees) {
    if (!emp.trainingState) continue;

    const trainingState = emp.trainingState;
    const building = state.buildings.buildings.find(b => b.id === trainingState.buildingId);
    if (!building) {
      // The school was demolished out from under a mid-course trainee — the
      // course never happened, so it is cancelled and fully refunded rather
      // than ticked down or granting anything.
      emp.trainingState = null;
      cancelled.push({
        employeeId: emp.id,
        employeeName: emp.name,
        skill: trainingState.skill,
        buildingId: trainingState.buildingId,
        refund: trainingState.fee,
      });
      emitter?.emit('employee:training_cancelled', {
        employeeId: emp.id,
        skill: trainingState.skill,
        buildingId: trainingState.buildingId,
        refund: trainingState.fee,
      });
      continue;
    }

    trainingState.ticksRemaining -= 1;
    if (trainingState.ticksRemaining > 0) continue;

    const skill = trainingState.skill;
    emp.trainingState = null;
    leaveBuilding(state, emp.id, emitter);

    const grants = trainingState.grantsLevel;
    if (grants !== undefined) {
      const held = emp.qualifications.find(q => q.category === skill);
      // Stale when the employee reached this level mid-course (work, assign_skill): nothing taught.
      if (heldCourseLevel(emp.qualifications, skill) >= grants) continue;
      const isNew = !held;
      if (isLicenceSkill(skill)) {
        if (held) held.licenceLevel = grants as LicenceLevel;
        else emp.qualifications.push({ category: skill, proficiencyLevel: 1, xp: 0, ...(grants > 1 && { licenceLevel: grants as LicenceLevel }) });
      } else if (held) {
        held.proficiencyLevel = grants;
        held.xp = Math.max(held.xp, XP_THRESHOLDS[grants]);
      } else {
        emp.qualifications.push(qualificationAtLevel(skill, grants));
      }
      emp.salary = calculateSalary(emp);
      completed.push({ employeeId: emp.id, employeeName: emp.name, skill, level: grants, isNew });
      emitter?.emit('employee:trained', { employeeId: emp.id, skill, level: grants, isNew });
      continue;
    }

    // Legacy in-flight course (saved before grantsLevel): level-1 unlock or licence raise.
    const held = emp.qualifications.find(q => q.category === skill);
    const raisesTo = trainingState.raisesLicenceTo;
    if (raisesTo !== undefined) {
      if (!held || (held.licenceLevel ?? 1) >= raisesTo) continue;
      held.licenceLevel = raisesTo;
      completed.push({ employeeId: emp.id, employeeName: emp.name, skill, level: raisesTo, isNew: false });
      emitter?.emit('employee:trained', { employeeId: emp.id, skill, level: raisesTo, isNew: false });
      continue;
    }
    if (held) continue;
    emp.qualifications.push({ category: skill, proficiencyLevel: 1, xp: 0 });
    emp.salary = calculateSalary(emp);

    completed.push({ employeeId: emp.id, employeeName: emp.name, skill, level: 1, isNew: true });
    emitter?.emit('employee:trained', { employeeId: emp.id, skill, level: 1, isNew: true });
  }

  return { completed, cancelled };
}

export type { TrainingState };

/** One employee enrolled at a school, for the inspector's school section. */
export interface SchoolTrainee {
  employeeId: number;
  name: string;
  skill: SkillCategory;
  grantsLevel: ProficiencyLevel | undefined;
  ticksRemaining: number;
  fee: number;
  phase: 'inside' | 'walking_in';
}

/** Employees enrolled at the school `buildingId`, inside first, then by time left, then id. */
export function schoolTrainees(employees: readonly Employee[], buildingId: number): SchoolTrainee[] {
  const rows: SchoolTrainee[] = [];
  for (const e of employees) {
    if (!e.alive) continue;
    const inside = e.trainingState?.buildingId === buildingId;
    const course = inside ? e.trainingState : e.pendingTrainingState?.buildingId === buildingId ? e.pendingTrainingState : null;
    if (!course) continue;
    rows.push({
      employeeId: e.id,
      name: e.name,
      skill: course.skill,
      grantsLevel: course.grantsLevel,
      ticksRemaining: course.ticksRemaining,
      fee: course.fee,
      phase: inside ? 'inside' : 'walking_in',
    });
  }
  return rows.sort((a, b) =>
    (a.phase === b.phase ? 0 : a.phase === 'inside' ? -1 : 1)
    || a.ticksRemaining - b.ticksRemaining
    || a.employeeId - b.employeeId);
}

/** One course a school teaches, with the terms it runs on. */
export interface SchoolCourse {
  skill: SkillCategory;
  level: BuildingTier;
  ticks: number;
  fee: number;
  /** A better school on site that teaches this course instead, or null. */
  supersededBy: Building | null;
}

/** Courses taught at `building`, given the best-school offers on site. */
export function schoolCourses(building: Building, offers: readonly SkillOffer[]): SchoolCourse[] {
  return trainableSkills(building.type).map(skill => {
    const best = offers.find(o => o.skill === skill)?.building ?? null;
    return {
      skill,
      level: building.tier,
      ...courseTerms(building.tier),
      supersededBy: best && best.id !== building.id ? best : null,
    };
  });
}
