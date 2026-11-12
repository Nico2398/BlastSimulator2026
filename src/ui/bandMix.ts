// BlastSimulator2026 — Band mix and powder factor readouts (#2203)
// One rendering of "how this rock fragments" shared by the Charge step's explosive cards and
// hole rows and by the heatmap hover tag, so all three show the same numbers the same way.

import { t } from '../core/i18n/I18n.js';
import { FRAGMENTATION_BANDS, FRAGMENTATION_BAND_COLORS } from '../core/mining/FragmentationBand.js';
import type { BandShares, PowderFactorRange } from '../core/mining/SoftwarePreview.js';
import { el } from './dom.js';

const PERCENT = 100;

function cssColor(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

/** "Intact 10% · Cracked 20% · Coarse 5% · Good 40% · …" — every band, whole percents. */
function bandMixText(shares: BandShares): string {
  return FRAGMENTATION_BANDS
    .map(b => `${t(`blast.band.${b}`)} ${Math.round((shares[b] ?? 0) * PERCENT)}%`)
    .join(' · ');
}

/** Stacked colour bar plus the text of the mix; `role` lands in `data-role` for tests and scenarios. */
export function bandMixEl(shares: BandShares, role: string): HTMLElement {
  const bar = el('div', { attrs: { style: 'display:flex;height:5px;border-radius:2px;overflow:hidden;width:100%' } });
  for (const b of FRAGMENTATION_BANDS) {
    if (!(shares[b] > 0)) continue;
    bar.appendChild(el('span', { attrs: { style: `flex:${shares[b]};background:${cssColor(FRAGMENTATION_BAND_COLORS[b])}` } }));
  }
  const wrap = el('div', {
    attrs: { 'data-role': role, 'data-good-share': shares.good.toFixed(3), style: 'display:flex;flex-direction:column;gap:3px;width:100%' },
  });
  wrap.append(bar, el('span', { text: bandMixText(shares), attrs: { style: 'font:400 9px/1.2 var(--bsx-font-mono);color:var(--bsx-text-micro)' } }));
  return wrap;
}

/** "0.45 kg/m³". */
export function powderFactorText(kgPerM3: number): string {
  return t('ui.blast_workshop.charge.powder_factor', { value: kgPerM3.toFixed(2) });
}

/** The recommended powder-factor range, or the sentence saying no tested charge of the explosive fragments the rock well. */
export function recommendedRangeText(range: PowderFactorRange | null): string {
  if (!range) return t('ui.blast_workshop.charge.recommended_none');
  return t('ui.blast_workshop.charge.recommended', {
    pf: spanText(range.minKgPerM3.toFixed(2), range.maxKgPerM3.toFixed(2)),
    stemming: spanText(range.minStemmingM.toFixed(1), range.maxStemmingM.toFixed(1)),
  });
}

/** "a–b", or just "a" when the two ends read the same (a range of one sample). */
function spanText(lo: string, hi: string): string {
  return lo === hi ? lo : `${lo}–${hi}`;
}
