// BlastSimulator2026 — Console commands for corruption
// Split from events.ts (#695).

import type { CommandResult } from '../ConsoleRunner.js';
import type { GameContext } from './world.js';

export function corruptCommand(
  ctx: GameContext,
  _args: string[],
  named: Record<string, string>,
): CommandResult {
  void ctx;
  void _args;
  void named;
  throw new Error('not implemented');
}
