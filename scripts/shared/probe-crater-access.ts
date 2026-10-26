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
import { getVehicleDefByTier, vehicleMaxSlopeRatio } from '../../src/core/entities/Vehicle.js';
import { isProgressionSite } from '../../src/core/state/GameState.js';
import { siteVehicleReach, strandedDebrisTargets } from '../../src/core/engine/OrderReachability.js';
import { quoteRampRepair } from '../../src/core/mining/RampRepair.js';
import { buildingFootprintOccupants } from '../../src/core/nav/NavGridSync.js';
import { isBuildingFootprintCell } from '../../src/core/entities/Building.js';
import { getOperatingCostPerHour } from '../../src/core/economy/OperatingFinance.js';
import { CRATER_ACCESS_CLUSTER_GAP_CELLS, CRATER_ACCESS_MIN_DROP_M, RAMP_CRATER_MIN_DROP_M, NAV_CLEARANCE_EMPLOYEE_CELLS, NAV_CLEARANCE_VEHICLE_CELLS, NAV_MAX_SLOPE_RATIO, RAMP_DEFAULT_WIDTH, VEHICLE_MAX_SLOPE_RATIO } from '../../src/core/config/balance.js';
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

/** A floor the probe ordered a ramp down to, that ramp's planned-ramp id, and its footprint (how the built ramp is found again). */
interface ServedFloor { floor: StrandedFloor; rampId: number; footprint: RampFootprint }

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
  /** Per planned ramp id: segments done at the last look, and since when that count has stood. */
  progress: Record<number, { done: number; sinceTick: number }>;
}

export function newCraterAccessMemory(): CraterAccessMemory {
  return { lastTick: -Infinity, failedSignature: null, served: [], avoid: [], repairRevision: -1, unrepairable: [], progress: {} };
}

/**
 * Ticks a planned ramp may go without a finished segment before the player gives up on it like a stuck one. A digger
 * that cannot reach the cut claims it, fails and releases it over and over with no blocked reason stamped: on the
 * seed-42 full-kit ladder a repair and a widening did that for 1,000+ ticks, and while they stood as ramp work in hand
 * no access ramp was planned, not even the one out to the stranded digger.
 */
export const ACCESS_RAMP_STALL_TICKS = 600;

/** Footprints of planned ramps that finished no segment for ACCESS_RAMP_STALL_TICKS; records each ramp's progress. */
export function stalledRampFootprints(
  state: Pick<GameState, 'plannedRamps' | 'tickCount'>, memory: Pick<CraterAccessMemory, 'progress'>,
): RampFootprint[] {
  const stalled: RampFootprint[] = [];
  const live = new Set<number>();
  for (const ramp of state.plannedRamps) {
    live.add(ramp.id);
    const done = ramp.segments.filter(seg => seg.done).length;
    const seen = memory.progress[ramp.id];
    if (seen === undefined || seen.done !== done) memory.progress[ramp.id] = { done, sinceTick: state.tickCount };
    else if (state.tickCount - seen.sinceTick >= ACCESS_RAMP_STALL_TICKS) stalled.push(ramp.footprint);
  }
  for (const id of Object.keys(memory.progress)) if (!live.has(Number(id))) delete memory.progress[Number(id)];
  return stalled;
}

/** True when the probe already ordered a ramp down to `floor` (or one beside it at the same depth). */
export function rampedAlready(memory: Pick<CraterAccessMemory, 'served'>, floor: StrandedFloor): boolean {
  return memory.served.some(({ floor: f }) => Math.abs(f.x - floor.x) <= SAME_FLOOR_CELLS && Math.abs(f.z - floor.z) <= SAME_FLOOR_CELLS
    && Math.abs(f.floorY - floor.floorY) < SAME_FLOOR_M);
}

/**
 * Cancels the probe's ramps that are stuck or stalled (`stalledRampFootprints`), remembering their footprints, and frees
 * their floors for another plan. A stuck repair or widening is cancelled too, and its ramp left as it is: a shot cut it
 * off from every digger.
 */
