// BlastSimulator2026 — Progression probe: pure helpers for the ladder strategy and grade-window verdicts (#1945)

import type { GameState } from '../../src/core/state/GameState.js';
import type { VehicleTier } from '../../src/core/entities/Vehicle.js';
import {
  DRILL_HOLE_DIAMETER_OPTIONS_M,
  DRILL_HOLE_DIAMETER_SNAP_TOLERANCE_M,
} from '../../src/core/config/balance.js';

/** What a permit allows per blast: total charge (kg) and pattern area (m², one spacing × burden cell per hole). */
export interface PermitLimit { maxChargeKg: number; maxAreaM2: number }

export interface LadderShot {
  rows: number;
  cols: number;
  spacing: number;
  depth: number;
  kgPerHole: number;
  stemming: number;
  diameterM: number;
}

/** A purchasable catalog entry the ladder may buy, in priority order. */
export interface BuyRule { id: string; cost: number }

export interface GradeVerdict {
  grade: number;
  tick: number | null;
  window: readonly [number, number];
  status: 'in' | 'early' | 'late' | 'missed';
}

/**
 * Target tick window [min, max] in which each tier should be reached, keyed `<grade>.<tier>` like the probe's
 * `tierReachedTick` (G0..G3, tiers 1-3; G0.1 is the start). Calibrated on the `ladder` strategy at the reference site
 * (#2295): the measured G0.2 / G0.3 / G1 / G2 ticks (501, 666, 1046, 1648) sit inside their windows; G2.2 and later are
 * provisional, scaled from the tier ore and fee targets, until the ladder strategy plays past G2 (TODO(#2303)).
 * A tier cleared in the same tick as the one before it (an over-delivered site) reports only the last, so a skipped
 * tier reads 'missed' in the report.
 */
export const TIER_TARGET_WINDOWS: Readonly<Record<string, readonly [number, number]>> = {
  '0.2': [300, 900],
  '0.3': [500, 1200],
  '1.1': [800, 1600],
  '1.2': [1000, 2400],
  '1.3': [1200, 3000],
  '2.1': [1400, 3200],
  '2.2': [2500, 5500],
  '2.3': [3500, 8000],
  '3.1': [4500, 10000],
  '3.2': [6000, 14000],
  '3.3': [8000, 20000],
};

/** Target tick window for reaching each grade G1..G3: the window of its first tier. */
export const GRADE_TARGET_WINDOWS: Readonly<Record<number, readonly [number, number]>> = {
  1: TIER_TARGET_WINDOWS['1.1']!,
  2: TIER_TARGET_WINDOWS['2.1']!,
  3: TIER_TARGET_WINDOWS['3.1']!,
};

/** Per-hole charge is kept to this resolution (kg) so the console command parses it back exactly. */
const KG_RESOLUTION = 10;
/** Smallest per-hole charge (kg) a shot is sized for; a limit too small for it shrinks the grid. */
const MIN_KG_PER_HOLE = 1;

/** Floors a per-hole charge to KG_RESOLUTION so the console command parses it back exactly. */
export function floorToKgResolution(kg: number): number {
  return Math.floor(kg * KG_RESOLUTION) / KG_RESOLUTION;
}

/** Holes of a square `spacingM` mesh whose cells fit the permit area; at least 1. */
function holesWithinArea(limit: PermitLimit, spacingM: number): number {
  return Math.max(1, Math.floor(limit.maxAreaM2 / (spacingM * spacingM)));
}

/** Largest square grid and per-hole charge within `limit`, never exceeding either. */
export function limitSizedShot(limit: PermitLimit, base: LadderShot, maxDiameterM: number): LadderShot {
  const holes = Math.max(1, Math.min(holesWithinArea(limit, base.spacing), Math.floor(limit.maxChargeKg / MIN_KG_PER_HOLE)));
  const side = Math.max(1, Math.floor(Math.sqrt(holes)));
  const perHole = floorToKgResolution(limit.maxChargeKg / (side * side));
  return { ...base, rows: side, cols: side, kgPerHole: perHole, diameterM: pickDiameter(maxDiameterM) };
}

