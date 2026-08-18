// BlastSimulator2026 — Blast plan composition
// Combines drill plan + charge plan + sequence into a complete blast definition.

import type { DrillHole } from './DrillPlan.js';
import type { HoleCharge } from './ChargePlan.js';
import { isBuildingFootprintCell, type BuildingState } from '../entities/Building.js';

export interface BlastPlan {
  holes: DrillHole[];
  charges: Record<string, HoleCharge>;
  delays: Record<string, number>;
}

export interface ValidationError {
  holeId: string;
  issue: string;
}

/**
 * Validate that a blast plan is complete (all holes charged and sequenced).
 * `loadingHoleIds`, when given, is the set of holes whose charge order has
 * been placed but not yet loaded (#554) — a hole with no landed charge whose
 * id is in this set gets a distinct "still loading" issue instead of the
 * generic "missing charge" one.
 */
export function validateBlastPlan(
  plan: BlastPlan,
  loadingHoleIds?: ReadonlySet<string>,
): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const hole of plan.holes) {
    if (!plan.charges[hole.id]) {
      errors.push({
        holeId: hole.id,
        issue: loadingHoleIds?.has(hole.id) ? 'Charge still loading' : 'Missing charge',
      });
    }
    if (plan.delays[hole.id] === undefined) {
      errors.push({ holeId: hole.id, issue: 'Missing sequence delay' });
    }
  }

  return errors;
}

/** Assemble a blast plan from current GameState fields. */
export function assembleBlastPlan(
  holes: DrillHole[],
  charges: Record<string, HoleCharge>,
  delays: Record<string, number>,
): BlastPlan {
  return { holes, charges, delays };
}

/**
 * Check whether any drill holes land under a building footprint.
 * Holes at non-integer coordinates are floored to the nearest grid cell.
 * Returns a ValidationError for each hole that overlaps a building footprint.
 */
export function checkProtectedPositions(
  holes: DrillHole[],
  buildingState: BuildingState,
): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const hole of holes) {
    const ax = Math.floor(hole.x);
    const az = Math.floor(hole.z);
    for (const building of buildingState.buildings) {
      if (isBuildingFootprintCell(building, ax, az)) {
        errors.push({ holeId: hole.id, issue: 'Position is protected by a building' });
        break; // one error per hole is enough
      }
    }
  }
  return errors;
}
