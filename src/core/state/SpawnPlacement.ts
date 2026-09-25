// BlastSimulator2026 — Starting-crew spawn placement
// Places a fresh game's staffed roster and fleet on ground they can actually
// work from, once terrain exists. Pure core: no side effects beyond the
// GameState it is handed.

import { NavGrid, isStepClimbable, type NavCell } from '../nav/NavGrid.js';
import { findNearestNavigableCell } from '../nav/NavGridReachability.js';
import { findPath, type PathResult } from '../nav/Pathfinding.js';
import {
  CREW_SPAWN_VEHICLE_SEPARATION,
  CREW_SPAWN_MAX_ROUTE_INFLATION,
  CREW_SPAWN_SEARCH_RADIUS,
  CREW_SPAWN_VEHICLE_MAX_ROUTE_INFLATION,
  CREW_SPAWN_VEHICLE_ROUTE_SLACK,
} from '../config/balance.js';
import { isLicensedForRole } from '../engine/VehicleReservation.js';
import type { GameState } from './GameState.js';
import type { Employee } from '../entities/Employee.js';
import type { Vehicle, VehicleRole } from '../entities/Vehicle.js';

/** 8-directional neighbour order — fixed, so a placement is reproducible rather than seed-dependent. */
const NEIGHBOUR_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
];

/**
 * Slack added to the route-length allowance, in waypoints. A crew standing a
 * few metres from the site centre has a straight-line reference near zero,
 * where any ratio at all reads as catastrophic inflation; this keeps the test
 * about long detours, which is what it is for.
 */
const ROUTE_ALLOWANCE_SLACK = 8;

interface Cell { x: number; z: number }

function isSpawnable(cell: NavCell | undefined): cell is NavCell {
  return cell !== undefined && (cell.type === 'walkable' || cell.type === 'ramp');
}

function key(cell: Cell): string {
  return `${cell.x},${cell.z}`;
}

function chebyshev(a: Cell, b: Cell): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}

/**
 * Cells reachable from `anchor` by legal climbs, in breadth-first discovery
 * order — nearest first. Every cell in the result is therefore connected to
 * the anchor, and to every other cell in it, by a route `findPath` can
 * resolve: that mutual connectivity is the whole point of drawing crew
 * positions from this list rather than from fixed coordinates.
 *
 * Bounded by `limit` because only the first handful of cells is ever used;
 * the flood fill must not walk a 64x64 site to place nine agents.
 */
function climbConnectedCells(
  navGrid: NavGrid,
  anchor: Cell,
  limit: number,
  /**
   * Cells to walk through although the grid calls them blocked — the crew's
   * own vehicles. `buildNavGrid` marks the cell a parked vehicle stands on
   * blocked, so without this the fill can never reach a crew's own fleet and
   * every staffed site reads as split.
   */
  alsoPassable: ReadonlySet<string> = new Set(),
): Cell[] {
  const found: Cell[] = [];
  const seen = new Set<string>([key(anchor)]);
  const queue: Cell[] = [anchor];
  const passable = (cell: NavCell | undefined, at: Cell): cell is NavCell =>
    isSpawnable(cell) || (cell !== undefined && alsoPassable.has(key(at)));

  while (queue.length > 0 && found.length < limit) {
    const current = queue.shift() as Cell;
    const currentCell = navGrid.cellAt(current.x, current.z);
    if (!passable(currentCell, current)) continue;
    found.push(current);

    for (const [dx, dz] of NEIGHBOUR_OFFSETS) {
      const next = { x: current.x + dx, z: current.z + dz };
      if (seen.has(key(next))) continue;
      const nextCell = navGrid.cellAt(next.x, next.z);
      if (!passable(nextCell, next)) continue;
      const run = dx !== 0 && dz !== 0 ? Math.SQRT2 : 1;
      if (!isStepClimbable(currentCell.surfaceY, nextCell.surfaceY, run)) continue;
      seen.add(key(next));
      queue.push(next);
    }
  }

  return found;
}

/**
 * How far the crew would actually walk from `from` to the middle of the site,
 * in waypoints, against how far it is in a straight line. 1.0 is open ground.
 * `Infinity` means no route at all.
 *
 * This, not a reachability percentage, is the measure that matters under a
 * slope limit: on desert seed 10 every cell of the site was climb-reachable
 * from the spawn corner and the crew still could not work, because the routes
 * out of that corner ran 2.78x long on average and 14x at worst.
 */
