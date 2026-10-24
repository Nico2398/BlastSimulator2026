import { describe, it, expect } from 'vitest';
import { floorToKgResolution, mayBuyVehicleTier, shouldBench } from '../../../scripts/shared/probe-ladder.js';
import { formatGradeSummary } from '../../../scripts/shared/probe-report.js';
import { VEHICLE_TIER_UNLOCK_GRADE } from '../../../src/core/config/balance.js';
import type { RunResult } from '../../../scripts/shared/probe-metrics.js';

function run(grades: Record<number, number>, cash: Record<number, number>): RunResult {
  return {
    config: { seed: 42, biome: 'desert_badlands', kit: 'full', strategy: 'ladder', horizon: 1000 },
    metrics: {
      cashAt: { 1000: null, 3000: null, 6000: null, 10000: null }, lowPointCash: 0, lowPointTick: 0, bankruptTick: null,
      firstBlastSoldShareAt6000: null, blastsFired: 0, warehouseFullTick: null, ticksHaulWaitedOnFullStorage: 0,
      boulderSoldShare: null, gradeReachedTick: grades, gradeCashAt: cash, catalogBoughtTick: null,
      boulderOreSoldShare: null, affordableTick: { warehouseT2: null, researchCenter: null, secondHauler: null },
    },
    endTick: 1000,
    endReason: null,
  };
}

describe('formatGradeSummary', () => {
  it('lists reached grades with median tick and verdict, and windowed grades never reached as missed', () => {
    const out = formatGradeSummary([run({ 1: 100, 3: 9000 }, { 1: 5, 3: 77 })]);
    const rows = out.split('\n').slice(2);
    const g1 = rows.find(r => r.includes('| 1 |'))!;
    expect(g1).toContain('1/1');
    expect(g1).toContain('100');
    const g3 = rows.find(r => r.includes('| 3 |'))!;
    expect(g3).toContain('9000');
    expect(g3).toContain('in');
    expect(rows.find(r => r.includes('| 4 |'))).toContain('missed');
  });

  it('takes the median over runs of one group', () => {
    const out = formatGradeSummary([run({ 3: 8000 }, { 3: 1 }), run({ 3: 20000 }, { 3: 1 })]);
    expect(out).toContain('2/2');
  });
});

describe('shouldBench', () => {
  it('is false at exactly the limit and below, true above', () => {
    expect(shouldBench(10, 10)).toBe(false);
    expect(shouldBench(9, 10)).toBe(false);
    expect(shouldBench(10.1, 10)).toBe(true);
  });
});

describe('mayBuyVehicleTier boundaries', () => {
  it('unlocks at exactly the unlock grade, not one below', () => {
    expect(mayBuyVehicleTier(2, VEHICLE_TIER_UNLOCK_GRADE[2] - 1)).toBe(false);
    expect(mayBuyVehicleTier(2, VEHICLE_TIER_UNLOCK_GRADE[2])).toBe(true);
    expect(mayBuyVehicleTier(3, VEHICLE_TIER_UNLOCK_GRADE[3] - 1)).toBe(false);
    expect(mayBuyVehicleTier(3, VEHICLE_TIER_UNLOCK_GRADE[3])).toBe(true);
  });
});

describe('floorToKgResolution', () => {
  it('floors to one decimal', () => {
    expect(floorToKgResolution(7.59)).toBe(7.5);
    expect(floorToKgResolution(4)).toBe(4);
  });
});
