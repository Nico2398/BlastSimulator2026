import { describe, it, expect } from 'vitest';
import { OreVeinSampler } from '../../../src/core/world/OreVeins.js';
import type { VoxelRockComposition } from '../../../src/core/world/VoxelGrid.js';
import { getAllBiomes } from '../../../src/core/world/BiomeCatalog.js';
import { getOre } from '../../../src/core/world/OreCatalog.js';
import { ORE_RARITY_TIERS } from '../../helpers/oreRarity.js';
import { SEEDS, BLOCK, MAX_DEPTH, sampleSite, blockIndexOf, shareBelow, richestDecileOverMedian, argmax, peakBlockByOre, type SiteOre } from '../../helpers/oreSite.js';
import { createRunner } from '../../../src/console/createRunner.js';

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

const MIN_BLOCK_ORE_KG = 2000;

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

// ---------------------------------------------------------------------------
// Ore deposits on sandbox sites (#1682)
// ---------------------------------------------------------------------------

describe('ore deposits off keeps today\'s ore (#1682)', () => {
  // Pinned on main before the change: cruite host rock, oreRichness 1.0, seed 42.
  const PINNED: ReadonlyArray<readonly [number, number, number, number, Record<string, number>]> = [
    [11, 4, 22, 6, { dirtite: 0.29 }],
    [3, 0, 5, 2, {}],
    [30, 2, 40, 5, {}],
    [50, 1, 9, 8, { dirtite: 0.95 }],
    [20, 3, 20, 3, { dirtite: 0.66 }],
    [44, 5, 31, 9, {}],
  ];

  for (const options of [undefined, {}, { deposits: false }] as const) {
    it(`densitiesAt matches the pre-change values with options ${JSON.stringify(options)}`, () => {
      const sampler = options === undefined ? new OreVeinSampler(42) : new OreVeinSampler(42, options);
      for (const [x, y, z, depth, expected] of PINNED) {
        expect(sampler.densitiesAt(x, y, z, depth, CRUITE_COMPOSITION, 1.0), `(${x},${y},${z}) d${depth}`).toEqual(expected);
      }
    });
  }

  it('OreVeinSampler(seed) equals OreVeinSampler(seed, { deposits: false }) over a large sample', () => {
    const plain = new OreVeinSampler(7);
    const off = new OreVeinSampler(7, { deposits: false });
    expect(scanColumns(off, 5, CRUITE_COMPOSITION, 1.0)).toEqual(scanColumns(plain, 5, CRUITE_COMPOSITION, 1.0));
  });

  it('turning deposits on changes the output somewhere', () => {
    const plain = new OreVeinSampler(7);
    const on = new OreVeinSampler(7, { deposits: true });
    expect(scanColumns(on, 5, CRUITE_COMPOSITION, 1.0)).not.toEqual(scanColumns(plain, 5, CRUITE_COMPOSITION, 1.0));
  });

  it('with deposits on the sampler is still deterministic and never invents ore outside its window', () => {
    const a = new OreVeinSampler(7, { deposits: true });
    const b = new OreVeinSampler(7, { deposits: true });
    expect(scanColumns(a, 5, CRUITE_COMPOSITION, 1.0)).toEqual(scanColumns(b, 5, CRUITE_COMPOSITION, 1.0));
    expect(scanColumns(a, 50, CRUITE_COMPOSITION, 1.0).every(r => !('dirtite' in r))).toBe(true);
    for (const r of scanColumns(a, 5, CRUITE_COMPOSITION, 1.0)) {
      for (const d of Object.values(r)) {
        expect(d).toBeGreaterThanOrEqual(0.05);
        expect(d).toBeLessThanOrEqual(1);
      }
    }
  });
});

/** The crew's start column in a real sandbox start of this biome and seed (not the site centre). */
function crewStartColumn(biomeId: string, seed: number): { x: number; z: number } {
  const { runner, ctx } = createRunner();
  const result = runner.run(`sandbox start biome:${biomeId} seed:${seed} staffed:true`);
  expect(result.success, result.output).toBe(true);
  const state = ctx.state!;
  const agents = [...state.employees.employees, ...state.vehicles.vehicles];
  expect(agents.length).toBeGreaterThan(0);
  return {
    x: Math.round(agents.reduce((s, a) => s + a.x, 0) / agents.length),
    z: Math.round(agents.reduce((s, a) => s + a.z, 0) / agents.length),
  };
}

