import { describe, it, expect, vi } from 'vitest';
import { generateTerrain, buildTerrainContext, type TerrainConfig } from '../../../src/core/world/TerrainGen.js';
import { buildStructureSet, type StructureSet } from '../../../src/core/world/Structures.js';
import {
  createLazyLandscapeMap,
  sampleLandscapeColumn,
  chunkOrigin,
  selectLandscapeChunks,
  chunkSpanAt,
  NODES_PER_CHUNK,
  LADDER_STEPS,
  EXTENT_HALF,
  type LandscapeChunkId,
} from '../../../src/core/world/LandscapeMap.js';
import { getBiome, biomeIndexOf } from '../../../src/core/world/BiomeCatalog.js';
import { createWorldGenContext, sampleSurfaceVoxelY, sampleSurfaceHeightY, applyPitMask, sampleBaseHeight } from '../../../src/core/world/WorldGen.js';
import { getDominantRockId } from '../../../src/core/world/VoxelGrid.js';
import { StrataSampler, buildStrataProfile } from '../../../src/core/world/Strata.js';
import { CompositionPalette } from '../../../src/core/world/VoxelGrid.js';

const EMPTY_STRUCTURES: StructureSet = { overlays: [], spatialIndex: new Map(), rivers: [], villages: [], trees: [], landmarks: [] };

function makeConfig(seed: number, biomeId = 'alpine_granite'): TerrainConfig {
  const biome = getBiome(biomeId)!;
  return { sizeX: 40, sizeY: 30, sizeZ: 40, seed, climateBias: biome.climateCenter };
}

/**
 * Builds grid + landscape sampling context sharing one palette, at a small
 * extentHalf for test speed. Deliberately does NOT build a lazy landscape
 * map — most callers only need sampleLandscapeColumn's own inputs (worldGen,
 * strata, structureSet, palette), and sampleLandscapeColumn itself is
 * untouched by #1153, so those tests must keep passing whether or not
 * createLazyLandscapeMap is implemented yet.
 */
function buildAll(config: TerrainConfig, extentHalf = 300) {
  const grid = generateTerrain(config);
  const { worldGen, biome, strata } = buildTerrainContext(config);
  const structureSet = buildStructureSet(config.seed, worldGen.fields, worldGen.shapingAt, biome.forestDensity, worldGen.playableRect, extentHalf);
  return { grid, worldGen, biome, strata, structureSet };
}

/**
 * A cheap fixture for the lazy-map ladder tests: real WorldGen/strata (via
 * buildTerrainContext), no voxel grid and no structure set — those tests
 * exercise chunk sampling and caching, not boundary-agreement with a real
 * grid, so paying for generateTerrain()/buildStructureSet() on every case
 * would only slow the suite down.
 */
