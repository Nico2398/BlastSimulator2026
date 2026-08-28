// BlastSimulator2026 — Console commands for ramp construction

import type { CommandResult } from '../../ConsoleRunner.js';
import { t } from '../../../core/i18n/I18n.js';
import type { MiningContext } from './types.js';
import { requireGame } from './shared.js';
import {
  RAMP_WIDTH, RAMP_COST_PER_METER, validateRampOrder, defineRampSegments,
  computeColumnSurfaceY, rampStepColumn,
  type RampDirection, type RampDef,
} from '../../../core/mining/Ramp.js';
import type { PlannedRamp } from '../../../core/state/GameState.js';
import { dispatchPendingAction, cancelAction } from '../../../core/engine/TaskDispatch.js';
import { addExpense } from '../../../core/economy/Finance.js';
import { formatMoney } from '../../../core/economy/formatMoney.js';
import { claimForAction, cellsInRect } from '../siteExpansion.js';
import { MAX_RAMP_LENGTH } from '../../../core/config/balance.js';

/** Payload carried by a queued `dig_ramp_segment` PendingAction (#555). */
export interface RampSegmentActionPayload {
  rampId: number;
  segmentIndex: number;
  cells: { x: number; y: number; z: number }[];
  region: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number } | null;
  segmentCost: number;
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

  let originX: number;
  let originZ: number;
  let direction: RampDirection;
  let length: number;
  const depth = parseInt(named['depth'] ?? '8', 10);

  if (named['start'] && named['end']) {
    const start = named['start'].split(',').map(Number);
    const end = named['end'].split(',').map(Number);
    originX = start[0] ?? 0;
    originZ = start[1] ?? 0;
    const dx = (end[0] ?? 0) - originX;
    const dz = (end[1] ?? 0) - originZ;
    if (Math.abs(dz) >= Math.abs(dx)) {
      direction = dz >= 0 ? 'south' : 'north';
      length = Math.abs(Math.round(dz));
    } else {
      direction = dx >= 0 ? 'east' : 'west';
      length = Math.abs(Math.round(dx));
    }
  } else {
    const origin = (named['origin'] ?? '0,0').split(',').map(Number);
    originX = origin[0] ?? 0;
    originZ = origin[1] ?? 0;
    direction = (named['direction'] ?? 'south') as RampDirection;
    length = parseInt(named['length'] ?? '10', 10);
  }

  // Pre-check runs before rampFootprint/cellsInRect build the array (the cost this
  // bounds), and therefore also before validateRampOrder's own length<=0 check below —
  // that check stays as a safety net for any other caller of buildRamp/validateRampOrder,
  // but on this call path it is now unreachable for length<1.
  if (!Number.isFinite(length) || length < 1) {
    return { success: false, output: t('mining.build_ramp.invalid_length') };
  }
  if (length > MAX_RAMP_LENGTH) {
    return {
      success: false,
      output: `Ramp too long: ${length}m exceeds the ${MAX_RAMP_LENGTH}m limit per ramp.`,
    };
  }

  const footprint = rampFootprint(originX, originZ, direction, length);
  const rampClaim = claimForAction(ctx, cellsInRect(footprint.minX, footprint.minZ, footprint.maxX, footprint.maxZ), 'build a ramp');
  if (!rampClaim.ok) return { success: false, output: rampClaim.output! };

  const rampDef: RampDef = { originX, originZ, direction, length, targetDepth: depth };
  const validation = validateRampOrder(rampDef, ctx.state!.cash);
  if (!validation.success) return { success: false, output: validation.message };

  const segments = defineRampSegments(ctx.grid!, rampDef);

  // Cost is charged in full at order time — unspent remainder (unworked
  // segments' share) is refunded on cancel via actionOrderCost/cancelAction
  // (#555, mirrors #553/#554's order-then-work pattern).
  ctx.state!.cash -= validation.cost;
  addExpense(ctx.state!.finances, validation.cost, 'construction', 'Build ramp', ctx.state!.tickCount);

  const rampId = ctx.state!.nextPlannedRampId++;
  const plannedRamp: PlannedRamp = { id: rampId, def: rampDef, footprint, segments: [] };

  for (const segment of segments) {
    const { x: cx, z: cz } = rampStepColumn(rampDef, segment.index);
    const surfaceY = computeColumnSurfaceY(ctx.grid!, cx, cz);
    const actionId = ctx.state!.nextPendingActionId++;

    // skipQualificationCheck (#555, mirrors drill_hole/charge_hole's #553/
    // #554 dispatch): a ramp order must queue silently even when nobody on
    // the roster currently holds driving.excavator or a rock_digger yet.
    dispatchPendingAction(ctx.state!, {
      id: actionId,
      type: 'dig_ramp_segment',
      requiredSkill: 'driving.excavator',
      requiredVehicleRole: 'rock_digger',
      targetX: cx,
      targetZ: cz,
      targetY: surfaceY,
      payload: {
        rampId, segmentIndex: segment.index, cells: segment.cells, region: segment.region,
        segmentCost: RAMP_COST_PER_METER,
      } satisfies RampSegmentActionPayload,
      targetEmployeeId: null,
    }, { skipQualificationCheck: true });

    plannedRamp.segments.push({
      index: segment.index, actionId, cells: segment.cells, region: segment.region, done: false,
    });
  }

  ctx.state!.plannedRamps.push(plannedRamp);

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

/** The cells a ramp of `length` cuts through, running `direction` from (originX, originZ). Max inclusive. */
function rampFootprint(
  originX: number, originZ: number, direction: RampDirection, length: number,
): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const ox = Math.floor(originX);
  const oz = Math.floor(originZ);
  if (direction === 'north' || direction === 'south') {
    return {
      minX: ox,
      maxX: ox + RAMP_WIDTH,
      minZ: Math.min(oz, direction === 'north' ? oz - length : oz),
      maxZ: Math.max(oz, direction === 'south' ? oz + length : oz),
    };
  }
  return {
    minX: Math.min(ox, direction === 'west' ? ox - length : ox),
    maxX: Math.max(ox, direction === 'east' ? ox + length : ox),
    minZ: oz,
    maxZ: oz + RAMP_WIDTH,
  };
}
