import { describe, it, expect } from 'vitest';
import {
  generateTerrain, surfaceDensityAt, buildTerrainContext, createChunkSource,
  requireValidGenDimension, requireValidGenDatum, requireValidPitMask, MAX_TERRAIN_GEN_DIMENSION,
  climateBiasLandingOn, resolveGeneratedBiome,
  isInBorderZone, TERRAIN_GENERATOR_VERSION,
  type TerrainConfig,
} from '../../../src/core/world/TerrainGen.js';
import { WorldNoiseFields } from '../../../src/core/world/NoiseFields.js';
import { getBiome, getAllBiomes } from '../../../src/core/world/BiomeCatalog.js';
import { VoxelGrid, chunkIndexOf, CHUNK_SIZE, getDominantRockId, MAX_VOXEL_ABS_Y } from '../../../src/core/world/VoxelGrid.js';
import { sampleSurfaceHeightY, sampleSurfaceVoxelY, applyPitMask, sampleBaseHeight, type WorldGenContext } from '../../../src/core/world/WorldGen.js';
import { getOre } from '../../../src/core/world/OreCatalog.js';
import { OreVeinSampler } from '../../../src/core/world/OreVeins.js';
import { getAllLevels } from '../../../src/core/campaign/Level.js';

function makeConfig(seed: number, biomeId = 'desert_badlands'): TerrainConfig {
  const biome = getBiome(biomeId)!;
  return { sizeX: 32, datum: Math.floor(32 * 0.55), sizeZ: 32, seed, climateBias: biome.climateCenter };
}

describe('TerrainGen — determinism', () => {
  it('same seed produces identical terrain', () => {
    const a = generateTerrain(makeConfig(42));
    const b = generateTerrain(makeConfig(42));
    for (const [x, y, z] of [[5, 5, 5], [10, 3, 15], [20, 10, 20]] as const) {
      const va = a.getVoxel(x, y, z)!;
      const vb = b.getVoxel(x, y, z)!;
      expect(va.composition.rocks.length).toBeGreaterThan(0);
      expect(va.composition.rocks[0]!.rockId).toBe(vb.composition.rocks[0]!.rockId);
      expect(va.density).toBe(vb.density);
    }
  });

  it('different seeds produce different terrain', () => {
    const a = generateTerrain(makeConfig(42));
    const b = generateTerrain(makeConfig(99));
    let differences = 0;
    for (let x = 5; x < 25; x += 5) {
      const va = a.getVoxel(x, 5, 15)!;
      const vb = b.getVoxel(x, 5, 15)!;
      const domA = getDominantRockId(va.composition);
      const domB = getDominantRockId(vb.composition);
      if (domA !== domB) differences++;
    }
    expect(differences).toBeGreaterThan(0);
  });
});

describe('TerrainGen — structure', () => {
  it('surface voxels above ground are empty (density=0)', () => {
    const grid = generateTerrain(makeConfig(42));
    let airCount = 0;
    for (let x = 0; x < 32; x++) {
      const v = grid.getVoxel(x, 31, 16)!;
      if (v.density === 0) airCount++;
    }
    expect(airCount).toBe(32);
  });

  it('ore density is zero in the neutral border zone', () => {
    const grid = generateTerrain(makeConfig(42));
    for (let y = 0; y < 5; y++) {
      const v = grid.getVoxel(0, y, 0)!;
      if (v.density > 0) {
        expect(Object.keys(v.oreDensities).length).toBe(0);
      }
    }
  });

  it('ore density distribution roughly matches rock type probabilities over large sample', () => {
    const grid = generateTerrain({
      ...makeConfig(42, 'alpine_granite'),
      sizeX: 64,
      datum: Math.floor(64 * 0.55),
      sizeZ: 64,
    });
    let totalSolid = 0;
    let totalWithOre = 0;
    for (let x = 10; x < 54; x += 2) {
      for (let z = 10; z < 54; z += 2) {
        for (let y = 0; y < 30; y += 2) {
          const v = grid.getVoxel(x, y, z)!;
          if (v.density > 0) {
            totalSolid++;
            if (Object.keys(v.oreDensities).length > 0) {
              totalWithOre++;
            }
          }
        }
      }
    }
    expect(totalSolid).toBeGreaterThan(0);
    const oreRate = totalWithOre / totalSolid;
    expect(oreRate).toBeGreaterThan(0.01);
    expect(oreRate).toBeLessThan(0.8);
  });
});

