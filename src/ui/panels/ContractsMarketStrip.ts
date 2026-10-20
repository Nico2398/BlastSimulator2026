import type { BuyerTier, BuyerTierId } from '../../core/economy/BuyerTiers';
import type { SaturationReader } from '../../core/economy/OreSaturation';

export interface MarketStripInput {
  grade: number;
  ores: readonly string[];
  saturation: SaturationReader;
  basePrice: (oreId: string) => number;
}

export function makeBuyerBadge(_tier: BuyerTierId): HTMLElement {
  // TODO: implement
  return undefined as unknown as HTMLElement;
}

export function makeMarketStrip(_input: MarketStripInput): HTMLElement {
  // TODO: implement
  return undefined as unknown as HTMLElement;
}

export function lockedBuyerTiers(_grade: number): readonly BuyerTier[] {
  // TODO: implement
  return [];
}

export function marketTooltipKey(_sat: number): string {
  // TODO: implement
  return '';
}
