// BlastSimulator2026 — Zone clearing and evacuation
// Players define safety zones before blasting and evacuate entities.

import type { VehicleState } from './Vehicle.js';
import { moveVehicle } from './Vehicle.js';
import type { EmployeeState } from './Employee.js';
import { BLAST_DANGER_MARGIN_M } from '../config/balance.js';
import { findDrivenVehicle } from './EmployeeActivity.js';

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

  const orderedVehicleIdSet = new Set<number>();

  for (const v of vehicles.vehicles) {
    if (!isInZone(v.x, v.z, zone)) continue;
    const dest = findSafeDestination(v.x, v.z, zone);
    if (dest) {
      moveVehicle(vehicles, v.id, dest.x, dest.z);
      result.orderedVehicleIds.push(v.id);
      orderedVehicleIdSet.add(v.id);
    } else {
      result.strandedVehicleIds.push(v.id);
    }
  }

  for (const emp of employees.employees) {
    if (!emp.alive) continue;
    if (!isInZone(emp.x, emp.z, zone)) continue;

    // A seated driver's vehicle-loop outcome above already carries them (the
    // driver-position invariant, #922) — an independent walking destination
    // here would fight the vehicle's own evacuation move. Still counted, per
    // whichever outcome their vehicle got, so they aren't silently dropped
    // from evacuation accounting.
    const drivenVehicle = findDrivenVehicle(emp.id, vehicles.vehicles);
    if (drivenVehicle) {
      if (orderedVehicleIdSet.has(drivenVehicle.id)) {
        result.orderedEmployeeIds.push(emp.id);
      } else {
        result.strandedEmployeeIds.push(emp.id);
      }
      continue;
    }

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
  return isZoneClearOfEmployees(zone, employees);
}

/**
 * Check if the zone is clear of living employees — vehicles not considered.
 * Narrower than isZoneClear, for Evacuation.ts's isEvacuationHoldActive and
 * clearResolvedEvacuationHolds, whose only real concern is a PERSON walking
 * back into danger, not an empty vehicle's continued presence.
 *
 * A vehicle can be legitimately, permanently stranded (findSafeEvacuationCell
 * found no reachable cell for it — the same "genuinely nowhere to go" outcome
 * Evacuation.ts documents for entities, common on a small, not-yet-expanded
 * world where the danger zone's own padding barely fits inside it at all).
 * isZoneClear counting that stranded, driverless machine forever is correct
 * for its own callers (isDangerZoneClear, the tutorial's blast-refusal,
 * Fire.ts's occupant list — a fired blast on top of a vehicle is still a real
 * cost, whether or not anyone is driving it) but would make
 * isEvacuationHoldActive's own "has it become safe to resume yet" check
 * unsatisfiable forever too, permanently blocking completely unrelated queued
 * work (a building order, say) from ever being reclaimed by any employee who
 * DID evacuate successfully — confirmed live via site-expansion.json: two
 * unmanned vehicles stranded in an oversized early-game zone kept a
 * management_office order EVACUATION_HOLD_KEY-blocked forever even after
 * every living employee had either evacuated or died.
 */
export function isZoneClearOfEmployees(
  zone: ZoneBounds,
  employees: EmployeeState,
): boolean {
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

/** True when two axis-aligned ZoneBounds share at least one point. */
function boundsOverlap(a: ZoneBounds, b: ZoneBounds): boolean {
  return a.x1 <= b.x2 && b.x1 <= a.x2 && a.z1 <= b.z2 && b.z1 <= a.z2;
}

/**
 * True when a live, un-fired blast plan (`drillHoles`, at the standard
 * BLAST_DANGER_MARGIN_M — the same margin computeDangerZone's every other
 * caller uses) still overlaps `zone`. The shared "has this zone genuinely
 * stopped being dangerous" check for anything that only wants to know "is it
 * safe to send someone back here" — as opposed to isZoneClear/
 * isZoneClearOfEmployees, which answer a different, narrower question:
 * "is anyone standing here RIGHT NOW."
 *
 * That occupancy-only question is the wrong one for a "safe to return"
 * decision: it reads true the INSTANT an evacuation succeeds — the whole
 * point of ordering one — which is exactly the moment the zone is still MOST
 * dangerous (holes charged and sequenced, nobody has fired yet), not the
 * moment it is actually safe to walk back in. Confirmed live via
 * tutorial-interactive.json (#557 follow-up) at two independent call sites
 * that had each been built against occupancy alone:
 *  - Evacuation.ts's isEvacuationHoldActive/clearResolvedEvacuationHolds: an
 *    interrupted action's hold released the instant the zone read clear of
 *    employees, so the very next evacuee to arrive immediately re-claimed it
 *    and walked back in.
 *  - RestActionHelpers.ts's findNearestBuildingOfType: once every entity
 *    had evacuated (zone genuinely unoccupied, but the blast plan still very
 *    much live), a FRESH need-driven rest request — created after arrival,
 *    with no stale target to blame — routed straight back to the
 *    living_quarters sitting under the still-armed drill grid, because
 *    isZoneClear alone was already satisfied.
 * Both now additionally require this function to read false before treating
 * the zone as resolved.
 *
 * Keyed to the LIVE drill-hole-derived danger box (computeDangerZone — the
 * same one Fire.ts's Sound the Horn/occupant list and `dangerZoneClear`
 * itself already use) rather than to `zone` (typically
 * `state.zone.activeZone`) reading non-null on its own: the player-drawn
 * zone never resets once drawn (defineZone only ever assigns it), so testing
 * for its mere existence would never resolve at all. Testing for overlap
 * with the CURRENT plan instead self-resolves the moment either the blast
 * fires (drillHoles empties, computeDangerZone returns null) or the player
 * starts a new, non-overlapping plan elsewhere on an expanded site
 * (confirmed still true live via site-expansion.json, whose whole premise is
 * a second, far-away drill_plan added moments after the first blast) — never
 * blocking indefinitely on a stale zone the way a flat "any holes exist
 * anywhere" check would.
 */
export function isZoneStillBlastThreatened(
  drillHoles: readonly { x: number; z: number }[],
  zone: ZoneBounds,
): boolean {
  const dangerZone = computeDangerZone(drillHoles, BLAST_DANGER_MARGIN_M);
  if (dangerZone === null) return false;
  return boundsOverlap(dangerZone, zone);
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

/**
 * Whether the live drill plan's danger zone is blocked, and by how many.
 * Chains computeDangerZone → isZoneClear → countZoneOccupants — the same
 * three-call derivation the tutorial-only FIRE refusal needs on both sides
 * of the console/UI boundary (mining/blast.ts's console `blast` command and
 * blastFooter.ts's FIRE button, #557) — so they never disagree on whether to
 * refuse or on the count they report. Returns null when there are no holes
 * to derive a zone from, or the zone is already clear; the occupant count
 * otherwise.
 */
export function blockingOccupantCount(
  drillHoles: readonly { x: number; z: number }[],
  marginM: number,
  vehicles: VehicleState,
  employees: EmployeeState,
): number | null {
  const zone = computeDangerZone(drillHoles, marginM);
  if (zone === null || isZoneClear(zone, vehicles, employees)) return null;
  return countZoneOccupants(zone, vehicles, employees);
}
