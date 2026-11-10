// BlastSimulator2026 — Console commands for blast plan save/load/validate, preview, and software

import type { CommandResult } from '../../ConsoleRunner.js';
import { t } from '../../../core/i18n/I18n.js';
import type { MiningContext } from './types.js';
import { requireGame, requireGameWithSub, assembleCurrentBlastPlan, assembleValidBlastPlan, wetHoleIdSet, levelVillagePositions } from './shared.js';
import {
  previewEnergy,
  previewFragments,
  fragmentDistributionFrom,
  previewProjections,
  previewVibrations,
  purchaseSoftware,
} from '../../../core/mining/Software.js';
import { averageVibrationMod, DEFAULT_GROUND_FACTOR } from '../../../core/mining/BlastExecution.js';
import { resolveMarketId } from '../../../core/campaign/Level.js';
import type { BlastPlan } from '../../../core/mining/BlastPlan.js';
import {
  VOXEL_SIZE_CM,
  VILLAGE_VIBRATION_FLOOR_MM_S,
  SOFTWARE_TIER_FRAGMENTS,
  SOFTWARE_TIER_PROJECTIONS,
  SOFTWARE_TIER_VIBRATIONS,
  BLAST_PREVIEW_SHAPE,
} from '../../../core/config/balance.js';
import { dryRunBlast } from '../../../core/mining/BlastDryRun.js';
import { formatMoney } from '../../../core/economy/formatMoney.js';
import { queueSavedBlastPlan } from './savedPlanQueue.js';
import { addExpense } from '../../../core/economy/Finance.js';

// ── Blast plan save/load/validate ──

export function blastPlanCommand(
  ctx: MiningContext,
  args: string[],
  named: Record<string, string>,
): CommandResult {
  const preamble = requireGameWithSub(ctx, args);
  if (preamble.error) return preamble.error;
  const sub = preamble.sub;

  if (sub === 'save') {
    const name = named['name'] ?? 'default';
    ctx.state!.savedPlans[name] = {
      drillHoles: [...ctx.state!.drillHoles],
      chargesByHole: { ...ctx.state!.chargesByHole },
    };
    return { success: true, output: `Plan saved as "${name}"` };
  }

  if (sub === 'load') {
    const name = named['name'] ?? 'default';
    const saved = ctx.state!.savedPlans[name];
    if (!saved) return { success: false, output: `No saved plan "${name}"` };
    return queueSavedBlastPlan(ctx, saved, name);
  }

  if (sub === 'validate') {
    const assembled = assembleValidBlastPlan(ctx.state!, t('mining.blast_plan.validation_issues_header'));
    if (assembled.error) return assembled.error;
    return { success: true, output: t('mining.blast_plan.valid') };
  }

  if (sub === 'list') {
    const names = Object.keys(ctx.state!.savedPlans);
    if (names.length === 0) return { success: true, output: t('mining.blast_plan.none_saved') };
    return { success: true, output: `Saved plans:\n${names.map(n => `  ${n}`).join('\n')}` };
  }

  return { success: false, output: t('mining.blast_plan.usage') };
}

// ── Preview commands ──

/** Ground factor executeBlast would use for this plan (base 1 x mean explosive vibrationMod), so preview equals blast. */
function vibrationFactor(ctx: MiningContext, plan: BlastPlan): number {
  return averageVibrationMod(plan, wetHoleIdSet(ctx));
}

export function previewCommand(
  ctx: MiningContext,
  args: string[],
  _named: Record<string, string>,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return { success: false, output: err };

  const plan = assembleCurrentBlastPlan(ctx.state!);
  const tier = ctx.state!.softwareTier;
  const wetHoleIds = wetHoleIdSet(ctx);
  const sub = args[0];

  if (sub === 'energy') {
    // Free at every tier: the workshop heatmap (#2200) shows the same field.
    const result = previewEnergy(plan, ctx.grid!, tier, wetHoleIds);
    if (!result) return { success: false, output: t('mining.preview.usage') };
    return { success: true, output: `Energy preview: ${result.energyMap.size} voxels, max=${result.maxEnergy.toFixed(1)}, min=${result.minEnergy.toFixed(1)}` };
  }
  if (sub === 'fragments') {
    const result = previewFragments(plan, ctx.grid!, tier, wetHoleIds);
    if (!result) return { success: false, output: lockText(SOFTWARE_TIER_FRAGMENTS, tier) };
    return { success: true, output: `Fragment preview: ${result.fracturedCount} fractured, ${result.crackedCount} cracked, ${result.unaffectedCount} unaffected, avg size ${result.avgFragmentSize.toFixed(2)}` };
  }
  if (sub === 'projections') {
    const result = previewProjections(plan, ctx.grid!, tier, wetHoleIds);
    if (!result) return { success: false, output: lockText(SOFTWARE_TIER_PROJECTIONS, tier) };
    return { success: true, output: `Projection preview: ${result.projectionZoneCount} voxels in projection zone` };
  }
  if (sub === 'vibrations') {
    const result = previewVibrations(plan, levelVillagePositions(ctx), tier, vibrationFactor(ctx, plan));
    if (!result) return { success: false, output: lockText(SOFTWARE_TIER_VIBRATIONS, tier) };
    return { success: true, output: `Vibration preview: max=${result.maxVibration.toFixed(4)}` };
  }

  return { success: false, output: t('mining.preview.usage') };
}

