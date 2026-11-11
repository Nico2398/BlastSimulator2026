// BlastSimulator2026 — Access ramps into a crater that stranded rubble: the floors, the plan, the order (#2045, #2144)
// Pure reads of GameState: nothing here orders, charges or digs. The progression probe orders what this plans; the
// player's offer (`proposeAccessRamp`) shows it first.

import type { GameState } from '../state/GameState.js';
import { computeVoxelColumnSurfaceHeight, type VoxelGrid } from '../world/VoxelGrid.js';
import { clusterStrandedFloors, planCraterAccess, type AccessSurface, type StrandedFloor } from './CraterAccess.js';
import { rampPathCells, rampPathOf, rampTotalLength, rampWaypoints, type RampFootprint } from './RampPath.js';
import { rampFloorDepthAt, rampWidthOf, type RampDef } from './Ramp.js';
import { rampFootprint } from './RampWidening.js';
import { NavGrid, type NavCell } from '../nav/NavGrid.js';
import { computeClimbComponents } from '../nav/NavGridReachability.js';
import { vehicleMaxSlopeRatio } from '../entities/Vehicle.js';
import { isProgressionSite } from '../state/GameState.js';
import { siteVehicleReach, strandedDebrisTargets } from '../engine/OrderReachability.js';
import { buildingFootprintOccupants } from '../nav/NavGridSync.js';
import { isBuildingFootprintCell } from '../entities/Building.js';
import { CRATER_ACCESS_CLUSTER_GAP_CELLS, CRATER_ACCESS_MIN_DROP_M, RAMP_CRATER_MIN_DROP_M, NAV_CLEARANCE_EMPLOYEE_CELLS, NAV_CLEARANCE_VEHICLE_CELLS, NAV_MAX_SLOPE_RATIO, RAMP_DEFAULT_WIDTH, VEHICLE_MAX_SLOPE_RATIO } from '../config/balance.js';

/** Stranded orders on one floor before a ramp down to it is worth proposing or ordering. */
const ACCESS_MIN_STRANDED_ORDERS = 3;

/**
 * The terrain a ramp can start from: ground a vehicle drives to from the rally point, and the tiles rubble lies on. A
 * ramp is never planned over a building or a building still to be raised: the console refuses it, and a building raised
 * on a ramp blocks it.
 */
export function accessSurface(state: GameState, grid: VoxelGrid): AccessSurface | null {
  const reach = siteVehicleReach(state);
  const nav = state.navGrid;
  if (reach === null || nav === null) return null;
  // The cells rubble lies on (`addFragmentFootprint`): what blocks a ramp's way.
  const holdsRubbleAt = (x: number, z: number): boolean => (nav.cellAt(x, z)?.fragmentOccupancy ?? 0) > 0;
  const buildings = buildingFootprintOccupants(state);
  return {
    heightAt: (x, z) => computeVoxelColumnSurfaceHeight(grid, x, z),
    contains: (x, z) => grid.containsColumn(x, z) && (nav.cellAt(x, z)?.type ?? 'void') !== 'void'
      && !buildings.some(b => isBuildingFootprintCell(b, x, z)),
    reachableFrom: reach,
    holdsRubble: holdsRubbleAt,
  };
}

/**
 * Crew on foot the rally point's walkers cannot reach, and vehicles off its vehicle network: they cannot leave a blast
 * zone. Two drivers and a digger left on a rib between two craters disarmed every later shot whose zone took them in,
 * and the game frees no one (#2095): the player digs them out.
 */
export function strandedCrew(state: GameState): Array<{ x: number; z: number }> {
  const nav = state.navGrid;
  const reach = siteVehicleReach(state);
  if (nav === null || state.rallyPoint === undefined || reach === null) return [];
  const walkers = computeClimbComponents(nav, NAV_CLEARANCE_EMPLOYEE_CELLS, NAV_MAX_SLOPE_RATIO).reachableFrom([state.rallyPoint]);
  const out: Array<{ x: number; z: number }> = [];
  for (const e of state.employees.employees) {
    if (e.alive && e.locomotion.kind === 'on_foot' && !walkers.has(Math.round(e.x), Math.round(e.z))) out.push({ x: e.x, z: e.z });
  }
  for (const v of state.vehicles.vehicles) {
    if (!reach(Math.round(v.x), Math.round(v.z))) out.push({ x: v.x, z: v.z });
  }
  return out;
}

