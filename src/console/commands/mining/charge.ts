// BlastSimulator2026 — Console commands for hole charging and blast sequencing

import type { CommandResult } from '../../ConsoleRunner.js';
import { t } from '../../../core/i18n/I18n.js';
import type { MiningContext } from './types.js';
import { requireGame, requireGameWithSub, resolveHoleId, cancelOutstandingChargeAction } from './shared.js';
import { createCharge, batchCharge, computeChargeHoleDurationTicks } from '../../../core/mining/ChargePlan.js';
import { dispatchPendingAction } from '../../../core/engine/TaskDispatch.js';
import { MIN_STEMMING_M } from '../../../core/config/balance.js';
import { setDelay, autoVPattern } from '../../../core/mining/Sequence.js';

/** Payload carried by a queued `charge_hole` PendingAction (#554). */
export interface ChargeHoleActionPayload {
  holeId: string;
  explosiveId: string;
  amountKg: number;
  stemmingM: number;
  durationTicks: number;
}

/**
 * Queue a `charge_hole` PendingAction for `hole` with the given (already
 * validated) charge, cancelling any outstanding order for the same hole
 * first so a re-charge replaces rather than stacks (#554, mirrors drillPlan
 * grid/add's drill_hole dispatch).
 */
function dispatchChargeAction(
  ctx: MiningContext,
  hole: { id: string; x: number; z: number },
  explosiveId: string,
  amountKg: number,
  stemmingM: number,
): void {
  const state = ctx.state!;
  cancelOutstandingChargeAction(state, hole.id);

  const durationTicks = computeChargeHoleDurationTicks(amountKg);
  const actionId = state.nextPendingActionId++;
  // skipQualificationCheck (#554, mirrors drill_hole's #553 dispatch): a
  // charge order must queue silently even when nobody on the roster
  // currently holds 'blasting' yet.
  dispatchPendingAction(state, {
    id: actionId,
    type: 'charge_hole',
    requiredSkill: 'blasting',
    requiredVehicleRole: null,
    targetX: hole.x,
    targetZ: hole.z,
    targetY: 0,
    payload: {
      holeId: hole.id, explosiveId, amountKg, stemmingM, durationTicks,
    } satisfies ChargeHoleActionPayload,
    targetEmployeeId: null,
  }, { skipQualificationCheck: true });

  state.plannedChargesByHole[hole.id] = { explosiveId, amountKg, stemmingM };
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
    if (orderedEntries.length === 0 && loadedEntries.length === 0) return { success: true, output: t('mining.charge.none_set') };
    const orderedLines = orderedEntries.map(([id, c]) =>
      `  ${id}: ${c.explosiveId} ${c.amountKg}kg, stemming ${c.stemmingM}m [ORDERED]`,
    );
    const loadedLines = loadedEntries.map(([id, c]) =>
      `  ${id}: ${c.explosiveId} ${c.amountKg}kg, stemming ${c.stemmingM}m`,
    );
    return { success: true, output: `Charges:\n${[...orderedLines, ...loadedLines].join('\n')}` };
  }

  const holeSpec = named['hole'] ?? '';
  const explosiveId = named['explosive'] ?? '';
  const amount = parseFloat((named['amount'] ?? '0').replace('kg', ''));
  const stemming = parseFloat((named['stemming'] ?? String(MIN_STEMMING_M)).replace('m', ''));

  if (!explosiveId) return { success: false, output: t('mining.charge.missing_explosive') };

  if (holeSpec === '*') {
    const holeIds = ctx.state!.drillHoles.map(h => h.id);
    const depths: Record<string, number> = {};
    for (const h of ctx.state!.drillHoles) depths[h.id] = h.depth;
    const result = batchCharge(holeIds, depths, explosiveId, amount, stemming);
    if (result.errors.length > 0) {
      return { success: false, output: `Errors:\n${result.errors.map(e => `  ${e.holeId}: ${e.message}`).join('\n')}` };
    }
    for (const h of ctx.state!.drillHoles) {
      const charge = result.charges[h.id];
      if (!charge) continue;
      dispatchChargeAction(ctx, h, charge.explosiveId, charge.amountKg, charge.stemmingM);
    }
    return { success: true, output: `Ordered charges for ${holeIds.length} holes with ${explosiveId} ${amount}kg` };
  }

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

  dispatchChargeAction(ctx, hole, explosiveId, amount, stemming);
  return { success: true, output: `Charge ordered for ${holeId}: ${explosiveId} ${amount}kg, stemming ${stemming}m` };
}

export function sequenceCommand(
  ctx: MiningContext,
  args: string[],
  named: Record<string, string>,
): CommandResult {
  const preamble = requireGameWithSub(ctx, args);
  if (preamble.error) return preamble.error;
  const sub = preamble.sub;

  if (sub === 'auto') {
    const step = parseFloat((named['delay_step'] ?? '25').replace('ms', ''));
    ctx.state!.sequenceDelays = autoVPattern(ctx.state!.drillHoles, step);
    return { success: true, output: `Auto V-pattern sequence, ${step}ms step, ${Object.keys(ctx.state!.sequenceDelays).length} holes` };
  }

  if (sub === 'set') {
    const hole = named['hole'] ?? '';
    const delay = parseFloat((named['delay'] ?? '0').replace('ms', ''));
    const holeId = resolveHoleId(ctx.state!, hole, false);
    setDelay(ctx.state!.sequenceDelays, holeId, delay);
    return { success: true, output: `Set ${holeId} delay: ${delay}ms` };
  }

  if (sub === 'show') {
    const entries = Object.entries(ctx.state!.sequenceDelays);
    if (entries.length === 0) return { success: true, output: t('mining.sequence.none_set') };
    const lines = entries.sort(([, a], [, b]) => a - b)
      .map(([id, d]) => `  ${id}: ${d}ms`);
    return { success: true, output: `Sequence:\n${lines.join('\n')}` };
  }

  return { success: false, output: t('mining.sequence.usage') };
}
