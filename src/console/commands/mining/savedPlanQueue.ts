// BlastSimulator2026 — Queue a saved blast plan as drill/charge orders

import type { CommandResult } from '../../ConsoleRunner.js';
import type { SavedBlastPlan } from '../../../core/state/GameState.js';
import { t } from '../../../core/i18n/I18n.js';
import { addHole } from '../../../core/mining/DrillPlan.js';
import { createCharge, chargeOrderCost } from '../../../core/mining/ChargePlan.js';
import { formatMoney } from '../../../core/economy/formatMoney.js';
import { claimForAction } from '../siteExpansion.js';
import type { MiningContext } from './types.js';
import { dispatchDrillHoleAction } from './drillPlan.js';
import { chargeFundsFailure, levelExplosiveFailure } from './charge.js';
import { dispatchChargeAction } from '../../../core/mining/ChargeOrder.js';

/**
 * Queue the saved plan's holes as drill_hole orders and its charges as
 * charge_hole orders. All-or-nothing on funds; holes already at the same
 * x,z are skipped.
 */
export function queueSavedBlastPlan(ctx: MiningContext, saved: SavedBlastPlan, name: string): CommandResult {
  const state = ctx.state!;

  // Read-only pre-checks: nothing below the "commit" marker runs unless all pass.
  const live = [...state.drillHoles, ...state.plannedDrillHoles];
  const fresh = saved.drillHoles.filter(h => !live.some(l => l.x === h.x && l.z === h.z));
  const skipped = saved.drillHoles.length - fresh.length;
  if (fresh.length === 0) {
    return { success: true, output: t('mining.blast_plan.load_nothing_new', { name }) };
  }

  const chargeOrders: Array<{ oldHoleId: string; explosiveId: string; amountKg: number; stemmingM: number }> = [];
  for (const h of fresh) {
    const c = saved.chargesByHole[h.id];
    if (!c) continue;
    const notOffered = levelExplosiveFailure(state.campaign.activeLevelId, c.explosiveId);
    if (notOffered) return { success: false, output: `${h.id}: ${notOffered.output}` };
    const result = createCharge(c.explosiveId, c.amountKg, c.stemmingM, h.depth);
    if ('error' in result) return { success: false, output: result.error };
    chargeOrders.push({ oldHoleId: h.id, ...c });
  }
  const broke = chargeFundsFailure(state, chargeOrders.map(o => ({
    holeId: o.oldHoleId, explosiveId: o.explosiveId, amountKg: o.amountKg,
  })));
  if (broke) return broke;

  const claim = claimForAction(ctx, fresh.map(h => ({ x: h.x, z: h.z })), 'drill');
  if (!claim.ok) return { success: false, output: claim.output! };

  // Commit.
  const idMap = new Map<string, string>();
  for (const h of fresh) {
    const hole = addHole(state, state.plannedDrillHoles, h.x, h.z, h.depth, h.diameter, state.drillHoles);
    idMap.set(h.id, hole.id);
    dispatchDrillHoleAction(ctx, hole);
  }
  let cost = 0;
  for (const o of chargeOrders) {
    const newId = idMap.get(o.oldHoleId)!;
    const hole = state.plannedDrillHoles.find(h => h.id === newId)!;
    dispatchChargeAction(state, hole, { explosiveId: o.explosiveId, amountKg: o.amountKg, stemmingM: o.stemmingM });
    cost += chargeOrderCost(o.explosiveId, o.amountKg);
  }

  return {
    success: true,
    output: t('mining.blast_plan.loaded', {
      name, holes: fresh.length, charges: chargeOrders.length, cost: formatMoney(cost), skipped,
    }),
  };
}
