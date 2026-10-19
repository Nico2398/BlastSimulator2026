// Buyer tiers for progression-site contracts (#1929). Stubs only.
import type { MarketRange } from './Market.js';
import type { Random } from '../math/Random.js';

export type BuyerTierId = 'local' | 'regional' | 'national' | 'global';

export interface BuyerTier {
  id: BuyerTierId;
  /** i18n key of the tier's display name. */
  nameKey: string;
  /** Mine grade at which the tier starts offering contracts. */
  unlockGrade: number;
  oreSaleQtyKg: MarketRange;
  stepKg: number;
  supplyQtyFactor: number;
  priceFactor: MarketRange;
  /** Relative chance of being picked among unlocked tiers. */
  weight: number;
  /** Reference haul rate (kg per tick) used to size deadlines. */
  refHaulKgPerTick: number;
}

export const BUYER_TIERS: readonly BuyerTier[] = [];

/** Tiers whose unlock grade the mine has reached. */
export function unlockedBuyerTiers(grade: number): readonly BuyerTier[] {
  void grade;
  throw new Error('not implemented');
}

/** Weighted pick among the tiers unlocked at `grade`. */
export function pickBuyerTier(rng: Random, grade: number): BuyerTier {
  void rng; void grade;
  throw new Error('not implemented');
}

/** Supply quantity range for a tier, scaled from the market's base range. */
export function buyerSupplyQtyRange(tier: BuyerTier, base: MarketRange): MarketRange {
  void tier; void base;
  throw new Error('not implemented');
}

/** Deadline range (ticks) that lets `refRate` kg/tick haul `maxQtyKg`. */
export function buyerDeadlineRange(maxQtyKg: number, refRate: number): MarketRange {
  void maxQtyKg; void refRate;
  throw new Error('not implemented');
}

/** Price factor drawn for a tier and contract kind. */
export function buyerPriceFactor(tier: BuyerTier, kind: 'ore_sale' | 'supply', rng: Random): number {
  void tier; void kind; void rng;
  throw new Error('not implemented');
}
