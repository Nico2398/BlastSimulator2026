// BlastSimulator2026 — Explanation texts for the Blast Workshop and the blast report (#2168)
//
// What a hole-status chip, a drill setting, the stemming field and a blast-report stat do
// to the shot, translated through t(); every number is read from balance.ts or the core
// function that applies it. Callers attach the text with explainable() / chip().

import { t } from '../core/i18n/I18n.js';
import { PROJECTION_SPEED_THRESHOLD, STEMMING_FULL_DEPTH_FRACTION, STEMMING_MIN_EFFICIENCY } from '../core/config/balance.js';
import { wetFizzlePercent } from '../core/mining/WetHoles.js';

export type HoleStatusKind = 'wet' | 'tubed' | 'dry' | 'ordered' | 'buried';
export type DrillFieldKind = 'spacing' | 'burden' | 'depth' | 'diameter';
export type ReportStatKind = 'cleared' | 'cracked' | 'fragments' | 'volume' | 'projections';

/** What a hole's status chip means for the charge in it. */
export function holeStatusExplain(kind: HoleStatusKind): string {
  return t(`ui.explain.hole_status_${kind}`, { percent: wetFizzlePercent() });
}

/** What changing a drill setting does to the pattern. */
export function drillFieldExplain(field: DrillFieldKind): string {
  return t(`ui.explain.drill_field_${field}`);
}

/** What the stemming column does to the shot. */
export function stemmingExplain(): string {
  return t('ui.explain.stemming', {
    fullPct: Math.round(STEMMING_FULL_DEPTH_FRACTION * 100),
    minPct: Math.round(STEMMING_MIN_EFFICIENCY * 100),
  });
}

/** What a blast-report stat counts and what it says about the shot. */
export function reportStatExplain(stat: ReportStatKind): string {
  return t(`ui.explain.report_stat_${stat}`, { speed: PROJECTION_SPEED_THRESHOLD });
}