describe('TerrainGen — sub-voxel surface placement (#458)', () => {
  it('surfaceDensityAt crosses 0.5 exactly at the continuous surface height', () => {
    for (const h of [10.0, 10.2, 10.5, 10.75, 7.999]) {
      expect(surfaceDensityAt(h, h)).toBeCloseTo(0.5, 10);
    }
  });

  it('is fully solid a voxel below the surface and fully air a voxel above it', () => {
    const h = 12.3;
    expect(surfaceDensityAt(h - 1, h)).toBe(1);
    expect(surfaceDensityAt(h + 1, h)).toBe(0);
  });

  it('never leaves the [0, 1] range a density is allowed to take', () => {
    for (const y of [-40, 0, 12, 400]) {
      const d = surfaceDensityAt(y, 12.3);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(1);
    }
  });

  it('lets marching cubes reproduce a fractional height, not a rounded one', () => {
    // The interpolation marching cubes actually performs: the 0.5 crossing
    // between the two corners that bracket the surface.
    const isoCrossing = (surfaceH: number): number => {
      const y0 = Math.floor(surfaceH);
      const d0 = surfaceDensityAt(y0, surfaceH);
      const d1 = surfaceDensityAt(y0 + 1, surfaceH);
      return y0 + (0.5 - d0) / (d1 - d0);
    };
    for (const h of [10.1, 10.4, 10.6, 10.9, 23.25]) {
      expect(isoCrossing(h)).toBeCloseTo(h, 6);
    }
  });

  it('a generated column carries a fractional density at its surface', () => {
    // Terraces come from every voxel being 0 or 1: with only those two values
    // marching cubes can only ever put a surface on a half-voxel.
    const grid = generateTerrain(makeConfig(42));
    let fractional = 0;
    for (let x = 4; x < 28; x++) {
      for (let z = 4; z < 28; z++) {
        for (let y = 0; y < 32; y++) {
          const d = grid.densityAt(x, y, z);
          if (d > 0.001 && d < 0.999) fractional++;
        }
      }
    }
    expect(fractional).toBeGreaterThan(0);
  });

  it('leaves the deep interior fully solid — only the surface band is fractional', () => {
    const grid = generateTerrain(makeConfig(42));
    for (let x = 8; x < 24; x += 4) {
      for (let z = 8; z < 24; z += 4) {
        expect(grid.densityAt(x, 1, z)).toBe(1);
      }
    }
  });

  it('has no meaningful vertical size cap (#1190): a generated grid answers a very deep and a very high column query without throwing, and with the physically correct answer', () => {
    const grid = generateTerrain(makeConfig(42));
    // Deep underground, far below any surface — solid rock, not an out-of-bounds air default.
    expect(() => grid.densityAt(10, -3000, 10)).not.toThrow();
    expect(grid.densityAt(10, -3000, 10)).toBe(1);
    // Far above any surface — empty air, not a clamp artifact.
    expect(() => grid.densityAt(10, 3000, 10)).not.toThrow();
    expect(grid.densityAt(10, 3000, 10)).toBe(0);
  });
});

// ── createChunkSource — lazy chunk materialization (#1183) ─────────────────
//
// `createChunkSource` builds a `VoxelChunkSource` from the same sampling
// context `generateColumnRange` already uses (buildTerrainContext), so a chunk
// materializes identically whether it was generated up front or lazily on
// first read. These tests exercise the source object directly — its own
// `surfaceHeightAt`/`materializeSlab` contract — independent of how/whether
// `VoxelGrid` wires it in (that side of the contract is covered by
// VoxelGrid.test.ts's own "chunk source" describe block).

describe('TerrainGen.createChunkSource — surfaceHeightAt regression (#1183)', () => {
  it('matches the existing sampleSurfaceHeightY sampler exactly, for the same worldGen context and inputs', () => {
    const config = makeConfig(42);
    const terrain = buildTerrainContext(config);
    const source = createChunkSource(terrain, config);

    for (const [x, z] of [[5, 5], [10, 20], [27, 3], [0, 0], [31, 31]] as const) {
      expect(source.surfaceHeightAt(x, z)).toBe(sampleSurfaceHeightY(terrain.worldGen, x, z));
    }
  });
});

