// BlastSimulator2026 — Blast plan composition
// Combines drill plan + charge plan + sequence into a complete blast definition.

import type { DrillHole } from './DrillPlan.js';
import type { HoleCharge } from './ChargePlan.js';
import { isBuildingFootprintCell, type FootprintOccupant } from '../entities/Building.js';

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
        issue: loadingHoleIds?.has(hole.id)
          ? 'blast.validation.charge_loading'
          : 'blast.validation.missing_charge',
      });
    }
    if (plan.delays[hole.id] === undefined) {
      errors.push({ holeId: hole.id, issue: 'blast.validation.missing_delay' });
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
  holes: ReadonlyArray<Pick<DrillHole, 'id' | 'x' | 'z'>>,
  occupants: ReadonlyArray<FootprintOccupant>,
): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const hole of holes) {
    const ax = Math.floor(hole.x);
    const az = Math.floor(hole.z);
    for (const building of occupants) {
      if (isBuildingFootprintCell(building, ax, az)) {
        errors.push({ holeId: hole.id, issue: 'blast.validation.protected_position' });
        break; // one error per hole is enough
      }
    }
  }
  return errors;
}

/**
 * Ids of `cells` whose column lies under a building or construction-site
 * footprint (#1359). Takes the occupant list so callers choose the source.
 */
export function coveredByFootprint(
  cells: ReadonlyArray<Pick<DrillHole, 'id' | 'x' | 'z'>>,
  occupants: ReadonlyArray<FootprintOccupant>,
): Set<string> {
  if (occupants.length === 0) return new Set<string>();
  return new Set(checkProtectedPositions(cells, occupants).map(e => e.holeId));
}

/**
 * Split candidate cells into those clear of every footprint and the count of
 * those under one (#1359). Order of the clear cells is preserved.
 */
export function partitionByFootprint<T extends { x: number; z: number }>(
  cells: ReadonlyArray<T>,
  occupants: ReadonlyArray<FootprintOccupant>,
): { clear: T[]; skipped: number } {
  const covered = coveredByFootprint(cells.map((c, i) => ({ id: String(i), x: c.x, z: c.z })), occupants);
  return { clear: cells.filter((_, i) => !covered.has(String(i))), skipped: covered.size };
}