/** What each tier shows, for the lock line of a section the player has not bought. */
const TIER_SHOWS: Record<number, string> = {
  [SOFTWARE_TIER_FRAGMENTS]: 'fragment size distribution, oversized count, fines and dust volume, value lost to dust',
  [SOFTWARE_TIER_PROJECTIONS]: 'projection risk zones on the terrain and the dry-run rating, thrown share and furthest throw',
  [SOFTWARE_TIER_VIBRATIONS]: 'village vibration',
};

function lockText(requiredTier: number, current: number): string {
  return `Requires software tier ${requiredTier}+ (current: ${current}): ${TIER_SHOWS[requiredTier]}`;
}

/**
 * Show a comprehensive blast preview covering energy, fragmentation,
 * projections, and vibrations. Energy is free; the other sections are
 * unlocked by the software tier. Sections with insufficient tier display a lock message.
 */
export function blastPreviewCommand(
  ctx: MiningContext,
  _args: string[],
  _named: Record<string, string>,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return { success: false, output: err };

  if (ctx.state!.drillHoles.length === 0) {
    return { success: false, output: t('mining.blast.no_drill_plan') };
  }

  const assembled = assembleValidBlastPlan(ctx.state!, t('mining.blast_plan.invalid_plan_header'));
  if (assembled.error) return assembled.error;
  const plan = assembled.plan;

  const tier = ctx.state!.softwareTier;
  const wetHoleIds = wetHoleIdSet(ctx);
  const energyPreview = previewEnergy(plan, ctx.grid!, tier, wetHoleIds) ?? { energyMap: new Map(), maxEnergy: 0, minEnergy: 0 };
  const fragmentPreview = previewFragments(plan, ctx.grid!, tier, wetHoleIds);
  const projectionPreview = previewProjections(plan, ctx.grid!, tier, wetHoleIds);
  const villages = levelVillagePositions(ctx);
  const vibrationPreview = previewVibrations(plan, villages, tier, vibrationFactor(ctx, plan));
  // T1+: dry-run the blast itself on a forked grid, so the forecast is what the blast will do. One run serves T1 and T2.
  const forecast = tier >= SOFTWARE_TIER_FRAGMENTS
    ? dryRunBlast(plan, ctx.grid!, villages, DEFAULT_GROUND_FACTOR, wetHoleIds, resolveMarketId(ctx.state!))
    : null;
  const distribution = fragmentPreview && forecast ? fragmentDistributionFrom(forecast) : null;

  ctx.state!.lastBlastPreview = {
    shape: BLAST_PREVIEW_SHAPE,
    tier,
    energy: { affectedVoxels: energyPreview.energyMap.size, minEnergy: energyPreview.minEnergy, maxEnergy: energyPreview.maxEnergy },
    fragments: fragmentPreview && distribution
      ? {
        fractured: fragmentPreview.fracturedCount, cracked: fragmentPreview.crackedCount, unaffected: fragmentPreview.unaffectedCount,
        avgFragmentSizeCm: fragmentPreview.avgFragmentSize * VOXEL_SIZE_CM,
        ...distribution,
      }
      : null,
    projections: projectionPreview && forecast
      ? {
        projectionZoneVoxels: projectionPreview.projectionZoneCount,
        collapseFragments: Math.max(0, (fragmentPreview?.fracturedCount ?? 0) + (fragmentPreview?.crackedCount ?? 0) - projectionPreview.projectionZoneCount),
        predictedRating: forecast.rating,
        thrownFragments: forecast.projectionCount,
        totalFragments: forecast.fragmentCount,
        thrownShare: forecast.thrownShare,
        furthestThrowM: forecast.furthestThrowM,
      }
      : null,
    vibrations: vibrationPreview
      ? { maxVibration: vibrationPreview.maxVibration, affectedVillages: vibrationPreview.villages.length }
      : null,
  };

  const lines: string[] = [t('mining.blast.preview_header')];

  lines.push('');
  lines.push('--- Energy Map ---');
  lines.push('  (free: the heatmap shows it on the terrain)');
  lines.push(`  Affected voxels: ${energyPreview.energyMap.size}`);
  lines.push(`  Min energy: ${energyPreview.minEnergy.toFixed(1)}`);
  lines.push(`  Max energy: ${energyPreview.maxEnergy.toFixed(1)}`);

  lines.push('');
  if (fragmentPreview && distribution) {
    lines.push('--- Fragmentation ---');
    lines.push(`  Fractured: ${fragmentPreview.fracturedCount}`);
    lines.push(`  Cracked: ${fragmentPreview.crackedCount}`);
    lines.push(`  Unaffected: ${fragmentPreview.unaffectedCount}`);
    lines.push(`  Average fragment size: ${(fragmentPreview.avgFragmentSize * VOXEL_SIZE_CM).toFixed(0)} cm`);
    lines.push(`  Oversized fragments: ${distribution.oversizedFragments} of ${distribution.fragmentCount}`);
    lines.push(`  Good volume: ${distribution.goodVolumeM3.toFixed(1)} m3`);
    lines.push(`  Fines volume: ${distribution.finesVolumeM3.toFixed(1)} m3`);
    lines.push(`  Dust volume: ${distribution.dustVolumeM3.toFixed(1)} m3`);
    lines.push(`  Value lost to dust: $${formatMoney(distribution.dustLossValue)}`);
  } else {
    lines.push(`--- Fragmentation --- [${lockText(SOFTWARE_TIER_FRAGMENTS, tier)}]`);
  }

  lines.push('');
  if (projectionPreview && forecast) {
    const fractured = fragmentPreview?.fracturedCount ?? 0;
    const cracked = fragmentPreview?.crackedCount ?? 0;
    // Fragments that are fractured/cracked but NOT projected outward collapse in place
    const collapseCount = (fractured + cracked) - projectionPreview.projectionZoneCount;
    lines.push('--- Projections ---');
    lines.push(`  Projection zone voxels: ${projectionPreview.projectionZoneCount}`);
    lines.push(`  Projected fragments: ${projectionPreview.projectionZoneCount}`);
    lines.push(`  Collapse fragments: ${collapseCount}`);
    lines.push(`  Predicted rating: ${t(`blast.rating.${forecast.rating}`)}`);
    lines.push(`  Thrown share: ${Math.round(forecast.thrownShare * 100)}% (${forecast.projectionCount} of ${forecast.fragmentCount} fragments)`);
    lines.push(`  Furthest throw: ${forecast.furthestThrowM.toFixed(0)} m`);
  } else {
    lines.push(`--- Projections --- [${lockText(SOFTWARE_TIER_PROJECTIONS, tier)}]`);
  }

  lines.push('');
  if (vibrationPreview) {
    lines.push('--- Vibrations ---');
    lines.push(`  Max vibration: ${vibrationPreview.maxVibration.toFixed(4)}`);
    const felt = vibrationPreview.villages.filter(v => v.vibration >= VILLAGE_VIBRATION_FLOOR_MM_S).length;
    lines.push(`  Affected villages: ${vibrationPreview.villages.length} measured, ${felt} above ${VILLAGE_VIBRATION_FLOOR_MM_S} mm/s`);
  } else {
    lines.push(`--- Vibrations --- [${lockText(SOFTWARE_TIER_VIBRATIONS, tier)}]`);
  }

  return { success: true, output: lines.join('\n') };
}

// ── Buy software ──

export function buySoftwareCommand(
  ctx: MiningContext,
  _args: string[],
  named: Record<string, string>,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return { success: false, output: err };

  const currentTier = ctx.state!.softwareTier;

  if (named['tier'] !== undefined) {
    const requestedTier = parseInt(named['tier'], 10);
    if (requestedTier <= currentTier) {
      return { success: false, output: `Already at tier ${requestedTier} or higher` };
    }
    if (requestedTier > currentTier + 1) {
      return { success: false, output: `Must purchase tier ${currentTier + 1} first` };
    }
    // requestedTier === currentTier + 1 — fall through to purchase
  }

  const result = purchaseSoftware(currentTier, ctx.state!.cash);
  if ('error' in result) return { success: false, output: result.error };
  ctx.state!.cash -= result.cost;
  addExpense(ctx.state!.finances, result.cost, 'equipment', `Software tier ${result.newTier}`, ctx.state!.tickCount);
  ctx.state!.softwareTier = result.newTier;
  return { success: true, output: `Upgraded to software tier ${result.newTier}. Cost: $${result.cost}` };
}
