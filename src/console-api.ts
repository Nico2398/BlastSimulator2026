// BlastSimulator2026 — Public Node.js API for external consumers (scenario tests, CI tooling)
// Exports the game engine's pure logic without browser dependencies.

import { createRunner, type RunnerWithContext } from './console/createRunner.js';
import type { CommandResult } from './console/ConsoleRunner.js';
import type { MiningContext } from './console/commands/mining.js';
import { summariseMuckPile, type MuckPileSummary } from './core/mining/MuckPileSummary.js';

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
  mineType: string;
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
  chargedCount: number;
  sequencedCount: number;
  /** Completed survey results (SurveyResult[], state.surveyResults). */
  surveyCount: number;
  buildingCount: number;
  vehicleCount: number;
  employeeCount: number;
  /** Qualifications the roster holds — proves a skill was actually obtained, not just clicked at. */
  qualificationCount: number;
  proficiencyTotal: number;
  trainingCount: number;
  /** Employees currently in the `collapsing` state (needs mechanics, Employee.ts). */
  collapsedCount: number;
  /** Lowest `fatigue` (0-100, 100 = fully rested) across the roster — the employee closest to collapse. 100 with no employees. */
  minFatigue: number;
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
}

/** Serialize ctx.state into the same shape as window.__gameState(). */
export function serializeGameState(ctx: MiningContext): SerializableGameState | null {
  const s = ctx.state;
  if (!s) return null;
  return {
    seed: s.seed,
    time: s.time,
    tickCount: s.tickCount,
    isPaused: s.isPaused,
    mineType: s.mineType,
    worldSizeX: s.world?.sizeX ?? null,
    worldSizeZ: s.world?.sizeZ ?? null,
    worldMinX: s.world?.minX ?? null,
    worldMinZ: s.world?.minZ ?? null,
    drillHoles: s.drillHoles,
    chargesByHole: s.chargesByHole as Record<string, unknown>,
    sequenceDelays: s.sequenceDelays as Record<string, unknown>,
    finances: { cash: s.finances.cash },
    holeCount: s.drillHoles.length,
    chargedCount: Object.keys(s.chargesByHole).length,
    sequencedCount: Object.keys(s.sequenceDelays).length,
    surveyCount: s.surveyResults.length,
    buildingCount: s.buildings.buildings.length,
    vehicleCount: s.vehicles.vehicles.length,
    employeeCount: s.employees.employees.length,
    qualificationCount: s.employees.employees
      .reduce((n, e) => n + e.qualifications.length, 0),
    proficiencyTotal: s.employees.employees
      .reduce((n, e) => n + e.qualifications.reduce((m, q) => m + q.proficiencyLevel, 0), 0),
    trainingCount: s.employees.employees.filter(e => e.trainingState !== null).length,
    collapsedCount: s.employees.employees.filter(e => e.collapsing).length,
    minFatigue: s.employees.employees.reduce((m, e) => Math.min(m, e.fatigue), 100),
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
  };
}
