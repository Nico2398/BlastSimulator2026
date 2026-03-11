// BlastSimulator2026 — Score system
// Four scores (0-100) that influence events and contracts.
// Updated each tick based on current game state.

import type { ScoreId } from '../entities/Building.js';
import { getBuildingScoreEffects, type BuildingState } from '../entities/Building.js';

// ── Score state ──

export interface ScoreState {
  wellBeing: number;
  safety: number;
  ecology: number;
  nuisance: number;
}

/** Starting scores — neutral. */
export function createScoreState(): ScoreState {
  return { wellBeing: 50, safety: 50, ecology: 50, nuisance: 50 };
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

/** Decay rate: scores drift towards 50 by this much per tick. */
const DECAY_RATE = 0.05;

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

  // Apply decay towards neutral (50)
  state.wellBeing = applyDecay(state.wellBeing, DECAY_RATE);
  state.safety = applyDecay(state.safety, DECAY_RATE);
  state.ecology = applyDecay(state.ecology, DECAY_RATE);
  state.nuisance = applyDecay(state.nuisance, DECAY_RATE);
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

/** Record safety equipment investment — immediate safety boost. */
export function recordSafetyInvestment(state: ScoreState, amount: number): void {
  // $1000 investment → +2 safety
  const boost = Math.min(10, amount / 500);
  state.safety = clampScore(state.safety + boost);
}

// ── Helpers ──

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function applyDecay(value: number, rate: number): number {
  if (value > 50) return Math.max(50, value - rate);
  if (value < 50) return Math.min(50, value + rate);
  return value;
}

export type { ScoreId };
