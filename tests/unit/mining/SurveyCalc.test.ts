import { describe, it, expect } from 'vitest';
import * as SurveyCalcModule from '../../../src/core/mining/SurveyCalc.js';
import { SURVEY_METHODS } from '../../../src/core/mining/SurveyCalc.js';
import type { SurveyMethod, SurveyResult } from '../../../src/core/mining/SurveyCalc.js';
// ── Task 4.2 additions ────────────────────────────────────────────────────────
import { estimateSurveyResult, type EstimateSurveyParams } from '../../../src/core/mining/SurveyCalc.js';
// ── Task 4.3 additions ────────────────────────────────────────────────────────
import { isSurveyStale } from '../../../src/core/mining/SurveyCalc.js';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import { Random } from '../../../src/core/math/Random.js';
// ── Task 4.6 additions ────────────────────────────────────────────────────────
import { createGame } from '../../../src/core/state/GameState.js';
import { SURVEY_COSTS } from '../../../src/core/config/balance.js';
import { hireEmployee, assignSkill } from '../../../src/core/entities/Employee.js';
import {
  runSurvey,
  type RunSurveyParams,
  type RunSurveyResult,
} from '../../../src/core/mining/SurveyCalc.js';
// ── Task 4.7 additions ────────────────────────────────────────────────────────
import {
  computeBlastOreReport,
  type BlastOreReport,
} from '../../../src/core/mining/SurveyCalc.js';
import type { FragmentData } from '../../../src/core/mining/BlastExecution.js';
import { vec3 } from '../../../src/core/math/Vec3.js';

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

// ── 4.3: isSurveyStale ────────────────────────────────────────────────────────

describe('SurveyCalc — isSurveyStale (4.3)', () => {
  // ── Fixture helpers ──────────────────────────────────────────────────────────
  // Build a minimal SurveyResult with a given completedTick. All other fields
  // are taken from BASE_RESULT so the shape always satisfies the interface.
  function makeResult(completedTick: number): SurveyResult {
    return { ...BASE_RESULT, completedTick };
  }

  // ── Boundary: still fresh ────────────────────────────────────────────────────

  it('returns false when 0 ticks have elapsed (currentTick === completedTick)', () => {
    // elapsed = 100 - 100 = 0  →  0 ≤ 100  →  fresh
    const result = makeResult(100);
    expect(isSurveyStale(result, 100)).toBe(false);
  });

  it('returns false when 99 ticks have elapsed (design-doc "fresh" example)', () => {
    // elapsed = 199 - 100 = 99  →  99 ≤ 100  →  fresh
    const result = makeResult(100);
    expect(isSurveyStale(result, 199)).toBe(false);
  });

  it('returns false when exactly 100 ticks have elapsed (inclusive boundary)', () => {
    // elapsed = 200 - 100 = 100  →  100 ≤ 100  →  still fresh, not yet stale
    const result = makeResult(100);
    expect(isSurveyStale(result, 200)).toBe(false);
  });

  // ── Boundary: now stale ──────────────────────────────────────────────────────

  it('returns true when 101 ticks have elapsed (design-doc "stale" example)', () => {
    // elapsed = 201 - 100 = 101  →  101 > 100  →  stale
    const result = makeResult(100);
    expect(isSurveyStale(result, 201)).toBe(true);
  });

  it('returns true when many ticks have elapsed (1000 ticks)', () => {
    // elapsed = 1100 - 100 = 1000  →  1000 > 100  →  stale
    const result = makeResult(100);
    expect(isSurveyStale(result, 1100)).toBe(true);
  });

  // ── Edge: completedTick = 0 ───────────────────────────────────────────────────

  it('returns false when completedTick is 0 and currentTick is 100 (exactly 100 elapsed)', () => {
    // elapsed = 100 - 0 = 100  →  100 ≤ 100  →  fresh
    const result = makeResult(0);
    expect(isSurveyStale(result, 100)).toBe(false);
  });

  it('returns true when completedTick is 0 and currentTick is 101 (101 elapsed)', () => {
    // elapsed = 101 - 0 = 101  →  101 > 100  →  stale
    const result = makeResult(0);
    expect(isSurveyStale(result, 101)).toBe(true);
  });
});

