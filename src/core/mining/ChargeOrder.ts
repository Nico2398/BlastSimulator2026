// BlastSimulator2026 — Charge ordering: queue, fund-check and auto-charge holes (#1345)

import type { GameState, PendingAction } from '../state/GameState.js';
import type { DrillHole } from './DrillPlan.js';
import {
  createCharge, computeChargeHoleDurationTicks, chargeOrderCost,
  type HoleCharge, type ChargeError,
} from './ChargePlan.js';
import { dispatchPendingAction, cancelAction } from '../engine/TaskDispatch.js';
import { addExpense } from '../economy/Finance.js';
import { isExplosiveAvailable } from '../campaign/Level.js';

type AutoChargeOutcome = 'ordered' | 'awaiting_funds' | 'invalid' | 'skipped';

/** Payload carried by a queued `charge_hole` PendingAction (#554). */
export interface ChargeHoleActionPayload {
  holeId: string;
  explosiveId: string;
  amountKg: number;
  stemmingM: number;
  /** Base ticks; scaled by the worker's proficiency at claim time. */
  durationTicks: number;
  /** Cash charged at order time (costPerKg x kg); refunded on cancel (#1341). */
  orderCost: number;
}

/** Outstanding (queued or claimed) `charge_hole` action for a hole. */
function findOutstandingChargeAction(state: GameState, holeId: string): PendingAction | undefined {
  return state.pendingActions.find(a => a.type === 'charge_hole' && a.payload['holeId'] === holeId);
}

/** Cancel the outstanding charge order of a hole, refunding its cost. No-op without one (#554). */
export function cancelOutstandingChargeAction(state: GameState, holeId: string): void {
  const action = findOutstandingChargeAction(state, holeId);
  if (action) cancelAction(state, action.id);
}

/**
 * Queue a `charge_hole` action for `hole`, replacing any outstanding order so a
 * re-charge does not stack (#554). Pays the explosives cost now; the caller has
 * verified funds. Re-charging an already-loaded hole pays in full and does not
 * refund the consumed explosive — intentional default.
 */
export function dispatchChargeAction(
  state: GameState,
  hole: { id: string; x: number; z: number },
  charge: HoleCharge,
): void {
  const { explosiveId, amountKg, stemmingM } = charge;
  cancelOutstandingChargeAction(state, hole.id);

  const durationTicks = computeChargeHoleDurationTicks(amountKg);
  const orderCost = chargeOrderCost(explosiveId, amountKg);
  const actionId = state.nextPendingActionId++;
  // skipQualificationCheck (#554): a charge order must queue silently even
  // when nobody on the roster holds 'blasting' yet.
  dispatchPendingAction(state, {
    id: actionId,
    type: 'charge_hole',
    requiredSkill: 'blasting',
    requiredVehicleRole: null,
    targetX: hole.x,
    targetZ: hole.z,
    targetY: 0,
    payload: {
      holeId: hole.id, explosiveId, amountKg, stemmingM, durationTicks, orderCost,
    } satisfies ChargeHoleActionPayload,
    targetEmployeeId: null,
  }, { skipQualificationCheck: true });

  state.plannedChargesByHole[hole.id] = { explosiveId, amountKg, stemmingM };

  state.cash -= orderCost;
  addExpense(state.finances, orderCost, 'explosives', `Charge ${hole.id}: ${explosiveId} ${amountKg}kg`, state.tickCount);
}

/**
 * Cash shortfall for a set of orders, null when affordable. Each order's cost is
 * net of the refund its hole's outstanding order gives back when replaced; equal
 * cash is allowed.
 */
export function chargeFundsFailureAmount(
  state: GameState,
  orders: ReadonlyArray<{ holeId: string; explosiveId: string; amountKg: number }>,
): { need: number } | null {
  let need = 0;
  for (const o of orders) {
    const outstanding = findOutstandingChargeAction(state, o.holeId);
    const refund = outstanding ? ((outstanding.payload['orderCost'] as number) ?? 0) : 0;
    need += chargeOrderCost(o.explosiveId, o.amountKg) - refund;
  }
  // A replacement costing no more than the refunded order needs no new cash,
  // even when the balance is negative. Sub-cent residue is float noise.
  if (need < 0.005 || need <= state.cash) return null;
  return { need };
}

/** True when the hole is charged or has an outstanding charge order. */
export function isHoleChargeCovered(state: GameState, holeId: string): boolean {
  return state.chargesByHole[holeId] !== undefined || findOutstandingChargeAction(state, holeId) !== undefined;
}

/** Ids of holes with an outstanding charge order, built in one pass over the queue. */
function outstandingChargeHoleIds(state: GameState): Set<string> {
  const ids = new Set<string>();
  for (const a of state.pendingActions) {
    if (a.type === 'charge_hole') ids.add(a.payload['holeId'] as string);
  }
  return ids;
}

