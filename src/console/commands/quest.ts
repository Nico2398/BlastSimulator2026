// BlastSimulator2026 — Console command: quest list|detail|complete (#2280)

import type { CommandResult } from '../ConsoleRunner.js';
import type { GameContext } from './world.js';

/** `quest list`, `quest detail <id>`, `quest complete <id>` (scenario-only shortcut). */
export function questCommand(
  _ctx: GameContext,
  _args: string[],
  _named: Record<string, string>,
): CommandResult {
  throw new Error('not implemented');
}
