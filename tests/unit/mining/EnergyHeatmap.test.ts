// BlastSimulator2026 — energy heatmap model: column summaries, sections, cached plan heatmap (#2200)
import { describe, it, expect, beforeEach } from 'vitest';
import {
  summarizeColumn,
  summarizeColumns,
  sectionAtZ,
  planHeatmap,
} from '../../../src/core/mining/EnergyHeatmap.js';
import { previewPlanBands, type PlanBandCell, type PlanBandMap } from '../../../src/core/mining/SoftwarePreview.js';
import {
  classifyFragmentationBand,
  FRAGMENTATION_BANDS,
  type FragmentationBand,
} from '../../../src/core/mining/FragmentationBand.js';
import {
  HEATMAP_COLUMN_BAND_MIN_SHARE,
  FRAGMENTATION_MULTIPLIER,
  CRACKED_VOXEL_ENERGY_RATIO,
  FRAGMENTATION_BAND_FINES_MIN,
  FRAGMENTATION_BAND_DUST_MIN,
} from '../../../src/core/config/balance.js';
import { createGridPlan } from '../../../src/core/mining/DrillPlan.js';
import { batchCharge } from '../../../src/core/mining/ChargePlan.js';
import { assembleBlastPlan } from '../../../src/core/mining/BlastPlan.js';
import { makeTestPlan } from './softwareTestFixtures.js';

const holeCounter = { nextHoleId: 1 };
beforeEach(() => { holeCounter.nextHoleId = 1; });

// One intensity squarely inside each band.
const INTACT = 0.1;
const CRACKED = (CRACKED_VOXEL_ENERGY_RATIO + FRAGMENTATION_MULTIPLIER) / 2;
const GOOD = (FRAGMENTATION_MULTIPLIER + FRAGMENTATION_BAND_FINES_MIN) / 2;
const FINES = (FRAGMENTATION_BAND_FINES_MIN + FRAGMENTATION_BAND_DUST_MIN) / 2;
const DUST = FRAGMENTATION_BAND_DUST_MIN * 3;

const repeat = (intensity: number, n: number): number[] => Array.from({ length: n }, () => intensity);

describe('EnergyHeatmap — the fixture intensities sit in their bands', () => {
  it('maps each constant to its own band', () => {
    expect([INTACT, CRACKED, GOOD, FINES, DUST].map(classifyFragmentationBand)).toEqual(['intact', 'cracked', 'good', 'fines', 'dust']);
  });

  it('HEATMAP_COLUMN_BAND_MIN_SHARE is 0.15', () => {
    expect(HEATMAP_COLUMN_BAND_MIN_SHARE).toBe(0.15);
  });
});

