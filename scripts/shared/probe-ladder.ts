// BlastSimulator2026 — Progression probe: pure helpers for the ladder strategy and grade-window verdicts (#1945)

import type { VehicleTier } from '../../src/core/entities/Vehicle.js';
import {
  DRILL_HOLE_DIAMETER_OPTIONS_M,
  DRILL_HOLE_DIAMETER_SNAP_TOLERANCE_M,
  VEHICLE_TIER_MAX_SLOPE_DEGREES,
  VEHICLE_TIER_UNLOCK_GRADE,
} from '../../src/core/config/balance.js';

export interface PermitLimit { maxChargeKg: number; maxHoles: number }

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

/** Target tick window [min, max] in which each grade should be reached. */
export const GRADE_TARGET_WINDOWS: Readonly<Record<number, readonly [number, number]>> = {
  3: [8000, 14000],
  4: [15000, 25000],
  5: [30000, 45000],
};

/** Per-hole charge is kept to this resolution (kg) so the console command parses it back exactly. */
const KG_RESOLUTION = 10;
/** Smallest per-hole charge (kg) a shot is sized for; a limit too small for it shrinks the grid. */
const MIN_KG_PER_HOLE = 1;

/** Largest square grid and per-hole charge within `limit`, never exceeding either. */
export function limitSizedShot(limit: PermitLimit, base: LadderShot, maxDiameterM: number): LadderShot {
  const holes = Math.max(1, Math.min(limit.maxHoles, Math.floor(limit.maxChargeKg / MIN_KG_PER_HOLE)));
  const side = Math.max(1, Math.floor(Math.sqrt(holes)));
  const perHole = Math.floor((limit.maxChargeKg / (side * side)) * KG_RESOLUTION) / KG_RESOLUTION;
  return { ...base, rows: side, cols: side, kgPerHole: perHole, diameterM: pickDiameter(maxDiameterM) };
}

/** Widest hole diameter not above the rig cap; the smallest option if none fits. */
export function pickDiameter(rigMaxDiameterM: number): number {
  const options = [...DRILL_HOLE_DIAMETER_OPTIONS_M].sort((a, b) => a - b);
  const fitting = options.filter(o => o <= rigMaxDiameterM + DRILL_HOLE_DIAMETER_SNAP_TOLERANCE_M);
  return fitting.length > 0 ? fitting[fitting.length - 1]! : options[0]!;
}

/** Tier unlocked by grade, and for tier 2/3 a ramp at or under the slope limit exists. */
export function mayBuyVehicleTier(tier: VehicleTier, mineGrade: number, rampSlopeRatio: number | null): boolean {
  if (mineGrade < VEHICLE_TIER_UNLOCK_GRADE[tier]) return false;
  if (tier === 1) return true;
  return rampSlopeRatio !== null && rampSlopeRatio <= Math.tan(VEHICLE_TIER_MAX_SLOPE_DEGREES[tier] * Math.PI / 180);
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

/** One verdict per window; a grade absent from `reached` is 'missed' with a null tick. */
export function gradeVerdicts(
  reached: Readonly<Record<number, number>>,
  windows: Readonly<Record<number, readonly [number, number]>>,
): GradeVerdict[] {
  return Object.keys(windows).map(Number).sort((a, b) => a - b).map((grade): GradeVerdict => {
    const window = windows[grade]!;
    const tick = reached[grade] ?? null;
    if (tick === null) return { grade, tick, window, status: 'missed' };
    return { grade, tick, window, status: tick < window[0] ? 'early' : tick > window[1] ? 'late' : 'in' };
  });
}
