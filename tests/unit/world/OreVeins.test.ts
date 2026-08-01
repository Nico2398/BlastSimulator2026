import { describe, it, expect } from 'vitest';
import { OreVeinSampler } from '../../../src/core/world/OreVeins.js';
import type { VoxelRockComposition } from '../../../src/core/world/VoxelGrid.js';

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