/** `strandedCrew`, each counted as ACCESS_MIN_STRANDED_ORDERS targets: reaching them is worth a ramp by itself. */
function strandedCrewTargets(state: GameState): Array<{ x: number; z: number; y: number }> {
  return strandedCrew(state).flatMap(p => Array.from({ length: ACCESS_MIN_STRANDED_ORDERS }, () => ({ x: p.x, z: p.z, y: 0 })));
}

/** A stranded floor, and whether crew or a vehicle stands stranded on it (they need a way out however shallow). */
type AccessFloor = StrandedFloor & { holdsCrew: boolean };

/**
 * Floors of the stranded orders, those holding stranded crew first, then most orders first, each target's y read from
 * the terrain. A target the vehicle network reaches now is skipped: its stamp lags a ramp that just connected the crater.
 */
export function strandedFloors(state: GameState, grid: VoxelGrid, surface: AccessSurface): AccessFloor[] {
  const crew = strandedCrewTargets(state).filter(t => !surface.reachableFrom(Math.round(t.x), Math.round(t.z)));
  const holdsCrew = (f: StrandedFloor): boolean => crew.some(t =>
    Math.max(Math.abs(t.x - f.x), Math.abs(t.z - f.z)) <= CRATER_ACCESS_CLUSTER_GAP_CELLS);
  const cells = [...strandedDebrisTargets(state), ...crew]
    .filter(t => !surface.reachableFrom(Math.round(t.x), Math.round(t.z)))
    .map(t => {
      const y = computeVoxelColumnSurfaceHeight(grid, Math.round(t.x), Math.round(t.z));
      return { x: t.x, z: t.z, y: Number.isFinite(y) ? y : t.y };
    });
  return clusterStrandedFloors(cells, CRATER_ACCESS_CLUSTER_GAP_CELLS)
    .filter(f => f.orderCount >= ACCESS_MIN_STRANDED_ORDERS)
    .map(f => ({ ...f, holdsCrew: holdsCrew(f) }))
    // People first: crew who cannot leave a blast zone refuse every shot near them, whatever rubble waits elsewhere.
    .sort((a, b) => Number(b.holdsCrew) - Number(a.holdsCrew) || b.orderCount - a.orderCount);
}

/** The console order that builds `def`: its waypoints as a path, its depth, width and any chosen grade. */
export function buildRampCommand(def: RampDef): string {
  const path = rampWaypoints(rampPathOf(def)).map(w => `${w.x},${w.z}`).join(';');
  const grade = def.gradeDegrees === undefined ? '' : ` grade:${def.gradeDegrees}`;
  return `build_ramp path:${path} depth:${def.targetDepth} width:${rampWidthOf(def)}${grade}`;
}

/** `nav` with the corridor of `def` set to its line: the ground vehicles will drive once the ramp is dug. */
function navAfterRamp(nav: NavGrid, grid: VoxelGrid, def: RampDef): NavGrid {
  const cells: NavCell[][] = [];
  for (let z = 0; z < nav.height; z++) {
    const row: NavCell[] = [];
    for (let x = 0; x < nav.width; x++) row.push({ ...nav.cellAt(nav.originX + x, nav.originZ + z)! });
    cells.push(row);
  }
  const after = new NavGrid(nav.width, nav.height, cells, nav.maxSurfaceY, nav.originX, nav.originZ, nav.maxClimbY);
  const path = rampPathOf(def);
  const total = rampTotalLength(path.legs);
  const start = computeVoxelColumnSurfaceHeight(grid, def.originX, def.originZ);
  for (const c of rampPathCells(path, rampWidthOf(def))) {
    const cell = after.cellAt(c.x, c.z);
    if (cell !== undefined) cell.surfaceY = start - rampFloorDepthAt(c.step, total, def.targetDepth, def.gradeDegrees);
  }
  return after;
}

/** Cells of the rally point's vehicle network on `nav`, keyed `x,z`. */
function networkCells(state: GameState, nav: NavGrid): Set<string> {
  const out = new Set<string>();
  if (state.rallyPoint === undefined) return out;
  const ratio = vehicleMaxSlopeRatio(isProgressionSite(state));
  const network = computeClimbComponents(nav, NAV_CLEARANCE_VEHICLE_CELLS, ratio).reachableFrom([state.rallyPoint]);
  for (let z = nav.originZ; z < nav.maxZ; z++) {
    for (let x = nav.originX; x < nav.maxX; x++) if (network.has(x, z)) out.add(`${x},${z}`);
  }
  return out;
}