describe('EnergyHeatmap — summarizeColumn', () => {
  it('a column of one band shows that band with every voxel counted', () => {
    const s = summarizeColumn(repeat(GOOD, 6));
    expect(s.band).toBe('good');
    expect(s.worstBand).toBe('good');
    expect(s.goodShare).toBe(1);
    expect(s.counts.good).toBe(6);
    for (const b of FRAGMENTATION_BANDS.filter(b => b !== 'good')) expect(s.counts[b], b).toBe(0);
  });

  it('counts voxels per band and sums to the column length', () => {
    const s = summarizeColumn([INTACT, INTACT, CRACKED, GOOD, GOOD, GOOD, FINES, DUST]);
    expect(s.counts).toEqual({ intact: 2, cracked: 1, good: 3, fines: 1, dust: 1 });
    expect(Object.values(s.counts).reduce((a, b) => a + b, 0)).toBe(8);
  });

  it('goodShare is the good voxels over all filled voxels', () => {
    expect(summarizeColumn([GOOD, INTACT, INTACT, INTACT]).goodShare).toBeCloseTo(0.25, 10);
    expect(summarizeColumn([INTACT, INTACT]).goodShare).toBe(0);
  });

  it('maxIntensity is the largest voxel intensity of the column', () => {
    expect(summarizeColumn([0.3, 7.5, 2.2, 0]).maxIntensity).toBe(7.5);
    expect(summarizeColumn([0.3]).maxIntensity).toBe(0.3);
  });

  it('worstBand is the finest band present, however few voxels', () => {
    const s = summarizeColumn([...repeat(INTACT, 30), DUST]);
    expect(s.worstBand).toBe('dust');
  });

  it('a band under the share floor does not set the displayed band', () => {
    // 1 dust voxel of 10 = 10% < 15%: the column reads as its next band that clears the floor.
    const s = summarizeColumn([...repeat(INTACT, 9), DUST]);
    expect(s.band).toBe('intact');
    expect(s.worstBand).toBe('dust');
  });

  it('a band at exactly the share floor does set the displayed band', () => {
    // 3 of 20 = 15%.
    const s = summarizeColumn([...repeat(INTACT, 17), ...repeat(DUST, 3)]);
    expect(s.band).toBe('dust');
  });

  it('just under the floor does not', () => {
    // 2 of 14 = 14.3% < 15%.
    const s = summarizeColumn([...repeat(INTACT, 12), ...repeat(DUST, 2)]);
    expect(s.band).toBe('intact');
  });

  it('the displayed band is the finest band that clears the floor, not the most common', () => {
    const s = summarizeColumn([...repeat(INTACT, 6), ...repeat(GOOD, 3), ...repeat(FINES, 1)]);
    // fines 10% misses; good 30% clears and is finer than intact 60%.
    expect(s.band).toBe('good');
  });

  it('with several bands over the floor the finest of them wins', () => {
    const s = summarizeColumn([...repeat(INTACT, 4), ...repeat(CRACKED, 3), ...repeat(GOOD, 2), ...repeat(FINES, 2), ...repeat(DUST, 1)]);
    // dust 1/12 = 8% misses; fines 2/12 = 17% clears.
    expect(s.band).toBe('fines');
  });

  it('displayed band is never finer than worstBand', () => {
    const order = (b: FragmentationBand) => FRAGMENTATION_BANDS.indexOf(b);
    for (const col of [[0.1], [GOOD, DUST], [INTACT, CRACKED, GOOD, FINES, DUST], repeat(FINES, 4)]) {
      const s = summarizeColumn(col);
      expect(order(s.band)).toBeLessThanOrEqual(order(s.worstBand));
    }
  });

  it('a single voxel column shows that voxel\'s band', () => {
    for (const [i, b] of [[INTACT, 'intact'], [CRACKED, 'cracked'], [GOOD, 'good'], [FINES, 'fines'], [DUST, 'dust']] as const) {
      expect(summarizeColumn([i]).band, b).toBe(b);
    }
  });
});

function cell(x: number, y: number, z: number, intensity: number): PlanBandCell {
  return { x, y, z, intensity, band: classifyFragmentationBand(intensity) };
}

function mapOf(cells: PlanBandCell[]): PlanBandMap {
  return {
    bbox: { minX: 0, maxX: 9, minY: 0, maxY: 9, minZ: 0, maxZ: 9 },
    cells: new Map(cells.map(c => [`${c.x},${c.y},${c.z}`, c])),
  };
}

describe('EnergyHeatmap — summarizeColumns', () => {
  it('gives one summary per (x, z) column, carrying its coordinates', () => {
    const map = mapOf([
      cell(1, 0, 1, GOOD), cell(1, 1, 1, GOOD), cell(1, 2, 1, INTACT),
      cell(2, 0, 1, DUST),
      cell(1, 0, 3, FINES), cell(1, 1, 3, FINES),
    ]);
    const cols = summarizeColumns(map);
    expect(cols).toHaveLength(3);
    const at = (x: number, z: number) => cols.find(c => c.x === x && c.z === z)!;

    expect(at(1, 1).counts).toEqual({ intact: 1, cracked: 0, good: 2, fines: 0, dust: 0 });
    expect(at(1, 1).band).toBe('good');
    expect(at(2, 1).band).toBe('dust');
    expect(at(2, 1).maxIntensity).toBe(DUST);
    expect(at(1, 3).band).toBe('fines');
  });

  it('is empty for an empty map', () => {
    expect(summarizeColumns(mapOf([]))).toEqual([]);
  });

  it('agrees with summarizeColumn on each column', () => {
    const map = mapOf([cell(4, 0, 4, 0.2), cell(4, 1, 4, 1.4), cell(4, 2, 4, 5)]);
    const [col] = summarizeColumns(map);
    const { x, z, ...rest } = col!;
    expect({ x, z }).toEqual({ x: 4, z: 4 });
    expect(rest).toEqual(summarizeColumn([0.2, 1.4, 5]));
  });

  it('columns do not bleed into each other across z', () => {
    const cols = summarizeColumns(mapOf([cell(1, 0, 1, DUST), cell(1, 0, 2, INTACT)]));
    expect(cols.find(c => c.z === 1)!.band).toBe('dust');
    expect(cols.find(c => c.z === 2)!.band).toBe('intact');
  });
});

