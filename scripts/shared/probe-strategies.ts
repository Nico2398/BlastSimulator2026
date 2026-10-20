// BlastSimulator2026 — Progression probe: reference strategies and the headless run loop (#1922)
//
// A strategy plays one sandbox site through console commands only (`runCommand`,
// the same entry the scenario runner uses). The probe reads state to decide and
// to measure, and never writes it: every dollar is earned, every explosive
// delivery waited out, every event answered with its first option.
//
// Strategies (a catalog: add one by adding an entry to STRATEGIES):
//
//   opening  The standard opening, then idle play to the horizon:
//            1. tier-1 Living Quarters on the first spot the placement rules accept
//            2. one 3x3 Krackle 4 kg shot (spacing 4, depth 5; 36 kg, inside the grade-0 limit, #1944) on the best deposit
//            3. a ramp into the crater, then the crew hauls on its own
//            4. accept and fill every contract the stock already covers
//
//   reinvest The opening, then a greedy policy evaluated every
//            DECISION_INTERVAL_TICKS. In this order, each only if cash minus
//            REINVEST_CASH_RESERVE covers it:
//            a. accept and fill fillable contracts (free)
//            b. fire the next blast when the next grade still needs blasts (#1929), or haulable ore
//               on the ground has fallen under RELOAD_FRACTION of the last blast's yield
//               (shouldReload); the drill is idle
//                and cash covers the shot; footprints keep SHOT_SPAN clear of earlier shots
//            c. buy a Research Center
//            d. research and order the tier-2 Freight Warehouse upgrade
//            e. buy a second hauler and hire its driver
//            f. `permit apply` once `permit status` shows every target met
//               (nextGradeTargets in src/core/economy/MineGrade.ts)
//            Calibration tasks extend this list; keep each rule one short block.
//
//   ladder   The full-ladder player (#1945). The reinvest opening, then every interval:
//            a. contracts, and `permit apply` the moment shouldApplyPermit allows it
//            b. a limit-sized blast for the current grade (limitSizedShot), at the widest hole the
//               best drill rig bores (pickDiameter); while a depth target is open it deepens the
//               crater, insetting the footprint by a berm once the pit is taller than the stability limit
//            c. Research Center, tier-2 Freight Warehouse, second hauler (as reinvest)
//            d. tier-2/3 equipment (nextBuy over LADDER_EQUIPMENT) once the dealer's grade gate and
//               mayBuyVehicleTier allow; a gentle ramp is dug first when the existing one is too steep
//            e. a rock_fragmenter as soon as boulders lie on the ground
//   stay_g1  ladder that never applies for a permit past grade 1.
//            A buy rule that cannot act (unaffordable, cooling down, failed) falls through to the
//            next. Deposits are ranked on ground-truth ore, not a survey.

import { createGameEngine } from './command-runner.js';
import { runCommand } from '../../src/console/createRunner.js';
import type { RunnerWithContext } from '../../src/console/createRunner.js';
import type { GameState } from '../../src/core/state/GameState.js';
import type { VoxelGrid } from '../../src/core/world/VoxelGrid.js';
import { computeVoxelColumnSurfaceY, getSmoothTerrainSurfaceY } from '../../src/core/world/VoxelGrid.js';
import { isOversized } from '../../src/core/mining/BlastCalc.js';
import { nextGradeTargets } from '../../src/core/economy/MineGrade.js';
import { getExplosivesFreeCapacity } from '../../src/core/entities/BuildingWarehouse.js';
import { getBuildingDef, getUpgradeCost } from '../../src/core/entities/Building.js';
import { getAllVehicleRoles, getVehicleDefByTier } from '../../src/core/entities/Vehicle.js';
import {
  DRILL_RIG_MAX_DEPTH_M, DRILL_RIG_MAX_DIAMETER_M, HIRING_COSTS, PERMIT_LIMITS, VEHICLE_TIER_MAX_SLOPE_DEGREES,
  WALL_BERM_MIN_WIDTH_M, WALL_SAFE_FACE_HEIGHT_M_BY_TIER,
} from '../../src/core/config/balance.js';
import { gradeDef } from '../../src/core/economy/MineGrade.js';
import { fleetBestRigLimit } from '../../src/core/mining/RigLimits.js';
import { explosiveHoleLimits, maxFittingChargeKg } from '../../src/core/mining/ChargePlan.js';
import { getExplosive } from '../../src/core/world/ExplosiveCatalog.js';
import type { VehicleRole, VehicleTier } from '../../src/core/entities/Vehicle.js';
import {
  limitSizedShot, mayBuyVehicleTier, nextBuy, pickDiameter, shouldApplyPermit, shouldBench,
  type BuyRule, type LadderShot, type PermitLimit,
} from './probe-ladder.js';
import { playContracts, playTick, clearBlastZone, stockWarehouse, type Run } from './player-actions.js';
import { MetricsObserver, fragmentOreKg, type RunResult } from './probe-metrics.js';
import type { ProbeOptions, ProbeRunConfig, StrategyId } from './probe-config.js';
import { expandMatrix } from './probe-config.js';