function routeInflation(
  navGrid: NavGrid,
  from: Cell,
  centre: Cell,
  metric: (r: PathResult) => number = r => r.waypoints.length,
): number {
  const straight = Math.hypot(centre.x - from.x, centre.z - from.z);
  if (straight < 1) return 1;
  const route = findPath(navGrid, {
    agentId: 0,
    fromX: from.x, fromZ: from.z,
    toX: centre.x, toZ: centre.z,
    avoidVehicles: false,
  });
  if (!route.found) return Number.POSITIVE_INFINITY;
  return metric(route) / straight;
}

function isRouteAcceptable(
  navGrid: NavGrid,
  from: Cell,
  centre: Cell,
  maxInflation = CREW_SPAWN_MAX_ROUTE_INFLATION,
  slack = ROUTE_ALLOWANCE_SLACK,
  metric: (r: PathResult) => number = r => r.waypoints.length,
): boolean {
  const straight = Math.hypot(centre.x - from.x, centre.z - from.z);
  if (straight < 1e-9) return true; // same-cell / zero distance: trivially acceptable
  const allowance = maxInflation + slack / straight;
  return routeInflation(navGrid, from, centre, metric) <= allowance;
}

/**
 * The vehicle-reachability tolerance check (#1179), bound to
 * `CREW_SPAWN_VEHICLE_MAX_ROUTE_INFLATION` / `CREW_SPAWN_VEHICLE_ROUTE_SLACK`
 * and `route.totalCost` as its metric. Every vehicle-reachability call site in
 * this file shares this one formula rather than repeating the triplet.
 * Exported narrowly so a test can call the real check instead of
 * reimplementing it.
 */
export function isVehicleRouteAcceptable(navGrid: NavGrid, from: Cell, to: Cell): boolean {
  return isRouteAcceptable(
    navGrid, from, to,
    CREW_SPAWN_VEHICLE_MAX_ROUTE_INFLATION, CREW_SPAWN_VEHICLE_ROUTE_SLACK,
    r => r.totalCost,
  );
}

/** Cells at Chebyshev radius `r` from `origin`, in a fixed order — ring by ring, nearest first. */
function* ringCells(origin: Cell, radius: number): Generator<Cell> {
  if (radius === 0) {
    yield origin;
    return;
  }
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
      yield { x: origin.x + dx, z: origin.z + dz };
    }
  }
}

/**
 * The cell to gather the crew on: the one nearest where the level meant to
 * put it whose route to the site centre is not a detour. Falls back to the
 * least-inflated candidate found inside `CREW_SPAWN_SEARCH_RADIUS`, and to
 * the site's main navigable ground when nothing within that radius has a
 * route at all.
 */
function selectAnchor(navGrid: NavGrid, authored: Cell, centre: Cell): Cell {
  let best: Cell | null = null;
  let bestInflation = Number.POSITIVE_INFINITY;

  for (let radius = 0; radius <= CREW_SPAWN_SEARCH_RADIUS; radius++) {
    for (const candidate of ringCells(authored, radius)) {
      if (!isSpawnable(navGrid.cellAt(candidate.x, candidate.z))) continue;
      const inflation = routeInflation(navGrid, candidate, centre);
      if (inflation < bestInflation) {
        bestInflation = inflation;
        best = candidate;
      }
      if (isRouteAcceptable(navGrid, candidate, centre)) return candidate;
    }
  }

  return best ?? findNearestNavigableCell(navGrid, centre.x, centre.z);
}

/** Employees, in roster order, holding the licence a vehicle of `role` requires. */
function findLicensedDrivers(employees: Employee[], role: VehicleRole): Employee[] {
  return employees.filter(employee => isLicensedForRole(employee, role));
}

/**
 * Ring search from `driverCell` for the nearest unoccupied, spawnable cell
 * whose route back to `driverCell` beats `currentVehicleCell`'s — null when
 * nothing strictly better is found (#1179). Rejects any candidate within
 * `CREW_SPAWN_VEHICLE_SEPARATION` of another already-placed vehicle in
 * `otherVehicleCells`, the same guard the crew-layout path above enforces —
 * without it a relocated vehicle can land close enough to another to tie on
 * octile cost and reintroduce #591.
 */
