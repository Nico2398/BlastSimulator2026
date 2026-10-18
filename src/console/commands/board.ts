// BlastSimulator2026 — Console command: board status|start (#1946)

import type { CommandResult } from '../ConsoleRunner.js';
import type { GameContext } from './world.js';

export function boardCommand(
  _ctx: GameContext,
  _args: string[],
  _named: Record<string, string>,
): CommandResult {
  // TODO: implement
  return { success: false, output: '' };
}