describe('ore deposits on sandbox sites, every biome (#1682)', () => {
  const SLABS = [0, 1] as const; // 0-8 m and 8-16 m
  for (const biome of getAllBiomes()) {
    describe(biome.id, () => {
      for (const seed of SEEDS) {
        for (const slab of SLABS) {
          const label = `seed ${seed}, ${slab * BLOCK}-${(slab + 1) * BLOCK} m`;
          it(`${label}: at least 30% of blocks hold under 1 t of ore`, () => {
            const blocks = sampleSite(biome, seed, { oreDeposits: true }).blockMass[slab]!;
            expect(shareBelow(blocks, 1000)).toBeGreaterThanOrEqual(0.3);
          });

          it(`${label}: the richest decile averages at least 5x the median block`, () => {
            const blocks = sampleSite(biome, seed, { oreDeposits: true }).blockMass[slab]!;
            expect(richestDecileOverMedian(blocks)).toBeGreaterThanOrEqual(5);
          });

          it(`${label}: some block still holds real ore (the site is not barren)`, () => {
            const blocks = sampleSite(biome, seed, { oreDeposits: true }).blockMass[slab]!;
            expect(Math.max(...blocks)).toBeGreaterThanOrEqual(MIN_BLOCK_ORE_KG);
          });

          it(`${label}: different ores peak in different blocks`, () => {
            const peaks = Object.values(peakBlockByOre(sampleSite(biome, seed, { oreDeposits: true }), slab));
            expect(peaks.length, 'at least two ores carry mass').toBeGreaterThanOrEqual(2);
            expect(new Set(peaks).size).toBeGreaterThanOrEqual(2);
          });
        }
      }

      for (const slab of SLABS) {
        it(`${slab * BLOCK}-${(slab + 1) * BLOCK} m: for at least two of three seeds the block under the crew start is not the richest`, () => {
          let notRichest = 0;
          for (const seed of SEEDS) {
            const blocks = sampleSite(biome, seed, { oreDeposits: true }).blockMass[slab]!;
            const crew = crewStartColumn(biome.id, seed);
            const idx = blockIndexOf(crew.x, crew.z);
            // A crew outside the sampled interior cannot be standing on the richest sampled block.
            if (idx === null || idx !== argmax(blocks)) notRichest++;
          }
          expect(notRichest).toBeGreaterThanOrEqual(2);
        });
      }
    });
  }

  it('the legacy veins fail the distribution the deposits must meet (the helper has teeth)', () => {
    const desert = getAllBiomes().find(b => b.id === 'desert_badlands')!;
    const blocks = sampleSite(desert, 42, { oreDeposits: undefined }).blockMass[0]!;
    expect(shareBelow(blocks, 1000)).toBeLessThan(0.3);
  });
});

describe('oreSite helper definitions', () => {
  it('blockIndexOf maps interior columns to 6x6 blocks and rejects the border', () => {
    expect(blockIndexOf(8, 8)).toBe(0);
    expect(blockIndexOf(55, 55)).toBe(35);
    expect(blockIndexOf(16, 8)).toBe(6);
    expect(blockIndexOf(7, 20)).toBeNull();
    expect(blockIndexOf(20, 56)).toBeNull();
  });

  it('richestDecileOverMedian is large for a concentrated slab and 1-ish for a flat one', () => {
    const concentrated = [...new Array(32).fill(0), 20000, 20000, 20000, 20000];
    expect(richestDecileOverMedian(concentrated)).toBeGreaterThanOrEqual(5);
    expect(richestDecileOverMedian(new Array(36).fill(5000))).toBeCloseTo(1, 5);
  });

  it('shareBelow counts strictly-below blocks', () => {
    expect(shareBelow([0, 999, 1000, 5000], 1000)).toBe(0.5);
  });
});
