// BlastSimulator2026 — Rally point: where a site's crew and fleet arrive
// One flag per site, chosen once on flat ground when the site's first grid
// exists. Every new hire, every vehicle bought and a level's starting crew
// spawn around it on free navigable cells. The flag is a marker, not a
// building: nothing damages it, and the renderer stands it on whatever ground
// is left under it, so a dig or a blast beneath it only lowers it.

import { isStepClimbable, type NavCell, type NavGrid } from '../nav/NavGrid.js';
import { computeClimbComponents, countLegalStepNeighbours, findNearestNavigableCell } from '../nav/NavGridReachability.js';
import {
  CREW_SPAWN_VEHICLE_MIN_OPEN_NEIGHBOURS,
  CREW_SPAWN_VEHICLE_SEPARATION,
  NAV_CLEARANCE_VEHICLE_CELLS,
  RALLY_POINT_FLAT_RADIUS,
  RALLY_POINT_MAX_HEIGHT_SPREAD_M,
  RALLY_POINT_MAX_ROUTE_CHECKS,
  RALLY_POINT_SPAWN_SEARCH_LIMIT,
  RALLY_POINT_VEHICLE_STANDOFF,
} from '../config/balance.js';
import { isRouteAcceptable } from './SpawnRoute.js';
import type { GameState, RallyPoint } from './GameState.js';

interface Cell { x: number; z: number }

/** Constraints on a rally point beyond flatness (#2044). Omitted fields leave the choice unchanged. */
export interface RallyPointOptions {
  /** Steepest rise/run the fleet that spawns at the flag can climb; the flag must sit on ground the slowest vehicle can leave. */
  maxSlopeRatio?: number;
  /** A cell the flag's ground must be climb-connected to (the pit floor, say), at `maxSlopeRatio`. */
  mustReach?: Cell;
}

/** Who is being spawned: a vehicle needs room to drive and keeps its distance from the flag and the fleet. */
type RallySpawnKind = 'employee' | 'vehicle';

/** 8-directional neighbour order — fixed, so a spawn is reproducible. */
const NEIGHBOUR_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
];

/** A cell's string key, for set membership. */
export function cellKey(cell: Cell): string {
  return `${cell.x},${cell.z}`;
}

/** Chebyshev (chessboard) distance between two cells. */
export function chebyshev(a: Cell, b: Cell): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}

/** A cell an agent may stand on at spawn: walkable or a gentle ramp, never a building, hole or void. */
export function isStandable(cell: NavCell | undefined): cell is NavCell {
  return cell !== undefined && (cell.type === 'walkable' || cell.type === 'ramp');
}

/** The site's middle, in cells — what the crew's route out of the rally area is measured against. */
function siteCentre(navGrid: NavGrid): Cell {
  return {
    x: navGrid.originX + Math.floor(navGrid.width / 2),
    z: navGrid.originZ + Math.floor(navGrid.height / 2),
  };
}

/**
 * Height spread, in metres, of the square of side `2 * radius + 1` centred on
 * (x, z); `Infinity` when any cell of it is off the grid or cannot be stood on.
 * The rally area must be flat ground through and through, not merely a flat
 * centre cell on a slope.
 */
export function rallyAreaHeightSpread(navGrid: NavGrid, x: number, z: number, radius: number = RALLY_POINT_FLAT_RADIUS): number {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const cell = navGrid.containsCell(x + dx, z + dz) ? navGrid.cellAt(x + dx, z + dz) : undefined;
      if (!isStandable(cell)) return Number.POSITIVE_INFINITY;
      const y = cell.surfaceY ?? 0;
      if (y < min) min = y;
      if (y > max) max = y;
    }
  }
  return max - min;
}

