import { describe, it, expect } from 'vitest';
import {
  buildStrataProfile,
  buildMixedHardnessStrata,
  StrataSampler,
  type StratumDef,
} from '../../../src/core/world/Strata.js';

describe('buildStrataProfile', () => {
  it('derives 4 soft-to-hard layers for a 3-rock biome (desert_badlands rocks)', () => {
    // cruite/sandite tier 1, molite tier 2 — sorted: cruite, sandite, molite.
    const profile = buildStrataProfile(['cruite', 'sandite', 'molite']);
    expect(profile.length).toBe(4);
    expect(profile[0]!.blend.map(b => b.rockId)).toEqual(['cruite']);
    expect(profile[1]!.blend.map(b => b.rockId)).toEqual(['cruite']);
    expect(profile[2]!.blend.map(b => b.rockId)).toEqual(['sandite']);
    expect(profile[3]!.blend.map(b => b.rockId)).toEqual(['molite']);
  });

  it('maps 1:1 soft-to-hard when the biome has exactly 4 dominant rocks (alpine_granite rocks)', () => {
    // grumpite(2), clunkite(3), stubite(3), obstiite(4) — already ascending.
    const profile = buildStrataProfile(['grumpite', 'clunkite', 'stubite', 'obstiite']);
    expect(profile.map(l => l.blend.map(b => b.rockId))).toEqual([
      ['grumpite'], ['clunkite'], ['stubite'], ['obstiite'],
    ]);
  });

  it('shallow layers get lower mean thickness than deep layers', () => {
    const profile = buildStrataProfile(['cruite', 'sandite', 'molite']);
    for (let i = 1; i < profile.length; i++) {
      expect(profile[i]!.meanThickness).toBeGreaterThan(profile[i - 1]!.meanThickness);
    }
  });

  it('every layer blend coefficients sum to approximately 1', () => {
    const profile = buildStrataProfile(['grumpite', 'clunkite', 'stubite', 'obstiite']);
    for (const layer of profile) {
      const sum = layer.blend.reduce((s, b) => s + b.coefficient, 0);
      expect(sum).toBeCloseTo(1, 1);
    }
  });

  it('filters out unknown rock ids and still builds from the known ones', () => {
    const withJunk = buildStrataProfile(['not_a_real_rock', 'cruite', 'also_fake']);
    const clean = buildStrataProfile(['cruite']);
    expect(withJunk).toEqual(clean);
  });

  it('returns an empty profile when no rock id resolves', () => {
    expect(buildStrataProfile(['not_a_real_rock', 'still_fake'])).toEqual([]);
  });

  it('returns an empty profile for an empty input', () => {
    expect(buildStrataProfile([])).toEqual([]);
  });
});

describe('buildMixedHardnessStrata', () => {
  it('alternates the softest and hardest dominant rock across 6 layers', () => {
    // cruite/sandite tier 1 (softest = cruite, first in sorted order), molite tier 2 (hardest).
    const layers = buildMixedHardnessStrata(['cruite', 'sandite', 'molite']);
    expect(layers.length).toBe(6);
    for (let i = 0; i < layers.length; i++) {
      const expectedId = i % 2 === 0 ? 'cruite' : 'molite';
      expect(layers[i]!.blend).toEqual([{ rockId: expectedId, coefficient: 1 }]);
    }
  });

  it('uses ~5m mean thickness with variance 1 for every layer', () => {
    const layers = buildMixedHardnessStrata(['cruite', 'molite']);
    for (const layer of layers) {
      expect(layer.meanThickness).toBe(5);
      expect(layer.thicknessVariance).toBe(1);
    }
  });

  it('returns an empty profile when no rock id resolves', () => {
    expect(buildMixedHardnessStrata(['not_a_real_rock'])).toEqual([]);
  });
});