describe('EnergyHeatmap — sectionAtZ', () => {
  const map = mapOf([
    cell(1, 0, 5, GOOD), cell(2, 3, 5, INTACT), cell(3, 1, 5, DUST),
    cell(1, 0, 6, FINES),
    cell(9, 9, 7, GOOD),
  ]);

  it('returns exactly the cells whose z matches', () => {
    const section = sectionAtZ(map, 5);
    expect(section).toHaveLength(3);
    expect(section.every(c => c.z === 5)).toBe(true);
    expect(section.map(c => c.x).sort()).toEqual([1, 2, 3]);
  });

  it('keeps the cells\' own intensity and band', () => {
    const dust = sectionAtZ(map, 5).find(c => c.x === 3)!;
    expect(dust.intensity).toBe(DUST);
    expect(dust.band).toBe('dust');
    expect(dust.y).toBe(1);
  });

  it('is empty for a z with no filled voxel (air cells are omitted, not padded)', () => {
    expect(sectionAtZ(map, 8)).toEqual([]);
    expect(sectionAtZ(mapOf([]), 0)).toEqual([]);
  });

  it('a different z gives a different plane', () => {
    expect(sectionAtZ(map, 6).map(c => c.band)).toEqual(['fines']);
    expect(sectionAtZ(map, 7)).toHaveLength(1);
  });
});

function planFor(amountKg = 5, stemmingM = 2, explosive = 'boomite') {
  const { grid } = makeTestPlan();
  const holes = createGridPlan(holeCounter, { x: 10, z: 10 }, 2, 2, 3, 6, 0.15);
  const depths: Record<string, number> = {};
  for (const h of holes) depths[h.id] = h.depth;
  const { charges } = batchCharge(holes.map(h => h.id), depths, explosive, amountKg, stemmingM);
  return { grid, holes, plan: assembleBlastPlan(holes, charges) };
}

