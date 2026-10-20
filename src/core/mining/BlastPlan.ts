// BlastSimulator2026 — Blast plan composition
// Combines drill plan + charge plan into a complete blast definition.

import type { DrillHole } from './DrillPlan.js';
import type { HoleCharge } from './ChargePlan.js';
import { computeInitialEnergy } from './BlastCalc.js';
import { DRILL_GRID_DEFAULT_SPACING_M, BLAST_REACH_M_PER_SQRT_ENERGY } from '../config/balance.js';
import { computeDangerZone } from '../entities/Zone.js';
import { getBuildingDef, isBuildingFootprintCell, warehouseStockKg, type Building, type BuildingType, type FootprintOccupant } from '../entities/Building.js';

export interface BlastPlan {
  holes: DrillHole[];
  charges: Record<string, HoleCharge>;
}

/** True when at least one hole of the plan carries a charge. */
export function hasChargedHole(plan: BlastPlan): boolean {
  return plan.holes.some(h => plan.charges[h.id] !== undefined);
}

export interface ValidationError {
  holeId: string;
  issue: string;
  /** Tick a waiting explosive delivery arrives, when the issue is a delivery wait (#1966). */
  arrivalTick?: number;
}

/**
 * Validate that a blast plan is complete (all holes charged).
 * `loadingHoleIds`, when given, is the set of holes whose charge order has
 * been placed but not yet loaded (#554) — a hole with no landed charge whose
 * id is in this set gets a distinct "still loading" issue instead of the
 * generic "missing charge" one. `deliveryArrivalByHole` maps holes whose
 * explosives are still in transit to their arrival tick (#1966); those get a
 * delivery-wait issue carrying that tick, ahead of the loading check.
 */
export function validateBlastPlan(
  plan: BlastPlan,
  loadingHoleIds?: ReadonlySet<string>,
  deliveryArrivalByHole?: ReadonlyMap<string, number>,
): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const hole of plan.holes) {
    if (!plan.charges[hole.id]) {
      const arrivalTick = deliveryArrivalByHole?.get(hole.id);
      if (arrivalTick !== undefined) {
        errors.push({ holeId: hole.id, issue: 'blast.validation.charge_awaiting_delivery', arrivalTick });
        continue;
      }
      errors.push({
        holeId: hole.id,
        issue: loadingHoleIds?.has(hole.id)
          ? 'blast.validation.charge_loading'
          : 'blast.validation.missing_charge',
      });
    }
  }

  return errors;
}

/** Assemble a blast plan from current GameState fields. */
export function assembleBlastPlan(
  holes: DrillHole[],
  charges: Record<string, HoleCharge>,
): BlastPlan {
  return { holes, charges };
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

/** A building inside a planned blast's reach, with the explosive stock it holds (#2021). */
export interface BuildingAtRisk {
  buildingId: number;
  type: BuildingType;
  x: number;
  z: number;
  stockKg: number;
}

const SPACING_EPSILON = 1e-6;

/** Smallest gap between distinct values, or null with fewer than two. */
function smallestGap(values: number[]): number | null {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  let best: number | null = null;
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i]! - sorted[i - 1]!;
    if (gap > SPACING_EPSILON && (best === null || gap < best)) best = gap;
  }
  return best;
}

/** Hole-grid pitch: larger of the smallest x gap and smallest z gap; default spacing when undetermined. */
export function holePatternSpacing(holes: ReadonlyArray<Pick<DrillHole, 'x' | 'z'>>): number {
  const gx = smallestGap(holes.map(h => h.x));
  const gz = smallestGap(holes.map(h => h.z));
  if (gx === null && gz === null) return DRILL_GRID_DEFAULT_SPACING_M;
  return Math.max(gx ?? 0, gz ?? 0);
}

/**
 * Metres a hole's charge reaches for the pre-flight building warning (#2030):
 * BLAST_REACH_M_PER_SQRT_ENERGY * sqrt(initial energy). Uncharged holes reach 0.
 * Flooding is ignored, which keeps the estimate conservative.
 */
export function holeBlastReachM(charge: HoleCharge | undefined, holeDepth: number): number {
  if (!charge) return 0;
  return BLAST_REACH_M_PER_SQRT_ENERGY * Math.sqrt(computeInitialEnergy(charge, holeDepth));
}

/**
 * Buildings within reach of the planned holes (#2021), shown as pre-flight warnings.
 *
 * Tier-0 prediction rule: a building is at risk when any footprint cell lies inside the
 * holes' bounding box grown by `marginM`. The default margin is the largest charge reach
 * over the holes (uncharged = 0); an explicit `marginM` overrides it. Holes are floored to
 * their grid cell first. The rule is deliberately conservative: it can flag a building in
 * the margin that would survive the blast, but never misses one inside the box.
 */
export function buildingsInBlastReach(
  holes: ReadonlyArray<Pick<DrillHole, 'id' | 'x' | 'z' | 'depth'>>,
  charges: Readonly<Record<string, HoleCharge>>,
  buildings: ReadonlyArray<Pick<Building, 'id' | 'type' | 'tier' | 'x' | 'z' | 'storedExplosives'>>,
  marginM: number = holes.reduce((max, h) => Math.max(max, holeBlastReachM(charges[h.id], h.depth)), 0),
): BuildingAtRisk[] {
  if (buildings.length === 0) return [];
  const reach = computeDangerZone(holes.map(h => ({ x: Math.floor(h.x), z: Math.floor(h.z) })), marginM);
  if (reach === null) return [];
  const result: BuildingAtRisk[] = [];
  for (const b of buildings) {
    const inReach = getBuildingDef(b.type, b.tier).footprint.some(([dx, dz]) => {
      const cx = b.x + dx;
      const cz = b.z + dz;
      return cx >= reach.x1 && cx <= reach.x2 && cz >= reach.z1 && cz <= reach.z2;
    });
    if (!inReach) continue;
    result.push({
      buildingId: b.id, type: b.type, x: b.x, z: b.z,
      stockKg: b.type === 'explosive_warehouse' ? warehouseStockKg(b) : 0,
    });
  }
  return result.sort((a, c) => a.buildingId - c.buildingId);
}