/** Cells of today's vehicle network a dug ramp may leave off it (the rim cells its trench walls stand on). */
const ACCESS_SEVER_TOLERANCE_CELLS = 25;

/**
 * True when digging `def` keeps today's vehicle network whole: at most ACCESS_SEVER_TOLERANCE_CELLS of the cells the
 * rally point's vehicles reach now fall off it, the corridor itself aside. A trench cut along the one gentle slope
 * between the rally and the rest of the site walls the rally and its depots off from every pit (#2045): the player
 * never cuts their own road.
 */
export function keepsVehicleNetwork(state: GameState, grid: VoxelGrid, def: RampDef): boolean {
  const nav = state.navGrid;
  if (nav === null) return true;
  const before = networkCells(state, nav);
  if (before.size === 0) return true;
  const after = networkCells(state, navAfterRamp(nav, grid, def));
  const corridor = new Set(rampPathCells(rampPathOf(def), rampWidthOf(def)).map(c => `${c.x},${c.z}`));
  let severed = 0;
  for (const key of before) if (!after.has(key) && !corridor.has(key)) severed++;
  return severed <= ACCESS_SEVER_TOLERANCE_CELLS;
}

/** Plans tried for one floor before it is given up: a plan that cuts the network is set aside and the floor planned again. */
const ACCESS_PLAN_ATTEMPTS = 4;

/** Buildings a crater's loads are hauled to: ore to a freight warehouse, waste to a spoil heap. */
const HAUL_DEPOTS: ReadonlySet<string> = new Set(['freight_warehouse', 'spoil_heap']);

/** The haul depot nearest `floor`, where its access ramp should face; null on a site with none. */
export function nearestHaulDepot(state: Pick<GameState, 'buildings'>, floor: { x: number; z: number }): { x: number; z: number } | null {
  let best: { x: number; z: number } | null = null;
  let bestDistance = Infinity;
  for (const b of state.buildings.buildings) {
    if (!HAUL_DEPOTS.has(b.type)) continue;
    const distance = Math.hypot(b.x - floor.x, b.z - floor.z);
    if (distance < bestDistance) { best = { x: b.x, z: b.z }; bestDistance = distance; }
  }
  return best;
}

/** Longest ramp (m) the probe cuts to free crew stranded on ground shallower than a dug crater: a notch, never a trench. */
const ACCESS_RESCUE_MAX_RUN_M = 10;

/**
 * A plan down to `floor`, facing its nearest depot, whose dig keeps the vehicle network whole (`keepsVehicleNetwork`), or
 * null. A floor holding stranded crew gets the shortest ramp instead, however shallow (`CRATER_ACCESS_MIN_DROP_M`), a
 * shallow one at most ACCESS_RESCUE_MAX_RUN_M long; rubble on a floor shallower than a dug crater is left. Shallow plans
 * for every floor, and a 90 m trench planned for a metre's drop, cost the Shareholder Summit ladder its win.
 */
export function planKeepingRoads(
  state: GameState, grid: VoxelGrid, floor: AccessFloor, surface: AccessSurface, avoid: readonly RampFootprint[],
  refusal?: { reasonKey: string },
): { def: RampDef; cost: number } | null {
  const plan = (toward: { x: number; z: number } | null, minDropM: number): { def: RampDef; cost: number } | null => {
    const setAside = [...avoid];
    for (let attempt = 0; attempt < ACCESS_PLAN_ATTEMPTS; attempt++) {
      const planned = planCraterAccess(floor, surface, VEHICLE_MAX_SLOPE_RATIO, RAMP_DEFAULT_WIDTH, setAside, state.builtRamps, toward, minDropM);
      if (!planned.ok) { if (refusal) refusal.reasonKey = planned.reasonKey; return null; }
      if (keepsVehicleNetwork(state, grid, planned.def)) return planned;
      setAside.push(rampFootprint(planned.def, rampWidthOf(planned.def)));
    }
    if (refusal) refusal.reasonKey = 'mining.crater_access.severs_network';
    return null;
  };
  if (!floor.holdsCrew) return plan(nearestHaulDepot(state, floor), RAMP_CRATER_MIN_DROP_M);
  const rescue = plan(null, CRATER_ACCESS_MIN_DROP_M);
  if (rescue === null) return null;
  const shallow = rescue.def.targetDepth < RAMP_CRATER_MIN_DROP_M;
  return !shallow || rampTotalLength(rampPathOf(rescue.def).legs) <= ACCESS_RESCUE_MAX_RUN_M ? rescue : null;
}
