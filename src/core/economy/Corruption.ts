// BlastSimulator2026 — Corruption system
// Bribery attempts with probabilistic outcomes.
// More corruption → higher failure risk → mafia events unlock.

import type { Random } from '../math/Random.js';
import { clampScore, type ScoreState } from '../scores/ScoreManager.js';
import {
  BRIBERY_BASE_SUCCESS,
  BRIBERY_HISTORY_PENALTY,
  BRIBERY_FAILURE_FINE_FRACTION,
  BRIBERY_FAILURE_NUISANCE_HIT,
  BRIBERY_FAILURE_CORRUPTION_DELTA,
  MAFIA_UNLOCK_THRESHOLD,
} from '../config/balance.js';

// ── Config (imported from centralized balance) ──

/** Base success rate for corruption attempts. */
const BASE_SUCCESS_RATE = BRIBERY_BASE_SUCCESS;
/** Each prior corruption attempt reduces success rate by this much. */
const HISTORY_PENALTY = BRIBERY_HISTORY_PENALTY;
/** Corruption level that unlocks mafia events. */
export const MAFIA_THRESHOLD = MAFIA_UNLOCK_THRESHOLD;

// ── Corruption targets ──

export type CorruptionTarget = 'judge' | 'union_leader' | 'inspector' | 'politician' | 'witness';

const TARGET_COSTS: Record<CorruptionTarget, number> = {
  judge: 50000,
  union_leader: 15000,
  inspector: 8000,
  politician: 30000,
  witness: 10000,
};

// ── Corruption state ──

export interface CorruptionState {
  level: number;
  attempts: CorruptionAttempt[];
  mafiaUnlocked: boolean;
}

export interface CorruptionAttempt {
  tick: number;
  target: CorruptionTarget;
  cost: number;
  success: boolean;
}

export function createCorruptionState(): CorruptionState {
  return { level: 0, attempts: [], mafiaUnlocked: false };
}

// ── Operations ──

export interface CorruptionResult {
  success: boolean;
  cost: number;
  scandalTriggered: boolean;
  mafiaJustUnlocked: boolean;
}

/**
 * Attempt corruption. Cost is deducted regardless of outcome.
 * Success probability = BASE_SUCCESS_RATE - (attempts * HISTORY_PENALTY).
 */
export function attemptCorruption(
  state: CorruptionState,
  target: CorruptionTarget,
  tick: number,
  rng: Random,
  customCost?: number,
): CorruptionResult {
  const cost = customCost !== undefined && Number.isFinite(customCost) && customCost >= 0
    ? customCost
    : TARGET_COSTS[target];
  const successRate = Math.max(0.1,
    BASE_SUCCESS_RATE - state.attempts.length * HISTORY_PENALTY,
  );

  const success = rng.chance(successRate);

  state.attempts.push({ tick, target, cost, success });

  // Failed attempts raise the level too (you tried, you're corrupt).
  const { mafiaJustUnlocked } = applyCorruptionDelta(state, 1);

  return {
    success,
    cost,
    scandalTriggered: !success,
    mafiaJustUnlocked,
  };
}

/** Get current corruption level. */
export function getCorruptionLevel(state: CorruptionState): number {
  return state.level;
}

/** Check if mafia events are unlocked. */
export function isMafiaUnlocked(state: CorruptionState): boolean {
  return state.mafiaUnlocked;
}

/**
 * Shift corruption level by delta (floored at 0); latches mafiaUnlocked at threshold.
 * Non-finite delta is a no-op. Returns whether this call unlocked the mafia.
 */
export function applyCorruptionDelta(
  state: CorruptionState,
  delta: number,
): { mafiaJustUnlocked: boolean } {
  if (!Number.isFinite(delta)) return { mafiaJustUnlocked: false };
  state.level = Math.max(0, state.level + delta);
  const mafiaJustUnlocked = !state.mafiaUnlocked && state.level >= MAFIA_THRESHOLD;
  if (mafiaJustUnlocked) state.mafiaUnlocked = true;
  return { mafiaJustUnlocked };
}

/** Get corruption success probability for display/debugging. */
export function getSuccessRate(state: CorruptionState): number {
  return Math.max(0.1, BASE_SUCCESS_RATE - state.attempts.length * HISTORY_PENALTY);
}

export { BASE_SUCCESS_RATE, HISTORY_PENALTY, TARGET_COSTS };

/** Fine levied on a failed bribe of the given cost (#1411). */
export function bribeFailureFine(cost: number): number {
  if (!Number.isFinite(cost) || cost <= 0) return 0;
  return Math.round(cost * BRIBERY_FAILURE_FINE_FRACTION);
}

/** Apply failed-bribe consequences: corruption level, nuisance hit; returns the fine to charge and whether this unlocked the mafia (#1411). */
export function applyBribeFailure(
  state: CorruptionState,
  scores: ScoreState,
  cost: number,
): { fine: number; mafiaJustUnlocked: boolean } {
  scores.nuisance = clampScore(scores.nuisance - BRIBERY_FAILURE_NUISANCE_HIT);
  const { mafiaJustUnlocked } = applyCorruptionDelta(state, BRIBERY_FAILURE_CORRUPTION_DELTA);
  return { fine: bribeFailureFine(cost), mafiaJustUnlocked };
}
