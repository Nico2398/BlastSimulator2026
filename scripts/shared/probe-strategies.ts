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
//            c. Research Center, tier-2 Freight Warehouse, second hauler (as reinvest); a replacement for any
//               core role nobody alive holds; another spoil heap while ecology sags
//            d. frugal equipment: `vehicle upgrade` in place (rig, hauler, digger; no new driver on payroll) once the
//               dealer's grade gate allows, cash stays above LADDER_UPGRADE_RESERVE and a
//               licensed driver exists. The licence is earned as a player does: a Driving Center of the needed
//               tier, then `employee train` of a fresh hire (earnLicence)
//            e. a rock_fragmenter as soon as boulders lie on the ground, plus its licence course (earnLicence)
//            A charged pattern whose evacuation strands someone is disarmed (`blast cancel`) and retried.
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
import { onGroundMassKg } from '../../src/core/economy/Logistics.js';
import { getOperatingCostPerHour } from '../../src/core/economy/OperatingFinance.js';
import { getBuildingDef, getUpgradeCost } from '../../src/core/entities/Building.js';
import { getVehicleDefByTier, getVehicleReservation, vehicleDriverId } from '../../src/core/entities/Vehicle.js';
import { computeVehicleUpgradeCost } from '../../src/core/entities/VehicleUpgrade.js';
import { ROLE_LICENCE_REQUIRED, canDriveTier, countLicenceHolders, licenceLevelOfSkill } from '../../src/core/entities/VehicleDriverAssignment.js';
import { isEnrolledInTraining } from '../../src/core/entities/EmployeeTraining.js';
import {
  DRILL_RIG_MAX_DEPTH_M, DRILL_RIG_MAX_DIAMETER_M, HIRING_COSTS, PERMIT_LIMITS,
  WALL_BERM_MIN_WIDTH_M, WALL_SAFE_FACE_HEIGHT_M_BY_TIER,
} from '../../src/core/config/balance.js';
import { gradeDef } from '../../src/core/economy/MineGrade.js';
import { fleetBestRigLimit } from '../../src/core/mining/RigLimits.js';
import { rampCutSlopeRatio } from '../../src/core/mining/Ramp.js';
import { explosiveHoleLimits, maxFittingChargeKg } from '../../src/core/mining/ChargePlan.js';
import { getLevel } from '../../src/core/campaign/Level.js';
import { getEventById } from '../../src/core/events/EventPool.js';
import type { EventConsequence } from '../../src/core/events/EventPool.js';
import { getExplosive } from '../../src/core/world/ExplosiveCatalog.js';
import type { VehicleRole, VehicleTier } from '../../src/core/entities/Vehicle.js';
import {
  floorToKgResolution, limitSizedShot, mayBuyVehicleTier, nextBuy, pickDiameter, shouldApplyPermit, shouldBench,
  type BuyRule, type LadderShot, type PermitLimit,
} from './probe-ladder.js';
import {
  decideLadderEventOption, decideLadderRamp, decideLadderSafety, decideLadderShotGate,
} from './probe-ladder-policy.js';
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
/** Ramp: tiles between the pattern edge and the ramp's lower end, longest ramp tried. */
const RAMP_END_GAP = 1;
const RAMP_MAX_LENGTH = 34;
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

/** Explosive of every shot: the run's own (hard rock needs more than SHOT's krackle), else SHOT's. */
const shotExplosive = (s: ProbeSession): string => s.config.explosive ?? (hardRockLevel(s) ? HARD_ROCK_EXPLOSIVE : SHOT.explosive);

/** Explosive a campaign level of this difficulty tier or above is shot with: krackle breaks nothing in its hard rock at the grade-0 charge cap. */
const HARD_ROCK_MIN_DIFFICULTY_TIER = 4;
const HARD_ROCK_EXPLOSIVE = 'dynatomics';

