import { describe, it, expect } from 'vitest';
import { generateTerrain, buildTerrainContext, type TerrainConfig } from '../../../src/core/world/TerrainGen.js';
import { buildStructureSet, type StructureSet } from '../../../src/core/world/Structures.js';
import { buildLandscapeMap, sampleLandscapeColumn } from '../../../src/core/world/LandscapeMap.js';
import { getBiome, biomeIndexOf } from '../../../src/core/world/BiomeCatalog.js';
import { createWorldGenContext, sampleSurfaceVoxelY, sampleSurfaceHeightY } from '../../../src/core/world/WorldGen.js';
import { getDominantRockId } from '../../../src/core/world/VoxelGrid.js';
import { StrataSampler } from '../../../src/core/world/Strata.js';
import { CompositionPalette } from '../../../src/core/world/VoxelGrid.js';

const EMPTY_STRUCTURES: StructureSet = { overlays: [], spatialIndex: new Map(), rivers: [], villages: [], trees: [], landmarks: [] };

function makeConfig(seed: number, biomeId = 'alpine_granite'): TerrainConfig {
  const biome = getBiome(biomeId)!;
  return { sizeX: 40, sizeY: 30, sizeZ: 40, seed, climateBias: biome.climateCenter };
}

/** Builds grid + landscape context sharing one palette, at a small extentHalf for test speed. */
function buildAll(config: TerrainConfig, extentHalf = 300) {
  const grid = generateTerrain(config);
  const { worldGen, biome, strata } = buildTerrainContext(config);
  const structureSet = buildStructureSet(config.seed, worldGen.fields, worldGen.shapingAt, biome.forestDensity, worldGen.playableRect, extentHalf);
  const landscape = buildLandscapeMap(worldGen, config.climateBias, structureSet, strata, grid.palette, extentHalf);
  return { grid, worldGen, biome, strata, structureSet, landscape };
}

describe('sampleLandscapeColumn', () => {
  it('is deterministic for the same inputs', () => {
    const config = makeConfig(42);
    const { worldGen, strata, structureSet, grid } = buildAll(config);
    const a = sampleLandscapeColumn(worldGen, config.climateBias, structureSet, strata, grid.palette, 500, 500);
    const b = sampleLandscapeColumn(worldGen, config.climateBias, structureSet, strata, grid.palette, 500, 500);
    expect(a).toEqual(b);
  });

  it('produces a finite height and a valid biome index over a range of positions', () => {
    const config = makeConfig(7);
    const { worldGen, strata, structureSet, grid } = buildAll(config);
    for (let x = -500; x <= 500; x += 100) {
      const s = sampleLandscapeColumn(worldGen, config.climateBias, structureSet, strata, grid.palette, x, x * 0.7);
      expect(Number.isFinite(s.height)).toBe(true);
      expect(s.biomeId).toBeGreaterThanOrEqual(0);
      expect(s.biomeId).toBeLessThan(256); // fits a Uint8
      expect(s.surfCompId).toBeGreaterThanOrEqual(0);
    }
  });

  it("the returned biomeId matches biomeIndexOf the dominant biome's own id", () => {
    // desert_badlands' own climate centre — no bias needed to land there.
    const config = makeConfig(3, 'desert_badlands');
    const { worldGen, strata, structureSet, grid } = buildAll(config);
    const s = sampleLandscapeColumn(worldGen, config.climateBias, structureSet, strata, grid.palette, 0.7 * 1000, -0.6 * 1000);
    expect(s.biomeId).toBe(biomeIndexOf('desert_badlands'));
  });
});

