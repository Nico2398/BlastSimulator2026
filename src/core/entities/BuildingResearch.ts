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

/**
 * Read-only precondition codes checked in `getQueueBlockCode`'s precedence
 * order. `insufficient_funds` is a separate, cash-gated code only ever
 * produced by the console layer (see `research.ts`), never by this module.
 */
export type QueueBlockCode = 'no_research_center' | 'already_unlocked' | 'already_queued' | 'conditions_not_met';

export interface QueueResearchResult {
  success: boolean;
  code?: QueueBlockCode | 'insufficient_funds';
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
 * Read-only precedence chain shared by `queueResearchTask` and the console
 * `research queue` command: research center presence, unlock/queue state,
 * then prerequisite conditions, in that order. Returns the first blocking
 * code found, or `undefined` if none of the read-only checks block queueing
 * (the caller must still separately gate on funds before committing).
 */
export function getQueueBlockCode(
  state: BuildingState,
  targetType: BuildingType,
  targetTier: 2 | 3,
): QueueBlockCode | undefined {
  if (!hasActiveResearchCenter(state)) {
    return 'no_research_center';
  }
  if (isTierUnlocked(state, targetType, targetTier)) {
    return 'already_unlocked';
  }
  if (isResearchQueued(state, targetType, targetTier)) {
    return 'already_queued';
  }
  const def = getResearchTaskDef(targetType, targetTier);
  if (getUnmetConditions(state, def.conditions).length > 0) {
    return 'conditions_not_met';
  }
  return undefined;
}

/**
 * Enqueue a research task for `targetType`/`targetTier`, validating research
 * center presence, unlock/queue state, and prerequisite conditions via
 * `getQueueBlockCode`. Does not check funds — `BuildingState` has no cash
 * concept; the console layer checks cash before/after calling this.
 * Re-validates independently of any caller pre-check (defense in depth).
 */
export function queueResearchTask(
  state: BuildingState,
  targetType: BuildingType,
  targetTier: 2 | 3,
): QueueResearchResult {
  const blockCode = getQueueBlockCode(state, targetType, targetTier);
  if (blockCode) {
    return { success: false, code: blockCode };
  }
  const def = getResearchTaskDef(targetType, targetTier);
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
 * A research task cancelled mid-flight because the Research Center enabling it
 * was destroyed (or otherwise no longer active). The queued cost is refunded
 * to the caller, who is responsible for crediting it back to cash/finances.
 */
export interface CancelledResearch {
  targetType: BuildingType;
  targetTier: 2 | 3;
  refund: number;
}

/**
 * Tick the research queue. Decrements head task's ticksRemaining.
 * When ticksRemaining reaches 0: set unlockedTiers[targetType] = targetTier, remove from queue.
 * TODO: implement cancellation check — if no active research_center remains,
 * cancel the head task and return a CancelledResearch describing the refund.
 */
export function tickResearch(state: BuildingState): CancelledResearch | undefined {
  const task = state.researchQueue[0];
  if (!task) return undefined;
  task.ticksRemaining -= 1;
  if (task.ticksRemaining <= 0) {
    state.unlockedTiers[task.targetType] = task.targetTier;
    state.researchQueue.shift();
  }
  return undefined;
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
