// BlastSimulator2026 — Zone clearing and evacuation
// Players define safety zones before blasting and evacuate entities.

import type { VehicleState } from './Vehicle.js';
import { moveVehicle } from './Vehicle.js';
import type { EmployeeState } from './Employee.js';
import { BLAST_DANGER_MARGIN_M } from '../config/balance.js';

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
 * by `findSafeDestination`. See Evacuation.ts for the real pathfinding-aware
 * evacuation orchestration (interrupting in-progress work, aborting a
 * mid-haul/mid-break vehicle) — this is the low-level move: it queues a
 * destination (a vehicle's target, an employee's walk destination) rather
 * than teleporting anyone. An entity `findSafeDestination` cannot place is
 * left exactly where it stands and reported stranded instead.
 */
export function clearZone(
  zone: ZoneBounds,
  vehicles: VehicleState,
  employees: EmployeeState,
  findSafeDestination: SafeDestinationFinder,
): EvacuationResult {
  const result: EvacuationResult = {
    orderedVehicleIds: [],
    orderedEmployeeIds: [],
    strandedVehicleIds: [],
    strandedEmployeeIds: [],
  };

  for (const v of vehicles.vehicles) {
    if (!isInZone(v.x, v.z, zone)) continue;
    const dest = findSafeDestination(v.x, v.z, zone);
    if (dest) {
      moveVehicle(vehicles, v.id, dest.x, dest.z);
      result.orderedVehicleIds.push(v.id);
    } else {
      result.strandedVehicleIds.push(v.id);
    }
  }

  for (const emp of employees.employees) {
    if (!emp.alive) continue;
    if (!isInZone(emp.x, emp.z, zone)) continue;
    const dest = findSafeDestination(emp.x, emp.z, zone);
    if (dest) {
      emp.destinationX = dest.x;
      emp.destinationZ = dest.z;
      result.orderedEmployeeIds.push(emp.id);
    } else {
      result.strandedEmployeeIds.push(emp.id);
    }
  }

  return result;
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
 * Combined count of alive employees + vehicles standing inside `zone` — the
 * one number the Fire step's occupant list (Fire.ts's `occupants()`), the
 * tutorial-gated console blast refusal, and the tutorial-gated FIRE button
 * reason all report, so they never disagree on how many are still in the way.
 */
export function countZoneOccupants(zone: ZoneBounds, vehicles: VehicleState, employees: EmployeeState): number {
  let count = 0;
  for (const emp of employees.employees) {
    if (emp.alive && isInZone(emp.x, emp.z, zone)) count++;
  }
  for (const v of vehicles.vehicles) {
    if (isInZone(v.x, v.z, zone)) count++;
  }
  return count;
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

/**
 * Whether the live drill plan's own danger zone (computeDangerZone over
 * `drillHoles` at BLAST_DANGER_MARGIN_M — the same box Fire.ts's occupant
 * list and Sound the Horn button use) is clear of every vehicle and living
 * employee. True when no plan exists yet — nothing to be clear of. The one
 * check `window.__gameState`/serializeGameState expose as `dangerZoneClear`,
 * so a scenario's wait_until can prove an evacuation genuinely finished
 * rather than merely that `zone clear` returned (#557).
 */
export function isDangerZoneClear(
  drillHoles: readonly { x: number; z: number }[],
  vehicles: VehicleState,
  employees: EmployeeState,
): boolean {
  const zone = computeDangerZone(drillHoles, BLAST_DANGER_MARGIN_M);
  return zone === null || isZoneClear(zone, vehicles, employees);
}