/** Ticks between reinvest decisions (and contract passes of the opening). */
const DECISION_INTERVAL_TICKS = 10;
/** Cash the reinvest policy never spends below: payroll and upkeep keep running. */
const REINVEST_CASH_RESERVE = 50_000;
/** Fraction of the last blast's haulable yield under which reinvest fires the next blast. */
export const RELOAD_FRACTION = 0.5;

/**
 * Reload gate: true when a prior yield exists (`lastYieldKg > 0`) and the haulable ore left on
 * the ground has fallen under `RELOAD_FRACTION` of it.
 */
export function shouldReload(haulableKg: number, lastYieldKg: number): boolean {
  return lastYieldKg > 0 && haulableKg < RELOAD_FRACTION * lastYieldKg;
}

/** Ticks one opening step may take before the run is reported as `opening_failed:<step>`. */
const OPENING_STEP_MAX_TICKS = 3000;
/** Consecutive `tick 1` calls that fail to advance the clock before the run counts as stalled. */
const STALL_TICKS = 3;
/** Ticks before a failed placement is tried again by the reinvest policy. */
const PLACEMENT_RETRY_TICKS = 200;

/** Cash above the reserve a re-fire keeps for drilling and charging, on top of the explosive. */
const RE_FIRE_CASH_CUSHION = 5_000;

export const SHOT = { rows: 3, cols: 3, spacing: 4, depth: 5, explosive: 'krackle', kg: 4, stemming: 2.5 } as const;
/** Footprint side of the shot in tiles, first hole to last. */
const SHOT_SPAN = (SHOT.cols - 1) * SHOT.spacing;
/** Explosive one shot consumes, in kg. */
const SHOT_EXPLOSIVE_KG = SHOT.rows * SHOT.cols * SHOT.kg;
/** Deposit candidates tried (best first) before the opening gives up on `drill_plan`. */
const DEPOSIT_CANDIDATES_TRIED = 12;
/** Candidate pattern origins are sampled this many tiles apart. */
const DEPOSIT_SCAN_STEP = 2;
/** Keep-out (tiles) around the pattern footprint when siting a building. */
const BUILDING_KEEP_OUT = 10;
const BUILDING_SCAN_STEP = 4;
const BUILDING_SCAN_EDGE = 8;
/** Ramp: tiles between the pattern edge and the ramp's lower end, longest ramp tried, steepest rise per tile. */
const RAMP_END_GAP = 1;
const RAMP_MAX_LENGTH = 34;
const RAMP_MAX_SLOPE = 0.45;
/** Tiles kept free between a fresh shot and an earlier one, so a berm stands between their craters. */
const BERM_GAP = WALL_BERM_MIN_WIDTH_M;

/** Internal unwind signal: the run ended for `reason`; 'horizon' is the normal end. */
class ProbeStop extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

interface ProbeSession {
  config: ProbeRunConfig;
  engine: RunnerWithContext;
  state: GameState;
  grid: VoxelGrid;
  /** Console command; a `tick` is observed, and ends the run at the horizon. */
  run: Run;
  /** One honest tick: answer a pending event, then `tick 1`. */
  tick(): void;
  /** Tick until `done()`; throws `opening_failed:<step>` after OPENING_STEP_MAX_TICKS. */
  waitFor(step: string, done: () => boolean): void;
}

type StrategyFn = (s: ProbeSession) => void;

// ── Site reading (reads only) ──

interface Pattern { x: number; z: number }

/**
 * Pattern origins ranked best first: highest summed ore density over the 9x9
 * footprint down to the hole depth, ties to the lowest x then z. A site with
 * no ore anywhere ranks by flattest footprint instead. Ground truth stands in
 * for the survey a player would read; the probe does not model surveying.
 */
function rankDeposits(grid: VoxelGrid, span = SHOT_SPAN, depth: number = SHOT.depth): Array<Pattern & { ore: number; spread: number }> {
  const out: Array<Pattern & { ore: number; spread: number }> = [];
  const lo = BUILDING_SCAN_EDGE;
  for (let x = lo; x <= grid.sizeX - lo - span; x += DEPOSIT_SCAN_STEP) {
    for (let z = lo; z <= grid.sizeZ - lo - span; z += DEPOSIT_SCAN_STEP) {
      let ore = 0, low = Infinity, high = -Infinity;
      for (let dx = 0; dx <= span; dx++) {
        for (let dz = 0; dz <= span; dz++) {
          const top = computeVoxelColumnSurfaceY(grid, x + dx, z + dz);
          if (top === null) continue;
          low = Math.min(low, top);
          high = Math.max(high, top);
          for (let d = 0; d < depth; d++) {
            const ores = grid.oresAt(x + dx, top - d, z + dz);
            if (ores) for (const v of Object.values(ores)) ore += v;
          }
        }
      }
      if (low !== Infinity) out.push({ x, z, ore, spread: high - low });
    }
  }
  const anyOre = out.some(c => c.ore > 0);
  // Array.sort is stable and `out` is already in ascending x then z: ties keep that order.
  return out.sort((a, b) => (anyOre ? b.ore - a.ore : a.spread - b.spread));
}

