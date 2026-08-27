// BlastSimulator2026 — Public Node.js API for external consumers (scenario tests, CI tooling)
// Exports the game engine's pure logic without browser dependencies.

import { createRunner, type RunnerWithContext } from './console/createRunner.js';
import type { CommandResult } from './console/ConsoleRunner.js';
import type { MiningContext } from './console/commands/mining.js';
import { summariseMuckPile, type MuckPileSummary } from './core/mining/MuckPileSummary.js';
import { getLivingEmployees } from './core/entities/Employee.js';
import { totalCollectedOreKg } from './core/economy/Logistics.js';

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
  /** Current weather state (WeatherCycle.ts) — null until `ctx.weatherCycle` exists, which happens lazily on the first `weather`/`weather set`/`weather advance` command or eagerly whenever `ctx.state` is replaced (new_game, campaign start, sandbox start — main.ts). */
  weather: string | null;
  /** The site's live bounding box (#473 — a bounding box, not a fixed size, once the site has grown). */
  worldSizeX: number | null;
  worldSizeZ: number | null;
  worldMinX: number | null;
  worldMinZ: number | null;
  drillHoles: unknown[];
  chargesByHole: Record<string, unknown>;
  sequenceDelays: Record<string, unknown>;
  finances: { cash: number };
  holeCount: number;
  /** Holes ordered but not yet drilled (state.plannedDrillHoles.length) — proves a drill plan queues work instead of writing holes into state instantly (#553). */
  orderedHoleCount: number;
  /** Charges ordered but not yet loaded (Object.keys(state.plannedChargesByHole).length) — proves a charge order queues work instead of writing charges into state instantly (#554). */
  orderedChargeCount: number;
  /** Remaining not-yet-`done` segments across every in-flight `state.plannedRamps` entry — proves a ramp order queues progressive excavation work instead of carving the whole corridor instantly (#555). A ramp is spliced out of `plannedRamps` entirely once its last segment lands, so this reaches 0 exactly when every ordered ramp has finished, not merely when the field would otherwise read 0 on an empty ramp. */
  orderedRampSegmentCount: number;
  /** Buildings ordered but not yet built (state.plannedBuildings.length) — proves a build order queues work instead of creating the building instantly (#556). */
  orderedBuildingCount: number;
  chargedCount: number;
  sequencedCount: number;
  /** Research tasks queued at a Research Center, in progress or pending (state.buildings.researchQueue.length) — proves a research task actually completed (reaches 0) rather than a `tick N` pad merely running, which a spontaneous mid-window event can silently cut short (tickCommand auto-pauses and refuses further ticks the instant one fires). */
  researchQueueLength: number;
  /** Completed survey results (SurveyResult[], state.surveyResults). */
  surveyCount: number;
  /** Queued-but-not-yet-claimed PendingActions (state.pendingActions) — includes auto-inserted rest tasks. */
  pendingActionCount: number;
  buildingCount: number;
  vehicleCount: number;
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
  /** Employees killed so far (state.damage.deathCount) — a blast's projections can kill anyone standing in the cleared columns; proves a fatality genuinely happened rather than being inferred from a flat employeeCount. */
  deathCount: number;
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
  /** Sum across every material key in state.collectedOre (kg) — proves a delivery actually landed ore, not just spoil, without pinning to one material id a scenario's own RNG/terrain didn't guarantee (#671). */
  collectedOreTotal: number;
}

/** Serialize ctx.state into the same shape as window.__gameState(). */
export function serializeGameState(ctx: MiningContext): SerializableGameState | null {
  const s = ctx.state;
  if (!s) return null;
  const livingEmployees = getLivingEmployees(s.employees.employees);
  return {
    seed: s.seed,
    time: s.time,
    tickCount: s.tickCount,
    isPaused: s.isPaused,
    timeScale: s.timeScale,
    mineType: s.mineType,
    weather: ctx.weatherCycle?.current ?? null,
    worldSizeX: s.world?.sizeX ?? null,
    worldSizeZ: s.world?.sizeZ ?? null,
    worldMinX: s.world?.minX ?? null,
    worldMinZ: s.world?.minZ ?? null,
    drillHoles: s.drillHoles,
    chargesByHole: s.chargesByHole as Record<string, unknown>,
    sequenceDelays: s.sequenceDelays as Record<string, unknown>,
    finances: { cash: s.finances.cash },
    holeCount: s.drillHoles.length,
    orderedHoleCount: s.plannedDrillHoles.length,
    orderedChargeCount: Object.keys(s.plannedChargesByHole).length,
    orderedRampSegmentCount: s.plannedRamps.reduce(
      (n, r) => n + r.segments.filter(seg => !seg.done).length, 0,
    ),
    orderedBuildingCount: s.plannedBuildings.length,
    chargedCount: Object.keys(s.chargesByHole).length,
    sequencedCount: Object.keys(s.sequenceDelays).length,
    researchQueueLength: s.buildings.researchQueue.length,
    surveyCount: s.surveyResults.length,
    pendingActionCount: s.pendingActions.length,
    buildingCount: s.buildings.buildings.length,
    vehicleCount: s.vehicles.vehicles.length,
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
    deathCount: s.damage.deathCount,
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
    collectedOreTotal: totalCollectedOreKg(s.collectedOre),
  };
}
