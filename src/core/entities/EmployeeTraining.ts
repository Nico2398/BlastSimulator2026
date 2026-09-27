// BlastSimulator2026 — Employee training
//
// Training is the only way to obtain a qualification a role is not hired with,
// and the only way to raise proficiency: `driving.excavator` and
// `driving.drill_rig` belong to no hiring role, so without a reachable course
// they cannot be held by anyone.

import type { Employee, EmployeeState, SkillCategory, TrainingState } from './Employee.js';
import { calculateSalary } from './Employee.js';
import type { Building, BuildingType, BuildingTier } from './Building.js';
import { getBuildingPeopleCapacity } from './Building.js';
import type { GameState } from '../state/GameState.js';
import type { EventEmitter } from '../state/EventEmitter.js';
import { alightIfMounted, leaveBuilding } from '../engine/Mount.js';
import { moveTo } from '../engine/MoveTo.js';
import { t } from '../i18n/I18n.js';
import {
  TRAINING_BUILDING_SKILLS,
  TRAINING_BASE_TICKS,
  TRAINING_TIER_SPEED,
  TRAINING_BASE_FEE,
  TRAINING_LEVEL_COST_MULTIPLIER,
  XP_THRESHOLDS,
} from '../config/balance.js';

export type ProficiencyLevel = 1 | 2 | 3 | 4 | 5;

/** The highest proficiency a qualification can reach. */
export const MAX_PROFICIENCY: ProficiencyLevel = 5;

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
  /** Proficiency the employee holds now; 0 when they do not hold the skill. */
  currentLevel: 0 | ProficiencyLevel;
  /** Proficiency the course grants — always one step up. */
  targetLevel: ProficiencyLevel;
  ticks: number;
  fee: number;
}

/**
 * Cost and duration of the next course in a skill.
 *
 * @returns The plan, or null when the employee is already at Master — there is
 *   nothing left to teach and a course would take a fee for no gain.
 */
export function planTraining(
  employee: Employee,
  skill: SkillCategory,
  tier: BuildingTier,
): TrainingPlan | null {
  const held = employee.qualifications.find(q => q.category === skill);
  const currentLevel = held?.proficiencyLevel ?? 0;
  if (currentLevel >= MAX_PROFICIENCY) return null;

  const targetLevel = (currentLevel + 1) as ProficiencyLevel;
  const multiplier = TRAINING_LEVEL_COST_MULTIPLIER[targetLevel];
  return {
    skill,
    currentLevel,
    targetLevel,
    ticks: Math.max(1, Math.round(TRAINING_BASE_TICKS * multiplier * TRAINING_TIER_SPEED[tier])),
    fee: Math.round(TRAINING_BASE_FEE * multiplier),
  };
}

export type EnrolInTrainingResult =
  | { success: true; fee: number; plan: TrainingPlan }
  | { success: false; error: string };

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
 * Enrol an employee on the next course in a skill at a specific school.
 *
 * Validates what `startTraining` alone cannot: that the building teaches this
 * skill, that there is a level left to gain, and (#1203) that the school has
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
  if (!employee || !employee.alive) return { success: false, error: 'Employee not found or not alive' };
  if (isEnrolledInTraining(employee)) return { success: false, error: 'Employee already in training' };
  if (employee.injured) return { success: false, error: 'Injured employees cannot train' };
  if (!trainableSkills(building.type).includes(skill)) {
    return { success: false, error: `${building.type} does not teach ${skill}` };
  }

  const plan = planTraining(employee, skill, building.tier);
  if (!plan) return { success: false, error: `Already at the highest proficiency in ${skill}` };

  if (isSchoolFull(state, building)) {
    return {
      success: false,
      error: t('employees.train_school_full', { buildingType: building.type, buildingId: building.id, skill }),
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
  employee.pendingTrainingState = { buildingId: building.id, skill, ticksRemaining: plan.ticks, fee: plan.fee };

  return { success: true, fee: plan.fee, plan };
}

/** One course that finished on this tick. */
export interface TrainingCompletion {
  employeeId: number;
  employeeName: string;
  skill: SkillCategory;
  level: ProficiencyLevel;
  /** True when the course taught a skill the employee did not hold. */
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
 * Tick every employee in training. On completion the qualification is granted at
 * Rookie level, or raised one level when already held — a course that left an
 * existing qualification untouched made proficiency unobtainable, since the fee
 * was charged and nothing changed. Also reports courses cancelled mid-way
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

    const existing = emp.qualifications.find(q => q.category === skill);
    let level: ProficiencyLevel;
    let isNew: boolean;
    if (!existing) {
      level = 1;
      isNew = true;
      emp.qualifications.push({ category: skill, proficiencyLevel: 1, xp: 0 });
    } else {
      isNew = false;
      level = Math.min(MAX_PROFICIENCY, existing.proficiencyLevel + 1) as ProficiencyLevel;
      existing.proficiencyLevel = level;
      existing.xp = Math.max(existing.xp, XP_THRESHOLDS[level]);
    }
    // A better-qualified employee demands more pay.
    emp.salary = calculateSalary(emp);

    completed.push({ employeeId: emp.id, employeeName: emp.name, skill, level, isNew });
    emitter?.emit('employee:trained', { employeeId: emp.id, skill, level, isNew });
  }

  return { completed, cancelled };
}

export type { TrainingState };
