// BlastSimulator2026 — Console command: debug (#1206)
// Developer/debug toggles. Currently one subcommand: `occupancy`
// (status|on|off), controlling GameState.agentOccupancyEnabled — the
// ground-cell reservation feature this issue introduces, landed off by
// default (AGENT_OCCUPANCY_ENABLED_DEFAULT, balance.ts).

import type { CommandResult } from '../ConsoleRunner.js';
import type { GameContext } from './world.js';
import { requireGame } from './commandUtils.js';

export function debugCommand(
  ctx: GameContext,
  args: string[],
  _named: Record<string, string>,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return err;

  const sub = args[0] ?? '';
  if (sub !== 'occupancy') {
    return { success: false, output: 'Usage: debug occupancy (status|on|off)' };
  }

  // TODO: implement — read/write state.agentOccupancyEnabled per args[1].
  throw new Error('not implemented');
}
