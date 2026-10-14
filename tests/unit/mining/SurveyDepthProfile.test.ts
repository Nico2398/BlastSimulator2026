// BlastSimulator2026 — Depth-resolved survey results (#1683)
import { describe, it, expect } from 'vitest';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import { Random } from '../../../src/core/math/Random.js';
import {
  bandOresAtDepth,
  buildDepthProfile,
  oreDepthSpan,
  type SurveyDepthBand,
} from '../../../src/core/mining/SurveyDepthProfile.js';
import {
  estimateSurveyResult,
  type EstimateSurveyParams,
  type SurveyMethod,
} from '../../../src/core/mining/SurveyCalc.js';
import {
  SURVEY_DEPTH_BAND_METRES,
  SURVEY_DEPTH_BELOW_SURFACE,
  SURVEY_ESTIMATE_STEP,
} from '../../../src/core/config/balance.js';

const SURFACE_Y = 60;

const voxel = (ores: Record<string, number>, density = 1) => ({
  composition: { rocks: [{ rockId: 'granite', coefficient: 1.0 }] },
  density,
  oreDensities: ores,
  fractureModifier: 1.0,
});

/** Column (5,*,5): solid from y=10..60; `oreAt(depthM)` gives the ore of the voxel `depthM` below the surface. */
function makeColumn(oreAt: (depthM: number) => Record<string, number>): VoxelGrid {
  const grid = new VoxelGrid(11, 11);
  for (let y = 10; y <= SURFACE_Y; y++) grid.setVoxel(5, y, 5, voxel(oreAt(SURFACE_Y - y)));
  return grid;
}

/** Ore `ore` (density 1.0) only at 10, 11 and 12 m below the surface. */
const deepSeam = (ore = 'gold') => makeColumn(d => (d >= 10 && d <= 12 ? { [ore]: 1.0 } : {}));
const uniform = (density = 0.5) => makeColumn(() => ({ gold: density }));

function params(method: SurveyMethod, skillLevel = 5): EstimateSurveyParams {
  return { id: 1, method, centerX: 5, centerZ: 5, surveyorId: 1, skillLevel, completedTick: 9 };
}

function survey(grid: VoxelGrid, method: SurveyMethod, seed = 42, skillLevel = 5) {
  return estimateSurveyResult(grid, params(method, skillLevel), new Random(seed));
}

function levels(count: number): number[] {
  return Array.from({ length: count }, (_, i) => SURFACE_Y - i);
}

const isStep = (v: number) => Math.abs(v / SURVEY_ESTIMATE_STEP - Math.round(v / SURVEY_ESTIMATE_STEP)) < 1e-9;

describe('SURVEY_DEPTH_BAND_METRES (#1683)', () => {
  it('core sample resolves 1 m bands, seismic 5 m bands', () => {
    expect(SURVEY_DEPTH_BAND_METRES.core_sample).toBe(1);
    expect(SURVEY_DEPTH_BAND_METRES.seismic).toBe(5);
  });

  it('aerial has no band size', () => {
    expect(Object.keys(SURVEY_DEPTH_BAND_METRES)).not.toContain('aerial');
  });
});

describe('oreDepthSpan (#1683)', () => {
  const bands: SurveyDepthBand[] = [
    { fromM: 0, toM: 5, ores: { gold: 0.2, iron: 0.5 } },
    { fromM: 5, toM: 10, ores: { iron: 0.3 } },
    { fromM: 10, toM: 15, ores: { gold: 0.4 } },
    { fromM: 20, toM: 25, ores: { gold: 0.1 } },
  ];

  it('spans from the first to the last band holding the ore', () => {
    expect(oreDepthSpan(bands, 'gold')).toEqual({ fromM: 0, toM: 25 });
  });

  it('ignores bands holding only other ores', () => {
    expect(oreDepthSpan(bands, 'iron')).toEqual({ fromM: 0, toM: 10 });
  });

  it('a single band gives that band', () => {
    expect(oreDepthSpan([{ fromM: 10, toM: 11, ores: { gold: 0.5 } }], 'gold')).toEqual({ fromM: 10, toM: 11 });
  });

  it('uses min fromM and max toM irrespective of band order', () => {
    expect(oreDepthSpan([...bands].reverse(), 'gold')).toEqual({ fromM: 0, toM: 25 });
  });

  it('is undefined when no band holds the ore', () => {
    expect(oreDepthSpan(bands, 'treranium')).toBeUndefined();
  });

  it('is undefined for undefined bands', () => {
    expect(oreDepthSpan(undefined, 'gold')).toBeUndefined();
  });

  it('is undefined for an empty band list', () => {
    expect(oreDepthSpan([], 'gold')).toBeUndefined();
  });
});