function hardRockLevel(s: ProbeSession): boolean {
  const id = s.engine.ctx.campaignProfile.campaign.activeLevelId;
  const level = id ? getLevel(id) : undefined;
  return (level?.difficultyTier ?? 0) >= HARD_ROCK_MIN_DIFFICULTY_TIER && (level?.availableExplosives.includes(HARD_ROCK_EXPLOSIVE) ?? false);
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
function orderShot(s: ProbeSession, earlier: readonly (Pattern & { span?: number })[] = [], spec: ShotSpec = { ...SHOT, explosive: shotExplosive(s) }, at?: Pattern): Shot | null {
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

/** Footprint (origin and span) of the drilled pattern standing in the ground. */
function patternFootprint(state: GameState): Pattern & { span: number } {
  const xs = state.drillHoles.map(h => h.x);
  const zs = state.drillHoles.map(h => h.z);
  const x = Math.min(...xs);
  const z = Math.min(...zs);
  return { x, z, span: Math.max(Math.max(...xs) - x, Math.max(...zs) - z) + 1 };
}

/** Ticks an armed detonation may wait for the evacuation before it is disarmed. */
const FIRE_EVACUATION_MAX_TICKS = 150;

/** Clear the zone and detonate a charged pattern. */
function fireShot(s: ProbeSession): boolean {
  clearBlastZone(s.run, s.state);
  const r = s.run('blast detonate');
  if (!r.success) return false;
  // Armed: wait for the evacuation. Someone who cannot leave the zone disarms the shot, a careful player never fires on crew.
  for (let i = 0; i < FIRE_EVACUATION_MAX_TICKS && s.state.pendingDetonation !== null; i++) {
    if (s.run('blast status').output.includes('cannot leave')) break;
    s.tick();
  }
  if (s.state.pendingDetonation === null) return true;
  s.run('blast cancel');
  return false;
}

// ── Ramp ──

/**
 * Order a ramp from the open ground into the crater the shot at `at` (`span` wide) made, no steeper than
 * the vehicle cut ratio, the steepest the ramp tool accepts; the ramp's slope ratio when one was accepted, else null.
 */
function orderRamp(s: ProbeSession, at: Pattern, span = SHOT_SPAN, maxSlope = rampCutSlopeRatio(true)): number | null {
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

/** The opening's shot site; its ramp is dug and finished. */
function runOpening(s: ProbeSession): { at: Pattern } {
  const fail = (step: string): never => { throw new ProbeStop(`opening_failed:${step}`); };

  const ranked = rankDeposits(s.grid)[0];
  const site = ranked ? { x: ranked.x, z: ranked.z } : { x: s.grid.sizeX >> 1, z: s.grid.sizeZ >> 1 };
  if (!placeBuilding(s, 'living_quarters', site, site)) fail('living_quarters');

  const shot = orderShot(s);
  if (!shot) return fail('shot');
  s.waitFor('shot', () => shotReady(s.state));
  if (!fireShot(s)) fail('blast');
  s.tick(); // the blast resolves on the next command
  if (orderRamp(s, shot.at) === null) return fail('ramp');
  s.waitFor('ramp', () => !s.state.pendingActions.some(a => a.type === 'dig_ramp_segment'));
  playContracts(s.run, s.state);
  return { at: shot.at };
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
  /** Tick at which the current unfinished, unordered pattern was first seen; unset while none stands. */
  stalePatternSinceTick?: number;
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
  if (!shot && plan && shotReady(s.state) && s.state.pendingDetonation === null) {
    // A pattern abandoned after a refused or cancelled detonation still stands charged: fire it, or it blocks every later shot and the hauling its zone holds.
    const footprint = patternFootprint(s.state); // read before the blast consumes the holes
    tryOnce(s, m, 'refire', () => {
      if (!fireShot(s)) return false;
      m.origins.push(footprint);
      m.yieldPending = true;
      return true;
    });
    return;
  }
  if (!shot) {
    const idle = s.state.plannedDrillHoles.length === 0 && Object.keys(s.state.plannedChargesByHole).length === 0
      && s.state.drillHoles.length === 0;
    if (plan) { // a pattern nobody orders anymore that stays unfinished for a whole step budget is stuck
      if (idle) delete m.stalePatternSinceTick;
      else if (m.stalePatternSinceTick === undefined) m.stalePatternSinceTick = s.state.tickCount;
      else if (s.state.tickCount - m.stalePatternSinceTick > OPENING_STEP_MAX_TICKS) {
        abandonPattern(s);
        delete m.stalePatternSinceTick;
      }
    }
    const next = plan?.() ?? { cost: SHOT_EXPLOSIVE_KG + RE_FIRE_CASH_CUSHION, order: () => orderShotOnce(s, m) };
    if (idle && spendable(s) >= next.cost && (next.wanted === true || gradeNeedsBlast(s) || shouldReload(haulableOreOnGroundKg(s.state), m.lastYieldKg))) {
      m.shot = next.order();
    }
    return;
  }
  if (shotReady(s.state)) {
    // A refused detonation (an event's blasting ban) keeps the charged pattern: it is tried again next interval.
    if (fireShot(s)) {
      m.origins.push({ ...shot.at, span: shot.span });
      m.yieldPending = true;
      m.shot = null;
    } else if (s.state.tickCount - shot.startedTick > OPENING_STEP_MAX_TICKS) {
      m.shot = null;
    }
  } else if (s.state.tickCount - shot.startedTick > OPENING_STEP_MAX_TICKS) {
    m.shot = null;
    m.retryAt['shot'] = s.state.tickCount + PLACEMENT_RETRY_TICKS;
  }
}

/** Drop a half-drilled pattern no crew can finish (a hole beyond every hauler's reach); left standing it keeps the ladder from ordering any later shot. */
function abandonPattern(s: ProbeSession): void {
  s.run('drill_plan clear');
  for (const h of [...s.state.drillHoles]) s.run(`drill_plan remove hole:${h.id}`);
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
const LADDER_HOLE_DEPTH_M = 11;
/** A pit this close under the hole depth counts as dug: deepening then waits for a cleared crater instead of a fresh site. */
const LADDER_FRESH_SHOT_DEPTH_SLACK_M = 0.5;
/** Haulers the ladder buys while cash is idle: rubble clears at the fleet's pace, and a buried pit stalls every later shot. */
const LADDER_MAX_HAULERS = 6;
/** Shrink factors tried when a limit-sized pattern fits no free site, widest first. */
const LADDER_SHRINK_STEPS = [1, 0.75, 0.5, 0.25] as const;
const SOFTEST_SAFE_FACE_M = WALL_SAFE_FACE_HEIGHT_M_BY_TIER[1]!;

/** Roles the ladder upgrades in place, in priority order: depth (rig), haul capacity, ramp digging. */
const LADDER_UPGRADE_ROLES: readonly VehicleRole[] = ['drill_rig', 'debris_hauler', 'rock_digger'];
/** Cash kept back after an upgrade or a licence course: a stalled income must outlast the payroll it grew. */
const LADDER_UPGRADE_RESERVE = 150_000;
/** Ticks between hires made for a licence course: a fresh hire needs time to enrol and train before another is paid for. */
const LADDER_HIRE_COOLDOWN_TICKS = 600;
/** Employee role that holds (and so is trained for) each vehicle role's licence at hire. */
const trainRoleOf = (role: VehicleRole): 'driller' | 'driver' => (role === 'drill_rig' ? 'driller' : 'driver');

interface LadderMemory extends ReinvestMemory {
  /** Footprint of the last fired shot; the next bench and the crater ramp work from it. */
  crater: Pattern & { span: number };
  /** Floor depth (m) at which a ramp was last ordered; 0 before any. */
  rampedFloorM: number;
  /** Never apply for a permit past this grade (stay_g1); null for no cap. */
  maxGrade: number | null;
}

const gradeOf = (s: ProbeSession): number => s.state.grade?.grade ?? 0;

function depthTargetOpen(s: ProbeSession): boolean {
  return nextGradeTargets(s.state).some(t => t.kind === 'depth_m' && !t.met);
}

/** Fragments lying on the ground over a crater's footprint (and a tile around it). */
function craterRubble(state: GameState, crater: Pattern & { span: number }): number {
  return state.logistics.fragments.filter(f => f.state === 'on_ground'
    && f.fragment.position.x >= crater.x - 1 && f.fragment.position.x <= crater.x + crater.span + 1
    && f.fragment.position.z >= crater.z - 1 && f.fragment.position.z <= crater.z + crater.span + 1).length;
}

/** A haul still pending over a crater's footprint (and a tile around it). */
function craterHaulPending(state: GameState, crater: Pattern & { span: number }): boolean {
  return state.pendingActions.some(a => a.type === 'haul_debris'
    && a.targetX >= crater.x - 1 && a.targetX <= crater.x + crater.span + 1
    && a.targetZ >= crater.z - 1 && a.targetZ <= crater.z + crater.span + 1);
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
  const explosive = getExplosive(shotExplosive(s))!;
  /** Heaviest hole charge that stays inside the permit's total charge for an n x n pattern, the explosive's and the hole's own limits. */
  const kgFor = (n: number): number => floorToKgResolution(Math.min(
    limit.maxChargeKg / (n * n), explosiveHoleLimits(explosive, sized.diameterM).maxKg,
    maxFittingChargeKg(depth, sized.stemming, sized.diameterM),
  ));

  // Deepen the latest crater whose rubble is cleared (holes under rubble never finish); none clear: a fresh site meanwhile.
  // Deepen the latest crater whose rubble is cleared (holes under rubble never finish); none clear: a fresh site meanwhile.
  const crater = [...m.origins].reverse().map(o => ({ x: o.x, z: o.z, span: o.span ?? SHOT_SPAN }))
    .find(c => craterRubble(state, c) === 0 && !craterHaulPending(state, c));
  const deepen = depthTargetOpen(s) && crater !== undefined;
  const inset = deepen && shouldBench(state.grade?.deepestPitM ?? 0, SOFTEST_SAFE_FACE_M) ? BERM_GAP : 0;
  const siteSide = Math.floor((Math.min(s.grid.sizeX, s.grid.sizeZ) - 2 * BUILDING_SCAN_EDGE - 1) / sized.spacing) + 1;
  const craterSide = Math.floor(((crater?.span ?? 0) - 2 * inset) / sized.spacing) + 1;
  const wanted = Math.max(1, Math.min(sized.rows, deepen ? craterSide : siteSide));
  const free = getExplosivesFreeCapacity(state.buildings);
  let side = wanted;
  while (side > 0 && side * side * (kgFor(side) + 0.1) > free) side--;
  const kg = kgFor(Math.max(side, 1));
  const specFor = (n: number): ShotSpec => ({
    rows: n, cols: n, spacing: sized.spacing, depth, explosive: shotExplosive(s), kg: kgFor(n), stemming: sized.stemming, diameterM: sized.diameterM,
  });
  // Orders no ramp reaches never get hauled: they are not work for the crew.
  const hauling = state.pendingActions.some(a => a.type === 'haul_debris' && a.blockedReason === null);
  return {
    // Blast again to deepen a cleared crater, to dig the first full-depth pit, or when the crew has nothing left to haul (idle crew, no income).
    wanted: deepen || !hauling || (state.grade?.deepestPitM ?? 0) < LADDER_HOLE_DEPTH_M - LADDER_FRESH_SHOT_DEPTH_SLACK_M,
    cost: side === 0 ? Infinity : side * side * kg * explosive.costPerKg + RE_FIRE_CASH_CUSHION,
    order: () => {
      let ordered: Shot | null = null;
      tryOnce(s, m, 'shot', () => {
        for (const step of LADDER_SHRINK_STEPS) {
          const n = Math.max(1, Math.round(side * step));
          const at = deepen && crater ? { x: crater.x + inset, z: crater.z + inset } : undefined;
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

/**
 * Earn `role`'s licence at `tier` the way a player does: a Driving Center of that tier, then a course for
 * an employee of the role that holds the licence at hire (hiring one when none is free). True once a
 * living employee holds it; otherwise one step towards it is taken, cash permitting.
 */
function earnLicence(s: ProbeSession, m: ReinvestMemory, role: VehicleRole, tier: VehicleTier): boolean {
  const { state } = s;
  const skill = ROLE_LICENCE_REQUIRED[role];
  if (countLicenceHolders(state.employees.employees, role, tier) > 0) return true;
  const school = state.buildings.buildings.find(b => b.type === 'driving_center');
  if (!school) {
    if (!state.plannedBuildings.some(p => p.type === 'driving_center')
      && spendable(s) >= getBuildingDef('driving_center', 1).constructionCost) {
      tryOnce(s, m, 'driving_center', () => placeBuilding(s, 'driving_center', rallyOf(s), null) !== null);
    }
    return false;
  }
  if (school.tier < tier) { upgradeBuilding(s, m, 'driving_center'); return false; }
  const trainRole = trainRoleOf(role);
  const crew = state.employees.employees.filter(e => e.alive && e.role === trainRole);
  if (crew.some(isEnrolledInTraining)) return false;
  // Only an employee with no work in hand walks to school: a held vehicle reservation would outlive the walk.
  // A busy crew is never idle, so the course goes to a fresh hire, enrolled the tick it arrives.
  const idle = crew.find(e => e.activeActionId === null && e.taskQueue.length === 0
    && licenceLevelOfSkill(e.qualifications, skill) < tier);
  let trainee = idle;
  if (!trainee) {
    if (spendable(s) < HIRING_COSTS[trainRole] + LADDER_CASH_RESERVE || (m.retryAt[`hire_${skill}`] ?? 0) > state.tickCount) return false;
    m.retryAt[`hire_${skill}`] = state.tickCount + LADDER_HIRE_COOLDOWN_TICKS;
    if (!s.run(`employee hire role:${trainRole}`).success) return false;
    trainee = state.employees.employees.filter(e => e.alive && e.role === trainRole).sort((x, y) => y.id - x.id)[0];
    if (!trainee) return false;
  }
  tryOnce(s, m, `train_${skill}`, () => s.run(`employee train ${trainee.id} skill:${skill}`).success);
  return false;
}

/**
 * Upgrade one vehicle in place (no new driver on payroll) when the dealer's grade gate allows its next tier,
 * a licensed driver exists and cash stays above LADDER_UPGRADE_RESERVE after it.
 */
function ladderEquipment(s: ProbeSession, m: LadderMemory): void {
  const grade = gradeOf(s);
  const rules: (BuyRule & { vehicleId: number; role: VehicleRole; tier: VehicleTier })[] = [];
  for (const role of LADDER_UPGRADE_ROLES) {
    // An unreserved vehicle whose driver (if any) already holds the next tier's licence: a mid-task swap would strand its holder.
    const lowest = s.state.vehicles.vehicles
      .filter(v => v.type === role && getVehicleReservation(s.state.vehicles, v.id) === null)
      .filter(v => {
        const driver = s.state.employees.employees.find(e => e.id === vehicleDriverId(v));
        return !driver || canDriveTier(driver, role, (v.tier + 1) as VehicleTier);
      })
      .sort((a, b) => a.tier - b.tier)[0];
    const next = lowest ? ((lowest.tier + 1) as VehicleTier) : null;
    if (!lowest || next === null || next > 3 || !mayBuyVehicleTier(next, grade)) continue;
    const cost = computeVehicleUpgradeCost(role, lowest.tier);
    if (cost !== null) rules.push({ id: `${lowest.id}`, vehicleId: lowest.id, role, tier: next, cost });
  }
  const pick = nextBuy(s.state.cash, LADDER_UPGRADE_RESERVE, rules, new Set<string>());
  // The licence is earned for the first rule even before its upgrade is affordable.
  const bought = rules.find(r => r.id === pick?.id) ?? rules[0];
  if (!bought || s.state.cash < LADDER_UPGRADE_RESERVE) return;
  if (!earnLicence(s, m, bought.role, bought.tier) || !pick) return;
  tryOnce(s, m, `upgrade_${bought.vehicleId}`, () => s.run(`vehicle upgrade ${bought.vehicleId}`).success);
}

/** A fragmenter as soon as boulders lie on the ground, and the licence its driver must earn at the Driving Center. */
function ladderFragmenter(s: ProbeSession, m: ReinvestMemory): void {
  const { state } = s;
  const owned = state.vehicles.vehicles.some(v => v.type === 'rock_fragmenter');
  if (!owned) {
    if (!state.logistics.fragments.some(f => f.state === 'on_ground' && isOversized(f.fragment.volume))) return;
    const cost = getVehicleDefByTier('rock_fragmenter', 1).purchaseCost;
    if (state.cash - LADDER_UPGRADE_RESERVE < cost) return;
    tryOnce(s, m, 'fragmenter', () => s.run('vehicle buy rock_fragmenter').success);
  }
  earnLicence(s, m, 'rock_fragmenter', 1);
}

/** Hire a replacement for any core role nobody alive holds (a blaster lost mid-shot stalls every charge order). */
function ladderCrew(s: ProbeSession, m: ReinvestMemory): void {
  for (const role of ['blaster', 'driller', 'driver'] as const) {
    if (s.state.employees.employees.some(e => e.alive && e.role === role) || spendable(s) < HIRING_COSTS[role]) continue;
    tryOnce(s, m, `crew_${role}`, () => s.run(`employee hire role:${role}`).success);
  }
}

/** Ecology under which another spoil heap is built, and the most the ladder builds: loose rubble past a heap's capacity drains it. */
const LADDER_ECOLOGY_FLOOR = 40;
const LADDER_MAX_SPOIL_HEAPS = 4;

/** Another spoil heap while ecology sags and rubble outgrows the heaps' room. */
function ladderSpoil(s: ProbeSession, m: ReinvestMemory): void {
  if (s.state.scores.ecology >= LADDER_ECOLOGY_FLOOR || countOf(s, 'spoil_heap') >= LADDER_MAX_SPOIL_HEAPS
    || s.state.plannedBuildings.some(p => p.type === 'spoil_heap')
    || spendable(s) < getBuildingDef('spoil_heap', 1).constructionCost) return;
  tryOnce(s, m, 'spoil_heap', () => placeBuilding(s, 'spoil_heap', rallyOf(s), null) !== null);
}

/** Estimated cash a ramp dig costs (crew time and spoil); the ramp is ordered only when the reserve survives it. */
const LADDER_RAMP_COST = 20_000;

/**
 * One ramp per new pit floor, into the latest crater as soon as its yield is measured. Never gated on the rubble
 * being cleared: the ramp is what lets the haulers reach that rubble, so waiting for it stalls income (#2041).
 */
function ladderCraterRamp(s: ProbeSession, m: LadderMemory): void {
  if (m.yieldPending || m.shot !== null || s.state.pendingActions.some(a => a.type === 'dig_ramp_segment')) return;
  const floorDepthM = s.state.grade?.deepestPitM ?? 0;
  const decision = decideLadderRamp({
    floorDepthM, rampedFloorM: m.rampedFloorM,
    cash: s.state.cash, rampCost: LADDER_RAMP_COST, reserve: LADDER_UPGRADE_RESERVE,
  });
  if (decision === 'skip') return;
  tryOnce(s, m, 'crater_ramp', () => {
    const slope = orderRamp(s, m.crater, m.crater.span);
    if (slope === null) return false;
    m.rampedFloorM = floorDepthM;
    return true;
  });
}

/** Safety target of the next grade is open and a Management Office is how the ladder lifts the score. */
function ladderSafety(s: ProbeSession, m: ReinvestMemory): void {
  const targets = nextGradeTargets(s.state);
  const office = s.state.buildings.buildings.find(b => b.type === 'management_office');
  const nextTier = Math.min((office?.tier ?? 0) + 1, 3) as 1 | 2 | 3;
  const decision = decideLadderSafety({
    safetyTargetOpen: targets.some(t => t.kind === 'safety' && !t.met),
    neighboursBelowTarget: targets.some(t => t.kind === 'neighbours' && !t.met),
    officeBuilt: office !== undefined,
    canAfford: s.state.cash - getBuildingDef('management_office', nextTier).constructionCost >= LADDER_UPGRADE_RESERVE,
  });
  if (decision === 'build_office' && !s.state.plannedBuildings.some(p => p.type === 'management_office')) {
    tryOnce(s, m, 'management_office', () => placeBuilding(s, 'management_office', rallyOf(s), null) !== null);
  } else if (decision === 'upgrade_office') {
    upgradeBuilding(s, m, 'management_office');
  }
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

/** Rock mass (kg) a hauler can still reach: on the ground with a haul order not blocked as out of reach. Rubble no ramp reaches stays put and must not hold shots forever. */
function reachableRubbleKg(state: GameState): number {
  const reachable = new Set<number>();
  for (const a of state.pendingActions) {
    if (a.type === 'haul_debris' && a.blockedReason === null) reachable.add((a.payload as { fragmentId: number }).fragmentId);
  }
  let kg = 0;
  for (const f of state.logistics.fragments) if (f.state === 'on_ground' && reachable.has(f.fragment.id)) kg += f.fragment.mass;
  return kg;
}

/** The ladder's shot plan, held (unaffordable) while the pit is buried or payroll runway is short. */
function gatedLadderPlan(s: ProbeSession, m: LadderMemory): ShotPlan {
  const plan = ladderPlan(s, m);
  const rubbleKg = reachableRubbleKg(s.state);
  // No reachable rubble means no hauling work and no income: holding on the payroll runway alone would
  // starve the idle-crew recovery shot while payroll drains, so the gate only applies with rubble to clear.
  if (rubbleKg === 0) return plan;
  const hold = decideLadderShotGate({
    grade: gradeOf(s),
    rubbleKg,
    cash: s.state.cash,
    payrollPerTick: getOperatingCostPerHour(s.state).payroll,
  }) === 'hold';
  return hold ? { ...plan, cost: Infinity } : plan;
}

/** Another hauler (and its driver) while cash sits idle and the pit still holds rubble. */
function ladderHaulers(s: ProbeSession, m: ReinvestMemory): void {
  const haulers = s.state.vehicles.vehicles.filter(v => v.type === 'debris_hauler').length;
  const cost = getVehicleDefByTier('debris_hauler', 1).purchaseCost + HIRING_COSTS.driver;
  if (haulers >= LADDER_MAX_HAULERS || s.state.cash - cost < LADDER_UPGRADE_RESERVE || onGroundMassKg(s.state.logistics) === 0) return;
  tryOnce(s, m, 'hauler', () => buyHauler(s));
}

function runLadder(s: ProbeSession, maxGrade: number | null): void {
  const opened = runOpening(s);
  const m: LadderMemory = {
    shot: null, origins: [opened.at], lastYieldKg: haulableOreOnGroundKg(s.state), yieldPending: false,
    researchOrdered: false, retryAt: {},
    crater: { ...opened.at, span: SHOT_SPAN }, rampedFloorM: 0, maxGrade,
  };
  playOut(s, () => {
    ladderPermit(s, m);
    ladderCrew(s, m);
    ladderSpoil(s, m);
    ladderSafety(s, m);
    reinvestShot(s, m, () => gatedLadderPlan(s, m));
    const last = m.origins[m.origins.length - 1]!;
    if (last.x !== m.crater.x || last.z !== m.crater.z) m.crater = { x: last.x, z: last.z, span: last.span ?? SHOT_SPAN };
    ladderCraterRamp(s, m);
    reinvestBuy(s, m);
    ladderHaulers(s, m);
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

/** True when choosing this outcome (or its fallback) puts a new employee on the payroll. */
function addsHire(c: EventConsequence | undefined): boolean {
  if (!c) return false;
  return (c.effects ?? []).some(e => e.type === 'employee_joins') || addsHire(c.altConsequence);
}

/** Answer a pending event the ladder's way (see decideLadderEventOption); a no-op when none is pending. */
function answerLadderEvent(run: Run, state: GameState): void {
  const pending = state.events.pendingEvent;
  const def = pending ? getEventById(pending.eventId) : undefined;
  if (!def) return;
  run(`event choose ${decideLadderEventOption(def.consequences.map(addsHire))}`);
}

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
    tick: () => {
      if (config.strategy === 'ladder' || config.strategy === 'stay_g1') answerLadderEvent(session.run, session.state);
      playTick(session.run, session.state);
    },
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

/**
 * One headless playthrough. Never throws on a failed step: the reason lands in `endReason`.
 * `start` replaces the default `sandbox start` opening (a campaign level's run, #1949); it returns
 * false when the game did not start.
 */
export function runProbe(config: ProbeRunConfig, start?: (engine: RunnerWithContext) => boolean): RunResult {
  const started = Date.now();
  const observer = new MetricsObserver();
  const session = createSession(config, observer);
  let endReason: string | null = null;
  try {
    const opened = start
      ? start(session.engine)
      : runCommand(session.engine, `sandbox start biome:${config.biome} kit:${config.kit} seed:${config.seed}`).success;
    if (!opened) throw new ProbeStop('opening_failed:sandbox_start');
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
