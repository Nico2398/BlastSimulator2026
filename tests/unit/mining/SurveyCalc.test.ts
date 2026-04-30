import { describe, it, expect } from 'vitest';
import * as SurveyCalcModule from '../../../src/core/mining/SurveyCalc.js';
import { SURVEY_METHODS } from '../../../src/core/mining/SurveyCalc.js';
import type { SurveyMethod, SurveyResult } from '../../../src/core/mining/SurveyCalc.js';
// ── Task 4.2 additions ────────────────────────────────────────────────────────
import { estimateSurveyResult, type EstimateSurveyParams } from '../../../src/core/mining/SurveyCalc.js';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import { Random } from '../../../src/core/math/Random.js';

// ── Deterministic fixture ─────────────────────────────────────────────────────
// All required fields are set to fixed values so every test that derives a
// variant can use spread syntax without repeating boilerplate.
const BASE_RESULT: SurveyResult = {
  id: 1,
  method: 'seismic',
  centerX: 10,
  centerZ: 20,
  completedTick: 42,
  surveyorId: 7,
  estimates: {
    iron: { high_grade: 0.8, low_grade: 0.2 },
    copper: { high_grade: 0.5 },
  },
  confidence: 0.75,
};

// ── 4.1: Module smoke test ────────────────────────────────────────────────────

describe('SurveyCalc — module', () => {
  it('SurveyCalc module resolves and is an object', () => {
    // Verifies the file exists and is importable; also exercises the
    // SurveyCalcModule namespace import so it is not tree-shaken away.
    expect(typeof SurveyCalcModule).toBe('object');
    expect(SurveyCalcModule).not.toBeNull();
  });
});

// ── 4.1: SurveyMethod union ───────────────────────────────────────────────────

describe('SurveyCalc — SurveyMethod', () => {
  it("'seismic' is a valid SurveyMethod value", () => {
    const m: SurveyMethod = 'seismic';
    expect(m).toBe('seismic');
  });

  it("'core_sample' is a valid SurveyMethod value", () => {
    const m: SurveyMethod = 'core_sample';
    expect(m).toBe('core_sample');
  });

  it("'aerial' is a valid SurveyMethod value", () => {
    const m: SurveyMethod = 'aerial';
    expect(m).toBe('aerial');
  });

  it('SurveyMethod union contains exactly three members', () => {
    expect(SURVEY_METHODS).toHaveLength(3);
    expect(SURVEY_METHODS).toContain('seismic');
    expect(SURVEY_METHODS).toContain('core_sample');
    expect(SURVEY_METHODS).toContain('aerial');
  });
});

// ── 4.1: SurveyResult interface ───────────────────────────────────────────────