describe('TerrainGen.createChunkSource — materializeSlab at extreme depth (#1183)', () => {
  it('fills a very negative y-band with deterministic, non-air composition and ore data', () => {
    const config = makeConfig(42);
    const terrain = buildTerrainContext(config);
    const source = createChunkSource(terrain, config);
    const grid = new VoxelGrid(config.sizeX, config.sizeZ);

    const cy = chunkIndexOf(-200);
    const y0 = cy * CHUNK_SIZE;
    const y1 = y0 + CHUNK_SIZE;
    source.materializeSlab(grid, 0, CHUNK_SIZE, 0, CHUNK_SIZE, cy);

    let sawSolid = false;
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        for (let y = y0; y < y1; y++) {
          const density = grid.densityAt(x, y, z);
          expect(Number.isFinite(density)).toBe(true);
          if (density > 0) {
            sawSolid = true;
            expect(grid.compositionAt(x, y, z).rocks.length).toBeGreaterThan(0);
          }
        }
      }
    }
    expect(sawSolid, 'extreme depth is deep inside rock, not air').toBe(true);
  });

  it('matches the composition direct Strata sampling would produce at the same depth', () => {
    const config = makeConfig(42);
    const terrain = buildTerrainContext(config);
    const source = createChunkSource(terrain, config);
    const grid = new VoxelGrid(config.sizeX, config.sizeZ);

    const cy = chunkIndexOf(-200);
    const y0 = cy * CHUNK_SIZE;
    const y1 = y0 + CHUNK_SIZE;
    source.materializeSlab(grid, 0, CHUNK_SIZE, 0, CHUNK_SIZE, cy);

    for (const [x, z] of [[3, 3], [10, 12], [0, 15]] as const) {
      const surfaceH = sampleSurfaceHeightY(terrain.worldGen, x, z);
      const surfaceY = Math.round(surfaceH);
      const boundaries = terrain.strata.boundariesAt(x, z);
      for (let y = y0; y < y1; y++) {
        const depth = Math.max(0, surfaceY - y);
        const expectedComp = terrain.strata.compositionAt(x, y, z, depth, boundaries);
        const actualComp = grid.compositionAt(x, y, z);
        expect(getDominantRockId(actualComp), `mismatch at (${x},${y},${z})`).toBe(getDominantRockId(expectedComp));
      }
    }
  });

  it('is deterministic: materializing the same band twice (into fresh grids) produces byte-identical density/composition/ores', () => {
    const config = makeConfig(42);
    const terrain = buildTerrainContext(config);
    const source = createChunkSource(terrain, config);
    const cy = chunkIndexOf(-200);
    const y0 = cy * CHUNK_SIZE;
    const y1 = y0 + CHUNK_SIZE;

    const gridA = new VoxelGrid(config.sizeX, config.sizeZ);
    source.materializeSlab(gridA, 0, CHUNK_SIZE, 0, CHUNK_SIZE, cy);
    const gridB = new VoxelGrid(config.sizeX, config.sizeZ);
    source.materializeSlab(gridB, 0, CHUNK_SIZE, 0, CHUNK_SIZE, cy);

    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        for (let y = y0; y < y1; y++) {
          expect(gridB.densityAt(x, y, z)).toBe(gridA.densityAt(x, y, z));
          expect(gridB.compositionAt(x, y, z)).toEqual(gridA.compositionAt(x, y, z));
          expect(gridB.oresAt(x, y, z)).toEqual(gridA.oresAt(x, y, z));
        }
      }
    }
  });

  it('never places an ore whose depth gate the column\'s actual depth exceeds, even at extreme depth', () => {
    const config = makeConfig(42, 'alpine_granite');
    const terrain = buildTerrainContext(config);
    const source = createChunkSource(terrain, config);
    const grid = new VoxelGrid(config.sizeX, config.sizeZ);

    const cy = chunkIndexOf(-500); // far past every ore's depthMax except treranium's 999
    const y0 = cy * CHUNK_SIZE;
    const y1 = y0 + CHUNK_SIZE;
    source.materializeSlab(grid, 0, CHUNK_SIZE, 0, CHUNK_SIZE, cy);

    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const surfaceH = sampleSurfaceHeightY(terrain.worldGen, x, z);
        const surfaceY = Math.round(surfaceH);
        for (let y = y0; y < y1; y++) {
          const ores = grid.oresAt(x, y, z);
          if (!ores) continue;
          const depth = Math.max(0, surfaceY - y);
          for (const oreId of Object.keys(ores)) {
            const ore = getOre(oreId)!;
            expect(depth, `${oreId} at (${x},${y},${z}), depth ${depth}`).toBeGreaterThanOrEqual(ore.depthMin);
            expect(depth, `${oreId} at (${x},${y},${z}), depth ${depth}`).toBeLessThanOrEqual(ore.depthMax);
          }
        }
      }
    }
    // Whether any ore actually rolled positive at this extreme depth is a
    // noise-driven detail of this specific seed/biome/band — the definitive,
    // seed-independent proof that the depth gate itself holds at extreme
    // depth lives in the direct OreVeinSampler tests below, which construct
    // 100%-affinity inputs so the gate is the only thing that can suppress
    // the ore.
  });
});

// ── OreVeinSampler — depth gate holds at extreme depth (#1183) ─────────────
//
// Direct tests against the existing (unstubbed) OreVeinSampler API, crafting
// a composition with 100% coefficient in a rock that strongly hosts the ore
// under test, so the depth gate (`depth < depthMin || depth > depthMax`) is
// the only thing that can suppress it — deterministic regardless of the
// noise field's actual value at the sampled point.

// ── requireValidGenDatum — a datum is a voxel row, not a size ─────────────

describe('requireValidGenDatum', () => {
  it('accepts zero and negative datums — a site centre may sit at or below y = 0', () => {
    expect(requireValidGenDatum(0, 'datum')).toBe(0);
    expect(requireValidGenDatum(-40, 'datum')).toBe(-40);
    expect(requireValidGenDatum(35, 'datum')).toBe(35);
  });

  it('accepts ±MAX_VOXEL_ABS_Y and throws one past it', () => {
    expect(requireValidGenDatum(MAX_VOXEL_ABS_Y, 'datum')).toBe(MAX_VOXEL_ABS_Y);
    expect(requireValidGenDatum(-MAX_VOXEL_ABS_Y, 'datum')).toBe(-MAX_VOXEL_ABS_Y);
    expect(() => requireValidGenDatum(MAX_VOXEL_ABS_Y + 1, 'datum')).toThrow(/corrupt save: datum/);
  });

  it('throws for a non-integer or non-finite datum', () => {
    expect(() => requireValidGenDatum(3.5, 'datum')).toThrow();
    expect(() => requireValidGenDatum(NaN, 'datum')).toThrow();
    expect(() => requireValidGenDatum(Infinity, 'datum')).toThrow();
  });
});