function dropStuckRamps(run: Run, state: GameState, memory: CraterAccessMemory): void {
  const stuck = new Set([...stuckRampFootprints(state), ...stalledRampFootprints(state, memory)]);
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
  // A widening (a traffic jam's answer) the crew cannot dig is dropped too; the ramp stays as it is.
  for (const widen of state.plannedRamps.filter(p => p.widenOf !== undefined && stuck.has(p.footprint))) run(`build_ramp cancel ${widen.id}`);
}

/**
 * Forgets a served floor once its ramp is neither being dug nor built and still reaching its floor: a later shot
 * deepened that floor past the ramp (`quoteRampRepair` reads `out_of_reach`), or the ramp is gone. Its rubble then
 * waits on a new way down; on the seed-42 full-kit ladder 1,141 haul orders did from t5800, behind a ramp a deepening
 * shot left short. A built ramp that still reaches its floor keeps it served: what it left out of reach sits on a ledge.
 */
export function releaseOutreachedFloors(state: Pick<GameState, 'plannedRamps' | 'builtRamps'>, grid: VoxelGrid, memory: Pick<CraterAccessMemory, 'served'>): void {
  const same = (a: RampFootprint, b: RampFootprint): boolean => a.minX === b.minX && a.maxX === b.maxX && a.minZ === b.minZ && a.maxZ === b.maxZ;
  memory.served = memory.served.filter(({ rampId, footprint }) => {
    if (state.plannedRamps.some(p => p.id === rampId)) return true;
    const built = state.builtRamps.find(r => same(r.footprint, footprint));
    if (built === undefined) return false;
    const quote = quoteRampRepair(grid, built, state.builtRamps);
    return quote.success || quote.errorKey !== 'mining.repair_ramp.out_of_reach';
  });
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
 * Crew on foot the rally point's walkers cannot reach, and vehicles off its vehicle network, each counted as
 * ACCESS_MIN_STRANDED_ORDERS targets: reaching them is worth a ramp by itself. Two drivers and a digger left on a rib
 * between two craters disarmed every later shot whose zone took them in (they cannot leave it), and the game frees
 * no one (#2095): the player digs them out.
 */
function strandedCrewTargets(state: GameState, surface: AccessSurface): Array<{ x: number; z: number; y: number }> {
  const nav = state.navGrid;
  if (nav === null || state.rallyPoint === undefined) return [];
  const walkers = computeClimbComponents(nav, NAV_CLEARANCE_EMPLOYEE_CELLS, NAV_MAX_SLOPE_RATIO).reachableFrom([state.rallyPoint]);
  const out: Array<{ x: number; z: number; y: number }> = [];
  const add = (x: number, z: number): void => { for (let i = 0; i < ACCESS_MIN_STRANDED_ORDERS; i++) out.push({ x, z, y: 0 }); };
  for (const e of state.employees.employees) {
    if (e.alive && e.locomotion.kind === 'on_foot' && !walkers.has(Math.round(e.x), Math.round(e.z))) add(e.x, e.z);
  }
  for (const v of state.vehicles.vehicles) {
    if (!surface.reachableFrom(Math.round(v.x), Math.round(v.z))) add(v.x, v.z);
  }
  return out;
}

/** A stranded floor, and whether crew or a vehicle stands stranded on it (they need a way out however shallow). */
type AccessFloor = StrandedFloor & { holdsCrew: boolean };

/**
 * Floors of the stranded orders, those holding stranded crew first, then most orders first, each target's y read from
 * the terrain. A target the vehicle network reaches now is skipped: its stamp lags a ramp that just connected the crater.
 */
function strandedFloors(state: GameState, grid: VoxelGrid, surface: AccessSurface): AccessFloor[] {
  const crew = strandedCrewTargets(state, surface).filter(t => !surface.reachableFrom(Math.round(t.x), Math.round(t.z)));
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

/** Longest ramp (m) the probe cuts to free crew stranded on ground shallower than a dug crater: a notch, never a trench. */
const ACCESS_RESCUE_MAX_RUN_M = 10;

/**
 * A plan down to `floor`, facing its nearest depot, whose dig keeps the vehicle network whole (`keepsVehicleNetwork`), or
 * null. A floor holding stranded crew gets the shortest ramp instead, however shallow (`CRATER_ACCESS_MIN_DROP_M`), a
 * shallow one at most ACCESS_RESCUE_MAX_RUN_M long; rubble on a floor shallower than a dug crater is left. Shallow plans
 * for every floor, and a 90 m trench planned for a metre's drop, cost the Shareholder Summit ladder its win.
 */
function planKeepingRoads(
  state: GameState, grid: VoxelGrid, floor: AccessFloor, surface: AccessSurface, avoid: readonly RampFootprint[],
): { def: RampDef; cost: number } | null {
  const plan = (toward: { x: number; z: number } | null, minDropM: number): { def: RampDef; cost: number } | null => {
    const setAside = [...avoid];
    for (let attempt = 0; attempt < ACCESS_PLAN_ATTEMPTS; attempt++) {
      const planned = planCraterAccess(floor, surface, VEHICLE_MAX_SLOPE_RATIO, RAMP_DEFAULT_WIDTH, setAside, state.builtRamps, toward, minDropM);
      if (!planned.ok) return null;
      if (keepsVehicleNetwork(state, grid, planned.def)) return planned;
      setAside.push(rampFootprint(planned.def, rampWidthOf(planned.def)));
    }
    return null;
  };
  if (!floor.holdsCrew) return plan(nearestHaulDepot(state, floor), RAMP_CRATER_MIN_DROP_M);
  const rescue = plan(null, CRATER_ACCESS_MIN_DROP_M);
  if (rescue === null) return null;
  const shallow = rescue.def.targetDepth < RAMP_CRATER_MIN_DROP_M;
  return !shallow || rampTotalLength(rampPathOf(rescue.def).legs) <= ACCESS_RESCUE_MAX_RUN_M ? rescue : null;
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
  releaseOutreachedFloors(state, grid, memory);
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
      const ramp = state.plannedRamps.at(-1)!;
      memory.served.push({ floor, rampId: ramp.id, footprint: ramp.footprint });
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
    const quote = quoteRampRepair(grid, ramp, state.builtRamps);
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

/**
 * True when a ramp segment waits on a digger and no rock digger stands on the site's vehicle network (`reach`): the
 * only one was left on a crater floor, and every ramp out of that crater starts on the network, where it cannot reach.
 * On the seed-42 full-kit ladder that stopped every ramp from t4900 on (#2091).
 */
export function needsNetworkDigger(state: Pick<GameState, 'pendingActions' | 'vehicles'>, reach: (x: number, z: number) => boolean): boolean {
  if (!state.pendingActions.some(isStuckRampSegment)) return false;
  return !state.vehicles.vehicles.some(v => v.type === 'rock_digger' && reach(Math.round(v.x), Math.round(v.z)));
}

/** Buys a rock digger when `needsNetworkDigger` holds and the cash keeps ACCESS_CASH_RESERVE_TICKS of payroll after it. */
function replaceStrandedDigger(run: Run, state: GameState): void {
  const reach = siteVehicleReach(state);
  if (reach === null || !needsNetworkDigger(state, reach)) return;
  const reserve = getOperatingCostPerHour(state).payroll * ACCESS_CASH_RESERVE_TICKS;
  if (state.cash - getVehicleDefByTier('rock_digger', 1).purchaseCost < reserve) return;
  run('vehicle buy rock_digger');
}

/** The player's pit logistics for one decision interval: repair what a shot damaged, open what it stranded, and buy a digger that can. */
export function playPitLogistics(run: Run, state: GameState, grid: VoxelGrid, memory: CraterAccessMemory): void {
  repairDamagedRamps(run, state, grid, memory);
  orderCraterAccess(run, state, grid, memory);
  replaceStrandedDigger(run, state);
}
