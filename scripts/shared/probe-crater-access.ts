// BlastSimulator2026 — Progression probe: pit logistics, the player's job (#2045, #2095)
//
// Core never orders or repairs a ramp by itself: a shot that cuts into a ramp leaves it too steep, and a
// crater deepened past the built ramps leaves its rubble `debris_out_of_reach` and its planned holes
// `buried_under_rubble`; the game only says so. The probe plays a careful player here, through the
// console and out of its own cash: it repairs a ramp a shot damaged (`repair_ramp`), and when enough
// of its orders read out of reach it plans a ramp down to the stranded floor with the pure
// `planCraterAccess` planner and orders it (`build_ramp`).

import type { GameState, PendingAction } from '../../src/core/state/GameState.js';
import { computeVoxelColumnSurfaceHeight, type VoxelGrid } from '../../src/core/world/VoxelGrid.js';
import { clusterStrandedFloors, planCraterAccess, type AccessSurface, type StrandedFloor } from '../../src/core/mining/CraterAccess.js';
import { rampPathCells, rampPathOf, rampTotalLength, rampWaypoints, type RampFootprint } from '../../src/core/mining/RampPath.js';
import { rampFloorDepthAt, rampWidthOf, type RampDef } from '../../src/core/mining/Ramp.js';
import { rampFootprint } from '../../src/core/mining/RampWidening.js';
import { NavGrid, type NavCell } from '../../src/core/nav/NavGrid.js';
import { computeClimbComponents } from '../../src/core/nav/NavGridReachability.js';
import { vehicleMaxSlopeRatio } from '../../src/core/entities/Vehicle.js';
import { isProgressionSite } from '../../src/core/state/GameState.js';
import { siteVehicleReach, strandedDebrisTargets } from '../../src/core/engine/OrderReachability.js';
import { quoteRampRepair } from '../../src/core/mining/RampRepair.js';
import { buildingFootprintOccupants } from '../../src/core/nav/NavGridSync.js';
import { isBuildingFootprintCell } from '../../src/core/entities/Building.js';
import { getOperatingCostPerHour } from '../../src/core/economy/OperatingFinance.js';
import { CRATER_ACCESS_CLUSTER_GAP_CELLS, NAV_CLEARANCE_VEHICLE_CELLS, RAMP_DEFAULT_WIDTH, VEHICLE_MAX_SLOPE_RATIO } from '../../src/core/config/balance.js';
import type { ProtectedZone } from './probe-ladder-policy.js';

type Run = (cmd: string) => { success: boolean; output: string };

/** Stranded orders on one floor before the probe spends on a ramp down to it. */
const ACCESS_MIN_STRANDED_ORDERS = 3;
/** Ticks of payroll the probe keeps in cash after paying for an access ramp. */
export const ACCESS_CASH_RESERVE_TICKS = 200;
/** Ticks between two looks at the stranded floors. */
export const ACCESS_RECHECK_TICKS = 50;

/**
 * Metres a shot's footprint keeps clear of a built ramp: one hole spacing of broken burden past the outer holes. The
 * player keeps a ramp out of a shot rather than repair it after (#2045).
 */
export const RAMP_SHOT_KEEP_OUT_M = 4;

/** A floor within this many cells, and this many metres of depth, of one already ramped is that same floor. */
const SAME_FLOOR_CELLS = CRATER_ACCESS_CLUSTER_GAP_CELLS * 2;
const SAME_FLOOR_M = 1;

/** A floor the probe ordered a ramp down to, and that ramp's planned-ramp id. */
interface ServedFloor { floor: StrandedFloor; rampId: number }

/**
 * What the probe remembers between looks: the last look, a world it already failed to plan for, the floors it
 * already ramped down to and the footprints of ramps it gave up on. Rubble a ramp left out of reach on such a
 * floor sits on a lump or a ledge the shot left standing: the player levels it or leaves it, and does not dig
 * another ramp to the same floor. A ramp whose every remaining segment is stuck is cancelled (its unspent cost
 * refunded) and its footprint avoided, and its floor may be planned again.
 */
export interface CraterAccessMemory {
  lastTick: number;
  failedSignature: string | null;
  served: ServedFloor[];
  avoid: RampFootprint[];
  /** Nav-grid revision of the last look at the built ramps for damage; they are looked at again once the terrain changes. */
  repairRevision: number;
  /** Built ramps whose repair got stuck out of every digger's reach and was cancelled: the player gives up on them. */
  unrepairable: number[];
}

export function newCraterAccessMemory(): CraterAccessMemory {
  return { lastTick: -Infinity, failedSignature: null, served: [], avoid: [], repairRevision: -1, unrepairable: [] };
}

/** True when the probe already ordered a ramp down to `floor` (or one beside it at the same depth). */
export function rampedAlready(memory: Pick<CraterAccessMemory, 'served'>, floor: StrandedFloor): boolean {
  return memory.served.some(({ floor: f }) => Math.abs(f.x - floor.x) <= SAME_FLOOR_CELLS && Math.abs(f.z - floor.z) <= SAME_FLOOR_CELLS
    && Math.abs(f.floorY - floor.floorY) < SAME_FLOOR_M);
}