/** Tile the crew works around: where the warehouse sits. */
function rallyOf(s: ProbeSession): Pattern {
  const w = s.state.buildings.buildings.find(b => b.type === 'freight_warehouse');
  return w ? { x: w.x, z: w.z } : { x: s.grid.sizeX >> 1, z: s.grid.sizeZ >> 1 };
}

/** Haulable (not oversized) ore on the ground, kg. */
function haulableOreOnGroundKg(state: GameState): number {
  return fragmentOreKg(
    state.logistics.fragments
      .filter(f => f.state === 'on_ground' && !isOversized(f.fragment.volume))
      .map(f => f.fragment),
  );
}

// ── Building placement ──

/**
 * Coarse scan for the nearest spot (to `near`) a `build` command accepts, outside the keep-out
 * around the shot `avoid`. Near the work matters: a crew rests at its Living Quarters, so a far
 * one costs walking time on payroll. Returns the spot or null.
 */
function placeBuilding(s: ProbeSession, type: string, near: Pattern, avoid: Pattern | null): Pattern | null {
  const { sizeX, sizeZ } = s.grid;
  const spots: Pattern[] = [];
  for (let z = BUILDING_SCAN_EDGE; z <= sizeZ - BUILDING_SCAN_EDGE; z += BUILDING_SCAN_STEP) {
    for (let x = BUILDING_SCAN_EDGE; x <= sizeX - BUILDING_SCAN_EDGE; x += BUILDING_SCAN_STEP) {
      const inKeepOut = avoid !== null && x > avoid.x - BUILDING_KEEP_OUT && x < avoid.x + SHOT_SPAN + BUILDING_KEEP_OUT
        && z > avoid.z - BUILDING_KEEP_OUT && z < avoid.z + SHOT_SPAN + BUILDING_KEEP_OUT;
      if (!inKeepOut) spots.push({ x, z });
    }
  }
  const dist = (p: Pattern) => Math.hypot(p.x - near.x, p.z - near.z);
  spots.sort((a, b) => dist(a) - dist(b));
  for (const p of spots) {
    if (s.run(`build ${type} at:${p.x},${p.z} tier:1`).success) return p;
  }
  return null;
}

// ── The shot: drill and charge together, clear, fire ──

interface Shot {
  at: Pattern;
  /** Footprint side in tiles, first hole to last. */
  span: number;
  startedTick: number;
}

/** One shot's pattern, charge and (optionally) hole diameter; `SHOT` is the opening's. */
interface ShotSpec {
  rows: number;
  cols: number;
  spacing: number;
  depth: number;
  explosive: string;
  kg: number;
  stemming: number;
  diameterM?: number;
}

const spanOf = (spec: Pick<ShotSpec, 'cols' | 'spacing'>): number => (spec.cols - 1) * spec.spacing;

/**
 * Order the drill pattern on the best deposit `drill_plan` accepts, stock the explosive warehouse
 * and order the charge. Charging from stock skips the 400-tick cash-bought delivery wait (#1895),
 * which the opening crew cannot afford on payroll; the stock is paid for, not granted. Holes drilled
 * after the charge order are charged automatically. Null when no deposit or no stock is available.
 */
/** Footprints (each `span` wide, default SHOT_SPAN) share a tile, with `gap` tiles of berm kept between. */
function overlapsShot(c: Pattern & { span?: number }, o: Pattern & { span?: number }, gap = 0): boolean {
  return c.x <= o.x + (o.span ?? SHOT_SPAN) + gap && o.x <= c.x + (c.span ?? SHOT_SPAN) + gap
    && c.z <= o.z + (o.span ?? SHOT_SPAN) + gap && o.z <= c.z + (c.span ?? SHOT_SPAN) + gap;
}

