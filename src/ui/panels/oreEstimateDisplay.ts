// BlastSimulator2026 — How the EST. ORE VALUE reads given survey coverage (#1960)

import { t } from '../../core/i18n/I18n.js';
import { formatMoney } from '../../core/economy/formatMoney.js';
import type { BlastOreEstimate } from '../../core/mining/BlastValueEstimate.js';

type OreEstimateView =
  | { kind: 'unknown' }
  | { kind: 'neutral' }
  | { kind: 'partial'; sharePct: number }
  | { kind: 'full' };

/** Classify survey coverage (0..1 of the broken volume) into the state the estimate shows. */
export function oreEstimateView(
  e: Pick<BlastOreEstimate, 'coverage' | 'brokenVoxels' | 'charged' | 'holeCoverage'>,
): OreEstimateView {
  const coverage = e.coverage;
  if (!(e.brokenVoxels > 0)) {
    return e.charged || e.holeCoverage > 0 ? { kind: 'neutral' } : { kind: 'unknown' };
  }
  if (!(coverage > 0)) return { kind: 'unknown' };
  if (coverage >= 1) return { kind: 'full' };
  return { kind: 'partial', sharePct: Math.min(99, Math.max(1, Math.round(coverage * 100))) };
}

/** Colour of the EST. ORE VALUE: muted while unsurveyed, positive once any survey covers the blast. */
export function oreValueColor(view: OreEstimateView): string {
  return view.kind === 'unknown' || view.kind === 'neutral' ? 'var(--bsx-text-micro)' : 'var(--bsx-positive)';
}

/** EST. ORE VALUE text for a coverage state: "No survey", "—" (nothing to value), "$X (N% surveyed)" or "$X". */
export function oreValueText(view: OreEstimateView, value: number): string {
  if (view.kind === 'neutral') return '—';
  if (view.kind === 'unknown') return t('ui.blast_workshop.footer.est_ore_unknown');
  const money = `$${formatMoney(value)}`;
  return view.kind === 'partial'
    ? `${money} ${t('ui.blast_workshop.footer.coverage_share', { percent: view.sharePct })}`
    : money;
}
