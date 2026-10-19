// BlastSimulator2026 — Per-plan hole diameter
// Charge capacity, rig requirement and input normalisation for a hole's diameter (#1934).

import {
  CHARGE_KG_PER_METRE,
  DRILL_HOLE_DEFAULT_DIAMETER_M,
  DRILL_HOLE_DIAMETER_OPTIONS_M,
  DRILL_HOLE_DIAMETER_SNAP_TOLERANCE_M,
  DRILL_RIG_MAX_DIAMETER_M,
} from '../config/balance.js';
import type { VehicleTier } from '../entities/Vehicle.js';

/** Cross-section ratio of a hole against the default diameter. */
export function holeCapacityFactor(diameterM: number = DRILL_HOLE_DEFAULT_DIAMETER_M): number {
  if (diameterM === DRILL_HOLE_DEFAULT_DIAMETER_M) return 1;
  const ratio = diameterM / DRILL_HOLE_DEFAULT_DIAMETER_M;
  return ratio * ratio;
}

/** Kg of explosive per metre of a hole of `diameterM`; scales with cross-section. */
export function chargeKgPerMetre(diameterM: number = DRILL_HOLE_DEFAULT_DIAMETER_M): number {
  return CHARGE_KG_PER_METRE * holeCapacityFactor(diameterM);
}

const RIG_TIERS_ASC = Object.keys(DRILL_RIG_MAX_DIAMETER_M).map(Number).sort((a, b) => a - b) as VehicleTier[];

/** Lowest drill rig tier able to bore `diameterM`. */
export function minRigTierForDiameter(diameterM: number): VehicleTier {
  return (
    RIG_TIERS_ASC.find(t => DRILL_RIG_MAX_DIAMETER_M[t] + DRILL_HOLE_DIAMETER_SNAP_TOLERANCE_M >= diameterM) ??
    RIG_TIERS_ASC[RIG_TIERS_ASC.length - 1]!
  );
}

/** Raw input (metres if < 1, else millimetres) snapped to an allowed option; null when none matches. */
export function normaliseHoleDiameter(raw: number): number | null {
  if (!Number.isFinite(raw) || raw <= 0) return null;
  const metres = raw < 1 ? raw : raw / 1000;
  return (
    DRILL_HOLE_DIAMETER_OPTIONS_M.find(o => Math.abs(o - metres) <= DRILL_HOLE_DIAMETER_SNAP_TOLERANCE_M) ?? null
  );
}