describe('buildDepthProfile (#1683)', () => {
  it('1 m bands: ore only at 10-12 m appears in exactly the bands 10-11, 11-12, 12-13', () => {
    const bands = buildDepthProfile(deepSeam(), 5, 5, levels(40), 1, 0.02, new Random(42));
    expect(bands.map(b => [b.fromM, b.toM])).toEqual([[10, 11], [11, 12], [12, 13]]);
    for (const b of bands) expect(b.ores['gold']).toBeGreaterThan(0.9);
  });

  it('5 m bands: ore only at 10-12 m appears in the single band 10-15', () => {
    const bands = buildDepthProfile(deepSeam(), 5, 5, levels(25), 5, 0.02, new Random(42));
    expect(bands).toHaveLength(1);
    expect(bands[0]!.fromM).toBe(10);
    expect(bands[0]!.toM).toBe(15);
    expect(bands[0]!.ores['gold']).toBeGreaterThan(0);
  });

  it('a column with no ore gives no bands', () => {
    expect(buildDepthProfile(makeColumn(() => ({})), 5, 5, levels(40), 1, 0.05, new Random(1))).toEqual([]);
  });

  it('bands tile the window contiguously from 0 and are clipped to the window', () => {
    const bands = buildDepthProfile(uniform(), 5, 5, levels(40), 5, 0.0, new Random(1));
    expect(bands[0]!.fromM).toBe(0);
    for (let i = 1; i < bands.length; i++) expect(bands[i]!.fromM).toBe(bands[i - 1]!.toM);
    expect(bands[bands.length - 1]!.toM).toBe(40);
  });

  it('a trailing partial band is clipped to the window rather than overrunning it', () => {
    const bands = buildDepthProfile(uniform(), 5, 5, levels(12), 5, 0.0, new Random(1));
    expect(bands.map(b => [b.fromM, b.toM])).toEqual([[0, 5], [5, 10], [10, 12]]);
  });

  it('densities are multiples of 0.05 in (0, 1] and zero densities are omitted', () => {
    const bands = buildDepthProfile(uniform(0.5), 5, 5, levels(40), 1, 0.15, new Random(7));
    expect(bands.length).toBeGreaterThan(0);
    for (const b of bands) {
      expect(Object.keys(b.ores).length).toBeGreaterThan(0);
      for (const d of Object.values(b.ores)) {
        expect(d).toBeGreaterThan(0);
        expect(d).toBeLessThanOrEqual(1);
        expect(isStep(d)).toBe(true);
      }
    }
  });

  it('bands have non-negative, strictly increasing bounds', () => {
    const bands = buildDepthProfile(uniform(), 5, 5, levels(40), 1, 0.05, new Random(3));
    for (const b of bands) {
      expect(b.fromM).toBeGreaterThanOrEqual(0);
      expect(b.toM).toBeGreaterThan(b.fromM);
    }
  });

  it('with no noise a uniform 0.5 column reads 0.5 in every band', () => {
    const bands = buildDepthProfile(uniform(0.5), 5, 5, levels(10), 1, 0, new Random(1));
    expect(bands).toHaveLength(10);
    for (const b of bands) expect(b.ores).toEqual({ gold: 0.5 });
  });

  it('empty (non-solid) voxels never contribute ore', () => {
    const grid = makeColumn(() => ({}));
    grid.setVoxel(5, SURFACE_Y - 5, 5, voxel({ gold: 1.0 }, 0)); // air pocket carrying a stale ore record
    const bands = buildDepthProfile(grid, 5, 5, levels(40), 1, 0, new Random(1));
    expect(bands).toEqual([]);
  });

  it('is deterministic for a seed and varies across seeds', () => {
    const run = (seed: number) => buildDepthProfile(uniform(0.5), 5, 5, levels(40), 1, 0.15, new Random(seed));
    expect(run(11)).toEqual(run(11));
    expect(run(11)).not.toEqual(run(12));
  });
});

