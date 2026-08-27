// BlastSimulator2026 — Console commands for corruption
// Split from events.ts (#695).

import type { CommandResult } from '../ConsoleRunner.js';
import type { GameContext } from './world.js';
import {
  attemptCorruption,
  getCorruptionLevel,
  getSuccessRate,
  TARGET_COSTS,
  type CorruptionTarget,
} from '../../core/economy/Corruption.js';
import { addExpense } from '../../core/economy/Finance.js';
import { formatMoney } from '../../core/economy/formatMoney.js';
import { Random } from '../../core/math/Random.js';
import { requireGame, sanitizeFiniteOverride } from './commandUtils.js';

export function corruptCommand(
  ctx: GameContext,
  _args: string[],
  named: Record<string, string>,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return err;
  const state = ctx.state!;

  const target = named['target'] as CorruptionTarget | undefined;
  if (!target) {
    // Show corruption status
    const lines = [
      `Corruption level: ${getCorruptionLevel(state.corruption)}`,
      `Success rate: ${(getSuccessRate(state.corruption) * 100).toFixed(0)}%`,
      `Mafia unlocked: ${state.corruption.mafiaUnlocked ? 'YES' : 'No'}`,
      `Attempts: ${state.corruption.attempts.length}`,
    ];
    return { success: true, output: lines.join('\n') };
  }

  const validTargets: CorruptionTarget[] = ['judge', 'union_leader', 'inspector', 'politician', 'witness'];
  if (!validTargets.includes(target)) {
    return { success: false, output: `Invalid target. Valid: ${validTargets.join(', ')}` };
  }

  const cost = named['cost'] ? sanitizeFiniteOverride(parseInt(named['cost'], 10), { min: 0 }) : undefined;
  const resolvedCost = cost ?? TARGET_COSTS[target];
  if (state.cash < resolvedCost) {
    return {
      success: false,
      output: `Insufficient funds: need $${formatMoney(resolvedCost)}, have $${formatMoney(state.cash)}`,
    };
  }
  const rng = new Random(state.seed + state.tickCount);
  const result = attemptCorruption(state.corruption, target, state.tickCount, rng, cost);

  addExpense(state.finances, result.cost, 'corruption', `Bribe: ${target}`, state.tickCount);
  state.cash -= result.cost;

  const lines = [
    result.success ? 'CORRUPTION SUCCESSFUL.' : 'CORRUPTION FAILED — SCANDAL!',
    `Cost: $${result.cost}`,
  ];
  if (result.scandalTriggered) {
    lines.push('A scandal has erupted. Expect consequences.');
  }
  if (result.mafiaJustUnlocked) {
    lines.push('You have attracted the attention of... certain organizations.');
  }

  return { success: true, output: lines.join('\n') };
}