// ── requireValidGenDimension — shared save-corruption guard (#1218) ────────

describe('requireValidGenDimension', () => {
  it('returns the value unchanged for a valid positive integer within bounds', () => {
    expect(requireValidGenDimension(160, 'sizeX')).toBe(160);
  });

  it('accepts the exact boundary value MAX_TERRAIN_GEN_DIMENSION (inclusive)', () => {
    expect(requireValidGenDimension(MAX_TERRAIN_GEN_DIMENSION, 'sizeX')).toBe(MAX_TERRAIN_GEN_DIMENSION);
  });

  it('throws for MAX_TERRAIN_GEN_DIMENSION + 1', () => {
    expect(() => requireValidGenDimension(MAX_TERRAIN_GEN_DIMENSION + 1, 'sizeX')).toThrow();
  });

  it('throws for zero', () => {
    expect(() => requireValidGenDimension(0, 'sizeY')).toThrow();
  });

  it('throws for a negative number', () => {
    expect(() => requireValidGenDimension(-5, 'sizeZ')).toThrow();
  });

  it('throws for a non-integer', () => {
    expect(() => requireValidGenDimension(3.5, 'sizeX')).toThrow();
  });

  it('throws for NaN', () => {
    expect(() => requireValidGenDimension(NaN, 'sizeX')).toThrow();
  });

  it('includes the label in the thrown error message', () => {
    expect(() => requireValidGenDimension(-1, 'sizeZ')).toThrow(/sizeZ/);
  });
});

describe('OreVeinSampler — depth gate at extreme depth (#1183)', () => {
  it('an ore whose depthMax the extreme depth exceeds never appears, even with 100% host-rock affinity', () => {
    const sampler = new OreVeinSampler(42);
    // cruite hosts dirtite (depthMax 10) and rustite (depthMax 15) strongly.
    const composition = { rocks: [{ rockId: 'cruite', coefficient: 1 }] };
    const extremeDepth = 5000; // far past every ore's depthMax except treranium's 999
    const densities = sampler.densitiesAt(0, -5000, 0, extremeDepth, composition, 1.0);
    expect(densities['dirtite']).toBeUndefined();
    expect(densities['rustite']).toBeUndefined();
  });

  it('even treranium (depthMax 999, the deepest gate in the catalog) is excluded once depth exceeds its own ceiling', () => {
    const sampler = new OreVeinSampler(42);
    const composition = { rocks: [{ rockId: 'titanite', coefficient: 1 }] };
    const beyondEveryGate = 5000; // no ore's depthMax reaches this far
    const densities = sampler.densitiesAt(3, -5000, 7, beyondEveryGate, composition, 1.0);
    expect(densities['treranium']).toBeUndefined();
  });

  it('the same ore DOES respect its depth window when sampled inside it (regression: the gate is a window, not a one-sided cutoff)', () => {
    const sampler = new OreVeinSampler(42);
    const composition = { rocks: [{ rockId: 'cruite', coefficient: 1 }] };
    // dirtite's depthMin is 0, so depth 5 is inside its window and depth 5000 is not.
    const inWindow = sampler.densitiesAt(0, 0, 0, 5, composition, 1.0);
    const pastWindow = sampler.densitiesAt(0, 0, 0, 5000, composition, 1.0);
    expect(pastWindow['dirtite']).toBeUndefined();
    // In-window may or may not roll positive depending on the noise field at
    // this exact point — what this test locks down is that only the in-window
    // sample is even eligible to carry it.
    if (inWindow['dirtite'] !== undefined) {
      expect(inWindow['dirtite']).toBeGreaterThan(0);
    }
  });
});

// ── Unclamped columns across every campaign level's own grid (#1189) ───────
//
// TerrainGen never itself clamped (that lived in WorldGen.ts's
// heightToVoxelY/heightToVoxelYContinuous, already removed by #1183's own
// refactor pass) — but every real campaign level is exactly the shape that
// clamp used to bite: dusty_hollow's own relief (41.10m, #1078's own
// investigation) runs past its 40-tall grid. This locks in that the height
// generateTerrain's own context produces for every level, at every column of
// its rect plus its one-cell halo ring, matches the raw unclamped formula —
// no Math.max(1, Math.min(sizeY - 1, ...)) anywhere in the pipeline.

function levelTerrainConfig(levelId: string): TerrainConfig {
  const level = getAllLevels().find(l => l.id === levelId);
  if (!level) throw new Error(`levelTerrainConfig: no level ${levelId}`);
  return {
    sizeX: level.gridX,
    datum: level.datum,
    sizeZ: level.gridZ,
    seed: level.terrainSeed,
    climateBias: level.climateBias,
    mixedRockHardness: level.mixedRockHardness,
  };
}

/**
 * The raw, fully unclamped target formula #1189 leaves heightToVoxelY/
 * heightToVoxelYContinuous computing — reimplemented locally (not imported)
 * so this proves generateTerrain's OWN column output against the formula
 * itself, not against whichever WorldGen export happens to agree with it.
 */
