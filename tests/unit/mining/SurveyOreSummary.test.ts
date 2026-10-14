// BlastSimulator2026 — SurveyOreSummary unit tests (#1684)
// Per-ore digest of a survey's estimates: coverage, typical grade, peak, tonnes, value.

import { describe, it, expect } from 'vitest';
import {
  summarizeSurveyOres,
  columnOreValuePerM3,
} from '../../../src/core/mining/SurveyOreSummary.js';
import { ORE_DENSITY_KG_M3, SURVEY_DEPTH_BELOW_SURFACE } from '../../../src/core/config/balance.js';
import type { SurveyResult } from '../../../src/core/mining/SurveyCalc.js';

type Input = Pick<SurveyResult, 'method' | 'estimates' | 'confidence'>;

const SPARKIUM_PER_KG = 150;
const RUSTITE_PER_KG = 8;
const DIRTITE_PER_KG = 2;

/** 5x5 block of columns x,z in 18..22 — fully inside every seismic disc centred at (20,20). */
function block(fill: (x: number, z: number) => Record<string, number>): Record<string, Record<string, number>> {
  const estimates: Record<string, Record<string, number>> = {};
  for (let x = 18; x <= 22; x++) for (let z = 18; z <= 22; z++) estimates[`${x},${z}`] = fill(x, z);
  return estimates;
}

