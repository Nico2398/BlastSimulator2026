// BlastSimulator2026 — Console commands for drill plan management

import type { CommandResult } from '../../ConsoleRunner.js';
import type { GameState } from '../../../core/state/GameState.js';
import { t } from '../../../core/i18n/I18n.js';
import type { MiningContext } from './types.js';
import { requireGameWithSub, resolveHoleId, cancelOutstandingChargeAction } from './shared.js';
import {
  createGridPlan, addHole, removeHole, resetHoleIds,
  computeDrillHoleDurationTicks,
} from '../../../core/mining/DrillPlan.js';
import type { DrillHole } from '../../../core/mining/DrillPlan.js';
import { dispatchPendingAction, cancelAction } from '../../../core/engine/TaskDispatch.js';
import { MAX_DRILL_GRID_HOLES } from '../../../core/config/balance.js';
import { claimForAction } from '../siteExpansion.js';

/** Payload carried by a queued `drill_hole` PendingAction (#553). */
export interface DrillHoleActionPayload {
  holeId: string;
  x: number;
  z: number;
  depth: number;
  diameter: number;
  durationTicks: number;
}

/**
 * Drop every per-hole charge/sequence record for `holeId` — called when a
 * hole leaves the plan (drilled or still-ordered branch of drill_plan
 * remove) so no stale charge or delay survives under an id nothing
 * references anymore (#634).
 */
function clearHoleCharges(state: GameState, holeId: string): void {
  delete state.chargesByHole[holeId];
  delete state.plannedChargesByHole[holeId];
  delete state.sequenceDelays[holeId];
}

/**
 * Cancel every outstanding `drill_hole` PendingAction (queued/assigned/
 * in_progress — anything not yet completed) and empty both hole pools
 * (`plannedDrillHoles` and `drillHoles`), plus any per-hole charge/sequence
 * state keyed by hole id (#553). Cancellation is routed through the shared
 * `cancelAction` (#548) so an in-flight employee/vehicle is released back to
 * idle and any order-time cost is refunded — `drill_hole` carries none today
 * (only `survey` charges upfront), so the refund is always 0 in practice.
 * Returns the total number of holes cleared (ordered + drilled).
 */
export function clearDrillPlan(ctx: MiningContext): number {
  const state = ctx.state!;
  const clearedCount = state.drillHoles.length + state.plannedDrillHoles.length;

  for (const action of state.pendingActions.filter(a => a.type === 'drill_hole' || a.type === 'charge_hole')) {
    cancelAction(state, action.id);
  }

  state.plannedDrillHoles = [];
  state.drillHoles = [];
  state.chargesByHole = {};
  state.plannedChargesByHole = {};
  state.sequenceDelays = {};

  return clearedCount;
}

/**
 * Queue a `drill_hole` PendingAction for `hole` — the per-hole dispatch
 * built independently by drill_plan grid's loop and drill_plan add's
 * single-hole path (#790, mirrors charge.ts's dispatchChargeAction #554
 * extraction for charge_hole). Does not touch plannedDrillHoles: grid's
 * caller pushes the hole itself; add's caller already got it pushed by
 * addHole.
 */
function dispatchDrillHoleAction(
  ctx: MiningContext,
  hole: DrillHole,
): void {
  const durationTicks = computeDrillHoleDurationTicks(hole.depth, hole.diameter);
  const actionId = ctx.state!.nextPendingActionId++;
  // skipQualificationCheck (#553, mirrors HaulDispatch.ts's #552
  // syncHaulDispatch): a drill order must queue silently even when nobody
  // on the roster currently holds 'blasting' or a drill_rig licence —
  // rejecting it outright here would make ordering holes depend on
  // hiring order instead of eventually being drillable once qualified.
  dispatchPendingAction(ctx.state!, {
    id: actionId,
    type: 'drill_hole',
    requiredSkill: 'blasting',
    requiredVehicleRole: 'drill_rig',
    targetX: hole.x,
    targetZ: hole.z,
    targetY: 0,
    payload: {
      holeId: hole.id, x: hole.x, z: hole.z, depth: hole.depth, diameter: hole.diameter, durationTicks,
    } satisfies DrillHoleActionPayload,
    targetEmployeeId: null,
  }, { skipQualificationCheck: true });
}

