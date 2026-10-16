// BlastSimulator2026 — XP awarding for task work (#1833)
//
// Shared by taskTicksRemaining-driven tasks and phase-driven work (debris
// haul/fragment drivers), which carry no taskTicksRemaining.

import type { PendingAction } from '../state/GameState.js';
import type { Employee, EmployeeState, SkillCategory } from '../entities/Employee.js';
import type { EventEmitter } from '../state/EventEmitter.js';
import { gainXp } from '../entities/Employee.js';
import { computeTaskXpAwards } from '../entities/EmployeeXpRules.js';
import { isMounted } from '../entities/EmployeeLocomotion.js';
import { isAutoDebrisAction } from '../economy/HaulDispatch.js';

type Level = 1 | 2 | 3 | 4 | 5;

/** One skill category's level-up, reported when a single tick's XP gain crosses a proficiency threshold. */
export interface TaskProgressLevelUp {
  skill: SkillCategory;
  oldLevel: Level;
  newLevel: Level;
}

export interface TaskXpResult {
  /** Skill category XP was granted to, or null when nothing was awarded. */
  skill: SkillCategory | null;
  /** True when ANY award crossed a proficiency level threshold. */
  leveledUp: boolean;
  /** Every award that leveled up, in award order. */
  levelUps: TaskProgressLevelUp[];
  /** Levels of the first level-up, or null. */
  levelUpLevels: { oldLevel: Level; newLevel: Level } | null;
}

/** Grants this tick's XP for the employee's action; returns what was awarded. */
export function awardTaskXp(
  employees: EmployeeState,
  emp: Employee,
  action: PendingAction | undefined,
  emitter?: EventEmitter,
): TaskXpResult {
  const xpAwards = action ? computeTaskXpAwards(emp, action) : [];

  let skill: SkillCategory | null = null;
  let leveledUp = false;
  let levelUpLevels: { oldLevel: Level; newLevel: Level } | null = null;
  const levelUps: TaskProgressLevelUp[] = [];

  // computeTaskXpAwards returns 0, 1, or 2 awards (2 for a vehicle-gated
  // action like drill_hole, which grants both the required skill and the
  // driving licence for its required vehicle role in the same tick — #622).
  // Aggregate across every award instead of letting a later iteration
  // overwrite an earlier one's level-up, or a real level-up would go
  // unreported whenever it isn't the last award processed.
  for (const xpAward of xpAwards) {
    if (skill === null) skill = xpAward.category;
    const xpResult = gainXp(employees, emp.id, xpAward.category, xpAward.amount, emitter);
    if (xpResult?.leveledUp) {
      levelUps.push({ skill: xpAward.category, oldLevel: xpResult.oldLevel, newLevel: xpResult.newLevel });
      if (!leveledUp) {
        leveledUp = true;
        skill = xpAward.category;
        levelUpLevels = { oldLevel: xpResult.oldLevel, newLevel: xpResult.newLevel };
      }
    }
  }
  return { skill, leveledUp, levelUps, levelUpLevels };
}

/**
 * True when this tick is work by a phase-driven employee (no taskTicksRemaining) that should earn XP:
 * a haul_debris / fragment_debris driver mounted in a vehicle with a live itinerary.
 */
export function isPhaseDrivenWorkTick(emp: Employee, action: PendingAction | undefined): boolean {
  return action !== undefined
    && emp.activeActionId === action.id
    && isAutoDebrisAction(action.type)
    && emp.restTicksRemaining === null
    && isMounted(emp.locomotion)
    && emp.itinerary !== null;
}
