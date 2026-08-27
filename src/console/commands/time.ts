// BlastSimulator2026 — Console commands for time control
// Split from events.ts (#695).

import type { CommandResult } from '../ConsoleRunner.js';
import type { GameContext } from './world.js';

export function timeCommand(
  ctx: GameContext,
  args: string[],
  named: Record<string, string>,
): CommandResult {
  void ctx;
  void args;
  void named;
  throw new Error('not implemented');
}
