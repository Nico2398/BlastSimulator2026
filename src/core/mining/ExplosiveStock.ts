// BlastSimulator2026 — Bulk explosive stock: buying into warehouses, drawing for charge orders (#1678)

import type { GameState, PendingAction } from '../state/GameState.js';
import { factorFor } from '../events/ActiveModifiers.js';
import { EXPLOSIVE_BULK_PRICE_FACTOR, EXPLOSIVE_DELIVERY_TICKS } from '../config/balance.js';
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

/** Delivery wait in ticks for the part of an order bought with cash (#1895); 0 when nothing is bought. */
export function orderDeliveryTicks(fromCashKg: number): number {
  return fromCashKg > 0 ? EXPLOSIVE_DELIVERY_TICKS : 0;
}

/** Delivery arrival tick recorded on a charge action's payload, if any (#1895). */
export function readOrderDeliveryTick(action: Pick<PendingAction, 'payload'>): number | undefined {
  const tick = action.payload['deliveryArrivalTick'];
  return typeof tick === 'number' ? tick : undefined;
}

/** True while a charge order's cash-bought explosives have not arrived yet (#1895). */
export function isChargeDeliveryPending(action: Pick<PendingAction, 'type' | 'payload'>, tickCount: number): boolean {
  if (action.type !== 'charge_hole') return false;
  const arrival = readOrderDeliveryTick(action);
  return arrival !== undefined && tickCount < arrival;
}

/** Earliest delivery tick of a still-waiting charge order, or null when none is in transit (#1895). */
export function earliestChargeDeliveryTick(state: Pick<GameState, 'pendingActions' | 'tickCount'>): number | null {
  let earliest: number | null = null;
  for (const a of state.pendingActions) {
    if (!isChargeDeliveryPending(a, state.tickCount)) continue;
    const arrival = readOrderDeliveryTick(a) as number;
    if (earliest === null || arrival < earliest) earliest = arrival;
  }
  return earliest;
}

/** Maps each hole with a still-in-transit charge order to its delivery arrival tick (#1966). */
export function chargeDeliveryArrivalByHole(state: Pick<GameState, 'pendingActions' | 'tickCount'>): Map<string, number> {
  const byHole = new Map<string, number>();
  for (const a of state.pendingActions) {
    if (!isChargeDeliveryPending(a, state.tickCount)) continue;
    const holeId = a.payload['holeId'];
    const arrival = readOrderDeliveryTick(a);
    if (typeof holeId !== 'string' || arrival === undefined) continue;
    byHole.set(holeId, arrival);
  }
  return byHole;
}
