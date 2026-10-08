// BlastSimulator2026 — Public Node.js API for external consumers (scenario tests, CI tooling)
// Exports the game engine's pure logic without browser dependencies.

import { getMaxBuildingTier } from './core/entities/Building.js';
import { createRunner, type RunnerWithContext } from './console/createRunner.js';
import type { CommandResult } from './console/ConsoleRunner.js';
import type { MiningContext } from './console/commands/mining.js';
import { summariseMuckPile, type MuckPileSummary } from './core/mining/MuckPileSummary.js';
import { wetHoles } from './core/mining/WetHoles.js';
import { getLivingEmployees } from './core/entities/Employee.js';
import { totalCollectedOreKg } from './core/economy/Logistics.js';
import { rubbleStockKg, totalSpoilKg } from './core/economy/SpoilHeaps.js';
import { hasFillableOreSaleOffer, hasFillableSaleOffer, hasRubbleDisposalOffer } from './core/economy/Contract.js';
import { findTrafficJams, type ChokepointKind } from './core/events/TrafficJams.js';
import { isDangerZoneClear } from './core/entities/Zone.js';

export { createRunner };
export type { RunnerWithContext, CommandResult, MiningContext };

/**
 * Serializable subset of game state — mirrors window.__gameState() in
 * src/main.ts. Produces identical JSON output between headless Node.js
 * mode (command) and browser interaction mode.
 */