describe('StrataSampler.boundariesAt', () => {
  it('returns one strictly increasing cumulative boundary per layer', () => {
    const profile = buildStrataProfile(['cruite', 'sandite', 'molite']);
    const sampler = new StrataSampler(42, profile);
    const boundaries = sampler.boundariesAt(13, 27);
    expect(boundaries.length).toBe(profile.length);
    for (let i = 1; i < boundaries.length; i++) {
      expect(boundaries[i]!).toBeGreaterThan(boundaries[i - 1]!);
    }
  });

  it('is deterministic for the same seed, profile and column', () => {
    const profile = buildStrataProfile(['cruite', 'sandite', 'molite']);
    const a = new StrataSampler(7, profile).boundariesAt(5, 9);
    const b = new StrataSampler(7, profile).boundariesAt(5, 9);
    expect(a).toEqual(b);
  });

  it('varies across columns (tilt noise depends on x, z)', () => {
    const profile = buildStrataProfile(['cruite', 'sandite', 'molite']);
    const sampler = new StrataSampler(42, profile);
    const samples = Array.from({ length: 10 }, (_, i) => sampler.boundariesAt(i * 17, i * 31));
    const allSame = samples.every(s => JSON.stringify(s) === JSON.stringify(samples[0]));
    expect(allSame).toBe(false);
  });
});

describe('StrataSampler.compositionAt', () => {
  it('returns an empty composition for an empty profile regardless of inputs', () => {
    const sampler = new StrataSampler(1, []);
    const boundaries = sampler.boundariesAt(0, 0);
    expect(sampler.compositionAt(0, 0, 0, 0, boundaries)).toEqual({ rocks: [] });
    expect(sampler.compositionAt(50, 12, 8, 200, boundaries)).toEqual({ rocks: [] });
  });

  it('a single-layer profile always returns that layer unchanged, at any depth', () => {
    const profile: StratumDef[] = [
      { blend: [{ rockId: 'cruite', coefficient: 1 }], meanThickness: 10, thicknessVariance: 2 },
    ];
    const sampler = new StrataSampler(3, profile);
    for (const [x, y, z, depth] of [[0, 0, 0, 0], [5, 5, 5, 3], [10, 2, 8, 50], [3, 9, 4, 500]] as const) {
      const boundaries = sampler.boundariesAt(x, z);
      expect(sampler.compositionAt(x, y, z, depth, boundaries)).toEqual({
        rocks: [{ rockId: 'cruite', coefficient: 1 }],
      });
    }
  });

  it('clamps to the last layer once depth exceeds every boundary', () => {
    const profile: StratumDef[] = [
      { blend: [{ rockId: 'cruite', coefficient: 1 }], meanThickness: 10, thicknessVariance: 0 },
      { blend: [{ rockId: 'titanite', coefficient: 1 }], meanThickness: 10, thicknessVariance: 0 },
    ];
    const sampler = new StrataSampler(11, profile);
    const boundaries = sampler.boundariesAt(4, 6); // exactly [10, 20], no tilt
    // Depth 1000 is so far past boundary[1]=20 that the +-1.5m warp cannot matter.
    const comp = sampler.compositionAt(4, 0, 6, 1000, boundaries);
    expect(comp).toEqual({ rocks: [{ rockId: 'titanite', coefficient: 1 }] });
  });

  it('blends both layers within +-0.75m of a boundary (guaranteed to cross it across a depth scan)', () => {
    const profile: StratumDef[] = [
      { blend: [{ rockId: 'cruite', coefficient: 1 }], meanThickness: 10, thicknessVariance: 0 },
      { blend: [{ rockId: 'titanite', coefficient: 1 }], meanThickness: 10, thicknessVariance: 0 },
    ];
    const sampler = new StrataSampler(11, profile);
    const boundaries = sampler.boundariesAt(0, 0); // exactly [10, 20]
    // The per-voxel warp is bounded to +-1.5m, so scanning raw depth continuously
    // across [8, 12] must cross the boundary's +-0.75m blend window at least once,
    // regardless of the warp field's actual value at this column.
    let sawBlend = false;
    for (let depth = 8; depth <= 12; depth += 0.05) {
      const comp = sampler.compositionAt(0, 0, 0, depth, boundaries);
      if (comp.rocks.length === 2) { sawBlend = true; break; }
    }
    expect(sawBlend).toBe(true);
  });

  it('is deterministic for the same seed, profile and inputs', () => {
    const profile = buildStrataProfile(['grumpite', 'clunkite', 'stubite', 'obstiite']);
    const a = new StrataSampler(99, profile);
    const b = new StrataSampler(99, profile);
    const boundariesA = a.boundariesAt(6, 6);
    const boundariesB = b.boundariesAt(6, 6);
    expect(a.compositionAt(6, 4, 6, 12, boundariesA)).toEqual(b.compositionAt(6, 4, 6, 12, boundariesB));
  });
});