/** Order `spec` at `at`, or on the best free deposit when `at` is not given. */
function orderShot(s: ProbeSession, earlier: readonly (Pattern & { span?: number })[] = [], spec: ShotSpec = SHOT, at?: Pattern): Shot | null {
  const span = spanOf(spec);
  const candidates = at
    ? [at]
    : rankDeposits(s.grid, span, spec.depth)
      .filter(c => !earlier.some(o => overlapsShot({ ...c, span }, o, earlier.length > 0 ? BERM_GAP : 0)))
      .slice(0, DEPOSIT_CANDIDATES_TRIED);
  // The stock buy takes whole kg; round up so the pattern's charge is covered.
  const totalKg = Math.ceil(spec.rows * spec.cols * spec.kg);
  const diameter = spec.diameterM === undefined ? '' : ` diameter:${spec.diameterM}`;
  for (const c of candidates) {
    const cmd = `drill_plan grid rows:${spec.rows} cols:${spec.cols} spacing:${spec.spacing} depth:${spec.depth} start:${c.x},${c.z}${diameter}`;
    if (!s.run(cmd).success) continue;
    if (!stockWarehouse(s.run, s.state, spec.explosive, totalKg).success) return null;
    const charge = `charge hole:* explosive:${spec.explosive} amount:${spec.kg} stemming:${spec.stemming}`;
    if (!s.run(charge).success) return null;
    return { at: { x: c.x, z: c.z }, span, startedTick: s.state.tickCount };
  }
  return null;
}

/** Every hole drilled and charged, nothing left in the queues. */
function shotReady(state: GameState): boolean {
  return state.drillHoles.length > 0 && state.plannedDrillHoles.length === 0
    && Object.keys(state.plannedChargesByHole).length === 0
    && state.drillHoles.every(h => state.chargesByHole[h.id] !== undefined);
}

/** Clear the zone and detonate a charged pattern. */
function fireShot(s: ProbeSession): boolean {
  clearBlastZone(s.run, s.state);
  return s.run('blast detonate').success;
}

// ── Ramp ──

/**
 * Order a ramp from the open ground into the crater the shot at `at` (`span` wide) made, no steeper than
 * `maxSlope` rise per tile; the ramp's slope ratio when one was accepted, else null.
 */
function orderRamp(s: ProbeSession, at: Pattern, span = SHOT_SPAN, maxSlope = RAMP_MAX_SLOPE): number | null {
  const { grid } = s;
  const mid = span / 2;
  const centre = { x: at.x + mid, z: at.z + mid };
  const floor = getSmoothTerrainSurfaceY(grid, centre.x, centre.z);
  const lanes = [
    { dx: -1, dz: 0, end: { x: at.x - RAMP_END_GAP, z: centre.z } },
    { dx: 1, dz: 0, end: { x: at.x + span + RAMP_END_GAP, z: centre.z } },
    { dx: 0, dz: -1, end: { x: centre.x, z: at.z - RAMP_END_GAP } },
    { dx: 0, dz: 1, end: { x: centre.x, z: at.z + span + RAMP_END_GAP } },
  ];
  for (let length = 8; length <= RAMP_MAX_LENGTH; length++) {
    for (const lane of lanes) {
      const start = { x: lane.end.x - lane.dx * length, z: lane.end.z - lane.dz * length };
      if (start.x < 1 || start.z < 1 || start.x >= grid.sizeX - 1 || start.z >= grid.sizeZ - 1) continue;
      const depth = Math.round(getSmoothTerrainSurfaceY(grid, start.x, start.z) - floor);
      if (depth < 1 || depth / length > maxSlope) continue;
      if (s.run(`build_ramp start:${start.x},${start.z} end:${lane.end.x},${lane.end.z} depth:${depth}`).success) return depth / length;
    }
  }
  return null;
}

// ── Opening ──

/** The opening's shot site and the slope ratio of the ramp it dug. */
function runOpening(s: ProbeSession): { at: Pattern; rampSlope: number } {
  const fail = (step: string): never => { throw new ProbeStop(`opening_failed:${step}`); };

  const ranked = rankDeposits(s.grid)[0];
  const site = ranked ? { x: ranked.x, z: ranked.z } : { x: s.grid.sizeX >> 1, z: s.grid.sizeZ >> 1 };
  if (!placeBuilding(s, 'living_quarters', site, site)) fail('living_quarters');

  const shot = orderShot(s);
  if (!shot) return fail('shot');
  s.waitFor('shot', () => shotReady(s.state));
  if (!fireShot(s)) fail('blast');
  s.tick(); // the blast resolves on the next command
  const rampSlope = orderRamp(s, shot.at);
  if (rampSlope === null) return fail('ramp');
  s.waitFor('ramp', () => !s.state.pendingActions.some(a => a.type === 'dig_ramp_segment'));
  playContracts(s.run, s.state);
  return { at: shot.at, rampSlope };
}

/** Idle play: tick to the horizon, passing the contract board every interval. */
function playOut(s: ProbeSession, onInterval?: () => void): never {
  for (;;) {
    s.tick();
    if (s.state.tickCount % DECISION_INTERVAL_TICKS === 0) {
      playContracts(s.run, s.state);
      onInterval?.();
    }
  }
}

// ── Reinvest ──

