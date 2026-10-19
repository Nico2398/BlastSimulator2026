// Buyer tiers for progression-site contracts (#1929): who posts an offer, how big and how rich.
import type { MarketRange } from './Market.js';
import type { Random } from '../math/Random.js';
import { registerUnlockLine } from './MineGrade.js';
import {
  BUYER_SUPPLY_QTY_FACTOR, BUYER_TIER_WEIGHT, BUYER_REF_HAUL_KG_PER_TICK,
  BUYER_DEADLINE_MARGIN, BUYER_DEADLINE_SPAN_RATIO, BUYER_SUPPLY_DISCOUNT,
  BUYER_UNLOCK_GRADE, BUYER_ORE_SALE_QTY_KG, BUYER_QTY_STEP_KG, BUYER_PRICE_FACTOR,
} from '../config/balance.js';

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

function tier(id: BuyerTierId): BuyerTier {
  return {
    id, nameKey: `economy.buyer.${id}`, unlockGrade: BUYER_UNLOCK_GRADE[id], oreSaleQtyKg: BUYER_ORE_SALE_QTY_KG[id],
    stepKg: BUYER_QTY_STEP_KG[id], priceFactor: BUYER_PRICE_FACTOR[id], supplyQtyFactor: BUYER_SUPPLY_QTY_FACTOR[id],
    weight: BUYER_TIER_WEIGHT[id], refHaulKgPerTick: BUYER_REF_HAUL_KG_PER_TICK[id],
  };
}

/** Ascending unlock grade. */
export const BUYER_TIERS: readonly BuyerTier[] = (['local', 'regional', 'national', 'global'] as const).map(tier);

/** i18n key of a tier's display name. */
export function buyerTierNameKey(id: BuyerTierId): string {
  return BUYER_TIERS.find(t => t.id === id)!.nameKey;
}

for (const t of BUYER_TIERS) {
  if (t.unlockGrade > 0) registerUnlockLine({ grade: t.unlockGrade, key: `progression.unlock.buyer.${t.id}` });
}

/** Tiers whose unlock grade the mine has reached. */
export function unlockedBuyerTiers(grade: number): readonly BuyerTier[] {
  return BUYER_TIERS.filter(t => t.unlockGrade <= grade);
}

/** Weighted pick among the tiers unlocked at `grade`; one rng draw. */
export function pickBuyerTier(rng: Random, grade: number): BuyerTier {
  const unlocked = unlockedBuyerTiers(grade);
  const total = unlocked.reduce((sum, t) => sum + t.weight, 0);
  let roll = rng.nextFloat(0, 1) * total;
  for (const t of unlocked) {
    roll -= t.weight;
    if (roll < 0) return t;
  }
  return unlocked[unlocked.length - 1]!;
}

/** Supply quantity range for a tier, scaled from the market's base range. */
export function buyerSupplyQtyRange(tier: BuyerTier, base: MarketRange): MarketRange {
  return { min: base.min * tier.supplyQtyFactor, max: base.max * tier.supplyQtyFactor };
}

/** Deadline range (ticks) that lets `refRate` kg/tick haul `maxQtyKg`. */
export function buyerDeadlineRange(maxQtyKg: number, refRate: number): MarketRange {
  const min = Math.ceil(BUYER_DEADLINE_MARGIN * maxQtyKg / refRate);
  return { min, max: Math.round(min * BUYER_DEADLINE_SPAN_RATIO) };
}

/** Price factor drawn for a tier and contract kind; supply deals are discounted. */
export function buyerPriceFactor(tier: BuyerTier, kind: 'ore_sale' | 'supply', rng: Random): number {
  const roll = rng.nextFloat(tier.priceFactor.min, tier.priceFactor.max);
  return kind === 'supply' ? roll * BUYER_SUPPLY_DISCOUNT : roll;
}
