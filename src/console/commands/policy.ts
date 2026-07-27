// BlastSimulator2026 — Console command: set_policy

import type { CommandResult } from '../ConsoleRunner.js';
import type { GameContext } from './world.js';
import { type ShiftMode } from '../../core/entities/SitePolicy.js';

function requireGame(ctx: GameContext): CommandResult | null {
  if (!ctx.state) return { success: false, output: 'No game loaded. Use new_game first.' };
  return null;
}

const VALID_MODES: ShiftMode[] = ['shift_8h', 'shift_12h', 'continuous', 'custom'];

const USAGE_MSG =
  'Usage: set_policy mode:(shift_8h|shift_12h|continuous|custom) [hunger:N] [fatigue:N] [social:N]';

export function setPolicyCommand(
  ctx: GameContext,
  _args: string[],
  named: Record<string, string>,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return err;
  const state = ctx.state!;

  const modeRaw = named['mode'] ?? '';
  if (!VALID_MODES.includes(modeRaw as ShiftMode)) {
    return { success: false, output: USAGE_MSG };
  }
  const mode = modeRaw as ShiftMode;

  state.sitePolicy.shiftMode = mode;

  if (named['hunger'] !== undefined) {
    const v = parseInt(named['hunger'], 10);
    if (!isNaN(v)) state.sitePolicy.hungerRestThreshold = v;
  }
  if (named['fatigue'] !== undefined) {
    const v = parseInt(named['fatigue'], 10);
    if (!isNaN(v)) state.sitePolicy.fatigueRestThreshold = v;
  }
  if (named['social'] !== undefined) {
    const v = parseInt(named['social'], 10);
    if (!isNaN(v)) state.sitePolicy.socialBreakThreshold = v;
  }

  // Bumped even when every value is unchanged: applying the policy already in
  // force is still the player applying a policy.
  state.sitePolicy.revision = (state.sitePolicy.revision ?? 0) + 1;

  const hunger = state.sitePolicy.hungerRestThreshold;
  const fatigue = state.sitePolicy.fatigueRestThreshold;
  const social = state.sitePolicy.socialBreakThreshold;

  return {
    success: true,
    output: `Policy updated: mode=${mode} hunger=${hunger} fatigue=${fatigue} social=${social}`,
  };
}