function buildLazySetup(seed: number, biomeId = 'alpine_granite', extentHalf = EXTENT_HALF) {
  const config = makeConfig(seed, biomeId);
  const { worldGen, strata } = buildTerrainContext(config);
  const palette = new CompositionPalette();
  return { config, worldGen, strata, palette, extentHalf };
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

describe('sampleLandscapeColumn — a grid too short for the relief it stands in (#1077)', () => {
  // The suite below deliberately gives itself a 200 m grid so nothing clamps.
  // Every real level is the opposite case: alpine_granite's relief runs tens of
  // metres through a 20 m grid, the tutorial's own north-east corner dips 1.2 m
  // below its floor, and TerrainGen answers by clamping every column into
  // [1, sizeY - 1]. The landscape used to be the one sheet that did not, so the
  // site rendered a flat-topped rectangle wherever the world left the band —
  // the square a player sees drawn on untouched ground.
  const config: TerrainConfig = { sizeX: 40, sizeY: 20, sizeZ: 40, seed: 11, climateBias: getBiome('alpine_granite')!.climateCenter };
  const { worldGen, biome } = buildTerrainContext(config);
  const strata = new StrataSampler(config.seed, buildStrataProfile(biome.dominantRocks));
  const palette = new CompositionPalette();
  const landscapeHeightAt = (x: number, z: number): number =>
    sampleLandscapeColumn(worldGen, config.climateBias, EMPTY_STRUCTURES, strata, palette, x, z).height;

  /** The site's rectangle, its halo ring, and its corners. */
  const boundaryColumns: Array<[number, number]> = [
    [0, 20], [40, 20], [20, 0], [20, 40], [0, 0], [40, 40],
    [-1, 20], [20, -1], [-1, -1], [41, 41], [10, 10], [30, 5],
  ];

  it('clamps somewhere, or it is testing nothing', () => {
    const unclamped = boundaryColumns.some(([x, z]) => {
      const free = applyPitMask(sampleBaseHeight(worldGen.fields, x, z, worldGen.shapingAt(x, z)), worldGen.centerHeight, worldGen.playableRect, x, z) + worldGen.groundOffset;
      return free < 1 || free > config.sizeY - 1;
    });
    expect(unclamped).toBe(true);
  });

  it('puts the landscape on exactly the height the grid fills, boundary, halo ring and interior alike', () => {
    for (const [x, z] of boundaryColumns) {
      expect(landscapeHeightAt(x, z)).toBeCloseTo(sampleSurfaceHeightY(worldGen, x, z), 9);
    }
  });

  it('hands the world back its own relief out in the open, where nothing else is drawing', () => {
    const free = applyPitMask(sampleBaseHeight(worldGen.fields, 400, -300, worldGen.shapingAt(400, -300)), worldGen.centerHeight, worldGen.playableRect, 400, -300) + worldGen.groundOffset;
    expect(landscapeHeightAt(400, -300)).toBeCloseTo(free, 9);
  });
});

describe('sampleLandscapeColumn — boundary agreement (#458 T2.1 accept criterion)', () => {
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

describe('chunkSpanAt', () => {
  it("is (NODES_PER_CHUNK - 1) * that level's ladder step, for every rung", () => {
    for (let level = 0; level < LADDER_STEPS.length; level++) {
      expect(chunkSpanAt(level)).toBe((NODES_PER_CHUNK - 1) * LADDER_STEPS[level]!);
    }
  });
});

describe('createLazyLandscapeMap / getChunk — per-chunk lazy ladder (#1153)', () => {
  it('every node of a level-0 (finest) chunk matches sampleLandscapeColumn at that node\'s world (x, z)', () => {
    const { config, worldGen, strata, palette, extentHalf } = buildLazySetup(21);
    const map = createLazyLandscapeMap(worldGen, config.climateBias, EMPTY_STRUCTURES, strata, palette, extentHalf);
    const chunk = map.getChunk({ level: 0, cx: 0, cz: 0 });
    expect(chunk.step).toBe(LADDER_STEPS[0]);

    for (let row = 0; row < NODES_PER_CHUNK; row++) {
      for (let col = 0; col < NODES_PER_CHUNK; col++) {
        const x = chunk.originX + col * chunk.step;
        const z = chunk.originZ + row * chunk.step;
        const expected = sampleLandscapeColumn(worldGen, config.climateBias, EMPTY_STRUCTURES, strata, palette, x, z);
        const idx = row * NODES_PER_CHUNK + col;
        expect(chunk.heights[idx]).toBeCloseTo(expected.height, 3); // float32 tolerance
        expect(chunk.biomeIds[idx]).toBe(expected.biomeId);
        expect(chunk.surfCompIds[idx]).toBe(expected.surfCompId);
      }
    }
  });

  for (let level = 0; level < LADDER_STEPS.length; level++) {
    it(`level ${level} (step ${LADDER_STEPS[level]}m): every node matches sampleLandscapeColumn at that node's world (x, z)`, () => {
      const { config, worldGen, strata, palette, extentHalf } = buildLazySetup(21 + level);
      const map = createLazyLandscapeMap(worldGen, config.climateBias, EMPTY_STRUCTURES, strata, palette, extentHalf);
      const chunk = map.getChunk({ level, cx: 0, cz: 0 });
      expect(chunk.step).toBe(LADDER_STEPS[level]);

      for (let row = 0; row < NODES_PER_CHUNK; row++) {
        for (let col = 0; col < NODES_PER_CHUNK; col++) {
          const x = chunk.originX + col * chunk.step;
          const z = chunk.originZ + row * chunk.step;
          const expected = sampleLandscapeColumn(worldGen, config.climateBias, EMPTY_STRUCTURES, strata, palette, x, z);
          const idx = row * NODES_PER_CHUNK + col;
          expect(chunk.heights[idx]).toBeCloseTo(expected.height, 3);
          expect(chunk.biomeIds[idx]).toBe(expected.biomeId);
          expect(chunk.surfCompIds[idx]).toBe(expected.surfCompId);
        }
      }
    });

    it(`level ${level}: heights.length === biomeIds.length === surfCompIds.length === NODES_PER_CHUNK ** 2`, () => {
      const { config, worldGen, strata, palette, extentHalf } = buildLazySetup(31 + level);
      const map = createLazyLandscapeMap(worldGen, config.climateBias, EMPTY_STRUCTURES, strata, palette, extentHalf);
      const chunk = map.getChunk({ level, cx: 0, cz: 0 });
      const expectedLength = NODES_PER_CHUNK * NODES_PER_CHUNK;
      expect(chunk.heights.length).toBe(expectedLength);
      expect(chunk.biomeIds.length).toBe(expectedLength);
      expect(chunk.surfCompIds.length).toBe(expectedLength);
    });
  }

  describe('laziness', () => {
    it('makes zero calls into the sampling pipeline between construction and the first getChunk', () => {
      const { config, worldGen, strata, palette, extentHalf } = buildLazySetup(41);
      const spy = vi.spyOn(worldGen.fields, 'temperature');
      const map = createLazyLandscapeMap(worldGen, config.climateBias, EMPTY_STRUCTURES, strata, palette, extentHalf);
      expect(spy).not.toHaveBeenCalled();
      // keep map reachable for lint (unused-var would otherwise flag it if the
      // implementation-under-test path never runs) — also documents that the
      // map itself is the thing under test, not the spy alone.
      expect(map).toBeDefined();
    });

    it('the first getChunk(id) call samples exactly NODES_PER_CHUNK ** 2 nodes', () => {
      const { config, worldGen, strata, palette, extentHalf } = buildLazySetup(42);
      const spy = vi.spyOn(worldGen.fields, 'temperature');
      const map = createLazyLandscapeMap(worldGen, config.climateBias, EMPTY_STRUCTURES, strata, palette, extentHalf);
      map.getChunk({ level: 0, cx: 0, cz: 0 });
      expect(spy).toHaveBeenCalledTimes(NODES_PER_CHUNK * NODES_PER_CHUNK);
    });

    it('a second getChunk(id) with the same id makes no additional samples (cached)', () => {
      const { config, worldGen, strata, palette, extentHalf } = buildLazySetup(43);
      const spy = vi.spyOn(worldGen.fields, 'temperature');
      const map = createLazyLandscapeMap(worldGen, config.climateBias, EMPTY_STRUCTURES, strata, palette, extentHalf);
      const id: LandscapeChunkId = { level: 0, cx: 0, cz: 0 };
      map.getChunk(id);
      const afterFirst = spy.mock.calls.length;
      map.getChunk(id);
      expect(spy.mock.calls.length).toBe(afterFirst);
    });

    it('hasChunk(id) is false before the first getChunk(id) and true after', () => {
      const { config, worldGen, strata, palette, extentHalf } = buildLazySetup(44);
      const map = createLazyLandscapeMap(worldGen, config.climateBias, EMPTY_STRUCTURES, strata, palette, extentHalf);
      const id: LandscapeChunkId = { level: 1, cx: 0, cz: 0 };
      expect(map.hasChunk(id)).toBe(false);
      map.getChunk(id);
      expect(map.hasChunk(id)).toBe(true);
    });

    it('cachedChunkIds lists exactly the chunks getChunk has been asked for', () => {
      const { config, worldGen, strata, palette, extentHalf } = buildLazySetup(45);
      const map = createLazyLandscapeMap(worldGen, config.climateBias, EMPTY_STRUCTURES, strata, palette, extentHalf);
      expect(map.cachedChunkIds.length).toBe(0);
      map.getChunk({ level: 0, cx: 0, cz: 0 });
      expect(map.cachedChunkIds.length).toBe(1);
      map.getChunk({ level: 0, cx: 0, cz: 0 }); // same id again: no growth
      expect(map.cachedChunkIds.length).toBe(1);
      map.getChunk({ level: 1, cx: 0, cz: 0 });
      expect(map.cachedChunkIds.length).toBe(2);
    });
  });

  it("a chunk's own originX/originZ agree with the pure chunkOrigin(id, centerX, centerZ) function", () => {
    const { config, worldGen, strata, palette, extentHalf } = buildLazySetup(46);
    const map = createLazyLandscapeMap(worldGen, config.climateBias, EMPTY_STRUCTURES, strata, palette, extentHalf);
    const id: LandscapeChunkId = { level: 2, cx: 0, cz: 0 };
    const chunk = map.getChunk(id);
    const origin = chunkOrigin(id, map.centerX, map.centerZ);
    expect(chunk.originX).toBeCloseTo(origin.originX, 6);
    expect(chunk.originZ).toBeCloseTo(origin.originZ, 6);
  });

  it('two separately-constructed maps with identical inputs produce identical chunk data for the same id', () => {
    const seed = 47;
    const build = () => {
      const { config, worldGen, strata, palette, extentHalf } = buildLazySetup(seed);
      return createLazyLandscapeMap(worldGen, config.climateBias, EMPTY_STRUCTURES, strata, palette, extentHalf);
    };
    const id: LandscapeChunkId = { level: 3, cx: 0, cz: 0 };
    const a = build().getChunk(id);
    const b = build().getChunk(id);
    expect(Array.from(a.heights)).toEqual(Array.from(b.heights));
    expect(Array.from(a.biomeIds)).toEqual(Array.from(b.biomeIds));
    expect(Array.from(a.surfCompIds)).toEqual(Array.from(b.surfCompIds));
    expect(a.originX).toBeCloseTo(b.originX, 9);
    expect(a.originZ).toBeCloseTo(b.originZ, 9);
  });

  it('throws for a level outside [0, LADDER_STEPS.length)', () => {
    const { config, worldGen, strata, palette, extentHalf } = buildLazySetup(48);
    const map = createLazyLandscapeMap(worldGen, config.climateBias, EMPTY_STRUCTURES, strata, palette, extentHalf);
    expect(() => map.getChunk({ level: -1, cx: 0, cz: 0 })).toThrow();
    expect(() => map.getChunk({ level: LADDER_STEPS.length, cx: 0, cz: 0 })).toThrow();
  });
});

// ── selectLandscapeChunks — pure geometry, no terrain generation needed ────

/** World-space footprint of chunk `id`'s NODES_PER_CHUNK x NODES_PER_CHUNK lattice. */
function footprintOf(id: LandscapeChunkId, centerX: number, centerZ: number): { minX: number; minZ: number; maxX: number; maxZ: number } {
  const { originX, originZ } = chunkOrigin(id, centerX, centerZ);
  const span = chunkSpanAt(id.level);
  return { minX: originX, minZ: originZ, maxX: originX + span, maxZ: originZ + span };
}

/**
 * Proves the returned chunks tile `[centerX-extentHalf, centerX+extentHalf] x
 * [centerZ-extentHalf, centerZ+extentHalf]` exactly: every point of the
 * square is covered by precisely one chunk footprint. A sweep over the
 * distinct rect-boundary coordinates rather than a fixed-spacing sample grid
 * — each strip between two adjacent boundary lines has a constant covering
 * set, so checking one point per strip (its centre) is exhaustive, not a
 * a sample that could miss a thin sliver of gap or overlap.
 */
function assertExactTiling(chunks: readonly LandscapeChunkId[], centerX: number, centerZ: number, extentHalf: number): void {
  const rects = chunks.map(id => footprintOf(id, centerX, centerZ));
  const squareMinX = centerX - extentHalf, squareMaxX = centerX + extentHalf;
  const squareMinZ = centerZ - extentHalf, squareMaxZ = centerZ + extentHalf;

  const xs = new Set<number>([squareMinX, squareMaxX]);
  const zs = new Set<number>([squareMinZ, squareMaxZ]);
  for (const r of rects) {
    if (r.minX > squareMinX && r.minX < squareMaxX) xs.add(r.minX);
    if (r.maxX > squareMinX && r.maxX < squareMaxX) xs.add(r.maxX);
    if (r.minZ > squareMinZ && r.minZ < squareMaxZ) zs.add(r.minZ);
    if (r.maxZ > squareMinZ && r.maxZ < squareMaxZ) zs.add(r.maxZ);
  }
  const xsSorted = [...xs].sort((a, b) => a - b);
  const zsSorted = [...zs].sort((a, b) => a - b);

  for (let i = 0; i < xsSorted.length - 1; i++) {
    const midX = (xsSorted[i]! + xsSorted[i + 1]!) / 2;
    for (let j = 0; j < zsSorted.length - 1; j++) {
      const midZ = (zsSorted[j]! + zsSorted[j + 1]!) / 2;
      const covering = rects.filter(r => midX > r.minX && midX < r.maxX && midZ > r.minZ && midZ < r.maxZ);
      expect(covering.length, `point (${midX}, ${midZ}) covered by ${covering.length} chunks, want 1`).toBe(1);
    }
  }
}

describe('selectLandscapeChunks (#1153)', () => {
  const centerX = 300, centerZ = -100, extentHalf = 200;

  it('tiles the square exactly with the camera at the centre', () => {
    const chunks = selectLandscapeChunks(centerX, centerZ, centerX, centerZ, extentHalf);
    assertExactTiling(chunks, centerX, centerZ, extentHalf);
  });

  it('tiles the square exactly with the camera at the square\'s own edge', () => {
    const chunks = selectLandscapeChunks(centerX + extentHalf, centerZ, centerX, centerZ, extentHalf);
    assertExactTiling(chunks, centerX, centerZ, extentHalf);
  });

  it('tiles the square exactly with the camera well outside extentHalf', () => {
    const chunks = selectLandscapeChunks(centerX + 5 * extentHalf, centerZ - 5 * extentHalf, centerX, centerZ, extentHalf);
    assertExactTiling(chunks, centerX, centerZ, extentHalf);
  });

  it('level is non-decreasing as a chunk\'s footprint distance from the camera increases', () => {
    const cameraX = centerX, cameraZ = centerZ;
    const chunks = selectLandscapeChunks(cameraX, cameraZ, centerX, centerZ, extentHalf);
    const withDist = chunks.map(id => {
      const r = footprintOf(id, centerX, centerZ);
      const dx = Math.max(r.minX - cameraX, 0, cameraX - r.maxX);
      const dz = Math.max(r.minZ - cameraZ, 0, cameraZ - r.maxZ);
      return { level: id.level, dist: Math.hypot(dx, dz) };
    });
    for (const a of withDist) {
      for (const b of withDist) {
        if (a.dist < b.dist - 1e-6) {
          expect(a.level).toBeLessThanOrEqual(b.level);
        }
      }
    }
  });

  it('is deterministic: the same camera position returns the same set of chunk ids', () => {
    const a = selectLandscapeChunks(centerX + 10, centerZ - 5, centerX, centerZ, extentHalf);
    const b = selectLandscapeChunks(centerX + 10, centerZ - 5, centerX, centerZ, extentHalf);
    const keyOf = (id: LandscapeChunkId): string => `${id.level},${id.cx},${id.cz}`;
    expect(a.map(keyOf).sort()).toEqual(b.map(keyOf).sort());
  });

  it('never returns a chunk whose footprint lies entirely outside extentHalf', () => {
    // The camera position most tempting for a buggy implementation to pull in
    // a stray far-away coarse chunk: well outside the square.
    const chunks = selectLandscapeChunks(centerX + 5 * extentHalf, centerZ - 5 * extentHalf, centerX, centerZ, extentHalf);
    const squareMinX = centerX - extentHalf, squareMaxX = centerX + extentHalf;
    const squareMinZ = centerZ - extentHalf, squareMaxZ = centerZ + extentHalf;
    for (const id of chunks) {
      const r = footprintOf(id, centerX, centerZ);
      const overlaps = r.maxX > squareMinX && r.minX < squareMaxX && r.maxZ > squareMinZ && r.minZ < squareMaxZ;
      expect(overlaps, `chunk ${JSON.stringify(id)} footprint ${JSON.stringify(r)} does not overlap the square`).toBe(true);
    }
  });

  it('defaults extentHalf to EXTENT_HALF when omitted', () => {
    const withDefault = selectLandscapeChunks(centerX, centerZ, centerX, centerZ);
    const withExplicit = selectLandscapeChunks(centerX, centerZ, centerX, centerZ, EXTENT_HALF);
    const keyOf = (id: LandscapeChunkId): string => `${id.level},${id.cx},${id.cz}`;
    expect(withDefault.map(keyOf).sort()).toEqual(withExplicit.map(keyOf).sort());
  });
});
