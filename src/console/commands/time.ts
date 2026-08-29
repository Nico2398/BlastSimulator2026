// BlastSimulator2026 — Console commands for time control
// Split from events.ts (#695).

import type { CommandResult } from '../ConsoleRunner.js';
import type { GameContext } from './world.js';
import { t } from '../../core/i18n/I18n.js';
import { requireGame } from './commandUtils.js';

export function timeCommand(
  ctx: GameContext,
  args: string[],
  named: Record<string, string>,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return err;
  const state = ctx.state!;
  // `time speed 2` and `time speed:2` are both accepted — the named form is the
  // house style for every other command, and silently reporting status for it
  // made scenarios look like they had changed the speed when they had not.
  const sub = args[0] ?? (named['speed'] !== undefined ? 'speed' : 'status');

  switch (sub) {
    case 'status':
      return {
        success: true,
        output: [
          `Tick: ${state.tickCount}`,
          `Speed: ${state.timeScale}x`,
          `Paused: ${state.isPaused ? 'YES' : 'No'}`,
        ].join('\n'),
      };

    case 'pause':
      state.isPaused = true;
      return { success: true, output: t('time.paused') };

    case 'resume':
      state.isPaused = false;
      return { success: true, output: t('time.resumed', { speed: state.timeScale }) };

    case 'speed': {
      const speed = parseInt(args[1] ?? named['speed'] ?? '', 10);
      if (![1, 2, 4, 8].includes(speed)) {
        return { success: false, output: t('time.invalid_speed') };
      }
      state.timeScale = speed;
      return { success: true, output: t('time.speed_set', { speed }) };
    }

    default:
      return { success: false, output: t('time.usage') };
  }
}
