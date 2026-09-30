// BlastSimulator2026 — Console commands for ramp construction

import type { CommandResult } from '../../ConsoleRunner.js';
import { t } from '../../../core/i18n/I18n.js';
import type { MiningContext } from './types.js';
import { requireGame } from './shared.js';
import {
  validateRampOrder, defineRampSegments, rampDefFromEndpoints, rampWidthOf,
  type RampDirection, type RampDef,
} from '../../../core/mining/Ramp.js';
import { queueRampOrder } from '../../../core/mining/RampOrder.js';
import { rampFootprint, orderRampWiden, validateWidenRamp, type WidenFailure } from '../../../core/mining/RampWidening.js';
import { RAMP_DEFAULT_WIDTH, RAMP_WIDTH_OPTIONS, isRampWidth } from '../../../core/config/balance.js';
import { cancelAction } from '../../../core/engine/TaskDispatch.js';
import { formatMoney } from '../../../core/economy/formatMoney.js';
import { claimForAction, cellsInRect } from '../siteExpansion.js';

export type { RampSegmentActionPayload } from '../../../core/mining/RampOrder.js';

/** Parses a `width:N` argument; NaN when present but not a number, the default when absent. */
function parseWidth(raw: string | undefined): number {
  return raw === undefined ? RAMP_DEFAULT_WIDTH : Number(raw);
}

export function buildRampCommand(
  ctx: MiningContext,
  args: string[],
  named: Record<string, string>,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return { success: false, output: err };

  if (args[0] === 'cancel') {
    const rampId = parseInt(args[1] ?? named['id'] ?? '', 10);
    if (isNaN(rampId)) return { success: false, output: t('mining.build_ramp.cancel_usage') };
    return cancelRampCommand(ctx, rampId);
  }

  let rampDef: RampDef;
  const width = parseWidth(named['width']);
  if (!isRampWidth(width)) {
    return { success: false, output: t('mining.build_ramp.invalid_width', { options: RAMP_WIDTH_OPTIONS.join(', ') }) };
  }
  const depth = parseInt(named['depth'] ?? '8', 10);

  if (named['start'] && named['end']) {
    const start = named['start'].split(',').map(Number);
    const end = named['end'].split(',').map(Number);
    const originX = start[0] ?? 0;
    const originZ = start[1] ?? 0;
    const endX = end[0] ?? 0;
    const endZ = end[1] ?? 0;
    rampDef = rampDefFromEndpoints(originX, originZ, endX, endZ, depth);
    rampDef.width = width;
  } else {
    const origin = (named['origin'] ?? '0,0').split(',').map(Number);
    const originX = origin[0] ?? 0;
    const originZ = origin[1] ?? 0;
    const direction = (named['direction'] ?? 'south') as RampDirection;
    const length = parseInt(named['length'] ?? '10', 10);
    rampDef = { originX, originZ, direction, length, targetDepth: depth, width };
  }

  const { direction, length } = rampDef;

  // validateRampOrder runs first, before rampFootprint/cellsInRect build any
  // array — its finite/positive and MAX_RAMP_LENGTH checks are the sole
  // bound on ramp length (#788 point 3), so a non-finite or oversized length
  // is rejected here in bounded time rather than by this command's own copy
  // of the check. A messageKey means the failure is translatable (#797); use
  // it over the plain-English message fallback.
  const validation = validateRampOrder(rampDef, ctx.state!.cash);
  if (!validation.success) {
    const output = validation.messageKey ? t(validation.messageKey, validation.messageParams) : validation.message;
    return { success: false, output };
  }

  const footprint = rampFootprint(rampDef, rampWidthOf(rampDef));
  const rampClaim = claimForAction(ctx, cellsInRect(footprint.minX, footprint.minZ, footprint.maxX, footprint.maxZ), 'build a ramp');
  if (!rampClaim.ok) return { success: false, output: rampClaim.output! };

  const segments = defineRampSegments(ctx.grid!, rampDef);
  if (queueRampOrder(ctx.state!, rampDef, footprint, segments, validation.cost, 'Build ramp') === null) {
    return { success: false, output: t('mining.ramp.nothing_to_dig') };
  }

  return {
    success: true,
    output: `Ramp ordered: ${length}m ${direction}, ${segments.length} segments queued for excavation`,
  };
}

/**
 * Cancel an ordered ramp still excavating (#555, mirrors `cancelAction`'s use
 * for drill/charge orders) — releases any in-flight `dig_ramp_segment`
 * actions (refunding each segment's unspent order-time cost via
 * `cancelAction`/`actionOrderCost`) and removes the `PlannedRamp` entirely.
 * Already-carved terrain is kept; only undug segments' cost is refunded.
 */
export function cancelRampCommand(ctx: MiningContext, rampId: number): { success: boolean; output: string } {
  const state = ctx.state!;
  const ramp = state.plannedRamps.find(r => r.id === rampId);
  if (!ramp) return { success: false, output: `Ramp #${rampId} not found` };

  let refunded = 0;
  for (const segment of ramp.segments) {
    if (segment.done) continue;
    const result = cancelAction(state, segment.actionId);
    if (result.success) refunded += result.refunded ?? 0;
  }

  const idx = state.plannedRamps.findIndex(r => r.id === rampId);
  if (idx !== -1) state.plannedRamps.splice(idx, 1);

  return {
    success: true,
    output: `Ramp #${rampId} cancelled.${refunded > 0 ? ` $${formatMoney(refunded)} refunded.` : ''}`,
  };
}

/** Translates a refused widen order: the failure's own reason inside the shared `refused` wrapper. */
function widenRefused(id: number, failure: WidenFailure): CommandResult {
  return { success: false, output: t('mining.widen_ramp.refused', { id, reason: t(failure.errorKey, failure.errorParams) }) };
}

/** `widen_ramp id:N width:W` — orders a built ramp widened (#1298). */
export function widenRampCommand(
  ctx: MiningContext,
  _args: string[],
  named: Record<string, string>,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return { success: false, output: err };
  const state = ctx.state!;

  const rampId = parseInt(named['id'] ?? '', 10);
  if (isNaN(rampId)) return { success: false, output: t('mining.widen_ramp.usage') };
  const ramp = state.builtRamps.find(r => r.id === rampId);
  if (!ramp) return { success: false, output: t('mining.widen_ramp.not_found', { id: rampId }) };

  const check = validateWidenRamp(ramp, Number(named['width'] ?? ''), state.cash);
  if (!check.success) return widenRefused(rampId, check);
  const toWidth = check.data.width;

  const footprint = rampFootprint(ramp.def, toWidth);
  const claim = claimForAction(ctx, cellsInRect(footprint.minX, footprint.minZ, footprint.maxX, footprint.maxZ), 'widen a ramp');
  if (!claim.ok) return { success: false, output: claim.output! };

  const result = orderRampWiden(state, ctx.grid!, rampId, toWidth);
  if (!result.success) return widenRefused(rampId, result);
  return { success: true, output: t('mining.widen_ramp.ordered', { id: rampId, width: toWidth, cost: formatMoney(result.data.cost) }) };
}
