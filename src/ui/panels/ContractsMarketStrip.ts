// Contracts panel market strip (#1931): per-ore price trend and saturation, locked buyer tiers, buyer badge.
import { BUYER_TIERS, buyerTierNameKey, type BuyerTier, type BuyerTierId } from '../../core/economy/BuyerTiers.js';
import { oreSaturationTrend, type SaturationReader } from '../../core/economy/OreSaturation.js';
import { gradeDef } from '../../core/economy/MineGrade.js';
import { MARKET_HUNGRY_SATURATION, ORE_SATURATION_TOAST_LEVEL } from '../../core/config/balance.js';
import { t } from '../../core/i18n/I18n.js';
import { el, card, progressBar } from '../dom.js';
import { iconEl, type IconName } from '../icons.js';

export interface MarketStripInput {
  grade: number;
  ores: readonly string[];
  saturation: SaturationReader;
  basePrice: (oreId: string) => number;
}

const TIER_BADGE: Record<BuyerTierId, { color: string; icon: IconName }> = {
  local: { color: 'var(--bsx-text-secondary)', icon: 'storage' },
  regional: { color: 'var(--bsx-amber)', icon: 'map' },
  national: { color: 'var(--bsx-positive)', icon: 'finance' },
  global: { color: 'var(--bsx-info)', icon: 'star' },
};

export function makeBuyerBadge(tier: BuyerTierId): HTMLElement {
  const name = t(buyerTierNameKey(tier));
  const aria = t('ui.contracts.buyer_badge_aria', { buyer: name });
  const { color, icon } = TIER_BADGE[tier];
  return el('span', {
    className: 'bs-contract-buyer-badge',
    text: name,
    attrs: {
      'data-buyer-tier': tier, title: aria, 'aria-label': aria,
      style: `display:inline-flex;align-items:center;gap:4px;padding:2px 6px;border-radius:3px;background:rgba(255,255,255,.06);font:600 9px/1 var(--bsx-font-ui);color:${color}`,
    },
    children: [iconEl(icon, 10)],
  });
}

export function lockedBuyerTiers(grade: number): readonly BuyerTier[] {
  return BUYER_TIERS.filter(b => b.unlockGrade > grade);
}

export function marketTooltipKey(sat: number): string {
  if (sat >= ORE_SATURATION_TOAST_LEVEL) return 'ui.contracts.market_tip_flooded';
  if (sat <= MARKET_HUNGRY_SATURATION) return 'ui.contracts.market_tip_hungry';
  return 'ui.contracts.market_tip_steady';
}

function trendArrow(pct: number): string {
  return pct < 0 ? '▼' : pct > 0 ? '▲' : '–';
}

function makeOreRow(oreId: string, sat: number, basePrice: number): HTMLElement {
  const { pct } = oreSaturationTrend(oreId, sat, basePrice);
  const signed = pct > 0 ? `+${pct}` : `${pct === 0 ? 0 : pct}`;
  const trendColor = pct < 0 ? 'var(--bsx-critical-text)' : pct > 0 ? 'var(--bsx-positive)' : 'var(--bsx-text-micro)';
  const satBox = el('div', { className: 'bs-market-sat', children: [progressBar(sat * 100, sat >= ORE_SATURATION_TOAST_LEVEL ? 'var(--bsx-critical-text)' : 'var(--bsx-amber)')] });
  satBox.style.cssText = 'flex:1;min-width:40px';
  return el('div', {
    className: 'bs-market-row',
    attrs: { 'data-ore': oreId, title: t(marketTooltipKey(sat)), style: 'display:flex;align-items:center;gap:8px' },
    children: [
      el('span', { text: t(`ore.${oreId}.name`), attrs: { style: 'font:500 10px/1 var(--bsx-font-ui);color:var(--bsx-text-secondary);min-width:70px' } }),
      el('span', {
        className: 'bs-market-trend',
        text: `${trendArrow(pct)} ${t('ui.contracts.market_trend', { pct: signed })}`,
        attrs: { 'data-trend-pct': String(pct), style: `font:600 10px/1 var(--bsx-font-mono);color:${trendColor};min-width:90px` },
      }),
      satBox,
    ],
  });
}

/** Empty ore list yields an empty strip; the caller skips it. */
export function makeMarketStrip(input: MarketStripInput): HTMLElement {
  const rows = input.ores.map(o => makeOreRow(o, input.saturation(o), input.basePrice(o)));
  const locked = lockedBuyerTiers(input.grade);
  const kids: HTMLElement[] = [
    el('span', { text: t('ui.contracts.market_title'), attrs: { style: 'font:600 10px/1 var(--bsx-font-ui);letter-spacing:.14em;color:var(--bsx-text-micro)' } }),
    ...rows,
  ];
  if (locked.length > 0) {
    const text = locked.map(b => {
      const def = gradeDef(b.unlockGrade);
      return t('ui.contracts.locked_tier', { buyer: t(b.nameKey), grade: t(def.nameKey, def.nameParams) });
    }).join(' · ');
    kids.push(el('div', {
      className: 'bs-market-locked', text, attrs: { title: t('ui.contracts.locked_tiers_title'), style: 'font:400 10px/1.3 var(--bsx-font-ui);color:var(--bsx-text-micro)' },
      children: [iconEl('lock', 10)],
    }));
  }
  const body = el('div', { children: kids });
  body.style.cssText = 'display:flex;flex-direction:column;gap:6px';
  const strip = card([body]);
  strip.id = 'bs-contract-market';
  return strip;
}