describe('SurveyCalc — SurveyResult shape', () => {

  // ── Construction ─────────────────────────────────────────────────────────────

  it('a valid SurveyResult can be constructed with all required fields', () => {
    expect(BASE_RESULT).toBeDefined();
    expect(BASE_RESULT.id).toBe(1);
    expect(BASE_RESULT.method).toBe('seismic');
    expect(BASE_RESULT.centerX).toBe(10);
    expect(BASE_RESULT.centerZ).toBe(20);
    expect(BASE_RESULT.completedTick).toBe(42);
    expect(BASE_RESULT.surveyorId).toBe(7);
    expect(BASE_RESULT.confidence).toBe(0.75);
  });

  // ── Scalar field types ────────────────────────────────────────────────────────

  it('id is a number', () => {
    expect(typeof BASE_RESULT.id).toBe('number');
  });

  it('centerX is a number', () => {
    expect(typeof BASE_RESULT.centerX).toBe('number');
  });

  it('centerZ is a number', () => {
    expect(typeof BASE_RESULT.centerZ).toBe('number');
  });

  it('completedTick is a number', () => {
    expect(typeof BASE_RESULT.completedTick).toBe('number');
  });

  it('surveyorId is a number', () => {
    expect(typeof BASE_RESULT.surveyorId).toBe('number');
  });

  // ── method field — each SurveyMethod variant ──────────────────────────────────

  it('method field holds the value assigned at construction (seismic)', () => {
    expect(SURVEY_METHODS).toContain(BASE_RESULT.method);
    expect(BASE_RESULT.method).toBe('seismic');
  });

  it('SurveyResult.method can be core_sample', () => {
    const r: SurveyResult = { ...BASE_RESULT, method: 'core_sample' };
    expect(r.method).toBe('core_sample');
  });

  it('SurveyResult.method can be aerial', () => {
    const r: SurveyResult = { ...BASE_RESULT, method: 'aerial' };
    expect(r.method).toBe('aerial');
  });

  // ── confidence — range 0–1 ────────────────────────────────────────────────────

  it('confidence is a number (mid-range value 0.75)', () => {
    expect(typeof BASE_RESULT.confidence).toBe('number');
  });

  it('confidence of 0.75 is within [0, 1]', () => {
    expect(BASE_RESULT.confidence).toBeGreaterThanOrEqual(0);
    expect(BASE_RESULT.confidence).toBeLessThanOrEqual(1);
  });

  it('confidence of exactly 0 is valid (lower boundary)', () => {
    const r: SurveyResult = { ...BASE_RESULT, confidence: 0 };
    expect(r.confidence).toBe(0);
    expect(r.confidence).toBeGreaterThanOrEqual(0);
    expect(r.confidence).toBeLessThanOrEqual(1);
  });

  it('confidence of exactly 1 is valid (upper boundary)', () => {
    const r: SurveyResult = { ...BASE_RESULT, confidence: 1 };
    expect(r.confidence).toBe(1);
    expect(r.confidence).toBeGreaterThanOrEqual(0);
    expect(r.confidence).toBeLessThanOrEqual(1);
  });

  // ── estimates — Record<string, Record<string, number>> ───────────────────────

  it('estimates is a non-null object (outer Record)', () => {
    expect(typeof BASE_RESULT.estimates).toBe('object');
    expect(BASE_RESULT.estimates).not.toBeNull();
  });

  it('each outer key of estimates maps to an inner object (inner Record)', () => {
    for (const outerKey of Object.keys(BASE_RESULT.estimates)) {
      const inner = BASE_RESULT.estimates[outerKey];
      expect(typeof inner).toBe('object');
      expect(inner).not.toBeNull();
    }
  });

  it('all inner values of estimates are numbers', () => {
    for (const outerKey of Object.keys(BASE_RESULT.estimates)) {
      const inner = BASE_RESULT.estimates[outerKey]!;
      for (const innerKey of Object.keys(inner)) {
        expect(typeof inner[innerKey]).toBe('number');
      }
    }
  });

  it('estimates can hold multiple outer keys with independent inner Records', () => {
    const r: SurveyResult = {
      ...BASE_RESULT,
      estimates: {
        zone_a: { ore_pct: 0.42, waste_pct: 0.58 },
        zone_b: { ore_pct: 0.15 },
        zone_c: {},
      },
    };
    expect(Object.keys(r.estimates)).toHaveLength(3);
    expect(r.estimates['zone_a']!['ore_pct']).toBeCloseTo(0.42);
    expect(r.estimates['zone_b']!['ore_pct']).toBeCloseTo(0.15);
    expect(r.estimates['zone_c']).toEqual({});
  });

  it('estimates can be an empty Record', () => {
    const r: SurveyResult = { ...BASE_RESULT, estimates: {} };
    expect(r.estimates).toEqual({});
  });
});

// ── 4.2 fixtures ──────────────────────────────────────────────────────────────

/**
 * Baseline EstimateSurveyParams used by most 4.2 tests.
 * Individual tests override specific fields via object spread.
 */
const BASE_PARAMS: EstimateSurveyParams = {
  id: 42,
  method: 'seismic',
  centerX: 5,
  centerZ: 5,
  surveyorId: 99,
  skillLevel: 1,
  completedTick: 100,
};

/**
 * 11×11×11 grid: only column (5,*,5) holds ore.
 * Seven y-levels (2–8) each contain a solid 'granite' voxel with gold=0.5.
 */
