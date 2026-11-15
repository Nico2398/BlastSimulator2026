import { describe, it, expect } from 'vitest';
import { OreVeinSampler, oreDepthMultiplier } from '../../../src/core/world/OreVeins.js';
import type { VoxelRockComposition } from '../../../src/core/world/VoxelGrid.js';
import { getAllBiomes } from '../../../src/core/world/BiomeCatalog.js';
import { getOre, getAllOres, orePermitGrade } from '../../../src/core/world/OreCatalog.js';
import { getAllRocks } from '../../../src/core/world/RockCatalog.js';
import { ORE_RARITY_TIERS } from '../../helpers/oreRarity.js';
import { SEEDS, BLOCK, MAX_DEPTH, sampleSite, blockIndexOf, shareBelow, richestDecileOverMedian, argmax, peakBlockByOre, type SiteOre } from '../../helpers/oreSite.js';
import { ORE_DEPOSIT_RARITY_COVERAGE, ORE_DEPTH_MULTIPLIER_BANDS, ORE_DEPTH_BLEND_M, ORE_G0_LAYER_DEPTH_M } from '../../../src/core/config/balance.js';
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

describe('ore deposit rarity coverage (#1682)', () => {
  it('every rarity in the ore catalog has a deposit coverage entry', () => {
    for (const ore of getAllOres()) {
      expect(ORE_DEPOSIT_RARITY_COVERAGE[ore.rarity], `${ore.id} (${ore.rarity})`).toBeTypeOf('number');
    }
  });
});

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

          it(`${label}: the richest decile averages at least 5x the median block (median floored at 1 t)`, () => {
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
    const blocks = sampleSite(desert, 42).blockMass[0]!;
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

describe('ore grade scale (#1932)', () => {
  const COMPOSITIONS: VoxelRockComposition[] = [CRUITE_COMPOSITION];
  const DEPTHS = [1, 5, 9, 12, 20];

  function scan(sampler: OreVeinSampler): Array<Record<string, number>> {
    const out: Array<Record<string, number>> = [];
    for (const comp of COMPOSITIONS) for (const depth of DEPTHS) {
      for (let x = 0; x < 24; x++) for (let z = 0; z < 24; z++) out.push(sampler.densitiesAt(x, 0, z, depth, comp, 1.0));
    }
    return out;
  }

  it('scale 0.2 multiplies every density by 0.2 and keeps the same non-zero voxels', () => {
    const base = scan(new OreVeinSampler(42, { deposits: true }));
    const scaled = scan(new OreVeinSampler(42, { deposits: true, gradeScale: 0.2 }));
    expect(base.some(r => Object.keys(r).length > 0)).toBe(true);
    base.forEach((row, i) => {
      expect(Object.keys(scaled[i]!).sort()).toEqual(Object.keys(row).sort());
      for (const [ore, d] of Object.entries(row)) expect(scaled[i]![ore]!).toBeCloseTo(d * 0.2, 12);
    });
  });

  it('scaled densities are not re-rounded (the smallest scaled density is the 0.05 cut times 0.2, below the cut)', () => {
    const scaled = scan(new OreVeinSampler(42, { deposits: true, gradeScale: 0.2 }));
    const values = scaled.flatMap(r => Object.values(r));
    expect(values.length).toBeGreaterThan(0);
    expect(Math.min(...values)).toBeLessThan(0.05);
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0.05 * 0.2 - 1e-12);
  });

  it('scale 1 is identical to no scale option', () => {
    expect(scan(new OreVeinSampler(42, { deposits: true, gradeScale: 1 }))).toEqual(scan(new OreVeinSampler(42, { deposits: true })));
  });

  it('works on legacy continuous veins too', () => {
    const base = scan(new OreVeinSampler(7));
    const scaled = scan(new OreVeinSampler(7, { gradeScale: 0.5 }));
    base.forEach((row, i) => {
      for (const [ore, d] of Object.entries(row)) expect(scaled[i]![ore]!).toBeCloseTo(d * 0.5, 12);
    });
  });
});

describe('ore depth multiplier (#1933)', () => {
  it('uses the configured bands and a 3 m blend', () => {
    expect(ORE_DEPTH_MULTIPLIER_BANDS.map(b => [b.fromDepth, b.multiplier])).toEqual([[0, 1], [10, 1.4], [20, 1.8], [35, 2.2]]);
    expect(ORE_DEPTH_BLEND_M).toBe(3);
  });

  it('is exactly 1 from the surface down to 10 m', () => {
    for (let d = 0; d <= 10; d += 0.5) expect(oreDepthMultiplier(d), `d${d}`).toBe(1);
  });

  it('is 1.4 flat from 13 to 20 m, 1.8 from 23 to 35 m, 2.2 from 38 m on', () => {
    for (let d = 13; d <= 20; d += 0.5) expect(oreDepthMultiplier(d), `d${d}`).toBeCloseTo(1.4, 12);
    for (let d = 23; d <= 35; d += 0.5) expect(oreDepthMultiplier(d), `d${d}`).toBeCloseTo(1.8, 12);
    for (let d = 38; d <= 120; d += 0.5) expect(oreDepthMultiplier(d), `d${d}`).toBeCloseTo(2.2, 12);
  });

  it('ramps by smoothstep: halfway through a blend is the midpoint multiplier', () => {
    expect(oreDepthMultiplier(11.5)).toBeCloseTo(1.2, 12);
    expect(oreDepthMultiplier(21.5)).toBeCloseTo(1.6, 12);
    expect(oreDepthMultiplier(36.5)).toBeCloseTo(2.0, 12);
    // smoothstep is flat at the ends: a quarter in is below the linear value
    expect(oreDepthMultiplier(10.75)).toBeLessThan(1 + 0.4 * 0.25);
    expect(oreDepthMultiplier(10.75)).toBeGreaterThan(1);
  });

  it('is continuous and non-decreasing: no jump over 0.5 m steps from 0 to 80 m', () => {
    let prev = oreDepthMultiplier(0);
    for (let d = 0.5; d <= 80; d += 0.5) {
      const m = oreDepthMultiplier(d);
      expect(m, `d${d}`).toBeGreaterThanOrEqual(prev);
      // steepest smoothstep slope is 1.5 * 0.4 / 3 = 0.2 per m, so 0.1 per 0.5 m
      expect(m - prev, `d${d}`).toBeLessThanOrEqual(0.1 + 1e-9);
      prev = m;
    }
  });

  it('is 1 for a depth above the surface', () => {
    expect(oreDepthMultiplier(-3)).toBe(1);
  });
});

describe('ore depth multiplier in densitiesAt (#1933)', () => {
  const ALL_ROCKS: VoxelRockComposition = { rocks: ['cruite', 'sandite', 'molite', 'grumpite', 'clunkite', 'stubite', 'obstiite', 'gnarlite', 'absurdite', 'titanite'].map(rockId => ({ rockId, coefficient: 0.1 })) };
  const REF_DEPTH = 8;
  // blingite (5-40 m) spans every band, so one voxel can be read at the reference depth and a deeper one.
  const ORE = 'blingite';

  /** blingite density per lattice voxel at one depth; null where absent. */
  function field(sampler: OreVeinSampler, depth: number, richness = 1.0): Array<number | null> {
    const out: Array<number | null> = [];
    for (let x = 0; x < 60; x++) for (let z = 0; z < 60; z++) out.push(sampler.densitiesAt(x, 0, z, depth, ALL_ROCKS, richness)[ORE] ?? null);
    return out;
  }
  const expectedBoost = (stored: number, depth: number) => Math.round(Math.min(1, stored * oreDepthMultiplier(depth)) * 100) / 100;

  it('the reference field holds ore to compare', () => {
    const ref = field(new OreVeinSampler(42, { deposits: true }), REF_DEPTH, 2.0).filter(d => d !== null);
    expect(ref.length).toBeGreaterThan(50);
  });

  for (const depth of [15, 18, 25, 33, 40]) {
    it(`with deposits on, depth ${depth} m density is round(min(1, base x ${depth === 15 || depth === 18 ? 1.4 : depth < 36 ? 1.8 : 2.2}) x 100) / 100`, () => {
      const sampler = new OreVeinSampler(42, { deposits: true });
      const base = field(sampler, REF_DEPTH, 2.0);
      const deep = field(sampler, depth, 2.0);
      let checked = 0;
      base.forEach((b, i) => {
        if (b === null) return;
        expect(deep[i], `voxel ${i}`).not.toBeNull();
        expect(deep[i]!).toBeCloseTo(expectedBoost(b, depth), 12);
        checked++;
      });
      expect(checked).toBeGreaterThan(50);
    });
  }

  it('a boosted density is clamped at 1 and some voxels reach the clamp', () => {
    const sampler = new OreVeinSampler(42, { deposits: true });
    const base = field(sampler, REF_DEPTH, 2.0);
    const deep = field(sampler, 40, 2.0);
    expect(base.some(b => b !== null && b * 2.2 > 1)).toBe(true);
    for (const d of deep) if (d !== null) expect(d).toBeLessThanOrEqual(1);
    expect(deep.some(d => d === 1)).toBe(true);
  });

  it('boosting never creates ore: the same voxels hold ore at every depth in the window', () => {
    const sampler = new OreVeinSampler(42, { deposits: true });
    const holds = (f: Array<number | null>) => f.map(d => d !== null);
    const ref = holds(field(sampler, REF_DEPTH, 2.0));
    for (const depth of [12, 15, 25, 39]) expect(holds(field(sampler, depth, 2.0)), `d${depth}`).toEqual(ref);
  });

  it('depths 1-4 m (multiplier 1) are untouched: same density as the 0 m reading for a G0 ore', () => {
    const sampler = new OreVeinSampler(42, { deposits: true });
    const read = (depth: number) => {
      const out: Array<number | null> = [];
      for (let x = 0; x < 40; x++) for (let z = 0; z < 40; z++) out.push(sampler.densitiesAt(x, 0, z, depth, CRUITE_COMPOSITION, 1.0)['rustite'] ?? null);
      return out;
    };
    const ref = read(0);
    expect(ref.some(d => d !== null)).toBe(true);
    for (let depth = 1; depth <= 4; depth++) expect(read(depth), `d${depth}`).toEqual(ref);
  });

  it('depths 6-9 m (multiplier 1) are untouched: same density as the 8 m reading for a G1 ore', () => {
    const sampler = new OreVeinSampler(42, { deposits: true });
    const read = (depth: number) => field(sampler, depth, 2.0);
    const ref = read(8);
    expect(ref.some(d => d !== null)).toBe(true);
    for (const depth of [6, 7, 9]) expect(read(depth), `d${depth}`).toEqual(ref);
  });

  it('deposits off: density does not change with depth (no boost on legacy veins)', () => {
    const sampler = new OreVeinSampler(7);
    const read = (depth: number) => {
      const out: Array<number | null> = [];
      for (let x = 0; x < 40; x++) for (let z = 0; z < 40; z++) out.push(sampler.densitiesAt(x, 0, z, depth, CRUITE_COMPOSITION, 1.0)['rustite'] ?? null);
      return out;
    };
    expect(read(5).some(d => d !== null)).toBe(true);
    expect(read(15)).toEqual(read(5));
    expect(read(12)).toEqual(read(5));
  });

  it('deposits explicitly false behaves like the legacy sampler at depth', () => {
    const a = new OreVeinSampler(7, { deposits: false });
    const b = new OreVeinSampler(7);
    for (const depth of [15, 25, 40]) expect(scanColumns(a, depth, ALL_ROCKS, 1.0)).toEqual(scanColumns(b, depth, ALL_ROCKS, 1.0));
    // and blingite there is not boosted relative to its shallow reading
    const read = (depth: number) => scanColumns(a, depth, ALL_ROCKS, 1.0).map(r => r[ORE] ?? null);
    expect(read(15)).toEqual(read(8));
  });

  it('gradeScale applies after the boost: scaled == boosted x scale, unrounded', () => {
    const boosted = new OreVeinSampler(42, { deposits: true });
    const scaled = new OreVeinSampler(42, { deposits: true, gradeScale: 0.2 });
    for (const depth of [15, 25, 40]) {
      const a = field(boosted, depth, 2.0);
      const b = field(scaled, depth, 2.0);
      expect(a.some(d => d !== null)).toBe(true);
      a.forEach((d, i) => {
        if (d === null) expect(b[i]).toBeNull();
        else expect(b[i]!).toBeCloseTo(d * 0.2, 12);
      });
    }
  });
});

describe('sandbox deposits: depth pays (#1933)', () => {
  it('a deposit ore reads richer at 30 m than at 6 m in the same column and rock', () => {
    const sampler = new OreVeinSampler(42, { deposits: true });
    const comp: VoxelRockComposition = { rocks: [{ rockId: 'molite', coefficient: 1 }] };
    let both = 0;
    for (let x = 0; x < 60; x++) for (let z = 0; z < 60; z++) {
      const shallow = sampler.densitiesAt(x, 0, z, 6, comp, 2.0)['blingite'];
      const deep = sampler.densitiesAt(x, 0, z, 30, comp, 2.0)['blingite'];
      if (shallow === undefined) continue;
      both++;
      expect(deep, `x${x} z${z}`).toBeGreaterThanOrEqual(shallow);
    }
    expect(both).toBeGreaterThan(20);
  });
});

// ---------------------------------------------------------------------------
// Ore grade layers on a progression site (#2281)
// ---------------------------------------------------------------------------

describe('ore grade layers on a progression site (#2281)', () => {
  const G0 = ['dirtite', 'rustite'];
  const G1 = ['blingite', 'gloomium', 'sparkium'];
  const G2_G3 = ['craktonite', 'absurdium', 'treranium'];
  const ROCK_IDS = getAllRocks().map(r => r.id);
  const ALL_ROCKS_BLEND: VoxelRockComposition = { rocks: ROCK_IDS.map(rockId => ({ rockId, coefficient: 1 / ROCK_IDS.length })) };

  /** Every ore id found over a lattice of columns (step apart) at one depth. */
  function oresFound(sampler: OreVeinSampler, depth: number, composition: VoxelRockComposition, richness: number, lattice = 30, step = 4): Set<string> {
    const found = new Set<string>();
    for (let i = 0; i < lattice; i++) for (let j = 0; j < lattice; j++) {
      for (const id of Object.keys(sampler.densitiesAt(i * step, 0, j * step, depth, composition, richness))) found.add(id);
    }
    return found;
  }
  const single = (rockId: string): VoxelRockComposition => ({ rocks: [{ rockId, coefficient: 1 }] });

  describe('C1 G0 only in the top layer, G1 only below it', () => {
    for (const rockId of ROCK_IDS) {
      for (const seed of [1, 42]) {
        it(`${rockId} seed ${seed}: no G1 ore above ${ORE_G0_LAYER_DEPTH_M} m, no G0 ore below it`, () => {
          const sampler = new OreVeinSampler(seed, { deposits: true });
          for (const depth of [0, 1, 2, 3, 4]) {
            const found = oresFound(sampler, depth, single(rockId), 2.0);
            for (const id of G1) expect(found.has(id), `${id} at ${depth} m`).toBe(false);
          }
          for (const depth of [6, 7, 8, 10, 15, 25, 40]) {
            const found = oresFound(sampler, depth, single(rockId), 2.0);
            for (const id of G0) expect(found.has(id), `${id} at ${depth} m`).toBe(false);
          }
        });
      }
    }

    it('the blend of every rock obeys the layers over a finer depth sweep', () => {
      const sampler = new OreVeinSampler(7, { deposits: true });
      for (let depth = 0; depth <= 20; depth++) {
        const found = oresFound(sampler, depth, ALL_ROCKS_BLEND, 3.0, 20, 5);
        for (const id of found) {
          const grade = orePermitGrade(id)!;
          if (depth < ORE_G0_LAYER_DEPTH_M) expect(grade, `${id} at ${depth} m`).toBe(0);
          if (depth > ORE_G0_LAYER_DEPTH_M) expect(grade, `${id} at ${depth} m`).toBe(1);
        }
      }
    });

    it('the layers are not vacuous: G0 ore is found in the top layer and G1 ore below it', () => {
      const sampler = new OreVeinSampler(42, { deposits: true });
      expect(G0.some(id => oresFound(sampler, 3, ALL_ROCKS_BLEND, 2.0).has(id))).toBe(true);
      expect(G1.some(id => oresFound(sampler, 12, ALL_ROCKS_BLEND, 2.0).has(id))).toBe(true);
    });
  });

  describe('C2 no G2 or G3 ore in ordinary ground', () => {
    for (const rockId of ROCK_IDS) {
      it(`${rockId}: craktonite, absurdium and treranium never occur at any depth`, () => {
        const sampler = new OreVeinSampler(42, { deposits: true });
        for (const depth of [0, 5, 10, 18, 25, 30, 40, 55, 80, 150]) {
          const found = oresFound(sampler, depth, single(rockId), 3.0);
          for (const id of G2_G3) expect(found.has(id), `${id} at ${depth} m`).toBe(false);
        }
      });
    }

    it('across seeds, the blend of every rock holds none of them at depth', () => {
      for (const seed of [1, 7, 42]) {
        const sampler = new OreVeinSampler(seed, { deposits: true });
        for (const depth of [20, 30, 45, 60]) {
          const found = oresFound(sampler, depth, ALL_ROCKS_BLEND, 3.0, 20, 5);
          for (const id of G2_G3) expect(found.has(id), `seed ${seed}: ${id} at ${depth} m`).toBe(false);
        }
      }
    });
  });

  describe('C3 every rock holds both grades', () => {
    for (const rockId of ROCK_IDS) {
      it(`${rockId}: yields a G0 ore at 3 m and a G1 ore at 12 m over a few seeds`, () => {
        const g0 = new Set<string>();
        const g1 = new Set<string>();
        for (const seed of [1, 7, 42]) {
          const sampler = new OreVeinSampler(seed, { deposits: true });
          for (const id of oresFound(sampler, 3, single(rockId), 1.0, 40, 3)) g0.add(id);
          for (const id of oresFound(sampler, 12, single(rockId), 1.0, 40, 3)) g1.add(id);
        }
        expect(G0.some(id => g0.has(id)), 'a G0 ore').toBe(true);
        expect(G1.some(id => g1.has(id)), 'a G1 ore').toBe(true);
      });
    }
  });

  describe('C4 G1 ores start at their catalog depth and density grows with depth', () => {
    it('no gloomium above 8 m and no sparkium above 15 m, but both below', () => {
      const sampler = new OreVeinSampler(42, { deposits: true });
      for (const depth of [5, 6, 7]) expect(oresFound(sampler, depth, ALL_ROCKS_BLEND, 3.0).has('gloomium'), `gloomium ${depth} m`).toBe(false);
      for (const depth of [5, 8, 12, 14]) expect(oresFound(sampler, depth, ALL_ROCKS_BLEND, 3.0).has('sparkium'), `sparkium ${depth} m`).toBe(false);
      expect(oresFound(sampler, 10, ALL_ROCKS_BLEND, 3.0).has('gloomium')).toBe(true);
      expect(oresFound(sampler, 20, ALL_ROCKS_BLEND, 3.0).has('sparkium')).toBe(true);
    });

    it('blingite occurs right below the G0 layer', () => {
      const sampler = new OreVeinSampler(42, { deposits: true });
      expect(oresFound(sampler, 6, ALL_ROCKS_BLEND, 3.0).has('blingite')).toBe(true);
    });

    for (const [oreId, shallow, deep] of [['blingite', 6, 25], ['gloomium', 9, 25], ['sparkium', 16, 33]] as const) {
      it(`${oreId}: the same voxel is never poorer at ${deep} m than at ${shallow} m, and some are richer`, () => {
        const sampler = new OreVeinSampler(42, { deposits: true });
        let held = 0, richer = 0;
        for (let x = 0; x < 60; x++) for (let z = 0; z < 60; z++) {
          const a = sampler.densitiesAt(x, 0, z, shallow, ALL_ROCKS_BLEND, 2.0)[oreId];
          const b = sampler.densitiesAt(x, 0, z, deep, ALL_ROCKS_BLEND, 2.0)[oreId];
          if (a === undefined) continue;
          held++;
          expect(b, `x${x} z${z}`).toBeDefined();
          expect(b!).toBeGreaterThanOrEqual(a);
          if (b! > a) richer++;
        }
        expect(held).toBeGreaterThan(20);
        expect(richer).toBeGreaterThan(0);
      });
    }
  });

  describe('C6 deposits off: the catalog windows and host rocks apply as before', () => {
    it('a legacy sampler still holds a G0 ore below 5 m (dirtite to 10 m)', () => {
      const sampler = new OreVeinSampler(42);
      expect(oresFound(sampler, 8, single('cruite'), 1.0, 40, 3).has('dirtite')).toBe(true);
    });

    it('a legacy sampler still holds a G2 ore where the catalog hosts it (gnarlite, craktonite from 18 m)', () => {
      const sampler = new OreVeinSampler(42);
      expect(oresFound(sampler, 25, single('gnarlite'), 2.0, 40, 3).has('craktonite')).toBe(true);
    });

    it('a legacy sampler still holds a G3 ore where the catalog hosts it (titanite, treranium from 32 m)', () => {
      const sampler = new OreVeinSampler(42);
      expect(oresFound(sampler, 40, single('titanite'), 2.0, 40, 3).has('treranium')).toBe(true);
    });

    it('a legacy sampler hosts only what the catalog says: titanite holds no G0 ore', () => {
      const sampler = new OreVeinSampler(42);
      const found = oresFound(sampler, 3, single('titanite'), 3.0, 40, 3);
      for (const id of G0) expect(found.has(id)).toBe(false);
    });

    it('a legacy sampler holds a G1 ore where the catalog starts it (molite, blingite from 5 m) and none above it', () => {
      const sampler = new OreVeinSampler(42);
      expect(oresFound(sampler, 8, single('molite'), 1.0, 40, 3).has('blingite')).toBe(true);
      expect(oresFound(sampler, 3, single('molite'), 3.0, 40, 3).has('blingite')).toBe(false);
    });
  });
});

describe('ore grade layers over a whole sandbox site, every biome (#2281)', () => {
  const G0 = ['dirtite', 'rustite'];
  const G1 = ['blingite', 'gloomium', 'sparkium'];
  const G2_G3 = ['craktonite', 'absurdium', 'treranium'];

  /** Total kg of the given ores over the depths in [from, to] (sampled depths only). */
  function kgIn(site: SiteOre, ores: readonly string[], from: number, to: number): number {
    let total = 0;
    for (let d = from; d <= to && d < MAX_DEPTH; d++) for (const id of ores) total += site.oreKgByDepth[d]?.[id] ?? 0;
    return total;
  }

  for (const biome of getAllBiomes()) {
    describe(biome.id, () => {
      for (const seed of SEEDS) {
        it(`seed ${seed}: C1 no G1 ore above ${ORE_G0_LAYER_DEPTH_M} m and no G0 ore below it`, () => {
          const site = sampleSite(biome, seed, { oreDeposits: true });
          expect(kgIn(site, G1, 0, ORE_G0_LAYER_DEPTH_M - 1)).toBe(0);
          expect(kgIn(site, G0, ORE_G0_LAYER_DEPTH_M + 1, MAX_DEPTH)).toBe(0);
        });

        it(`seed ${seed}: C2 no G2 or G3 ore at any depth`, () => {
          const site = sampleSite(biome, seed, { oreDeposits: true });
          expect(kgIn(site, G2_G3, 0, MAX_DEPTH)).toBe(0);
        });
      }

      it('C3 holds G0 ore above the layer and G1 ore below it, over the sampled seeds', () => {
        let g0 = 0, g1 = 0;
        for (const seed of SEEDS) {
          const site = sampleSite(biome, seed, { oreDeposits: true });
          g0 += kgIn(site, G0, 0, ORE_G0_LAYER_DEPTH_M);
          g1 += kgIn(site, G1, ORE_G0_LAYER_DEPTH_M, MAX_DEPTH);
        }
        expect(g0).toBeGreaterThan(0);
        expect(g1).toBeGreaterThan(0);
      });

      it('C4 gloomium only from 8 m and sparkium only from 15 m', () => {
        for (const seed of SEEDS) {
          const site = sampleSite(biome, seed, { oreDeposits: true });
          expect(kgIn(site, ['gloomium'], 0, 7), `seed ${seed} gloomium`).toBe(0);
          expect(kgIn(site, ['sparkium'], 0, 14), `seed ${seed} sparkium`).toBe(0);
        }
      });
    });
  }

  it('C4 blingite occurs right below the layer, gloomium and sparkium deeper, somewhere across biomes and seeds', () => {
    let blingite = 0, gloomium = 0, sparkium = 0;
    for (const biome of getAllBiomes()) for (const seed of SEEDS) {
      const site = sampleSite(biome, seed, { oreDeposits: true });
      blingite += kgIn(site, ['blingite'], ORE_G0_LAYER_DEPTH_M, 9);
      gloomium += kgIn(site, ['gloomium'], 8, MAX_DEPTH);
      sparkium += kgIn(site, ['sparkium'], 15, MAX_DEPTH);
    }
    expect(blingite).toBeGreaterThan(0);
    expect(gloomium).toBeGreaterThan(0);
    expect(sparkium).toBeGreaterThan(0);
  });

  it('C6 a site with ore deposits off is not banded: it still holds G0 ore below the layer (the helper has teeth)', () => {
    const desert = getAllBiomes().find(b => b.id === 'desert_badlands')!;
    const legacy = sampleSite(desert, 42);
    expect(kgIn(legacy, G0, ORE_G0_LAYER_DEPTH_M + 1, MAX_DEPTH)).toBeGreaterThan(0);
  });
});