/**
 * Cancels the probe's ramps that are stuck, remembering their footprints, and frees their floors for another plan. A
 * stuck repair is cancelled too, and its ramp left as it is: a shot cut it off from every digger.
 */
function dropStuckRamps(run: Run, state: GameState, memory: CraterAccessMemory): void {
  const stuck = new Set(stuckRampFootprints(state));
  if (stuck.size === 0) return;
  for (const served of [...memory.served]) {
    const ramp = state.plannedRamps.find(r => r.id === served.rampId);
    if (ramp === undefined || !stuck.has(ramp.footprint)) continue;
    run(`build_ramp cancel ${ramp.id}`);
    memory.avoid.push(ramp.footprint);
    memory.served.splice(memory.served.indexOf(served), 1);
  }
  for (const repair of state.plannedRamps.filter(p => p.repairOf !== undefined && stuck.has(p.footprint))) {
    run(`build_ramp cancel ${repair.id}`);
    memory.unrepairable.push(repair.repairOf!);
  }
}

/** True for a dig_ramp_segment order nobody holds that classification stamped blocked: it is going nowhere. */
function isStuckRampSegment(a: PendingAction): boolean {
  return a.type === 'dig_ramp_segment' && a.holderId === null && a.status === 'queued' && (a.blockedReason ?? null) !== null;
}

/** True while some ramp the probe ordered is still being dug: one way in at a time. */
export function hasLiveRampWork(pending: ReadonlyArray<PendingAction>): boolean {
  return pending.some(a => a.type === 'dig_ramp_segment' && !isStuckRampSegment(a));
}

/** Footprints of planned ramps whose every remaining segment is stuck; a new plan steers clear of them. */
export function stuckRampFootprints(state: Pick<GameState, 'plannedRamps' | 'pendingActions'>): RampFootprint[] {
  const stuck = new Set(state.pendingActions.filter(isStuckRampSegment).map(a => a.id));
  if (stuck.size === 0) return [];
  return state.plannedRamps
    .filter(r => { const left = r.segments.filter(s => !s.done); return left.length > 0 && left.every(s => stuck.has(s.actionId)); })
    .map(r => r.footprint);
}

/**
 * The terrain a ramp can start from: ground a vehicle drives to from the rally point, and the tiles rubble lies on. A
 * ramp is never planned over a building or a building still to be raised: the console refuses it, and a building raised
 * on a ramp blocks it.
 */
function accessSurface(state: GameState, grid: VoxelGrid): AccessSurface | null {
  const reach = siteVehicleReach(state);
  const nav = state.navGrid;
  if (reach === null || nav === null) return null;
  const rubble = new Set(state.logistics.fragments.filter(f => f.state === 'on_ground')
    .map(f => `${Math.round(f.fragment.position.x)},${Math.round(f.fragment.position.z)}`));
  const buildings = buildingFootprintOccupants(state);
  return {
    heightAt: (x, z) => computeVoxelColumnSurfaceHeight(grid, x, z),
    contains: (x, z) => grid.containsColumn(x, z) && (nav.cellAt(x, z)?.type ?? 'void') !== 'void'
      && !buildings.some(b => isBuildingFootprintCell(b, x, z)),
    reachableFrom: reach,
    holdsRubble: (x, z) => rubble.has(`${x},${z}`),
  };
}

/**
 * Floors of the stranded orders, most orders first, each target's y read from the terrain. A target the
 * vehicle network reaches now is skipped: its stamp lags a ramp that just connected the crater.
 */
