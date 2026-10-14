import { describe, it, expect } from 'vitest';
import { OreVeinSampler } from '../../../src/core/world/OreVeins.js';
import type { VoxelRockComposition } from '../../../src/core/world/VoxelGrid.js';
import { buildTerrainContext, climateBiasLandingOn } from '../../../src/core/world/TerrainGen.js';
import { sampleSurfaceHeightY } from '../../../src/core/world/WorldGen.js';
import { getAllBiomes, type BiomeDef } from '../../../src/core/world/BiomeCatalog.js';
import { getOre } from '../../../src/core/world/OreCatalog.js';
import { ORE_DENSITY_KG_M3 } from '../../../src/core/config/balance.js';
import { ORE_RARITY_TIERS } from '../../helpers/oreRarity.js';

// cruite: dirtite 0.40 (depth 0-10), rustite 0.15 (depth 0-15). No blingite entry at all.
const CRUITE_COMPOSITION: VoxelRockComposition = { rocks: [{ rockId: 'cruite', coefficient: 1 }] };
const AIR_COMPOSITION: VoxelRockComposition = { rocks: [] };

function scanColumns(sampler: OreVeinSampler, depth: number, composition: VoxelRockComposition, oreRichness: number): Record<string, number>[] {
  const results: Record<string, number>[] = [];
  for (let x = 0; x < 20; x++) {
    for (let z = 0; z < 20; z++) {
      results.push(sampler.densitiesAt(x, 0, z, depth, composition, oreRichness));
    }
  }
  return results;
}

