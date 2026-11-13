// BlastSimulator2026 — Zone clearing and evacuation
// Players define safety zones before blasting and evacuate entities.

import type { Vehicle, VehicleState } from './Vehicle.js';
import type { Employee, EmployeeState } from './Employee.js';
import type { GameState } from '../state/GameState.js';
import { vehicleDriverId } from './Vehicle.js';
import { isMounted } from './EmployeeLocomotion.js';
import { moveTo, alightOnArrival } from '../engine/MoveTo.js';
import { BLAST_DANGER_MARGIN_M } from '../config/balance.js';
import type { EvacuationDriverReachabilityCheck } from './VehicleDriverAssignment.js';
import {
  findBestEvacuationDriver, findAvailableDriverForReposition, findRestingLicensedDriver, hasOtherLicensedDriver, canDriveTier,
} from './VehicleDriverAssignment.js';

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
  /** Employees ordered out by the current evacuation (#2230); one who has since left the zone is not sent back for a vehicle. */
  evacuatedEmployeeIds?: number[];
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
/** A safe cell outside `zone` reachable from (fromX, fromZ); for a vehicle being driven out, reachable by that vehicle. */
export type SafeDestinationFinder = (
  fromX: number, fromZ: number, zone: ZoneBounds, vehicle?: Vehicle, avoidCells?: ReadonlySet<string>,
) => EvacuationDestination | null;

/** Key of a destination cell, for the `avoidCells` set of a SafeDestinationFinder (#2230). */
export function evacuationCellKey(x: number, z: number): string {
  return `${Math.round(x)},${Math.round(z)}`;
}

/** Outcome of evacuating a zone: who made it out, and who is stranded. */
export interface EvacuationResult {
  orderedVehicleIds: number[];
  orderedEmployeeIds: number[];
  strandedVehicleIds: number[];
  strandedEmployeeIds: number[];
  /** Driverless in-zone vehicles whose licensed crew member is resting outside the zone and will be fetched (#1746). */
  awaitingRescuerVehicleIds: number[];
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
 * Order a driver clear of the zone: moves them (and, when `viaVehicleId` is
 * given, the vehicle they board en route) to `dest`, then puts them back on
 * foot once they arrive. Shared by clearZone's driven-vehicle branch (no
 * `viaVehicleId` — the driver is already mounted) and its driverless-vehicle
 * branch (`viaVehicleId` set — the picked driver walks to the vehicle first).
 */
function orderDriverClear(
  state: GameState,
  driverId: number,
  dest: EvacuationDestination,
  viaVehicleId?: number,
): ReturnType<typeof moveTo> {
  const ordered = moveTo(state, driverId, { x: dest.x, z: dest.z }, viaVehicleId !== undefined ? { via: viaVehicleId } : undefined);
  if (ordered.success) alightOnArrival(state.employees.employees.find(e => e.id === driverId));
  return ordered;
}

/** Employees already driving some in-zone vehicle. */
export function collectInZoneDriverIds(zone: ZoneBounds, vehicles: VehicleState): Set<number> {
  const ids = new Set<number>();
  for (const v of vehicles.vehicles) {
    const driverId = vehicleDriverId(v);
    if (driverId !== null && isInZone(v.x, v.z, zone)) ids.add(driverId);
  }
  return ids;
}

const NO_EMPLOYEES: ReadonlySet<number> = new Set();

/** What the evacuation does with one driverless in-zone vehicle (#2100). */
type DriverlessEvacuationPlan =
  | { kind: 'stranded' }
  | { kind: 'awaiting' }
  | { kind: 'in_progress' }
  | { kind: 'drive'; driver: Employee; dest: { x: number; z: number } };

/**
 * The single decision for a driverless vehicle: shared by `clearZone` (which
 * then orders the driver) and the pure verdict query the UI reads, so the
 * pre-flight tag can never disagree with what the evacuation does.
 * `boardingEmployeeIds` holds drivers already picked for earlier vehicles.
 * Order: no safe destination -> stranded; an in-zone driver, else a reachable
 * free licensed rescuer anywhere; a rescuer already walking over keeps walking;
 * a resting licence holder -> awaiting; nobody licensed -> stranded.
 */
