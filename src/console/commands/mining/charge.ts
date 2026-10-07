// BlastSimulator2026 — Console commands for hole charging

import type { CommandResult } from '../../ConsoleRunner.js';
import { t } from '../../../core/i18n/I18n.js';
import type { MiningContext } from './types.js';
import { requireGame, resolveHoleId } from './shared.js';
import { createCharge, batchCharge } from '../../../core/mining/ChargePlan.js';
import {
  dispatchChargeAction, chargeFundsFailureAmount, chargePatternHoles, isHoleChargeCovered,
} from '../../../core/mining/ChargeOrder.js';
import { MIN_STEMMING_M } from '../../../core/config/balance.js';
import { formatMoney } from '../../../core/economy/formatMoney.js';
import type { GameState } from '../../../core/state/GameState.js';
import { getExplosive } from '../../../core/world/ExplosiveCatalog.js';
import { getLevel, isExplosiveAvailable, resolveAvailableExplosives } from '../../../core/campaign/Level.js';

/**
 * Funds check for a set of charge orders, run before any mutation. Null when
 * affordable (#1345: the arithmetic lives in core's ChargeOrder).
 */
export function chargeFundsFailure(
  state: GameState,
  orders: ReadonlyArray<{ holeId: string; explosiveId: string; amountKg: number }>,
): CommandResult | null {
  const short = chargeFundsFailureAmount(state, orders);
  if (!short) return null;
  return {
    success: false,
    output: t('console.insufficient_funds', { need: formatMoney(short.need), have: formatMoney(state.cash) }),
  };
}

export function chargeCommand(
  ctx: MiningContext,
  _args: string[],
  named: Record<string, string>,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return { success: false, output: err };

  if (_args[0] === 'show') {
    const orderedEntries = Object.entries(ctx.state!.plannedChargesByHole);
    const loadedEntries = Object.entries(ctx.state!.chargesByHole);
    const pattern = ctx.state!.patternCharge;
    const patternLine = pattern ? t('mining.charge.pattern_set', {
      explosive: explosiveName(pattern.explosiveId), amount: pattern.amountKg, stemming: pattern.stemmingM,
    }) : null;
    if (orderedEntries.length === 0 && loadedEntries.length === 0) {
      return { success: true, output: patternLine ?? t('mining.charge.none_set') };
    }
    const orderedLines = orderedEntries.map(([id, c]) =>
      `  ${id}: ${c.explosiveId} ${c.amountKg}kg, stemming ${c.stemmingM}m [ORDERED]`,
    );
    const loadedLines = loadedEntries.map(([id, c]) =>
      `  ${id}: ${c.explosiveId} ${c.amountKg}kg, stemming ${c.stemmingM}m`,
    );
    const waiting = ctx.state!.chargeAwaitingFunds ?? [];
    const waitingLine = waiting.length > 0 ? t('mining.charge.awaiting_funds', { count: waiting.length, holes: waiting.join(', ') }) : null;
    const body = `Charges:\n${[...orderedLines, ...loadedLines].join('\n')}`;
    return { success: true, output: [patternLine, waitingLine, body].filter(Boolean).join('\n') };
  }

  const holeSpec = named['hole'] ?? '';
  const explosiveId = named['explosive'] ?? '';
  const amount = parseFloat((named['amount'] ?? '0').replace('kg', ''));
  const stemming = parseFloat((named['stemming'] ?? String(MIN_STEMMING_M)).replace('m', ''));

  if (!explosiveId) return { success: false, output: t('mining.charge.missing_explosive') };
  const notOffered = levelExplosiveFailure(ctx.state!.campaign.activeLevelId, explosiveId);
  if (notOffered) return notOffered;

  if (holeSpec === '*') return chargePattern(ctx.state!, explosiveId, amount, stemming);

  // Resolve holeId: accept either the exact ID (H1) or the legacy hole_N format
  const holeId = resolveHoleId(ctx.state!, holeSpec);
  const hole = ctx.state!.drillHoles.find(h => h.id === holeId);
  if (!hole) {
    const planned = ctx.state!.plannedDrillHoles.find(h => h.id === holeId);
    if (planned) return { success: false, output: `Hole "${holeId}" has not been drilled yet.` };
    return { success: false, output: `Hole "${holeId}" not found` };
  }

  const result = createCharge(explosiveId, amount, stemming, hole.depth);
  if ('error' in result) return { success: false, output: result.error };

  const broke = chargeFundsFailure(ctx.state!, [{ holeId: hole.id, explosiveId, amountKg: amount }]);
  if (broke) return broke;
  dispatchChargeAction(ctx.state!, hole, result.charge);
  return { success: true, output: `Charge ordered for ${holeId}: ${explosiveId} ${amount}kg, stemming ${stemming}m` };
}

/**
 * Failure when `explosiveId` is a catalog explosive the active level does not
 * offer. Null when allowed or when the id is not in the catalog (unknown ids
 * keep their existing error path).
 */
export function levelExplosiveFailure(levelId: string | null, explosiveId: string): CommandResult | null {
  if (!getExplosive(explosiveId)) return null;
  if (isExplosiveAvailable(levelId, explosiveId)) return null;
  const level = levelId ? getLevel(levelId) : undefined;
  const nameOf = (id: string): string => {
    const e = getExplosive(id);
    return e ? t(e.nameKey) : id;
  };
  return {
    success: false,
    output: t('mining.charge.explosive_not_available', {
      explosive: nameOf(explosiveId),
      level: level ? t(level.nameKey) : (levelId ?? ''),
      available: resolveAvailableExplosives(levelId).map(nameOf).join(', '),
    }),
  };
}

function explosiveName(id: string): string {
  const e = getExplosive(id);
  return e ? t(e.nameKey) : id;
}

/**
 * `charge hole:*` — store the pattern charge and order every uncovered drilled
 * hole; holes drilled later are charged on landing (#1345). Funds are checked
 * per hole, an unaffordable one waits instead of failing the batch.
 */
function chargePattern(state: GameState, explosiveId: string, amount: number, stemming: number): CommandResult {
  const drilled = state.drillHoles;
  const uncovered = drilled.filter(h => !isHoleChargeCovered(state, h.id));
  const skippedCount = drilled.length - uncovered.length;
  if (uncovered.length === 0 && state.plannedDrillHoles.length === 0) {
    return { success: false, output: t('mining.charge.nothing_to_charge') };
  }

  const depths: Record<string, number> = {};
  for (const h of [...uncovered, ...state.plannedDrillHoles]) depths[h.id] = h.depth;
  const check = batchCharge(Object.keys(depths), depths, explosiveId, amount, stemming);
  if (check.errors.length > 0) {
    return { success: false, output: `Errors:\n${check.errors.map(e => `  ${e.holeId}: ${e.message}`).join('\n')}` };
  }

  state.patternCharge = { explosiveId, amountKg: amount, stemmingM: stemming };
  const result = chargePatternHoles(state, uncovered);
  const lines: string[] = [];
  if (drilled.length > 0) {
    lines.push(t('mining.charge.ordered_summary', {
      ordered: result.ordered.length, skipped: skippedCount, waiting: result.awaiting.length,
    }));
  }
  lines.push(t('mining.charge.pattern_set', { explosive: explosiveName(explosiveId), amount, stemming }));
  if (result.invalid.length > 0) {
    lines.push(...result.invalid.map(e => `  ${e.holeId}: ${e.message}`));
  }
  return { success: true, output: lines.join('\n') };
}
