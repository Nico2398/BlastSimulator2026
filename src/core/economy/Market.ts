// BlastSimulator2026 — Market profiles (#1681).
//
// A market decides how big the contract board's offers are, what they pay, and
// what one kg of each ore is worth everywhere a value is shown (blast report,
// survey estimates, contracts). 'legacy' is the pre-#1681 board every campaign
// level still runs on; 'production' is the sandbox's, scaled to a crew's costs.

import {
  ORE_PRICES,
  PRODUCTION_ORE_PRICES,
  RUBBLE_DISPOSAL_PRICE_RANGE,
  LEGACY_OFFER_QTY_KG,
  LEGACY_OFFER_QTY_STEP_KG,
  LEGACY_OFFER_DEADLINE_TICKS,
  LEGACY_ORE_SALE_PRICE_FACTOR,
  LEGACY_SUPPLY_PRICE_FACTOR,
  PRODUCTION_ORE_SALE_QTY_KG,
  PRODUCTION_SUPPLY_QTY_KG,
  PRODUCTION_RUBBLE_QTY_KG,
  PRODUCTION_OFFER_QTY_STEP_KG,
  PRODUCTION_ORE_SALE_PRICE_FACTOR,
  PRODUCTION_SUPPLY_PRICE_FACTOR,
  PRODUCTION_RUBBLE_PRICE_PER_KG,
} from '../config/balance.js';
import { getOre } from '../world/OreCatalog.js';

export type MarketId = 'legacy' | 'production';

export interface MarketRange {
  min: number;
  max: number;
}

interface MarketProfile {
  oreSaleQtyKg: MarketRange;
  supplyQtyKg: MarketRange;
  supplyDeadlineTicks: MarketRange;
  rubbleQtyKg: MarketRange;
  qtyStepKg: number;
  oreSalePriceFactor: MarketRange;
  supplyPriceFactor: MarketRange;
  rubblePricePerKg: MarketRange;
}

const MARKETS: Record<MarketId, MarketProfile> = {
  legacy: {
    oreSaleQtyKg: LEGACY_OFFER_QTY_KG,
    supplyQtyKg: LEGACY_OFFER_QTY_KG,
    supplyDeadlineTicks: LEGACY_OFFER_DEADLINE_TICKS,
    rubbleQtyKg: LEGACY_OFFER_QTY_KG,
    qtyStepKg: LEGACY_OFFER_QTY_STEP_KG,
    oreSalePriceFactor: LEGACY_ORE_SALE_PRICE_FACTOR,
    supplyPriceFactor: LEGACY_SUPPLY_PRICE_FACTOR,
    rubblePricePerKg: RUBBLE_DISPOSAL_PRICE_RANGE,
  },
  production: {
    oreSaleQtyKg: PRODUCTION_ORE_SALE_QTY_KG,
    supplyQtyKg: PRODUCTION_SUPPLY_QTY_KG,
    supplyDeadlineTicks: LEGACY_OFFER_DEADLINE_TICKS, // stub until PRODUCTION_SUPPLY_DEADLINE_TICKS is wired
    rubbleQtyKg: PRODUCTION_RUBBLE_QTY_KG,
    qtyStepKg: PRODUCTION_OFFER_QTY_STEP_KG,
    oreSalePriceFactor: PRODUCTION_ORE_SALE_PRICE_FACTOR,
    supplyPriceFactor: PRODUCTION_SUPPLY_PRICE_FACTOR,
    rubblePricePerKg: PRODUCTION_RUBBLE_PRICE_PER_KG,
  },
};

/** Profile of a market; omitted = 'legacy'. */
export function resolveMarket(id: MarketId = 'legacy'): MarketProfile {
  return MARKETS[id];
}

/** Value (dollars/kg) of one kg of the ore in the given market. Unknown ores are worth 0 in legacy (no catalog entry), the cheapest ore's price in production. */
export function oreValuePerKg(oreId: string, id: MarketId = 'legacy'): number {
  if (id === 'production') return PRODUCTION_ORE_PRICES[oreId] ?? PRODUCTION_ORE_PRICES['dirtite']!;
  return getOre(oreId)?.valuePerKg ?? 0;
}

/** Base contract price (dollars/kg) of the ore in the given market; legacy falls back to 10 for an unpriced ore. */
export function oreContractBasePrice(oreId: string, id: MarketId = 'legacy'): number {
  if (id === 'production') return oreValuePerKg(oreId, id);
  return (ORE_PRICES as Record<string, number>)[oreId] ?? 10;
}