export function planDriverlessEvacuation(
  v: Vehicle,
  zone: ZoneBounds,
  vehicles: VehicleState,
  employees: EmployeeState,
  boardingEmployeeIds: ReadonlySet<number>,
  inZoneDriverIds: ReadonlySet<number>,
  findSafeDestination: SafeDestinationFinder,
  canEmployeeReachVehicle: EvacuationDriverReachabilityCheck,
  evacuatedEmployeeIds: ReadonlySet<number> = NO_EMPLOYEES,
  avoidCells?: ReadonlySet<string>,
): DriverlessEvacuationPlan {
  // A vehicle nobody can drive anywhere is stranded regardless of who might be free to board it.
  const dest = findSafeDestination(v.x, v.z, zone, v, avoidCells);
  if (!dest) return { kind: 'stranded' };

  const candidateEmployeeIds = employees.employees
    .filter(e =>
      e.alive
      && isInZone(e.x, e.z, zone)
      && !boardingEmployeeIds.has(e.id)
      && !inZoneDriverIds.has(e.id)
      // Mirrors isIdleForReposition's pendingDriverVehicleId reading
      // (VehicleDriverAssignment.ts): an employee mid-walk to board a
      // DIFFERENT vehicle is excluded (#1042); one walking to THIS vehicle is
      // a legitimate candidate (#1122).
      && (e.pendingDriverVehicleId === null || e.pendingDriverVehicleId === v.id),
    )
    .map(e => e.id);

  const inZoneDriver = findBestEvacuationDriver(v, vehicles, employees, candidateEmployeeIds, canEmployeeReachVehicle);
  // A rescuer already walking to `v` keeps walking: neither re-ordered nor stranded.
  if (!inZoneDriver && employees.employees.some(e => e.alive && e.pendingDriverVehicleId === v.id)) {
    return { kind: 'in_progress' };
  }
  // Any free licensed crew member qualifies, wherever they stand (#1648, #1746).
  let driver: Employee | null = inZoneDriver;
  // Nobody ordered out of the zone is ever sent back for a vehicle: an evacuee takes one short route to a safe cell, and a
  // return trip drains the gauge for a machine another licence holder may fetch (#2259). With no other licence holder
  // the vehicle is left where it stands, stranded.
  let heldBack = false;
  if (!driver) {
    let rescuer = findAvailableDriverForReposition(v, vehicles, employees, evacuatedEmployeeIds);
    if (rescuer === null && evacuatedEmployeeIds.size > 0) {
      const returning = findAvailableDriverForReposition(v, vehicles, employees);
      heldBack = returning !== null && hasOtherLicensedDriver(v, employees, evacuatedEmployeeIds);
    }
    driver = rescuer !== null && canEmployeeReachVehicle(rescuer, v) ? rescuer : null;
  }
  if (!driver) {
    return heldBack || findRestingLicensedDriver(v, vehicles, employees, canEmployeeReachVehicle) !== null
      ? { kind: 'awaiting' }
      : { kind: 'stranded' };
  }
  return { kind: 'drive', driver, dest };
}

/** Final destination of the journey `emp` is on, null when it is on none. */
function journeyDestination(emp: Employee): EvacuationDestination | null {
  const last = emp.itinerary?.legs[emp.itinerary.legs.length - 1];
  if (last) return { x: last.destX, z: last.destZ };
  if (emp.destinationX !== null && emp.destinationZ !== null) return { x: emp.destinationX, z: emp.destinationZ };
  return null;
}

/**
 * In-zone evacuees already making progress to a cell outside the zone, by employee id (#2230): a walker with a
 * destination, a driver on an evacuation drive, neither stuck. Re-ordering them would only retarget a journey in progress.
 */
function collectKeptDestinations(zone: ZoneBounds, employees: EmployeeState): Map<number, EvacuationDestination> {
  const kept = new Map<number, EvacuationDestination>();
  for (const emp of employees.employees) {
    if (!emp.alive || !isInZone(emp.x, emp.z, zone)) continue;
    if (emp.isMoveStuck || emp.moveConsecutiveFailures > 0 || emp.destinationX === null) continue;
    const itinerary = emp.itinerary;
    const evacuationDrive = itinerary !== null && itinerary.goal.kind === 'reposition'
      && itinerary.legs[itinerary.legs.length - 1]?.onArrive.kind === 'alight';
    if (isMounted(emp.locomotion) ? !evacuationDrive : emp.activeActionId !== null) continue;
    const dest = journeyDestination(emp);
    if (dest && !isInZone(dest.x, dest.z, zone)) kept.set(emp.id, dest);
  }
  return kept;
}

/**
 * Cells a new evacuation destination must avoid (#2230): where an entity outside the zone stands or is headed, and
 * where an evacuee in progress is going.
 */
function collectClaimedCells(
  zone: ZoneBounds,
  vehicles: VehicleState,
  employees: EmployeeState,
  kept: ReadonlyMap<number, EvacuationDestination>,
): Set<string> {
  const claimed = new Set<string>();
  for (const dest of kept.values()) claimed.add(evacuationCellKey(dest.x, dest.z));
  for (const v of vehicles.vehicles) if (!isInZone(v.x, v.z, zone)) claimed.add(evacuationCellKey(v.x, v.z));
  for (const emp of employees.employees) {
    if (!emp.alive || isInZone(emp.x, emp.z, zone)) continue;
    claimed.add(evacuationCellKey(emp.x, emp.z));
    const dest = journeyDestination(emp);
    if (dest) claimed.add(evacuationCellKey(dest.x, dest.z));
  }
  return claimed;
}

