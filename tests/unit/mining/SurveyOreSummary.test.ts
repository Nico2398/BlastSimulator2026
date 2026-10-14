// BlastSimulator2026 — SurveyOreSummary unit tests (#1684)
// Per-ore digest of a survey's estimates: coverage, typical grade, peak, tonnes, value.

import { describe, it, expect } from 'vitest';
import { summarizeSurveyOres as summarizeInMarket } from '../../../src/core/mining/SurveyOreSummary.js';
import { columnOreValuePerM3 as columnValueInMarket } from '../../../src/core/mining/BlastValueEstimate.js';
import { oreValuePerKg, type MarketId } from '../../../src/core/economy/Market.js';
import { ORE_DENSITY_KG_M3, SURVEY_COVERAGE_RADIUS, SURVEY_DEPTH_BELOW_SURFACE } from '../../../src/core/config/balance.js';
import type { SurveyResult } from '../../../src/core/mining/SurveyCalc.js';

type Input = Pick<SurveyResult, 'method' | 'estimates' | 'confidence' | 'centerX' | 'centerZ'>;

const summarizeSurveyOres = (survey: Input, market: MarketId = 'legacy') => summarizeInMarket(survey, market);
const columnOreValuePerM3 = (d: Record<string, number>, market: MarketId = 'legacy') => columnValueInMarket(d, market);

const SPARKIUM_PER_KG = 150;
const RUSTITE_PER_KG = 8;
const DIRTITE_PER_KG = 2;

const SEISMIC_RADIUS = SURVEY_COVERAGE_RADIUS.seismic;
const CENTER = 20;

/** Every column of the seismic disc around (20,20), as estimateSurveyResult would list them if all carried ore. */
function discColumns(): Array<[number, number]> {
  const cols: Array<[number, number]> = [];
  for (let x = CENTER - SEISMIC_RADIUS; x <= CENTER + SEISMIC_RADIUS; x++) {
    for (let z = CENTER - SEISMIC_RADIUS; z <= CENTER + SEISMIC_RADIUS; z++) {
      if (Math.hypot(x - CENTER, z - CENTER) <= SEISMIC_RADIUS) cols.push([x, z]);
    }
  }
  return cols;
}
const DISC_SIZE = discColumns().length;

/** Estimates for the whole disc; a fill returning undefined models an ore-free column (omitted, as estimateSurveyResult does). */
function disc(fill: (x: number, z: number) => Record<string, number> | undefined): Record<string, Record<string, number>> {
  const estimates: Record<string, Record<string, number>> = {};
  for (const [x, z] of discColumns()) {
    const col = fill(x, z);
    if (col) estimates[`${x},${z}`] = col;
  }
  return estimates;
}

const seismic = (estimates: Input['estimates'], confidence = 1): Input =>
  ({ method: 'seismic', centerX: CENTER, centerZ: CENTER, confidence, estimates });