describe('EnergyHeatmap — planHeatmap', () => {
  it('its bands are the plan\'s previewPlanBands', () => {
    const { grid, plan } = makeTestPlan();
    const { bands } = planHeatmap(plan, grid);
    const direct = previewPlanBands(plan, grid);
    expect(bands.bbox).toEqual(direct.bbox);
    expect([...bands.cells.entries()]).toEqual([...direct.cells.entries()]);
  });

  it('its columns are the summaries of those bands', () => {
    const { grid, plan } = makeTestPlan();
    const { bands, columns } = planHeatmap(plan, grid);
    expect(columns).toEqual(summarizeColumns(bands));
    expect(columns.length).toBeGreaterThan(0);
  });

  it('is empty for a plan with no holes', () => {
    const { grid } = makeTestPlan();
    const result = planHeatmap(assembleBlastPlan([], {}), grid);
    expect(result.bands.cells.size).toBe(0);
    expect(result.columns).toEqual([]);
  });

  it('is empty for holes with no charge', () => {
    const { grid, holes } = planFor();
    const result = planHeatmap(assembleBlastPlan(holes, {}), grid);
    expect(result.bands.cells.size).toBe(0);
    expect(result.columns).toEqual([]);
  });

  it('is cached: the same inputs hand back the same result', () => {
    const { grid, plan } = makeTestPlan();
    const first = planHeatmap(plan, grid);
    const second = planHeatmap(plan, grid);
    expect(second.bands).toBe(first.bands);
    expect(second.columns).toBe(first.columns);
  });

  it('is cached across an unchanged wet set passed as a fresh object', () => {
    const { grid, plan } = makeTestPlan();
    const first = planHeatmap(plan, grid, new Set([plan.holes[0]!.id]));
    const second = planHeatmap(plan, grid, new Set([plan.holes[0]!.id]));
    expect(second.bands).toBe(first.bands);
  });

  it('recomputes when a charge changes', () => {
    const { grid, plan } = planFor(3, 2);
    const before = planHeatmap(plan, grid);
    const heavier = { ...plan.charges, [plan.holes[0]!.id]: { explosiveId: 'boomite', amountKg: 8, stemmingM: 2 } };
    const after = planHeatmap(assembleBlastPlan(plan.holes, heavier), grid);
    expect(after.bands).not.toBe(before.bands);
    const peak = (m: PlanBandMap) => Math.max(...[...m.cells.values()].map(c => c.intensity));
    expect(peak(after.bands)).toBeGreaterThan(peak(before.bands));
  });

  it('recomputes when a charge is changed in place on the same plan object', () => {
    const { grid, plan } = planFor(3, 2);
    const before = planHeatmap(plan, grid);
    plan.charges[plan.holes[0]!.id] = { explosiveId: 'boomite', amountKg: 8, stemmingM: 2 };
    const after = planHeatmap(plan, grid);
    expect(after.bands).not.toBe(before.bands);
  });

  it('recomputes when stemming changes', () => {
    const { grid, plan } = planFor(3, 4);
    const before = planHeatmap(plan, grid);
    plan.charges[plan.holes[0]!.id] = { explosiveId: 'boomite', amountKg: 3, stemmingM: 1 };
    const after = planHeatmap(plan, grid);
    expect(after.bands).not.toBe(before.bands);
    expect([...after.bands.cells.values()].map(c => c.intensity))
      .not.toEqual([...before.bands.cells.values()].map(c => c.intensity));
  });

  it('recomputes when a hole is added', () => {
    const { grid, plan } = planFor();
    const before = planHeatmap(plan, grid);
    const extra = createGridPlan(holeCounter, { x: 16, z: 16 }, 1, 1, 3, 6, 0.15)[0]!;
    const more = assembleBlastPlan([...plan.holes, extra], { ...plan.charges, [extra.id]: { explosiveId: 'boomite', amountKg: 5, stemmingM: 2 } });
    const after = planHeatmap(more, grid);
    expect(after.bands).not.toBe(before.bands);
    expect(after.columns.length).toBeGreaterThanOrEqual(before.columns.length);
  });

  it('recomputes when hole water changes the wet set', () => {
    const { grid, plan } = planFor(8, 1, 'big_bada_boom');
    const dry = planHeatmap(plan, grid);
    const wet = planHeatmap(plan, grid, new Set(plan.holes.map(h => h.id)));
    expect(wet.bands).not.toBe(dry.bands);
    const total = (m: PlanBandMap) => [...m.cells.values()].reduce((a, c) => a + c.intensity, 0);
    expect(total(wet.bands)).toBeLessThan(total(dry.bands));
  });

  it('recomputes when the grid is edited', () => {
    const { grid, plan } = makeTestPlan();
    const before = planHeatmap(plan, grid);
    grid.setVoxel(10, 4, 10, { composition: { rocks: [] }, density: 0, oreDensities: {}, fractureModifier: 1 });
    const after = planHeatmap(plan, grid);
    expect(after.bands).not.toBe(before.bands);
    expect(after.bands.cells.has('10,4,10')).toBe(false);
    expect(before.bands.cells.has('10,4,10')).toBe(true);
  });

  it('recomputes for a different grid, never serving another grid\'s bands', () => {
    const a = makeTestPlan();
    const b = makeTestPlan();
    const first = planHeatmap(a.plan, a.grid);
    const second = planHeatmap(a.plan, b.grid);
    expect(second.bands).not.toBe(first.bands);
  });
});
