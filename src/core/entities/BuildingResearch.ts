// BlastSimulator2026 — Research Center task queue
// Handles tier-unlock research tasks queued at the Research Center.

import type { BuildingType, BuildingTier, BuildingState, ResearchTask } from './Building.js';
import { getResearchTaskDef } from '../config/balance.js';

export type { ResearchTask };

// ── Types ──

/**
 * A prerequisite a research task must satisfy before it can be queued.
 * `building_tier` requires a building of the given type/tier to already be
 * placed and active; `research_completed` requires the given type/tier to
 * already be unlocked (used to gate tier 3 behind tier 2, for example).
 */
export type ResearchCondition =
  | { kind: 'building_tier'; buildingType: BuildingType; tier: 2 | 3 }
  | { kind: 'research_completed'; buildingType: BuildingType; tier: 2 | 3 };

export interface QueueResearchResult {
  success: boolean;
  code?: 'no_research_center' | 'already_unlocked' | 'already_queued' | 'conditions_not_met' | 'insufficient_funds';
  cost?: number;
}

// ── Functions ──

/**
 * Whether a placed, active `research_center` building exists in state.
 * Research cannot be queued at all without one.
 */
export function hasActiveResearchCenter(state: BuildingState): boolean {
  return state.buildings.some((b) => b.type === 'research_center' && b.active);
}

/** Whether a single research condition currently holds against state. */
export function isConditionMet(state: BuildingState, condition: ResearchCondition): boolean {
  switch (condition.kind) {
    case 'building_tier':
      return state.buildings.some(
        (b) => b.type === condition.buildingType && b.active && b.tier >= condition.tier,
      );
    case 'research_completed':
      return isTierUnlocked(state, condition.buildingType, condition.tier);
  }
}

/** Return the subset of `conditions` that are not currently met. */
export function getUnmetConditions(state: BuildingState, conditions: ResearchCondition[]): ResearchCondition[] {
  return conditions.filter((condition) => !isConditionMet(state, condition));
}

/**
 * Enqueue a research task for `targetType`/`targetTier`, validating research
 * center presence, unlock/queue state, and prerequisite conditions.
 * Does not check funds — `BuildingState` has no cash concept; the console
 * layer checks cash before/after calling this.
 */
export function queueResearchTask(
  state: BuildingState,
  targetType: BuildingType,
  targetTier: 2 | 3,
): QueueResearchResult {
  if (!hasActiveResearchCenter(state)) {
    return { success: false, code: 'no_research_center' };
  }
  if (isTierUnlocked(state, targetType, targetTier)) {
    return { success: false, code: 'already_unlocked' };
  }
  if (isResearchQueued(state, targetType, targetTier)) {
    return { success: false, code: 'already_queued' };
  }
  const def = getResearchTaskDef(targetType, targetTier);
  if (getUnmetConditions(state, def.conditions).length > 0) {
    return { success: false, code: 'conditions_not_met' };
  }
  state.researchQueue.push({
    targetType,
    targetTier,
    ticksRemaining: def.ticks,
    cost: def.cost,
    conditions: def.conditions,
  });
  return { success: true, cost: def.cost };
}

/**
 * Tick the research queue. Decrements head task's ticksRemaining.
 * When ticksRemaining reaches 0: set unlockedTiers[targetType] = targetTier, remove from queue.
 */
export function tickResearch(state: BuildingState): void {
  const task = state.researchQueue[0];
  if (!task) return;
  task.ticksRemaining -= 1;
  if (task.ticksRemaining <= 0) {
    state.unlockedTiers[task.targetType] = task.targetTier;
    state.researchQueue.shift();
  }
}

/**
 * Check if a tier is available. Tier 1 is always unlocked.
 * Tier N is unlocked if unlockedTiers[type] >= N.
 */
export function isTierUnlocked(
  state: BuildingState,
  type: BuildingType,
  tier: BuildingTier,
): boolean {
  if (tier === 1) return true;
  const unlocked = state.unlockedTiers[type];
  if (unlocked === undefined) return false;
  return unlocked >= tier;
}

/**
 * Whether a research task for this exact {type, tier} already sits in the
 * queue (in progress or pending). Shared by the console `research queue`
 * command and the Build Menu UI so a repeat click neither double-charges
 * nor pushes a redundant duplicate task.
 */
export function isResearchQueued(
  state: BuildingState,
  type: BuildingType,
  tier: BuildingTier,
): boolean {
  return state.researchQueue.some(
    (task) => task.targetType === type && task.targetTier === tier,
  );
}
