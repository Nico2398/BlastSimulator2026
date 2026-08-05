// BlastSimulator2026 — estimateBlastOreValue unit tests

import { describe, it, expect } from 'vitest';
import { estimateBlastOreValue } from '../../../src/core/mining/BlastValueEstimate.js';
import type { BlastPlan } from '../../../src/core/mining/BlastPlan.js';
import type { DrillHole } from '../../../src/core/mining/DrillPlan.js';
import type { SurveyResult } from '../../../src/core/mining/SurveyCalc.js';

function makeHole(id: string, x: number, z: number, depth = 8): DrillHole {
  return { id, x, z, depth, diameter: 0.15 };
}

function makePlan(holes: DrillHole[]): BlastPlan {
  return { holes, charges: {}, delays: {} };
}

function makeSurvey(
  estimates: Record<string, Record<string, number>>,
  confidence = 1.0,
  completedTick = 10,
): SurveyResult {
  return {
    id: 1,
    method: 'seismic',
    centerX: 10,
    centerZ: 10,
    completedTick,
    surveyorId: 1,
    estimates,
    confidence,
  };
}

describe('estimateBlastOreValue', () => {
  it('values a surveyed hole as depth × density × ORE_DENSITY_KG_M3 × valuePerKg × confidence', () => {
    const plan = makePlan([makeHole('H1', 10, 10, 8)]);
    const survey = makeSurvey({ '10,10': { blingite: 0.2 } }, 1.0);

    // massKg = 8m depth × 1m² column × 0.2 density × 2500 kg/m³ = 4000kg
    // value = 4000kg × $25/kg (blingite) × 1.0 confidence = $100,000
    expect(estimateBlastOreValue(plan, [survey])).toBeCloseTo(100_000, 6);
  });

  it('scales linearly with survey confidence', () => {
    const plan = makePlan([makeHole('H1', 10, 10, 8)]);
    const halfConfidence = makeSurvey({ '10,10': { blingite: 0.2 } }, 0.5);

    expect(estimateBlastOreValue(plan, [halfConfidence])).toBeCloseTo(50_000, 6);
  });

  it('sums contributions across every hole in the plan', () => {
    const plan = makePlan([makeHole('H1', 10, 10, 8), makeHole('H2', 20, 20, 8)]);
    const survey = makeSurvey({
      '10,10': { blingite: 0.2 },
      '20,20': { blingite: 0.2 },
    });

    expect(estimateBlastOreValue(plan, [survey])).toBeCloseTo(200_000, 6);
  });

  it('returns 0 for a hole whose column no survey covers', () => {
    const plan = makePlan([makeHole('H1', 10, 10, 8)]);
    const survey = makeSurvey({ '99,99': { blingite: 0.2 } });

    expect(estimateBlastOreValue(plan, [survey])).toBe(0);
  });

  it('returns 0 when no surveys have been run', () => {
    const plan = makePlan([makeHole('H1', 10, 10, 8)]);

    expect(estimateBlastOreValue(plan, [])).toBe(0);
  });

  it('returns 0 for an empty plan', () => {
    const survey = makeSurvey({ '10,10': { blingite: 0.2 } });

    expect(estimateBlastOreValue(makePlan([]), [survey])).toBe(0);
  });

  it('skips ore IDs the catalog does not recognize instead of throwing', () => {
    const plan = makePlan([makeHole('H1', 10, 10, 8)]);
    const survey = makeSurvey({ '10,10': { unobtainium: 0.5 } });

    expect(() => estimateBlastOreValue(plan, [survey])).not.toThrow();
    expect(estimateBlastOreValue(plan, [survey])).toBe(0);
  });

  it('uses the most recently completed survey when several cover the same column', () => {
    const plan = makePlan([makeHole('H1', 10, 10, 8)]);
    const stale = makeSurvey({ '10,10': { blingite: 0.8 } }, 1.0, 1);
    const fresh = makeSurvey({ '10,10': { blingite: 0.2 } }, 1.0, 50);

    // Picks `fresh` (later completedTick): 8 × 0.2 × 2500 × $25 = $100,000, not the stale $400,000.
    expect(estimateBlastOreValue(plan, [stale, fresh])).toBeCloseTo(100_000, 6);
  });
});
