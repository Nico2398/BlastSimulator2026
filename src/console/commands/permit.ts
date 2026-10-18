// BlastSimulator2026 — Console command: permit status|apply (#1921)

import type { CommandResult } from '../ConsoleRunner.js';
import type { GameContext } from './world.js';

export function permitCommand(
  _ctx: GameContext,
  _args: string[],
  _named: Record<string, string>,
): CommandResult {
  throw new Error('not implemented');
}