export interface SerializableGameState {
  seed: number;
  time: number;
  tickCount: number;
  isPaused: boolean;
  /** Simulation speed multiplier (1/2/4/8) set by `time speed` — the HUD's speed buttons. */
  timeScale: number;
  mineType: string;
  /** Current weather state (WeatherCycle.ts) — null until a game exists (GameState.weather). */
  weather: string | null;
  /** The site's live bounding box (#473 — a bounding box, not a fixed size, once the site has grown). */
  worldSizeX: number | null;
  worldSizeZ: number | null;
  worldMinX: number | null;
  worldMinZ: number | null;
  drillHoles: unknown[];
  chargesByHole: Record<string, unknown>;
  finances: { cash: number };
  holeCount: number;
  /** Holes ordered but not yet drilled (state.plannedDrillHoles.length) — proves a drill plan queues work instead of writing holes into state instantly (#553). */
  orderedHoleCount: number;
  /** Charges ordered but not yet loaded (Object.keys(state.plannedChargesByHole).length) — proves a charge order queues work instead of writing charges into state instantly (#554). */
  orderedChargeCount: number;
  /** Drill holes whose water level is past the wet threshold (wetHoles, #1350). */
  wetHoleCount: number;
  /** Remaining not-yet-`done` segments across every in-flight `state.plannedRamps` entry — proves a ramp order queues progressive excavation work instead of carving the whole corridor instantly (#555). A ramp is spliced out of `plannedRamps` entirely once its last segment lands, so this reaches 0 exactly when every ordered ramp has finished, not merely when the field would otherwise read 0 on an empty ramp. */
  orderedRampSegmentCount: number;
  /** Finished ramps (state.builtRamps.length, #1298). */
  builtRampCount: number;
  /** Width of the first built ramp, 0 when none is built (#1298). */
  builtRampWidth: number;
  /** Buildings ordered but not yet built (state.plannedBuildings.length) — proves a build order queues work instead of creating the building instantly (#556). */
  orderedBuildingCount: number;
  chargedCount: number;
  /** Research tasks queued at a Research Center, in progress or pending (state.buildings.researchQueue.length) — proves a research task actually completed (reaches 0) rather than a `tick N` pad merely running, which a spontaneous mid-window event can silently cut short (tickCommand auto-pauses and refuses further ticks the instant one fires). */
  researchQueueLength: number;
  /** Completed survey results (SurveyResult[], state.surveyResults). */
  surveyCount: number;
  /** Queued-but-not-yet-claimed PendingActions (state.pendingActions) — includes auto-inserted rest tasks. */
  pendingActionCount: number;
  /** Ghost previews drawn red because no actor able to perform their action can reach them (#1306). */
  unreachableGhostCount: number;
  buildingCount: number;
  /** Highest tier among standing buildings, 0 when none (#1392). */
  maxBuildingTier: number;
  vehicleCount: number;
  /** Active traffic jams at chokepoints, silencing ignored (findTrafficJams, #1208). */
  trafficJamCount: number;
  /** Kind and ramp id of every active jam (#1208). */
  trafficJams: { kind: ChokepointKind; rampId: number | null }[];
  /** Whether an event awaits the player's decision (state.events.pendingEvent !== null). */
  pendingEvent: boolean;
  /** Raw roster size, dead included — deliberate: `killEmployee` never splices `employees` (only `fireEmployee` does), so this stays a total-ever-hired count. `deathCount` tracks how many of them died; the six fields below this one filter to the living roster instead. */
  employeeCount: number;
  /** Qualifications the roster holds — proves a skill was actually obtained, not just clicked at. */
  qualificationCount: number;
  proficiencyTotal: number;
  trainingCount: number;
  /** Employees currently in the `collapsing` state (needs mechanics, Employee.ts). */
  collapsedCount: number;
  /** Lowest `fatigue` (0-100, 100 = fully rested) across the roster — the employee closest to collapse. 100 with no employees. */
  minFatigue: number;
  /** Employees currently in the `isMoveStuck` state — pathfinding has failed STUCK_THRESHOLD consecutive times (EntityMovementTick.ts). */
  stuckEmployeeCount: number;
  /** Contracts currently accepted and in progress (state.contracts.active) — proves accept/deliver-completion actually moved a contract, not just clicked at. */
  activeContractCount: number;
  /**
   * True when at least one *offered* (not yet accepted) `ore_sale` contract
   * asks for no more of its ore than the site already holds — an offer that
   * can be accepted and filled in full right now, which is what completes a
   * sale rather than part-delivering one. Both halves of it are random and
   * moving: which ore the pool asks for and how much (Contract.ts's
   * `generateContracts`, rotating every `CONTRACT_REFRESH_INTERVAL` ticks and keeping
   * only the most recent handful), against however much of that ore the
   * haulers have brought in so far. So this is the condition a scenario
   * waits on before clicking Accept, instead of a fixed tick count that only
   * ever happened to land on a matching offer and is re-rolled by any change
   * upstream of it.
   */
  fillableOreSaleOffered: boolean;
  /**
   * True when `state.contracts.available` holds at least one
   * `rubble_disposal` offer (issue #1263 CI-fix) — the condition-based wait
   * a scenario polls before opening the Contracts panel for that offer's
   * own Accept button, instead of a fixed tick count that only ever
   * happened to land on a matching pool instance and is re-rolled by any
   * timing change upstream of it. Mirrors `fillableOreSaleOffered` above,
   * minus the ore-quantity check: `rubble_disposal` has no material to
   * stock against, so mere presence in the pool is the whole condition.
   */
  rubbleDisposalOffered: boolean;
  /**
   * True when the pool holds an offer the site can fill in full right now, ore_sale
   * or rubble_disposal (`hasFillableSaleOffer`, #1338). The free-play wait: any
   * sale keeps the shared warehouse drained so haulers keep bringing ore in.
   */
  fillableSaleOffered: boolean;
  /** Employees killed so far (state.damage.deathCount) — a blast's projections can kill anyone standing in the cleared columns; proves a fatality genuinely happened rather than being inferred from a flat employeeCount. */
  deathCount: number;
  /** Fleet-wide count of driver-boarding events (state.vehicles.driverBoardingCount). */
  vehicleBoardingCount: number;
  levelEnded: boolean;
  levelEndReason: string | null;
  bankrupt: boolean;
  revolted: boolean;
  ecologicalShutdown: boolean;
  arrested: boolean;
  cash: number;
  profit: number;
  /** The four 0-100 scores (ScoreState) that gate events and contracts. */
  wellBeing: number;
  safety: number;
  ecology: number;
  nuisance: number;
  /** The rock a blast left on the ground; null before a world exists. */
  muckPile: MuckPileSummary | null;
  /** Mass (kg) currently held in warehouse storage (LogisticsState.storedMassKg). */
  storedMassKg: number;
  /** Barren rock (kg) dumped on spoil heaps (sum of Building.storedSpoilKg, #1530); never counted in storedMassKg. */
  storedSpoilKg: number;
  /** Sum across every material key in state.collectedOre (kg) — proves a delivery actually landed ore, not just spoil, without pinning to one material id a scenario's own RNG/terrain didn't guarantee (#671). */
  collectedOreTotal: number;
  /**
   * Whether computeDangerZone(state.drillHoles, BLAST_DANGER_MARGIN_M) is
   * clear of every vehicle and living employee — the same check the
   * pre-flight zone row and the DETONATE sequence both use.
   * True when no drill plan exists yet (nothing to be clear of). Lets a
   * scenario's wait_until prove an evacuation genuinely finished — arrived
   * outside the padded zone — rather than merely that `zone clear` returned
   * (#557).
   */
  dangerZoneClear: boolean;
  /** state.corruption.level, the 0-100 influence meter; flat so a scenario step goal can assert it (#1407). */
  corruptionLevel: number;
}

