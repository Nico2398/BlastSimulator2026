// BlastSimulator2026 — Ore rows of a Survey panel result card (#1684)
// One block per ore: name, grade bar, depth, then coverage / typical / peak / yield lines.
// Figures are estimates read from SurveyResult via summarizeSurveyOres, never the grid.

import { t } from '../../core/i18n/I18n.js';
import { el, progressBar } from '../dom.js';
import type { SurveyResult } from '../../core/mining/SurveyCalc.js';
import type { OreAreaSummary } from '../../core/mining/SurveyOreSummary.js';
import { oreDepthLabel } from './surveyDepthSection.js';

/** Compact magnitude: "<1", "850", "1.2k", "3.4M", "2.0B" (suffixes per locale). Never contains a thousands separator. */
function formatCompact(n: number): string {
  if (!(n >= 1)) return t('ui.survey.compact_lt1');
  if (n < 1e3) return String(Math.round(n));
  const units: Array<[number, string]> = [[1e9, 'ui.survey.compact_b'], [1e6, 'ui.survey.compact_m'], [1e3, 'ui.survey.compact_k']];
  for (const [size, key] of units) {
    if (n >= size) return `${(n / size).toFixed(1)}${t(key)}`;
  }
  return String(Math.round(n));
}

const pct = (share: number): number => Math.round(share * 100);

const detailLine = (text: string): HTMLElement =>
  el('span', { text, className: 'bsx-mono', attrs: { style: 'font-size:10px;color:var(--bsx-text-muted)' } });

/** One ore's block: header row (name, bar, depth, typical %) plus its detail lines. */
function makeOreRow(survey: SurveyResult, ore: OreAreaSummary): HTMLElement {
  const typicalPct = pct(ore.typicalGrade);
  const bar = progressBar(typicalPct, 'var(--bsx-ore)');
  bar.style.flex = '1';
  const depth = oreDepthLabel(survey, ore.oreId);

  const head = el('div', {
    attrs: { style: 'display:flex;align-items:center;gap:8px' },
    children: [
      el('span', { text: t(`ore.${ore.oreId}.name`), attrs: { style: 'width:62px;font-size:10px;color:var(--bsx-text-secondary)' } }),
      bar,
      ...(depth ? [detailLine(depth)] : []),
      el('span', { text: `${typicalPct}%`, className: 'bsx-mono', attrs: { style: 'width:28px;text-align:right;font-size:10px;color:var(--bsx-text-muted)' } }),
    ],
  });

  return el('div', {
    attrs: { style: 'display:flex;flex-direction:column;gap:2px' },
    children: [
      head,
      detailLine([
        t('ui.survey.ore_coverage', { pct: pct(ore.coverage) }),
        t('ui.survey.ore_typical', { pct: typicalPct }),
        t('ui.survey.ore_peak', { pct: pct(ore.peakGrade) }),
      ].join(' · ')),
      detailLine(t('ui.survey.ore_yield', {
        tonnes: formatCompact(ore.estimatedTonnes),
        value: formatCompact(ore.estimatedValue),
      })),
    ],
  });
}

/** Ore rows for the given (already ranked) summaries, followed by the estimates footnote. */
export function buildOreRows(survey: SurveyResult, ores: readonly OreAreaSummary[]): HTMLElement {
  return el('div', {
    attrs: { style: 'display:flex;flex-direction:column;gap:5px' },
    children: [
      ...ores.map(ore => makeOreRow(survey, ore)),
      el('span', { text: t('ui.survey.estimates_note'), attrs: { style: 'font:400 10px/1.4 var(--bsx-font-ui);color:var(--bsx-text-muted)' } }),
    ],
  });
}
