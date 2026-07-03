// BlastSimulator2026 — Public Node.js API for external consumers (scenario tests, CI tooling)
// Exports the game engine's pure logic without browser dependencies.

import { createRunner, type RunnerWithContext } from './console/createRunner.js';
import type { CommandResult } from './console/ConsoleRunner.js';
import type { MiningContext } from './console/commands/mining.js';

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
  drillHoles: unknown[];
  chargesByHole: Record<string, unknown>;
  sequenceDelays: Record<string, unknown>;
  finances: { cash: number };
  holeCount: number;
  chargedCount: number;
  sequencedCount: number;
  buildingCount: number;
  vehicleCount: number;
  employeeCount: number;
  levelEnded: boolean;
  levelEndReason: string | null;
  bankrupt: boolean;
  revolted: boolean;
  ecologicalShutdown: boolean;
  arrested: boolean;
  cash: number;
  profit: number;
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
    drillHoles: s.drillHoles,
    chargesByHole: s.chargesByHole as Record<string, unknown>,
    sequenceDelays: s.sequenceDelays as Record<string, unknown>,
    finances: { cash: s.finances.cash },
    holeCount: s.drillHoles.length,
    chargedCount: Object.keys(s.chargesByHole).length,
    sequencedCount: Object.keys(s.sequenceDelays).length,
    buildingCount: s.buildings.buildings.length,
    vehicleCount: s.vehicles.vehicles.length,
    employeeCount: s.employees.employees.length,
    levelEnded: s.levelEnded,
    levelEndReason: s.levelEndReason,
    bankrupt: s.bankruptcy.bankrupt,
    revolted: s.revolt.revolted,
    ecologicalShutdown: s.ecological.shutdown,
    arrested: s.arrest.arrested,
    cash: s.cash,
    profit: s.levelStats?.totalWealth ?? 0,
  };
}