interface ReinvestMemory {
  shot: Shot | null;
  /** Origins of every shot fired so far; later footprints keep SHOT_SPAN clear of them. */
  origins: Array<Pattern & { span?: number }>;
  /** Haulable ore (kg) measured after the last blast resolved; the reload gate's yardstick. */
  lastYieldKg: number;
  /**
   * A blast was fired and its yield is not yet measured. It is measured on the next decision
   * interval (DECISION_INTERVAL_TICKS later), so it is approximate: haulers may already have
   * moved ore. The initial lastYieldKg is approximate for the same reason.
   */
  yieldPending: boolean;
  researchOrdered: boolean;
  retryAt: Record<string, number>;
}

function spendable(s: ProbeSession): number {
  return s.state.cash - REINVEST_CASH_RESERVE;
}

function countOf(s: ProbeSession, type: string): number {
  return s.state.buildings.buildings.filter(b => b.type === type).length;
}

/** Try `attempt` unless it failed recently; remembers the failure for PLACEMENT_RETRY_TICKS. */
function tryOnce(s: ProbeSession, m: ReinvestMemory, key: string, attempt: () => boolean): boolean {
  if ((m.retryAt[key] ?? 0) > s.state.tickCount) return false;
  const ok = attempt();
  if (!ok) m.retryAt[key] = s.state.tickCount + PLACEMENT_RETRY_TICKS;
  return ok;
}

/** Order the next shot unless a recent attempt failed; null when none was ordered. */
function orderShotOnce(s: ProbeSession, m: ReinvestMemory): Shot | null {
  let ordered: Shot | null = null;
  tryOnce(s, m, 'shot', () => (ordered = orderShot(s, m.origins)) !== null);
  return ordered as Shot | null; // assigned inside the closure, which TS narrowing cannot see
}

/**
 * True while the next grade still asks for more blasts. Tier-0 buyers take 100-1000 kg lots (#1929), so a
 * full warehouse drains slowly and the ground stock may never fall under the reload gate; the permit
 * ladder's own blast count must not wait on it.
 */
function gradeNeedsBlast(s: ProbeSession): boolean {
  return nextGradeTargets(s.state).some(t => t.kind === 'blasts' && !t.met);
}

/** What a policy fires next: the cash one shot needs and how to order it (null when it could not). */
interface ShotPlan {
  /** Fire even when the grade needs no blast and ground ore is plentiful (a policy's own reason to blast). */
  wanted?: boolean;
  cost: number;
  order: () => Shot | null;
}

function reinvestShot(s: ProbeSession, m: ReinvestMemory, plan?: () => ShotPlan): void {
  if (m.yieldPending) { // the blast resolved on the first command after it fired
    m.lastYieldKg = haulableOreOnGroundKg(s.state);
    m.yieldPending = false;
  }
  const shot = m.shot;
  if (!shot) {
    const idle = s.state.plannedDrillHoles.length === 0 && Object.keys(s.state.plannedChargesByHole).length === 0
      && s.state.drillHoles.length === 0;
    const next = plan?.() ?? { cost: SHOT_EXPLOSIVE_KG + RE_FIRE_CASH_CUSHION, order: () => orderShotOnce(s, m) };
    if (idle && spendable(s) >= next.cost && (next.wanted === true || gradeNeedsBlast(s) || shouldReload(haulableOreOnGroundKg(s.state), m.lastYieldKg))) {
      m.shot = next.order();
    }
    return;
  }
  if (shotReady(s.state)) {
    if (fireShot(s)) {
      m.origins.push({ ...shot.at, span: shot.span });
      m.yieldPending = true;
    }
    m.shot = null;
  } else if (s.state.tickCount - shot.startedTick > OPENING_STEP_MAX_TICKS) {
    m.shot = null;
    m.retryAt['shot'] = s.state.tickCount + PLACEMENT_RETRY_TICKS;
  }
}

/** Each rule returns only when it acted; an unaffordable, cooling-down or failed rule falls through. */
function reinvestBuy(s: ProbeSession, m: ReinvestMemory): void {
  const { state } = s;
  if (countOf(s, 'research_center') === 0 && !state.plannedBuildings.some(p => p.type === 'research_center')
    && spendable(s) >= getBuildingDef('research_center', 1).constructionCost
    && tryOnce(s, m, 'research_center', () => placeBuilding(s, 'research_center', rallyOf(s), null) !== null)) {
    return;
  }
  const warehouse = state.buildings.buildings.find(b => b.type === 'freight_warehouse');
  if (warehouse && warehouse.tier < 2 && countOf(s, 'research_center') > 0
    && !state.plannedBuildings.some(p => p.buildingId === warehouse.id)
    && spendable(s) >= getUpgradeCost('freight_warehouse', 2)) {
    if (!m.researchOrdered) m.researchOrdered = s.run('research queue type:freight_warehouse tier:2').success;
    if (tryOnce(s, m, 'warehouse', () => s.run(`build upgrade ${warehouse.id}`).success)) return;
  }
  const haulers = state.vehicles.vehicles.filter(v => v.type === 'debris_hauler').length;
  const haulerCost = getVehicleDefByTier('debris_hauler', 1).purchaseCost + HIRING_COSTS.driver;
  if (haulers < 2 && spendable(s) >= haulerCost) {
    tryOnce(s, m, 'hauler', () => buyHauler(s));
  }
}