describe('summarizeSurveyOres', () => {
  it('core sample: one column holding the ore gives coverage 1 and typical = peak = the estimate', () => {
    const result = summarizeSurveyOres({
      method: 'core_sample', centerX: 30, centerZ: 30, confidence: 1, estimates: { '30,30': { sparkium: 0.2 } },
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.oreId).toBe('sparkium');
    expect(result[0]!.coverage).toBeCloseTo(1, 5);
    expect(result[0]!.typicalGrade).toBeCloseTo(0.2, 5);
    expect(result[0]!.peakGrade).toBeCloseTo(0.2, 5);
  });

  it('core sample tonnes and value follow depth window x grade x ore density x price x confidence', () => {
    const [s] = summarizeSurveyOres({
      method: 'core_sample', centerX: 30, centerZ: 30, confidence: 0.8, estimates: { '30,30': { sparkium: 0.2 } },
    });
    const tonnes = SURVEY_DEPTH_BELOW_SURFACE.core_sample * 0.2 * ORE_DENSITY_KG_M3 / 1000;
    expect(s!.estimatedTonnes).toBeCloseTo(tonnes, 4);
    expect(s!.estimatedValue).toBeCloseTo(tonnes * 1000 * SPARKIUM_PER_KG * 0.8, 1);
  });

  it('coverage is the share of surveyed columns that found the ore', () => {
    // sparkium in 2 of every 5 columns, rustite in the rest; every column of the disc carries ore.
    const estimates = disc((x, z) => ((x + z) % 5 < 2 ? { sparkium: 0.3 } : { rustite: 0.1 }));
    const sparkiumColumns = Object.values(estimates).filter(c => c.sparkium !== undefined).length;
    const byId = Object.fromEntries(
      summarizeSurveyOres(seismic(estimates)).map(s => [s.oreId, s]),
    );
    expect(byId.sparkium!.coverage).toBeCloseTo(sparkiumColumns / DISC_SIZE, 5);
    expect(byId.rustite!.coverage).toBeCloseTo((DISC_SIZE - sparkiumColumns) / DISC_SIZE, 5);
  });

  it('typical grade is the mean over columns that found the ore, peak the maximum', () => {
    // Dirtite 0.15 in every column but the centre (1.0): mean barely above 0.15, peak 1.0.
    const estimates = disc((x, z) => ({ dirtite: x === 20 && z === 20 ? 1.0 : 0.15 }));
    const [s] = summarizeSurveyOres(seismic(estimates));
    expect(s!.typicalGrade).toBeCloseTo(((DISC_SIZE - 1) * 0.15 + 1.0) / DISC_SIZE, 5);
    expect(s!.peakGrade).toBeCloseTo(1.0, 5);
    expect(s!.coverage).toBeCloseTo(1, 5);
    // Peak must not leak into the typical figure.
    expect(s!.typicalGrade).toBeLessThan(0.25);
  });

  it('typical grade ignores columns that lack the ore (mean over finders, not over all columns)', () => {
    const estimates = disc((x, z) => (x === 18 && z <= 20 ? { sparkium: 0.4 } : { rustite: 0.1 }));
    const finders = Object.values(estimates).filter(c => c.sparkium !== undefined).length;
    const sparkium = summarizeSurveyOres(seismic(estimates))
      .find(s => s.oreId === 'sparkium')!;
    expect(sparkium.typicalGrade).toBeCloseTo(0.4, 5);
    expect(sparkium.coverage).toBeCloseTo(finders / DISC_SIZE, 5);
  });

  it('seismic tonnes and value scale with the columns that found the ore', () => {
    const estimates = disc((x, z) => ((x + z) % 5 < 2 ? { sparkium: 0.3 } : { rustite: 0.1 }));
    const found = Object.values(estimates).filter(c => c.sparkium !== undefined).length;
    const sparkium = summarizeSurveyOres(seismic(estimates))
      .find(s => s.oreId === 'sparkium')!;
    const tonnes = found * SURVEY_DEPTH_BELOW_SURFACE.seismic * 0.3 * ORE_DENSITY_KG_M3 / 1000;
    expect(sparkium.estimatedTonnes).toBeCloseTo(tonnes, 3);
    expect(sparkium.estimatedValue).toBeCloseTo(tonnes * 1000 * SPARKIUM_PER_KG, 0);
  });

  it('value scales linearly with confidence (mirrors BlastValueEstimate)', () => {
    const estimates = { '30,30': { rustite: 0.4 } };
    const [hi] = summarizeSurveyOres({ method: 'core_sample', centerX: 30, centerZ: 30, confidence: 1, estimates });
    const [lo] = summarizeSurveyOres({ method: 'core_sample', centerX: 30, centerZ: 30, confidence: 0.5, estimates });
    expect(lo!.estimatedValue).toBeCloseTo(hi!.estimatedValue / 2, 3);
    expect(lo!.estimatedTonnes).toBeCloseTo(hi!.estimatedTonnes, 5);
  });

  it('sorts by estimatedValue descending, not by grade', () => {
    // Dirtite is far richer by grade but worth far less per kg than sparkium.
    const [first, second, third] = summarizeSurveyOres({
      method: 'core_sample', centerX: 30, centerZ: 30, confidence: 1,
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

  it('sparse ore: ore-free columns are omitted from the estimates but still count in the surveyed area', () => {
    // Ore in ~10% of the disc; the other 90% is absent from the estimates entirely.
    const estimates = disc((x, z) => ((x * 7 + z * 3) % 10 === 0 ? { sparkium: 0.4 } : undefined));
    const found = Object.keys(estimates).length;
    const [s] = summarizeSurveyOres(seismic(estimates));
    expect(s!.coverage).toBeCloseTo(found / DISC_SIZE, 5);
    expect(s!.coverage).toBeGreaterThan(0.05);
    expect(s!.coverage).toBeLessThan(0.15);
  });

  it('sparse ore: coverage follows the survey centre, not where the ore happens to be', () => {
    // One ore column far from the centre: bounding-box inference would call this a single-column survey.
    const [s] = summarizeSurveyOres({
      method: 'seismic', confidence: 1, centerX: 100, centerZ: 100, estimates: { '110,100': { sparkium: 0.4 } },
    });
    expect(s!.coverage).toBeCloseTo(1 / DISC_SIZE, 5);
  });

  it('boundary: empty estimates yield an empty summary', () => {
    expect(summarizeSurveyOres(seismic({}, 0.9))).toEqual([]);
  });

  it('boundary: zero confidence keeps grades and tonnes but values nothing', () => {
    const [s] = summarizeSurveyOres({
      method: 'core_sample', centerX: 30, centerZ: 30, confidence: 0, estimates: { '30,30': { sparkium: 0.5 } },
    });
    expect(s!.typicalGrade).toBeCloseTo(0.5, 5);
    expect(s!.estimatedTonnes).toBeGreaterThan(0);
    expect(s!.estimatedValue).toBe(0);
  });

  it('boundary: coverage never exceeds 1 and grades stay within [0, 1]', () => {
    const estimates = disc(() => ({ sparkium: 1.0, rustite: 0.05 }));
    for (const s of summarizeSurveyOres(seismic(estimates))) {
      expect(s.coverage).toBeGreaterThan(0);
      expect(s.coverage).toBeLessThanOrEqual(1);
      expect(s.typicalGrade).toBeLessThanOrEqual(s.peakGrade);
      expect(s.peakGrade).toBeLessThanOrEqual(1);
    }
  });

  it('rejection: unknown ore ids are skipped, known ones in the same column kept', () => {
    const result = summarizeSurveyOres({
      method: 'core_sample', centerX: 30, centerZ: 30, confidence: 1,
      estimates: { '30,30': { not_a_real_ore: 0.9, sparkium: 0.2 } },
    });
    expect(result.map(s => s.oreId)).toEqual(['sparkium']);
  });

  it('rejection: only unknown ore ids yields an empty summary', () => {
    expect(summarizeSurveyOres({
      method: 'core_sample', centerX: 30, centerZ: 30, confidence: 1, estimates: { '30,30': { mystery: 0.5 } },
    })).toEqual([]);
  });

  it('rejection: zero-density entries do not count as found', () => {
    const result = summarizeSurveyOres({
      method: 'core_sample', centerX: 30, centerZ: 30, confidence: 1, estimates: { '30,30': { sparkium: 0, rustite: 0.3 } },
    });
    expect(result.map(s => s.oreId)).toEqual(['rustite']);
  });

  it('does not mutate its input', () => {
    const input: Input = { method: 'core_sample', centerX: 30, centerZ: 30, confidence: 0.7, estimates: { '30,30': { sparkium: 0.2 } } };
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

describe('summarizeSurveyOres — market pricing (#1681)', () => {
  const estimates = { '20,20': { sparkium: 0.2, rustite: 0.5 } };
  const core: Input = { method: 'core_sample', centerX: 20, centerZ: 20, confidence: 1, estimates };

  it('estimatedValue follows the market price of each ore', () => {
    for (const market of ['legacy', 'production'] as const) {
      const volume = SURVEY_DEPTH_BELOW_SURFACE.core_sample;
      for (const s of summarizeSurveyOres(core, market)) {
        const grade = estimates['20,20'][s.oreId as 'sparkium' | 'rustite'];
        expect(s.estimatedValue).toBeCloseTo(volume * grade * ORE_DENSITY_KG_M3 * oreValuePerKg(s.oreId, market), 3);
      }
    }
  });

  it('sandbox (production) and legacy surveys of the same ground disagree on value', () => {
    const total = (m: MarketId) => summarizeSurveyOres(core, m).reduce((a, s) => a + s.estimatedValue, 0);
    expect(total('production')).not.toBeCloseTo(total('legacy'), 1);
  });

  it('columnOreValuePerM3 prices in the given market', () => {
    expect(columnOreValuePerM3({ rustite: 0.5 }, 'production'))
      .toBeCloseTo(0.5 * ORE_DENSITY_KG_M3 * oreValuePerKg('rustite', 'production'), 3);
  });
});
