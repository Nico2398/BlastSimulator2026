// BlastSimulator2026 — Charge loading: explosives are bought as each hole is loaded, at list price (#2153)

import type { GameState, PendingAction } from '../state/GameState.js';
import { factorFor } from '../events/ActiveModifiers.js';
import { addExpense } from '../economy/Finance.js';
import { chargeOrderCost } from './ChargePlan.js';

/** Price factor the live event modifiers put on explosives (#1414); 1 when none. */
export function explosivePriceFactor(state: Pick<GameState, 'events' | 'tickCount'>): number {
  return factorFor(state.events.activeModifiers, 'explosive_price', state.tickCount);
}

/** Cash cost of loading `amountKg` into a hole now: list price x event factor; pure. */
export function quoteChargeLoad(
  state: Pick<GameState, 'events' | 'tickCount'>,
  explosiveId: string,
  amountKg: number,
): { cost: number } {
  return { cost: chargeOrderCost(explosiveId, amountKg) * explosivePriceFactor(state) };
}

/** True when current cash covers the load. */
export function canAffordChargeLoad(
  state: Pick<GameState, 'events' | 'tickCount' | 'cash'>,
  explosiveId: string,
  amountKg: number,
): boolean {
  const { cost } = quoteChargeLoad(state, explosiveId, amountKg);
  return cost < 0.005 || cost <= state.cash;
}

/** Load time: pay list price from cash and book the 'explosives' expense. */
export function loadChargeExplosive(state: GameState, explosiveId: string, amountKg: number): { cost: number } {
  const { cost } = quoteChargeLoad(state, explosiveId, amountKg);
  if (cost > 0) {
    state.cash -= cost;
    addExpense(state.finances, cost, 'explosives', `Charge ${explosiveId} ${amountKg}kg`, state.tickCount);
  }
  return { cost };
}

/** True for a `charge_hole` order whose cost cash cannot cover at fill time. */
export function isChargeUnaffordable(
  state: Pick<GameState, 'events' | 'tickCount' | 'cash'>,
  action: Pick<PendingAction, 'type' | 'payload'>,
): boolean {
  if (action.type !== 'charge_hole') return false;
  const { explosiveId, amountKg } = action.payload;
  if (typeof explosiveId !== 'string' || typeof amountKg !== 'number') return false;
  return !canAffordChargeLoad(state, explosiveId, amountKg);
}
