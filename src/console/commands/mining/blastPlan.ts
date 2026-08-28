// BlastSimulator2026 — Console commands for blast plan save/load/validate, preview, and software

import type { CommandResult } from '../../ConsoleRunner.js';
import { t } from '../../../core/i18n/I18n.js';
import type { MiningContext } from './types.js';
import { requireGame, requireGameWithSub, assembleCurrentBlastPlan, assembleValidBlastPlan } from './shared.js';
import {
  previewEnergy,
  previewFragments,
  previewProjections,
  previewVibrations,
  purchaseSoftware,
} from '../../../core/mining/Software.js';
import { VOXEL_SIZE_CM } from '../../../core/config/balance.js';
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
      sequenceDelays: { ...ctx.state!.sequenceDelays },
    };
    return { success: true, output: `Plan saved as "${name}"` };
  }

  if (sub === 'load') {
    const name = named['name'] ?? 'default';
    const saved = ctx.state!.savedPlans[name];
    if (!saved) return { success: false, output: `No saved plan "${name}"` };
    ctx.state!.drillHoles = [...saved.drillHoles];
    ctx.state!.chargesByHole = { ...saved.chargesByHole };
    ctx.state!.sequenceDelays = { ...saved.sequenceDelays };
    return { success: true, output: `Plan "${name}" loaded` };
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

export function previewCommand(
  ctx: MiningContext,
  args: string[],
  _named: Record<string, string>,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return { success: false, output: err };

  const plan = assembleCurrentBlastPlan(ctx.state!);
  const tier = ctx.state!.softwareTier;
  const sub = args[0];

  if (sub === 'energy') {
    const result = previewEnergy(plan, ctx.grid!, tier);
    if (!result) return { success: false, output: `Requires software tier 1+ (current: ${tier})` };
    return { success: true, output: `Energy preview: ${result.energyMap.size} voxels, max=${result.maxEnergy.toFixed(1)}, min=${result.minEnergy.toFixed(1)}` };
  }
  if (sub === 'fragments') {
    const result = previewFragments(plan, ctx.grid!, tier);
    if (!result) return { success: false, output: `Requires software tier 2+ (current: ${tier})` };
    return { success: true, output: `Fragment preview: ${result.fracturedCount} fractured, ${result.crackedCount} cracked, ${result.unaffectedCount} unaffected, avg size ${result.avgFragmentSize.toFixed(2)}` };
  }
  if (sub === 'projections') {
    const result = previewProjections(plan, ctx.grid!, tier);
    if (!result) return { success: false, output: `Requires software tier 3+ (current: ${tier})` };
    return { success: true, output: `Projection preview: ${result.projectionZoneCount} voxels in projection zone` };
  }
  if (sub === 'vibrations') {
    const result = previewVibrations(plan, [], tier);
    if (!result) return { success: false, output: `Requires software tier 4+ (current: ${tier})` };
    return { success: true, output: `Vibration preview: max=${result.maxVibration.toFixed(4)}` };
  }

  return { success: false, output: t('mining.preview.usage') };
}

/**
 * Show a comprehensive blast preview covering energy, fragmentation,
 * projections, and vibrations — each unlocked by the corresponding
 * software tier.  Sections with insufficient tier display a lock message.
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
  const energyPreview = previewEnergy(plan, ctx.grid!, tier);
  const fragmentPreview = previewFragments(plan, ctx.grid!, tier);
  const projectionPreview = previewProjections(plan, ctx.grid!, tier);
  const vibrationPreview = previewVibrations(plan, [], tier);

  ctx.state!.lastBlastPreview = {
    tier,
    energy: energyPreview
      ? { affectedVoxels: energyPreview.energyMap.size, minEnergy: energyPreview.minEnergy, maxEnergy: energyPreview.maxEnergy }
      : null,
    fragments: fragmentPreview
      ? {
        fractured: fragmentPreview.fracturedCount, cracked: fragmentPreview.crackedCount, unaffected: fragmentPreview.unaffectedCount,
        avgFragmentSizeCm: fragmentPreview.avgFragmentSize * VOXEL_SIZE_CM,
      }
      : null,
    projections: projectionPreview
      ? {
        projectionZoneVoxels: projectionPreview.projectionZoneCount,
        collapseFragments: Math.max(0, (fragmentPreview?.fracturedCount ?? 0) + (fragmentPreview?.crackedCount ?? 0) - projectionPreview.projectionZoneCount),
      }
      : null,
    vibrations: vibrationPreview
      ? { maxVibration: vibrationPreview.maxVibration, affectedVillages: vibrationPreview.villages.length }
      : null,
  };

  const lines: string[] = [t('mining.blast.preview_header')];

  lines.push('');
  if (energyPreview) {
    lines.push('--- Energy Map ---');
    lines.push(`  Affected voxels: ${energyPreview.energyMap.size}`);
    lines.push(`  Min energy: ${energyPreview.minEnergy.toFixed(1)}`);
    lines.push(`  Max energy: ${energyPreview.maxEnergy.toFixed(1)}`);
  } else {
    lines.push('--- Energy Map --- [Requires software tier 1]');
  }

  lines.push('');
  if (fragmentPreview) {
    lines.push('--- Fragmentation ---');
    lines.push(`  Fractured: ${fragmentPreview.fracturedCount}`);
    lines.push(`  Cracked: ${fragmentPreview.crackedCount}`);
    lines.push(`  Unaffected: ${fragmentPreview.unaffectedCount}`);
    lines.push(`  Average fragment size: ${fragmentPreview.avgFragmentSize.toFixed(3)} m³`);
  } else {
    lines.push('--- Fragmentation --- [Requires software tier 2]');
  }

  lines.push('');
  if (projectionPreview) {
    const fractured = fragmentPreview?.fracturedCount ?? 0;
    const cracked = fragmentPreview?.crackedCount ?? 0;
    // Fragments that are fractured/cracked but NOT projected outward collapse in place
    const collapseCount = (fractured + cracked) - projectionPreview.projectionZoneCount;
    lines.push('--- Projections ---');
    lines.push(`  Projection zone voxels: ${projectionPreview.projectionZoneCount}`);
    lines.push(`  Projected fragments: ${projectionPreview.projectionZoneCount}`);
    lines.push(`  Collapse fragments: ${collapseCount}`);
  } else {
    lines.push('--- Projections --- [Requires software tier 3]');
  }

  lines.push('');
  if (vibrationPreview) {
    lines.push('--- Vibrations ---');
    lines.push(`  Max vibration: ${vibrationPreview.maxVibration.toFixed(4)}`);
    lines.push(`  Affected villages: ${vibrationPreview.villages.length}`);
  } else {
    lines.push('--- Vibrations --- [Requires software tier 4]');
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