/** True when an alive employee is already on an itinerary that boards or drives `vehicle`. */
function isBeingBoarded(vehicle: Vehicle, employees: EmployeeState): boolean {
  return employees.employees.some(e => e.alive && e.itinerary !== null && e.itinerary.legs.some(leg =>
    leg.vehicleId === vehicle.id || (leg.onArrive.kind === 'board' && leg.onArrive.vehicleId === vehicle.id)));
}

/** A pilot's first trip: the driverless vehicle they take out before `own`, the vehicle they are mounted in. */
interface FirstTripChain { own: Vehicle; rescued: Vehicle }

/**
 * First-trip chains (#2230), by the id of the mounted in-zone driver: a driver who is the only licence holder of a
 * driverless in-zone vehicle, while his own vehicle has another licence holder to fetch it, takes the driverless one
 * out first instead of being sent back for it after leaving.
 */
function planFirstTripChains(
  zone: ZoneBounds,
  vehicles: VehicleState,
  employees: EmployeeState,
  evacuatedBefore: ReadonlySet<number>,
  kept: ReadonlyMap<number, EvacuationDestination>,
): Map<number, FirstTripChain> {
  const chains = new Map<number, FirstTripChain>();
  const taken = new Set<number>();
  for (const own of vehicles.vehicles) {
    const driverId = vehicleDriverId(own);
    if (driverId === null || !isInZone(own.x, own.z, zone) || kept.has(driverId) || evacuatedBefore.has(driverId)) continue;
    const driver = employees.employees.find(e => e.id === driverId);
    const alone = new Set([driverId]);
    if (!driver || !hasOtherLicensedDriver(own, employees, alone)) continue;
    const rescued = vehicles.vehicles.find(v =>
      !taken.has(v.id) && vehicleDriverId(v) === null && isInZone(v.x, v.z, zone)
      && canDriveTier(driver, v.type, v.tier) && !hasOtherLicensedDriver(v, employees, alone)
      && !isBeingBoarded(v, employees));
    if (!rescued) continue;
    taken.add(rescued.id);
    chains.set(driverId, { own, rescued });
  }
  return chains;
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
  state: GameState,
  vehicles: VehicleState,
  employees: EmployeeState,
  findSafeDestination: SafeDestinationFinder,
  canEmployeeReachVehicle: EvacuationDriverReachabilityCheck,
): EvacuationResult {
  const result: EvacuationResult = {
    orderedVehicleIds: [],
    orderedEmployeeIds: [],
    strandedVehicleIds: [],
    strandedEmployeeIds: [],
    awaitingRescuerVehicleIds: [],
  };

  // Employees picked to board a vehicle this call — tracked so a later
  // vehicle in the same zone doesn't also pick them, and so the foot-
  // evacuation loop below skips them.
  const boardingEmployeeIds = new Set<number>();

  // Employees already driving some OTHER in-zone vehicle, computed once up
  // front — neither the vehicle loop's candidate list nor the employee loop
  // needs to rescan the vehicle list per employee to know this.
  const inZoneDriverIds = collectInZoneDriverIds(zone, vehicles);

  // #2230: an evacuee already making progress to a safe cell keeps it, and every destination handed out is a cell
  // nobody else stands on or heads for.
  const evacuatedBefore = new Set(state.zone.evacuatedEmployeeIds ?? []);
  const keptDestinations = collectKeptDestinations(zone, employees);
  const claimedCells = collectClaimedCells(zone, vehicles, employees, keptDestinations);
  const findDest: SafeDestinationFinder = (fromX, fromZ, z, vehicle) => findSafeDestination(fromX, fromZ, z, vehicle, claimedCells);
  const orderedDriverIds: number[] = [];
  const chains = planFirstTripChains(zone, vehicles, employees, evacuatedBefore, keptDestinations);
  // First trip (#2230): the only licence holder of a driverless vehicle takes it out before his own, which waits for
  // its other driver; ordered up front so the vehicle loop below leaves both alone.
  const chainedVehicleIds = new Set<number>();
  const chainedDriverIds = new Set<number>();
  for (const [driverId, chain] of chains) {
    const chainDest = findDest(chain.rescued.x, chain.rescued.z, zone, chain.rescued);
    if (!chainDest || !orderDriverClear(state, driverId, chainDest, chain.rescued.id).success) continue;
    claimedCells.add(evacuationCellKey(chainDest.x, chainDest.z));
    orderedDriverIds.push(driverId);
    chainedDriverIds.add(driverId);
    chainedVehicleIds.add(chain.rescued.id);
    result.orderedVehicleIds.push(chain.rescued.id);
    // The pilot's own vehicle keeps its seat until they step off: its other driver fetches it on a later pass.
    result.awaitingRescuerVehicleIds.push(chain.own.id);
  }

  for (const v of vehicles.vehicles) {
    if (!isInZone(v.x, v.z, zone)) continue;

    const driverId = vehicleDriverId(v);
    if (driverId !== null) {
      if (keptDestinations.has(driverId)) {
        result.orderedVehicleIds.push(v.id);
        continue;
      }
      if (chainedDriverIds.has(driverId)) continue;
      const dest = findDest(v.x, v.z, zone, v);
      if (dest) {
        // Already driven — plain reposition; moveTo's own implicit
        // continuity (already mounted in `v`) plans straight to a drive
        // leg, no boarding needed. The `reposition` goal this installs is
        // itself what marks the driver mid-evacuation (#1092 —
        // isMidEvacuationDrive, EvacuationHold.ts), so every need-driven
        // rest path (ForceShiftRest.ts's forceShiftRestIfNeededByPolicy in
        // particular, via isMidEvacuation) leaves the drive alone instead of
        // discarding it and stranding the vehicle inside the zone (#1110).
        // alightOnArrival puts the driver back on foot the moment the
        // vehicle is clear, exactly like an ordinary on-foot evacuee.
        const ordered = orderDriverClear(state, driverId, dest);
        if (ordered.success) {
          claimedCells.add(evacuationCellKey(dest.x, dest.z));
          orderedDriverIds.push(driverId);
          result.orderedVehicleIds.push(v.id);
        } else {
          result.strandedVehicleIds.push(v.id);
        }
      } else {
        result.strandedVehicleIds.push(v.id);
      }
      continue;
    }

    if (chainedVehicleIds.has(v.id) || isBeingBoarded(v, employees)) continue;
    const plan = planDriverlessEvacuation(
      v, zone, vehicles, employees, boardingEmployeeIds, inZoneDriverIds,
      findSafeDestination, canEmployeeReachVehicle, evacuatedBefore, claimedCells,
    );
    if (plan.kind === 'stranded') {
      result.strandedVehicleIds.push(v.id);
      continue;
    }
    if (plan.kind === 'awaiting') {
      result.awaitingRescuerVehicleIds.push(v.id);
      continue;
    }
    if (plan.kind === 'in_progress') continue;
    const { driver, dest } = plan;

    // One itinerary covers the whole rescue (#1092): walk to `v`, board it,
    // drive it clear, step off. `via` names the vehicle so the planner
    // routes the reposition through it rather than walking the driver to
    // safety on foot and leaving the vehicle behind — no per-vehicle
    // destination marker, and no second `moveTo` once the board resolves.
    const ordered = orderDriverClear(state, driver.id, dest, v.id);
    if (!ordered.success) {
      result.strandedVehicleIds.push(v.id);
      continue;
    }
    boardingEmployeeIds.add(driver.id);
    claimedCells.add(evacuationCellKey(dest.x, dest.z));
    orderedDriverIds.push(driver.id);
    result.orderedVehicleIds.push(v.id);
  }

  for (const emp of employees.employees) {
    if (!emp.alive) continue;
    if (!isInZone(emp.x, emp.z, zone)) continue;
    if (boardingEmployeeIds.has(emp.id)) continue;
    // Already driving an in-zone vehicle clear (driver-present branch above
    // already staged its destination) — no foot destination needed too.
    if (inZoneDriverIds.has(emp.id)) continue;
    // Already walking out and not stuck (#2230): the destination holds.
    if (keptDestinations.has(emp.id)) {
      result.orderedEmployeeIds.push(emp.id);
      continue;
    }

    const dest = findDest(emp.x, emp.z, zone);
    if (dest && moveTo(state, emp.id, { x: dest.x, z: dest.z }, { allowUnreachable: true }).success) {
      claimedCells.add(evacuationCellKey(dest.x, dest.z));
      result.orderedEmployeeIds.push(emp.id);
    } else {
      result.strandedEmployeeIds.push(emp.id);
    }
  }

  const evacuated = (state.zone.evacuatedEmployeeIds ??= []);
  for (const id of [...result.orderedEmployeeIds, ...orderedDriverIds]) if (!evacuated.includes(id)) evacuated.push(id);

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
 * for its own callers (isDangerZoneClear,
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
 * one number the Fire step's occupant list (Fire.ts's `occupants()`) and the
 * pre-flight modal's zone warning report, so they never disagree on how many
 * are still in the way.
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
 * dangerous (holes charged, nobody has fired yet), not the
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
 * same one the pre-flight occupant list and `dangerZoneClear`
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
 * list and DETONATE's evacuation use) is clear of every vehicle and living
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