function rawSurface(ctx: WorldGenContext, x: number, z: number): { continuous: number; voxelY: number } {
  const raw = sampleBaseHeight(ctx.fields, x, z, ctx.shapingAt(x, z));
  const masked = applyPitMask(raw, ctx.centerHeight, ctx.playableRect, x, z);
  const continuous = masked + ctx.groundOffset;
  return { continuous, voxelY: Math.round(continuous) };
}

describe('TerrainGen — unclamped columns across every campaign level (#1189)', () => {
  it('dusty_hollow: every column of the grid\'s own rect and its halo ring matches the raw unclamped formula exactly', () => {
    const config = levelTerrainConfig('dusty_hollow');
    const { worldGen } = buildTerrainContext(config);
    for (let x = -1; x <= config.sizeX; x++) {
      for (let z = -1; z <= config.sizeZ; z++) {
        const expected = rawSurface(worldGen, x, z);
        expect(sampleSurfaceHeightY(worldGen, x, z)).toBeCloseTo(expected.continuous, 9);
        expect(sampleSurfaceVoxelY(worldGen, x, z)).toBe(expected.voxelY);
      }
    }
  });

  it('dusty_hollow genuinely exceeds its own old [1, sizeY - 1] band somewhere in the rect — or the exhaustive check above proves nothing', () => {
    const config = levelTerrainConfig('dusty_hollow');
    const { worldGen } = buildTerrainContext(config);
    // The old (pre-#1190) sizeY-bounded band this level used to clamp into.
    // dusty_hollow's old declared height (`gridY`, pre-#1191) was 40 — #1191
    // dropped that field from `LevelDef` (dusty_hollow now authors `datum: 22`
    // directly, the same Math.floor(40 * 0.55) result `gridY: 40` used to
    // produce), so this is pinned to that same literal 40 rather than derived
    // from the level (which no longer carries a sizeY-like field at all —
    // datum is not a scan bound).
    const oldSizeY = 40;
    let exceeds = false;
    for (let x = 0; x < config.sizeX && !exceeds; x++) {
      for (let z = 0; z < config.sizeZ && !exceeds; z++) {
        const { continuous } = rawSurface(worldGen, x, z);
        if (continuous < 1 || continuous > oldSizeY - 1) exceeds = true;
      }
    }
    expect(exceeds).toBe(true);
  });

  for (const levelId of ['tutorial_pit', 'grumpstone_ridge', 'treranium_depths']) {
    it(`${levelId}: spot-checks its rect's corners, centre, and halo ring against the raw unclamped formula`, () => {
      const config = levelTerrainConfig(levelId);
      const { worldGen } = buildTerrainContext(config);
      const { sizeX, sizeZ } = config;
      const columns: Array<[number, number]> = [
        [0, 0], [sizeX - 1, 0], [0, sizeZ - 1], [sizeX - 1, sizeZ - 1],
        [Math.floor(sizeX / 2), Math.floor(sizeZ / 2)],
        [-1, -1], [sizeX, sizeZ], [-1, Math.floor(sizeZ / 2)], [Math.floor(sizeX / 2), -1],
      ];
      for (const [x, z] of columns) {
        const expected = rawSurface(worldGen, x, z);
        expect(sampleSurfaceHeightY(worldGen, x, z)).toBeCloseTo(expected.continuous, 9);
        expect(sampleSurfaceVoxelY(worldGen, x, z)).toBe(expected.voxelY);
      }
    });
  }
});

describe('climateBiasLandingOn (#1668)', () => {
  const SIZE = 64;
  const SEEDS = Array.from({ length: 300 }, (_, i) => i).concat([28, 29, 34, 39, 60, 72, 106]);

  function rawAtCentre(seed: number): [number, number] {
    const f = new WorldNoiseFields(seed);
    return [f.temperature(SIZE / 2, SIZE / 2), f.humidity(SIZE / 2, SIZE / 2)];
  }

  it.each(getAllBiomes().map(b => b.id))('%s: the returned bias lands the site centre on that biome for every seed', (id) => {
    const target = getBiome(id)!;
    const misses = SEEDS.filter(seed =>
      resolveGeneratedBiome(seed, SIZE, SIZE, climateBiasLandingOn(seed, SIZE, SIZE, target)).id !== id);
    expect(misses).toEqual([]);
  });

  it('returns the biome climate centre unchanged when the seed already lands there', () => {
    const target = getBiome('desert_badlands')!;
    const seed = SEEDS.find(s => resolveGeneratedBiome(s, SIZE, SIZE, target.climateCenter).id === target.id)!;
    expect([...climateBiasLandingOn(seed, SIZE, SIZE, target)]).toEqual([...target.climateCenter]);
  });

  it('offsets the centre by the seed raw climate when the seed does not land there', () => {
    const target = getBiome('desert_badlands')!;
    expect(resolveGeneratedBiome(29, SIZE, SIZE, target.climateCenter).id).not.toBe(target.id);
    const [rawT, rawH] = rawAtCentre(29);
    const bias = climateBiasLandingOn(29, SIZE, SIZE, target);
    expect(bias[0]).toBeCloseTo(target.climateCenter[0] - rawT, 9);
    expect(bias[1]).toBeCloseTo(target.climateCenter[1] - rawH, 9);
  });

  it('lands on the target even for the seeds with the most extreme raw climate', () => {
    const ranked = Array.from({ length: 3000 }, (_, seed) => {
      const [t, h] = rawAtCentre(seed);
      return { seed, extremity: Math.max(Math.abs(t), Math.abs(h)) };
    }).sort((a, b) => b.extremity - a.extremity).slice(0, 5);
    for (const { seed } of ranked) {
      for (const target of getAllBiomes()) {
        const bias = climateBiasLandingOn(seed, SIZE, SIZE, target);
        expect(resolveGeneratedBiome(seed, SIZE, SIZE, bias).id, `seed ${seed} -> ${target.id}`).toBe(target.id);
      }
    }
  });

  it('is deterministic and depends on the site size only through the centre sample', () => {
    const target = getBiome('red_canyon')!;
    expect([...climateBiasLandingOn(77, SIZE, SIZE, target)]).toEqual([...climateBiasLandingOn(77, SIZE, SIZE, target)]);
    const bias = climateBiasLandingOn(77, 96, 40, target);
    expect(resolveGeneratedBiome(77, 96, 40, bias).id).toBe('red_canyon');
  });
});


