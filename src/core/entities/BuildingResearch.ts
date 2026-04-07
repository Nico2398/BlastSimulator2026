// BlastSimulator2026 — Research Center task queue
// Handles tier-unlock research tasks queued at the Research Center.

import type { BuildingType, BuildingTier, BuildingState, ResearchTask } from './Building.js';

export type { ResearchTask };

// ── Functions ──

/** Enqueue a research task. Returns the cost. */
export function queueResearchTask(
  state: BuildingState,
  targetType: BuildingType,
  targetTier: 2 | 3,
  durationTicks: number,
  cost: number,
): number {
  state.researchQueue.push({ targetType, targetTier, ticksRemaining: durationTicks, cost });
  return cost;
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
