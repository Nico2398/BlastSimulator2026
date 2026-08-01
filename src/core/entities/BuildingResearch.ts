// BlastSimulator2026 — Research Center task queue
// Handles tier-unlock research tasks queued at the Research Center.

import type { BuildingType, BuildingTier, BuildingState, ResearchTask } from './Building.js';

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
export function hasActiveResearchCenter(_state: BuildingState): boolean {
  // TODO: implement
  return false;
}

/** Whether a single research condition currently holds against state. */
export function isConditionMet(_state: BuildingState, _condition: ResearchCondition): boolean {
  // TODO: implement
  return false;
}

/** Return the subset of `conditions` that are not currently met. */
export function getUnmetConditions(_state: BuildingState, conditions: ResearchCondition[]): ResearchCondition[] {
  // TODO: implement
  return conditions;
}

/**
 * Enqueue a research task for `targetType`/`targetTier`, validating research
 * center presence, unlock/queue state, prerequisite conditions, and funds.
 */
export function queueResearchTask(
  _state: BuildingState,
  _targetType: BuildingType,
  _targetTier: 2 | 3,
): QueueResearchResult {
  // TODO: implement
  return { success: false };
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
