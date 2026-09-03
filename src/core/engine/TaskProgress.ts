// BlastSimulator2026 — Task progress ticking and completion
//
// Advances an employee's dispatched task toward completion, granting XP and
// reporting completion when taskTicksRemaining reaches zero. Split out of
// GameLoop.ts as part of #759's file-size split; re-exported there so
// GameLoop.ts stays the single public surface for tick-orchestration callers.

import type { GameState, ActionType } from '../state/GameState.js';
import { gainXp, type Employee, type SkillCategory } from '../entities/Employee.js';
import { computeTaskXpAwards } from '../entities/EmployeeXpRules.js';
import type { EventEmitter } from '../state/EventEmitter.js';
import type { VoxelGrid } from '../world/VoxelGrid.js';
import { clearActiveTaskFields } from './TaskDispatch.js';
import { computeRampSegmentCarveTarget, carveRampSegmentSlice, type RampSegmentDef } from '../mining/Ramp.js';
import { NavGrid } from '../nav/NavGrid.js';

/**
 * Patch `state.navGrid` scoped to `region`, when both a navGrid exists and a
 * region was actually carved. Shared "carve, then conditionally patch nav"
 * step between this file's progressive per-tick ramp carving and
 * `tickTaskCompletion.ts`'s completion-time carve (#946 review finding 2) —
 * the `NavGrid.patchNavGrid` call itself was byte-for-byte duplicated
 * between the two. Lives here (not in `core/mining/Ramp.ts`, which this
 * module already imports NavGrid alongside) because `core/mining` must stay
 * free of a `core/nav` import (core/nav already depends on core/mining, so
 * the reverse edge would cycle — see Ramp.ts's `computeColumnSurfaceY`
 * comment), while `core/engine` already sits above both.
 */
export function patchNavGridForRegion(
  state: GameState,
  grid: VoxelGrid,
  region: RampSegmentDef['region'],
): void {
  if (region && state.navGrid) {
    NavGrid.patchNavGrid(state.navGrid, grid, state.buildings.buildings, state.drillHoles, region);
  }
}

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
export function tickTaskProgress(state: GameState, emp: Employee, emitter?: EventEmitter, grid?: VoxelGrid): TaskProgressResult | null {
  if (emp.taskTicksRemaining === null) return null;

  emp.taskTicksRemaining -= 1;

  // Progressive ramp carving (#946) — carve a bite of the segment's cells
  // each tick, in step with the digger's own tick progress, instead of
  // leaving the whole layer intact until the action completes. No-op for
  // any other action type or when no grid was supplied (grid?: VoxelGrid
  // is undefined outside GameLoop's tick.ts call site).
  if (grid && emp.pendingActionType === 'dig_ramp_segment' && emp.pendingActionPayload) {
    const rampId = emp.pendingActionPayload['rampId'] as number;
    const segmentIndex = emp.pendingActionPayload['segmentIndex'] as number;
    const ramp = state.plannedRamps.find(r => r.id === rampId);
    const tracker = ramp?.segments.find(s => s.index === segmentIndex);

    if (tracker && !tracker.done) {
      const totalTicks = emp.activeTaskTotalTicks ?? 0;
      const ticksElapsed = totalTicks - emp.taskTicksRemaining;
      const carvedCount = tracker.carvedCount ?? 0;
      const target = computeRampSegmentCarveTarget(tracker.cells.length, ticksElapsed, totalTicks);

      if (target > carvedCount) {
        const sliceResult = carveRampSegmentSlice(grid, tracker.cells, carvedCount, target, emitter);
        tracker.carvedCount = target;
        patchNavGridForRegion(state, grid, sliceResult.region);
      }
    }
  }

  const action = state.pendingActions.find(a => a.id === emp.activeActionId);
  const xpAwards = action ? computeTaskXpAwards(emp, action) : [];

  let skill: SkillCategory | null = null;
  let leveledUp = false;
  let levelUpLevels: { oldLevel: 1 | 2 | 3 | 4 | 5; newLevel: 1 | 2 | 3 | 4 | 5 } | null = null;
  const levelUps: TaskProgressLevelUp[] = [];

  // computeTaskXpAwards returns 0, 1, or 2 awards (2 for a vehicle-gated
  // action like drill_hole, which grants both the required skill and the
  // driving licence for its required vehicle role in the same tick — #622).
  // Aggregate across every award instead of letting a later iteration
  // overwrite an earlier one's level-up, or a real level-up would go
  // unreported whenever it isn't the last award processed.
  for (const xpAward of xpAwards) {
    if (skill === null) skill = xpAward.category;
    const xpResult = gainXp(state.employees, emp.id, xpAward.category, xpAward.amount, emitter);
    if (xpResult?.leveledUp) {
      levelUps.push({ skill: xpAward.category, oldLevel: xpResult.oldLevel, newLevel: xpResult.newLevel });
      if (!leveledUp) {
        leveledUp = true;
        skill = xpAward.category;
        levelUpLevels = { oldLevel: xpResult.oldLevel, newLevel: xpResult.newLevel };
      }
    }
  }

  let completed = false;
  let completedActionType: ActionType | undefined;
  let completedActionPayload: Record<string, unknown> | undefined;
  let completedActionId: number | undefined;
  if (emp.taskTicksRemaining <= 0) {
    completed = true;
    // pendingActionType/pendingActionPayload were left set by tickEmployees at
    // claim time (#437) specifically so completion handling — e.g. resolving
    // a completed survey — still knows what work this was. activeActionId is
    // captured here, before it's nulled below, so the caller can remove the
    // matching PendingAction/ghost via completePendingAction (#547).
    completedActionType = emp.pendingActionType ?? undefined;
    completedActionPayload = emp.pendingActionPayload ?? undefined;
    completedActionId = emp.activeActionId ?? undefined;
    clearActiveTaskFields(emp);
  }

  return {
    completed,
    leveledUp,
    skill,
    levelUps,
    ...(levelUpLevels ? { oldLevel: levelUpLevels.oldLevel, newLevel: levelUpLevels.newLevel } : {}),
    ...(completedActionType !== undefined ? { actionType: completedActionType } : {}),
    ...(completedActionPayload !== undefined ? { actionPayload: completedActionPayload } : {}),
    ...(completedActionId !== undefined ? { actionId: completedActionId } : {}),
  };
}