describe('estimateSurveyResult depthProfile (#1683)', () => {
  it('core sample reports ore known only at 10-12 m in those 1 m bands', () => {
    const profile = survey(deepSeam(), 'core_sample').depthProfile!['5,5']!;
    expect(profile.map(b => [b.fromM, b.toM])).toEqual([[10, 11], [11, 12], [12, 13]]);
    for (const b of profile) expect(b.ores['gold']).toBeGreaterThan(0);
  });

  it('seismic reports the same ore in the 5 m band containing it', () => {
    const profile = survey(deepSeam(), 'seismic').depthProfile!['5,5']!;
    expect(profile.map(b => [b.fromM, b.toM])).toEqual([[10, 15]]);
    expect(profile[0]!.ores['gold']).toBeGreaterThan(0);
  });

  it('aerial has no depth profile', () => {
    const grid = makeColumn(() => ({ gold: 0.5 }));
    expect(survey(grid, 'aerial').depthProfile).toBeUndefined();
  });

  it('profile columns match the keys of estimates (solid columns with ore)', () => {
    const r = survey(deepSeam(), 'core_sample');
    expect(Object.keys(r.depthProfile!)).toEqual(Object.keys(r.estimates));
  });

  it('ore beyond the seismic 25 m reach never appears in a seismic profile', () => {
    const grid = makeColumn(d => (d <= 20 ? { shally: 1.0 } : d === 30 ? { trentium: 0.8 } : {}));
    const bands = survey(grid, 'seismic').depthProfile!['5,5']!;
    expect(bands.some(b => 'trentium' in b.ores)).toBe(false);
    expect(Math.max(...bands.map(b => b.toM))).toBeLessThanOrEqual(SURVEY_DEPTH_BELOW_SURFACE.seismic);
  });

  it('a core sample sees the 30 m ore a seismic survey misses, in the 30-31 m band', () => {
    const grid = makeColumn(d => (d <= 20 ? { shally: 1.0 } : d === 30 ? { trentium: 0.8 } : {}));
    const bands = survey(grid, 'core_sample').depthProfile!['5,5']!;
    const span = oreDepthSpan(bands, 'trentium');
    expect(span).toEqual({ fromM: 30, toM: 31 });
  });

  it('core sample bands never run past the 40 m reach', () => {
    const bands = survey(uniform(), 'core_sample').depthProfile!['5,5']!;
    expect(Math.max(...bands.map(b => b.toM))).toBeLessThanOrEqual(SURVEY_DEPTH_BELOW_SURFACE.core_sample);
  });

  it('bands are anchored to the column surface, not to absolute Y', () => {
    // Same seam, column raised by 10: depths must not move.
    const grid = new VoxelGrid(11, 11);
    for (let y = 20; y <= SURFACE_Y + 10; y++) {
      const depth = SURFACE_Y + 10 - y;
      grid.setVoxel(5, y, 5, voxel(depth >= 10 && depth <= 12 ? { gold: 1.0 } : {}));
    }
    const profile = survey(grid, 'core_sample').depthProfile!['5,5']!;
    expect(profile.map(b => b.fromM)).toEqual([10, 11, 12]);
  });

  it('is deep-equal for the same seed and differs for another', () => {
    const grid = uniform(0.5);
    expect(survey(grid, 'seismic', 5, 1).depthProfile).toEqual(survey(grid, 'seismic', 5, 1).depthProfile);
    expect(survey(grid, 'core_sample', 5, 1).depthProfile).not.toEqual(survey(grid, 'core_sample', 6, 1).depthProfile);
  });

  it('every reported density is a multiple of 0.05 in (0, 1]', () => {
    const profile = survey(uniform(0.5), 'core_sample', 3, 1).depthProfile!['5,5']!;
    for (const b of profile) for (const d of Object.values(b.ores)) {
      expect(d).toBeGreaterThan(0);
      expect(d).toBeLessThanOrEqual(1);
      expect(isStep(d)).toBe(true);
    }
  });

  describe('estimates and confidence stay bit-identical to the pre-#1683 survey', () => {
    // Pinned from the code before the depth pass existed: column of granite y=30..60,
    // gold 1.0 at 10-12 m below the surface, iron 0.4 at 2 m, skill 3, seed 42.
    const grid = () => {
      const g = new VoxelGrid(11, 11);
      for (let y = 30; y <= SURFACE_Y; y++) {
        g.setVoxel(5, y, 5, voxel(y >= 48 && y <= 50 ? { gold: 1.0 } : y === 58 ? { iron: 0.4 } : {}));
      }
      return g;
    };

    it('core sample', () => {
      const r = survey(grid(), 'core_sample', 42, 3);
      expect(r.estimates).toEqual({ '5,5': { gold: 0.1 } });
      expect(r.confidence).toBeCloseTo(0.962, 12);
    });

    it('seismic', () => {
      const r = survey(grid(), 'seismic', 42, 3);
      expect(r.estimates).toEqual({ '5,5': { gold: 0.1 } });
      expect(r.confidence).toBeCloseTo(0.886, 12);
    });

    it('aerial', () => {
      const r = survey(grid(), 'aerial', 42, 3);
      expect(r.estimates).toEqual({});
      expect(r.confidence).toBeCloseTo(0.81, 12);
    });
  });
});

