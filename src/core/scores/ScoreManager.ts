// BlastSimulator2026 — Score system
// Four scores (0-100) that influence events and contracts.
// Updated each tick based on current game state.

import type { ScoreId } from '../entities/Building.js';
import { getBuildingScoreEffects, type BuildingState } from '../entities/Building.js';
import {
  ECOLOGY_DUST_PER_TONNE_PER_TICK,
  ECOLOGY_DUST_SETTLED_PER_TONNE_PER_TICK,
  ECOLOGY_DUST_SETTLE_HALF_LIFE_TICKS,
  SCORE_DECAY_RATE,
  WB_BUILDING_GAIN,
  WB_MORALE_GAIN_PER_POINT,
  WB_MORALE_LOSS_PER_POINT,
  WB_HEADROOM_SPAN,
  WB_OVERWORK_DRAG_MAX,
  WB_CROWDING_DRAG_MAX,
  WB_ACCIDENT_DRAG,
} from '../config/balance.js';

// ── Score state ──

export interface ScoreState {
  wellBeing: number;
  safety: number;
  ecology: number;
  /** Neighbour relations, 0-100, high = good (internal key kept as nuisance). */
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
  /** Airborne dust from loose rock that has not yet settled (kg-equivalent). */
  freshDustKg: number;
  /** Loose-rock mass seen on the previous tick; undefined (old save) means no pulse. */
  lastLooseRockKg: number | undefined;
}

/** Starting scores — neutral. `decayRate` defaults to the global constant when the caller has no level-specific override. */
export function createScoreState(decayRate: number = SCORE_DECAY_RATE): ScoreState {
  return { wellBeing: 50, safety: 50, ecology: 50, nuisance: 50, decayRate, freshDustKg: 0, lastLooseRockKg: 0 };
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
  /** Mass of loose rock lying on the ground (kg). */
  looseRockKg: number;
  /** Total beds across operating living quarters. */
  bedCapacity: number;
  /** Mean fatigue strain (0-1) of living, non-injured crew. */
  crewFatigueStrain: number;
}

// ── Update logic ──

const DUST_SETTLE_RETENTION = Math.pow(0.5, 1 / ECOLOGY_DUST_SETTLE_HALF_LIFE_TICKS);

/**
 * Per-tick ecology loss from loose rubble. Advances `state.freshDustKg` (the share of the rubble a
 * recent blast threw up, settling with a half-life) and `state.lastLooseRockKg`. Fresh rock costs
 * the high rate, settled rock the low one. No cap.
 */
function advanceDustAndEcologyLoss(state: ScoreState, looseKg: number): number {
  const loose = Number.isFinite(looseKg) && looseKg > 0 ? looseKg : 0;
  const prev = state.lastLooseRockKg ?? loose;
  const prevFresh = Number.isFinite(state.freshDustKg) ? state.freshDustKg : 0; // old saves lack the field
  const fresh = Math.min(loose, prevFresh * DUST_SETTLE_RETENTION + Math.max(0, loose - prev));
  state.freshDustKg = fresh;
  state.lastLooseRockKg = loose;
  return (
    (ECOLOGY_DUST_PER_TONNE_PER_TICK * fresh) / 1000 +
    (ECOLOGY_DUST_SETTLED_PER_TONNE_PER_TICK * (loose - fresh)) / 1000
  );
}

/** Non-finite or negative input reads as 0. */
function nonNegative(v: number): number {
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * Per-tick well-being change. Once a Living Quarters is built, gains (building effect, morale above neutral) taper
 * as the score nears 100 so one cheap Living Quarters cannot pin it at the cap; losses (morale below
 * neutral, overwork, crowding, accidents) are unscaled. A negative building effect applies in full.
 */
function wellBeingDelta(wellBeing: number, buildingWb: number, inputs: ScoreInputs): number {
  const bWb = Number.isFinite(buildingWb) ? buildingWb : 0;
  const morale = Number.isFinite(inputs.avgMorale) ? inputs.avgMorale : 50;
  const gain = Math.max(0, bWb * WB_BUILDING_GAIN) + Math.max(0, morale - 50) * WB_MORALE_GAIN_PER_POINT;
  const moraleLoss = Math.max(0, 50 - morale) * WB_MORALE_LOSS_PER_POINT;
  // Taper only once housing exists: a Living Quarters is what pinned the score at the cap. A site
  // with no positive building effect keeps the undamped climb, so its early buffer against a
  // morale crash is unchanged.
  const housed = bWb > 0;
  const headroom = housed ? Math.min(1, Math.max(0, (100 - wellBeing) / WB_HEADROOM_SPAN)) : 1;
  const beds = nonNegative(inputs.bedCapacity);
  const crew = nonNegative(inputs.employeeCount);
  const crowding = beds > 0 && crew > beds ? (crew - beds) / crew : 0;
  const drag =
    WB_OVERWORK_DRAG_MAX * nonNegative(inputs.crewFatigueStrain) +
    WB_CROWDING_DRAG_MAX * crowding +
    WB_ACCIDENT_DRAG * nonNegative(inputs.recentAccidents);
  const negativeBuilding = Math.min(0, bWb * WB_BUILDING_GAIN);
  return gain * headroom + negativeBuilding - moraleLoss - drag;
}

/**
 * Update scores based on current inputs. Mutates state.
 * Each tick, building effects are applied and then scores decay towards neutral.
 */
export function updateScores(state: ScoreState, inputs: ScoreInputs): void {
  const buildingEffects = getBuildingScoreEffects(inputs.buildings);

  // ── Well-being ──
  state.wellBeing = clampScore(state.wellBeing + wellBeingDelta(state.wellBeing, buildingEffects.wellBeing, inputs));

  // ── Safety ──
  // Buildings + accidents + equipment
  let sfDelta = buildingEffects.safety * 0.1;
  sfDelta -= inputs.recentAccidents * 5; // Each accident is a big hit
  if (inputs.hasSafetyEquipment) sfDelta += 0.3;
  state.safety = clampScore(state.safety + sfDelta);

  // ── Ecology ──
  // Spoil heaps (waste management) raise it; vibration and dust from loose
  // rubble on the ground lower it. A net-positive delta can lift a score off 0
  // (heap gain beats dust), so the shutdown warning leaves room to act.
  let ecDelta = buildingEffects.ecology * 0.1;
  ecDelta -= inputs.maxRecentVibration * 0.01; // Vibrations worsen ecology
  ecDelta -= advanceDustAndEcologyLoss(state, inputs.looseRockKg);
  state.ecology = clampScore(state.ecology + ecDelta);

  // ── Neighbour relations (internal key: nuisance) ──
  // Affected by vibrations and noise (from blasts)
  let nuDelta = buildingEffects.nuisance * 0.1;
  nuDelta -= inputs.maxRecentVibration * 0.02; // Vibrations lower neighbour relations
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

/** Record a blast vibration event — immediate neighbour-relations hit. */
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
  // Decay never lifts a score already at exactly 0 (or 100): the sustained-zero counters of
  // WorkerRevolt / EcologicalDisaster need 0 to hold against drift. Only a net-positive delta
  // in updateScores (e.g. spoil heap gain minus dust) lifts it.
  if (value > 50) return Math.max(50, value - rate);
  if (value > 0 && value < 50) return Math.min(50, value + rate);
  return value;
}

export type { ScoreId };
