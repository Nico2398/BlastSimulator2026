// BlastSimulator2026 — Console commands for hole charging

import type { CommandResult } from '../../ConsoleRunner.js';
import { t } from '../../../core/i18n/I18n.js';
import type { MiningContext } from './types.js';
import { requireGame, resolveHoleId } from './shared.js';
import { createCharge, batchCharge } from '../../../core/mining/ChargePlan.js';
import {
  dispatchChargeAction, chargePatternHoles, isHoleChargeCovered,
} from '../../../core/mining/ChargeOrder.js';
import { CHARGE_DEFAULT_STEMMING_M, SOFTWARE_TIER_OPTIMIZER } from '../../../core/config/balance.js';
import { previewChargeOptimization } from '../../../core/mining/Software.js';
import { optimizerOptionsFor } from '../../../core/mining/ChargeOptimizer.js';
import { formatMoney } from '../../../core/economy/formatMoney.js';
import type { GameState } from '../../../core/state/GameState.js';
import { getExplosive } from '../../../core/world/ExplosiveCatalog.js';
import { getLevel, isExplosiveAvailable, resolveAvailableExplosives } from '../../../core/campaign/Level.js';

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
    const patternLine = pattern ? patternSetLine(pattern.explosiveId, pattern.amountKg, pattern.stemmingM) : null;
    if (orderedEntries.length === 0 && loadedEntries.length === 0) {
      return { success: true, output: patternLine ?? t('mining.charge.none_set') };
    }
    const orderedLines = orderedEntries.map(([id, c]) =>
      `  ${id}: ${c.explosiveId} ${c.amountKg}kg, stemming ${c.stemmingM}m [ORDERED]`,
    );
    const loadedLines = loadedEntries.map(([id, c]) =>
      `  ${id}: ${c.explosiveId} ${c.amountKg}kg, stemming ${c.stemmingM}m`,
    );
    const body = `Charges:\n${[...orderedLines, ...loadedLines].join('\n')}`;
    return { success: true, output: [patternLine, body].filter(Boolean).join('\n') };
  }

  const holeSpec = named['hole'] ?? '';
  const explosiveId = named['explosive'] ?? '';
  // No amount fills each hole up to the stemming; an explicit one is a partial charge at the bottom.
  const amount = named['amount'] === undefined ? null : parseFloat(named['amount'].replace('kg', ''));
  const stemming = parseFloat((named['stemming'] ?? String(CHARGE_DEFAULT_STEMMING_M)).replace('m', ''));

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

  const result = createCharge(explosiveId, amount, stemming, hole.depth, hole.diameter);
  if ('error' in result) return { success: false, output: result.error };

  dispatchChargeAction(ctx.state!, hole, result.charge);
  return { success: true, output: `Charge ordered for ${holeId}: ${explosiveId} ${result.charge.amountKg}kg, stemming ${stemming}m` };
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

/** "Pattern charge: Boomite, filled to 2.5 m of stemming" (or a fixed kg for a partial pattern). */
function patternSetLine(explosiveId: string, amountKg: number | null, stemming: number): string {
  return amountKg === null
    ? t('mining.charge.pattern_set_fill', { explosive: explosiveName(explosiveId), stemming })
    : t('mining.charge.pattern_set', { explosive: explosiveName(explosiveId), amount: amountKg, stemming });
}

/**
 * `charge hole:*` — store the pattern charge and order every uncovered drilled
 * hole; holes drilled later are charged on landing (#1345). Funds are checked
 * per hole, an unaffordable one waits instead of failing the batch.
 */
function chargePattern(state: GameState, explosiveId: string, amount: number | null, stemming: number): CommandResult {
  const drilled = state.drillHoles;
  const uncovered = drilled.filter(h => !isHoleChargeCovered(state, h.id));
  const skippedCount = drilled.length - uncovered.length;
  if (uncovered.length === 0 && state.plannedDrillHoles.length === 0) {
    // Holes that are all charged (or ordered) are not the same refusal as no holes at all.
    return { success: false, output: t(drilled.length > 0 ? 'mining.charge.all_covered' : 'mining.charge.nothing_to_charge') };
  }

  const depths: Record<string, number> = {};
  const diameters: Record<string, number> = {};
  for (const h of [...uncovered, ...state.plannedDrillHoles]) {
    depths[h.id] = h.depth;
    diameters[h.id] = h.diameter;
  }
  const check = batchCharge(Object.keys(depths), depths, explosiveId, amount, stemming, diameters);
  if (check.errors.length > 0) {
    return { success: false, output: `Errors:\n${check.errors.map(e => `  ${e.holeId}: ${e.message}`).join('\n')}` };
  }

  state.patternCharge = { explosiveId, amountKg: amount, stemmingM: stemming };
  const result = chargePatternHoles(state, uncovered);
  const lines: string[] = [];
  if (drilled.length > 0) {
    lines.push(t('mining.charge.ordered_summary', {
      ordered: result.ordered.length, skipped: skippedCount,
    }));
  }
  lines.push(patternSetLine(explosiveId, amount, stemming));
  if (result.invalid.length > 0) {
    lines.push(...result.invalid.map(e => `  ${e.holeId}: ${e.message}`));
  }
  return { success: true, output: lines.join('\n') };
}

/** `optimize_charges [apply:true]` — the tier-4 charge proposal for the drilled pattern (#2204). */
export function optimizeChargesCommand(
  ctx: MiningContext,
  _args: string[],
  named: Record<string, string>,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return { success: false, output: err };
  const state = ctx.state!;
  const locked = t('mining.optimize.locked', { tier: SOFTWARE_TIER_OPTIMIZER, current: state.softwareTier });
  if (state.softwareTier < SOFTWARE_TIER_OPTIMIZER) return { success: false, output: locked };
  if (state.drillHoles.length === 0) return { success: false, output: t('mining.optimize.no_holes') };

  const proposal = previewChargeOptimization(state.drillHoles, ctx.grid!, state.softwareTier, optimizerOptionsFor(state));
  if (!proposal) return { success: false, output: locked };

  const ids = Object.keys(proposal.charges);
  const limited = Number.isFinite(proposal.permitKgLimit);
  const lines = [t(limited ? 'mining.optimize.summary' : 'mining.optimize.summary_unlimited', {
    holes: ids.length,
    kg: +proposal.totalKg.toFixed(1),
    limit: proposal.permitKgLimit,
    cost: formatMoney(proposal.cost),
    good: Math.round((proposal.bandShares?.good ?? 0) * 100),
  })];
  for (const id of ids) {
    const c = proposal.charges[id]!;
    lines.push(t('mining.optimize.hole_line', { hole: id, explosive: explosiveName(c.explosiveId), amount: c.amountKg, stemming: c.stemmingM }));
  }
  if (proposal.skippedHoleIds.length > 0) lines.push(t('mining.optimize.skipped', { holes: proposal.skippedHoleIds.join(', ') }));
  if (!proposal.withinPermit) lines.push(t('mining.optimize.over_permit', { limit: proposal.permitKgLimit }));

  if (named['apply'] === 'true') {
    for (const hole of state.drillHoles) {
      const charge = proposal.charges[hole.id];
      if (charge) dispatchChargeAction(state, hole, charge);
    }
    lines.push(t('mining.optimize.applied', { ordered: ids.length }));
  } else {
    lines.push(t('mining.optimize.not_applied'));
  }
  return { success: true, output: lines.join('\n') };
}