export function drillPlanCommand(
  ctx: MiningContext,
  args: string[],
  named: Record<string, string>,
): CommandResult {
  const preamble = requireGameWithSub(ctx, args);
  if (preamble.error) return preamble.error;
  const sub = preamble.sub;

  if (sub === 'grid') {
    const origin = (named['origin'] ?? named['start'] ?? '0,0').split(',').map(Number);
    const rows = parseInt(named['rows'] ?? '3', 10);
    const cols = parseInt(named['cols'] ?? '3', 10);
    const spacing = parseFloat(named['spacing'] ?? '3');
    const depth = parseFloat(named['depth'] ?? '8');
    const diameter = parseFloat(named['diameter'] ?? '0.15');

    if (!Number.isFinite(rows) || !Number.isFinite(cols) || rows < 1 || cols < 1) {
      return { success: false, output: t('mining.drill_plan.invalid_grid') };
    }
    if (rows * cols > MAX_DRILL_GRID_HOLES) {
      return {
        success: false,
        output: `Drill grid too large: ${rows}×${cols} = ${rows * cols} holes exceeds the ${MAX_DRILL_GRID_HOLES}-hole limit per plan.`,
      };
    }

    resetHoleIds();
    const planned = createGridPlan(
      { x: origin[0] ?? 0, z: origin[1] ?? 0 },
      rows, cols, spacing, depth, diameter,
    );

    // Claim before committing the plan: a grid reaching ground the site
    // cannot have is refused whole, rather than landing half on the map.
    const claim = claimForAction(ctx, planned.map(h => ({ x: h.x, z: h.z })), 'drill');
    if (!claim.ok) {
      resetHoleIds();
      return { success: false, output: claim.output! };
    }

    // A grid replaces the whole plan (#553): drop every hole (ordered or
    // already drilled) and any drill_hole action still outstanding for them
    // first, so resetHoleIds()'s restart-at-H1 above never collides with an
    // id still live in pendingActions/plannedDrillHoles.
    clearDrillPlan(ctx);

    for (const hole of planned) {
      dispatchDrillHoleAction(ctx, hole);
      ctx.state!.plannedDrillHoles.push(hole);
    }

    return {
      success: true,
      output: `Drill plan: ${rows}×${cols} grid, ${ctx.state!.plannedDrillHoles.length} holes ordered, spacing ${spacing}m, depth ${depth}m`,
    };
  }

  if (sub === 'add') {
    const x = parseFloat(named['x'] ?? '0');
    const z = parseFloat(named['z'] ?? named['y'] ?? '0');
    const depth = parseFloat(named['depth'] ?? '8');
    const diameter = parseFloat(named['diameter'] ?? '0.15');
    const claim = claimForAction(ctx, [{ x, z }], 'drill');
    if (!claim.ok) return { success: false, output: claim.output! };

    // Additive — unlike 'grid' above, does not clear the existing plan.
    const hole = addHole(ctx.state!.plannedDrillHoles, x, z, depth, diameter);
    dispatchDrillHoleAction(ctx, hole);

    return { success: true, output: `Added hole ${hole.id} at (${x}, ${z}), depth ${depth}m` };
  }

  if (sub === 'clear') {
    const clearedCount = clearDrillPlan(ctx);
    return { success: true, output: `Cleared drill plan (${clearedCount} holes)` };
  }

  if (sub === 'remove') {
    const state = ctx.state!;
    const holeSpec = named['hole'] ?? '';
    const holeId = resolveHoleId(state, holeSpec);

    if (removeHole(state.drillHoles, holeId)) {
      cancelOutstandingChargeAction(state, holeId);
      clearHoleCharges(state, holeId);
      return { success: true, output: `Removed hole ${holeId}` };
    }

    const plannedIdx = state.plannedDrillHoles.findIndex(h => h.id === holeId);
    if (plannedIdx !== -1) {
      const action = state.pendingActions.find(a => a.type === 'drill_hole' && a.payload['holeId'] === holeId);
      if (action) cancelAction(state, action.id);
      cancelOutstandingChargeAction(state, holeId);
      state.plannedDrillHoles.splice(plannedIdx, 1);
      clearHoleCharges(state, holeId);
      return { success: true, output: `Removed hole ${holeId}` };
    }

    return { success: false, output: `Hole "${holeId}" not found` };
  }

  if (sub === 'show') {
    const state = ctx.state!;
    if (state.drillHoles.length === 0 && state.plannedDrillHoles.length === 0) {
      return { success: true, output: t('mining.drill_plan.none') };
    }
    const orderedLines = state.plannedDrillHoles.map(h =>
      `  ${h.id}: (${h.x}, ${h.z}) depth=${h.depth}m dia=${h.diameter}m [ORDERED]`,
    );
    const drilledLines = state.drillHoles.map(h =>
      `  ${h.id}: (${h.x}, ${h.z}) depth=${h.depth}m dia=${h.diameter}m`,
    );
    const lines = [...orderedLines, ...drilledLines];
    return { success: true, output: `Drill plan (${lines.length} holes):\n${lines.join('\n')}` };
  }

  return { success: false, output: t('mining.drill_plan.usage') };
}
