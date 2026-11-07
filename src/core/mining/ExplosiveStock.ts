// BlastSimulator2026 — Bulk explosive stock: buying into warehouses, drawing for charge orders (#1678)

import type { GameState, PendingAction } from '../state/GameState.js';
import { factorFor } from '../events/ActiveModifiers.js';
import { EXPLOSIVE_BULK_PRICE_FACTOR } from '../config/balance.js';
import { getExplosive } from '../world/ExplosiveCatalog.js';
import { isExplosiveAvailable } from '../campaign/Level.js';
import { addExpense } from '../economy/Finance.js';
import { chargeOrderCost } from './ChargePlan.js';
import {
  getExplosivesCapacity, getExplosivesFreeCapacity, getExplosivesInStock, getExplosivesStockByType, consumeExplosives, storeExplosives,
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
  if (!Number.isInteger(kg) || kg < 1) return 'invalid_amount';
  if (!getExplosive(explosiveId)) return 'unknown_explosive';
  if (!isExplosiveAvailable(state.campaign.activeLevelId, explosiveId)) return 'not_available';
  if (getExplosivesCapacity(state.buildings) <= 0) return 'no_warehouse';
  if (kg > getExplosivesFreeCapacity(state.buildings)) return 'over_capacity';
  if (kg * bulkPricePerKg(explosiveId, explosivePriceFactor(state)) > state.cash) return 'insufficient_funds';
  return null;
}

/** Buy `kg` of an explosive into warehouse stock, paying bulk price. Refusals mutate nothing. */
export function buyExplosiveStock(state: GameState, explosiveId: string, kg: number): BuyStockResult {
  const reason = buyStockBlockReason(state, explosiveId, kg);
  if (reason === 'over_capacity') return { success: false, reason, freeKg: getExplosivesFreeCapacity(state.buildings) };
  if (reason === 'insufficient_funds') return { success: false, reason, need: kg * bulkPricePerKg(explosiveId, explosivePriceFactor(state)) };
  if (reason) return { success: false, reason };

  const capacityKg = getExplosivesCapacity(state.buildings);
  const pricePerKg = bulkPricePerKg(explosiveId, explosivePriceFactor(state));
  const cost = kg * pricePerKg;

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

/** Like drawStockForOrder, but depletes `pool` in place so the next order in a batch sees what is left. */
export function drawFromStockPool(
  pool: Record<string, number>,
  explosiveId: string,
  kg: number,
): { fromStockKg: number; fromCashKg: number } {
  const draw = drawStockForOrder(pool, explosiveId, kg);
  pool[explosiveId] = (pool[explosiveId] ?? 0) - draw.fromStockKg;
  return draw;
}

/** Stock/cash split and cash cost of loading `amountKg` into a hole now (#2143); pure. */
export function quoteChargeLoad(
  state: Pick<GameState, 'buildings' | 'events' | 'tickCount'>,
  explosiveId: string,
  amountKg: number,
): { fromStockKg: number; fromCashKg: number; cost: number } {
  const { fromStockKg, fromCashKg } = drawStockForOrder(getExplosivesStockByType(state.buildings), explosiveId, amountKg);
  const cost = chargeOrderCost(explosiveId, fromCashKg) * explosivePriceFactor(state);
  return { fromStockKg, fromCashKg, cost };
}

/** True when the cash part of loading `amountKg` is covered by current cash (#2143). */
export function canAffordChargeLoad(
  state: Pick<GameState, 'buildings' | 'events' | 'tickCount' | 'cash'>,
  explosiveId: string,
  amountKg: number,
): boolean {
  const { cost } = quoteChargeLoad(state, explosiveId, amountKg);
  return cost < 0.005 || cost <= state.cash;
}

/** Load time: draw warehouse stock first, pay the rest in cash, book the 'explosives' expense (#2143). */
export function loadChargeExplosive(
  state: GameState,
  explosiveId: string,
  amountKg: number,
): { fromStockKg: number; cost: number } {
  const { fromStockKg, cost } = quoteChargeLoad(state, explosiveId, amountKg);
  if (fromStockKg > 0) consumeExplosives(state.buildings, explosiveId, fromStockKg);
  if (cost > 0) {
    state.cash -= cost;
    addExpense(state.finances, cost, 'explosives', `Charge ${explosiveId} ${amountKg}kg`, state.tickCount);
  }
  return { fromStockKg, cost };
}

/** True for a `charge_hole` order whose cash part cash cannot cover at fill time (#2143). */
export function isChargeUnaffordable(
  state: Pick<GameState, 'buildings' | 'events' | 'tickCount' | 'cash'>,
  action: Pick<PendingAction, 'type' | 'payload'>,
): boolean {
  if (action.type !== 'charge_hole') return false;
  const { explosiveId, amountKg } = action.payload;
  if (typeof explosiveId !== 'string' || typeof amountKg !== 'number') return false;
  return !canAffordChargeLoad(state, explosiveId, amountKg);
}
