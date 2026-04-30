import { describe, it, expect } from 'vitest';
import * as SurveyCalcModule from '../../../src/core/mining/SurveyCalc.js';
import { SURVEY_METHODS } from '../../../src/core/mining/SurveyCalc.js';
import type { SurveyMethod, SurveyResult } from '../../../src/core/mining/SurveyCalc.js';

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
