// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  marketTooltipKey, lockedBuyerTiers, makeBuyerBadge, makeMarketStrip, type MarketStripInput,
} from '../../../../src/ui/panels/ContractsMarketStrip.js';
import { BUYER_TIERS, buyerTierNameKey } from '../../../../src/core/economy/BuyerTiers.js';
import { MARKET_HUNGRY_SATURATION, ORE_SATURATION_TOAST_LEVEL } from '../../../../src/core/config/balance.js';
import { t } from '../../../../src/core/i18n/I18n.js';

describe('marketTooltipKey', () => {
  it('is flooded at the toast level', () => {
    expect(marketTooltipKey(ORE_SATURATION_TOAST_LEVEL)).toBe('ui.contracts.market_tip_flooded');
  });

  it('is flooded when fully saturated', () => {
    expect(marketTooltipKey(1)).toBe('ui.contracts.market_tip_flooded');
  });

  it('is hungry at the hungry threshold and when unsold', () => {
    expect(marketTooltipKey(MARKET_HUNGRY_SATURATION)).toBe('ui.contracts.market_tip_hungry');
    expect(marketTooltipKey(0)).toBe('ui.contracts.market_tip_hungry');
  });

  it('is steady strictly between the thresholds', () => {
    expect(marketTooltipKey(0.1000001)).toBe('ui.contracts.market_tip_steady');
    expect(marketTooltipKey(0.3)).toBe('ui.contracts.market_tip_steady');
    expect(marketTooltipKey(0.4999)).toBe('ui.contracts.market_tip_steady');
  });

  it('the thresholds sit where the issue says', () => {
    expect(ORE_SATURATION_TOAST_LEVEL).toBe(0.5);
    expect(MARKET_HUNGRY_SATURATION).toBe(0.1);
  });

  it('every key it returns exists in the locale', () => {
    for (const sat of [0, 0.3, 1]) expect(t(marketTooltipKey(sat))).not.toBe(marketTooltipKey(sat));
  });
});

describe('lockedBuyerTiers', () => {
  const ids = (g: number) => lockedBuyerTiers(g).map(b => b.id);

  it('at grade 0 locks regional, national and global', () => {
    expect(ids(0)).toEqual(['regional', 'national', 'global']);
  });

  it('drops a tier exactly at its unlock grade (boundary)', () => {
    expect(ids(1)).toEqual(['national', 'global']);
    expect(ids(2)).toEqual(['national', 'global']);
    expect(ids(3)).toEqual(['global']);
    expect(ids(4)).toEqual(['global']);
  });

  it('is empty at grade 5 and beyond', () => {
    expect(ids(5)).toEqual([]);
    expect(ids(12)).toEqual([]);
  });

  it('treats a negative grade like grade 0', () => {
    expect(ids(-1)).toEqual(ids(0));
  });

  it('returns the shared tier definitions in ascending unlock order', () => {
    const locked = lockedBuyerTiers(0);
    expect(locked.every(b => BUYER_TIERS.includes(b))).toBe(true);
    expect(locked.map(b => b.unlockGrade)).toEqual([...locked.map(b => b.unlockGrade)].sort((a, b) => a - b));
  });
});

describe('makeBuyerBadge', () => {
  it.each(BUYER_TIERS.map(b => b.id))('labels the %s badge with the tier name', (id) => {
    const badge = makeBuyerBadge(id);
    expect(badge.classList.contains('bs-contract-buyer-badge')).toBe(true);
    expect(badge.dataset['buyerTier']).toBe(id);
    expect(badge.textContent).toBe(t(buyerTierNameKey(id)));
  });
});

describe('makeMarketStrip', () => {
  const input: MarketStripInput = {
    grade: 0,
    ores: ['dirtite', 'rustite'],
    saturation: (ore: string) => (ore === 'dirtite' ? 0.4 : 0),
    basePrice: () => 10,
  };

  it('builds #bs-contract-market with one row per ore', () => {
    const strip = makeMarketStrip(input);
    expect(strip.id).toBe('bs-contract-market');
    expect(Array.from(strip.querySelectorAll<HTMLElement>('.bs-market-row')).map(r => r.dataset['ore']))
      .toEqual(['dirtite', 'rustite']);
  });

  it('reads the trend through the saturation reader', () => {
    const strip = makeMarketStrip(input);
    expect(strip.querySelector<HTMLElement>('[data-ore="dirtite"] .bs-market-trend')!.dataset['trendPct']).toBe('-20');
    expect(strip.querySelector<HTMLElement>('[data-ore="rustite"] .bs-market-trend')!.dataset['trendPct']).toBe('0');
  });

  it('has no rows for no ores but still lists the locked tiers', () => {
    const strip = makeMarketStrip({ ...input, ores: [] });
    expect(strip.querySelectorAll('.bs-market-row')).toHaveLength(0);
    expect(strip.querySelector('.bs-market-locked')).not.toBeNull();
  });

  it('omits the locked row at grade 5', () => {
    expect(makeMarketStrip({ ...input, grade: 5 }).querySelector('.bs-market-locked')).toBeNull();
  });
});
