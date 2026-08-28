// BlastSimulator2026 — Zone clearing and evacuation
// Players define safety zones before blasting and evacuate entities.

import type { VehicleState } from './Vehicle.js';
import type { EmployeeState } from './Employee.js';

// ── Zone bounds ──

export interface ZoneBounds {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}

// ── Zone state ──

export interface ZoneState {
  activeZone: ZoneBounds | null;
}

export function createZoneState(): ZoneState {
  return { activeZone: null };
}

// ── Evacuation ──

/** A safe cell an entity can be moved to, outside the danger zone. */
export interface EvacuationDestination { x: number; z: number }

/**
 * Finds a safe destination for an entity currently at (fromX, fromZ),
 * given the zone it must clear. Returns null when no safe cell can be
 * found — the entity is stranded.
 */
export type SafeDestinationFinder = (fromX: number, fromZ: number, zone: ZoneBounds) => EvacuationDestination | null;

/** Outcome of evacuating a zone: who made it out, and who is stranded. */
export interface EvacuationResult {
  orderedVehicleIds: number[];
  orderedEmployeeIds: number[];
  strandedVehicleIds: number[];
  strandedEmployeeIds: number[];
}

// ── Operations ──

/** Define a safety zone. */
export function defineZone(state: ZoneState, bounds: ZoneBounds): void {
  state.activeZone = {
    x1: Math.min(bounds.x1, bounds.x2),
    z1: Math.min(bounds.z1, bounds.z2),
    x2: Math.max(bounds.x1, bounds.x2),
    z2: Math.max(bounds.z1, bounds.z2),
  };
}

/**
 * Clear the zone: order all employees and vehicles out to a safe cell found
 * by `findSafeDestination`. See EvacuateZone.ts / Evacuation.ts for the real
 * pathfinding-aware evacuation orchestration — this is the low-level move.
 */
export function clearZone(
  _zone: ZoneBounds,
  _vehicles: VehicleState,
  _employees: EmployeeState,
  _findSafeDestination: SafeDestinationFinder,
): EvacuationResult {
  throw new Error('not implemented');
}

/** Check if the zone is clear of all entities. */
export function isZoneClear(
  zone: ZoneBounds,
  vehicles: VehicleState,
  employees: EmployeeState,
): boolean {
  for (const v of vehicles.vehicles) {
    if (isInZone(v.x, v.z, zone)) return false;
  }
  for (const emp of employees.employees) {
    if (!emp.alive) continue;
    if (isInZone(emp.x, emp.z, zone)) return false;
  }
  return true;
}

/** Check if a point is inside the zone. */
export function isInZone(x: number, z: number, zone: ZoneBounds): boolean {
  return x >= zone.x1 && x <= zone.x2 && z >= zone.z1 && z <= zone.z2;
}

/**
 * Default danger zone for a drill plan: the holes' bounding box, padded by
 * `marginM` on every side. Null for an empty plan — there is nothing to
 * define a box from. See BLAST_DANGER_MARGIN_M for why this is a heuristic,
 * not a physics-derived exclusion radius.
 */
export function computeDangerZone(holes: readonly { x: number; z: number }[], marginM: number): ZoneBounds | null {
  if (holes.length === 0) return null;
  let x1 = Infinity, z1 = Infinity, x2 = -Infinity, z2 = -Infinity;
  for (const h of holes) {
    x1 = Math.min(x1, h.x); z1 = Math.min(z1, h.z);
    x2 = Math.max(x2, h.x); z2 = Math.max(z2, h.z);
  }
  return { x1: x1 - marginM, z1: z1 - marginM, x2: x2 + marginM, z2: z2 + marginM };
}
