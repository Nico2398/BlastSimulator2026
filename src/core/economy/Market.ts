// BlastSimulator2026 — Market profiles (#1681). Stubs only.

export type MarketId = 'legacy' | 'production';

export interface MarketRange {
  min: number;
  max: number;
}

export interface MarketProfile {
  oreSaleQtyKg: MarketRange;
  supplyQtyKg: MarketRange;
  rubbleQtyKg: MarketRange;
  qtyStepKg: number;
  oreSalePriceFactor: MarketRange;
  supplyPriceFactor: MarketRange;
  rubblePricePerKg: MarketRange;
}

export const MARKETS: Record<MarketId, MarketProfile> = undefined as unknown as Record<MarketId, MarketProfile>;

export function resolveMarket(_id?: MarketId): MarketProfile {
  // TODO: implement
  return undefined as unknown as MarketProfile;
}

/** Value (dollars/kg) of one kg of the ore in the given market. */
export function oreValuePerKg(_oreId: string, _id?: MarketId): number {
  // TODO: implement
  return 0;
}

/** Base contract price (dollars/kg) of the ore in the given market. */
export function oreContractBasePrice(_oreId: string, _id?: MarketId): number {
  // TODO: implement
  return 0;
}
