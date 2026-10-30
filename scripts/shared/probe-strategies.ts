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
//            g. a replacement for any core role nobody alive holds (replaceLostCrew): an event can take the
//               only blaster, and every later charge order waits on one; new living quarters beside the last
//               shot when a shot destroyed the last ones (rebuildLostQuarters)
//            Calibration tasks extend this list; keep each rule one short block.
//
//   ladder   The full-ladder player (#1945). The reinvest opening, then every interval:
//            a. contracts, and `permit apply` the moment shouldApplyPermit allows it
//            b. a blast for the current grade: every hole fully charged in the bore with the longest charge
//               column (deepestBreakoutDiameter), as many holes as the permit allows (fullHoleSide), spaced by
//               the charge (holeSpacingForChargeM); while a depth target is open it deepens the crater,
//               insetting the footprint by a berm once the pit is taller than the stability limit
//            c. Research Center, tier-2 Freight Warehouse, second hauler (as reinvest); a replacement for any
//               core role nobody alive holds; another spoil heap while ecology sags
//            d. frugal equipment: `vehicle upgrade` in place (rig, hauler, digger; no new driver on payroll) once the
//               dealer's grade gate allows, cash stays above LADDER_UPGRADE_RESERVE and a
//               licensed driver exists. The licence is earned as a player does: a Driving Center of the needed
//               tier, then `employee train` of a fresh hire (earnLicence)
//            e. a rock_fragmenter as soon as boulders lie on the ground, plus its licence course (earnLicence)
//            A charged pattern whose evacuation strands crew is disarmed (`blast cancel`) and retried; one that
//            strands only vehicles is fired anyway (`blast`).
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
import { getOperatingCostPerHour } from '../../src/core/economy/OperatingFinance.js';
import { getBuildingDef, getDefSize, getUpgradeCost, type BuildingTier } from '../../src/core/entities/Building.js';
import { FREIGHT_WAREHOUSE_CAPACITY_KG, SPOIL_HEAP_CAPACITY_KG } from '../../src/core/config/balance.js';
import { getVehicleDefByTier, getVehicleReservation, vehicleDriverId } from '../../src/core/entities/Vehicle.js';
import { computeVehicleUpgradeCost } from '../../src/core/entities/VehicleUpgrade.js';
import { ROLE_LICENCE_REQUIRED, canDriveTier, countLicenceHolders, licenceLevelOfSkill } from '../../src/core/entities/VehicleDriverAssignment.js';
import { isEnrolledInTraining } from '../../src/core/entities/EmployeeTraining.js';
import {
  DRILL_HOLE_DIAMETER_OPTIONS_M, DRILL_HOLE_DIAMETER_SNAP_TOLERANCE_M, DRILL_RIG_MAX_DEPTH_M, DRILL_RIG_MAX_DIAMETER_M, HIRING_COSTS, PERMIT_LIMITS,
  VEHICLE_MAX_SLOPE_RATIO, WALL_BERM_MIN_WIDTH_M, WALL_SAFE_FACE_HEIGHT_M_BY_TIER, needRestSearchRadius,
} from '../../src/core/config/balance.js';
import { gradeDef } from '../../src/core/economy/MineGrade.js';
import { fleetBestRigLimit } from '../../src/core/mining/RigLimits.js';
import { rampCutSlopeRatio } from '../../src/core/mining/Ramp.js';
import { chargeColumnM, explosiveHoleLimits, maxFittingChargeKg } from '../../src/core/mining/ChargePlan.js';
import { getLevel } from '../../src/core/campaign/Level.js';
import { getEventById } from '../../src/core/events/EventPool.js';
import type { EventConsequence } from '../../src/core/events/EventPool.js';
import { getRock } from '../../src/core/world/RockCatalog.js';
import { getExplosive } from '../../src/core/world/ExplosiveCatalog.js';
import type { VehicleRole, VehicleTier } from '../../src/core/entities/Vehicle.js';
import { nearestHaulDepot, newCraterAccessMemory, playPitLogistics, rampKeepOutZones, strandedCrew, type CraterAccessMemory } from './probe-crater-access.js';
import {
  floorToKgResolution, fullHoleSide, holeSpacingForChargeM, mayBuyVehicleTier, nextBuy, pickDiameter, shouldApplyPermit, shouldBench,
  type BuyRule, type LadderShot, type PermitLimit,
} from './probe-ladder.js';
import {
  decideLadderDeepen, shaftHoleDepthM, decideFreshShotSite, decideBuriedPattern, decideLadderShotSide, siteHoldsOre, decideLadderEventOption, decideLadderRamp, decideLadderReach, reachableShotDepthM,
  LADDER_GATE_MIN_GRADE, LADDER_RAMP_PROTECT_MARGIN_M, LADDER_SITE_ORE_FLOOR, decideLadderSafety, decideLadderShotGate,
  rampProtectionZones, shotOverlapsProtectedRamp,
  decideLadderHoleDepth, breakoutHoleDepthM, judgeLadderShot, LADDER_TIGHT_BURDEN_M, depotsToOrder,
  type ProtectedZone, type RampFootprintInput,
} from './probe-ladder-policy.js';
import { createFragmentLookup, pendingSpoilOverflowKg, sealedFragmentIdsOf } from '../../src/core/economy/HaulDispatch.js';
import { cellKey, fragmentBuriesPlannedHole, rubbleCoverCounts, trackedBuriesPlannedHole } from '../../src/core/mining/BuriedHoles.js';
import { siteVehicleReach } from '../../src/core/engine/OrderReachability.js';
import { countZoneOccupants, isInZone } from '../../src/core/entities/Zone.js';
import { findPath } from '../../src/core/nav/Pathfinding.js';
import { findBuildingApproachCell } from '../../src/core/nav/BuildingApproach.js';
import { vehicleMaxSlopeRatio } from '../../src/core/entities/Vehicle.js';
import { isProgressionSite } from '../../src/core/state/GameState.js';
import { NAV_CLEARANCE_VEHICLE_CELLS } from '../../src/core/config/balance.js';
import { haulDestinationOf } from '../../src/core/economy/SpoilHeaps.js';
import { terrainConfigOf } from '../../src/console/commands/world.js';
import { resolveStarterDeposit } from '../../src/core/world/StarterDeposit.js';
import { oreGradeScaleOf } from '../../src/core/economy/OreGrade.js';
import { BLAST_ZONE_CLEAR_MARGIN, playContracts, playTick, clearBlastZone, explosiveRoomKg, topUpWarehouse, type Run } from './player-actions.js';
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
/** Metres a fresh ladder shot keeps from any standing building when a site allows it. */
const LADDER_BUILDING_KEEP_OUT_M = 16;
/** Metres around a building's footprint no ladder shot ever takes, even when every site lies within LADDER_BUILDING_KEEP_OUT_M of one. */
const LADDER_BUILDING_HARD_CLEAR_M = 6;
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

