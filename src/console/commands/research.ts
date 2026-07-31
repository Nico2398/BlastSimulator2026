// BlastSimulator2026 — Console command for Research Center tier-unlock tasks
// Wraps queueResearchTask / isTierUnlocked (src/core/entities/BuildingResearch.ts).
// Registered in createRunner.ts alongside the other Phase 5/6 commands.

import type { CommandResult } from '../ConsoleRunner.js';
import type { GameContext } from './world.js';

/**
 * Manage Research Center tasks.
 * Usage:
 *   research queue type:<BuildingType> tier:2|3
 *   research status
 */
export function researchCommand(
  _ctx: GameContext,
  _args: string[],
  _named: Record<string, string>,
): CommandResult {
  // TODO: implement
  throw new Error('not implemented');
}
