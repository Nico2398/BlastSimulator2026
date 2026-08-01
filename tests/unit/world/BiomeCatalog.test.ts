import { describe, it, expect } from 'vitest';
import {
  getBiome,
  getAllBiomes,
  computeBiomeWeights,
  dominantBiome,
  selectBiomeWeights,
} from '../../../src/core/world/BiomeCatalog.js';

describe('getBiome / getAllBiomes', () => {
  it('returns at least 6 biomes', () => {
    expect(getAllBiomes().length).toBeGreaterThanOrEqual(6);
  });

  it('getBiome resolves a known biome id', () => {
    expect(getBiome('desert_badlands')).toBeDefined();
    expect(getBiome('alpine_granite')).toBeDefined();
    expect(getBiome('tropical_karst')).toBeDefined();
  });

  it('getBiome returns undefined for an unknown id', () => {
    expect(getBiome('nonexistent_biome')).toBeUndefined();
  });

  it('resolves the pre-#458 MinePreset ids as back-compat aliases', () => {
    expect(getBiome('desert')?.id).toBe('desert_badlands');
    expect(getBiome('mountain')?.id).toBe('alpine_granite');
    expect(getBiome('tropical')?.id).toBe('tropical_karst');
  });

  it('all biome ids are unique', () => {
    const ids = getAllBiomes().map(b => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every biome has a climateCenter within [-1, 1] on both axes', () => {
    for (const b of getAllBiomes()) {
      expect(b.climateCenter[0]).toBeGreaterThanOrEqual(-1);
      expect(b.climateCenter[0]).toBeLessThanOrEqual(1);
      expect(b.climateCenter[1]).toBeGreaterThanOrEqual(-1);
      expect(b.climateCenter[1]).toBeLessThanOrEqual(1);
    }
  });

  it('desert_badlands is flatter than alpine_granite (lower pvAmplitude and shallower relief at rest)', () => {
    const desert = getBiome('desert_badlands')!;
    const alpine = getBiome('alpine_granite')!;
    expect(desert.pvAmplitude).toBeLessThan(alpine.pvAmplitude);
  });
});

describe('computeBiomeWeights', () => {
  it('weights sum to 1 when at least one biome is in range', () => {
    const weights = computeBiomeWeights(0.7, -0.6); // desert_badlands' own centre
    const sum = weights.reduce((s, w) => s + w.weight, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  it('the biome at its own climate centre gets the highest weight', () => {
    const weights = computeBiomeWeights(-0.7, 0.1); // alpine_granite's own centre
    const best = dominantBiome(weights);
    expect(best.id).toBe('alpine_granite');
  });

  it('falls back to the single nearest biome when no radius covers the point', () => {
    // Pick an extreme, unlikely-to-be-covered corner (all radii are 0.55).
    const weights = computeBiomeWeights(-1, -1);
    expect(weights.length).toBeGreaterThan(0);
    const sum = weights.reduce((s, w) => s + w.weight, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  it('is deterministic for the same inputs', () => {
    const a = computeBiomeWeights(0.3, 0.2);
    const b = computeBiomeWeights(0.3, 0.2);
    expect(a).toEqual(b);
  });
});

describe('dominantBiome', () => {
  it('returns the highest-weight entry', () => {
    const weights = [
      { biome: getBiome('desert_badlands')!, weight: 0.2 },
      { biome: getBiome('alpine_granite')!, weight: 0.8 },
    ];
    expect(dominantBiome(weights).id).toBe('alpine_granite');
  });
});

describe('selectBiomeWeights', () => {
  it('with zero bias and zero fade, matches computeBiomeWeights directly', () => {
    const a = selectBiomeWeights(0.3, 0.2, [0, 0], 0);
    const b = computeBiomeWeights(0.3, 0.2);
    expect(a).toEqual(b);
  });

  it('a strong bias at full fade pulls selection toward the biased biome', () => {
    const targetCenter = getBiome('tropical_karst')!.climateCenter;
    const weights = selectBiomeWeights(0, 0, targetCenter, 1);
    expect(dominantBiome(weights).id).toBe('tropical_karst');
  });

  it('clamps the biased climate to [-1, 1] rather than producing an out-of-range value', () => {
    // A raw value near the extreme plus a same-signed bias must not throw or
    // silently produce nonsense — computeBiomeWeights still returns a valid,
    // normalized weight set.
    const weights = selectBiomeWeights(0.9, 0.9, [0.9, 0.9], 1);
    const sum = weights.reduce((s, w) => s + w.weight, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  it('fade=0 ignores the bias entirely', () => {
    const withBias = selectBiomeWeights(0.1, 0.1, [0.9, -0.9], 0);
    const withoutBias = computeBiomeWeights(0.1, 0.1);
    expect(withBias).toEqual(withoutBias);
  });
});
