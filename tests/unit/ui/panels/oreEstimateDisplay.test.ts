import { describe, it, expect } from 'vitest';
import { oreEstimateView } from '../../../../src/ui/panels/oreEstimateDisplay.js';

describe('oreEstimateView (#1960)', () => {
  it('0 coverage is unknown', () => {
    expect(oreEstimateView(0)).toEqual({ kind: 'unknown' });
  });

  it('full coverage is full', () => {
    expect(oreEstimateView(1)).toEqual({ kind: 'full' });
  });

  it('partial coverage reports a whole-percent share', () => {
    expect(oreEstimateView(0.5)).toEqual({ kind: 'partial', sharePct: 50 });
    expect(oreEstimateView(0.426)).toEqual({ kind: 'partial', sharePct: 43 });
  });

  it('rounds to the nearest whole percent', () => {
    expect(oreEstimateView(0.344)).toEqual({ kind: 'partial', sharePct: 34 });
    expect(oreEstimateView(0.346)).toEqual({ kind: 'partial', sharePct: 35 });
  });

  it('a sliver of coverage never reads 0%', () => {
    expect(oreEstimateView(0.001)).toEqual({ kind: 'partial', sharePct: 1 });
    expect(oreEstimateView(1e-9)).toEqual({ kind: 'partial', sharePct: 1 });
  });

  it('near-full coverage never reads 100%', () => {
    expect(oreEstimateView(0.999)).toEqual({ kind: 'partial', sharePct: 99 });
    expect(oreEstimateView(1 - 1e-9)).toEqual({ kind: 'partial', sharePct: 99 });
  });

  it('negative coverage is unknown and NaN does not produce a share', () => {
    expect(oreEstimateView(-0.2)).toEqual({ kind: 'unknown' });
    expect(oreEstimateView(Number.NaN).kind).toBe('unknown');
  });

  it('coverage above 1 is full', () => {
    expect(oreEstimateView(1.5)).toEqual({ kind: 'full' });
  });
});
