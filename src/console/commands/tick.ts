// BlastSimulator2026 — Console tick command: advances the simulation
// Split from events.ts (#695).

import type { CommandResult } from '../ConsoleRunner.js';
import type { GameContext } from './world.js';
import type { GameState } from '../../core/state/GameState.js';
import type { ExpenseCategory } from '../../core/economy/Finance.js';

/** Deduct a cash cost and log it as a finance expense, if the cost is positive. */
function deductExpense(
  state: GameState,
  cost: number,
  category: ExpenseCategory,
  label: string,
): void {
  void state;
  void cost;
  void category;
  void label;
  throw new Error('not implemented');
}

export function tickCommand(
  ctx: GameContext,
  args: string[],
  _named: Record<string, string>,
): CommandResult {
  void ctx;
  void args;
  void _named;
  void deductExpense;
  throw new Error('not implemented');
}
