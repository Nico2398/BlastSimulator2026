// BlastSimulator2026 — Corruption system
// Bribery attempts with probabilistic outcomes.
// More corruption → higher failure risk → mafia events unlock.

import type { Random } from '../math/Random.js';

// ── Config ──

/** Base success rate for corruption attempts. */
const BASE_SUCCESS_RATE = 0.7;
/** Each prior corruption attempt reduces success rate by this much. */
const HISTORY_PENALTY = 0.03;
/** Corruption level that unlocks mafia events. */
export const MAFIA_THRESHOLD = 3;

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
  const cost = customCost ?? TARGET_COSTS[target];
  const successRate = Math.max(0.1,
    BASE_SUCCESS_RATE - state.attempts.length * HISTORY_PENALTY,
  );

  const success = rng.chance(successRate);

  state.attempts.push({ tick, target, cost, success });

  if (success) {
    state.level++;
  } else {
    // Failed corruption increases level too (you tried, you're corrupt)
    state.level++;
  }

  const mafiaJustUnlocked = !state.mafiaUnlocked && state.level >= MAFIA_THRESHOLD;
  if (mafiaJustUnlocked) {
    state.mafiaUnlocked = true;
  }

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

/** Get corruption success probability for display/debugging. */
export function getSuccessRate(state: CorruptionState): number {
  return Math.max(0.1, BASE_SUCCESS_RATE - state.attempts.length * HISTORY_PENALTY);
}

export { BASE_SUCCESS_RATE, HISTORY_PENALTY, TARGET_COSTS };