/**
 * What replacing the drill plan would lose: drilled holes and charges (loaded or
 * planned). Null when the plan holds only ordered-not-yet-drilled holes, i.e.
 * nothing worth confirming (#1345).
 */
export function planReplacementLoss(
  state: Pick<GameState, 'drillHoles' | 'chargesByHole' | 'plannedChargesByHole'>,
): { drilled: number; charged: number } | null {
  const drilled = state.drillHoles.length;
  const charged = Object.keys(state.chargesByHole).length + Object.keys(state.plannedChargesByHole).length;
  return drilled > 0 || charged > 0 ? { drilled, charged } : null;
}

/**
 * The pattern charge, or null when none is set. Side effect: a pattern whose
 * explosive the level no longer offers is cleared (with its waiting list)
 * rather than returned.
 */
function takePatternOrClearIfUnavailable(state: GameState): HoleCharge | null {
  const pattern = state.patternCharge;
  if (pattern == null) return null;
  if (!isExplosiveAvailable(state.campaign.activeLevelId, pattern.explosiveId)) {
    state.patternCharge = null;
    state.chargeAwaitingFunds = [];
    return null;
  }
  return pattern;
}

/** Drop a hole from the awaiting-funds list. No-op when the list is absent. */
export function removeAwaiting(state: GameState, holeId: string): void {
  if (state.chargeAwaitingFunds == null) return;
  state.chargeAwaitingFunds = state.chargeAwaitingFunds.filter(id => id !== holeId);
}

function addAwaiting(state: GameState, holeId: string): void {
  const list = state.chargeAwaitingFunds ?? [];
  if (!list.includes(holeId)) list.push(holeId);
  state.chargeAwaitingFunds = list;
}

/** Order the pattern charge for one hole, funds checked per hole. Caller guarantees the hole is uncovered. */
function orderPatternCharge(state: GameState, hole: DrillHole, pattern: HoleCharge): AutoChargeOutcome | { error: string } {
  const created = createCharge(pattern.explosiveId, pattern.amountKg, pattern.stemmingM, hole.depth);
  if ('error' in created) {
    removeAwaiting(state, hole.id);
    return { error: created.error };
  }
  const short = chargeFundsFailureAmount(state, [{
    holeId: hole.id, explosiveId: pattern.explosiveId, amountKg: pattern.amountKg,
  }]);
  if (short) {
    addAwaiting(state, hole.id);
    return 'awaiting_funds';
  }
  removeAwaiting(state, hole.id);
  dispatchChargeAction(state, hole, created.charge);
  return 'ordered';
}

/** Apply the pattern charge to a freshly drilled hole. Never throws. */
export function autoChargeHole(state: GameState, hole: DrillHole): AutoChargeOutcome {
  const pattern = takePatternOrClearIfUnavailable(state);
  if (pattern == null || isHoleChargeCovered(state, hole.id)) return 'skipped';
  const outcome = orderPatternCharge(state, hole, pattern);
  return typeof outcome === 'string' ? outcome : 'invalid';
}

/**
 * Retry auto-charges waiting for funds, in id order. Walks only the awaiting
 * list, so a tick with nothing waiting costs nothing.
 */
export function settleAwaitingFundsCharges(state: GameState): void {
  const waiting = state.chargeAwaitingFunds;
  if (waiting == null || waiting.length === 0) return;
  const pattern = takePatternOrClearIfUnavailable(state);
  if (pattern == null) { state.chargeAwaitingFunds = []; return; }
  for (const id of [...waiting].sort()) {
    const hole = state.drillHoles.find(h => h.id === id);
    if (!hole || isHoleChargeCovered(state, id)) { removeAwaiting(state, id); continue; }
    orderPatternCharge(state, hole, pattern);
  }
}

/** Charge a set of holes with the pattern charge, skipping covered ones. */
export function chargePatternHoles(
  state: GameState,
  holes: ReadonlyArray<DrillHole>,
): { ordered: string[]; awaiting: string[]; invalid: ChargeError[] } {
  const result = { ordered: [] as string[], awaiting: [] as string[], invalid: [] as ChargeError[] };
  const pattern = takePatternOrClearIfUnavailable(state);
  if (pattern == null) return result;
  const outstanding = outstandingChargeHoleIds(state);
  for (const hole of holes) {
    if (state.chargesByHole[hole.id] !== undefined || outstanding.has(hole.id)) continue;
    const outcome = orderPatternCharge(state, hole, pattern);
    if (typeof outcome !== 'string') result.invalid.push({ holeId: hole.id, message: outcome.error });
    else if (outcome === 'ordered') result.ordered.push(hole.id);
    else if (outcome === 'awaiting_funds') result.awaiting.push(hole.id);
  }
  return result;
}
