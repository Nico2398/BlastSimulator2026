// BlastSimulator2026 — Starting-crew spawn placement
// Places a fresh game's staffed roster and fleet on ground they can actually
// work from, once terrain exists. Pure core: no side effects beyond the
// GameState it is handed.

import { NavGrid, type NavCell } from '../nav/NavGrid.js';
import { findNearestNavigableCell, countLegalStepNeighbours, computeClimbComponents } from '../nav/NavGridReachability.js';
import { findPath } from '../nav/Pathfinding.js';
import { routeInflation, isRouteAcceptable } from './SpawnRoute.js';
import { isFlatParkingCell, rallyConnectedCells, isStandable as isSpawnable, cellKey as key, chebyshev } from './RallyPoint.js';
import {
  CREW_SPAWN_VEHICLE_SEPARATION,
  CREW_SPAWN_SEARCH_LIMIT_FACTOR,
  CREW_SPAWN_AGENT_SEPARATION,
  CREW_SPAWN_SEARCH_RADIUS,
  CREW_SPAWN_VEHICLE_MAX_ROUTE_INFLATION,
  CREW_SPAWN_VEHICLE_ROUTE_SLACK,
  CREW_SPAWN_VEHICLE_MIN_OPEN_NEIGHBOURS,
  NAV_CLEARANCE_VEHICLE_CELLS,
  RALLY_POINT_VEHICLE_STANDOFF,
} from '../config/balance.js';
import { NAV_MAX_SLOPE_RATIO } from '../config/balance.js';
import { isLicensedForRole } from '../engine/VehicleReservation.js';
import type { GameState } from './GameState.js';
import type { Employee } from '../entities/Employee.js';
import type { Vehicle, VehicleRole } from '../entities/Vehicle.js';

interface Cell { x: number; z: number }

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

/** Arithmetic mean of `points`' x and z; the origin when empty. */
export function meanPosition(points: ReadonlyArray<{ x: number; z: number }>): { x: number; z: number } {
  if (points.length === 0) return { x: 0, z: 0 };
  return {
    x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
    z: points.reduce((sum, p) => sum + p.z, 0) / points.length,
  };
}