/** Serialize ctx.state into the same shape as window.__gameState(). */
export function serializeGameState(ctx: MiningContext): SerializableGameState | null {
  const s = ctx.state;
  if (!s) return null;
  const livingEmployees = getLivingEmployees(s.employees.employees);
  const jams = findTrafficJams(s.builtRamps, s.employees.employees);
  return {
    seed: s.seed,
    time: s.time,
    tickCount: s.tickCount,
    isPaused: s.isPaused,
    timeScale: s.timeScale,
    mineType: s.mineType,
    weather: s.weather.current,
    worldSizeX: s.world?.sizeX ?? null,
    worldSizeZ: s.world?.sizeZ ?? null,
    worldMinX: s.world?.minX ?? null,
    worldMinZ: s.world?.minZ ?? null,
    drillHoles: s.drillHoles,
    chargesByHole: s.chargesByHole as Record<string, unknown>,
    finances: { cash: s.finances.cash },
    holeCount: s.drillHoles.length,
    orderedHoleCount: s.plannedDrillHoles.length,
    orderedChargeCount: Object.keys(s.plannedChargesByHole).length,
    wetHoleCount: wetHoles(s).length,
    orderedRampSegmentCount: s.plannedRamps.reduce(
      (n, r) => n + r.segments.filter(seg => !seg.done).length, 0,
    ),
    builtRampCount: s.builtRamps.length,
    builtRampWidth: s.builtRamps[0]?.width ?? 0,
    orderedBuildingCount: s.plannedBuildings.length,
    chargedCount: Object.keys(s.chargesByHole).length,
    researchQueueLength: s.buildings.researchQueue.length,
    surveyCount: s.surveyResults.length,
    pendingActionCount: s.pendingActions.length,
    unreachableGhostCount: s.ghostPreviews.filter(g => g.unreachable === true).length,
    buildingCount: s.buildings.buildings.length,
    maxBuildingTier: getMaxBuildingTier(s.buildings),
    vehicleCount: s.vehicles.vehicles.length,
    trafficJamCount: jams.length,
    trafficJams: jams.map(j => ({ kind: j.kind, rampId: j.rampId })),
    pendingEvent: s.events.pendingEvent !== null,
    employeeCount: s.employees.employees.length,
    qualificationCount: livingEmployees
      .reduce((n, e) => n + e.qualifications.length, 0),
    proficiencyTotal: livingEmployees
      .reduce((n, e) => n + e.qualifications.reduce((m, q) => m + q.proficiencyLevel, 0), 0),
    trainingCount: livingEmployees.filter(e => e.trainingState !== null).length,
    collapsedCount: livingEmployees.filter(e => e.collapsing).length,
    minFatigue: livingEmployees.reduce((m, e) => Math.min(m, e.fatigue), 100),
    stuckEmployeeCount: livingEmployees.filter(e => e.isMoveStuck).length,
    activeContractCount: s.contracts.active.length,
    fillableOreSaleOffered: hasFillableOreSaleOffer(s.contracts.available, s.collectedOre),
    rubbleDisposalOffered: hasRubbleDisposalOffer(s.contracts.available),
    fillableSaleOffered: hasFillableSaleOffer(s.contracts.available, s.collectedOre, rubbleStockKg(s.logistics.storedMassKg, s.buildings.buildings)),
    deathCount: s.damage.deathCount,
    vehicleBoardingCount: s.vehicles.driverBoardingCount ?? 0,
    levelEnded: s.levelEnded,
    levelEndReason: s.levelEndReason,
    bankrupt: s.bankruptcy.bankrupt,
    revolted: s.revolt.revolted,
    ecologicalShutdown: s.ecological.shutdown,
    arrested: s.arrest.arrested,
    cash: s.cash,
    profit: s.levelStats?.totalWealth ?? 0,
    wellBeing: s.scores.wellBeing,
    safety: s.scores.safety,
    ecology: s.scores.ecology,
    nuisance: s.scores.nuisance,
    muckPile: ctx.grid
      ? summariseMuckPile(s.logistics.fragments.map(f => f.fragment), ctx.grid)
      : null,
    storedMassKg: s.logistics.storedMassKg,
    storedSpoilKg: totalSpoilKg(s.buildings.buildings),
    collectedOreTotal: totalCollectedOreKg(s.collectedOre),
    dangerZoneClear: isDangerZoneClear(s.drillHoles, s.vehicles, s.employees),
    corruptionLevel: s.corruption.level,
  };
}
