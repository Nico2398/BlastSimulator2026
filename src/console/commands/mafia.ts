// BlastSimulator2026 — Console commands for mafia interactions
// Split from events.ts (#695).

import type { CommandResult } from '../ConsoleRunner.js';
import type { GameContext } from './world.js';
import { Random } from '../../core/math/Random.js';
import {
  arrangeAccident,
  startFraming,
  completeFrame,
  toggleSmuggling,
  ACCIDENT_COST,
  FRAME_COST,
} from '../../core/events/MafiaActions.js';
import { addExpense } from '../../core/economy/Finance.js';
import { formatMoney } from '../../core/economy/formatMoney.js';
import { t } from '../../core/i18n/I18n.js';
import { requireGame } from './commandUtils.js';

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
        `Mafia unlocked: ${state.corruption.mafiaUnlocked ? 'YES' : 'No'}`,
        `Exposure risk: ${(state.mafia.exposureRisk * 100).toFixed(0)}%`,
        `Smuggling: ${state.mafia.smugglingActive ? `ACTIVE ($${state.mafia.smugglingIncome}/tick)` : 'inactive'}`,
        `Pending frames: ${state.mafia.pendingFrames.length}`,
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
      const result = arrangeAccident(state.mafia, state.employees, state.corruption, empId, rng);
      state.cash -= result.cost;
      addExpense(state.finances, result.cost, 'mafia', 'Arranged accident', state.tickCount);
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
        const result = completeFrame(state.mafia, state.employees, empId, state.tickCount, rng);
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
      const result = toggleSmuggling(state.mafia);
      return {
        success: true,
        output: result.active
          ? t('mafia.smuggle_activated', { income: result.incomePerTick })
          : t('mafia.smuggle_deactivated'),
      };
    }

    default:
      return { success: false, output: t('mafia.usage') };
  }
}
