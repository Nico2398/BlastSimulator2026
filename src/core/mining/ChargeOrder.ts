// BlastSimulator2026 — Charge ordering: queue, fund-check and auto-charge holes (#1345)

import type { GameState, PendingAction } from '../state/GameState.js';
import type { DrillHole } from './DrillPlan.js';
import type { HoleCharge, ChargeError } from './ChargePlan.js';

export type AutoChargeOutcome = 'ordered' | 'awaiting_funds' | 'invalid' | 'skipped';

/** Queue a `charge_hole` action for `hole`, replacing any outstanding order. */
export function dispatchChargeAction(
  _state: GameState,
  _hole: { id: string; x: number; z: number },
  _charge: HoleCharge,
): void {
  // TODO: implement
}

/** Outstanding (queued or claimed) `charge_hole` action for a hole. */
export function findOutstandingChargeAction(_state: GameState, _holeId: string): PendingAction | undefined {
  return undefined;
}

/** Cancel the outstanding charge order of a hole, refunding its cost. */
export function cancelOutstandingChargeAction(_state: GameState, _holeId: string): void {
  // TODO: implement
}

/** Cash shortfall for a set of orders, null when affordable. */
export function chargeFundsFailureAmount(
  _state: GameState,
  _orders: ReadonlyArray<{ holeId: string; explosiveId: string; amountKg: number }>,
): { need: number } | null {
  return null;
}

/** True when the hole is charged or has an outstanding charge order. */
export function isHoleChargeCovered(_state: GameState, _holeId: string): boolean {
  return false;
}

/** Apply the pattern charge to a freshly drilled hole. */
export function autoChargeHole(_state: GameState, _hole: DrillHole): AutoChargeOutcome {
  return 'skipped';
}

/** Retry auto-charges that were waiting for funds. */
export function settleAwaitingFundsCharges(_state: GameState): void {
  // TODO: implement
}

/** Charge a set of holes with the pattern charge. */
export function chargePatternHoles(
  _state: GameState,
  _holes: ReadonlyArray<DrillHole>,
): { ordered: string[]; awaiting: string[]; invalid: ChargeError[] } {
  return { ordered: [], awaiting: [], invalid: [] };
}