/**
 * Where the site's flag goes: the flat area nearest `preferred`.
 *
 * A candidate is the centre of a square of radius `RALLY_POINT_FLAT_RADIUS`
 * whose height spread is at most `RALLY_POINT_MAX_HEIGHT_SPREAD_M`, on the
 * site's main ground (climb-connected to the site's middle at vehicle
 * clearance, so the fleet that spawns there can drive out), with a route to
 * the site's middle that is not a detour. Candidates are tried nearest
 * `preferred` first. When no flat area exists at all, the flattest one on the
 * main ground wins, so a rugged site still gets the best ground it has.
 */
export function chooseRallyPoint(navGrid: NavGrid, preferred: { x: number; z: number }, _options: RallyPointOptions = {}): RallyPoint {
  const centre = siteCentre(navGrid);
  const main = findNearestNavigableCell(navGrid, centre.x, centre.z);
  const components = computeClimbComponents(navGrid, NAV_CLEARANCE_VEHICLE_CELLS);
  const target = { x: Math.round(preferred.x), z: Math.round(preferred.z) };

  const candidates: Array<Cell & { spread: number; distSq: number }> = [];
  for (let z = navGrid.originZ; z < navGrid.originZ + navGrid.height; z++) {
    for (let x = navGrid.originX; x < navGrid.originX + navGrid.width; x++) {
      const spread = rallyAreaHeightSpread(navGrid, x, z);
      if (!Number.isFinite(spread)) continue;
      if (!components.canReach(main.x, main.z, x, z)) continue;
      candidates.push({ x, z, spread, distSq: (x - target.x) ** 2 + (z - target.z) ** 2 });
    }
  }
  if (candidates.length === 0) return findNearestNavigableCell(navGrid, target.x, target.z);

  // Nearest first; z then x break ties so the pick never depends on scan order.
  candidates.sort((a, b) => a.distSq - b.distSq || a.z - b.z || a.x - b.x);

  const flat = candidates.filter(c => c.spread <= RALLY_POINT_MAX_HEIGHT_SPREAD_M);
  let checks = 0;
  for (const candidate of flat) {
    if (checks++ >= RALLY_POINT_MAX_ROUTE_CHECKS) break;
    if (isRouteAcceptable(navGrid, candidate, main)) return { x: candidate.x, z: candidate.z };
  }
  const best = flat[0] ?? candidates.reduce((a, b) => (b.spread < a.spread ? b : a));
  return { x: best.x, z: best.z };
}

/**
 * The site's rally point, choosing and recording one when the state has none
 * (a fresh game, or a save from before the flag existed). Null without a grid.
 */
export function ensureRallyPoint(state: Pick<GameState, 'navGrid' | 'rallyPoint'>, preferred?: { x: number; z: number }, options: RallyPointOptions = {}): RallyPoint | null {
  if (state.rallyPoint) return state.rallyPoint;
  const navGrid = state.navGrid;
  if (!navGrid) return null;
  state.rallyPoint = chooseRallyPoint(navGrid, preferred ?? siteCentre(navGrid), options);
  return state.rallyPoint;
}

/**
 * Cells reachable on foot from `start` over standable ground by legal climbs,
 * in breadth-first discovery order — nearest first — capped at `limit`. Every
 * cell returned is connected to `start`, and to every other cell in it, by a
 * route `findPath` can resolve: the point of spawning from this list rather
 * than from fixed coordinates. Bounded because only the first handful of
 * cells is ever used. `start` itself is always expanded,
 * even when it cannot be stood on (a drill hole beside the flag), so a flag
 * next to one still finds the ground around it.
 */
export function rallyConnectedCells(navGrid: NavGrid, start: Cell, limit: number = RALLY_POINT_SPAWN_SEARCH_LIMIT): Cell[] {
  const found: Cell[] = [];
  const seen = new Set<string>([cellKey(start)]);
  const queue: Cell[] = [start];
  for (let head = 0; head < queue.length && found.length < limit; head++) {
    const current = queue[head] as Cell;
    const currentCell = navGrid.cellAt(current.x, current.z);
    if (currentCell === undefined) continue;
    if (isStandable(currentCell)) found.push(current);
    else if (head > 0) continue;
    for (const [dx, dz] of NEIGHBOUR_OFFSETS) {
      const next = { x: current.x + dx, z: current.z + dz };
      if (seen.has(cellKey(next))) continue;
      const nextCell = navGrid.cellAt(next.x, next.z);
      if (!isStandable(nextCell)) continue;
      if (!isStepClimbable(currentCell.surfaceY, nextCell.surfaceY, dx !== 0 && dz !== 0 ? Math.SQRT2 : 1)) continue;
      seen.add(cellKey(next));
      queue.push(next);
    }
  }
  return found;
}