function relocateVehicleNearDriver(
  navGrid: NavGrid,
  driverCell: Cell,
  currentVehicleCell: Cell,
  occupied: Set<string>,
  otherVehicleCells: ReadonlyArray<Cell>,
): Cell | null {
  const currentInflation = routeInflation(navGrid, driverCell, currentVehicleCell, r => r.totalCost);
  const tooCloseToAnotherVehicle = (candidate: Cell): boolean =>
    otherVehicleCells.some(other => chebyshev(other, candidate) < CREW_SPAWN_VEHICLE_SEPARATION);

  let best: Cell | null = null;
  let bestInflation = Number.POSITIVE_INFINITY;

  for (let radius = 1; radius <= CREW_SPAWN_SEARCH_RADIUS; radius++) {
    for (const candidate of ringCells(driverCell, radius)) {
      if (occupied.has(key(candidate))) continue;
      if (!isSpawnable(navGrid.cellAt(candidate.x, candidate.z))) continue;
      if (tooCloseToAnotherVehicle(candidate)) continue;

      const inflation = routeInflation(navGrid, driverCell, candidate, r => r.totalCost);
      if (inflation < bestInflation) {
        bestInflation = inflation;
        best = candidate;
      }
      if (isVehicleRouteAcceptable(navGrid, driverCell, candidate)) {
        return candidate;
      }
    }
  }

  return best !== null && bestInflation < currentInflation ? best : null;
}

/**
 * One-time fixup (#1179): for each vehicle in roster order, relocate it near
 * a licensed driver when no licensed driver can reach it within tolerance
 * (CREW_SPAWN_VEHICLE_MAX_ROUTE_INFLATION / CREW_SPAWN_VEHICLE_ROUTE_SLACK,
 * using route.totalCost as the metric). Returns whether anything moved.
 * Deliberately run once at spawn placement, not per tick — see
 * `SingleVehicleMover.test.ts`'s allowlist.
 */
function fixUnreachableVehicles(navGrid: NavGrid, employees: Employee[], vehicles: Vehicle[]): boolean {
  const occupied = new Set<string>([
    ...employees.map(e => key({ x: Math.round(e.x), z: Math.round(e.z) })),
    ...vehicles.map(v => key({ x: Math.round(v.x), z: Math.round(v.z) })),
  ]);

  let vehicleMoved = false;

  for (const vehicle of vehicles) {
    const vehicleCell = { x: Math.round(vehicle.x), z: Math.round(vehicle.z) };
    const drivers = findLicensedDrivers(employees, vehicle.type);
    if (drivers.length === 0) continue;

    let bestDriverCell: Cell | null = null;
    let bestInflation = Number.POSITIVE_INFINITY;
    let anyAcceptable = false;

    for (const driver of drivers) {
      const driverCell = { x: Math.round(driver.x), z: Math.round(driver.z) };
      if (isVehicleRouteAcceptable(navGrid, driverCell, vehicleCell)) {
        anyAcceptable = true;
        break;
      }
      const inflation = routeInflation(navGrid, driverCell, vehicleCell, r => r.totalCost);
      if (inflation < bestInflation) {
        bestInflation = inflation;
        bestDriverCell = driverCell;
      }
    }

    if (anyAcceptable) continue;
    if (bestDriverCell === null) continue;

    const oldKey = key(vehicleCell);
    const otherVehicleCells = vehicles
      .filter(other => other !== vehicle)
      .map(other => ({ x: Math.round(other.x), z: Math.round(other.z) }));
    const relocated = relocateVehicleNearDriver(navGrid, bestDriverCell, vehicleCell, occupied, otherVehicleCells);
    if (relocated === null) continue;

    vehicle.x = relocated.x;
    vehicle.z = relocated.z;
    occupied.delete(oldKey);
    occupied.add(key(relocated));
    vehicleMoved = true;
  }

  return vehicleMoved;
}

