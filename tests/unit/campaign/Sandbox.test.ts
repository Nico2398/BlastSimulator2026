// Sandbox config — pure-logic tests

import { describe, it, expect } from 'vitest';
import {
  SANDBOX_DEFAULTS,
  SANDBOX_FIELDS,
  SANDBOX_LEVEL_ID,
  SANDBOX_SIZE_MAX,
  SANDBOX_SIZE_MIN,
  SANDBOX_SEED_MAX,
  clampSandboxConfig,
  randomSandboxSeed,
  sandboxLevelDef,
} from '../../../src/core/campaign/Sandbox.js';
import { getAllBiomes, getBiome } from '../../../src/core/world/BiomeCatalog.js';
import { getAllExplosives } from '../../../src/core/world/ExplosiveCatalog.js';

describe('clampSandboxConfig', () => {
  it('returns the defaults for an empty partial', () => {
    expect(clampSandboxConfig({})).toEqual(SANDBOX_DEFAULTS);
  });

  it('keeps values that are already in range', () => {
    const cfg = clampSandboxConfig({ size: 96, depth: 40, seed: 777, startingCash: 250000 });
    expect(cfg.size).toBe(96);
    expect(cfg.depth).toBe(40);
    expect(cfg.seed).toBe(777);
    expect(cfg.startingCash).toBe(250000);
  });

  it('clamps grid extents to what the rest of the engine was sized for', () => {
    expect(clampSandboxConfig({ size: 5000 }).size).toBe(SANDBOX_SIZE_MAX);
    expect(clampSandboxConfig({ size: 1 }).size).toBe(SANDBOX_SIZE_MIN);
  });

  it('falls back to the default for a biome that is not in the catalog', () => {
    expect(clampSandboxConfig({ biome: 'not_a_biome' }).biome).toBe(SANDBOX_DEFAULTS.biome);
  });

  it('accepts every biome the catalog actually offers', () => {
    for (const biome of getAllBiomes()) {
      expect(clampSandboxConfig({ biome: biome.id }).biome).toBe(biome.id);
    }
  });

  it('drops explosive ids that are not in the catalog', () => {
    const real = getAllExplosives()[0]!.id;
    const cfg = clampSandboxConfig({ availableExplosives: [real, 'nitro_nonsense'] });
    expect(cfg.availableExplosives).toEqual([real]);
  });

  it('survives NaN and Infinity rather than passing them to the generator', () => {
    const cfg = clampSandboxConfig({ size: NaN, seed: Infinity, startingCash: -Infinity });
    expect(Number.isFinite(cfg.size)).toBe(true);
    expect(Number.isFinite(cfg.seed)).toBe(true);
    expect(Number.isFinite(cfg.startingCash)).toBe(true);
  });

  it('keeps the seed an exact integer so a map can be written down and replayed', () => {
    expect(clampSandboxConfig({ seed: 4242 }).seed).toBe(4242);
    expect(clampSandboxConfig({ seed: 99.7 }).seed).toBe(100);
  });
});

describe('randomSandboxSeed', () => {
  it('stays within the range the seed field accepts', () => {
    for (const r of [0, 0.5, 0.999999, 1 - Number.EPSILON]) {
      const seed = randomSandboxSeed(() => r);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThanOrEqual(SANDBOX_SEED_MAX);
      expect(Number.isInteger(seed)).toBe(true);
    }
  });

  it('round-trips through clamping unchanged — a rolled seed is always replayable', () => {
    for (const r of [0.1, 0.42, 0.87]) {
      const seed = randomSandboxSeed(() => r);
      expect(clampSandboxConfig({ seed }).seed).toBe(seed);
    }
  });
});

describe('sandboxLevelDef', () => {
  it('carries the chosen parameters onto the level', () => {
    const level = sandboxLevelDef(clampSandboxConfig({
      biome: 'alpine_granite', seed: 777, size: 48, depth: 24, startingCash: 250000,
    }));
    expect(level.id).toBe(SANDBOX_LEVEL_ID);
    expect(level.biome).toBe('alpine_granite');
    expect(level.terrainSeed).toBe(777);
    expect(level.gridX).toBe(48);
    expect(level.gridZ).toBe(48);
    expect(level.gridY).toBe(24);
    expect(level.startingCash).toBe(250000);
  });

  it('takes climateBias from the chosen biome so terrain lands in that biome', () => {
    for (const biome of getAllBiomes()) {
      const level = sandboxLevelDef(clampSandboxConfig({ biome: biome.id }));
      expect(level.climateBias).toEqual(getBiome(biome.id)!.climateCenter);
    }
  });

  it('treats an empty explosive selection as the whole catalog, not an unplayable site', () => {
    const level = sandboxLevelDef(clampSandboxConfig({ availableExplosives: [] }));
    expect(level.availableExplosives).toEqual(getAllExplosives().map(e => e.id));
  });

  it('honours an explicit explosive selection', () => {
    const level = sandboxLevelDef(clampSandboxConfig({ availableExplosives: ['boomite'] }));
    expect(level.availableExplosives).toEqual(['boomite']);
  });

  it('is deterministic — the same config always yields the same level', () => {
    const cfg = clampSandboxConfig({ biome: 'red_canyon', seed: 31337, size: 80 });
    expect(sandboxLevelDef(cfg)).toEqual(sandboxLevelDef(cfg));
  });

  it('stays off the campaign world map, which lists difficultyTier > 0', () => {
    expect(sandboxLevelDef(SANDBOX_DEFAULTS).difficultyTier).toBe(0);
  });

  it('clamps a hostile config rather than passing it through', () => {
    const level = sandboxLevelDef({ ...SANDBOX_DEFAULTS, size: 99999, depth: -5 });
    expect(level.gridX).toBe(SANDBOX_SIZE_MAX);
    expect(level.gridY).toBeGreaterThan(0);
  });
});

describe('SANDBOX_FIELDS', () => {
  it('describes every configurable key exactly once', () => {
    const keys = SANDBOX_FIELDS.map(f => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(keys)).toEqual(new Set(Object.keys(SANDBOX_DEFAULTS)));
  });

  it('gives every numeric field a usable range containing its default', () => {
    for (const field of SANDBOX_FIELDS) {
      if (field.kind !== 'number') continue;
      expect(field.min).toBeDefined();
      expect(field.max).toBeDefined();
      expect(field.min!).toBeLessThan(field.max!);
      const dflt = SANDBOX_DEFAULTS[field.key] as number;
      expect(dflt).toBeGreaterThanOrEqual(field.min!);
      expect(dflt).toBeLessThanOrEqual(field.max!);
    }
  });

  it('resolves options for every choice/multi field', () => {
    for (const field of SANDBOX_FIELDS) {
      if (field.kind !== 'choice' && field.kind !== 'multi') continue;
      const options = field.options?.() ?? [];
      expect(options.length).toBeGreaterThan(0);
      for (const o of options) expect(o.labelKey).toBeTruthy();
    }
  });
});
