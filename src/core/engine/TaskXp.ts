// BlastSimulator2026 — XP awarding for task work (#1833)
//
// Shared by taskTicksRemaining-driven tasks and phase-driven work (debris
// haul/fragment drivers), which carry no taskTicksRemaining.

import type { PendingAction } from '../state/GameState.js';
import type { Employee, EmployeeState, SkillCategory } from '../entities/Employee.js';
import type { EventEmitter } from '../state/EventEmitter.js';

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
  _employees: EmployeeState,
  _emp: Employee,
  _action: PendingAction | undefined,
  _emitter?: EventEmitter,
): TaskXpResult {
  // TODO: implement
  return { skill: null, leveledUp: false, levelUps: [], levelUpLevels: null };
}

/** True when this tick is work by a phase-driven employee (no taskTicksRemaining) that should earn XP. */
export function isPhaseDrivenWorkTick(_emp: Employee, _action: PendingAction | undefined): boolean {
  // TODO: implement
  return false;
}