// #1670: ground outside the original site rectangle must carry ore, not be neutral border.
describe('TerrainGen — ore outside the original rectangle (#1670)', () => {
  const big = (): TerrainConfig => ({
    ...makeConfig(42, 'alpine_granite'), sizeX: 64, datum: Math.floor(64 * 0.55), sizeZ: 64,
  });

  /** Claim chunk (cx,cz) of a fresh grid and report ore stats over its solid voxels. */
  function oreStats(grid: VoxelGrid, xs: number[], zs: number[]): { solid: number; ore: number } {
    let solid = 0;
    let ore = 0;
    for (const x of xs) {
      for (const z of zs) {
        for (let y = 0; y < 30; y += 2) {
          const v = grid.getVoxel(x, y, z);
          if (!v || v.density <= 0) continue;
          solid++;
          if (Object.keys(v.oreDensities).length > 0) ore++;
        }
      }
    }
    return { solid, ore };
  }

  const range = (a: number, b: number): number[] => Array.from({ length: b - a }, (_, i) => a + i);

  function claimOutside(grid: VoxelGrid): void {
    for (const [cx, cz] of [[6, 1], [6, 2], [-2, 1], [-2, 2], [1, -2], [2, -2]] as const) grid.addChunk(cx, cz);
  }

  it('isInBorderZone is false outside the rectangle and true in the ring just inside', () => {
    expect(isInBorderZone(-1, 10, 64, 64, 5)).toBe(false);
    expect(isInBorderZone(100, 10, 64, 64, 5)).toBe(false);
    expect(isInBorderZone(10, -3, 64, 64, 5)).toBe(false);
    expect(isInBorderZone(10, 64, 64, 64, 5)).toBe(false);
    expect(isInBorderZone(2, 10, 64, 64, 5)).toBe(true);
    expect(isInBorderZone(61, 10, 64, 64, 5)).toBe(true);
  });

  it('generator version stays 1', () => {
    expect(TERRAIN_GENERATOR_VERSION).toBe(1);
  });

  describe('oreDeposits switch (#1682)', () => {
    const cfg = { sizeX: 64, datum: 24, sizeZ: 64, seed: 42, climateBias: [0.6, 0.7] as [number, number] };
    const oreSignature = (grid: ReturnType<typeof generateTerrain>): string => {
      const parts: string[] = [];
      for (let x = 0; x < 64; x += 2) for (let z = 0; z < 64; z += 2) for (let y = 0; y < 40; y++) {
        const ores = grid.oresAt(x, y, z);
        if (ores && Object.keys(ores).length > 0) parts.push(`${x},${y},${z}:${JSON.stringify(ores)}`);
      }
      return parts.join('|');
    };

    it('absent and false generate identical ore', () => {
      expect(oreSignature(generateTerrain({ ...cfg, oreDeposits: false }))).toBe(oreSignature(generateTerrain(cfg)));
    });

    it('true generates different ore than absent, but identical rock', () => {
      const on = generateTerrain({ ...cfg, oreDeposits: true });
      const off = generateTerrain(cfg);
      expect(oreSignature(on)).not.toBe(oreSignature(off));
      for (let x = 0; x < 64; x += 4) for (let z = 0; z < 64; z += 4) for (let y = 0; y < 40; y += 3) {
        expect(on.dominantRockAt(x, y, z)).toBe(off.dominantRockAt(x, y, z));
      }
    });

    it('is deterministic, and buildTerrainContext hands the sampler the switch', () => {
      expect(oreSignature(generateTerrain({ ...cfg, oreDeposits: true }))).toBe(oreSignature(generateTerrain({ ...cfg, oreDeposits: true })));
      const on = buildTerrainContext({ ...cfg, oreDeposits: true });
      const off = buildTerrainContext(cfg);
      const comp = { rocks: [{ rockId: 'cruite', coefficient: 1 }] };
      let differs = false;
      for (let x = 0; x < 64 && !differs; x++) for (let z = 0; z < 64; z += 3) {
        if (JSON.stringify(on.oreVeins.densitiesAt(x, 0, z, 5, comp, 1)) !== JSON.stringify(off.oreVeins.densitiesAt(x, 0, z, 5, comp, 1))) { differs = true; break; }
      }
      expect(differs).toBe(true);
    });
  });

  it('has ore in ground east, west and north of the rectangle', () => {
    const grid = generateTerrain(big());
    claimOutside(grid);
    const east = oreStats(grid, range(100, 108), range(16, 48));
    const west = oreStats(grid, range(-30, -22), range(16, 48));
    const north = oreStats(grid, range(16, 48), range(-30, -22));
    for (const s of [east, west, north]) {
      expect(s.solid).toBeGreaterThan(0);
      expect(s.ore).toBeGreaterThan(0);
    }
  });

  it('outside ore rate is at least half the interior rate', () => {
    const grid = generateTerrain(big());
    claimOutside(grid);
    const interior = oreStats(grid, range(10, 54), range(10, 54));
    const outside = oreStats(grid, range(96, 112), range(16, 48));
    expect(interior.ore).toBeGreaterThan(0);
    expect(outside.solid).toBeGreaterThan(0);
    expect(outside.ore / outside.solid).toBeGreaterThanOrEqual(0.5 * (interior.ore / interior.solid));
  });

  it('outside ore is deterministic across fresh generations', () => {
    const a = generateTerrain(big());
    const b = generateTerrain(big());
    claimOutside(a);
    claimOutside(b);
    for (const [x, z] of [[100, 20], [101, 33], [-25, 20], [30, -25]] as const) {
      for (let y = 0; y < 30; y += 3) {
        expect(a.getVoxel(x, y, z)!.oreDensities).toEqual(b.getVoxel(x, y, z)!.oreDensities);
      }
    }
  });

  it('ore stays absent in the ring just inside the rectangle', () => {
    const grid = generateTerrain(big());
    for (const [x, z] of [[0, 0], [63, 63], [2, 30], [30, 61]] as const) {
      for (let y = 0; y < 20; y++) {
        const v = grid.getVoxel(x, y, z)!;
        if (v.density > 0) expect(Object.keys(v.oreDensities).length).toBe(0);
      }
    }
  });
});

