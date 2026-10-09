// BlastSimulator2026 — Console commands for corruption
// Split from events.ts (#695).

import type { CommandResult } from '../ConsoleRunner.js';
import type { GameContext } from './world.js';
import {
  attemptCorruption,
  applyBribeFailure,
  getCorruptionLevel,
  getSuccessRate,
  TARGET_COSTS,
  type CorruptionTarget,
} from '../../core/economy/Corruption.js';
import { BRIBE_PROFILES, protectionRemainingTicks } from '../../core/economy/BribeProtection.js';
import { applyExposure } from '../../core/events/MafiaActions.js';
import { addExpense, chargeFine } from '../../core/economy/Finance.js';
import { formatMoney } from '../../core/economy/formatMoney.js';
import { t } from '../../core/i18n/I18n.js';
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
    for (const p of state.corruption.protections) {
      lines.push(t('corruption.protection_line', {
        target: t(`corruption.target.${p.target}`),
        ticks: protectionRemainingTicks(p, state.tickCount),
      }));
    }
    return { success: true, output: lines.join('\n') };
  }

  const validTargets: CorruptionTarget[] = Object.keys(BRIBE_PROFILES) as CorruptionTarget[];
  if (!validTargets.includes(target)) {
    return { success: false, output: t('corruption.invalid_target', { valid: validTargets.join(', ') }) };
  }

  const cost = named['cost'] ? sanitizeFiniteOverride(parseInt(named['cost'], 10), { min: 0 }) : undefined;
  const resolvedCost = cost ?? TARGET_COSTS[target];
  if (state.cash < resolvedCost) {
    return {
      success: false,
      output: t('console.insufficient_funds', {
        need: formatMoney(resolvedCost),
        have: formatMoney(state.cash),
      }),
    };
  }
  const rng = new Random(state.seed + state.tickCount);
  const result = attemptCorruption(state.corruption, target, state.tickCount, rng, cost);

  addExpense(state.finances, result.cost, 'corruption', `Bribe: ${target}`, state.tickCount);
  state.cash -= result.cost;

  let mafiaUnlocked = result.mafiaJustUnlocked;
  const lines = [
    result.success ? t('corruption.success') : t('corruption.failed_scandal'),
    `Cost: $${result.cost}`,
  ];
  if (result.scandalTriggered) {
    lines.push(t('corruption.scandal_erupted'));
    const failure = applyBribeFailure(state.corruption, state.scores, result.cost);
    const { fine } = failure;
    mafiaUnlocked ||= failure.mafiaJustUnlocked;
    if (fine > 0) {
      chargeFine(state, fine, `Scandal: ${target}`, state.tickCount);
      lines.push(t('corruption.scandal_fine', { fine: formatMoney(fine) }));
    }
    ctx.emitter.emit('corruption:scandal', { target, fine });
  }
  if (result.protection) {
    lines.push(t(`corruption.protection_granted.${target}`));
  }
  if (result.exposureReduction) {
    applyExposure(state.mafia, -result.exposureReduction);
    lines.push(t('corruption.exposure_lowered', { amount: Math.round(result.exposureReduction * 100) }));
  }
  if (mafiaUnlocked) {
    lines.push(t('corruption.mafia_unlocked'));
  }

  return { success: true, output: lines.join('\n') };
}