/** Cells at Chebyshev radius `r` from `origin`, in a fixed order — ring by ring, nearest first. */
export function* ringCells(origin: Cell, radius: number): Generator<Cell> {
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
 * Picks `count` employee cells from `candidates` (nearest-first BFS order),
 * skipping the already-claimed `vehicleCells` and keeping every pick at
 * least `separation` Chebyshev cells from every vehicle cell and every
 * employee cell already picked. `separation` 0 degrades to the old
 * distinct-cell-only behaviour (still skips exact vehicle-cell collisions,
 * never checked against other employees at 0). Returns null when fewer than
 * `count` candidates satisfy the constraint, so the caller can retry looser
 * rather than seat only some of the roster.
 */
function fillEmployeeCells(
  candidates: readonly Cell[],
  vehicleCells: readonly Cell[],
  count: number,
  separation: number,
): Cell[] | null {
  const vehicleKeys = new Set(vehicleCells.map(key));
  const employeeCells: Cell[] = [];
  for (const candidate of candidates) {
    if (employeeCells.length === count) break;
    if (vehicleKeys.has(key(candidate))) continue;
    const farEnough = separation <= 0 ? true
      : vehicleCells.every(v => chebyshev(v, candidate) >= separation)
        && employeeCells.every(e => chebyshev(e, candidate) >= separation);
    if (!farEnough) continue;
    employeeCells.push(candidate);
  }
  return employeeCells.length >= count ? employeeCells : null;
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
 * Whether a vehicle standing on `from` can drive to `to` with a parked vehicle
 * on each of `blockers` (#1680). The generic route checks above ignore parked
 * vehicles, so on a one-lane steep rim they pass a fleet whose members sit in
 * each other's way: the rig queues behind the truck it must drive past and
 * the pit is never reached. `vehicleOccupied` is marked for the search only.
 */
function canDriveAroundVehicles(navGrid: NavGrid, from: Cell, to: Cell, blockers: ReadonlyArray<Cell>): boolean {
  const marked = blockers
    .filter(b => b.x !== to.x || b.z !== to.z) // a vehicle parked on the goal does not wall it off
    .map(b => navGrid.cellAt(b.x, b.z))
    .filter((cell): cell is NavCell => cell !== undefined && !cell.vehicleOccupied);
  for (const cell of marked) cell.vehicleOccupied = true;
  try {
    return findPath(navGrid, {
      agentId: 0,
      fromX: from.x, fromZ: from.z,
      toX: to.x, toZ: to.z,
      avoidVehicles: true,
      requiredClearance: NAV_CLEARANCE_VEHICLE_CELLS,
    }).found;
  } finally {
    for (const cell of marked) cell.vehicleOccupied = false;
  }
}

/**
 * One-time fixup (#1648): move a starting vehicle off a thin ridge or trench
 * (fewer than CREW_SPAWN_VEHICLE_MIN_OPEN_NEIGHBOURS legal-step neighbours at
 * vehicle clearance) onto the nearest roomier spawnable cell, keeping the
 * vehicle separation. The generic ground snap can land a vehicle on such a
 * cell; it is connected to the site on a fresh grid, but one building corner
 * seals it and the vehicle can then never drive out. Run after the snap.
 * The sealed-pocket fallback (#1680) is not gated: a vehicle on a pocket cut
 * off from the site's middle may move onto the main ground, since it could never
 * drive out. Only the fleet-mobility check is gated: with
 * `fleetMustStayMobile` (the sandbox) a vehicle boxed in by the rest of the
 * fleet moves too, to a cell from which it can drive to the site's
 * middle around the others. Off by default: a campaign level's opening layout
 * is authored, and its first shot is aimed from where the rig stands.
 * Returns whether anything moved.
 */
export function relocateVehiclesOffNarrowGround(
  state: GameState,
  options: { fleetMustStayMobile?: boolean; /** Steepest rise/run the fleet climbs (#2044); defaults to the walking limit. */ vehicleSlopeRatio?: number } = {},
): boolean {
  const navGrid = state.navGrid;
  if (!navGrid) return false;
  const employees = state.employees.employees;
  const vehicles = state.vehicles.vehicles;
  const open = (c: Cell): number => countLegalStepNeighbours(navGrid, c.x, c.z, NAV_CLEARANCE_VEHICLE_CELLS);
  // The new cell must stay on the vehicle's own climb component: a roomier
  // cell in a cut-off pocket would strand the vehicle from every order.
  // Unless that component is itself cut off from the site's middle (a thin
  // diagonal ridge on a steep rim, #1680): then no roomier cell exists on it,
  // and the vehicle may move to the site's main ground instead.
  let components: ReturnType<typeof computeClimbComponents> | null = null; // built on the first narrow vehicle
  const centre = findNearestNavigableCell(
    navGrid,
    navGrid.originX + Math.floor(navGrid.width / 2),
    navGrid.originZ + Math.floor(navGrid.height / 2),
  );
  const reachable = (a: Cell, b: Cell): boolean =>
    (components ??= computeClimbComponents(navGrid, NAV_CLEARANCE_VEHICLE_CELLS)).canReach(a.x, a.z, b.x, b.z);
  // Every vehicle that can reach the site's middle at all can drive there
  // around the rest of the fleet (#1680).
  const fleetCanDrive = (cells: ReadonlyArray<Cell>): boolean => options.fleetMustStayMobile !== true || cells.every((cell, i) =>
    !reachable(cell, centre)
    || canDriveAroundVehicles(navGrid, cell, centre, cells.filter((_, j) => j !== i)));
  const occupied = new Set<string>([
    ...employees.map(e => key({ x: Math.round(e.x), z: Math.round(e.z) })),
    ...vehicles.map(v => key({ x: Math.round(v.x), z: Math.round(v.z) })),
  ]);
  let moved = false;

  for (const vehicle of vehicles) {
    const from = { x: Math.round(vehicle.x), z: Math.round(vehicle.z) };
    const others = vehicles.filter(o => o !== vehicle).map(o => ({ x: Math.round(o.x), z: Math.round(o.z) }));
    if (open(from) >= CREW_SPAWN_VEHICLE_MIN_OPEN_NEIGHBOURS && fleetCanDrive([from, ...others])) continue;
    let target: Cell | null = null;
    for (let radius = 1; radius <= CREW_SPAWN_SEARCH_RADIUS && target === null; radius++) {
      target = [...ringCells(from, radius)].find(c =>
        !occupied.has(key(c))
        && isSpawnable(navGrid.cellAt(c.x, c.z))
        && open(c) >= CREW_SPAWN_VEHICLE_MIN_OPEN_NEIGHBOURS
        && (reachable(from, c) || (!reachable(from, centre) && reachable(centre, c)))
        && others.every(o => chebyshev(o, c) >= CREW_SPAWN_VEHICLE_SEPARATION)
        && fleetCanDrive([c, ...others]),
      ) ?? null;
    }
    if (target === null) continue;
    occupied.delete(key(from));
    occupied.add(key(target));
    vehicle.x = target.x;
    vehicle.z = target.z;
    moved = true;
  }
  return moved;
}

/**
 * Seats `vehicles` on `vehicleCandidates` (nearest first, kept
 * `CREW_SPAWN_VEHICLE_SEPARATION` apart, #591) and `employees` on
 * `employeeCandidates` around them (#1263). All-or-nothing: returns false and
 * moves nobody when the candidates cannot seat the whole crew.
 */
function layOutCrew(
  employees: Employee[],
  vehicles: Vehicle[],
  vehicleCandidates: readonly Cell[],
  employeeCandidates: readonly Cell[],
): boolean {
  const vehicleCells: Cell[] = [];
  for (const candidate of vehicleCandidates) {
    if (vehicleCells.length === vehicles.length) break;
    if (vehicleCells.every(taken => chebyshev(taken, candidate) >= CREW_SPAWN_VEHICLE_SEPARATION)) {
      vehicleCells.push(candidate);
    }
  }
  if (vehicleCells.length < vehicles.length) return false;

  // Employees fill in around the spaced vehicle picks (#1263): kept
  // CREW_SPAWN_AGENT_SEPARATION away from every vehicle AND every employee
  // already placed, not just off the exact same cell — see
  // CREW_SPAWN_AGENT_SEPARATION's own doc comment for why "distinct" was not
  // enough. Falls back to the old distinct-cell-only fill (still guaranteed
  // collision-free, just not gap-guaranteed) when the connected patch is too
  // small to seat every employee with room to spare — a real, if rare,
  // possibility on a tightly pocketed site.
  const employeeCells = fillEmployeeCells(employeeCandidates, vehicleCells, employees.length, CREW_SPAWN_AGENT_SEPARATION)
    ?? fillEmployeeCells(employeeCandidates, vehicleCells, employees.length, 0);
  if (!employeeCells || employeeCells.length < employees.length) return false;

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
  return true;
}

/**
 * The no-flag path (#1166): moves the crew only when its authored spawn is
 * walled off from the middle of its own site, and then no further than it
 * must. A level's spawn coordinates are a design decision — its work sites
 * are authored around where its crew starts — so an ordinary staggered
 * formation on ordinary ground is left exactly as authored, even where a local
 * step separates two of its rows.
 */
function regroupWalledInCrew(
  navGrid: NavGrid,
  employees: Employee[],
  vehicles: Vehicle[],
  agents: readonly Cell[],
  searchLimit: number,
): boolean {
  const centre = {
    x: navGrid.clampX(navGrid.originX + Math.floor(navGrid.width / 2)),
    z: navGrid.clampZ(navGrid.originZ + Math.floor(navGrid.height / 2)),
  };
  const mean = meanPosition(agents);
  const authored = {
    x: navGrid.clampX(Math.round(mean.x)),
    z: navGrid.clampZ(Math.round(mean.z)),
  };
  const authoredAnchor = findNearestNavigableCell(navGrid, authored.x, authored.z);
  if (isRouteAcceptable(navGrid, authoredAnchor, centre)) return false;
  const anchor = selectAnchor(navGrid, authored, centre);
  const candidates = rallyConnectedCells(navGrid, anchor, searchLimit);
  return layOutCrew(employees, vehicles, candidates, candidates);
}

/**
 * Gather a fresh game's employees and vehicles onto one patch of mutually
 * climb-connected ground. Returns true when anyone moved.
 *
 * With a rally point (every game whose first grid went through
 * `regenerateGrid`), the crew always gathers around the flag: the flag was
 * chosen on flat main ground near where the level meant the crew to start
 * (`chooseRallyPoint`), so that is where the crew and every later arrival
 * belong. Without one, the crew moves only when its authored spawn does not
 * survive contact with the terrain (#1166), as described below.
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
 * cost let A* resolve a route onto the cell the other one blocks. Employees
 * fill in around them kept `CREW_SPAWN_AGENT_SEPARATION` cells apart too
 * (#1263) — see that constant's own doc comment for why the plain
 * nearest-candidate fill this replaced could still pack a whole roster
 * single-file down a narrow corridor once every ground cell is exclusive
 * (#1206), even on a spawn this function already judged worth repositioning.
 */
export function placeStartingCrew(state: GameState): boolean {
  const navGrid = state.navGrid;
  if (!navGrid) return false;

  const employees = state.employees.employees;
  const vehicles = state.vehicles.vehicles;
  const agents: Cell[] = [...employees, ...vehicles].map(a => ({ x: Math.round(a.x), z: Math.round(a.z) }));
  if (agents.length === 0) return false;

  // Vehicle separation is what makes the cluster wider than one cell per
  // agent: leave room for the spaced picks plus the employees filling in
  // around them.
  const searchLimit = CREW_SPAWN_SEARCH_LIMIT_FACTOR * agents.length * CREW_SPAWN_VEHICLE_SEPARATION * CREW_SPAWN_VEHICLE_SEPARATION;

  let crewMoved = false;
  const flag = state.rallyPoint;
  if (flag) {
    // A site with a rally point gathers its whole crew around the flag, which
    // already stands on flat main ground (chooseRallyPoint). The flag's own
    // cell stays clear, and vehicles keep their standoff so none is parked on it.
    const anchor = findNearestNavigableCell(navGrid, flag.x, flag.z);
    const candidates = rallyConnectedCells(navGrid, anchor, searchLimit + (2 * RALLY_POINT_VEHICLE_STANDOFF + 1) ** 2)
      .filter(c => c.x !== flag.x || c.z !== flag.z);
    const vehicleCandidates = candidates.filter(c => chebyshev(c, flag) >= RALLY_POINT_VEHICLE_STANDOFF);
    // Vehicles park on level ground where the patch has room for the whole fleet.
    const levelVehicleCandidates = vehicleCandidates.filter(c => isFlatParkingCell(navGrid, c));
    crewMoved = layOutCrew(employees, vehicles, levelVehicleCandidates, candidates)
      || layOutCrew(employees, vehicles, vehicleCandidates, candidates);
  } else {
    crewMoved = regroupWalledInCrew(navGrid, employees, vehicles, agents, searchLimit);
  }

  const vehicleMoved = fixUnreachableVehicles(navGrid, employees, vehicles);

  return crewMoved || vehicleMoved;
}

/** Steepest rise/run every vehicle of the fleet climbs: the minimum of their limits (#2044). */
export function fleetSlopeRatio(_vehicles: ReadonlyArray<Pick<Vehicle, 'tier'>>, _progression: boolean): number {
  return NAV_MAX_SLOPE_RATIO; // TODO: implement
}
