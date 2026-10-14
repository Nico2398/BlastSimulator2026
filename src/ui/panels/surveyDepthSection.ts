// BlastSimulator2026 — Depth lines of a Survey panel result card (#1683)
// Per-ore depth label and the core sample's depth log, read from
// SurveyResult.depthProfile. Old saves have none: every helper then yields nothing.

import { t } from '../../core/i18n/I18n.js';
import { el } from '../dom.js';
import type { SurveyResult } from '../../core/mining/SurveyCalc.js';
import { oreDepthSpan } from '../../core/mining/SurveyDepthProfile.js';
import { surveyColumnKey } from '../../core/mining/SurveyColumn.js';

/** Rows of the depth log shown before it scrolls. */
const DEPTH_LOG_VISIBLE_ROWS = 6;
const ROW_HEIGHT_PX = 14;

/** Depth text for one reported ore: "from-to m", "surface" for aerial, undefined without a profile. */
export function oreDepthLabel(survey: SurveyResult, oreId: string): string | undefined {
  if (survey.method === 'aerial') return t('ui.survey.depth_surface');
  if (!survey.depthProfile) return undefined;
  let fromM = Infinity;
  let toM = -Infinity;
  for (const bands of Object.values(survey.depthProfile)) {
    const span = oreDepthSpan(bands, oreId);
    if (!span) continue;
    fromM = Math.min(fromM, span.fromM);
    toM = Math.max(toM, span.toM);
  }
  return toM === -Infinity ? undefined : t('ui.survey.depth_range', { from: fromM, to: toM });
}

/** Depth log of a core sample's centre column (first profiled column as fallback); null otherwise. */
export function buildDepthLog(survey: SurveyResult): HTMLElement | null {
  if (survey.method !== 'core_sample' || !survey.depthProfile) return null;
  const bands = survey.depthProfile[surveyColumnKey(survey.centerX, survey.centerZ)]
    ?? Object.values(survey.depthProfile)[0];
  if (!bands || bands.length === 0) return null;

  const log = el('div', {
    attrs: { style: `display:flex;flex-direction:column;gap:2px;max-height:${DEPTH_LOG_VISIBLE_ROWS * ROW_HEIGHT_PX}px;overflow-y:auto` },
  });
  for (const band of bands) {
    const ores = Object.entries(band.ores).sort((a, b) => b[1] - a[1])
      .map(([oreId, density]) => `${t(`ore.${oreId}.name`)} ${Math.round(density * 100)}%`).join(', ');
    log.appendChild(el('span', {
      text: `${t('ui.survey.depth_range', { from: band.fromM, to: band.toM })}: ${ores}`,
      className: 'bsx-mono',
      attrs: { style: 'font-size:10px;color:var(--bsx-text-muted)' },
    }));
  }
  return el('div', {
    attrs: { style: 'display:flex;flex-direction:column;gap:3px' },
    children: [
      el('span', { text: t('ui.survey.depth_log_heading'), attrs: { style: 'font:600 10px/1 var(--bsx-font-ui);color:var(--bsx-text-secondary)' } }),
      log,
    ],
  });
}
