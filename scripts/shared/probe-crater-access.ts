// BlastSimulator2026 — Progression probe: pit logistics, the player's job (#2045, #2095)
//
// Core never orders or repairs a ramp by itself: a shot that cuts into a ramp leaves it too steep, and a
// crater deepened past the built ramps leaves its rubble `debris_out_of_reach` and its planned holes
// `buried_under_rubble`; the game only says so. The probe plays a careful player here, through the
// console and out of its own cash: it repairs a ramp a shot damaged (`repair_ramp`), and when enough
// of its orders read out of reach it plans a ramp down to the stranded floor with the pure
// `planCraterAccess` planner and orders it (`build_ramp`).

import type { GameState, PendingAction, PlannedRamp } from '../../src/core/state/GameState.js';
import type { VoxelGrid } from '../../src/core/world/VoxelGrid.js';
import type { StrandedFloor } from '../../src/core/mining/CraterAccess.js';
import type { RampFootprint } from '../../src/core/mining/RampPath.js';
import { getVehicleDefByTier } from '../../src/core/entities/Vehicle.js';
import { siteVehicleReach } from '../../src/core/engine/OrderReachability.js';
import { quoteRampRepair } from '../../src/core/mining/RampRepair.js';
import { getOperatingCostPerHour } from '../../src/core/economy/OperatingFinance.js';
import { CRATER_ACCESS_CLUSTER_GAP_CELLS } from '../../src/core/config/balance.js';
import { accessSurface, strandedFloors, strandedCrew, keepsVehicleNetwork, nearestHaulDepot, planKeepingRoads, buildRampCommand } from '../../src/core/mining/CraterAccessState.js';
import type { ProtectedZone } from './probe-ladder-policy.js';

export { strandedCrew, keepsVehicleNetwork, nearestHaulDepot, buildRampCommand };

type Run = (cmd: string) => { success: boolean; output: string };

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
  /** Built ramps whose widening got stuck and was cancelled: a later jam on them is rerouted, not widened again. */
  unwidenable: number[];
  /** Per planned ramp id: segments done at the last look, and since when that count has stood. */
  progress: Record<number, { done: number; sinceTick: number }>;
}

export function newCraterAccessMemory(): CraterAccessMemory {
  return { lastTick: -Infinity, failedSignature: null, served: [], avoid: [], repairRevision: -1, unrepairable: [], unwidenable: [], progress: {} };
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
  state: Pick<GameState, 'plannedRamps' | 'pendingActions' | 'tickCount'>, memory: Pick<CraterAccessMemory, 'progress'>,
): RampFootprint[] {
  const stalled: RampFootprint[] = [];
  const live = new Set<number>();
  // A ramp nobody works while a digger works another is waiting its turn, not stalled: its clock restarts. Its access
  // ramp into a 10 m crater was cancelled that way while the one digger driver widened another (#2091).
  const claimed = new Set(state.pendingActions.filter(a => a.type === 'dig_ramp_segment' && a.holderId !== null).map(a => a.id));
  const worked = (ramp: PlannedRamp): boolean => ramp.segments.some(seg => !seg.done && claimed.has(seg.actionId));
  const anyWorked = state.plannedRamps.some(worked);
  for (const ramp of state.plannedRamps) {
    live.add(ramp.id);
    const done = ramp.segments.filter(seg => seg.done).length;
    const seen = memory.progress[ramp.id];
    const waiting = anyWorked && !worked(ramp);
    if (seen === undefined || seen.done !== done || waiting) memory.progress[ramp.id] = { done, sinceTick: state.tickCount };
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
  // A widening (a traffic jam's answer) the crew cannot dig is dropped too; the ramp stays as it is, and is not widened
  // again: the jam that asked for it keeps the cut under traffic (one ramp was widened and dropped five times from t2000
  // on the seed-42 full-kit ladder while no other ramp could be planned, #2091).
  for (const widen of state.plannedRamps.filter(p => p.widenOf !== undefined && stuck.has(p.footprint))) {
    run(`build_ramp cancel ${widen.id}`);
    memory.unwidenable.push(widen.widenOf!);
  }
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

/**
 * True while some access ramp the probe ordered is still being dug: one way in at a time. A repair or a widening is
 * not a way in, and does not hold the next one back: a widening re-ordered on every jam held every access ramp back
 * from t2000 on the seed-42 full-kit ladder while a 10 m crater full of ore waited for its road (#2091).
 */
export function hasLiveRampWork(state: Pick<GameState, 'pendingActions' | 'plannedRamps'>): boolean {
  const access = new Set(state.plannedRamps.filter(p => p.repairOf === undefined && p.widenOf === undefined)
    .flatMap(p => p.segments.map(seg => seg.actionId)));
  return state.pendingActions.some(a => a.type === 'dig_ramp_segment' && access.has(a.id) && !isStuckRampSegment(a));
}

/** Footprints of planned ramps whose every remaining segment is stuck; a new plan steers clear of them. */
export function stuckRampFootprints(state: Pick<GameState, 'plannedRamps' | 'pendingActions'>): RampFootprint[] {
  const stuck = new Set(state.pendingActions.filter(isStuckRampSegment).map(a => a.id));
  if (stuck.size === 0) return [];
  return state.plannedRamps
    .filter(r => { const left = r.segments.filter(s => !s.done); return left.length > 0 && left.every(s => stuck.has(s.actionId)); })
    .map(r => r.footprint);
}

function signatureOf(state: GameState, floors: readonly StrandedFloor[], avoid: readonly RampFootprint[]): string {
  return `${state.navGrid?.revision ?? -1}|${avoid.map(a => `${a.minX},${a.maxX},${a.minZ},${a.maxZ}`).join(';')}|${floors.map(f => `${f.x},${f.z},${f.floorY},${f.orderCount}`).join(';')}`;
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
  if (hasLiveRampWork(state)) return null;
  const surface = accessSurface(state, grid);
  if (surface === null) return null;
  const floors = strandedFloors(state, grid, surface).filter(f => !rampedAlready(memory, f));
  if (floors.length === 0) { memory.failedSignature = null; return null; }
  const avoid = [...stuckRampFootprints(state), ...memory.avoid, ...patternKeepOut(state)];
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

/**
 * Ground a new ramp keeps off: the holes ordered or drilled, grown by RAMP_SHOT_KEEP_OUT_M, as a shot keeps off a ramp.
 * A ramp dug between a pattern's drilling and its firing left a cut beside the holes for the rock to fly out of: 151
 * pieces, the farthest 48 m, on the seed-42 full-kit ladder at t3148 (#2091).
 */
export function patternKeepOut(state: Pick<GameState, 'drillHoles' | 'plannedDrillHoles'>): RampFootprint[] {
  const holes = [...state.drillHoles, ...state.plannedDrillHoles];
  if (holes.length === 0) return [];
  const m = RAMP_SHOT_KEEP_OUT_M;
  const xs = holes.map(h => h.x), zs = holes.map(h => h.z);
  return [{ minX: Math.min(...xs) - m, maxX: Math.max(...xs) + m, minZ: Math.min(...zs) - m, maxZ: Math.max(...zs) + m }];
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
