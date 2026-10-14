// BlastSimulator2026 — Bulk explosive stock: buying into warehouses, drawing for charge orders (#1678)

import type { GameState } from '../state/GameState.js';

/** Price factor the live event modifiers put on explosives (#1414); 1 when none. */
export function explosivePriceFactor(_state: Pick<GameState, 'events' | 'tickCount'>): number {
  // TODO: implement (moved from ChargeOrder.ts)
  return 1;
}

/** Bulk price per kg of an explosive: catalog cost x EXPLOSIVE_BULK_PRICE_FACTOR x priceFactor. */
export function bulkPricePerKg(_explosiveId: string, _priceFactor: number): number {
  // TODO: implement
  return 0;
}

export type BuyStockFailure =
  | 'invalid_amount' | 'unknown_explosive' | 'not_available'
  | 'no_warehouse' | 'over_capacity' | 'insufficient_funds';

export type BuyStockResult =
  | { success: true; kg: number; cost: number; pricePerKg: number; stockKg: number; capacityKg: number }
  | { success: false; reason: BuyStockFailure; freeKg?: number; need?: number };

/** Buy `kg` of an explosive into warehouse stock, paying bulk price. */
export function buyExplosiveStock(_state: GameState, _explosiveId: string, _kg: number): BuyStockResult {
  // TODO: implement
  return { success: false, reason: 'invalid_amount' };
}

/** Split an order of `kg` into the part served from stock and the part paid in cash. */
export function drawStockForOrder(
  _stock: Readonly<Record<string, number>>,
  _explosiveId: string,
  _kg: number,
): { fromStockKg: number; fromCashKg: number } {
  // TODO: implement
  return { fromStockKg: 0, fromCashKg: 0 };
}

/** Return a cancelled order's stock-drawn kg to warehouses; returns cash refunded for the part that does not fit. */
export function returnOrderStock(_state: GameState, _explosiveId: string, _kg: number): number {
  // TODO: implement
  return 0;
}
