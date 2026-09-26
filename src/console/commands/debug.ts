// BlastSimulator2026 — Console command: debug (#1206)
// Developer/debug toggles. Currently one subcommand: `occupancy`
// (status|on|off), controlling GameState.agentOccupancyEnabled — the
// ground-cell reservation feature this issue introduces, landed off by
// default (AGENT_OCCUPANCY_ENABLED_DEFAULT, balance.ts).

import type { CommandResult } from '../ConsoleRunner.js';
import type { GameContext } from './world.js';
import { requireGame } from './commandUtils.js';
import { t } from '../../core/i18n/I18n.js';

export function debugCommand(
  ctx: GameContext,
  args: string[],
  _named: Record<string, string>,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return err;

  const sub = args[0] ?? '';
  if (sub !== 'occupancy') {
    return { success: false, output: t('console.debug_usage') };
  }

  const state = ctx.state!;
  const action = args[1] ?? 'status';

  if (action === 'on') {
    state.agentOccupancyEnabled = true;
    return { success: true, output: t('console.debug_occupancy_on') };
  }

  if (action === 'off') {
    state.agentOccupancyEnabled = false;
    // Clean slate for next re-enable — rebuildAgentOccupancy runs again the
    // next tick the switch is on (Locomotion.ts's tickLocomotion).
    state.agentOccupancy = null;
    return { success: true, output: t('console.debug_occupancy_off') };
  }

  if (action === 'status') {
    return {
      success: true,
      output: state.agentOccupancyEnabled ? t('console.debug_occupancy_on') : t('console.debug_occupancy_off'),
    };
  }

  return { success: false, output: t('console.debug_usage') };
}