/**
 * Hole spacing (m) at which holes charged with `kgPerHole` break one floor between them instead of a shaft round each
 * hole. Measured with krackle in 10-11 m holes on the seed-42 desert sandbox (#2091): 7.5 and 10 kg in 0.089 m holes
 * break a flat floor 2 m apart and leave full-height ridges 3 and 4 m apart; 20 kg in 0.127 m holes breaks one 4 m apart.
 */
export function holeSpacingForChargeM(kgPerHole: number): number {
  return Math.min(MAX_HOLE_SPACING_M, Math.max(MIN_HOLE_SPACING_M, Math.floor(kgPerHole / KG_PER_SPACING_M)));
}

/** Charge (kg) per metre of spacing a hole's breakage spans: 10 kg holes 2 m apart, 20 kg holes 4 m apart. */
const KG_PER_SPACING_M = 5;
const MIN_HOLE_SPACING_M = 2;
const MAX_HOLE_SPACING_M = 4;

/** Side of the largest square pattern of holes `spacingM` apart, each charged with `kgPerHole`, that `limit` allows; at least 1. */
export function fullHoleSide(limit: PermitLimit, kgPerHole: number, spacingM: number): number {
  const holes = Math.min(holesWithinArea(limit, spacingM), Math.floor(limit.maxChargeKg / kgPerHole));
  return Math.max(1, Math.floor(Math.sqrt(holes)));
}

/** Widest hole diameter not above the rig cap; the smallest option if none fits. */
export function pickDiameter(rigMaxDiameterM: number): number {
  const options = [...DRILL_HOLE_DIAMETER_OPTIONS_M].sort((a, b) => a - b);
  const fitting = options.filter(o => o <= rigMaxDiameterM + DRILL_HOLE_DIAMETER_SNAP_TOLERANCE_M);
  return fitting.length > 0 ? fitting[fitting.length - 1]! : options[0]!;
}

/** Tier the dealer sells: its quest is done (or the site has none); every tier climbs the same 20° so no ramp gates it (#2045). */
export function mayBuyVehicleTier(_tier: VehicleTier, _state: Pick<GameState, 'quests'>): boolean {
  throw new Error('not implemented');
}

/** First affordable catalog entry not owned, keeping `reserve` cash back; null if none. */
export function nextBuy(
  cash: number, reserve: number, catalog: readonly BuyRule[], owned: ReadonlySet<string>,
): BuyRule | null {
  return catalog.find(r => !owned.has(r.id) && r.cost <= cash - reserve) ?? null;
}

/** True when the pit wall is taller than the stability limit. */
export function shouldBench(wallHeightM: number, stabilityLimitM: number): boolean {
  return wallHeightM > stabilityLimitM;
}

/** True when the grade targets are met, no application is pending and the fee fits above the reserve. */
export function shouldApplyPermit(
  targetsMet: boolean, pending: boolean, cash: number, fee: number, reserve: number,
): boolean {
  return targetsMet && !pending && cash >= fee + reserve;
}

/** Where a tick falls against a window (inclusive bounds); a null tick is 'missed'. */
export function windowStatus(tick: number | null, window: readonly [number, number]): GradeVerdict['status'] {
  if (tick === null) return 'missed';
  return tick < window[0] ? 'early' : tick > window[1] ? 'late' : 'in';
}

/** One verdict per window; a grade absent from `reached` is 'missed' with a null tick. */
export function gradeVerdicts(
  reached: Readonly<Record<number, number>>,
  windows: Readonly<Record<number, readonly [number, number]>>,
): GradeVerdict[] {
  return Object.keys(windows).map(Number).sort((a, b) => a - b).map((grade): GradeVerdict => {
    const window = windows[grade]!;
    const tick = reached[grade] ?? null;
    return { grade, tick, window, status: windowStatus(tick, window) };
  });
}