function strandedFloors(state: GameState, grid: VoxelGrid, surface: AccessSurface): StrandedFloor[] {
  const cells = strandedDebrisTargets(state)
    .filter(t => !surface.reachableFrom(Math.round(t.x), Math.round(t.z)))
    .map(t => {
      const y = computeVoxelColumnSurfaceHeight(grid, Math.round(t.x), Math.round(t.z));
      return { x: t.x, z: t.z, y: Number.isFinite(y) ? y : t.y };
    });
  return clusterStrandedFloors(cells, CRATER_ACCESS_CLUSTER_GAP_CELLS)
    .filter(f => f.orderCount >= ACCESS_MIN_STRANDED_ORDERS)
    .sort((a, b) => b.orderCount - a.orderCount);
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

function signatureOf(state: GameState, floors: readonly StrandedFloor[], avoid: readonly RampFootprint[]): string {
  return `${state.navGrid?.revision ?? -1}|${avoid.map(a => `${a.minX},${a.maxX},${a.minZ},${a.maxZ}`).join(';')}|${floors.map(f => `${f.x},${f.z},${f.floorY},${f.orderCount}`).join(';')}`;
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

/** A plan down to `floor`, facing its nearest depot, whose dig keeps the vehicle network whole (`keepsVehicleNetwork`), or null. */
function planKeepingRoads(
  state: GameState, grid: VoxelGrid, floor: StrandedFloor, surface: AccessSurface, avoid: readonly RampFootprint[],
): { def: RampDef; cost: number } | null {
  const setAside = [...avoid];
  const toward = nearestHaulDepot(state, floor);
  for (let attempt = 0; attempt < ACCESS_PLAN_ATTEMPTS; attempt++) {
    const plan = planCraterAccess(floor, surface, VEHICLE_MAX_SLOPE_RATIO, RAMP_DEFAULT_WIDTH, setAside, state.builtRamps, toward);
    if (!plan.ok) return null;
    if (keepsVehicleNetwork(state, grid, plan.def)) return plan;
    setAside.push(rampFootprint(plan.def, rampWidthOf(plan.def)));
  }
  return null;
}

/**
 * Orders at most one access ramp, down to the stranded floor with the most orders, every
 * ACCESS_RECHECK_TICKS. One ramp per floor (`rampedAlready`), nothing while a ramp is still being dug, nothing the cash cannot cover with
 * ACCESS_CASH_RESERVE_TICKS of payroll to spare, and a world it already failed to plan for is not
 * planned again until the terrain or the floors change. Returns the order's console output, or null.
 */
export function orderCraterAccess(run: Run, state: GameState, grid: VoxelGrid, memory: CraterAccessMemory): string | null {
  if (state.tickCount - memory.lastTick < ACCESS_RECHECK_TICKS && state.tickCount >= memory.lastTick) return null;
  memory.lastTick = state.tickCount;
  dropStuckRamps(run, state, memory);
  if (hasLiveRampWork(state.pendingActions)) return null;
  const surface = accessSurface(state, grid);
  if (surface === null) return null;
  const floors = strandedFloors(state, grid, surface).filter(f => !rampedAlready(memory, f));
  if (floors.length === 0) { memory.failedSignature = null; return null; }
  const avoid = [...stuckRampFootprints(state), ...memory.avoid];
  const signature = signatureOf(state, floors, avoid);
  if (signature === memory.failedSignature) return null;

  const reserve = getOperatingCostPerHour(state).payroll * ACCESS_CASH_RESERVE_TICKS;
  let unaffordable = false;
  for (const floor of floors) {
    const plan = planKeepingRoads(state, grid, floor, surface, avoid);
    if (plan === null) continue;
    if (state.cash - plan.cost < reserve) { unaffordable = true; continue; }
    const ordered = run(buildRampCommand(plan.def));
    if (ordered.success) {
      memory.failedSignature = null;
      memory.served.push({ floor, rampId: state.plannedRamps.at(-1)!.id });
      return ordered.output;
    }
  }
  // Only a world with nothing buildable is remembered; an unaffordable plan is retried as cash changes.
  memory.failedSignature = unaffordable ? null : signature;
  return null;
}

/**
 * Orders a repair of each built ramp a shot damaged (`quoteRampRepair`), once per terrain change, when the cash
 * covers it with ACCESS_CASH_RESERVE_TICKS of payroll to spare. A ramp a deeper floor put out of reach, or whose repair
 * got stuck (`unrepairable`), is left: `orderCraterAccess` plans a new way down. Returns the console outputs of the orders placed.
 */
function repairDamagedRamps(run: Run, state: GameState, grid: VoxelGrid, memory: CraterAccessMemory): string[] {
  const revision = state.navGrid?.revision ?? -1;
  if (revision === memory.repairRevision) return [];
  memory.repairRevision = revision;
  const reserve = getOperatingCostPerHour(state).payroll * ACCESS_CASH_RESERVE_TICKS;
  const outputs: string[] = [];
  for (const ramp of state.builtRamps) {
    if (memory.unrepairable.includes(ramp.id)) continue;
    if (state.plannedRamps.some(p => p.repairOf === ramp.id || p.widenOf === ramp.id)) continue;
    const quote = quoteRampRepair(grid, ramp);
    if (!quote.success || state.cash - quote.data.cost < reserve) continue;
    const ordered = run(`repair_ramp id:${ramp.id}`);
    if (ordered.success) outputs.push(ordered.output);
  }
  return outputs;
}

/** Ground a shot keeps off: every built ramp's footprint grown by RAMP_SHOT_KEEP_OUT_M on each side. */
export function rampKeepOutZones(state: Pick<GameState, 'builtRamps'>): ProtectedZone[] {
  const m = RAMP_SHOT_KEEP_OUT_M;
  return state.builtRamps.map(({ footprint: f }) => ({
    x: f.minX - m, z: f.minZ - m, span: f.maxX - f.minX + 1 + 2 * m, spanZ: f.maxZ - f.minZ + 1 + 2 * m,
  }));
}

/** The player's pit logistics for one decision interval: repair what a shot damaged, then open what it stranded. */
export function playPitLogistics(run: Run, state: GameState, grid: VoxelGrid, memory: CraterAccessMemory): void {
  repairDamagedRamps(run, state, grid, memory);
  orderCraterAccess(run, state, grid, memory);
}
