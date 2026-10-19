// BlastSimulator2026 — Per-plan hole diameter
// Charge capacity, rig requirement and input normalisation for a hole's diameter (#1934).

import { CHARGE_KG_PER_METRE, DRILL_HOLE_DEFAULT_DIAMETER_M } from '../config/balance.js';
import type { VehicleTier } from '../entities/Vehicle.js';

/** Kg of explosive per metre of a hole of `diameterM`; scales with cross-section. */
export function chargeKgPerMetre(_diameterM: number = DRILL_HOLE_DEFAULT_DIAMETER_M): number {
  return CHARGE_KG_PER_METRE;
}

/** Cross-section ratio of a hole against the default diameter. */
export function holeCapacityFactor(_diameterM: number = DRILL_HOLE_DEFAULT_DIAMETER_M): number {
  return 1;
}

/** Lowest drill rig tier able to bore `diameterM`. */
export function minRigTierForDiameter(_diameterM: number): VehicleTier {
  return 1;
}

/** Raw input (metres if < 1, else millimetres) snapped to an allowed option; null when none matches. */
export function normaliseHoleDiameter(_raw: number): number | null {
  return null;
}
