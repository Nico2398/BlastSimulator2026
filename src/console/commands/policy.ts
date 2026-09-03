// BlastSimulator2026 — Console command: set_policy

import type { CommandResult } from '../ConsoleRunner.js';
import type { GameContext } from './world.js';
import { type ShiftMode } from '../../core/entities/SitePolicy.js';
import { t } from '../../core/i18n/I18n.js';
import { requireGame } from './commandUtils.js';

const VALID_MODES: ShiftMode[] = ['shift_8h', 'shift_12h', 'continuous', 'custom'];

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
    return { success: false, output: t('policy.usage') };
  }
  const mode = modeRaw as ShiftMode;

  state.sitePolicy.shiftMode = mode;

  // #539: guard below must reject non-finite parseInt results (NaN and Infinity)
  if (named['fatigue'] !== undefined) {
    const v = parseInt(named['fatigue'], 10);
    if (Number.isFinite(v)) state.sitePolicy.fatigueRestThreshold = v;
  }

  // Bumped even when every value is unchanged: applying the policy already in
  // force is still the player applying a policy.
  state.sitePolicy.revision = (state.sitePolicy.revision ?? 0) + 1;

  const fatigue = state.sitePolicy.fatigueRestThreshold;

  return {
    success: true,
    output: `Policy updated: mode=${mode} fatigue=${fatigue}`,
  };
}