describe('buildLandscapeMap — boundary agreement (#458 T2.1 accept criterion)', () => {
  // sizeY generously larger than alpine_granite's max relief (spline tops
  // out around 75m base + 55 pvAmplitude): a too-short grid clamps
  // sampleSurfaceVoxelY's result (heightToVoxelY clamps to [1, sizeY-1]),
  // which would disagree with landscape's intentionally-unclamped height
  // for a reason that has nothing to do with boundary agreement.
  const config: TerrainConfig = { sizeX: 40, sizeY: 200, sizeZ: 40, seed: 11, climateBias: getBiome('alpine_granite')!.climateCenter };
  const { grid, worldGen, strata, structureSet } = buildAll(config, 300);

  it('height agrees within +-0.5 between the playable grid and an independent landscape sample at the same column', () => {
    // Ring of columns just inside each of the 4 playable-rect edges.
    const ring: Array<[number, number]> = [
      [1, 20], [38, 20], [20, 1], [20, 38], [3, 3], [36, 36], [3, 36], [36, 3],
    ];
    for (const [x, z] of ring) {
      const gridSurfaceY = sampleSurfaceVoxelY(worldGen, x, z); // clamped/rounded voxel Y
      const landscapeSample = sampleLandscapeColumn(worldGen, config.climateBias, structureSet, strata, grid.palette, x, z);
      // Both are in the same datum (world height + groundOffset) — the grid's
      // value is additionally rounded to the nearest voxel, hence the +-0.5.
      expect(Math.abs(landscapeSample.height - gridSurfaceY)).toBeLessThanOrEqual(0.5 + 1e-9);
    }
  });

  it('the surface marching cubes will actually build sits exactly on the landscape height', () => {
    // The tolerance above is about the two SAMPLERS agreeing. This is about
    // the two SURFACES agreeing: what the player sees is not the rounded voxel
    // index but the iso-surface marching cubes interpolates out of the density
    // field, and that used to land on a half-voxel no matter what the height
    // underneath it was — the whole site terraced into 1m steps while the
    // landscape beside it stayed smooth.
    const isoHeightAt = (x: number, z: number): number => {
      for (let y = config.sizeY - 1; y > 0; y--) {
        const below = grid.densityAt(x, y - 1, z);
        const here = grid.densityAt(x, y, z);
        if (below >= 0.5 && here < 0.5) return (y - 1) + (0.5 - below) / (here - below);
      }
      return 0;
    };

    const ring: Array<[number, number]> = [
      [1, 20], [38, 20], [20, 1], [20, 38], [3, 3], [36, 36], [3, 36], [36, 3],
    ];
    for (const [x, z] of ring) {
      const landscapeSample = sampleLandscapeColumn(worldGen, config.climateBias, structureSet, strata, grid.palette, x, z);
      expect(isoHeightAt(x, z)).toBeCloseTo(landscapeSample.height, 6);
    }
  });

  it('rock composition matches exactly (same palette id) at the same ring of columns', () => {
    const ring: Array<[number, number]> = [
      [1, 20], [38, 20], [20, 1], [20, 38], [3, 3], [36, 36], [3, 36], [36, 3],
    ];
    for (const [x, z] of ring) {
      const gridSurfaceY = sampleSurfaceVoxelY(worldGen, x, z);
      const topVoxel = grid.getVoxel(x, Math.max(0, gridSurfaceY - 1), z)!;
      const gridCompId = grid.palette.intern(topVoxel.composition); // idempotent — same id it was already assigned
      const landscapeSample = sampleLandscapeColumn(worldGen, config.climateBias, structureSet, strata, grid.palette, x, z);
      expect(landscapeSample.surfCompId).toBe(gridCompId);

      const gridRockId = getDominantRockId(topVoxel.composition);
      const landscapeRockId = getDominantRockId(grid.palette.get(landscapeSample.surfCompId).comp);
      expect(landscapeRockId).toBe(gridRockId);
    }
  });

  it('the seam introduces no extra discontinuity beyond the terrain\'s own local variance', () => {
    // alpine_granite's relief is genuinely bumpy (pvAmplitude 55) — a fixed
    // absolute step-to-step tolerance doesn't fit it (a same-side, no-seam
    // 2m step can swing several metres on its own). Instead compare the
    // seam-crossing step against an equal-distance same-side step: crossing
    // x=0 (etc.) must not be MORE discontinuous than the terrain already is,
    // not "must change by less than an arbitrary constant".
    const pairs: Array<[[number, number], [number, number], [number, number]]> = [
      [[-1, 20], [1, 20], [3, 20]],   // outside, inside, further-inside (same direction, no seam)
      [[41, 20], [39, 20], [37, 20]],
      [[20, -1], [20, 1], [20, 3]],
      [[20, 41], [20, 39], [20, 37]],
    ];
    for (const [outside, inside, further] of pairs) {
      const sOut = sampleLandscapeColumn(worldGen, config.climateBias, structureSet, strata, grid.palette, outside[0], outside[1]);
      const sIn = sampleLandscapeColumn(worldGen, config.climateBias, structureSet, strata, grid.palette, inside[0], inside[1]);
      const sFurther = sampleLandscapeColumn(worldGen, config.climateBias, structureSet, strata, grid.palette, further[0], further[1]);

      const seamStep = Math.abs(sIn.height - sOut.height);
      const localStep = Math.abs(sFurther.height - sIn.height);
      // Generous multiplier + absolute floor: this is a "no extra seam jump"
      // check, not a tight bound — local noise alone can vary run to run.
      expect(seamStep).toBeLessThanOrEqual(localStep * 4 + 1.5);
      expect(sOut.biomeId).toBe(sIn.biomeId);
    }
  });

  it('sampleLandscapeColumn agrees with the unrounded sampleSurfaceHeightY at seed 2378 (#913 regression)', () => {
    // Reproduced on `main`: at seed 2378, alpine_granite, a lake-terminated
    // river's carve reaches ~0.59m inside this playable rect while every
    // traced centreline point still tests outside the river exclusion
    // margin — sampleLandscapeColumn (which applies structure overlays)
    // then disagrees with sampleSurfaceHeightY (which does not) near the
    // claim edge. Measured disagreement on `main`: (0,0)->0.37m,
    // (-1,-1)->1.03m, (-2,-2)->1.65m — all far past the 1e-9 float
    // tolerance below. Must FAIL on today's exclusion logic and PASS once
    // Structures.ts keeps every structure's carved footprint clear of the
    // claim rect.
    const regressionConfig: TerrainConfig = {
      sizeX: 40, sizeY: 200, sizeZ: 40, seed: 2378, climateBias: getBiome('alpine_granite')!.climateCenter,
    };
    // 1600m extentHalf (Structures.ts's own DEFAULT_LANDSCAPE_EXTENT_HALF),
    // not the 300m this file uses elsewhere for speed: the offending river in
    // this fixture only turns up within the full landscape search radius —
    // buildAll's own default parameter is 300, unrelated to that constant, so
    // it must be passed explicitly here (#913).
    const { grid: rGrid, worldGen: rWorldGen, strata: rStrata, structureSet: rStructureSet } = buildAll(regressionConfig, 1600);

    // Ring of columns within 1-2m of every claim edge: a diagonal sweep
    // through each of the 4 corners (d=-2..2, inside to outside), plus a
    // perpendicular sweep through each of the 4 edge midpoints.
    const ring: Array<[number, number]> = [];
    const corners: Array<[number, number, number, number]> = [
      [0, 0, -1, -1], [40, 0, 1, -1], [0, 40, -1, 1], [40, 40, 1, 1], // [cx, cz, outward-x, outward-z]
    ];
    for (const [cx, cz, ox, oz] of corners) {
      for (let d = -2; d <= 2; d++) ring.push([cx + d * ox, cz + d * oz]);
    }
    const edges: Array<[number, number, number, number]> = [
      [20, 0, 0, -1], [20, 40, 0, 1], [0, 20, -1, 0], [40, 20, 1, 0], // [mx, mz, outward-x, outward-z]
    ];
    for (const [mx, mz, ox, oz] of edges) {
      for (let d = -2; d <= 2; d++) ring.push([mx + d * ox, mz + d * oz]);
    }

    for (const [x, z] of ring) {
      const landscapeSample = sampleLandscapeColumn(rWorldGen, regressionConfig.climateBias, rStructureSet, rStrata, rGrid.palette, x, z);
      const voxelSample = sampleSurfaceHeightY(rWorldGen, x, z);
      expect(Math.abs(landscapeSample.height - voxelSample)).toBeLessThanOrEqual(1e-9);
    }
  });
});

