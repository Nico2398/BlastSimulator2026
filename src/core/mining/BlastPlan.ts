// BlastSimulator2026 — Blast plan composition
// Combines drill plan + charge plan into a complete blast definition.

import type { DrillHole } from './DrillPlan.js';
import type { HoleCharge } from './ChargePlan.js';
import { DRILL_GRID_DEFAULT_SPACING_M } from '../config/balance.js';
import { getBuildingDef, isBuildingFootprintCell, warehouseStockKg, type Building, type BuildingType, type FootprintOccupant } from '../entities/Building.js';

export interface BlastPlan {
  holes: DrillHole[];
  charges: Record<string, HoleCharge>;
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

/** Buildings within reach of the planned holes (#2021): any footprint cell inside the holes' bbox grown by `marginM`. */
export function buildingsInBlastReach(
  holes: ReadonlyArray<Pick<DrillHole, 'x' | 'z'>>,
  buildings: ReadonlyArray<Pick<Building, 'id' | 'type' | 'tier' | 'x' | 'z' | 'storedExplosives'>>,
  marginM: number = holePatternSpacing(holes),
): BuildingAtRisk[] {
  if (holes.length === 0 || buildings.length === 0) return [];
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const h of holes) {
    const hx = Math.floor(h.x);
    const hz = Math.floor(h.z);
    if (hx < minX) minX = hx;
    if (hx > maxX) maxX = hx;
    if (hz < minZ) minZ = hz;
    if (hz > maxZ) maxZ = hz;
  }
  minX -= marginM; maxX += marginM; minZ -= marginM; maxZ += marginM;
  const result: BuildingAtRisk[] = [];
  for (const b of buildings) {
    const inReach = getBuildingDef(b.type, b.tier).footprint.some(([dx, dz]) => {
      const cx = b.x + dx;
      const cz = b.z + dz;
      return cx >= minX && cx <= maxX && cz >= minZ && cz <= maxZ;
    });
    if (!inReach) continue;
    result.push({
      buildingId: b.id, type: b.type, x: b.x, z: b.z,
      stockKg: b.type === 'explosive_warehouse' ? warehouseStockKg(b) : 0,
    });
  }
  return result.sort((a, c) => a.buildingId - c.buildingId);
}
