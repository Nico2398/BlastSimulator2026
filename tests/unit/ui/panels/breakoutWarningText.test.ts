// BlastSimulator2026 — Breakout warning wording (#2003)
import { describe, it, expect } from 'vitest';
import { breakoutWarningText } from '../../../../src/ui/panels/breakoutWarningText.js';
import { setLocale } from '../../../../src/core/i18n/I18n.js';
import type { BreakoutPrediction } from '../../../../src/core/mining/BreakoutPrediction.js';

const NONE_KEY = 'ui.blast_workshop.preflight.warn_breakout_none';
const PARTIAL_KEY = 'ui.blast_workshop.preflight.warn_breakout_partial';

const prediction = (tooDeep: number): BreakoutPrediction => ({
  brokenVoxels: 1000, sealedVoxels: 1000, sealedShare: 1, chargedHoleCount: 9, fragmented: [], sealedKeys: new Set<string>(),
  tooDeepHoleIds: Array.from({ length: tooDeep }, (_, i) => `H${i + 1}`),
});

describe('breakoutWarningText', () => {
  it('names how many holes are too deep', () => {
    setLocale('en');
    expect(breakoutWarningText(prediction(7), NONE_KEY)).toContain('7');
    expect(breakoutWarningText(prediction(3), PARTIAL_KEY)).toContain('3');
  });

  it('resolves to real text, not the bare key', () => {
    setLocale('en');
    for (const key of [NONE_KEY, PARTIAL_KEY]) {
      const text = breakoutWarningText(prediction(4), key);
      expect(text).not.toBe('');
      expect(text).not.toBe(key);
    }
  });

  it('names both fixes: shorter holes, and a charge column that reaches higher', () => {
    setLocale('en');
    const text = breakoutWarningText(prediction(9), NONE_KEY);
    expect(text).toMatch(/shorter/i);
    expect(text).toMatch(/explosive|charge/i);
  });

  it('never suggests a wider hole', () => {
    setLocale('en');
    for (const key of [NONE_KEY, PARTIAL_KEY]) {
      expect(breakoutWarningText(prediction(9), key)).not.toMatch(/wider|bigger|larger|diameter|127/i);
    }
  });

  it('the partial wording speaks of rock staying in the ground', () => {
    setLocale('en');
    expect(breakoutWarningText(prediction(2), PARTIAL_KEY)).toMatch(/ground|sealed|stay/i);
  });

  it('is localised in French too', () => {
    setLocale('fr');
    const fr = breakoutWarningText(prediction(5), NONE_KEY);
    setLocale('en');
    expect(fr).not.toBe(breakoutWarningText(prediction(5), NONE_KEY));
    expect(fr).toContain('5');
  });
});
