// BlastSimulator2026 — Progression probe: pure helpers for the ladder strategy and grade-window verdicts (#1945)

import type { VehicleTier } from '../../src/core/entities/Vehicle.js';

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

/** Largest square grid and per-hole charge within `limit`, never exceeding either. */
export function limitSizedShot(_limit: PermitLimit, base: LadderShot, _maxDiameterM: number): LadderShot {
  // TODO: implement
  return base;
}

/** Widest hole diameter not above the rig cap; the smallest option if none fits. */
export function pickDiameter(_rigMaxDiameterM: number): number {
  // TODO: implement
  return 0;
}

/** Tier unlocked by grade, and for tier 2/3 a ramp at or under the slope limit exists. */
export function mayBuyVehicleTier(_tier: VehicleTier, _mineGrade: number, _rampSlopeRatio: number | null): boolean {
  // TODO: implement
  return false;
}

/** First affordable catalog entry not owned, keeping `reserve` cash back; null if none. */
export function nextBuy(
  _cash: number, _reserve: number, _catalog: readonly BuyRule[], _owned: ReadonlySet<string>,
): BuyRule | null {
  // TODO: implement
  return null;
}

/** True when the pit wall is taller than the stability limit. */
export function shouldBench(_wallHeightM: number, _stabilityLimitM: number): boolean {
  // TODO: implement
  return false;
}

/** True when the grade targets are met, no application is pending and the fee fits above the reserve. */
export function shouldApplyPermit(
  _targetsMet: boolean, _pending: boolean, _cash: number, _fee: number, _reserve: number,
): boolean {
  // TODO: implement
  return false;
}

/** One verdict per window; a grade absent from `reached` is 'missed' with a null tick. */
export function gradeVerdicts(
  _reached: Readonly<Record<number, number>>,
  _windows: Readonly<Record<number, readonly [number, number]>>,
): GradeVerdict[] {
  // TODO: implement
  return [];
}
