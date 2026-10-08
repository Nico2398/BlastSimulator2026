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
  CORRUPTION_MAX,
} from '../config/balance.js';
import { BRIBE_PROFILES, grantProtection, type ActiveProtection } from './BribeProtection.js';

// ── Config (imported from centralized balance) ──

/** Base success rate for corruption attempts. */
const BASE_SUCCESS_RATE = BRIBERY_BASE_SUCCESS;
/** Each prior corruption attempt reduces success rate by this much. */
const HISTORY_PENALTY = BRIBERY_HISTORY_PENALTY;
/** Corruption level that unlocks mafia events. */
export const MAFIA_THRESHOLD = MAFIA_UNLOCK_THRESHOLD;

// ── Corruption targets ──

export type CorruptionTarget = 'judge' | 'union_leader' | 'inspector' | 'politician' | 'witness';

const TARGET_COSTS = Object.fromEntries(
  Object.entries(BRIBE_PROFILES).map(([target, profile]) => [target, profile.price]),
) as Record<CorruptionTarget, number>;

// ── Corruption state ──

export interface CorruptionState {
  level: number;
  attempts: CorruptionAttempt[];
  mafiaUnlocked: boolean;
  /** Timed bribe protections currently held (#1407). */
  protections: ActiveProtection[];
}

export interface CorruptionAttempt {
  tick: number;
  target: CorruptionTarget;
  cost: number;
  success: boolean;
}

export function createCorruptionState(): CorruptionState {
  return { level: 0, attempts: [], mafiaUnlocked: false, protections: [] };
}

// ── Operations ──

export interface CorruptionResult {
  success: boolean;
  cost: number;
  scandalTriggered: boolean;
  mafiaJustUnlocked: boolean;
  /** Protection granted by a successful bribe (#1407). */
  protection?: ActiveProtection;
  /** Exposure risk reduction from a witness bribe (0-1) (#1407). */
  exposureReduction?: number;
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

  // Success moves the meter by the target's delta and grants its protection.
  // A failure's meter change is applied by applyBribeFailure, nothing is granted.
  if (!success) {
    return { success, cost, scandalTriggered: true, mafiaJustUnlocked: false };
  }
  const profile = BRIBE_PROFILES[target];
  const { mafiaJustUnlocked } = applyCorruptionDelta(state, profile.corruptionDelta);
  const protection = grantProtection(state.protections, target, tick) ?? undefined;
  const exposureReduction = profile.effect.exposureReduction;

  return {
    success,
    cost,
    scandalTriggered: false,
    mafiaJustUnlocked,
    ...(protection ? { protection } : {}),
    ...(exposureReduction ? { exposureReduction } : {}),
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
 * Shift corruption level by delta (clamped to 0..CORRUPTION_MAX); latches mafiaUnlocked at threshold.
 * Non-finite delta is a no-op. Returns whether this call unlocked the mafia.
 */
export function applyCorruptionDelta(
  state: CorruptionState,
  delta: number,
): { mafiaJustUnlocked: boolean } {
  if (!Number.isFinite(delta)) return { mafiaJustUnlocked: false };
  state.level = Math.min(CORRUPTION_MAX, Math.max(0, state.level + delta));
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