describe('OreVeinSampler', () => {
  it('never produces an ore outside its depth window, even with strong host-rock affinity', () => {
    const sampler = new OreVeinSampler(42);
    // dirtite's window is 0-10m; sample well past it.
    const results = scanColumns(sampler, 50, CRUITE_COMPOSITION, 1.0);
    expect(results.every(r => !('dirtite' in r))).toBe(true);
  });

  it('never produces an ore the host rock has zero probability for, even inside its depth window', () => {
    const sampler = new OreVeinSampler(42);
    // blingite's window is 5-22m; cruite has no blingite entry at all (affinity always 0).
    const results = scanColumns(sampler, 12, CRUITE_COMPOSITION, 1.0);
    expect(results.every(r => !('blingite' in r))).toBe(true);
  });

  it('can produce an in-window, positive-affinity ore somewhere over a large sample', () => {
    const sampler = new OreVeinSampler(42);
    // depth 5 is inside both dirtite's (0-10) and rustite's (0-15) windows, and
    // cruite has positive affinity for both.
    const results = scanColumns(sampler, 5, CRUITE_COMPOSITION, 1.0);
    const anyOre = results.some(r => 'dirtite' in r || 'rustite' in r);
    expect(anyOre).toBe(true);
  });

  it('every stored density rounds to at least 0.05 and at most 1', () => {
    // The MIN_STORED_DENSITY cutoff (0.05) is checked before rounding to 2dp,
    // so a stored value can legitimately round down to exactly 0.05.
    const sampler = new OreVeinSampler(42);
    const results = scanColumns(sampler, 5, CRUITE_COMPOSITION, 1.0);
    for (const r of results) {
      for (const density of Object.values(r)) {
        expect(density).toBeGreaterThanOrEqual(0.05);
        expect(density).toBeLessThanOrEqual(1);
      }
    }
  });

  it('air (empty composition) never carries ore, at any depth', () => {
    const sampler = new OreVeinSampler(42);
    for (const depth of [0, 5, 20, 40]) {
      const result = sampler.densitiesAt(3, 2, 8, depth, AIR_COMPOSITION, 1.0);
      expect(result).toEqual({});
    }
  });

  it('is deterministic for the same seed and inputs', () => {
    const a = new OreVeinSampler(7);
    const b = new OreVeinSampler(7);
    expect(a.densitiesAt(11, 4, 22, 6, CRUITE_COMPOSITION, 1.0))
      .toEqual(b.densitiesAt(11, 4, 22, 6, CRUITE_COMPOSITION, 1.0));
  });

  it('different seeds diverge over a large sample', () => {
    const a = new OreVeinSampler(1);
    const b = new OreVeinSampler(2);
    const resultsA = scanColumns(a, 5, CRUITE_COMPOSITION, 1.0);
    const resultsB = scanColumns(b, 5, CRUITE_COMPOSITION, 1.0);
    const anyDifferent = resultsA.some((r, i) => JSON.stringify(r) !== JSON.stringify(resultsB[i]));
    expect(anyDifferent).toBe(true);
  });

  it('higher oreRichness never shrinks stored density at the same point', () => {
    const sampler = new OreVeinSampler(42);
    for (let x = 0; x < 10; x++) {
      const low = sampler.densitiesAt(x, 0, 3, 5, CRUITE_COMPOSITION, 0.5);
      const high = sampler.densitiesAt(x, 0, 3, 5, CRUITE_COMPOSITION, 1.5);
      for (const [oreId, density] of Object.entries(low)) {
        expect(high[oreId] ?? 0).toBeGreaterThanOrEqual(density);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Ore progression by depth, per biome (#1677)
// ---------------------------------------------------------------------------

const SEEDS = [1, 7, 42] as const;
const SITE = 64;
const DATUM = 17;
const INTERIOR_LO = 8;
const INTERIOR_HI = 56;
const BLOCK = 8;
const MAX_DEPTH = 40;
/** Sample every 2nd voxel on each axis (64 of 512 per block); each sample stands for 8 m3. */
const STRIDE = 2;
const SAMPLE_VOLUME_M3 = STRIDE * STRIDE * STRIDE;
const MIN_BLOCK_ORE_KG = 2000;

interface SiteOre {
  /** blockMass[slab][bx * 6 + bz] = ore kg in that 8x8x8 block. slab = floor(depth / 8). */
  blockMass: number[][];
  /** oreKg[depth][oreId] summed over every sampled interior column. */
  oreKgByDepth: Record<string, number>[];
}

const siteCache = new Map<string, SiteOre>();

/** Samples ore mass by depth over a site's interior, exactly as the sandbox builds its terrain. */
function sampleSite(biome: BiomeDef, seed: number): SiteOre {
  const key = `${biome.id}:${seed}`;
  const cached = siteCache.get(key);
  if (cached) return cached;

  const { worldGen, strata, oreVeins, biome: generated } = buildTerrainContext({
    sizeX: SITE, sizeZ: SITE, datum: DATUM, seed,
    climateBias: climateBiasLandingOn(seed, SITE, SITE, biome),
  });
  // The fixture is only meaningful if the site really is the requested biome.
  expect(generated.id).toBe(biome.id);

  const blocksPerAxis = (INTERIOR_HI - INTERIOR_LO) / BLOCK;
  const slabs = Math.ceil(MAX_DEPTH / BLOCK);
  const blockMass = Array.from({ length: slabs }, () => new Array<number>(blocksPerAxis * blocksPerAxis).fill(0));
  const oreKgByDepth: Record<string, number>[] = Array.from({ length: MAX_DEPTH }, () => ({}));

  for (let x = INTERIOR_LO; x < INTERIOR_HI; x += STRIDE) {
    for (let z = INTERIOR_LO; z < INTERIOR_HI; z += STRIDE) {
      const surfaceY = Math.round(sampleSurfaceHeightY(worldGen, x, z));
      const boundaries = strata.boundariesAt(x, z);
      const blockIdx = Math.floor((x - INTERIOR_LO) / BLOCK) * blocksPerAxis + Math.floor((z - INTERIOR_LO) / BLOCK);
      for (let depth = 0; depth < MAX_DEPTH; depth += STRIDE) {
        const y = surfaceY - depth;
        const composition = strata.compositionAt(x, y, z, depth, boundaries);
        const ores = oreVeins.densitiesAt(x, y, z, depth, composition, generated.oreRichness);
        for (const [oreId, density] of Object.entries(ores)) {
          const kg = density * SAMPLE_VOLUME_M3 * ORE_DENSITY_KG_M3;
          const slabMass = blockMass[Math.floor(depth / BLOCK)]!;
          slabMass[blockIdx] = (slabMass[blockIdx] ?? 0) + kg;
          const byOre = oreKgByDepth[depth]!;
          byOre[oreId] = (byOre[oreId] ?? 0) + kg;
        }
      }
    }
  }
  const site = { blockMass, oreKgByDepth };
  siteCache.set(key, site);
  return site;
}

function shareOfRichBlocks(site: SiteOre, slab: number): number {
  const blocks = site.blockMass[slab]!;
  return blocks.filter(kg => kg >= MIN_BLOCK_ORE_KG).length / blocks.length;
}

function oreKgInSlab(site: SiteOre, slab: number): number {
  let total = 0;
  for (let d = slab * BLOCK; d < (slab + 1) * BLOCK; d++) {
    for (const kg of Object.values(site.oreKgByDepth[d] ?? {})) total += kg;
  }
  return total;
}

describe('ore progression by depth, every biome (#1677)', () => {
  for (const biome of getAllBiomes()) {
    describe(biome.id, () => {
      for (const seed of SEEDS) {
        it(`seed ${seed}: more than half of the 0-8 m blocks hold at least 2 t of ore`, () => {
          expect(shareOfRichBlocks(sampleSite(biome, seed), 0)).toBeGreaterThan(0.5);
        });

        it(`seed ${seed}: more than half of the 24-32 m blocks hold at least 2 t of ore`, () => {
          expect(shareOfRichBlocks(sampleSite(biome, seed), 3)).toBeGreaterThan(0.5);
        });

        it(`seed ${seed}: no 8 m slab within 0-40 m is barren`, () => {
          const site = sampleSite(biome, seed);
          for (let slab = 0; slab < MAX_DEPTH / BLOCK; slab++) {
            expect(oreKgInSlab(site, slab), `slab ${slab * BLOCK}-${(slab + 1) * BLOCK} m`).toBeGreaterThan(0);
          }
        });

        it(`seed ${seed}: rarer tiers sit deeper on average than commoner tiers`, () => {
          const site = sampleSite(biome, seed);
          const mass = new Map<string, number>();
          const depthMoment = new Map<string, number>();
          site.oreKgByDepth.forEach((byOre, depth) => {
            for (const [oreId, kg] of Object.entries(byOre)) {
              const tier = getOre(oreId)!.rarity;
              mass.set(tier, (mass.get(tier) ?? 0) + kg);
              depthMoment.set(tier, (depthMoment.get(tier) ?? 0) + kg * depth);
            }
          });
          const means = ORE_RARITY_TIERS.filter(t => (mass.get(t) ?? 0) > 0).map(t => ({ tier: t, mean: depthMoment.get(t)! / mass.get(t)! }));
          const meanAt = (i: number): number => means[i]!.mean;
          // Every biome must offer at least a common and one deeper tier to climb.
          expect(means.length).toBeGreaterThanOrEqual(2);
          for (let i = 1; i < means.length; i++) {
            expect(meanAt(i), `${means[i]!.tier} vs ${means[i - 1]!.tier}`).toBeGreaterThan(meanAt(i - 1));
          }
        });
      }
    });
  }
});

describe('desert and red canyon shallow ore stays as it is (#1677)', () => {
  // Kg over the sampled interior columns, measured on main before the change: the tutorial's scripted sale and Dusty Hollow's tuning rest on it.
  // Blingite starts at 5 m, so 0-4 m is the band only dirtite and rustite may ever occupy.
  const SHALLOW_DEPTH = 5;
  const PINNED_KG: Record<string, Record<number, { dirtite: number; rustite: number }>> = {
    desert_badlands: {
      1: { dirtite: 8829200, rustite: 1298800 },
      7: { dirtite: 9294800, rustite: 1522200 },
      42: { dirtite: 9341000, rustite: 1052800 },
    },
    red_canyon: {
      1: { dirtite: 6449000, rustite: 2727600 },
      7: { dirtite: 7507200, rustite: 3079800 },
      42: { dirtite: 7770000, rustite: 3109200 },
    },
  };

  for (const biomeId of Object.keys(PINNED_KG)) {
    const biome = getAllBiomes().find(b => b.id === biomeId)!;
    for (const seed of SEEDS) {
      it(`${biomeId} seed ${seed}: 0-5 m ore is only dirtite and rustite, in unchanged amounts`, () => {
        const site = sampleSite(biome, seed);
        const kg: Record<string, number> = {};
        for (let d = 0; d < SHALLOW_DEPTH; d++) {
          for (const [oreId, v] of Object.entries(site.oreKgByDepth[d] ?? {})) kg[oreId] = (kg[oreId] ?? 0) + v;
        }
        expect(Object.keys(kg).sort()).toEqual(['dirtite', 'rustite']);
        expect(kg.dirtite).toBeCloseTo(PINNED_KG[biomeId]![seed]!.dirtite, 0);
        expect(kg.rustite).toBeCloseTo(PINNED_KG[biomeId]![seed]!.rustite, 0);
      });
    }
  }
});