/** Buy a hauler and hire a driver for it (assigned on arrival by the crew's own dispatch). */
function buyHauler(s: ProbeSession): boolean {
  if (!s.run('vehicle buy debris_hauler').success) return false;
  return s.run('employee hire role:driver').success;
}

function reinvestPermit(s: ProbeSession): void {
  const targets = nextGradeTargets(s.state);
  if (targets.length > 0 && targets.every(t => t.met)) s.run('permit apply');
}

function runReinvest(s: ProbeSession): void {
  const first = runOpening(s).at;
  const m: ReinvestMemory = {
    shot: null, origins: [first], lastYieldKg: haulableOreOnGroundKg(s.state), yieldPending: false,
    researchOrdered: false, retryAt: {},
  };
  playOut(s, () => {
    reinvestShot(s, m);
    reinvestBuy(s, m);
    reinvestPermit(s);
  });
}


// ── Ladder ──

/** Cash the ladder keeps back from every purchase and permit fee: payroll and upkeep keep running. */
const LADDER_CASH_RESERVE = 5_000;
/** Deepest hole the ladder drills (m), kept under the softest rock's safe face height (#1941). */
const LADDER_HOLE_DEPTH_M = 10;
/** Shrink factors tried when a limit-sized pattern fits no free site, widest first. */
const LADDER_SHRINK_STEPS = [1, 0.75, 0.5, 0.25] as const;
const LADDER_RAMP_RETRY_KEY = 'gentle_ramp';
const SOFTEST_SAFE_FACE_M = WALL_SAFE_FACE_HEIGHT_M_BY_TIER[1]!;
const slopeRatioOf = (tier: VehicleTier): number => Math.tan(VEHICLE_TIER_MAX_SLOPE_DEGREES[tier] * Math.PI / 180);

/** Tier 2 and 3 of every vehicle role, cheapest first within a tier: what the dealer sells above tier 1. */
const LADDER_EQUIPMENT: readonly (BuyRule & { role: VehicleRole; tier: VehicleTier })[] = ([2, 3] as const).flatMap(
  tier => getAllVehicleRoles().map(role => ({
    id: `${role}:${tier}`, role, tier,
    cost: getVehicleDefByTier(role, tier).purchaseCost + HIRING_COSTS.driver,
  })),
);

interface LadderMemory extends ReinvestMemory {
  /** Footprint of the last fired shot; the next bench and the gentle ramp work from it. */
  crater: Pattern & { span: number };
  /** Slope ratio of the best ramp dug so far. */
  rampSlope: number;
  /** A gentle ramp ordered but not yet finished, and its slope ratio. */
  rampPending: number | null;
  /** Never apply for a permit past this grade (stay_g1); null for no cap. */
  maxGrade: number | null;
}

const gradeOf = (s: ProbeSession): number => s.state.grade?.grade ?? 0;

function depthTargetOpen(s: ProbeSession): boolean {
  return nextGradeTargets(s.state).some(t => t.kind === 'depth_m' && !t.met);
}

/**
 * The shot to fire next for the current grade: limit-sized, at the widest hole the best rig bores.
 * Deepens the crater while a depth target is open, leaving a berm inside the crater rim once the pit
 * stands taller than the stability limit; else takes a fresh site. Cut to what the explosive warehouse
 * has room for and, if no site takes it, shrunk step by step.
 */
