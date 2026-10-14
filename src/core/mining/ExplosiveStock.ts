// BlastSimulator2026 — Bulk explosive stock: buying into warehouses, drawing for charge orders (#1678)

import type { GameState, PendingAction } from '../state/GameState.js';
import { factorFor } from '../events/ActiveModifiers.js';
import { EXPLOSIVE_BULK_PRICE_FACTOR } from '../config/balance.js';
import { getExplosive } from '../world/ExplosiveCatalog.js';
import { isExplosiveAvailable } from '../campaign/Level.js';
import { addExpense, addIncome } from '../economy/Finance.js';
import {
  getExplosivesCapacity, getExplosivesFreeCapacity, getExplosivesInStock, storeExplosives,
} from '../entities/Building.js';

/** Price factor the live event modifiers put on explosives (#1414); 1 when none. */
export function explosivePriceFactor(state: Pick<GameState, 'events' | 'tickCount'>): number {
  return factorFor(state.events.activeModifiers, 'explosive_price', state.tickCount);
}

/** Bulk price per kg of an explosive: catalog cost x EXPLOSIVE_BULK_PRICE_FACTOR x priceFactor. */
export function bulkPricePerKg(explosiveId: string, priceFactor: number): number {
  const explosive = getExplosive(explosiveId);
  return explosive ? explosive.costPerKg * EXPLOSIVE_BULK_PRICE_FACTOR * priceFactor : 0;
}

export type BuyStockFailure =
  | 'invalid_amount' | 'unknown_explosive' | 'not_available'
  | 'no_warehouse' | 'over_capacity' | 'insufficient_funds';

type BuyStockResult =
  | { success: true; kg: number; cost: number; pricePerKg: number; stockKg: number; capacityKg: number }
  | { success: false; reason: BuyStockFailure; freeKg?: number; need?: number };

/** Pure pre-check mirroring buyExplosiveStock's validation order; null when the purchase would succeed (#1685). */
export function buyStockBlockReason(
  state: Pick<GameState, 'buildings' | 'cash' | 'campaign' | 'events' | 'tickCount'>,
  explosiveId: string,
  kg: number,
): BuyStockFailure | null {
  void state; void explosiveId; void kg;
  return null; // TODO: implement
}

/** Buy `kg` of an explosive into warehouse stock, paying bulk price. Refusals mutate nothing. */
export function buyExplosiveStock(state: GameState, explosiveId: string, kg: number): BuyStockResult {
  if (!Number.isInteger(kg) || kg < 1) return { success: false, reason: 'invalid_amount' };
  if (!getExplosive(explosiveId)) return { success: false, reason: 'unknown_explosive' };
  if (!isExplosiveAvailable(state.campaign.activeLevelId, explosiveId)) return { success: false, reason: 'not_available' };
  const capacityKg = getExplosivesCapacity(state.buildings);
  if (capacityKg <= 0) return { success: false, reason: 'no_warehouse' };
  const freeKg = getExplosivesFreeCapacity(state.buildings);
  if (kg > freeKg) return { success: false, reason: 'over_capacity', freeKg };
  const pricePerKg = bulkPricePerKg(explosiveId, explosivePriceFactor(state));
  const cost = kg * pricePerKg;
  if (cost > state.cash) return { success: false, reason: 'insufficient_funds', need: cost };

  storeExplosives(state.buildings, explosiveId, kg);
  state.cash -= cost;
  addExpense(state.finances, cost, 'explosives', `Stock ${explosiveId} ${kg}kg`, state.tickCount);
  return { success: true, kg, cost, pricePerKg, stockKg: getExplosivesInStock(state.buildings), capacityKg };
}

/** Split an order of `kg` into the part served from stock and the part paid in cash. */
export function drawStockForOrder(
  stock: Readonly<Record<string, number>>,
  explosiveId: string,
  kg: number,
): { fromStockKg: number; fromCashKg: number } {
  const fromStockKg = Math.min(kg, Math.max(0, stock[explosiveId] ?? 0));
  return { fromStockKg, fromCashKg: kg - fromStockKg };
}

/** Kg of a charge order served from warehouse stock at order time (#1678). */
export interface OrderStockDraw { explosiveId: string; kg: number }

/** The stock draw recorded on a `charge_hole` action's payload, if any. */
export function readOrderStock(action: Pick<PendingAction, 'payload'>): OrderStockDraw | undefined {
  return action.payload['orderStock'] as OrderStockDraw | undefined;
}

/**
 * Return a cancelled order's stock-drawn kg to warehouses. Kg that no longer fits
 * is refunded in cash at the bulk price instead.
 */
export function returnOrderStock(
  state: GameState,
  explosiveId: string,
  kg: number,
): { restockedKg: number; cashRefund: number } {
  const restockedKg = storeExplosives(state.buildings, explosiveId, kg);
  const lost = kg - restockedKg;
  if (lost <= 0) return { restockedKg, cashRefund: 0 };
  const cashRefund = lost * bulkPricePerKg(explosiveId, explosivePriceFactor(state));
  if (cashRefund > 0) {
    state.cash += cashRefund;
    addIncome(state.finances, cashRefund, 'refund', `Unstorable ${explosiveId} ${lost}kg`, state.tickCount);
  }
  return { restockedKg, cashRefund };
}
