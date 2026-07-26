// BlastSimulator2026 — Shared console command helpers

import type { CommandResult } from '../ConsoleRunner.js';
import type { GameContext } from './world.js';

export const NO_EMPLOYEES_MSG = 'No employees.';

/** Guard every command that needs a loaded game. */
export function requireGame(ctx: GameContext): CommandResult | null {
  if (!ctx.state) return { success: false, output: 'No game loaded. Use new_game first.' };
  return null;
}