function ladderPlan(s: ProbeSession, m: LadderMemory): ShotPlan {
  const { state } = s;
  const vehicles = state.vehicles.vehicles;
  const depth = Math.min(fleetBestRigLimit(DRILL_RIG_MAX_DEPTH_M, vehicles), LADDER_HOLE_DEPTH_M);
  const rigDiameterM = fleetBestRigLimit(DRILL_RIG_MAX_DIAMETER_M, vehicles);
  const base: LadderShot = {
    rows: 3, cols: 3, spacing: SHOT.spacing, depth, kgPerHole: SHOT.kg, stemming: SHOT.stemming, diameterM: pickDiameter(rigDiameterM),
  };
  const limit: PermitLimit = PERMIT_LIMITS[Math.min(gradeOf(s), 5)]!;
  const sized = limitSizedShot(limit, base, rigDiameterM);
  const explosive = getExplosive(SHOT.explosive)!;
  const kg = Math.floor(Math.min(
    sized.kgPerHole, explosiveHoleLimits(explosive, sized.diameterM).maxKg,
    maxFittingChargeKg(depth, sized.stemming, sized.diameterM),
  ) * 10) / 10;

  const deepen = depthTargetOpen(s);
  const inset = deepen && shouldBench(state.grade?.deepestPitM ?? 0, SOFTEST_SAFE_FACE_M) ? BERM_GAP : 0;
  const crater = m.crater;
  const siteSide = Math.floor((Math.min(s.grid.sizeX, s.grid.sizeZ) - 2 * BUILDING_SCAN_EDGE - 1) / sized.spacing) + 1;
  const craterSide = Math.floor((crater.span - 2 * inset) / sized.spacing) + 1;
  const wanted = Math.max(1, Math.min(sized.rows, deepen ? craterSide : siteSide));
  const free = getExplosivesFreeCapacity(state.buildings);
  const side = Math.max(0, Math.min(wanted, Math.floor(Math.sqrt(free / (kg + 0.1)))));
  const specFor = (n: number): ShotSpec => ({
    rows: n, cols: n, spacing: sized.spacing, depth, explosive: SHOT.explosive, kg, stemming: sized.stemming, diameterM: sized.diameterM,
  });
  const hauling = state.pendingActions.some(a => a.type === 'haul_debris');
  return {
    // Blast again while a depth target is open, or when the crew has nothing left to haul (idle crew, no income).
    wanted: deepen || !hauling,
    cost: side === 0 ? Infinity : side * side * kg * explosive.costPerKg + RE_FIRE_CASH_CUSHION,
    order: () => {
      let ordered: Shot | null = null;
      tryOnce(s, m, 'shot', () => {
        for (const step of LADDER_SHRINK_STEPS) {
          const n = Math.max(1, Math.round(side * step));
          const at = deepen ? { x: crater.x + inset, z: crater.z + inset } : undefined;
          ordered = orderShot(s, m.origins, specFor(n), at);
          if (ordered !== null) return true;
        }
        return false;
      });
      return ordered;
    },
  };
}

/** Research (once) and order the next tier of the first `type` building. */
function upgradeBuilding(s: ProbeSession, m: ReinvestMemory, type: string): boolean {
  const b = s.state.buildings.buildings.find(x => x.type === type);
  if (!b || b.tier >= 3 || s.state.plannedBuildings.some(p => p.buildingId === b.id)) return false;
  if (!s.state.buildings.buildings.some(x => x.type === 'research_center')) return false;
  const tier = b.tier + 1;
  if (!s.run(`research queue type:${type} tier:${tier}`).success && tier > 2) return false;
  return tryOnce(s, m, `upgrade_${type}`, () => s.run(`build upgrade ${b.id}`).success);
}

/** Tier-2/3 vehicles the dealer's grade gate and the ramp's slope allow, bought in catalog order. */
function ladderEquipment(s: ProbeSession, m: LadderMemory): void {
  const grade = gradeOf(s);
  if (m.rampPending !== null && !s.state.pendingActions.some(a => a.type === 'dig_ramp_segment')) {
    m.rampSlope = Math.min(m.rampSlope, m.rampPending);
    m.rampPending = null;
  }
  const reachable = ([3, 2] as const).find(t => mayBuyVehicleTier(t, grade, 0));
  if (reachable !== undefined && m.rampSlope > slopeRatioOf(reachable) && m.rampPending === null) {
    tryOnce(s, m, LADDER_RAMP_RETRY_KEY, () => {
      const slope = orderRamp(s, m.crater, m.crater.span, slopeRatioOf(reachable));
      if (slope !== null) m.rampPending = slope;
      return slope !== null;
    });
  }
  const owned = new Set<string>();
  for (const v of s.state.vehicles.vehicles) for (let t = 2; t <= v.tier; t++) owned.add(`${v.type}:${t}`);
  const buyable = LADDER_EQUIPMENT.filter(r => mayBuyVehicleTier(r.tier, grade, m.rampSlope));
  const rule = nextBuy(s.state.cash, LADDER_CASH_RESERVE, buyable, owned);
  const pick = LADDER_EQUIPMENT.find(r => r.id === rule?.id);
  if (!pick) return;
  tryOnce(s, m, `buy_${pick.id}`, () => {
    if (!s.run(`vehicle buy ${pick.role} tier:${pick.tier}`).success) return false;
    s.run('employee hire role:driver');
    return true;
  });
}

/** A fragmenter as soon as boulders lie on the ground and none is owned. */
function ladderFragmenter(s: ProbeSession, m: ReinvestMemory): void {
  const { state } = s;
  if (state.vehicles.vehicles.some(v => v.type === 'rock_fragmenter')) return;
  if (!state.logistics.fragments.some(f => f.state === 'on_ground' && isOversized(f.fragment.volume))) return;
  const cost = getVehicleDefByTier('rock_fragmenter', 1).purchaseCost + HIRING_COSTS.driver;
  if (state.cash - LADDER_CASH_RESERVE < cost) return;
  tryOnce(s, m, 'fragmenter', () => {
    if (!s.run('vehicle buy rock_fragmenter').success) return false;
    s.run('employee hire role:driver');
    return true;
  });
}

