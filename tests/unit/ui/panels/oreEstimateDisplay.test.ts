import { describe, it, expect } from 'vitest';
import { oreEstimateView, oreValueColor, oreValueText } from '../../../../src/ui/panels/oreEstimateDisplay.js';
import { t } from '../../../../src/core/i18n/I18n.js';

/** An estimate that broke `brokenVoxels` voxels with the given survey coverage. */
const broken = (coverage: number, brokenVoxels = 10) => ({ coverage, brokenVoxels, charged: true, holeCoverage: 0 });

describe('oreEstimateView (#1960)', () => {
  it('0 coverage is unknown', () => {
    expect(oreEstimateView(broken(0))).toEqual({ kind: 'unknown' });
  });

  it('full coverage is full', () => {
    expect(oreEstimateView(broken(1))).toEqual({ kind: 'full' });
  });

  it('partial coverage reports a whole-percent share', () => {
    expect(oreEstimateView(broken(0.5))).toEqual({ kind: 'partial', sharePct: 50 });
    expect(oreEstimateView(broken(0.426))).toEqual({ kind: 'partial', sharePct: 43 });
  });

  it('rounds to the nearest whole percent', () => {
    expect(oreEstimateView(broken(0.344))).toEqual({ kind: 'partial', sharePct: 34 });
    expect(oreEstimateView(broken(0.346))).toEqual({ kind: 'partial', sharePct: 35 });
  });

  it('a sliver of coverage never reads 0%', () => {
    expect(oreEstimateView(broken(0.001))).toEqual({ kind: 'partial', sharePct: 1 });
    expect(oreEstimateView(broken(1e-9))).toEqual({ kind: 'partial', sharePct: 1 });
  });

  it('near-full coverage never reads 100%', () => {
    expect(oreEstimateView(broken(0.999))).toEqual({ kind: 'partial', sharePct: 99 });
    expect(oreEstimateView(broken(1 - 1e-9))).toEqual({ kind: 'partial', sharePct: 99 });
  });

  it('negative coverage is unknown and NaN does not produce a share', () => {
    expect(oreEstimateView(broken(-0.2))).toEqual({ kind: 'unknown' });
    expect(oreEstimateView(broken(Number.NaN)).kind).toBe('unknown');
  });

  it('coverage above 1 is full', () => {
    expect(oreEstimateView(broken(1.5))).toEqual({ kind: 'full' });
  });
});

describe('oreEstimateView — nothing broken is neutral, not unknown (#1967)', () => {
  it('a charged plan that breaks nothing is neutral, even unsurveyed', () => {
    expect(oreEstimateView({ coverage: 0, brokenVoxels: 0, charged: true, holeCoverage: 0 })).toEqual({ kind: 'neutral' });
  });

  it('a charged plan that breaks nothing on surveyed ground is neutral', () => {
    expect(oreEstimateView({ coverage: 0, brokenVoxels: 0, charged: true, holeCoverage: 1 })).toEqual({ kind: 'neutral' });
  });

  it('uncharged holes on surveyed ground are neutral', () => {
    expect(oreEstimateView({ coverage: 0, brokenVoxels: 0, charged: false, holeCoverage: 1 })).toEqual({ kind: 'neutral' });
  });

  it('uncharged holes partly on surveyed ground are neutral', () => {
    expect(oreEstimateView({ coverage: 0, brokenVoxels: 0, charged: false, holeCoverage: 0.5 })).toEqual({ kind: 'neutral' });
  });

  it('uncharged holes on unsurveyed ground stay unknown', () => {
    expect(oreEstimateView({ coverage: 0, brokenVoxels: 0, charged: false, holeCoverage: 0 })).toEqual({ kind: 'unknown' });
  });

  it('broken voxels with zero coverage stay unknown, charged or not', () => {
    expect(oreEstimateView({ coverage: 0, brokenVoxels: 5, charged: true, holeCoverage: 1 })).toEqual({ kind: 'unknown' });
  });

  it('broken voxels use the coverage mapping whatever holeCoverage says', () => {
    expect(oreEstimateView({ coverage: 1, brokenVoxels: 5, charged: true, holeCoverage: 0 })).toEqual({ kind: 'full' });
    expect(oreEstimateView({ coverage: 0.25, brokenVoxels: 5, charged: true, holeCoverage: 0 })).toEqual({ kind: 'partial', sharePct: 25 });
  });
});

describe('oreValueText / oreValueColor — neutral (#1967)', () => {
  it('neutral value text is an em dash, not "No survey"', () => {
    expect(oreValueText({ kind: 'neutral' }, 0)).toBe('—');
    expect(oreValueText({ kind: 'neutral' }, 0)).not.toBe(t('ui.blast_workshop.footer.est_ore_unknown'));
  });

  it('unknown value text is still "No survey"', () => {
    expect(oreValueText({ kind: 'unknown' }, 0)).toBe('No survey');
  });

  it('neutral uses the same muted colour as unknown', () => {
    expect(oreValueColor({ kind: 'neutral' })).toBe(oreValueColor({ kind: 'unknown' }));
    expect(oreValueColor({ kind: 'neutral' })).not.toBe(oreValueColor({ kind: 'full' }));
  });

  it('full with value 0 reads $0', () => {
    expect(oreValueText({ kind: 'full' }, 0)).toBe('$0');
  });
});
