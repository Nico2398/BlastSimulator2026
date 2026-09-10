// BlastSimulator2026 — Console commands for ground levelling (#1009)
// Mirrors ramp.ts's shape: an order-time validation followed by queued
// `level_ground` PendingAction work carved out by a qualified driver.

import type { CommandResult } from '../../ConsoleRunner.js';
import { t } from '../../../core/i18n/I18n.js';
import type { MiningContext } from './types.js';
import { requireGame } from './shared.js';
import {
  validateLevelOrder, computeLevelTargetY, computeLevelCells, computeLevelRegion,
  type LevelOrderDef, type LevelOrderValidation,
} from '../../../core/mining/LevelGround.js';
import { getBuildingDef, getDefSize } from '../../../core/entities/Building.js';
import { dispatchPendingAction, cancelAction } from '../../../core/engine/TaskDispatch.js';
import { addExpense } from '../../../core/economy/Finance.js';
import { formatMoney } from '../../../core/economy/formatMoney.js';
import { claimForAction, cellsInRect } from '../siteExpansion.js';

/** Payload carried by a queued `level_ground` PendingAction. */
export interface LevelGroundActionPayload {
  rect: LevelOrderDef;
  targetY: number;
  cells: { x: number; y: number; z: number }[];
  region: { minX: number; maxX: number; minZ: number; maxZ: number } | null;
  orderCost: number;
  /**
   * Footprint cells (as [dx, dz] offsets from targetX/targetZ), covering the
   * WHOLE ordered rectangle (not just the cells that need clearing) — same
   * shape `place_building`'s payload carries (#556), so TaskDispatch.ts's
   * ghost-footprint pickup renders the full rectangle outline with no
   * renderer change.
   */
  footprint: ReadonlyArray<readonly [number, number]>;
}

export function levelGroundCommand(
  ctx: MiningContext,
  args: string[],
  named: Record<string, string>,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return { success: false, output: err };

  if (args[0] === 'cancel') {
    const actionId = parseInt(args[1] ?? named['id'] ?? '', 10);
    if (isNaN(actionId)) return { success: false, output: t('mining.level_ground.cancel_usage') };
    return cancelLevelGroundCommand(ctx, actionId);
  }

  const rect: LevelOrderDef = {
    minX: parseInt(named['minX'] ?? '', 10),
    maxX: parseInt(named['maxX'] ?? '', 10),
    minZ: parseInt(named['minZ'] ?? '', 10),
    maxZ: parseInt(named['maxZ'] ?? '', 10),
  };

  // validateLevelOrder runs before any footprint/claim work — its finite/
  // non-inverted and MAX_LEVEL_GROUND_AREA checks are the sole bound on
  // order size (mirrors validateRampOrder's #788 point 3 role for ramps), so
  // an invalid or oversized rect is rejected in bounded time rather than by
  // this command's own copy of the check.
  const validation: LevelOrderValidation = validateLevelOrder(rect, ctx.state!.cash, ctx.grid!);
  if (!validation.success) {
    const output = validation.messageKey ? t(validation.messageKey, validation.messageParams) : validation.message;
    return { success: false, output };
  }

  // Refuse before any claim/charge when the rect overlaps a building already
  // standing or still under construction — mirrors the AABB-overlap test
  // `checkFootprintPlacement` (Building.ts) runs against the same two
  // occupant lists. Inlined rather than extracted into a shared helper: it's
  // a 4-line check with one caller here.
  const rectSizeX = rect.maxX - rect.minX + 1;
  const rectSizeZ = rect.maxZ - rect.minZ + 1;
  const overlapsRect = (bx: number, bz: number, bSizeX: number, bSizeZ: number): boolean =>
    rect.minX < bx + bSizeX && rect.minX + rectSizeX > bx &&
    rect.minZ < bz + bSizeZ && rect.minZ + rectSizeZ > bz;

  for (const b of ctx.state!.buildings.buildings) {
    const { sizeX, sizeZ } = getDefSize(getBuildingDef(b.type, b.tier));
    if (overlapsRect(b.x, b.z, sizeX, sizeZ)) {
      return { success: false, output: t('mining.level_ground.refused_building_overlap') };
    }
  }
  for (const pb of ctx.state!.plannedBuildings) {
    const { sizeX, sizeZ } = getDefSize(getBuildingDef(pb.type, pb.tier));
    if (overlapsRect(pb.x, pb.z, sizeX, sizeZ)) {
      return { success: false, output: t('mining.level_ground.refused_building_overlap') };
    }
  }

  const claim = claimForAction(ctx, cellsInRect(rect.minX, rect.minZ, rect.maxX, rect.maxZ), 'level ground');
  if (!claim.ok) return { success: false, output: claim.output! };

  const targetY = computeLevelTargetY(ctx.grid!, rect);
  const cells = computeLevelCells(ctx.grid!, rect, targetY);

  if (cells.length === 0) {
    return { success: true, output: t('mining.level_ground.already_flat') };
  }

  const region = computeLevelRegion(cells);

  // Cost is charged in full at order time — refunded via
  // actionOrderCost/cancelAction on cancel (mirrors #555/#556's
  // order-then-work pattern).
  ctx.state!.cash -= validation.cost;
  addExpense(ctx.state!.finances, validation.cost, 'construction', 'Level ground', ctx.state!.tickCount);

  const footprint: Array<readonly [number, number]> = [];
  for (let z = rect.minZ; z <= rect.maxZ; z++) {
    for (let x = rect.minX; x <= rect.maxX; x++) {
      footprint.push([x - rect.minX, z - rect.minZ]);
    }
  }

  const actionId = ctx.state!.nextPendingActionId++;

  // skipQualificationCheck (mirrors dig_ramp_segment/drill_hole/charge_hole,
  // #555/#553/#554): a level-ground order must queue silently even when
  // nobody on the roster currently holds driving.excavator or a rock_digger
  // yet.
  dispatchPendingAction(ctx.state!, {
    id: actionId,
    type: 'level_ground',
    requiredSkill: 'driving.excavator',
    requiredVehicleRole: 'rock_digger',
    targetX: rect.minX,
    targetZ: rect.minZ,
    targetY,
    payload: {
      rect, targetY, cells, region, orderCost: validation.cost, footprint,
    } satisfies LevelGroundActionPayload,
    targetEmployeeId: null,
  }, { skipQualificationCheck: true });

  return {
    success: true,
    output: `Ground levelling ordered: ${cells.length} voxels queued for excavation ($${formatMoney(validation.cost)}).`,
  };
}

/**
 * Cancel an ordered level-ground job still excavating — thin wrapper over
 * the generic `cancelAction` (mirrors buildRampCommand's use of it for a
 * single-segment refund; unlike a ramp, a level-ground order is one atomic
 * PendingAction, not several, so there is no per-segment loop to run here).
 */
export function cancelLevelGroundCommand(ctx: MiningContext, actionId: number): CommandResult {
  const state = ctx.state!;
  const result = cancelAction(state, actionId);
  if (!result.success) {
    const message = result.error === 'not-cancellable'
      ? `Level-ground action #${actionId} cannot be cancelled.`
      : `Level-ground action #${actionId} not found.`;
    return { success: false, output: message };
  }
  const refundSuffix = result.refunded && result.refunded > 0
    ? ` $${formatMoney(result.refunded)} refunded.`
    : '';
  return { success: true, output: `Level-ground action #${actionId} cancelled.${refundSuffix}` };
}