/** Whether a vehicle parked on `cell` stands on level ground: its 3x3 neighbourhood is within the rally area's flatness. */
export function isFlatParkingCell(navGrid: NavGrid, cell: Cell): boolean {
  return rallyAreaHeightSpread(navGrid, cell.x, cell.z, 1) <= RALLY_POINT_MAX_HEIGHT_SPREAD_M;
}

/**
 * Where a newcomer appears: the free navigable cell nearest the rally point.
 *
 * Free means no employee, vehicle or fragment stands on it. A vehicle also
 * keeps `RALLY_POINT_VEHICLE_STANDOFF` cells from the flag and
 * `CREW_SPAWN_VEHICLE_SEPARATION` from every other vehicle, needs
 * `CREW_SPAWN_VEHICLE_MIN_OPEN_NEIGHBOURS` legal ways out at vehicle
 * clearance so it is never born boxed in, and is parked on level ground
 * (`isFlatParkingCell`) wherever any is free. An employee only avoids the
 * flag's own cell. The search starts from the cell of the site's main ground
 * nearest the flag, so a flag the player's own blasts have left on an island
 * still spawns everyone where they can reach work. When nothing nearby
 * qualifies, that cell is the answer. Without a grid (a state that never had
 * terrain) the site centre is returned.
 */
export function rallySpawnCell(
  state: Pick<GameState, 'navGrid' | 'rallyPoint' | 'employees' | 'vehicles' | 'world'>,
  kind: RallySpawnKind,
): { x: number; z: number } {
  const navGrid = state.navGrid;
  if (!navGrid) {
    const world = state.world;
    return world ? { x: world.minX + world.sizeX / 2, z: world.minZ + world.sizeZ / 2 } : { x: 32, z: 32 };
  }
  const flag = ensureRallyPoint(state) ?? siteCentre(navGrid);
  const start = findNearestNavigableCell(navGrid, flag.x, flag.z);

  const vehicleCells = state.vehicles.vehicles.map(v => ({ x: Math.round(v.x), z: Math.round(v.z) }));
  const taken = new Set<string>([
    ...vehicleCells.map(cellKey),
    ...state.employees.employees.map(e => cellKey({ x: Math.round(e.x), z: Math.round(e.z) })),
  ]);
  const minFromFlag = kind === 'vehicle' ? RALLY_POINT_VEHICLE_STANDOFF : 1;
  const isFree = (cell: Cell): boolean => {
    if (taken.has(cellKey(cell)) || chebyshev(cell, flag) < minFromFlag) return false;
    const navCell = navGrid.cellAt(cell.x, cell.z) as NavCell;
    if (navCell.vehicleOccupied || (navCell.fragmentOccupancy ?? 0) > 0) return false;
    if (kind === 'employee') return true;
    return vehicleCells.every(v => chebyshev(v, cell) >= CREW_SPAWN_VEHICLE_SEPARATION)
      && countLegalStepNeighbours(navGrid, cell.x, cell.z, NAV_CLEARANCE_VEHICLE_CELLS) >= CREW_SPAWN_VEHICLE_MIN_OPEN_NEIGHBOURS;
  };

  const cells = rallyConnectedCells(navGrid, start);
  const level = kind === 'vehicle' ? cells.find(c => isFree(c) && isFlatParkingCell(navGrid, c)) : undefined;
  return level ?? cells.find(isFree) ?? start;
}
