// BlastSimulator2026 — Console command: board status|start (#1946)

import type { CommandResult } from '../ConsoleRunner.js';
import type { GameContext } from './world.js';
import { t } from '../../core/i18n/I18n.js';
import { formatMoney } from '../../core/economy/formatMoney.js';
import { boardProgress, boardTicksLeft, createBoardState } from '../../core/economy/Board.js';
import { getOperatingProfit } from '../../core/economy/Finance.js';
import { TICKS_PER_DAY, BOARD_QUARTER_TICKS, BOARD_DEBUG_ORE_TARGET_T, BOARD_DEBUG_PROFIT_TARGET } from '../../core/config/balance.js';
import { requireGame } from './commandUtils.js';

function boardStatus(ctx: GameContext): CommandResult {
  const state = ctx.state!;
  const board = state.board;
  if (!board) return { success: false, output: t('board.no_board') };
  const p = boardProgress(board, state.finances);
  return {
    success: true,
    output: [
      t('board.status.quarter', { quarter: board.quarter, days: Math.ceil(boardTicksLeft(board, state.tickCount) / TICKS_PER_DAY) }),
      t('board.status.ore', { current: p.oreT.toFixed(1), target: p.targets.oreT.toFixed(1) }),
      t('board.status.profit', { current: formatMoney(p.profit), target: formatMoney(p.targets.profit) }),
      t('board.status.confidence', { confidence: Math.round(board.confidence) }),
      t('board.status.dividend', { amount: formatMoney(board.lastDividend) }),
    ].join('\n'),
  };
}

function positiveNamed(named: Record<string, string>, key: string, fallback: number): number | null {
  const raw = named[key];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Debug: attach a board to the running game. */
function boardStart(ctx: GameContext, named: Record<string, string>): CommandResult {
  const state = ctx.state!;
  if (state.board) return { success: false, output: t('board.start.exists') };
  if (state.levelEnded) return { success: false, output: t('board.start.level_ended') };
  const quarterTicks = positiveNamed(named, 'quarterTicks', BOARD_QUARTER_TICKS);
  const oreTargetT = positiveNamed(named, 'ore', BOARD_DEBUG_ORE_TARGET_T);
  const profitTarget = positiveNamed(named, 'profit', BOARD_DEBUG_PROFIT_TARGET);
  if (quarterTicks === null || oreTargetT === null || profitTarget === null) return { success: false, output: t('board.usage') };
  const board = createBoardState({ quarterTicks, oreTargetT, profitTarget }, state.tickCount);
  board.profitAtQuarterStart = getOperatingProfit(state.finances);
  state.board = board;
  return { success: true, output: t('board.start.success', { ticks: board.config.quarterTicks }) };
}

export function boardCommand(
  ctx: GameContext,
  args: string[],
  named: Record<string, string>,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return err;
  switch (args[0]) {
    case undefined:
    case 'status': return boardStatus(ctx);
    case 'start': return boardStart(ctx, named);
    default: return { success: false, output: t('board.usage') };
  }
}