// ── Sandbox site joins the landscape (#1734) ───────────────────────────────

import { isStepClimbable } from '../../../src/core/nav/NavGrid.js';
import { sampleBaseHeight as sampleRawHeight } from '../../../src/core/world/WorldGen.js';
import { SANDBOX_FLAT_PAD_TARGET, SANDBOX_PIT_MASK, type PitMaskShape } from '../../../src/core/config/balance.js';
import { sandboxTerrainConfig, flatPadShare } from '../../helpers/sandboxSite.js';

describe('sandbox site blend (#1734)', () => {
  const SITE = 64;
  const CORE = SANDBOX_PIT_MASK.margin;
  const REACH = 30;
  const BIOMES = getAllBiomes().map(b => b.id);
  const RUGGED = ['alpine_granite', 'tropical_karst', 'red_canyon'];

  /**
   * Share of perimeter lines (every 4 m along each side, 1 m steps from the core edge outwards to 30 m past
   * the grid edge) whose blend is walkable. Only steps the mask made steeper than the landscape's own count:
   * a cliff the landscape has on its own, inside the cone, is not the blend's doing.
   */
  function walkableShare(biome: string, seed: number): number {
    const ctx = buildTerrainContext(sandboxTerrainConfig(biome, seed)).worldGen;
    const h = (x: number, z: number): number => sampleSurfaceHeightY(ctx, x, z);
    const natural = (x: number, z: number): number =>
      sampleRawHeight(ctx.fields, x, z, ctx.shapingAt(x, z)) + ctx.groundOffset;
    /**
     * The blend made this step steeper than the landscape's own: a cliff the landscape has on its own, inside
     * the cone, is not the blend's doing (the mask only flattens; it cannot erase a natural wall).
     */
    const blendSteepened = (x0: number, z0: number, x1: number, z1: number): boolean =>
      Math.abs(h(x1, z1) - h(x0, z0)) > Math.abs(natural(x1, z1) - natural(x0, z0)) + 0.05;
    let ok = 0, total = 0;
    for (let along = 4; along < SITE; along += 4) {
      const lines: Array<(t: number) => [number, number]> = [
        t => [CORE - t, along], t => [SITE - CORE + t, along],
        t => [along, CORE - t], t => [along, SITE - CORE + t],
      ];
      for (const at of lines) {
        let climbable = true;
        for (let t = 0; t < CORE + REACH; t++) {
          const [x0, z0] = at(t);
          const [x1, z1] = at(t + 1);
          if (blendSteepened(x0, z0, x1, z1) && !isStepClimbable(h(x0, z0), h(x1, z1), 1)) { climbable = false; break; }
        }
        total++;
        if (climbable) ok++;
      }
    }
    return ok / total;
  }

  describe.each(BIOMES)('%s', (biome) => {
    it.each([1, 7, 42])('seed %i: >= 80% of the perimeter is a walkable slope from the core edge to 30 m out', (seed) => {
      expect(walkableShare(biome, seed)).toBeGreaterThanOrEqual(0.8);
    });

    it.each([1, 7, 42])(`seed %i: at least ${SANDBOX_FLAT_PAD_TARGET * 100}% flat 9x9 pads survive`, (seed) => {
      expect(flatPadShare(generateTerrain(sandboxTerrainConfig(biome, seed)))).toBeGreaterThanOrEqual(SANDBOX_FLAT_PAD_TARGET);
    });

    it('generation is deterministic', () => {
      const a = buildTerrainContext(sandboxTerrainConfig(biome, 42)).worldGen;
      const b = buildTerrainContext(sandboxTerrainConfig(biome, 42)).worldGen;
      for (let x = -30; x <= 94; x += 13) for (let z = -30; z <= 94; z += 17) {
        expect(sampleSurfaceHeightY(a, x, z)).toBe(sampleSurfaceHeightY(b, x, z));
      }
    });
  });

  it.each(RUGGED)('%s: the flat outline is not a square slab (rounded, wobbling corners differ from a sharp rectangle)', (biome) => {
    for (const seed of [1, 7, 42]) {
      const config = sandboxTerrainConfig(biome, seed);
      const shaped = buildTerrainContext(config).worldGen;
      const sharpMask: PitMaskShape = { margin: CORE, reliefKeep: SANDBOX_PIT_MASK.reliefKeep, envelopeSlope: SANDBOX_PIT_MASK.envelopeSlope };
      const sharp = buildTerrainContext({ ...config, pitMask: sharpMask }).worldGen;
      const corners: Array<[number, number]> = [[0, 0], [SITE, 0], [0, SITE], [SITE, SITE]];
      let cornersDiffering = 0;
      for (const [cx, cz] of corners) {
        let maxDiff = 0;
        for (let dx = -20; dx <= 20; dx += 2) for (let dz = -20; dz <= 20; dz += 2) {
          maxDiff = Math.max(maxDiff, Math.abs(sampleSurfaceHeightY(shaped, cx + dx, cz + dz) - sampleSurfaceHeightY(sharp, cx + dx, cz + dz)));
        }
        if (maxDiff > 0.25) cornersDiffering++;
      }
      expect(cornersDiffering, `${biome} seed ${seed}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('the surface beyond the site still follows natural terrain once inside the cone', () => {
    const ctx = buildTerrainContext(sandboxTerrainConfig('alpine_granite', 42)).worldGen;
    let natural = 0, total = 0;
    for (let x = -200; x <= 264; x += 8) for (let z = -200; z <= 264; z += 8) {
      if (x > -60 && x < SITE + 60 && z > -60 && z < SITE + 60) continue;
      total++;
      const raw = sampleRawHeight(ctx.fields, x, z, ctx.shapingAt(x, z)) + ctx.groundOffset;
      if (Math.abs(sampleSurfaceHeightY(ctx, x, z) - raw) < 1e-6) natural++;
    }
    expect(natural / total).toBeGreaterThan(0.5);
  });
});

describe('requireValidPitMask — envelope fields (#1734)', () => {
  const full: PitMaskShape = { margin: 14, reliefKeep: 0.05, envelopeSlope: 0.45, outlineWobble: 3, cornerRadius: 8 };

  it('preserves envelopeSlope, outlineWobble and cornerRadius', () => {
    expect(requireValidPitMask(full, 'm')).toEqual(full);
    expect(requireValidPitMask(JSON.parse(JSON.stringify(full)), 'm')).toEqual(full);
  });

  it('a legacy two-field mask stays two fields', () => {
    expect(requireValidPitMask({ margin: 14, reliefKeep: 0.05 }, 'm')).toEqual({ margin: 14, reliefKeep: 0.05 });
  });

  it('accepts the boundaries: slope 1, wobble 0, radius 0', () => {
    const edge = { ...full, envelopeSlope: 1, outlineWobble: 0, cornerRadius: 0 };
    expect(requireValidPitMask(edge, 'm')).toEqual(edge);
  });

  it.each([
    ['NaN envelopeSlope', { envelopeSlope: NaN }],
    ['zero envelopeSlope', { envelopeSlope: 0 }],
    ['negative envelopeSlope', { envelopeSlope: -0.2 }],
    ['envelopeSlope above 1', { envelopeSlope: 1.01 }],
    ['NaN outlineWobble', { outlineWobble: NaN }],
    ['negative outlineWobble', { outlineWobble: -0.5 }],
    ['NaN cornerRadius', { cornerRadius: NaN }],
    ['negative cornerRadius', { cornerRadius: -3 }],
  ])('rejects %s with the corrupt-save error', (_label, extra) => {
    expect(() => requireValidPitMask({ ...full, ...extra }, 'world.pitMask')).toThrow(/corrupt save: world\.pitMask is not a valid pit mask/);
  });
});
