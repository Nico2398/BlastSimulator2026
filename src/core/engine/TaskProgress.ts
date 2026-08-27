// BlastSimulator2026 — Task progress ticking and completion
//
// Advances an employee's dispatched task toward completion, granting XP and
// reporting completion when taskTicksRemaining reaches zero. Split out of
// GameLoop.ts as part of #759's file-size split; re-exported there so
// GameLoop.ts stays the single public surface for tick-orchestration callers.

import type { GameState, ActionType } from '../state/GameState.js';
import type { Employee, SkillCategory } from '../entities/Employee.js';
import type { EventEmitter } from '../state/EventEmitter.js';

/** One skill category's level-up, reported when a single tick's XP gain crosses a proficiency threshold. */
export interface TaskProgressLevelUp {
  skill: SkillCategory;
  oldLevel: 1 | 2 | 3 | 4 | 5;
  newLevel: 1 | 2 | 3 | 4 | 5;
}

export interface TaskProgressResult {
  /** True when taskTicksRemaining reached 0 this tick and the task completed. */
  completed: boolean;
  /** True when ANY award this tick crossed a proficiency level threshold (#622). */
  leveledUp: boolean;
  /** Skill category XP was granted to, or null when the task carries no skill.
   * When multiple awards land in the same tick, this is the first one that
   * leveled up (or, if none leveled up, the first award's category) — kept
   * for single-award callers; see `levelUps` for every award that leveled up. */
  skill: SkillCategory | null;
  oldLevel?: 1 | 2 | 3 | 4 | 5;
  newLevel?: 1 | 2 | 3 | 4 | 5;
  /** Every award that leveled up this tick, in award order (#622) — a
   * vehicle-gated action like drill_hole can grant XP in two categories
   * (e.g. blasting and driving.drill_rig) in the same tick, and both can
   * level up; this carries the full set so none is lost to the single-slot
   * skill/oldLevel/newLevel fields above. Empty when nothing leveled up. */
  levelUps: TaskProgressLevelUp[];
  /** Action type of the task that just completed — only present when `completed` is true. */
  actionType?: ActionType;
  /** Payload of the task that just completed — only present when `completed` is true. */
  actionPayload?: Record<string, unknown>;
  /** ID of the PendingAction that just completed — only present when `completed` is true (#547). */
  actionId?: number;
}

/**
 * Advance an employee's dispatched task toward completion, granting XP and
 * reporting completion when taskTicksRemaining reaches zero. Mirrors
 * ShiftCycle.ts's completeRestTick shape for taskTicksRemaining instead of
 * restTicksRemaining.
 *
 * No-op (returns null) for an employee with no in-progress task
 * (taskTicksRemaining === null) — includes employees currently resting and
 * any employee not yet promoted out of pendingTaskDuration by ArrivalGate
 * (still walking to the target).
 */
export function tickTaskProgress(state: GameState, emp: Employee, emitter?: EventEmitter): TaskProgressResult | null {
  void state; void emp; void emitter;
  // TODO: implement
  throw new Error('not implemented');
}
