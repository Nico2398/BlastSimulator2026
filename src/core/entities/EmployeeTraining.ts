// BlastSimulator2026 — Employee training
//
// Training is the only way to obtain a qualification a role is not hired with,
// and the only way to raise proficiency: `driving.excavator` and
// `driving.drill_rig` belong to no hiring role, so without a reachable course
// they cannot be held by anyone.

import type { Employee, EmployeeState, SkillCategory, TrainingState } from './Employee.js';
import { calculateSalary } from './Employee.js';
import type { BuildingType, BuildingTier } from './Building.js';
import type { EventEmitter } from '../state/EventEmitter.js';
import {
  TRAINING_BUILDING_SKILLS,
  TRAINING_BASE_TICKS,
  TRAINING_TIER_SPEED,
  TRAINING_BASE_FEE,
  TRAINING_LEVEL_COST_MULTIPLIER,
  TRAINING_RELOCATION_OFFSET,
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

export interface StartTrainingResult {
  success: boolean;
  fee?: number;
  plan?: TrainingPlan;
  error?: string;
}

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
 * skill, and that there is a level left to gain. Deducting the fee is the
 * caller's job — this module does not touch cash.
 *
 * On success the employee is relocated to the building — otherwise they stay
 * wherever they were dispatched last while a course "trains" them in place,
 * which is what left an enrolled employee's sprite standing in the pit while
 * their qualification changed.
 *
 * This relocation is an instant teleport, not a queued walk — intentionally
 * NOT gated on navmesh arrival like survey/rest/boarding/hauling (#437).
 * That gating would replace this existing, intentional teleport-not-walk
 * design (#410) with a walk, which is a larger behavioral change than #437
 * asked for; out of scope here.
 *
 * Placed one tile outside the footprint, adjacent to the entry point corner
 * (`building.x`/`building.z`), rather than exactly on that corner: the raw
 * origin coordinate sits on the building's own opaque base-box footprint, so
 * a character placed there renders fully occluded from every external camera
 * angle (#410).
 *
 * The offset moves in `-x` unless that would leave the grid — a school sitting
 * at the `x === 0` edge (a legal placement) offsets in `+x` instead, so the
 * employee never lands off-grid (#410).
 */
export function enrolInTraining(
  state: EmployeeState,
  employeeId: number,
  building: { id: number; type: BuildingType; tier: BuildingTier; x: number; z: number },
  skill: SkillCategory,
): StartTrainingResult {
  const emp = state.employees.find(e => e.id === employeeId);
  if (!emp || !emp.alive) return { success: false, error: 'Employee not found or not alive' };
  if (emp.trainingState !== null) return { success: false, error: 'Employee already in training' };
  if (emp.injured) return { success: false, error: 'Injured employees cannot train' };
  if (!trainableSkills(building.type).includes(skill)) {
    return { success: false, error: `${building.type} does not teach ${skill}` };
  }

  const plan = planTraining(emp, skill, building.tier);
  if (!plan) return { success: false, error: `Already at the highest proficiency in ${skill}` };

  const started = startTraining(state, employeeId, building.id, skill, plan.ticks, plan.fee);
  if (!started.success) return { success: false, ...(started.error ? { error: started.error } : {}) };

  // One tile outside the footprint, adjacent to the entry corner — see doc
  // comment above for why the raw origin corner is unusable, and why the
  // offset direction flips at the grid edge.
  emp.x = building.x - TRAINING_RELOCATION_OFFSET >= 0
    ? building.x - TRAINING_RELOCATION_OFFSET
    : building.x + TRAINING_RELOCATION_OFFSET;
  emp.z = building.z;

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

/**
 * Tick every employee in training. On completion the qualification is granted at
 * Rookie level, or raised one level when already held — a course that left an
 * existing qualification untouched made proficiency unobtainable, since the fee
 * was charged and nothing changed.
 */
export function tickTraining(
  state: EmployeeState,
  emitter?: EventEmitter,
): TrainingCompletion[] {
  const completed: TrainingCompletion[] = [];

  for (const emp of state.employees) {
    if (!emp.trainingState) continue;
    emp.trainingState.ticksRemaining -= 1;
    if (emp.trainingState.ticksRemaining > 0) continue;

    const skill = emp.trainingState.skill;
    emp.trainingState = null;

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
    }
    // A better-qualified employee demands more pay.
    emp.salary = calculateSalary(emp);

    completed.push({ employeeId: emp.id, employeeName: emp.name, skill, level, isNew });
    emitter?.emit('employee:trained', { employeeId: emp.id, skill, level, isNew });
  }

  return completed;
}

export type { TrainingState };