function makeOreGrid(): VoxelGrid {
  const grid = new VoxelGrid(11, 11, 11);
  for (let y = 2; y <= 8; y++) {
    grid.setVoxel(5, y, 5, {
      rockId: 'granite',
      density: 1,
      oreDensities: { gold: 0.5 },
      fractureModifier: 1.0,
    });
  }
  return grid;
}

/**
 * 11×11×11 grid: EVERY column holds ore at y=2–8 (gold=0.5).
 * Used to prove core_sample still returns only the centre column.
 */
function makeFilledOreGrid(): VoxelGrid {
  const grid = new VoxelGrid(11, 11, 11);
  for (let x = 0; x < 11; x++) {
    for (let z = 0; z < 11; z++) {
      for (let y = 2; y <= 8; y++) {
        grid.setVoxel(x, y, z, {
          rockId: 'granite',
          density: 1,
          oreDensities: { gold: 0.5 },
          fractureModifier: 1.0,
        });
      }
    }
  }
  return grid;
}

/**
 * 101×10×101 grid: every column has a single solid 'granite' voxel (copper=0.4)
 * at y=5, giving a uniform surface layer.
 * Used for aerial radius and surface-detection tests.
 */
function makeAerialGrid(): VoxelGrid {
  const grid = new VoxelGrid(101, 10, 101);
  for (let x = 0; x < 101; x++) {
    for (let z = 0; z < 101; z++) {
      grid.setVoxel(x, 5, z, {
        rockId: 'granite',
        density: 1,
        oreDensities: { copper: 0.4 },
        fractureModifier: 1.0,
      });
    }
  }
  return grid;
}

// ── 4.2: estimateSurveyResult ─────────────────────────────────────────────────

