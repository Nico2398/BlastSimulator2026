// BlastSimulator2026 — Survey cost constants (4.5)
// Verifies SURVEY_COSTS and SURVEY_DURATION_TICKS are exported from balance.ts
// with the exact values specified in the survey system design doc.

import { describe, it, expect } from 'vitest';
import {
  SURVEY_COSTS,
  SURVEY_DURATION_TICKS,
} from '../../../src/core/config/balance.js';

// ─── Task 4.5: SURVEY_COSTS ───────────────────────────────────────────────────

describe('SURVEY_COSTS (4.5)', () => {
  // ── Presence ─────────────────────────────────────────────────────────────

  it('SURVEY_COSTS is exported from balance.ts', () => {
    expect(SURVEY_COSTS).toBeDefined();
  });

  it('SURVEY_COSTS has exactly three keys — one per survey method', () => {
    expect(Object.keys(SURVEY_COSTS)).toHaveLength(3);
  });

  it('SURVEY_COSTS contains the keys seismic, core_sample, and aerial', () => {
    const keys = Object.keys(SURVEY_COSTS);
    expect(keys).toContain('seismic');
    expect(keys).toContain('core_sample');
    expect(keys).toContain('aerial');
  });

  // ── Exact values ──────────────────────────────────────────────────────────

  it('SURVEY_COSTS.seismic is 3000 — seismic is the most expensive survey method', () => {
    expect(SURVEY_COSTS.seismic).toBe(3000);
  });

  it('SURVEY_COSTS.core_sample is 800 — core sample is the cheapest survey method', () => {
    expect(SURVEY_COSTS.core_sample).toBe(800);
  });

  it('SURVEY_COSTS.aerial is 1500 — aerial survey is the mid-range method', () => {
    expect(SURVEY_COSTS.aerial).toBe(1500);
  });

  // ── Structural invariants ─────────────────────────────────────────────────

  it('seismic cost exceeds aerial cost — wider area coverage commands a higher price', () => {
    expect(SURVEY_COSTS.seismic).toBeGreaterThan(SURVEY_COSTS.aerial);
  });

  it('aerial cost exceeds core_sample cost — aerial still more expensive than basic spot-sampling', () => {
    expect(SURVEY_COSTS.aerial).toBeGreaterThan(SURVEY_COSTS.core_sample);
  });
});

// ─── Task 4.5: SURVEY_DURATION_TICKS ─────────────────────────────────────────

describe('SURVEY_DURATION_TICKS (4.5)', () => {
  // ── Presence ─────────────────────────────────────────────────────────────

  it('SURVEY_DURATION_TICKS is exported from balance.ts', () => {
    expect(SURVEY_DURATION_TICKS).toBeDefined();
  });

  it('SURVEY_DURATION_TICKS has exactly three keys — one per survey method', () => {
    expect(Object.keys(SURVEY_DURATION_TICKS)).toHaveLength(3);
  });

  it('SURVEY_DURATION_TICKS contains the keys seismic, core_sample, and aerial', () => {
    const keys = Object.keys(SURVEY_DURATION_TICKS);
    expect(keys).toContain('seismic');
    expect(keys).toContain('core_sample');
    expect(keys).toContain('aerial');
  });

  // ── Exact values ──────────────────────────────────────────────────────────

  it('SURVEY_DURATION_TICKS.seismic is 8 — seismic ground analysis takes 8 game-hours', () => {
    expect(SURVEY_DURATION_TICKS.seismic).toBe(8);
  });

  it('SURVEY_DURATION_TICKS.core_sample is 4 — drilling a core sample takes 4 game-hours', () => {
    expect(SURVEY_DURATION_TICKS.core_sample).toBe(4);
  });

  it('SURVEY_DURATION_TICKS.aerial is 3 — aerial flyover is the fastest method at 3 game-hours', () => {
    expect(SURVEY_DURATION_TICKS.aerial).toBe(3);
  });

  // ── Structural invariants ─────────────────────────────────────────────────

  it('seismic duration exceeds core_sample duration — seismic is the slowest method', () => {
    expect(SURVEY_DURATION_TICKS.seismic).toBeGreaterThan(SURVEY_DURATION_TICKS.core_sample);
  });

  it('core_sample duration exceeds aerial duration — drilling takes longer than a flyover', () => {
    expect(SURVEY_DURATION_TICKS.core_sample).toBeGreaterThan(SURVEY_DURATION_TICKS.aerial);
  });
});