export interface ProbeSession {
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
  /** The ladder's pit-logistics memory, read when it answers a traffic jam; unset before the ladder starts. */
  ladderAccess?: CraterAccessMemory;
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

/**
 * Origin of the reference shot centred on the site's starter deposit (#2116, #2123), or null when the site has none.
 * The probe reads it as it reads ore: ground truth standing in for the survey. The opening shoots it when the richest
 * deposit's rock is too hard for the reference charge (`rockBreaks`); shot first elsewhere it sold too little to carry the
 * payroll. Where the richest deposit breaks (desert_badlands, alpine_granite) the opening keeps it: starter-first sold less there, so
 * the starter is the fallback for unbreakable richest rock (tropical_karst, volcanic_flats). The explosive warehouse is raised beside the quarters either way.
 */
export function starterShotOrigin(state: GameState, span: number = SHOT_SPAN): Pattern | null {
  const config = terrainConfigOf(state);
  const starter = config ? resolveStarterDeposit(config) : null;
  return starter ? { x: starter.x - span / 2, z: starter.z - span / 2 } : null;
}

/** Metres a building other than a depot keeps from every depot: haulers queue in the gap to dock. */
const DEPOT_APPROACH_CLEAR_M = 6;

/** Footprints of the site's haul depots (freight warehouses and spoil heaps), built or planned. */
function depotSites(s: ProbeSession): Array<Pattern & { span: number }> {
  return [...s.state.buildings.buildings, ...s.state.plannedBuildings]
    .filter(b => b.type === 'freight_warehouse' || b.type === 'spoil_heap')
    .map(b => {
      const { sizeX, sizeZ } = getDefSize(getBuildingDef(b.type, (b as { tier?: BuildingTier }).tier ?? 1));
      return { x: b.x, z: b.z, span: Math.max(sizeX, sizeZ) };
    });
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
 * Cells a building that need not stand by the road keeps between its footprint and the trucks' road. On the seed-42
 * desert digger ladder a research centre and quarters raised either side of the road from the pits to the warehouse
 * left one vehicle lane and 3.8 of 8 haulers stood waiting at any tick. Ladder, 8 haulers, at t4500: seed 42 ends
 * $12.2M against $11.6M, seed 7 $5.1M against $2.5M; green foothills seed 42 places the same buildings.
 */
const HAUL_ROAD_CLEAR_M = 3;

/** Buildings that stand by the road: the depots it joins, and the quarters the crew rests in. */
const ROADSIDE_TYPES: ReadonlySet<string> = new Set(['freight_warehouse', 'spoil_heap', 'living_quarters']);

/** Waypoints of the trucks' road from every haul depot to every ramp top, built or ordered. */
function haulRoadCells(s: ProbeSession): Pattern[] {
  const nav = s.state.navGrid;
  if (nav === null) return [];
  const limits = { requiredClearance: NAV_CLEARANCE_VEHICLE_CELLS, maxSlopeRatio: vehicleMaxSlopeRatio(isProgressionSite(s.state)) };
  const tops = [...s.state.builtRamps, ...s.state.plannedRamps].map(r => ({ x: r.def.originX, z: r.def.originZ }));
  const cells: Pattern[] = [];
  for (const depot of s.state.buildings.buildings.filter(b => b.type === 'freight_warehouse' || b.type === 'spoil_heap')) {
    const def = getBuildingDef(depot.type, depot.tier);
    for (const top of tops) {
      const from = findBuildingApproachCell(nav, depot, def, top.x, top.z);
      const road = findPath(nav, { agentId: -1, fromX: from.x, fromZ: from.z, toX: top.x, toZ: top.z, avoidVehicles: false, ...limits });
      if (road.found) cells.push(...road.waypoints);
    }
  }
  return cells;
}

/** Anchors at which a `type` footprint would come within HAUL_ROAD_CLEAR_M of the road ("x,z" keys). */
function anchorsBesideRoad(type: string, road: readonly Pattern[]): Set<string> {
  const { sizeX, sizeZ } = getDefSize(getBuildingDef(type as never, 1));
  const out = new Set<string>();
  for (const c of road) {
    for (let x = c.x - sizeX + 1 - HAUL_ROAD_CLEAR_M; x <= c.x + HAUL_ROAD_CLEAR_M; x++) {
      for (let z = c.z - sizeZ + 1 - HAUL_ROAD_CLEAR_M; z <= c.z + HAUL_ROAD_CLEAR_M; z++) out.add(`${x},${z}`);
    }
  }
  return out;
}

/**
 * Coarse scan for the nearest spot (to `near`) a `build` command accepts, outside the keep-out
 * around the shot `avoid`. Near the work matters: a crew rests at its Living Quarters, so a far
 * one costs walking time on payroll. Returns the spot or null.
 */
function placeBuilding(
  s: ProbeSession, type: string, near: Pattern, avoid: Pattern | null,
  clearOf: readonly (Pattern & { span?: number; clearM?: number })[] = [], clearM = 0,
): Pattern | null {
  const { sizeX, sizeZ } = s.grid;
  const spots: Pattern[] = [];
  // Within `clearM` (or the footprint's own) of a footprint in `clearOf` (every shot site, say): a shot there could reach it.
  const nearShot = (x: number, z: number): boolean => clearOf.some(o => {
    const c = o.clearM ?? clearM;
    return x > o.x - c && x < o.x + (o.span ?? SHOT_SPAN) + c && z > o.z - c && z < o.z + (o.span ?? SHOT_SPAN) + c;
  });
  for (let z = BUILDING_SCAN_EDGE; z <= sizeZ - BUILDING_SCAN_EDGE; z += BUILDING_SCAN_STEP) {
    for (let x = BUILDING_SCAN_EDGE; x <= sizeX - BUILDING_SCAN_EDGE; x += BUILDING_SCAN_STEP) {
      const inKeepOut = avoid !== null && x > avoid.x - BUILDING_KEEP_OUT && x < avoid.x + SHOT_SPAN + BUILDING_KEEP_OUT
        && z > avoid.z - BUILDING_KEEP_OUT && z < avoid.z + SHOT_SPAN + BUILDING_KEEP_OUT;
      if (!inKeepOut && !nearShot(x, z)) spots.push({ x, z });
    }
  }
  const dist = (p: Pattern) => Math.hypot(p.x - near.x, p.z - near.z);
  spots.sort((a, b) => dist(a) - dist(b));
  // Off the road first; a site with nowhere else to build still gets the building. Depots are the road's ends, and
  // quarters stay by the work: moved off the road, the drivers' rest walks took a fifth of their time.
  const besideRoad = ROADSIDE_TYPES.has(type) ? new Set<string>() : anchorsBesideRoad(type, haulRoadCells(s));
  const offRoad = spots.filter(p => !besideRoad.has(`${p.x},${p.z}`));
  for (const p of [...offRoad, ...spots.filter(p => besideRoad.has(`${p.x},${p.z}`))]) {
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

/** Extra limits on a fresh shot site: protected ground kept clear, and used-up ground skipped. */
export interface FreshSiteRules {
  /** Skipped unless that would leave no site. */
  protectedZones: readonly ProtectedZone[];
  /** Never shot over, whatever is left: the ramps the fleet reaches the pit by. No site is better than cutting the way in. */
  forbiddenZones?: readonly ProtectedZone[];
}

/**
 * Free deposits best first. With `rules`, sites on ore-less ground are skipped while ore remains elsewhere, and sites over a
 * protected ramp corridor are skipped unless that would leave none (a ladder that finds no site stalls). Sites over
 * `keepOut` (the built ramps a shot must not damage, `rampKeepOutZones`) are skipped the same way.
 */
export function freshSites(
  grid: VoxelGrid, span: number, depth: number, earlier: readonly (Pattern & { span?: number })[], rules?: FreshSiteRules,
  keepOut: readonly ProtectedZone[] = [],
): Pattern[] {
  const forbidden = rules?.forbiddenZones ?? [];
  const sites = ruledSites(grid, span, depth, earlier, rules, c => !shotOverlapsProtectedRamp({ x: c.x, z: c.z, span }, forbidden));
  const clear = sites.filter(c => !shotOverlapsProtectedRamp({ x: c.x, z: c.z, span }, keepOut));
  return clear.length > 0 ? clear : sites;
}

/**
 * Free sites the rules keep, richest first. `allowed` drops a site before the richest is weighed: measured against a
 * best site under a ramp, every site a shot may take read as too poor, and the seed-42 full-kit ladder fired nothing
 * from t5800 on, 9.5 t of ore short of grade 3.
 */
function ruledSites(
  grid: VoxelGrid, span: number, depth: number, earlier: readonly (Pattern & { span?: number })[], rules?: FreshSiteRules,
  allowed: (c: Pattern) => boolean = () => true,
): Pattern[] {
  const free = rankDeposits(grid, span, depth)
    .filter(c => allowed(c) && !earlier.some(o => overlapsShot({ ...c, span }, o, earlier.length > 0 ? BERM_GAP : 0)));
  if (!rules) return free;
  const groundOreKgRemaining = free.reduce((sum, c) => sum + c.ore, 0);
  const floored = free.filter(c => decideFreshShotSite({
    oreKgUnderSite: c.ore, siteOreKgFloor: LADDER_SITE_ORE_FLOOR, groundOreKgRemaining,
  }) === 'fire');
  // Buildings are shot over only when no other site is left: weighed against the richest site by the warehouses, the
  // sites clear of them read as too poor and a shot took two warehouses and their ore.
  const clear = floored.filter(c => !shotOverlapsProtectedRamp({ x: c.x, z: c.z, span }, rules.protectedZones));
  const pool = clear.length > 0 ? clear : floored;
  // A site far poorer than the best only buries ground the ladder must clear; if none is rich enough, keep the pool.
  const bestSiteOre = pool.reduce((best, c) => Math.max(best, c.ore), 0);
  const rich = pool.filter(c => siteHoldsOre({ oreKgUnderSite: c.ore, bestSiteOre }));
  return rich.length > 0 ? rich : pool;
}

/** Order `spec` at `at`, or on the best free deposit when `at` is not given. */
function orderShot(s: ProbeSession, earlier: readonly (Pattern & { span?: number })[] = [], spec: ShotSpec = { ...SHOT, explosive: shotExplosive(s) }, at?: Pattern, rules?: FreshSiteRules): Shot | null {
  const span = spanOf(spec);
  const candidates = at ? [at] : freshSites(s.grid, span, spec.depth, earlier, rules, rampKeepOutZones(s.state)).slice(0, DEPOSIT_CANDIDATES_TRIED);
  // The stock buy takes whole kg; round up so the pattern's charge is covered.
  const totalKg = Math.ceil(spec.rows * spec.cols * spec.kg);
  const diameter = spec.diameterM === undefined ? '' : ` diameter:${spec.diameterM}`;
  for (const c of candidates) {
    const cmd = `drill_plan grid rows:${spec.rows} cols:${spec.cols} spacing:${spec.spacing} depth:${spec.depth} start:${c.x},${c.z}${diameter}`;
    if (!s.run(cmd).success) continue;
    if (!topUpWarehouse(s.run, s.state, spec.explosive, totalKg).success) return null;
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

/** Footprint (origin and span) of the drilled pattern standing in the ground, or of other holes. */
function patternFootprint(state: GameState, holes: readonly Pattern[] = state.drillHoles): Pattern & { span: number } {
  const xs = holes.map(h => h.x);
  const zs = holes.map(h => h.z);
  const x = Math.min(...xs);
  const z = Math.min(...zs);
  return { x, z, span: Math.max(Math.max(...xs) - x, Math.max(...zs) - z) + 1 };
}

/** Ticks an armed detonation may wait with nobody more leaving the zone before it is disarmed. */
const FIRE_EVACUATION_MAX_TICKS = 150;
/**
 * Longest wait (ticks) for an evacuation that keeps emptying the zone. A deepening shot's zone took in 10 to 20 crew
 * working the pit entrance on the seed-42 full-kit ladder; disarmed after a flat 150 ticks while they were still filing
 * out, the same pattern was armed and cancelled for thousands of ticks.
 */
const FIRE_EVACUATION_CAP_TICKS = 900;

/** Whether anyone alive stands in the active blast zone. */
function crewInZone(state: GameState): boolean {
  const zone = state.zone.activeZone;
  return zone !== null && state.employees.employees.some(e => e.alive && isInZone(e.x, e.z, zone));
}

/** Clear the zone and detonate a charged pattern. */
function fireShot(s: ProbeSession): boolean {
  clearBlastZone(s.run, s.state);
  const r = s.run('blast detonate');
  if (!r.success) return false;
  // Armed: wait for the evacuation while it makes progress. Someone who cannot leave the zone disarms the shot, a
  // careful player never fires on crew.
  let fewest = Infinity;
  let idle = 0;
  for (let i = 0; i < FIRE_EVACUATION_CAP_TICKS && s.state.pendingDetonation !== null && idle < FIRE_EVACUATION_MAX_TICKS; i++) {
    if (s.run('blast status').output.includes('cannot leave')) {
      // Only unmanned vehicles stranded: the player fires anyway and writes them off. Disarmed instead, the same shot was
      // armed again every interval and each arming evacuated the crew digging the ramp out to them: 53 cancels from
      // t4870 on the seed-42 full-kit ladder (#2091).
      if (!crewInZone(s.state)) return s.run('blast').success && s.state.pendingDetonation === null;
      break;
    }
    const zone = s.state.zone.activeZone;
    const left = zone === null ? 0 : countZoneOccupants(zone, s.state.vehicles, s.state.employees);
    if (left < fewest) { fewest = left; idle = 0; } else idle++;
    s.tick();
  }
  if (s.state.pendingDetonation === null) return true;
  s.run('blast cancel');
  return false;
}

// ── Ramp ──

/** A ramp accepted by `build_ramp`: rise over run, and the horizontal run (m). */
interface RampOrder extends RampFootprintInput { slope: number }

/**
 * Order a ramp from the open ground into the crater the shot at `at` (`span` wide) made, no steeper than
 * the vehicle cut ratio, the steepest the ramp tool accepts; the ramp's slope ratio and run when one was accepted, else null.
 * Shortest first; among ramps of one length, the one whose top lies nearest the haul depot, so the crater is entered
 * from the side its loads leave by at no extra digging. The top stands outside the shot's broken footprint: a rib of
 * rock left standing between two holes reads as ground above the floor, and a ramp cut down from it takes the rib
 * away, leaving its digger in a crater with no way out.
 */
function insideShotFootprint(p: { x: number; z: number }, at: Pattern, span: number): boolean {
  const within = (v: number, lo: number): boolean => v >= lo - RAMP_END_GAP && v <= lo + span + RAMP_END_GAP;
  return within(p.x, at.x) && within(p.z, at.z);
}

function orderRamp(s: ProbeSession, at: Pattern, span = SHOT_SPAN, maxSlope = rampCutSlopeRatio(true)): RampOrder | null {
  const { grid } = s;
  const mid = span / 2;
  const centre = { x: at.x + mid, z: at.z + mid };
  const floor = getSmoothTerrainSurfaceY(grid, centre.x, centre.z);
  const depot = nearestHaulDepot(s.state, centre);
  const lanes = [
    { dx: -1, dz: 0, end: { x: at.x - RAMP_END_GAP, z: centre.z } },
    { dx: 1, dz: 0, end: { x: at.x + span + RAMP_END_GAP, z: centre.z } },
    { dx: 0, dz: -1, end: { x: centre.x, z: at.z - RAMP_END_GAP } },
    { dx: 0, dz: 1, end: { x: centre.x, z: at.z + span + RAMP_END_GAP } },
  ];
  const topToDepot = (lane: typeof lanes[number], length: number): number => (depot === null ? 0
    : Math.hypot(lane.end.x - lane.dx * length - depot.x, lane.end.z - lane.dz * length - depot.z));
  for (let length = 8; length <= RAMP_MAX_LENGTH; length++) {
    // Array.sort is stable: without a depot the lanes keep their order.
    for (const lane of [...lanes].sort((a, b) => topToDepot(a, length) - topToDepot(b, length))) {
      const start = { x: lane.end.x - lane.dx * length, z: lane.end.z - lane.dz * length };
      if (start.x < 1 || start.z < 1 || start.x >= grid.sizeX - 1 || start.z >= grid.sizeZ - 1) continue;
      if (insideShotFootprint(start, at, span)) continue;
      const depth = Math.round(getSmoothTerrainSurfaceY(grid, start.x, start.z) - floor);
      if (depth < 1 || depth / length > maxSlope) continue;
      if (s.run(`build_ramp start:${start.x},${start.z} end:${lane.end.x},${lane.end.z} depth:${depth}`).success) return { slope: depth / length, x: start.x, z: start.z, runM: length, dirX: lane.dx, dirZ: lane.dz };
    }
  }
  return null;
}

// ── Opening ──

/**
 * Mean energy absorption of the rock under the 9x9 footprint at `at`, down to the hole depth, up to which the
 * reference charge breaks the ground. The richest deposits of tropical_karst and volcanic_flats sit in obstiite and
 * gnarlite (2200 and 2600): the shot broke nothing, no fragment was ever sold and the payroll bankrupted all 20 seeds.
 * alpine_granite (clunkite, stubite: 1100 and 1300) breaks and sells.
 */
const BREAKABLE_ABSORPTION_MAX = 2000;

function rockBreaks(grid: VoxelGrid, at: Pattern): boolean {
  let total = 0, count = 0;
  for (let dx = 0; dx <= SHOT_SPAN; dx++) {
    for (let dz = 0; dz <= SHOT_SPAN; dz++) {
      const top = computeVoxelColumnSurfaceY(grid, at.x + dx, at.z + dz);
      if (top === null) continue;
      for (let d = 0; d < SHOT.depth; d++) {
        total += getRock(grid.dominantRockAt(at.x + dx, top - d, at.z + dz))?.energyAbsorption ?? 0;
        count++;
      }
    }
  }
  return count === 0 || total / count <= BREAKABLE_ABSORPTION_MAX;
}

/** The opening's shot site and the slope ratio of the ramp it dug. */
function runOpening(s: ProbeSession, sandboxOpening = true): { at: Pattern; ramp: RampOrder } {
  const fail = (step: string): never => { throw new ProbeStop(`opening_failed:${step}`); };

  const ranked = rankDeposits(s.grid)[0];
  const starter = !sandboxOpening || (ranked && rockBreaks(s.grid, ranked)) ? null : starterShotOrigin(s.state);
  const site = starter ?? (ranked ? { x: ranked.x, z: ranked.z } : { x: s.grid.sizeX >> 1, z: s.grid.sizeZ >> 1 });
  if (!placeBuilding(s, 'living_quarters', site, site)) fail('living_quarters');

  // Raised beside the quarters, in the crew's reach: the stock helper builds on the first free cell, in the grid corner, which the crew never reached on some alpine sites.
  // Not the ladder's: its measured windows (and the Shareholder Summit win) were set with the stock helper's warehouse and the richest site.
  if (sandboxOpening && !s.state.buildings.buildings.some(b => b.type === 'explosive_warehouse')) {
    if (!placeBuilding(s, 'explosive_warehouse', site, site)) fail('explosive_warehouse');
    s.waitFor('explosive_warehouse', () => s.state.buildings.buildings.some(b => b.type === 'explosive_warehouse'));
  }

  const shot = orderShot(s, [], undefined, starter ?? undefined);
  if (!shot) return fail('shot');
  s.waitFor('shot', () => shotReady(s.state));
  if (!fireShot(s)) fail('blast');
  s.tick(); // the blast resolves on the next command
  const ramp = orderRamp(s, shot.at);
  if (ramp === null) return fail('ramp');
  s.waitFor('ramp', () => !s.state.pendingActions.some(a => a.type === 'dig_ramp_segment'));
  playContracts(s.run, s.state);
  return { at: shot.at, ramp };
}

/** Idle play: tick to the horizon, passing the contract board every interval (`contracts`: see `playContracts`). */
function playOut(s: ProbeSession, onInterval?: () => void, contracts: { supply?: boolean } = {}): never {
  for (;;) {
    s.tick();
    if (s.state.tickCount % DECISION_INTERVAL_TICKS === 0) {
      playContracts(s.run, s.state, contracts);
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
  /** Detonations of the current shot disarmed because someone could not leave the blast zone; each one sends the whole crew out of work. */
  fireCancels?: number;
  /** Tick since which firing waits on crew stranded in the charged pattern's blast zone (`holdFireForStranded`); unset while none is. */
  fireHeldSinceTick?: number;
  /** Ramps the player repaired and dug down to stranded floors (#2095): the game does neither by itself. */
  access: CraterAccessMemory;
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
  /** Fire whatever rubble the pit holds: the shot adds too little to bury it (a one-hole deepening shaft). */
  gateExempt?: boolean;
  cost: number;
  order: () => Shot | null;
}

/**
 * Holes buried for good: drill orders stamped `buried_under_rubble` while no fragment burying a planned hole has an
 * order a crew can still take (every one reads `debris_out_of_reach`). Nobody hauls that rubble, so the holes are
 * never drilled; on the seed-42 full-kit ladder one such hole held a deepening pattern from t14000 on, and the
 * ladder ordered the same pattern again every 500 ticks (#2091).
 */
export function holesBuriedForGood(state: GameState): string[] {
  const buried = state.pendingActions.filter(a => a.type === 'drill_hole' && a.blockedReason === 'buried_under_rubble');
  if (buried.length === 0) return [];
  const burying = new Set(state.logistics.fragments.filter(f => f.state === 'on_ground' && fragmentBuriesPlannedHole(state, f.fragment.id))
    .map(f => f.fragment.id));
  const haulable = state.pendingActions.some(a => (a.type === 'haul_debris' || a.type === 'fragment_debris')
    && burying.has(a.payload['fragmentId'] as number) && a.blockedReason !== 'debris_out_of_reach');
  return haulable ? [] : buried.map(a => String(a.payload['holeId']));
}

/**
 * A hole no drill rig reaches never finishes, and the shot waits on it for good while payroll runs: once part of the
 * pattern is drilled, the careful player drops the holes whose orders read `target_unreachable`, and those buried for
 * good (`holesBuriedForGood`), and fires the rest.
 */
function dropUnreachableHoles(s: ProbeSession): void {
  if (s.state.drillHoles.length === 0) return;
  const unreachable = s.state.pendingActions.filter(p => p.type === 'drill_hole' && p.blockedReason === 'target_unreachable')
    .map(a => String(a.payload['holeId']));
  for (const holeId of [...unreachable, ...holesBuriedForGood(s.state)]) s.run(`drill_plan remove hole:${holeId}`);
}

function reinvestShot(s: ProbeSession, m: ReinvestMemory, plan?: () => ShotPlan): void {
  if (m.yieldPending) { // the blast resolved on the first command after it fired
    m.lastYieldKg = haulableOreOnGroundKg(s.state);
    m.yieldPending = false;
  }
  const shot = m.shot;
  if (!shot && plan && shotReady(s.state) && s.state.pendingDetonation === null) {
    // A pattern abandoned after a refused or cancelled detonation still stands charged: fire it, or it blocks every later shot and the hauling its zone holds.
    if (holdFireForStranded(s, m)) return;
    const footprint = patternFootprint(s.state); // read before the blast consumes the holes
    tryOnce(s, m, 'refire', () => {
      if (!fireShot(s)) {
        m.fireCancels = (m.fireCancels ?? 0) + 1;
        return false;
      }
      m.origins.push(footprint);
      m.yieldPending = true;
      m.fireCancels = 0;
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
  dropUnreachableHoles(s);
  if (shotReady(s.state)) {
    if (holdFireForStranded(s, m)) return;
    // A refused detonation (an event's blasting ban) keeps the charged pattern: it is tried again next interval.
    if (fireShot(s)) {
      m.origins.push({ ...shot.at, span: shot.span });
      m.yieldPending = true;
      m.shot = null;
      m.fireCancels = 0;
    } else {
      m.fireCancels = (m.fireCancels ?? 0) + 1;
      if (s.state.tickCount - shot.startedTick > OPENING_STEP_MAX_TICKS) m.shot = null;
    }
  } else if (s.state.tickCount - shot.startedTick > OPENING_STEP_MAX_TICKS) {
    m.shot = null;
    m.retryAt['shot'] = s.state.tickCount + PLACEMENT_RETRY_TICKS;
  }
}

/** Longest wait (ticks) for a ramp to free crew stranded in a charged pattern's blast zone before the shot is tried anyway. */
const LADDER_FIRE_HOLD_MAX_TICKS = 1500;

/**
 * Whether firing waits: crew or a vehicle stranded where it cannot leave (`strandedCrew`) stands in the zone the charged
 * pattern clears, and LADDER_FIRE_HOLD_MAX_TICKS have not passed. Arming evacuates everyone else and holds the work in
 * the zone, the ramp out to them included: on the seed-42 full-kit ladder a deepening shot was armed and disarmed every
 * 100 ticks from t16000 while the access ramp to two stranded diggers and their drivers never got dug (#2091).
 */
function holdFireForStranded(s: ProbeSession, m: ReinvestMemory): boolean {
  const xs = s.state.drillHoles.map(h => h.x);
  const zs = s.state.drillHoles.map(h => h.z);
  const margin = BLAST_ZONE_CLEAR_MARGIN;
  const inZone = xs.length > 0 && strandedCrew(s.state).some(p => p.x >= Math.min(...xs) - margin && p.x <= Math.max(...xs) + margin
    && p.z >= Math.min(...zs) - margin && p.z <= Math.max(...zs) + margin);
  if (!inZone) { delete m.fireHeldSinceTick; return false; }
  m.fireHeldSinceTick ??= s.state.tickCount;
  return s.state.tickCount - m.fireHeldSinceTick < LADDER_FIRE_HOLD_MAX_TICKS;
}

/** Disarmed detonations after which a shot site is given up: someone cannot leave its blast zone, and every try evacuates the crew. */
const LADDER_MAX_FIRE_CANCELS = 3;

/**
 * A pattern with a hole no drill rig reaches never finishes and keeps every later shot from being ordered.
 * Drop it at once and bar the hole's surroundings from later fresh sites.
 */
function dropUnreachablePattern(s: ProbeSession, m: LadderMemory): void {
  // An abandoned charged pattern refired in vain is given up the same way: left standing it blocks every later shot.
  if ((m.fireCancels ?? 0) >= LADDER_MAX_FIRE_CANCELS && (m.shot !== null || shotReady(s.state))) {
    abandonShot(s, m, m.shot !== null ? { ...m.shot.at, span: m.shot.span } : patternFootprint(s.state));
    m.fireCancels = 0;
    return;
  }
  const stuck = s.state.pendingActions.find(a => a.type === 'drill_hole' && a.blockedReason === 'target_unreachable');
  if (stuck) {
    abandonShot(s, m, { x: stuck.targetX, z: stuck.targetZ, span: 1 });
    delete m.stalePatternSinceTick;
    return;
  }
  // Nothing drilled and every planned hole buried for good: the crater it deepens is given up, or the same pattern is
  // ordered there again every time it goes stale (every 500 ticks from t13900 on the seed-42 full-kit ladder, #2091).
  const forGood = holesBuriedForGood(s.state);
  if (s.state.drillHoles.length === 0 && forGood.length > 0 && forGood.length === s.state.plannedDrillHoles.length) {
    const holes = s.state.plannedDrillHoles;
    const deepened = m.origins.map(o => ({ x: o.x, z: o.z, span: o.span ?? SHOT_SPAN })).filter(c => holes.some(h => inCraterFringe(h.x, h.z, c)));
    for (const crater of deepened) if (!m.barred.some(b => craterKey(b) === craterKey(crater))) m.barred.push(crater);
    // A fresh site deepens no crater: its own footprint is barred, as for any other abandoned shot.
    if (deepened.length === 0) m.barred.push(patternFootprint(s.state, holes));
    abandonPattern(s);
    m.shot = null;
    delete m.stalePatternSinceTick;
    return;
  }
  // Holes the previous shot's rubble buried stay undrilled until hauled; a pattern buried for too long is dropped.
  const buried = s.state.pendingActions.filter(a => a.type === 'drill_hole' && a.blockedReason === 'buried_under_rubble');
  const burying = buried.length === 0 ? 0 : s.state.logistics.fragments.filter(f => trackedBuriesPlannedHole(s.state, f)).length;
  const verdict = decideBuriedPattern({
    buriedHoleCount: buried.length, previousBuriedHoleCount: m.buriedHoleCount ?? null,
    buryingFragmentCount: burying, previousBuryingFragmentCount: m.buryingFragmentCount ?? null,
    buriedSinceTick: m.buriedSinceTick, tick: s.state.tickCount,
  });
  m.buriedSinceTick = verdict.buriedSinceTick;
  m.buriedHoleCount = buried.length;
  m.buryingFragmentCount = burying;
  if (verdict.action !== 'drop') return;
  const x = Math.min(...buried.map(a => a.targetX));
  const z = Math.min(...buried.map(a => a.targetZ));
  const span = Math.max(Math.max(...buried.map(a => a.targetX)) - x, Math.max(...buried.map(a => a.targetZ)) - z) + 1;
  abandonShot(s, m, { x, z, span });
  delete m.stalePatternSinceTick;
}

/** Give up the ordered shot: bar its footprint from later fresh sites, clear the pattern and forget the shot. */
function abandonShot(s: ProbeSession, m: LadderMemory, barred: Pattern & { span: number }): void {
  m.barred.push(barred);
  abandonPattern(s);
  m.shot = null;
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
    && tryOnce(s, m, 'research_center', () => placeBuilding(s, 'research_center', rallyOf(s), null, depotSites(s), DEPOT_APPROACH_CLEAR_M) !== null)) {
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
    researchOrdered: false, retryAt: {}, access: newCraterAccessMemory(),
  };
  playOut(s, () => {
    playPitLogistics(s.run, s.state, s.grid, m.access);
    reinvestShot(s, m);
    reinvestBuy(s, m);
    reinvestPermit(s);
    replaceLostCrew(s, m);
    rebuildLostQuarters(s, m);
  });
}


// ── Ladder ──

/** Cash the ladder keeps back from every purchase and permit fee: payroll and upkeep keep running. */
const LADDER_CASH_RESERVE = 5_000;
/**
 * Deepest hole the ladder drills on fresh ground (m), kept under the softest rock's safe face height (#1941). A fully
 * charged pattern spaced by its charge breaks out of it (`LADDER_TIGHT_BURDEN_M`): 11 m holes leave a 10.7 m pit, past
 * the 10 m grade 2 asks. 9 m holes 4 m apart had stalled the sandbox ladder at 9.9 m for thousands of ticks (#2091).
 */
export const LADDER_HOLE_DEPTH_M = 11;
/** Sandbox run: no campaign level is active. */
const sandboxRun = (s: ProbeSession): boolean => !s.engine.ctx.campaignProfile.campaign.activeLevelId;
/** A pit this close under the hole depth counts as dug: deepening then waits for a cleared crater instead of a fresh site. */
const LADDER_FRESH_SHOT_DEPTH_SLACK_M = 0.5;
/** Depth (m) a crater has to stand to be deepened rather than left for a fresh full-depth bench. */
const LADDER_BENCH_DEPTH_M = LADDER_HOLE_DEPTH_M - LADDER_FRESH_SHOT_DEPTH_SLACK_M;
/** Haulers the ladder buys while cash is idle: rubble clears at the fleet's pace, and a buried pit stalls every later shot. Measured: 12 haulers sell 2-7x the ore of 6 on the seed-42 desert site. */
const LADDER_MAX_HAULERS = 12;
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
  /** Ramp ordered into each crater, keyed by `craterKey`. */
  ramps: Record<string, RampOrder>;
  /** Floor depth (m) at which a ramp was last ordered; 0 before any. */
  rampedFloorM: number;
  /** Never apply for a permit past this grade (stay_g1); null for no cap. */
  maxGrade: number | null;
  /** Footprints around a hole no rig could reach: a fresh shot keeps clear of them, or it would pick the same site again. */
  barred: Array<Pattern & { span: number }>;
  /** Tick since which a pattern's buried drill orders stopped coming free; null when none is buried. */
  buriedSinceTick: number | null;
  /** Buried drill orders at the last look; unset before the first. */
  buriedHoleCount?: number;
  /** Fragments burying planned holes at the last look; unset before the first. */
  buryingFragmentCount?: number;
  /** Hole depth cap (m) in force for the last shot. */
  holeCapM: number;
  /** Whether the last judged shot gained no pit depth and no new ore. */
  lastShotFailed: boolean;
  /** Consecutive dud shots; reset by a productive shot or by barring a crater. */
  dudStreak: number;
  /** Shots (entries of `origins`) already judged by `trackLadderShot`. */
  judgedShots: number;
  /** Pit depth and haulable ore a shot's result is compared against; follows the world until a shot fires. */
  before: { pitM: number; oreKg: number };
  /** The last fresh-site search found no site clear of every building: the next shot benches the pit instead. */
  yardBound?: boolean;
  /** Tick a bench ordered for want of a fresh site failed; until LADDER_BENCH_RETRY_TICKS later a fresh shot may stand by the yard. */
  benchFailedTick?: number;
}

/** Ticks after a failed bench before buildings again bar every fresh site. */
const LADDER_BENCH_RETRY_TICKS = 2_000;

/** Depth (m) the next grade asks for; 0 when it asks none. */
function nextGradeDepthM(state: GameState): number {
  return nextGradeTargets(state).find(t => t.kind === 'depth_m')?.needed ?? 0;
}

/**
 * Judge each fired shot once its yield resolved: a shot with no pit gain and no new ore steps the hole cap down;
 * consecutive duds at one site bar it. Called every tick after the shot logic; `before` trails the world until a shot fires.
 */
function trackLadderShot(s: ProbeSession, m: LadderMemory): void {
  const pitM = s.state.grade?.deepestPitM ?? 0;
  const report = s.state.lastBlastReport;
  const judgment = judgeLadderShot({
    shotsFired: m.origins.length, shotsJudged: m.judgedShots, yieldPending: m.yieldPending,
    pitM, baselinePitM: m.before.pitM, oreKg: m.lastYieldKg, baselineOreKg: m.before.oreKg,
    report: report ? { columnsCleared: report.clearedVoxels, volumeM3: report.totalRockVolume } : null,
    dudStreak: m.dudStreak,
  });
  if (!judgment.judged) {
    if (m.origins.length === m.judgedShots) m.before = { pitM, oreKg: m.lastYieldKg };
    return;
  }
  const site = m.origins[m.origins.length - 1]!;
  m.judgedShots = m.origins.length;
  m.lastShotFailed = judgment.lastShotFailed;
  m.dudStreak = judgment.dudStreak;
  if (judgment.bar) m.barred.push({ x: site.x, z: site.z, span: site.span ?? SHOT_SPAN });
}

const craterKey = (c: Pattern): string => `${c.x},${c.z}`;

/** Slope ratio every hauler climbs on a progression site: one limit for every tier (#2045). */
const FLEET_CLIMB_RATIO = VEHICLE_MAX_SLOPE_RATIO;

/** Remember the ramp dug into a crater. */
function recordRamp(m: LadderMemory, crater: Pattern, ramp: RampOrder): void {
  m.ramps[craterKey(crater)] = ramp;
}

const gradeOf = (s: ProbeSession): number => s.state.grade?.grade ?? 0;

function depthTargetOpen(s: ProbeSession): boolean {
  return nextGradeTargets(s.state).some(t => t.kind === 'depth_m' && !t.met);
}

/** Whether a position lies over a crater's footprint or the tile around it. */
function inCraterFringe(x: number, z: number, crater: Pattern & { span: number }): boolean {
  return x >= crater.x - 1 && x <= crater.x + crater.span + 1 && z >= crater.z - 1 && z <= crater.z + crater.span + 1;
}

interface CraterRubbleCounts {
  ordered: number;
  orderless: number;
  sealed: number;
  /** Rubble whose haul order reads out of every vehicle's reach: the crater still wants a way in (also counted as sealed). */
  outOfReach: number;
}

/** Ids of the on-ground fragments that carry ore (bound for a warehouse, not a spoil heap). */
function oreFragmentIds(state: GameState): Set<number> {
  const scale = oreGradeScaleOf(state.world);
  const ids = new Set<number>();
  for (const f of state.logistics.fragments) {
    if (f.state === 'on_ground' && haulDestinationOf(f.fragment, scale) === 'warehouse') ids.add(f.fragment.id);
  }
  return ids;
}

/**
 * One pass over the crater's rubble: covered by a haul order, reachable without one, or sealed from every hauler.
 * `ore` set: only the rubble whose ids it holds counts.
 */
export function craterRubbleCounts(state: GameState, crater: Pattern & { span: number }, ore?: ReadonlySet<number>): CraterRubbleCounts {
  const sealedIds = new Set<number>(sealedFragmentIdsOf(state) ?? []);
  const orderedIds = new Set<number>();
  const outOfReachIds = new Set<number>();
  for (const a of state.pendingActions) {
    if (a.type !== 'haul_debris' && a.type !== 'fragment_debris') continue;
    const id = (a.payload as { fragmentId: number }).fragmentId;
    // A blocked order (blockedReason set, e.g. target out of reach) never clears: its rubble counts as sealed, not ordered.
    if (a.blockedReason) sealedIds.add(id);
    else orderedIds.add(id);
    if (a.blockedReason === 'debris_out_of_reach') outOfReachIds.add(id);
  }
  const counts: CraterRubbleCounts = { ordered: 0, orderless: 0, sealed: 0, outOfReach: 0 };
  for (const f of state.logistics.fragments) {
    if (f.state !== 'on_ground' || !inCraterFringe(f.fragment.position.x, f.fragment.position.z, crater)) continue;
    const id = f.fragment.id;
    if (ore && !ore.has(id)) continue;
    if (outOfReachIds.has(id)) counts.outOfReach++;
    if (sealedIds.has(id)) counts.sealed++;
    else if (orderedIds.has(id)) counts.ordered++;
    else counts.orderless++;
  }
  return counts;
}

/** A haul still pending over a crater's footprint (and a tile around it); `ore` set: only a haul of that rubble. */
/** Whether the site's vehicle network reaches at least half the cells of `crater`'s footprint (`siteVehicleReach`). */
function craterFloorReachable(state: GameState, crater: Pattern & { span: number }): boolean {
  const reach = siteVehicleReach(state);
  if (reach === null) return true;
  let reached = 0;
  for (let z = crater.z; z < crater.z + crater.span; z++) for (let x = crater.x; x < crater.x + crater.span; x++) if (reach(x, z)) reached++;
  return reached * 2 >= crater.span * crater.span;
}

/**
 * Bore, of those the best rig drills, whose fullest charge of `explosive` stands the longest column (it breaks out of the
 * deepest hole); the widest of equals, which carries the most charge. A wider bore spreads the same kilograms shorter:
 * 0.165 m holes break out of 9 m of krackle where 0.089 and 0.127 m holes break out of 11 m.
 */
function deepestBreakoutDiameter(explosive: Parameters<typeof explosiveHoleLimits>[0], rigMaxDiameterM: number): number {
  const bores = DRILL_HOLE_DIAMETER_OPTIONS_M.filter(d => d <= rigMaxDiameterM + DRILL_HOLE_DIAMETER_SNAP_TOLERANCE_M);
  if (bores.length === 0) return pickDiameter(rigMaxDiameterM);
  const column = (d: number): number => Math.round(chargeColumnM(floorToKgResolution(explosiveHoleLimits(explosive, d).maxKg), d) * 10) / 10;
  return bores.reduce((best, d) => (column(d) > column(best) || (column(d) === column(best) && d > best) ? d : best));
}

/**
 * Cell of `crater`'s floor, `inset` cells inside its rim, that a vehicle reaches and the fewest fragments cover (the
 * nearest the crater's middle of equals): a hole there is drilled once the least rubble is hauled off it. Undefined
 * when the vehicle network reaches none.
 */
function leastBuriedFloorCell(state: GameState, crater: Pattern & { span: number }, inset: number): Pattern | undefined {
  const reach = siteVehicleReach(state);
  const cover = rubbleCoverCounts(state);
  const mid = crater.span / 2;
  let best: { x: number; z: number; score: number } | undefined;
  for (let z = crater.z + inset; z <= crater.z + crater.span - 1 - inset; z++) {
    for (let x = crater.x + inset; x <= crater.x + crater.span - 1 - inset; x++) {
      if (reach !== null && !reach(x, z)) continue;
      const score = (cover.get(cellKey(x, z)) ?? 0) * 1000 + Math.hypot(x - crater.x - mid, z - crater.z - mid);
      if (best === undefined || score < best.score) best = { x, z, score };
    }
  }
  return best && { x: best.x, z: best.z };
}

/** Deepest the ground over `crater`'s hole footprint stands below the generated surface (m). */
function craterDepthM(grid: VoxelGrid, crater: Pattern & { span: number }): number {
  let deepest = 0;
  for (let z = crater.z; z < crater.z + crater.span; z++) for (let x = crater.x; x < crater.x + crater.span; x++) {
    const natural = grid.generatorSurfaceHeightAt(x, z);
    const surface = computeVoxelColumnSurfaceY(grid, x, z);
    if (natural !== undefined && surface !== null) deepest = Math.max(deepest, natural - surface);
  }
  return deepest;
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
  // Deepen the deepest crater a full bench deep that a vehicle drives onto (the latest of equals); none: a fresh site
  // meanwhile. Rubble left on the floor is no reason to wait: the crew clears the planned holes before any other rubble
  // (gameplay-blast-system). A shallower crater is left for a fresh full-depth bench. Deepening the latest crater
  // instead fired 1x1 shots into a shallow 3x3 crater from t13600 on the seed-42 full-kit ladder while its deepest pit
  // stood 3.4 m short of grade 3 (#2091). Past the depth target the pit is benched for ore, the widest crater first: the
  // deepest was a one-hole shaft, and its 1x1 benches broke a few tonnes a shot.
  const depthOpen = depthTargetOpen(s);
  const crater = [...m.origins].reverse().map(o => ({ x: o.x, z: o.z, span: o.span ?? SHOT_SPAN }))
    .filter(c => !m.barred.some(b => craterKey(b) === craterKey(c)))
    .map(c => ({ c, depthM: craterDepthM(s.grid, c) })).filter(({ depthM }) => depthM >= LADDER_BENCH_DEPTH_M)
    .sort((a, b) => (depthOpen ? 0 : b.c.span - a.c.span) || b.depthM - a.depthM).map(({ c }) => c)
    .find(c => decideLadderDeepen({ floorReachable: craterFloorReachable(state, c) }) === 'deepen');
  // Past the depth target a fresh shot stands clear of every building; with no such site left, the pit is benched
  // instead. Shot by the yard as a fallback, the seed-42 full-kit ladder took two warehouses and their ore at t6500.
  const deepen = crater !== undefined && (depthOpen || m.yardBound === true);
  const pitM = state.grade?.deepestPitM ?? 0;
  const rigDiameterM = fleetBestRigLimit(DRILL_RIG_MAX_DIAMETER_M, vehicles);
  const limit: PermitLimit = PERMIT_LIMITS[Math.min(gradeOf(s), 5)]!;
  const explosive = getExplosive(shotExplosive(s))!;
  // Each hole takes the fullest charge it holds, in the bore whose charge column is longest, so the pattern breaks out
  // of the deepest holes; the permit then sets how many holes, and the charge how close they stand. Spreading the
  // permit over its most holes left 7.5 kg holes 4 m apart: a shaft round each hole, full-height rock between (#2091).
  const diameterM = deepestBreakoutDiameter(explosive, rigDiameterM);
  const fullKg = floorToKgResolution(explosiveHoleLimits(explosive, diameterM).maxKg);
  const holeDepth = decideLadderHoleDepth({
    rigMaxDepthM: fleetBestRigLimit(DRILL_RIG_MAX_DEPTH_M, vehicles), remainingDepthM: nextGradeDepthM(state) - pitM,
    floorOpen: deepen && depthOpen, lastShotFailed: m.lastShotFailed, currentCapM: m.holeCapM, freshHoleDepthM: LADDER_HOLE_DEPTH_M,
    breakoutDepthM: breakoutHoleDepthM(chargeColumnM(fullKg, diameterM), LADDER_TIGHT_BURDEN_M),
  });
  // A ramp steeper than the fleet climbs reaches only so deep: shrink the holes to what the haulers still reach.
  const ramp = deepen && crater ? m.ramps[craterKey(crater)] : undefined;
  const climb = FLEET_CLIMB_RATIO;
  const shrunk = ramp !== undefined && decideLadderReach({
    rampSlopeRatio: ramp.slope, fleetClimbRatio: climb,
  }) === 'shrink';
  // One hole that reaches the next grade's depth is drilled long before a wide pattern: each hole waits for the rubble
  // over its cell to be hauled, about a hundred fragments under a grade-2 bench. Its depth is its own.
  const rigMaxDepthM = fleetBestRigLimit(DRILL_RIG_MAX_DEPTH_M, vehicles);
  const shaftDepthM = deepen && depthOpen ? shaftHoleDepthM({ floorDepthM: craterDepthM(s.grid, crater), nextGradeDepthM: nextGradeDepthM(state), rigMaxDepthM }) : null;
  const shaft = shaftDepthM !== null;
  const depth = shaftDepthM ?? (shrunk ? Math.max(1, Math.floor(reachableShotDepthM(ramp.runM, climb, holeDepth))) : holeDepth);
  const fullSide = fullHoleSide(limit, fullKg);
  const sized: LadderShot = {
    rows: fullSide, cols: fullSide, spacing: holeSpacingForChargeM(fullKg), depth, kgPerHole: fullKg, stemming: SHOT.stemming, diameterM,
  };
  /** Heaviest hole charge that stays inside the permit's total charge for an n x n pattern, the explosive's and the hole's own limits. */
  const kgFor = (n: number): number => floorToKgResolution(Math.min(
    limit.maxChargeKg / (n * n), explosiveHoleLimits(explosive, sized.diameterM).maxKg,
    maxFittingChargeKg(depth, sized.stemming, sized.diameterM),
  ));

  // Deepen the latest crater whose rubble is cleared (holes under rubble never finish); none clear: a fresh site meanwhile.
  // Past the safe face height the deepening pattern stands a berm inside the crater rim; a crater narrower than two
  // berms is deepened at its middle, or the inset puts the pattern on its rim rubble (ordered again every interval
  // from t13400 on the seed-42 full-kit ladder, #2091).
  const bench = shouldBench(state.grade?.deepestPitM ?? 0, SOFTEST_SAFE_FACE_M);
  const inset = deepen && bench ? Math.min(BERM_GAP, Math.floor(crater.span / 2)) : 0;
  const siteSide = Math.floor((Math.min(s.grid.sizeX, s.grid.sizeZ) - 2 * BUILDING_SCAN_EDGE - 1) / sized.spacing) + 1;
  const craterSide = Math.floor(((crater?.span ?? 0) - 2 * inset) / sized.spacing) + 1;
  const limitSide = Math.max(1, Math.min(sized.rows, deepen ? craterSide : siteSide));
  const wanted = decideLadderShotSide({
    limitSide, grade: gradeOf(s), lastShotFailed: m.lastShotFailed, sealedRubbleCount: craterRubbleCounts(state, m.crater).sealed,
  });
  const free = explosiveRoomKg(state, shotExplosive(s));
  let side = shaft ? 1 : wanted;
  while (side > 0 && side * side * (kgFor(side) + 0.1) > free) side--;
  const kg = kgFor(Math.max(side, 1));
  const specFor = (n: number): ShotSpec => ({
    rows: n, cols: n, spacing: sized.spacing, depth, explosive: shotExplosive(s), kg: kgFor(n), stemming: sized.stemming, diameterM: sized.diameterM,
  });
  // A g2 shot throws rock far enough to destroy a building beside the site (a lost building sank well-being to a revolt at t8520, #2076).
  const buildingZones = state.buildings.buildings.map(b => ({ x: b.x - LADDER_BUILDING_KEEP_OUT_M, z: b.z - LADDER_BUILDING_KEEP_OUT_M, span: 2 * LADDER_BUILDING_KEEP_OUT_M + 1 }));
  // A building's own ground and the ring around it are never shot, whatever is left: a 5x5 fallback over the yard took
  // two warehouses, their ore and the research centre on the seed-42 full-kit ladder.
  const buildingGround = state.buildings.buildings.map(b => {
    const { sizeX, sizeZ } = getDefSize(getBuildingDef(b.type, b.tier));
    return { x: b.x - LADDER_BUILDING_HARD_CLEAR_M, z: b.z - LADDER_BUILDING_HARD_CLEAR_M, span: Math.max(sizeX, sizeZ) + 2 * LADDER_BUILDING_HARD_CLEAR_M };
  });
  // A shot over a ramp cuts the fleet's way into a pit: on the seed-42 desert digger site one took the opening ramp's top
  // and stranded the next crater's 1.7 kt of rubble. Ramps are never shot over; a building's surroundings are, when nothing
  // else is left, its own ground never.
  const rampZones = [...rampProtectionZones(Object.values(m.ramps), LADDER_RAMP_PROTECT_MARGIN_M), ...rampKeepOutZones(state)];
  // Orders no ramp reaches never get hauled: they are not work for the crew. Barren rock earns nothing.
  const oreRunningOut = reachableOreRubbleKg(state) < fleetLoadKg(state) * LADDER_ORE_LOW_LOADS;
  const shaftAt = shaft && crater ? leastBuriedFloorCell(state, crater, inset) : undefined;
  return {
    // Blast again to deepen a crater, to dig the first full-depth pit, or when the ore left to haul runs low (income about to stop).
    wanted: deepen || oreRunningOut || (!m.lastShotFailed && pitM < LADDER_HOLE_DEPTH_M - LADDER_FRESH_SHOT_DEPTH_SLACK_M),
    // A one-hole shaft adds a few dozen m3 of rubble: the pit's rubble is no reason to hold it.
    gateExempt: shaft,
    cost: side === 0 ? Infinity : side * side * kg * explosive.costPerKg + RE_FIRE_CASH_CUSHION,
    order: () => {
      let ordered: Shot | null = null;
      m.holeCapM = depth;
      // A pit to bench instead makes the buildings a hard limit for a fresh site, not a last resort.
      const benchFailedRecently = m.benchFailedTick !== undefined && s.state.tickCount - m.benchFailedTick < LADDER_BENCH_RETRY_TICKS;
      const benchInstead = !deepen && !depthOpen && crater !== undefined && !benchFailedRecently;
      const rules = benchInstead
        ? { protectedZones: [], forbiddenZones: [...rampZones, ...buildingZones] }
        : { protectedZones: buildingZones, forbiddenZones: [...rampZones, ...buildingGround] };
      tryOnce(s, m, 'shot', () => {
        for (const step of LADDER_SHRINK_STEPS) {
          const n = Math.max(1, Math.round(side * step));
          const at = shaftAt ?? (deepen && crater ? { x: crater.x + inset, z: crater.z + inset } : undefined);
          ordered = orderShot(s, [...m.origins, ...m.barred], specFor(n), at, rules);
          if (ordered !== null) {
            // Benched once: the next shot looks for a fresh site again.
            m.yardBound = false;
            return true;
          }
        }
        if (benchInstead) {
          m.yardBound = true;
          return false;
        }
        if (m.yardBound === true && !depthOpen) {
          m.yardBound = false;
          m.benchFailedTick = s.state.tickCount;
        }
        // The 64 m map holds few sites: when none is left, age out the oldest bar so a cleared crater can be deepened again.
        m.barred.shift();
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
 * an employee of the role that holds the licence at hire. True once `holders` living employees hold it;
 * otherwise one step towards it is taken, cash permitting. Only the first holder is hired for the course
 * when nobody is free: later ones wait for a crew member between jobs, so a fleet upgrade grows no payroll.
 */
function earnLicence(s: ProbeSession, m: ReinvestMemory, role: VehicleRole, tier: VehicleTier, holders = 1): boolean {
  const { state } = s;
  const skill = ROLE_LICENCE_REQUIRED[role];
  const held = countLicenceHolders(state.employees.employees, role, tier);
  if (held >= holders) return true;
  const school = state.buildings.buildings.find(b => b.type === 'driving_center');
  if (!school) {
    if (!state.plannedBuildings.some(p => p.type === 'driving_center')
      && spendable(s) >= getBuildingDef('driving_center', 1).constructionCost) {
      tryOnce(s, m, 'driving_center', () => placeBuilding(s, 'driving_center', rallyOf(s), null, depotSites(s), DEPOT_APPROACH_CLEAR_M) !== null);
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
    if (held > 0) return false;
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
 * a licensed driver is left over for it and cash stays above LADDER_UPGRADE_RESERVE after it. One licence per
 * upgraded vehicle: a fleet upgraded past its licensed drivers parks (at t5000 on green_foothills, 11 of 12
 * tier-2 haulers stood driverless beside 300 t of ore waiting to be hauled).
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
  const atTier = s.state.vehicles.vehicles.filter(v => v.type === bought.role && v.tier >= bought.tier).length;
  if (!earnLicence(s, m, bought.role, bought.tier, atTier + 1) || !pick) return;
  tryOnce(s, m, `upgrade_${bought.vehicleId}`, () => s.run(`vehicle upgrade ${bought.vehicleId}`).success);
}

/**
 * Boulder-breaking orders within reach per fragmenter above which the ladder buys another. One fragmenter faced 463 of
 * them on the seed-42 full-kit ladder after grade 2 and broke one in 400 ticks; the boulders buried every new hole.
 */
const LADDER_BOULDERS_PER_FRAGMENTER = 100;
/** Most fragmenters the ladder runs. */
const LADDER_MAX_FRAGMENTERS = 3;

/**
 * A fragmenter as soon as boulders lie on the ground, another for every LADDER_BOULDERS_PER_FRAGMENTER breaking orders
 * within reach, and a licensed driver for each at the Driving Center.
 */
function ladderFragmenter(s: ProbeSession, m: ReinvestMemory): void {
  const { state } = s;
  const owned = state.vehicles.vehicles.filter(v => v.type === 'rock_fragmenter').length;
  const waiting = state.pendingActions.filter(a => a.type === 'fragment_debris' && a.blockedReason !== 'debris_out_of_reach').length;
  const boulders = state.logistics.fragments.some(f => f.state === 'on_ground' && isOversized(f.fragment.volume));
  const wanted = owned === 0 ? (boulders ? 1 : 0) : Math.min(LADDER_MAX_FRAGMENTERS, Math.max(owned, Math.ceil(waiting / LADDER_BOULDERS_PER_FRAGMENTER)));
  if (owned < wanted && state.cash - LADDER_UPGRADE_RESERVE >= getVehicleDefByTier('rock_fragmenter', 1).purchaseCost) {
    tryOnce(s, m, `fragmenter_${owned + 1}`, () => s.run('vehicle buy rock_fragmenter').success);
  }
  if (owned > 0 || wanted > 0) earnLicence(s, m, 'rock_fragmenter', 1, Math.max(1, owned));
}

/** Hire a replacement for any core role nobody alive holds (a blaster lost mid-shot stalls every charge order). */
function replaceLostCrew(s: ProbeSession, m: ReinvestMemory): void {
  for (const role of ['blaster', 'driller', 'driver'] as const) {
    if (s.state.employees.employees.some(e => e.alive && e.role === role) || spendable(s) < HIRING_COSTS[role]) continue;
    tryOnce(s, m, `crew_${role}`, () => s.run(`employee hire role:${role}`).success);
  }
}

/**
 * Raise new living quarters when a shot destroyed the last ones: without them the reinvest crew only rests in place,
 * which tops out under the rest threshold, so nobody ever goes back to work. They go up beside the last shot, as the
 * opening's do, never at the rally: a crew walking across the site to rest every shift loses the shift. The ladder
 * keeps its own rule (`ladderQuarters`).
 */
function rebuildLostQuarters(s: ProbeSession, m: ReinvestMemory): void {
  const housed = s.state.buildings.buildings.some(b => b.type === 'living_quarters')
    || s.state.plannedBuildings.some(b => b.type === 'living_quarters');
  if (housed || spendable(s) < getBuildingDef('living_quarters', 1).constructionCost) return;
  const last = m.origins.at(-1) ?? null;
  const near = last ?? s.state.rallyPoint ?? { x: s.grid.sizeX >> 1, z: s.grid.sizeZ >> 1 };
  tryOnce(s, m, 'quarters', () => placeBuilding(s, 'living_quarters', near, last) !== null);
}

/** Metres inside the rest-building search radius a work spot's quarters must stand, so a worker a few steps off the spot still reaches them. */
const LADDER_QUARTERS_REACH_MARGIN_M = 4;
/** Living quarters the ladder raises at most. */
const LADDER_MAX_QUARTERS = 4;

/**
 * Living quarters within reach of where the crew's rests start. A worker farther than the rest search radius
 * (`needRestSearchRadius`) from a free bed rests in place, for twice as long and only up to 70 of the gauge
 * (`gameplay-employee-needs`), and a rest falls due every shift. A haul job ends at the depot, so the warehouses come
 * first; the crater being worked (drilling, charging, digging) next. A hut by a crater stands clear of every shot site
 * by LADDER_BUILDING_KEEP_OUT_M, a hut by a depot clear of its approach; a hut a shot destroyed is replaced the same
 * way, by the warehouse first, where no shot reaches. Covered everywhere, idle cash upgrades them (a tier-2 hut rests a
 * worker in fewer ticks).
 */
function ladderQuarters(s: ProbeSession, m: LadderMemory): void {
  const quarters = [...s.state.buildings.buildings, ...s.state.plannedBuildings].filter(b => b.type === 'living_quarters');
  if (s.state.plannedBuildings.some(b => b.type === 'living_quarters')) return;
  const reach = needRestSearchRadius(s.grid.sizeX) - LADDER_QUARTERS_REACH_MARGIN_M;
  const covered = (spot: Pattern): boolean => quarters.some(q => Math.hypot(q.x - spot.x, q.z - spot.z) <= reach);
  const shots = [...m.origins, ...m.barred];
  const depots = depotSites(s);
  const warehouses = s.state.buildings.buildings.filter(b => b.type === 'freight_warehouse').map(b => ({ x: b.x, z: b.z }));
  const crater = { x: m.crater.x + m.crater.span / 2, z: m.crater.z + m.crater.span / 2 };
  const spot = [...warehouses, crater].find(p => !covered(p));
  const cost = getBuildingDef('living_quarters', 1).constructionCost;
  if (spot !== undefined && quarters.length < LADDER_MAX_QUARTERS) {
    if (s.state.cash - cost < LADDER_UPGRADE_RESERVE) return;
    tryOnce(s, m, `quarters_${spot.x},${spot.z}`, () => {
      const nearShot = shots.length > 0 && spot === crater;
      return placeBuilding(s, 'living_quarters', spot, null, nearShot ? shots : depots, nearShot ? LADDER_BUILDING_KEEP_OUT_M : DEPOT_APPROACH_CLEAR_M) !== null;
    });
    return;
  }
  const hut = s.state.buildings.buildings.find(b => b.type === 'living_quarters' && b.tier < 3);
  if (hut && s.state.cash - getUpgradeCost('living_quarters', (hut.tier + 1) as BuildingTier) >= LADDER_UPGRADE_RESERVE) upgradeBuilding(s, m, 'living_quarters');
}

/** Ecology under which another spoil heap is built: loose rubble past a heap's capacity drains it. */
const LADDER_ECOLOGY_FLOOR = 40;
/** Most spoil heaps the ladder raises: a 2x2 heap and the truck lanes around it take about 36 tiles of a 64x64 site. */
const LADDER_MAX_SPOIL_HEAPS = 24;
/** Most freight warehouses the ladder raises. */
const LADDER_MAX_WAREHOUSES = 6;
/** Tiles a new depot's anchor keeps from another depot (placeBuilding's `clearOf` test): a truck lane between the two. */
const DEPOT_LANE_CLEAR_M = 5;

/** Mass (kg) of queued haul orders blocked on `reasons`: the rubble that waits for room no built depot has. */
function blockedHaulKg(state: GameState, reasons: ReadonlySet<string>): number {
  const lookup = createFragmentLookup(state);
  let kg = 0;
  for (const a of state.pendingActions) {
    if (a.type !== 'haul_debris' || a.status !== 'queued' || a.blockedReason == null || !reasons.has(a.blockedReason)) continue;
    const id = a.payload['fragmentId'];
    if (typeof id === 'number') kg += lookup(id)?.fragment.mass ?? 0;
  }
  return kg;
}

const ORE_STORAGE_BLOCKS: ReadonlySet<string> = new Set(['storage_full', 'no_freight_warehouse']);

/**
 * Storage the way a player keeps trucks moving: a hauler waiting at a full heap or warehouse is a depot short. Spoil
 * heaps are raised for the barren rubble blocked on them (and while ecology sags), close together by the warehouse
 * with a truck lane between; ore blocked on full warehouses first upgrades one (a tier-3 warehouse holds eight
 * tier-1s), then raises another.
 */
function ladderStorage(s: ProbeSession, m: LadderMemory): void {
  const all = [...s.state.buildings.buildings, ...s.state.plannedBuildings];
  const heaps = s.state.buildings.buildings.filter(b => b.type === 'spoil_heap').length;
  const plannedHeaps = s.state.plannedBuildings.filter(p => p.type === 'spoil_heap').length;
  const barrenKg = pendingSpoilOverflowKg(s.state) + (s.state.scores.ecology < LADDER_ECOLOGY_FLOOR && plannedHeaps === 0 ? 1 : 0);
  const newHeaps = depotsToOrder({ blockedKg: barrenKg, capacityKg: SPOIL_HEAP_CAPACITY_KG, built: heaps, planned: plannedHeaps, max: LADDER_MAX_SPOIL_HEAPS });
  const lanes = depotSites(s).map(d => ({ ...d, clearM: DEPOT_LANE_CLEAR_M }));
  const shots = [...m.origins, ...m.barred].map(o => ({ ...o, clearM: LADDER_BUILDING_KEEP_OUT_M }));
  if (newHeaps > 0 && spendable(s) >= getBuildingDef('spoil_heap', 1).constructionCost) {
    tryOnce(s, m, `spoil_heap_${heaps + plannedHeaps}`, () => placeBuilding(s, 'spoil_heap', rallyOf(s), null, [...lanes, ...shots]) !== null);
  }
  const oreKg = blockedHaulKg(s.state, ORE_STORAGE_BLOCKS);
  if (oreKg <= 0) return;
  const warehouses = s.state.buildings.buildings.filter(b => b.type === 'freight_warehouse');
  const upgradable = warehouses.find(b => b.tier < 3 && !s.state.plannedBuildings.some(p => p.buildingId === b.id));
  if (upgradable && countOf(s, 'research_center') > 0
    && spendable(s) >= getUpgradeCost('freight_warehouse', (upgradable.tier + 1) as BuildingTier)) {
    s.run(`research queue type:freight_warehouse tier:${upgradable.tier + 1}`);
    if (tryOnce(s, m, `warehouse_upgrade_${upgradable.id}`, () => s.run(`build upgrade ${upgradable.id}`).success)) return;
  }
  const plannedWarehouses = s.state.plannedBuildings.filter(p => p.type === 'freight_warehouse').length;
  const newWarehouses = depotsToOrder({
    blockedKg: oreKg, capacityKg: FREIGHT_WAREHOUSE_CAPACITY_KG[1], built: warehouses.length, planned: plannedWarehouses, max: LADDER_MAX_WAREHOUSES,
  });
  if (newWarehouses > 0 && spendable(s) >= getBuildingDef('freight_warehouse', 1).constructionCost) {
    tryOnce(s, m, `warehouse_${all.filter(b => b.type === 'freight_warehouse').length}`, () => placeBuilding(s, 'freight_warehouse', rallyOf(s), null, [...lanes, ...shots]) !== null);
  }
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
  const deeper = decideLadderRamp({
    floorDepthM, rampedFloorM: m.rampedFloorM,
    cash: s.state.cash, rampCost: LADDER_RAMP_COST, reserve: LADDER_UPGRADE_RESERVE,
  });
  // A fresh crater is no deeper than the pit already ramped, yet no ramp leads into it: its rubble stays out of every hauler's reach.
  const climb = FLEET_CLIMB_RATIO;
  const own = m.ramps[craterKey(m.crater)];
  const reach = decideLadderReach({
    rampSlopeRatio: own?.slope ?? Infinity,
    fleetClimbRatio: climb,
  });
  const affordable = s.state.cash - LADDER_RAMP_COST >= LADDER_UPGRADE_RESERVE;
  // Sandbox: wait for no grade (the way in lets grade 1 reach grade 2, #2066); campaign: only once the shot gate is live.
  const needsWayIn = reach !== 'fire' && (sandboxRun(s) || gradeOf(s) >= LADDER_GATE_MIN_GRADE);
  if (deeper === 'skip' && (!needsWayIn || !affordable)) return;
  tryOnce(s, m, 'crater_ramp', () => {
    const ramp = orderRamp(s, m.crater, m.crater.span);
    if (ramp === null) return false;
    recordRamp(m, m.crater, ramp);
    m.rampedFloorM = Math.max(m.rampedFloorM, floorDepthM);
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
    tryOnce(s, m, 'management_office', () => placeBuilding(s, 'management_office', rallyOf(s), null, depotSites(s), DEPOT_APPROACH_CLEAR_M) !== null);
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

/**
 * Mass (kg) of ore-bearing rock a hauler can still reach: on the ground with a haul order not blocked as out of reach.
 * Rubble no ramp reaches stays put and must not hold shots forever; barren rock earns nothing while it waits.
 */
function reachableOreRubbleKg(state: GameState): number {
  const ore = oreFragmentIds(state);
  const reachable = new Set<number>();
  for (const a of state.pendingActions) {
    const id = (a.payload as { fragmentId: number }).fragmentId;
    if (a.type === 'haul_debris' && a.blockedReason === null && ore.has(id)) reachable.add(id);
  }
  let kg = 0;
  for (const f of state.logistics.fragments) if (f.state === 'on_ground' && reachable.has(f.fragment.id)) kg += f.fragment.mass;
  return kg;
}

/** The ladder's shot plan, held (unaffordable) while the pit is buried or payroll runway is short. */
function gatedLadderPlan(s: ProbeSession, m: LadderMemory): ShotPlan {
  const plan = ladderPlan(s, m);
  if (plan.gateExempt) return plan;
  const rubbleKg = reachableOreRubbleKg(s.state);
  // No reachable ore means no income: holding on the payroll runway alone would starve the recovery shot
  // while payroll drains, so the gate only applies with ore to haul.
  if (rubbleKg === 0) return plan;
  const hold = decideLadderShotGate({
    grade: gradeOf(s),
    rubbleKg,
    cash: s.state.cash,
    payrollPerTick: getOperatingCostPerHour(s.state).payroll,
  }) === 'hold';
  return hold ? { ...plan, cost: Infinity } : plan;
}

/**
 * Full loads of reachable ore each hauler must have waiting before the ladder buys another. The driver's wage is
 * most of a hauler's cost and barren rock pays none of it: past this the fleet outgrows the ore and only adds payroll.
 */
const LADDER_HAULER_ORE_LOADS = 10;
/**
 * Full loads per hauler of reachable ore under which the ladder blasts again: the fleet is about to run out of ore.
 * Never zero: a fragmenter splitting boulders keeps a few tonnes of ore on the board at all times.
 */
const LADDER_ORE_LOW_LOADS = 2;

/** One full load of the whole hauler fleet (kg), each at its own tier. */
function fleetLoadKg(state: GameState): number {
  return state.vehicles.vehicles.filter(v => v.type === 'debris_hauler')
    .reduce((kg, v) => kg + getVehicleDefByTier('debris_hauler', v.tier).capacity, 0);
}

/** Another hauler (and its driver) while cash sits idle and enough ore waits within reach (LADDER_HAULER_ORE_LOADS). */
function ladderHaulers(s: ProbeSession, m: ReinvestMemory): void {
  const haulers = s.state.vehicles.vehicles.filter(v => v.type === 'debris_hauler').length;
  const cost = getVehicleDefByTier('debris_hauler', 1).purchaseCost + HIRING_COSTS.driver;
  if (haulers >= (s.config.maxHaulers ?? LADDER_MAX_HAULERS) || s.state.cash - cost < LADDER_UPGRADE_RESERVE) return;
  if (reachableOreRubbleKg(s.state) < fleetLoadKg(s.state) * LADDER_HAULER_ORE_LOADS) return;
  tryOnce(s, m, 'hauler', () => buyHauler(s));
}

/**
 * The ladder's shift policy. The default 20-tick shift sends a hauler driver to rest every 20 worked ticks, a third of
 * the fleet's time on rest trips. Measured on the seed-42 desert digger site with 8 haulers (t1500-4500): the 30-tick
 * shift sells 101 t of ore against 89 t and ends $1.3M richer with crew morale higher; continuous work at fatigue 50
 * crashes morale to 31 and well-being to 82.
 */
const LADDER_SHIFT_POLICY = 'set_policy mode:shift_12h fatigue:60';

function runLadder(s: ProbeSession, maxGrade: number | null): void {
  const opened = runOpening(s, false);
  s.run(LADDER_SHIFT_POLICY);
  const m: LadderMemory = {
    shot: null, origins: [opened.at], lastYieldKg: haulableOreOnGroundKg(s.state), yieldPending: false,
    researchOrdered: false, retryAt: {}, access: newCraterAccessMemory(),
    crater: { ...opened.at, span: SHOT_SPAN }, ramps: {}, rampedFloorM: 0, maxGrade, barred: [], buriedSinceTick: null,
    holeCapM: LADDER_HOLE_DEPTH_M, lastShotFailed: false, dudStreak: 0, judgedShots: 1,
    before: { pitM: 0, oreKg: 0 },
  };
  recordRamp(m, opened.at, opened.ramp);
  s.ladderAccess = m.access;
  playOut(s, () => {
    playPitLogistics(s.run, s.state, s.grid, m.access);
    ladderPermit(s, m);
    replaceLostCrew(s, m);
    ladderQuarters(s, m);
    ladderStorage(s, m);
    ladderSafety(s, m);
    dropUnreachablePattern(s, m);
    reinvestShot(s, m, () => gatedLadderPlan(s, m));
    trackLadderShot(s, m);
    const last = m.origins[m.origins.length - 1]!;
    if (last.x !== m.crater.x || last.z !== m.crater.z) m.crater = { x: last.x, z: last.z, span: last.span ?? SHOT_SPAN };
    ladderCraterRamp(s, m);
    reinvestBuy(s, m);
    ladderHaulers(s, m);
    ladderFragmenter(s, m);
    ladderEquipment(s, m);
    const need = ladderPlan(s, m);
    if (!Number.isFinite(need.cost)) upgradeBuilding(s, m, 'explosive_warehouse');
  }, { supply: true });
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

/**
 * Answer a pending event the ladder's way (see decideLadderEventOption); a no-op when none is pending. A traffic jam
 * on a ramp is answered by widening it, a careful player's cure for a one-lane chokepoint (the order is refused, and
 * the jam rerouted instead, when the ramp cannot widen or the cash falls short).
 */
function answerLadderEvent(run: Run, state: GameState, access?: CraterAccessMemory): void {
  const pending = state.events.pendingEvent;
  const def = pending ? getEventById(pending.eventId) : undefined;
  if (!def) return;
  // A ramp whose widening already got stuck under the jam's own traffic is rerouted around instead, and so is any jam
  // while an access ramp waits to be dug: the one digger driver widened a busy ramp while a 10 m crater full of ore
  // waited for its road (#2091).
  const rampId = pending?.jam?.rampId ?? null;
  const accessWaiting = state.plannedRamps.some(p => p.repairOf === undefined && p.widenOf === undefined);
  const given = rampId !== null && (accessWaiting || (access?.unwidenable.includes(rampId) ?? false));
  const option = (tag: string): number => def.consequences.findIndex(c => c.effectTag === tag);
  const widen = given ? -1 : option('widen_ramp');
  const reroute = given ? option('reroute_vehicles') : -1;
  run(`event choose ${widen !== -1 ? widen : reroute !== -1 ? reroute : decideLadderEventOption(def.consequences.map(addsHire))}`);
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
      if (config.strategy === 'ladder' || config.strategy === 'stay_g1') answerLadderEvent(session.run, session.state, session.ladderAccess);
      playTick(session.run, session.state, config.eventPolicy);
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