describe('bandOresAtDepth (#1703)', () => {
  const bands: SurveyDepthBand[] = [
    { fromM: 0, toM: 5, ores: { gold: 0.4 } },
    { fromM: 10, toM: 15, ores: { gold: 0.8, iron: 0.2 } },
  ];

  it('returns the ores of the band containing the depth', () => {
    expect(bandOresAtDepth(bands, 2)).toEqual({ gold: 0.4 });
    expect(bandOresAtDepth(bands, 12)).toEqual({ gold: 0.8, iron: 0.2 });
  });

  it('includes the band start and excludes its end', () => {
    expect(bandOresAtDepth(bands, 0)).toEqual({ gold: 0.4 });
    expect(bandOresAtDepth(bands, 4.99)).toEqual({ gold: 0.4 });
    expect(bandOresAtDepth(bands, 5)).toBeUndefined();
    expect(bandOresAtDepth(bands, 10)).toEqual({ gold: 0.8, iron: 0.2 });
    expect(bandOresAtDepth(bands, 15)).toBeUndefined();
  });

  it('returns undefined between bands and beyond the last band', () => {
    expect(bandOresAtDepth(bands, 7)).toBeUndefined();
    expect(bandOresAtDepth(bands, 100)).toBeUndefined();
  });

  it('returns undefined for a negative depth', () => {
    expect(bandOresAtDepth(bands, -1)).toBeUndefined();
  });

  it('returns undefined for an absent or empty profile', () => {
    expect(bandOresAtDepth(undefined, 2)).toBeUndefined();
    expect(bandOresAtDepth([], 2)).toBeUndefined();
  });

  it('tolerates a malformed saved profile without throwing', () => {
    expect(() => bandOresAtDepth('nope' as unknown as SurveyDepthBand[], 2)).not.toThrow();
    expect(bandOresAtDepth('nope' as unknown as SurveyDepthBand[], 2)).toBeUndefined();
    const broken = [null, { fromM: 0, toM: 5 }, { fromM: 0, toM: 5, ores: { gold: 0.4 } }] as unknown as SurveyDepthBand[];
    expect(() => bandOresAtDepth(broken, 2)).not.toThrow();
  });

  it('reads back the bands a real core sample produced', () => {
    const profile = survey(deepSeam(), 'core_sample').depthProfile!['5,5']!;
    expect(bandOresAtDepth(profile, 10.5)?.['gold']).toBeGreaterThan(0);
    expect(bandOresAtDepth(profile, 3)).toBeUndefined();
  });
});