/**
 * Gather a fresh game's employees and vehicles onto one patch of mutually
 * climb-connected ground, near where the level placed them, when their
 * authored spawn does not survive contact with the terrain (#1166). Returns
 * true when anyone moved.
 *
 * Spawn coordinates are literals picked before terrain exists — the staffed
 * roster staggers itself around the site origin in `applyStaffedComposition`,
 * a campaign level's crew starts wherever its definition says. That was
 * harmless while an agent could walk off any drop. Under a slope limit
 * (#1151) it is not: on desert seed 10 the origin corner sits behind a 62°
 * face, so the driller spawned two metres from its own drill rig with a 113
 * waypoint detour between them. Nothing was unreachable — the crew simply
 * started on the wrong side of a wall, and every downstream symptom (a drive
 * outlasting a fatigue charge, drill queues never claimed, cash bleeding,
 * worker revolts) followed from that.
 *
 * Deliberately a no-op wherever the authored spawn is sound: a level's own
 * coordinates are a design decision — work sites are authored near where the
 * crew starts — so this moves a crew only when the terrain has walled it in,
 * and then no further than it must.
 *
 * Vehicles are kept `CREW_SPAWN_VEHICLE_SEPARATION` cells apart, preserving
 * what #591's spaced row was for: two vehicles close enough to tie on octile
 * cost let A* resolve a route onto the cell the other one blocks.
 */
export function placeStartingCrew(state: GameState): boolean {
  const navGrid = state.navGrid;
  if (!navGrid) return false;

  const employees = state.employees.employees;
  const vehicles = state.vehicles.vehicles;
  const agents: Cell[] = [...employees, ...vehicles].map(a => ({ x: Math.round(a.x), z: Math.round(a.z) }));
  if (agents.length === 0) return false;

  const centre = {
    x: navGrid.clampX(navGrid.originX + Math.floor(navGrid.width / 2)),
    z: navGrid.clampZ(navGrid.originZ + Math.floor(navGrid.height / 2)),
  };
  const authored = {
    x: navGrid.clampX(Math.round(agents.reduce((sum, a) => sum + a.x, 0) / agents.length)),
    z: navGrid.clampZ(Math.round(agents.reduce((sum, a) => sum + a.z, 0) / agents.length)),
  };

  // Vehicle separation is what makes the cluster wider than one cell per
  // agent: leave room for the spaced picks plus the employees filling in
  // around them.
  const searchLimit = agents.length * CREW_SPAWN_VEHICLE_SEPARATION * CREW_SPAWN_VEHICLE_SEPARATION;

  // One trigger, and a deliberately narrow one: how far the crew would
  // actually have to walk to reach the middle of its own site. A level's
  // spawn coordinates are a design decision — its work sites are authored
  // around where its crew starts — so an ordinary staggered formation on
  // ordinary ground is left exactly as authored, even where a local step
  // separates two of its rows. What is not survivable, and what this moves,
  // is a crew walled off from the site it was hired to work.
  let crewMoved = false;
  const authoredAnchor = findNearestNavigableCell(navGrid, authored.x, authored.z);
  if (!isRouteAcceptable(navGrid, authoredAnchor, centre)) {
    const anchor = selectAnchor(navGrid, authored, centre);
    const candidates = climbConnectedCells(navGrid, anchor, searchLimit);

    const vehicleCells: Cell[] = [];
    for (const candidate of candidates) {
      if (vehicleCells.length === vehicles.length) break;
      if (vehicleCells.every(taken => chebyshev(taken, candidate) >= CREW_SPAWN_VEHICLE_SEPARATION)) {
        vehicleCells.push(candidate);
      }
    }

    if (vehicleCells.length >= vehicles.length) {
      const taken = new Set(vehicleCells.map(key));
      const employeeCells: Cell[] = [];
      for (const candidate of candidates) {
        if (employeeCells.length === employees.length) break;
        if (taken.has(key(candidate))) continue;
        taken.add(key(candidate));
        employeeCells.push(candidate);
      }

      if (employeeCells.length >= employees.length) {
        employees.forEach((employee, i) => {
          const cell = employeeCells[i] as Cell;
          employee.x = cell.x;
          employee.z = cell.z;
        });
        vehicles.forEach((vehicle, i) => {
          const cell = vehicleCells[i] as Cell;
          vehicle.x = cell.x;
          vehicle.z = cell.z;
        });
        crewMoved = true;
      }
    }
  }

  const vehicleMoved = fixUnreachableVehicles(navGrid, employees, vehicles);

  return crewMoved || vehicleMoved;
}
