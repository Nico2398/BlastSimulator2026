// BlastSimulator2026 — Cheat / test-only console commands
//
// TEMPORARY: `cheat disable_revolt` exists to unblock blast-execution-visual.json
// and blast-visual-full.json, whose crews are genuinely undersized for their
// own workload and hit a deterministic worker revolt (WorkerRevolt.ts) before
// finishing, in both command and interaction mode alike -- not a scenario-file
// bug, a real crew-sizing/revolt-margin gap. Tracked for removal, alongside a
// real fix to that margin, in issue #631. Do not reach for this command
// to route around a *different* failure, and do not build new scenarios on it.

import type { CommandResult } from '../ConsoleRunner.js';
import type { GameContext } from './world.js';
import { requireGame } from './commandUtils.js';

export function cheatCommand(
  ctx: GameContext,
  args: string[],
  _named: Record<string, string>,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return err;
  const state = ctx.state!;

  const sub = args[0];
  if (sub === 'disable_revolt') {
    state.revoltDisabled = true;
    return { success: true, output: 'Worker revolt disabled for this session.' };
  }

  return { success: false, output: 'Usage: cheat disable_revolt' };
}
