// BlastSimulator2026 — Console commands for mafia interactions
// Split from events.ts (#695).

import type { CommandResult } from '../ConsoleRunner.js';
import type { GameContext } from './world.js';
import { Random } from '../../core/math/Random.js';
import {
  arrangeAccident,
  startFraming,
  completeFrame,
  setSmugglingVolume,
  type MafiaActionResult,
  applyInvestigation,
  ACCIDENT_COST,
  FRAME_COST,
} from '../../core/events/MafiaActions.js';
import { addExpense } from '../../core/economy/Finance.js';
import { formatMoney } from '../../core/economy/formatMoney.js';
import { t } from '../../core/i18n/I18n.js';
import { requireGame } from './commandUtils.js';

/** A botched action draws police: exposure jump, follow-up event, toast event. */
function raiseInvestigation(ctx: GameContext, result: MafiaActionResult): void {
  if (!result.investigationTriggered) return;
  applyInvestigation(ctx.state!.mafia, ctx.state!.events, ctx.state!.tickCount);
  ctx.emitter.emit('mafia:investigation', { outcomeKey: result.outcomeKey });
}

export function mafiaCommand(
  ctx: GameContext,
  args: string[],
  named: Record<string, string>,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return err;
  const state = ctx.state!;
  const sub = args[0] ?? 'status';

  if (!state.corruption.mafiaUnlocked && sub !== 'status') {
    return { success: false, output: t('mafia.not_unlocked') };
  }

  const rng = new Random(state.seed + state.tickCount);

  switch (sub) {
    case 'status': {
      const lines = [
        state.corruption.mafiaUnlocked
          ? t('mafia.status_unlocked_yes')
          : t('mafia.status_unlocked_no'),
        t('mafia.status_exposure', { pct: (state.mafia.exposureRisk * 100).toFixed(0) }),
        state.mafia.smugglingVolume > 0
          ? t('mafia.status_smuggling_active', { volume: state.mafia.smugglingVolume })
          : t('mafia.status_smuggling_inactive'),
        t('mafia.status_pending_frames', { count: state.mafia.pendingFrames.length }),
      ];
      return { success: true, output: lines.join('\n') };
    }

    case 'accident': {
      const empId = parseInt(named['employee'] ?? '', 10);
      if (isNaN(empId)) return { success: false, output: t('mafia.accident_usage') };
      if (state.cash < ACCIDENT_COST) {
        return {
          success: false,
          output: t('console.insufficient_funds', {
            need: formatMoney(ACCIDENT_COST),
            have: formatMoney(state.cash),
          }),
        };
      }
      const result = arrangeAccident(state.mafia, state, state.corruption, empId, rng);
      state.cash -= result.cost;
      addExpense(state.finances, result.cost, 'mafia', 'Arranged accident', state.tickCount);
      raiseInvestigation(ctx, result);
      return { success: true, output: t(result.outcomeKey, result.outcomeParams) };
    }

    case 'frame': {
      const empId = parseInt(named['employee'] ?? '', 10);
      if (isNaN(empId)) return { success: false, output: t('mafia.frame_usage') };

      // Check if completing or starting
      const pending = state.mafia.pendingFrames.find(
        f => f.employeeId === empId && state.tickCount >= f.readyTick,
      );
      if (pending) {
        const result = completeFrame(state.mafia, state, empId, state.tickCount, rng);
        raiseInvestigation(ctx, result);
        return { success: true, output: t(result.outcomeKey, result.outcomeParams) };
      }

      if (state.cash < FRAME_COST) {
        return {
          success: false,
          output: t('console.insufficient_funds', {
            need: formatMoney(FRAME_COST),
            have: formatMoney(state.cash),
          }),
        };
      }
      const result = startFraming(state.mafia, state.employees, empId, state.tickCount);
      state.cash -= result.cost;
      addExpense(state.finances, result.cost, 'mafia', 'Frame job', state.tickCount);
      return { success: true, output: t(result.outcomeKey, result.outcomeParams) };
    }

    case 'smuggle': {
      const raw = named['volume'] ?? (args[1] === 'off' ? 'off' : undefined);
      if (raw === undefined) {
        const volume = state.mafia.smugglingVolume;
        return { success: true, output: volume > 0 ? t('mafia.status_smuggling_active', { volume }) : t('mafia.smuggle_usage') };
      }
      const result = setSmugglingVolume(state.mafia, raw === 'off' ? 0 : raw.trim() === '' ? NaN : Number(raw));
      if (!result.success) return { success: false, output: t(result.error) };
      const volume = result.data.volume;
      return { success: true, output: volume > 0 ? t('mafia.smuggle_activated', { volume }) : t('mafia.smuggle_deactivated') };
    }

    default:
      return { success: false, output: t('mafia.usage') };
  }
}