function ladderPermit(s: ProbeSession, m: LadderMemory): void {
  const g = s.state.grade;
  if (!g || (m.maxGrade !== null && g.grade >= m.maxGrade)) return;
  const targets = nextGradeTargets(s.state);
  const fee = gradeDef(g.grade + 1).fee;
  if (shouldApplyPermit(targets.length > 0 && targets.every(t => t.met), g.pending !== null, s.state.cash, fee, LADDER_CASH_RESERVE)) {
    s.run('permit apply');
  }
}

function runLadder(s: ProbeSession, maxGrade: number | null): void {
  const opened = runOpening(s);
  const m: LadderMemory = {
    shot: null, origins: [opened.at], lastYieldKg: haulableOreOnGroundKg(s.state), yieldPending: false,
    researchOrdered: false, retryAt: {},
    crater: { ...opened.at, span: SHOT_SPAN }, rampSlope: opened.rampSlope, rampPending: null, maxGrade,
  };
  playOut(s, () => {
    ladderPermit(s, m);
    reinvestShot(s, m, () => ladderPlan(s, m));
    const last = m.origins[m.origins.length - 1]!;
    if (last.x !== m.crater.x || last.z !== m.crater.z) m.crater = { x: last.x, z: last.z, span: last.span ?? SHOT_SPAN };
    reinvestBuy(s, m);
    ladderFragmenter(s, m);
    ladderEquipment(s, m);
    const need = ladderPlan(s, m);
    if (!Number.isFinite(need.cost)) upgradeBuilding(s, m, 'explosive_warehouse');
  });
}

const STRATEGIES: Record<StrategyId, StrategyFn> = {
  opening: (s) => { runOpening(s); playOut(s); },
  reinvest: runReinvest,
  ladder: (s) => runLadder(s, null),
  stay_g1: (s) => runLadder(s, 1),
};

// ── Run loop ──

function createSession(config: ProbeRunConfig, observer: MetricsObserver): ProbeSession {
  const engine = createGameEngine();
  let lastTick = 0;
  let idle = 0;
  const session: ProbeSession = {
    config,
    engine,
    get state() { return engine.ctx.state!; },
    get grid() { return engine.ctx.grid!; },
    run: (cmd) => {
      const result = runCommand(engine, cmd);
      if (/^tick\b/.test(cmd)) afterTick();
      return result;
    },
    tick: () => playTick(session.run, session.state),
    waitFor: (step, done) => {
      const started = session.state.tickCount;
      while (!done()) {
        if (session.state.tickCount - started > OPENING_STEP_MAX_TICKS) throw new ProbeStop(`opening_failed:${step}`);
        session.tick();
      }
    },
  };

  function afterTick(): void {
    const state = session.state;
    idle = state.tickCount === lastTick ? idle + 1 : 0;
    lastTick = state.tickCount;
    if (idle >= STALL_TICKS) throw new ProbeStop('stalled');
    if (idle === 0) observer.onTick(state);
    if (state.levelEnded) throw new ProbeStop(`game_over:${state.levelEndReason ?? 'unknown'}`);
    if (state.tickCount >= config.horizon) throw new ProbeStop('horizon');
  }
  return session;
}

/** One headless playthrough. Never throws on a failed step: the reason lands in `endReason`. */
export function runProbe(config: ProbeRunConfig): RunResult {
  const started = Date.now();
  const observer = new MetricsObserver();
  const session = createSession(config, observer);
  let endReason: string | null = null;
  try {
    const start = runCommand(session.engine, `sandbox start biome:${config.biome} kit:${config.kit} seed:${config.seed}`);
    if (!start.success) throw new ProbeStop('opening_failed:sandbox_start');
    STRATEGIES[config.strategy](session);
  } catch (err) {
    if (!(err instanceof ProbeStop)) throw err;
    endReason = err.reason === 'horizon' ? null : err.reason;
  }
  const endTick = session.engine.ctx.state?.tickCount ?? 0;
  // Wall-clock goes to stderr only: stdout must be identical between runs.
  console.error(`[probe] ${config.biome}/${config.kit}/seed ${config.seed}/${config.strategy}: ${endTick} ticks in ${Date.now() - started} ms`);
  return { config, metrics: observer.finalize(), endTick, endReason };
}

/** Every run of the option matrix, in order; `onResult` sees each as it finishes. */
export function runMatrix(
  opts: ProbeOptions,
  onResult?: (result: RunResult) => void,
): RunResult[] {
  const results: RunResult[] = [];
  for (const config of expandMatrix(opts)) {
    const result = runProbe(config);
    results.push(result);
    onResult?.(result);
  }
  return results;
}