// ── 4.6: runSurvey ────────────────────────────────────────────────────────────

describe('SurveyCalc — runSurvey (4.6)', () => {
  // ── Fixture helpers ──────────────────────────────────────────────────────────

  // Create a fresh GameState pre-loaded with the given cash amount.
  // Seed is fixed (42) for determinism across all 4.6 tests.
  function makeState(cash: number): ReturnType<typeof createGame> {
    return createGame({ seed: 42, startingCash: cash });
  }

  // Add one employee with a 'geology' skill qualification to the given state.
  // Uses a fixed RNG seed (99) to keep name generation deterministic.
  function addGeologySurveyor(state: ReturnType<typeof createGame>): void {
    const rng = new Random(99);
    const { employee } = hireEmployee(state.employees, 'surveyor', rng);
    assignSkill(state.employees, employee.id, 'geology', 1);
  }

  // Reusable valid params; most tests override only what they need via spread.
  const BASE_PARAMS: RunSurveyParams = { method: 'seismic', centerX: 10, centerZ: 20 };

  // ── Insufficient funds ───────────────────────────────────────────────────────

  it('returns { success: false, error: "insufficient_funds" } when cash < SURVEY_COSTS[method]', () => {
    // State has one less dollar than the seismic survey costs (3000).
    // A geology-qualified employee IS present so the funds check is isolated.
    const state = makeState(SURVEY_COSTS.seismic - 1);
    addGeologySurveyor(state);

    const result = runSurvey(state, BASE_PARAMS);

    expect(result).toEqual({ success: false, error: 'insufficient_funds' });
  });

  it('does not deduct cash when funds are insufficient', () => {
    // Verify the guard returns before mutating state.cash.
    const cashBefore = SURVEY_COSTS.seismic - 1;
    const state = makeState(cashBefore);
    addGeologySurveyor(state);

    runSurvey(state, BASE_PARAMS);

    expect(state.cash).toBe(cashBefore);
  });

  // ── No surveyor ──────────────────────────────────────────────────────────────

  it('returns { success: false, error: "no_surveyor" } when no geology-qualified employee exists', () => {
    // State has ample cash (funds check passes) but zero employees.
    const state = makeState(SURVEY_COSTS.seismic + 5000);

    const result = runSurvey(state, BASE_PARAMS);

    expect(result).toEqual({ success: false, error: 'no_surveyor' });
  });

  it('does not deduct cash when no surveyor is available', () => {
    // Guard must bail out before touching state.cash when surveyor is missing.
    const cashBefore = SURVEY_COSTS.seismic + 5000;
    const state = makeState(cashBefore);

    runSurvey(state, BASE_PARAMS);

    expect(state.cash).toBe(cashBefore);
  });

  // ── Success path ─────────────────────────────────────────────────────────────

  it('returns { success: true } when funds and surveyor are both available', () => {
    const state = makeState(SURVEY_COSTS.seismic + 5000);
    addGeologySurveyor(state);

    const result = runSurvey(state, BASE_PARAMS);

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('deducts SURVEY_COSTS[method] from state.cash on success', () => {
    // Uses core_sample (800) to confirm the cost is method-specific.
    const startCash = SURVEY_COSTS.core_sample + 1000;
    const state = makeState(startCash);
    addGeologySurveyor(state);

    runSurvey(state, { method: 'core_sample', centerX: 5, centerZ: 5 });

    expect(state.cash).toBe(startCash - SURVEY_COSTS.core_sample);
  });

  // ── Pending action enqueue ───────────────────────────────────────────────────

  it("enqueues a PendingAction with type 'survey' and requiredSkill 'geology'", () => {
    const state = makeState(SURVEY_COSTS.seismic + 5000);
    addGeologySurveyor(state);

    runSurvey(state, BASE_PARAMS);

    expect(state.pendingActions).toHaveLength(1);
    const action = state.pendingActions[0]!;
    expect(action.type).toBe('survey');
    expect(action.requiredSkill).toBe('geology');
  });

  it('enqueued action payload contains correct centerX and centerZ', () => {
    // Uses aerial + non-default coordinates to verify payload is not hard-coded.
    const state = makeState(SURVEY_COSTS.aerial + 5000);
    addGeologySurveyor(state);
    const params: RunSurveyParams = { method: 'aerial', centerX: 15, centerZ: 30 };

    runSurvey(state, params);

    const action = state.pendingActions[0]!;
    expect(action.payload).toMatchObject({ method: 'aerial', centerX: 15, centerZ: 30 });
  });

  it('increments nextPendingActionId after enqueueing the action', () => {
    // nextPendingActionId starts at 1 (createGame default); must become 2 after one call.
    const state = makeState(SURVEY_COSTS.seismic + 5000);
    addGeologySurveyor(state);
    const idBefore = state.nextPendingActionId;

    runSurvey(state, BASE_PARAMS);

    expect(state.nextPendingActionId).toBe(idBefore + 1);
  });

  // ── Ghost preview ────────────────────────────────────────────────────────────

  it('adds a ghost preview entry whose id matches the enqueued PendingAction id', () => {
    // Ghost previews drive renderer overlays — id linkage to PendingAction is mandatory.
    const state = makeState(SURVEY_COSTS.seismic + 5000);
    addGeologySurveyor(state);

    runSurvey(state, BASE_PARAMS);

    expect(state.ghostPreviews).toHaveLength(1);
    const preview = state.ghostPreviews[0]!;
    expect(preview.type).toBe('survey');
    expect(preview.id).toBe(state.pendingActions[0]!.id);
  });
});

// ── 4.7: computeBlastOreReport ───────────────────────────────────────────────

describe('SurveyCalc — computeBlastOreReport (4.7)', () => {
  // ── Fixture helpers ──────────────────────────────────────────────────────────

  /**
   * Build a minimal FragmentData with configurable position, volume, and
   * oreDensities. All non-ore fields are fixed so tests stay focused on yield.
   */
  function makeFragment(
    id: number,
    position: ReturnType<typeof vec3>,
    volume: number,
    oreDensities: Record<string, number>,
  ): FragmentData {
    return {
      id,
      position,
      volume,
      mass: 1000,
      rockId: 'granite',
      oreDensities,
      initialVelocity: vec3(0, 0, 0),
      isProjection: false,
    };
  }

  /**
   * Build a minimal SurveyResult with configurable estimates and completedTick.
   * All other fields are fixed to keep survey-comparison tests unambiguous.
   */
  function makeSurvey(
    estimates: Record<string, Record<string, number>>,
    completedTick = 10,
  ): SurveyResult {
    return {
      id: 1,
      method: 'seismic',
      centerX: 0,
      centerZ: 0,
      completedTick,
      surveyorId: 1,
      estimates,
      confidence: 0.8,
    };
  }

  // ── a. Export presence ───────────────────────────────────────────────────────

  it('computeBlastOreReport is exported as a function', () => {
    // The named export must exist and be callable; if not implemented the
    // import resolves to undefined and typeof returns 'undefined'.
    expect(typeof computeBlastOreReport).toBe('function');
  });

  // ── b. Return shape ──────────────────────────────────────────────────────────

  it('return value has all 6 required BlastOreReport fields', () => {
    // Every field of BlastOreReport must be present on the returned object so
    // callers can destructure without optional-chaining guards.
    const report: BlastOreReport = computeBlastOreReport([]);
    expect(report).toHaveProperty('oreYields');
    expect(report).toHaveProperty('totalYieldKg');
    expect(report).toHaveProperty('estimatedYieldKg');
    expect(report).toHaveProperty('yieldRatio');
    expect(report).toHaveProperty('hasTreranium');
    expect(report).toHaveProperty('absurdiumFraction');
  });

  // ── c. Empty fragments ───────────────────────────────────────────────────────

  it('returns an all-zero/default report when the fragment array is empty', () => {
    // No rock was blasted → no ore, no estimates, ratio defaults to 1.0.
    const report = computeBlastOreReport([]);
    expect(report.totalYieldKg).toBe(0);
    expect(report.estimatedYieldKg).toBe(0);
    expect(report.yieldRatio).toBe(1.0);
    expect(report.hasTreranium).toBe(false);
    expect(report.absurdiumFraction).toBe(0);
    expect(Object.keys(report.oreYields)).toHaveLength(0);
  });

  // ── d. Single-ore fragment ───────────────────────────────────────────────────

  it('computes ore mass as volume × density × 2500 for a single-ore fragment', () => {
    // volume=2.0, rustite density=0.5  →  2.0 × 0.5 × 2500 = 2500 kg
    const fragment = makeFragment(0, vec3(10, 5, 10), 2.0, { rustite: 0.5 });
    const report = computeBlastOreReport([fragment]);
    expect(report.oreYields['rustite']).toBeCloseTo(2500, 5);
  });

  // ── e. Multi-ore fragment ────────────────────────────────────────────────────

  it('correctly sums multiple ore types within a single fragment', () => {
    // volume=1.0, rustite=0.4 → 1000 kg; blingite=0.3 → 750 kg
    // Both ore entries must be independently correct; no cross-ore contamination.
    const fragment = makeFragment(0, vec3(0, 0, 0), 1.0, { rustite: 0.4, blingite: 0.3 });
    const report = computeBlastOreReport([fragment]);
    expect(report.oreYields['rustite']).toBeCloseTo(1000, 5);
    expect(report.oreYields['blingite']).toBeCloseTo(750, 5);
  });

  // ── f. Multiple fragments ────────────────────────────────────────────────────

  it('accumulates ore yields correctly across multiple fragments', () => {
    // frag1: volume=1.0, rustite=0.2  →  500 kg
    // frag2: volume=2.0, rustite=0.3  → 1500 kg
    // combined rustite                → 2000 kg
    const frag1 = makeFragment(0, vec3(0, 0, 0), 1.0, { rustite: 0.2 });
    const frag2 = makeFragment(1, vec3(10, 0, 10), 2.0, { rustite: 0.3 });
    const report = computeBlastOreReport([frag1, frag2]);
    expect(report.oreYields['rustite']).toBeCloseTo(2000, 5);
  });

  // ── g. hasTreranium = false ──────────────────────────────────────────────────

  it('hasTreranium is false when no fragments contain treranium', () => {
    // Only rustite is present; the legendary-vein flag must stay false.
    const fragment = makeFragment(0, vec3(0, 0, 0), 1.0, { rustite: 0.8 });
    const report = computeBlastOreReport([fragment]);
    expect(report.hasTreranium).toBe(false);
  });

  // ── h. hasTreranium = true ───────────────────────────────────────────────────

  it('hasTreranium is true when at least one fragment contains treranium', () => {
    // frag2 carries even a small treranium density → flag must fire.
    const frag1 = makeFragment(0, vec3(0, 0, 0), 1.0, { rustite: 0.5 });
    const frag2 = makeFragment(1, vec3(5, 0, 5), 1.0, { treranium: 0.1 });
    const report = computeBlastOreReport([frag1, frag2]);
    expect(report.hasTreranium).toBe(true);
  });

  // ── i. absurdiumFraction ─────────────────────────────────────────────────────

  it('absurdiumFraction is the correct proportion of total yield when absurdium is present', () => {
    // volume=1.0, rustite=0.5 → 1250 kg; absurdium=0.5 → 1250 kg
    // total = 2500 kg  →  absurdiumFraction = 1250 / 2500 = 0.5
    const fragment = makeFragment(0, vec3(0, 0, 0), 1.0, { rustite: 0.5, absurdium: 0.5 });
    const report = computeBlastOreReport([fragment]);
    expect(report.absurdiumFraction).toBeCloseTo(0.5, 5);
  });

  // ── j. absurdiumFraction = 0 ─────────────────────────────────────────────────

  it('absurdiumFraction is 0 when no absurdium is present', () => {
    // No absurdium ore in the blast → fraction must be exactly 0, not NaN.
    const fragment = makeFragment(0, vec3(0, 0, 0), 1.0, { rustite: 0.8, blingite: 0.2 });
    const report = computeBlastOreReport([fragment]);
    expect(report.absurdiumFraction).toBe(0);
  });

  // ── k. No survey provided ─────────────────────────────────────────────────────

  it('estimatedYieldKg is 0 and yieldRatio is 1.0 when no surveyResults argument is provided', () => {
    // Without a survey the comparison baseline is undefined;
    // spec mandates estimatedYieldKg=0 and yieldRatio=1.0 as neutral defaults.
    const fragment = makeFragment(0, vec3(5, 3, 8), 2.0, { rustite: 0.5 });
    const report = computeBlastOreReport([fragment]);
    expect(report.estimatedYieldKg).toBe(0);
    expect(report.yieldRatio).toBe(1.0);
  });

  // ── l. Survey matching column ─────────────────────────────────────────────────

  it('computes estimatedYieldKg and yieldRatio correctly when a survey column matches a fragment', () => {
    // Fragment at (5, 3, 8): Math.round(5)=5, Math.round(8)=8 → column key "5,8"
    // Actual:   volume=2.0 × rustite density 0.5 × 2500 = 2500 kg
    // Estimate: volume=2.0 × survey density 0.4 × 2500 = 2000 kg
    // yieldRatio = 2500 / 2000 = 1.25
    const fragment = makeFragment(0, vec3(5, 3, 8), 2.0, { rustite: 0.5 });
    const survey = makeSurvey({ '5,8': { rustite: 0.4 } });
    const report = computeBlastOreReport([fragment], [survey]);
    expect(report.estimatedYieldKg).toBeCloseTo(2000, 5);
    expect(report.yieldRatio).toBeCloseTo(1.25, 5);
  });

  // ── m. Survey with no coverage ────────────────────────────────────────────────

  it('estimatedYieldKg is 0 and yieldRatio is 1.0 when no survey column key matches any fragment', () => {
    // Fragment column key "5,8" but survey only covers "0,0" → no overlap.
    // With no estimate available the function must fall back to neutral defaults.
    const fragment = makeFragment(0, vec3(5, 3, 8), 2.0, { rustite: 0.5 });
    const survey = makeSurvey({ '0,0': { rustite: 0.4 } });
    const report = computeBlastOreReport([fragment], [survey]);
    expect(report.estimatedYieldKg).toBe(0);
    expect(report.yieldRatio).toBe(1.0);
  });

  // ── n. totalYieldKg ───────────────────────────────────────────────────────────

  it('totalYieldKg equals the sum of all per-ore oreYields values', () => {
    // volume=1.0, rustite=0.2 → 500 kg, blingite=0.3 → 750 kg, total = 1250 kg
    // totalYieldKg must equal the arithmetic sum of every value in oreYields.
    const fragment = makeFragment(0, vec3(0, 0, 0), 1.0, { rustite: 0.2, blingite: 0.3 });
    const report = computeBlastOreReport([fragment]);
    const sumOfOreYields = Object.values(report.oreYields).reduce((s, v) => s + v, 0);
    expect(report.totalYieldKg).toBeCloseTo(sumOfOreYields, 5);
    expect(report.totalYieldKg).toBeCloseTo(1250, 5);
  });
});
