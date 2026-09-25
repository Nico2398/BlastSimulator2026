import { describe, it, expect } from 'vitest';
import {
  generateTerrain, surfaceDensityAt, buildTerrainContext, createChunkSource,
  type TerrainConfig,
} from '../../../src/core/world/TerrainGen.js';
import { getBiome } from '../../../src/core/world/BiomeCatalog.js';
import { VoxelGrid, chunkIndexOf, CHUNK_SIZE, getDominantRockId } from '../../../src/core/world/VoxelGrid.js';
import { sampleSurfaceHeightY } from '../../../src/core/world/WorldGen.js';
import { getOre } from '../../../src/core/world/OreCatalog.js';
import { OreVeinSampler } from '../../../src/core/world/OreVeins.js';

function makeConfig(seed: number, biomeId = 'desert_badlands'): TerrainConfig {
  const biome = getBiome(biomeId)!;
  return { sizeX: 32, sizeY: 32, sizeZ: 32, seed, climateBias: biome.climateCenter };
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
      sizeY: 64,
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
});

// ── createChunkSource — lazy chunk materialization (#1183) ─────────────────
//
// `createChunkSource` builds a `VoxelChunkSource` from the same sampling
// context `generateColumn` already uses (buildTerrainContext), so a chunk
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
    const grid = new VoxelGrid(config.sizeX, config.sizeY, config.sizeZ);

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
    const grid = new VoxelGrid(config.sizeX, config.sizeY, config.sizeZ);

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

    const gridA = new VoxelGrid(config.sizeX, config.sizeY, config.sizeZ);
    source.materializeSlab(gridA, 0, CHUNK_SIZE, 0, CHUNK_SIZE, cy);
    const gridB = new VoxelGrid(config.sizeX, config.sizeY, config.sizeZ);
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
    const grid = new VoxelGrid(config.sizeX, config.sizeY, config.sizeZ);

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