describe('buildLandscapeMap — tile layout', () => {
  it('is deterministic for the same seed and inputs', () => {
    const config = makeConfig(5);
    const a = buildAll(config, 700);
    const b = buildAll(config, 700);
    expect(a.landscape.tiles.length).toBe(b.landscape.tiles.length);
    for (let i = 0; i < a.landscape.tiles.length; i++) {
      expect(a.landscape.tiles[i]!.heights).toEqual(b.landscape.tiles[i]!.heights);
      expect(a.landscape.tiles[i]!.biomeIds).toEqual(b.landscape.tiles[i]!.biomeIds);
      expect(a.landscape.tiles[i]!.surfCompIds).toEqual(b.landscape.tiles[i]!.surfCompIds);
    }
  });

  it('every tile has 129x129 samples (fence-post: 512/4 + 1) and correct metadata', () => {
    const config = makeConfig(9);
    const { landscape } = buildAll(config, 700);
    expect(landscape.samplesPerTile).toBe(129);
    expect(landscape.tileSpan).toBe(512);
    expect(landscape.coarseStep).toBe(4);
    expect(landscape.tiles.length).toBeGreaterThan(0);
    for (const tile of landscape.tiles) {
      expect(tile.heights.length).toBe(129 * 129);
      expect(tile.biomeIds.length).toBe(129 * 129);
      expect(tile.surfCompIds.length).toBe(129 * 129);
    }
  });

  it("a tile's stored samples land at originX/Z + col/row * coarseStep", () => {
    const config = makeConfig(9);
    const { landscape, worldGen, structureSet, strata, grid } = buildAll(config, 700);
    const tile = landscape.tiles[0]!;
    for (const [row, col] of [[0, 0], [0, 128], [128, 0], [64, 64]] as const) {
      const x = tile.originX + col * landscape.coarseStep;
      const z = tile.originZ + row * landscape.coarseStep;
      const expected = sampleLandscapeColumn(worldGen, config.climateBias, structureSet, strata, grid.palette, x, z);
      const idx = row * landscape.samplesPerTile + col;
      // heights are stored as Float32Array (~7 significant digits) — compare
      // at a tolerance float32 rounding can't violate, not full f64 precision.
      expect(tile.heights[idx]).toBeCloseTo(expected.height, 3);
      expect(tile.biomeIds[idx]).toBe(expected.biomeId);
      expect(tile.surfCompIds[idx]).toBe(expected.surfCompId);
    }
  });

  it('skips every tile whose entire span lies inside the playable rect', () => {
    // A playable rect (4000x4000) far larger than the whole tile grid at
    // this extentHalf (halfTiles=1 => tiles span up to +-1024m from centre),
    // with generous margin on every side so every tile is fully inside —
    // every candidate tile should be skipped, producing an empty tile set.
    // The strata/palette here are real but never actually get sampled, since
    // every tile is skipped before any per-sample work happens.
    const worldGen = createWorldGenContext(1, 4000, 30, 4000);
    const strata = new StrataSampler(1, []);
    const landscape = buildLandscapeMap(worldGen, [0, 0], EMPTY_STRUCTURES, strata, new CompositionPalette(), 600);
    expect(landscape.tiles.length).toBe(0);
  });
});