describe('summarizeSurveyOres', () => {
  it('core sample: one column holding the ore gives coverage 1 and typical = peak = the estimate', () => {
    const result = summarizeSurveyOres({
      method: 'core_sample', confidence: 1, estimates: { '30,30': { sparkium: 0.2 } },
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.oreId).toBe('sparkium');
    expect(result[0]!.coverage).toBeCloseTo(1, 5);
    expect(result[0]!.typicalGrade).toBeCloseTo(0.2, 5);
    expect(result[0]!.peakGrade).toBeCloseTo(0.2, 5);
  });

  it('core sample tonnes and value follow depth window x grade x ore density x price x confidence', () => {
    const [s] = summarizeSurveyOres({
      method: 'core_sample', confidence: 0.8, estimates: { '30,30': { sparkium: 0.2 } },
    });
    const tonnes = SURVEY_DEPTH_BELOW_SURFACE.core_sample * 0.2 * ORE_DENSITY_KG_M3 / 1000;
    expect(s!.estimatedTonnes).toBeCloseTo(tonnes, 4);
    expect(s!.estimatedValue).toBeCloseTo(tonnes * 1000 * SPARKIUM_PER_KG * 0.8, 1);
  });

  it('coverage is the share of surveyed columns that found the ore', () => {
    // sparkium in 10 of 25 columns, rustite in the other 15.
    const estimates = block((x, z) => ((x + z) % 5 < 2 ? { sparkium: 0.3 } : { rustite: 0.1 }));
    const sparkiumColumns = Object.values(estimates).filter(c => c.sparkium !== undefined).length;
    const byId = Object.fromEntries(
      summarizeSurveyOres({ method: 'seismic', confidence: 1, estimates }).map(s => [s.oreId, s]),
    );
    expect(byId.sparkium!.coverage).toBeCloseTo(sparkiumColumns / 25, 5);
    expect(byId.rustite!.coverage).toBeCloseTo((25 - sparkiumColumns) / 25, 5);
  });

  it('typical grade is the mean over columns that found the ore, peak the maximum', () => {
    // Dirtite 0.15 in 24 columns, 1.0 in one: mean (24*0.15+1)/25 = 0.184, peak 1.0.
    const estimates = block((x, z) => ({ dirtite: x === 20 && z === 20 ? 1.0 : 0.15 }));
    const [s] = summarizeSurveyOres({ method: 'seismic', confidence: 1, estimates });
    expect(s!.typicalGrade).toBeCloseTo((24 * 0.15 + 1.0) / 25, 5);
    expect(s!.peakGrade).toBeCloseTo(1.0, 5);
    expect(s!.coverage).toBeCloseTo(1, 5);
    // Peak must not leak into the typical figure.
    expect(s!.typicalGrade).toBeLessThan(0.25);
  });

  it('typical grade ignores columns that lack the ore (mean over finders, not over all columns)', () => {
    const estimates = block((x, z) => (x === 18 && z <= 19 ? { sparkium: 0.4 } : { rustite: 0.1 }));
    const sparkium = summarizeSurveyOres({ method: 'seismic', confidence: 1, estimates })
      .find(s => s.oreId === 'sparkium')!;
    expect(sparkium.typicalGrade).toBeCloseTo(0.4, 5);
    expect(sparkium.coverage).toBeCloseTo(2 / 25, 5);
  });

  it('seismic tonnes and value scale with the columns that found the ore', () => {
    const estimates = block((x, z) => ((x + z) % 5 < 2 ? { sparkium: 0.3 } : { rustite: 0.1 }));
    const found = Object.values(estimates).filter(c => c.sparkium !== undefined).length;
    const sparkium = summarizeSurveyOres({ method: 'seismic', confidence: 1, estimates })
      .find(s => s.oreId === 'sparkium')!;
    const tonnes = found * SURVEY_DEPTH_BELOW_SURFACE.seismic * 0.3 * ORE_DENSITY_KG_M3 / 1000;
    expect(sparkium.estimatedTonnes).toBeCloseTo(tonnes, 3);
    expect(sparkium.estimatedValue).toBeCloseTo(tonnes * 1000 * SPARKIUM_PER_KG, 0);
  });

  it('value scales linearly with confidence (mirrors BlastValueEstimate)', () => {
    const estimates = { '30,30': { rustite: 0.4 } };
    const [hi] = summarizeSurveyOres({ method: 'core_sample', confidence: 1, estimates });
    const [lo] = summarizeSurveyOres({ method: 'core_sample', confidence: 0.5, estimates });
    expect(lo!.estimatedValue).toBeCloseTo(hi!.estimatedValue / 2, 3);
    expect(lo!.estimatedTonnes).toBeCloseTo(hi!.estimatedTonnes, 5);
  });

  it('sorts by estimatedValue descending, not by grade', () => {
    // Dirtite is far richer by grade but worth far less per kg than sparkium.
    const [first, second, third] = summarizeSurveyOres({
      method: 'core_sample', confidence: 1,
      estimates: { '30,30': { dirtite: 0.9, rustite: 0.5, sparkium: 0.1 } },
    });
    expect(first!.oreId).toBe('sparkium');
    expect(second!.oreId).toBe('rustite');
    expect(third!.oreId).toBe('dirtite');
    expect(first!.estimatedValue).toBeGreaterThan(second!.estimatedValue);
    expect(second!.estimatedValue).toBeGreaterThan(third!.estimatedValue);
    expect(third!.estimatedValue).toBeGreaterThan(0);
    expect(DIRTITE_PER_KG).toBeLessThan(RUSTITE_PER_KG);
  });

  it('boundary: empty estimates yield an empty summary', () => {
    expect(summarizeSurveyOres({ method: 'seismic', confidence: 0.9, estimates: {} })).toEqual([]);
  });

  it('boundary: zero confidence keeps grades and tonnes but values nothing', () => {
    const [s] = summarizeSurveyOres({
      method: 'core_sample', confidence: 0, estimates: { '30,30': { sparkium: 0.5 } },
    });
    expect(s!.typicalGrade).toBeCloseTo(0.5, 5);
    expect(s!.estimatedTonnes).toBeGreaterThan(0);
    expect(s!.estimatedValue).toBe(0);
  });

  it('boundary: coverage never exceeds 1 and grades stay within [0, 1]', () => {
    const estimates = block(() => ({ sparkium: 1.0, rustite: 0.05 }));
    for (const s of summarizeSurveyOres({ method: 'seismic', confidence: 1, estimates })) {
      expect(s.coverage).toBeGreaterThan(0);
      expect(s.coverage).toBeLessThanOrEqual(1);
      expect(s.typicalGrade).toBeLessThanOrEqual(s.peakGrade);
      expect(s.peakGrade).toBeLessThanOrEqual(1);
    }
  });

  it('rejection: unknown ore ids are skipped, known ones in the same column kept', () => {
    const result = summarizeSurveyOres({
      method: 'core_sample', confidence: 1,
      estimates: { '30,30': { not_a_real_ore: 0.9, sparkium: 0.2 } },
    });
    expect(result.map(s => s.oreId)).toEqual(['sparkium']);
  });

  it('rejection: only unknown ore ids yields an empty summary', () => {
    expect(summarizeSurveyOres({
      method: 'core_sample', confidence: 1, estimates: { '30,30': { mystery: 0.5 } },
    })).toEqual([]);
  });

  it('rejection: zero-density entries do not count as found', () => {
    const result = summarizeSurveyOres({
      method: 'core_sample', confidence: 1, estimates: { '30,30': { sparkium: 0, rustite: 0.3 } },
    });
    expect(result.map(s => s.oreId)).toEqual(['rustite']);
  });

  it('does not mutate its input', () => {
    const input: Input = { method: 'core_sample', confidence: 0.7, estimates: { '30,30': { sparkium: 0.2 } } };
    const copy = JSON.parse(JSON.stringify(input));
    summarizeSurveyOres(input);
    expect(input).toEqual(copy);
  });
});

describe('columnOreValuePerM3', () => {
  it('positive: sums density x ORE_DENSITY_KG_M3 x valuePerKg over ores', () => {
    const expected = 0.2 * ORE_DENSITY_KG_M3 * SPARKIUM_PER_KG + 0.5 * ORE_DENSITY_KG_M3 * RUSTITE_PER_KG;
    expect(columnOreValuePerM3({ sparkium: 0.2, rustite: 0.5 })).toBeCloseTo(expected, 3);
  });

  it('a richer or pricier column is worth more', () => {
    expect(columnOreValuePerM3({ sparkium: 0.2 })).toBeGreaterThan(columnOreValuePerM3({ sparkium: 0.1 }));
    expect(columnOreValuePerM3({ sparkium: 0.1 })).toBeGreaterThan(columnOreValuePerM3({ dirtite: 0.1 }));
  });

  it('boundary: an empty column is worth 0', () => {
    expect(columnOreValuePerM3({})).toBe(0);
  });

  it('rejection: unknown ore ids are ignored', () => {
    expect(columnOreValuePerM3({ not_a_real_ore: 0.9 })).toBe(0);
    expect(columnOreValuePerM3({ not_a_real_ore: 0.9, rustite: 0.5 }))
      .toBeCloseTo(0.5 * ORE_DENSITY_KG_M3 * RUSTITE_PER_KG, 3);
  });
});