describe('SurveyCalc — estimateSurveyResult', () => {

  // ── Test 1: export presence ─────────────────────────────────────────────────

  it('estimateSurveyResult is exported as a function from the module', () => {
    // Uses the namespace import so that a missing export produces 'undefined'
    // rather than a compile error (type import is stripped by esbuild).
    expect(
      typeof (SurveyCalcModule as Record<string, unknown>)['estimateSurveyResult'],
    ).toBe('function');
  });

  // ── Test 2: return shape ────────────────────────────────────────────────────

  it('returns an object that has all eight required SurveyResult fields', () => {
    const result = estimateSurveyResult(makeOreGrid(), BASE_PARAMS, new Random(12345));
    expect(result).toHaveProperty('id');
    expect(result).toHaveProperty('method');
    expect(result).toHaveProperty('centerX');
    expect(result).toHaveProperty('centerZ');
    expect(result).toHaveProperty('surveyorId');
    expect(result).toHaveProperty('completedTick');
    expect(result).toHaveProperty('estimates');
    expect(result).toHaveProperty('confidence');
  });

  // ── Test 3: param echo ──────────────────────────────────────────────────────

  it('echoes id, method, centerX, centerZ, surveyorId, and completedTick verbatim from params', () => {
    const params: EstimateSurveyParams = {
      id: 7,
      method: 'core_sample',
      centerX: 3,
      centerZ: 8,
      surveyorId: 55,
      skillLevel: 2,
      completedTick: 999,
    };
    const result = estimateSurveyResult(makeOreGrid(), params, new Random(12345));
    expect(result.id).toBe(7);
    expect(result.method).toBe('core_sample');
    expect(result.centerX).toBe(3);
    expect(result.centerZ).toBe(8);
    expect(result.surveyorId).toBe(55);
    expect(result.completedTick).toBe(999);
  });

  // ── Tests 4–6: confidence = 1 − finalError per method × skillLevel ─────────

  it('confidence is 0.85 for seismic at skill level 1 (baseError=0.15, skillBonus=0)', () => {
    // skillBonus = (1−1) × 0.12 = 0
    // finalError = 0.15 × (1 − 0) = 0.15
    // confidence  = 1 − 0.15 = 0.85
    const params: EstimateSurveyParams = { ...BASE_PARAMS, method: 'seismic', skillLevel: 1 };
    const result = estimateSurveyResult(makeOreGrid(), params, new Random(12345));
    expect(result.confidence).toBeCloseTo(0.85, 5);
  });

  it('confidence is 0.962 for core_sample at skill level 3 (baseError=0.05, skillBonus=0.24)', () => {
    // skillBonus = (3−1) × 0.12 = 0.24
    // finalError = 0.05 × (1 − 0.24) = 0.038
    // confidence  = 1 − 0.038 = 0.962
    const params: EstimateSurveyParams = { ...BASE_PARAMS, method: 'core_sample', skillLevel: 3 };
    const result = estimateSurveyResult(makeOreGrid(), params, new Random(12345));
    expect(result.confidence).toBeCloseTo(0.962, 5);
  });

  it('confidence is 0.87 for aerial at skill level 5 (baseError=0.25, skillBonus=0.48)', () => {
    // skillBonus = (5−1) × 0.12 = 0.48
    // finalError = 0.25 × (1 − 0.48) = 0.13
    // confidence  = 1 − 0.13 = 0.87
    const params: EstimateSurveyParams = { ...BASE_PARAMS, method: 'aerial', skillLevel: 5 };
    const result = estimateSurveyResult(makeOreGrid(), params, new Random(12345));
    expect(result.confidence).toBeCloseTo(0.87, 5);
  });

  // ── Test 7: core_sample column scope ───────────────────────────────────────

  it('core_sample estimates contain exactly one outer key equal to "centerX,centerZ"', () => {
    // makeFilledOreGrid() has ore in every column, proving core_sample is not
    // accidentally collecting data from neighbouring columns.
    const params: EstimateSurveyParams = {
      ...BASE_PARAMS,
      method: 'core_sample',
      centerX: 5,
      centerZ: 5,
    };
    const result = estimateSurveyResult(makeFilledOreGrid(), params, new Random(12345));
    const outerKeys = Object.keys(result.estimates);
    expect(outerKeys).toHaveLength(1);
    expect(outerKeys[0]).toBe('5,5');
  });

  // ── Tests 8–9: value constraints ───────────────────────────────────────────

  it('all ore estimate values in the estimates map are clamped to [0, 1]', () => {
    // Seismic with gaussian noise may compute intermediate values outside [0,1];
    // the implementation must clamp before storing.
    const result = estimateSurveyResult(makeOreGrid(), BASE_PARAMS, new Random(12345));
    for (const colKey of Object.keys(result.estimates)) {
      const inner = result.estimates[colKey]!;
      for (const oreKey of Object.keys(inner)) {
        const val = inner[oreKey]!;
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThanOrEqual(1);
      }
    }
  });

  it('all ore estimate values in the estimates map are rounded to the nearest 0.05', () => {
    // Multiplying by 20 converts 0.05-steps to integers; the rounded integer
    // must equal the scaled value to within floating-point tolerance.
    const result = estimateSurveyResult(makeOreGrid(), BASE_PARAMS, new Random(12345));
    for (const colKey of Object.keys(result.estimates)) {
      const inner = result.estimates[colKey]!;
      for (const oreKey of Object.keys(inner)) {
        const val = inner[oreKey]!;
        const scaled = val * 20;
        expect(scaled).toBeCloseTo(Math.round(scaled), 9);
      }
    }
  });

  // ── Test 10: empty grid ─────────────────────────────────────────────────────

  it('empty grid (no ores) produces zero ore entries across all column estimates', () => {
    // A default VoxelGrid has oreDensities:{} for every voxel; no ore keys
    // should appear anywhere in the resulting estimates map.
    const emptyGrid = new VoxelGrid(11, 11, 11);
    const result = estimateSurveyResult(emptyGrid, BASE_PARAMS, new Random(12345));
    let totalOreEntries = 0;
    for (const colKey of Object.keys(result.estimates)) {
      totalOreEntries += Object.keys(result.estimates[colKey]!).length;
    }
    expect(totalOreEntries).toBe(0);
  });

  // ── Tests 11–12: noise + skill scaling (probabilistic, seeded) ──────────────

  it('seismic skill=1 "gold" estimate is within baseError×2 of true density 0.5 (seed 12345)', () => {
    // gold=0.5 fills the entire centre column across all y-levels; after seismic
    // smearing the column estimate should still be centred on 0.5.
    // baseError=0.15; tolerance = baseError×2 + 0.05 rounding buffer = 0.35
    const grid = new VoxelGrid(11, 11, 11);
    for (let y = 0; y < 11; y++) {
      grid.setVoxel(5, y, 5, {
        rockId: 'granite',
        density: 1,
        oreDensities: { gold: 0.5 },
        fractureModifier: 1.0,
      });
    }
    const params: EstimateSurveyParams = { ...BASE_PARAMS, method: 'seismic', skillLevel: 1 };
    const result = estimateSurveyResult(grid, params, new Random(12345));
    const estimate = result.estimates['5,5']?.['gold'];
    expect(estimate).toBeDefined();
    expect(Math.abs(estimate! - 0.5)).toBeLessThanOrEqual(0.35);
  });

  it('core_sample skill=1 "gold" estimate is within baseError×2 of true density 0.6 (seed 12345)', () => {
    // gold=0.6 fills the entire centre column; core_sample applies noise
    // per-voxel and averages — the column estimate must remain close to 0.6.
    // baseError=0.05; tolerance = baseError×2 + 0.05 rounding buffer = 0.15
    const grid = new VoxelGrid(11, 11, 11);
    for (let y = 0; y < 11; y++) {
      grid.setVoxel(5, y, 5, {
        rockId: 'granite',
        density: 1,
        oreDensities: { gold: 0.6 },
        fractureModifier: 1.0,
      });
    }
    const params: EstimateSurveyParams = {
      ...BASE_PARAMS,
      method: 'core_sample',
      skillLevel: 1,
      centerX: 5,
      centerZ: 5,
    };
    const result = estimateSurveyResult(grid, params, new Random(12345));
    const estimate = result.estimates['5,5']?.['gold'];
    expect(estimate).toBeDefined();
    expect(Math.abs(estimate! - 0.6)).toBeLessThanOrEqual(0.15);
  });

  // ── Tests 13–14: aerial-specific behaviour ──────────────────────────────────

  it('aerial survey only returns column keys whose Euclidean distance from centre is ≤ 30', () => {
    // makeAerialGrid() is 101×10×101 with ore everywhere; corners are ~70.7 cells
    // from centre (50,50) so a correct radius-30 filter must exclude them.
    const params: EstimateSurveyParams = {
      ...BASE_PARAMS,
      method: 'aerial',
      centerX: 50,
      centerZ: 50,
      skillLevel: 1,
    };
    const result = estimateSurveyResult(makeAerialGrid(), params, new Random(12345));
    // Sanity check: the survey must have produced at least one column estimate.
    expect(Object.keys(result.estimates).length).toBeGreaterThan(0);
    for (const colKey of Object.keys(result.estimates)) {
      const parts = colKey.split(',');
      const dx = parseInt(parts[0]!, 10) - 50;
      const dz = parseInt(parts[1]!, 10) - 50;
      const dist = Math.sqrt(dx * dx + dz * dz);
      expect(dist).toBeLessThanOrEqual(30);
    }
  });

  it('aerial survey includes an ore entry for a column whose surface voxel contains known ores', () => {
    // A single solid 'basalt' voxel with silver=0.35 sits at y=7 in column (50,*,50).
    // All y > 7 are air, so surface detection (scan top→down) finds y=7 as the
    // topmost solid → surfaceY = 8.  Aerial samples y=8 (air) and y=7 (silver).
    // The 'silver' ore key must therefore appear in estimates['50,50'].
    const grid = new VoxelGrid(101, 10, 101);
    grid.setVoxel(50, 7, 50, {
      rockId: 'basalt',
      density: 1,
      oreDensities: { silver: 0.35 },
      fractureModifier: 1.0,
    });
    const params: EstimateSurveyParams = {
      ...BASE_PARAMS,
      method: 'aerial',
      centerX: 50,
      centerZ: 50,
      skillLevel: 1,
    };
    const result = estimateSurveyResult(grid, params, new Random(12345));
    const colEstimates = result.estimates['50,50'];
    expect(colEstimates).toBeDefined();
    expect(colEstimates!['silver']).toBeDefined();
  });
});
