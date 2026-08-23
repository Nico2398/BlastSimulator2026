// BlastSimulator2026 — Score system
// Four scores (0-100) that influence events and contracts.
// Updated each tick based on current game state.

import type { ScoreId } from '../entities/Building.js';
import { getBuildingScoreEffects, type BuildingState } from '../entities/Building.js';
import { SCORE_DECAY_RATE } from '../config/balance.js';

// ── Score state ──

export interface ScoreState {
  wellBeing: number;
  safety: number;
  ecology: number;
  nuisance: number;
  /**
   * Per-tick pull toward the neutral (50) midpoint, applied by `applyDecay`
   * below. Carried on the state (rather than read from a single module-level
   * constant) so each level's own `LevelDef.scoreDecayRate` — tutorial_pit's
   * 0.01, documented "player-proof" — actually reaches `updateScores` instead
   * of every level sharing the same hardcoded rate regardless of what its own
   * definition declared (#555 tutorial worker-revolt fix).
   */
  decayRate: number;
}

/** Starting scores — neutral. `decayRate` defaults to the global constant when the caller has no level-specific override. */
export function createScoreState(decayRate: number = SCORE_DECAY_RATE): ScoreState {
  return { wellBeing: 50, safety: 50, ecology: 50, nuisance: 50, decayRate };
}

// ── Score inputs ──

/** Data collected from game state to compute score deltas. */
export interface ScoreInputs {
  buildings: BuildingState;
  /** Average employee morale (0-100). */
  avgMorale: number;
  /** Number of accidents this period. */
  recentAccidents: number;
  /** Whether safety equipment investment exists. */
  hasSafetyEquipment: boolean;
  /** Max vibration from recent blasts (mm/s). */
  maxRecentVibration: number;
  /** Number of employees. */
  employeeCount: number;
}

// ── Update logic ──

/**
 * Update scores based on current inputs. Mutates state.
 * Each tick, building effects are applied and then scores decay towards neutral.
 */
export function updateScores(state: ScoreState, inputs: ScoreInputs): void {
  const buildingEffects = getBuildingScoreEffects(inputs.buildings);

  // ── Well-being ──
  // Buildings + employee morale
  let wbDelta = buildingEffects.wellBeing * 0.1;
  wbDelta += (inputs.avgMorale - 50) * 0.02;
  state.wellBeing = clampScore(state.wellBeing + wbDelta);

  // ── Safety ──
  // Buildings + accidents + equipment
  let sfDelta = buildingEffects.safety * 0.1;
  sfDelta -= inputs.recentAccidents * 5; // Each accident is a big hit
  if (inputs.hasSafetyEquipment) sfDelta += 0.3;
  state.safety = clampScore(state.safety + sfDelta);

  // ── Ecology ──
  // Neutral by default, worsened by blasting frequency
  let ecDelta = buildingEffects.ecology * 0.1;
  ecDelta -= inputs.maxRecentVibration * 0.01; // Vibrations worsen ecology
  state.ecology = clampScore(state.ecology + ecDelta);

  // ── Nuisance ──
  // Affected by vibrations and noise (from blasts)
  let nuDelta = buildingEffects.nuisance * 0.1;
  nuDelta -= inputs.maxRecentVibration * 0.02; // Vibrations increase nuisance
  state.nuisance = clampScore(state.nuisance + nuDelta);

  // Apply decay towards neutral (50), at this state's own per-level rate.
  state.wellBeing = applyDecay(state.wellBeing, state.decayRate);
  state.safety = applyDecay(state.safety, state.decayRate);
  state.ecology = applyDecay(state.ecology, state.decayRate);
  state.nuisance = applyDecay(state.nuisance, state.decayRate);
}

/** Record an accident — immediate safety score hit. */
export function recordAccident(state: ScoreState): void {
  state.safety = clampScore(state.safety - 10);
}

/** Record a blast vibration event — immediate nuisance hit. */
export function recordVibration(state: ScoreState, vibrationMmS: number): void {
  state.nuisance = clampScore(state.nuisance - vibrationMmS * 0.05);
  state.ecology = clampScore(state.ecology - vibrationMmS * 0.02);
}

/**
 * Record a building destruction event — immediate score penalties.
 * For explosive warehouses, safety and well-being are hit harder.
 */
export function recordBuildingDestruction(state: ScoreState, isExplosiveWarehouse: boolean): void {
  state.safety = clampScore(state.safety - 15);
  state.ecology = clampScore(state.ecology - 8);
  if (isExplosiveWarehouse) {
    state.safety = clampScore(state.safety - 10);
    state.wellBeing = clampScore(state.wellBeing - 5);
  }
}

/** Record safety equipment investment — immediate safety boost. */
export function recordSafetyInvestment(state: ScoreState, amount: number): void {
  // $1000 investment → +2 safety
  const boost = Math.min(10, amount / 500);
  state.safety = clampScore(state.safety + boost);
}

// ── Helpers ──

export function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function applyDecay(value: number, rate: number): number {
  // `value > 0` is deliberate, not a gap: a score driven all the way to
  // exactly 0 (or 100) by a strongly negative/positive delta stays there
  // instead of drifting back toward neutral on its own — the mechanic
  // WorkerRevolt.ts's and EcologicalDisaster's own sustained-zero-tick
  // counters depend on to ever fire at all (see
  // level1-lose-revolt/level1-lose-ecology.integration.test.ts, which force a
  // score to exactly 0 and require it to *stay* there). Reverted from a
  // version of this fix that made 0 recoverable — investigated for #555's
  // tutorial worker-revolt regression, but it silently broke every other
  // level's own revolt/ecology lose condition, which relies on precisely
  // this pinning. The actual #555 fix is `ScoreState.decayRate` (this file)
  // sourced from the level's own `LevelDef.scoreDecayRate` instead of one
  // hardcoded global rate — it keeps the tutorial's own well-being buffer
  // (built up before the long box-cut/drill-plan stretch) draining slowly
  // enough that the crisis never actually reaches this floor in the first
  // place, rather than changing what happens once something does.
  if (value > 50) return Math.max(50, value - rate);
  if (value > 0 && value < 50) return Math.min(50, value + rate);
  return value;
}

export type { ScoreId };
