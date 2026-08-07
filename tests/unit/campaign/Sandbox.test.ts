// Sandbox config — pure-logic tests
//
// #504: sandbox setup collapsed from 11 controls to 3 — biome, difficulty,
// seed. Grid extents are now fixed constants and starting cash comes from
// the named difficulty rather than a free field.

import { describe, it, expect } from 'vitest';
import {
  SANDBOX_DEFAULTS,
  SANDBOX_DIFFICULTIES,
  SANDBOX_DIFFICULTY_ORDER,
  SANDBOX_FIELDS,
  SANDBOX_LEVEL_ID,
  SANDBOX_SEED_MAX,
  clampSandboxConfig,
  randomSandboxSeed,
  sandboxLevelDef,
  type SandboxConfig,
  type SandboxDifficultyId,
} from '../../../src/core/campaign/Sandbox.js';
import { getAllBiomes, getBiome } from '../../../src/core/world/BiomeCatalog.js';
import { getAllExplosives } from '../../../src/core/world/ExplosiveCatalog.js';
import { DEFAULT_GRID_SIZE, SANDBOX_GRID_DEPTH } from '../../../src/core/config/balance.js';

const LEVEL_FIELDS_SHARED_ACROSS_DIFFICULTY = [
  'unlockThreshold',
  'eventFreqMultiplier',
  'contractPriceMultiplier',
  'scoreDecayRate',
  'mixedRockHardness',
] as const;

describe('SANDBOX_DIFFICULTIES', () => {
  it('maps each named difficulty to its documented starting cash', () => {
    expect(SANDBOX_DIFFICULTIES.easy.startingCash).toBe(250_000);
    expect(SANDBOX_DIFFICULTIES.normal.startingCash).toBe(100_000);
    expect(SANDBOX_DIFFICULTIES.hard.startingCash).toBe(50_000);
  });

  it('carries the difficulty id and order consistently', () => {
    for (const id of SANDBOX_DIFFICULTY_ORDER) {
      expect(SANDBOX_DIFFICULTIES[id].id).toBe(id);
      expect(SANDBOX_DIFFICULTIES[id].labelKey).toBeTruthy();
    }
    expect(SANDBOX_DIFFICULTY_ORDER).toEqual(['easy', 'normal', 'hard']);
  });

  it('feeds sandboxLevelDef the matching starting cash for each difficulty', () => {
    for (const id of SANDBOX_DIFFICULTY_ORDER) {
      const level = sandboxLevelDef(clampSandboxConfig({ difficulty: id }));
      expect(level.startingCash).toBe(SANDBOX_DIFFICULTIES[id].startingCash);
    }
  });
});

describe('clampSandboxConfig', () => {
  it('returns the defaults for an empty partial', () => {
    expect(clampSandboxConfig({})).toEqual(SANDBOX_DEFAULTS);
  });

  it('keeps a biome, difficulty and seed that are already valid', () => {
    const cfg = clampSandboxConfig({ biome: 'alpine_granite', difficulty: 'hard', seed: 777 });
    expect(cfg.biome).toBe('alpine_granite');
    expect(cfg.difficulty).toBe('hard');
    expect(cfg.seed).toBe(777);
  });

  it('falls back to the default biome for an id the catalog does not know', () => {
    expect(clampSandboxConfig({ biome: 'not_a_biome' }).biome).toBe(SANDBOX_DEFAULTS.biome);
  });

  it('accepts every biome the catalog actually offers', () => {
    for (const biome of getAllBiomes()) {
      expect(clampSandboxConfig({ biome: biome.id }).biome).toBe(biome.id);
    }
  });

  it('falls back to the default difficulty for an id that is not a named preset', () => {
    const cfg = clampSandboxConfig({ difficulty: 'legendary' as SandboxDifficultyId });
    expect(cfg.difficulty).toBe(SANDBOX_DEFAULTS.difficulty);
  });

  it('falls back to the default difficulty for an inherited Object.prototype key (#504 prototype pollution)', () => {
    const cfg = clampSandboxConfig({ difficulty: 'constructor' as SandboxDifficultyId });
    expect(cfg.difficulty).toBe(SANDBOX_DEFAULTS.difficulty);
    expect(() => clampSandboxConfig({ difficulty: 'constructor' as SandboxDifficultyId })).not.toThrow();
  });

  it('accepts every named difficulty', () => {
    for (const id of SANDBOX_DIFFICULTY_ORDER) {
      expect(clampSandboxConfig({ difficulty: id }).difficulty).toBe(id);
    }
  });

  it('round-trips a seed already in range unchanged', () => {
    expect(clampSandboxConfig({ seed: 4242 }).seed).toBe(4242);
  });

  it('keeps the seed an exact integer so a map can be written down and replayed', () => {
    expect(clampSandboxConfig({ seed: 99.7 }).seed).toBe(100);
  });

  it('survives NaN and Infinity rather than passing them to the generator', () => {
    const cfg = clampSandboxConfig({ seed: NaN });
    expect(Number.isFinite(cfg.seed)).toBe(true);
    const cfg2 = clampSandboxConfig({ seed: Infinity });
    expect(Number.isFinite(cfg2.seed)).toBe(true);
  });

  it('is a total function — never throws on garbage input', () => {
    const garbage: Partial<SandboxConfig>[] = [
      { biome: 123 as unknown as string },
      { difficulty: 123 as unknown as SandboxDifficultyId },
      { difficulty: null as unknown as SandboxDifficultyId },
      { seed: 'not-a-number' as unknown as number },
      { seed: -50 },
    ];
    for (const partial of garbage) {
      expect(() => clampSandboxConfig(partial)).not.toThrow();
    }
    expect(() => clampSandboxConfig({} as Partial<SandboxConfig>)).not.toThrow();
  });
});

describe('randomSandboxSeed', () => {
  it('stays within the documented range for the low boundary', () => {
    const seed = randomSandboxSeed(() => 0);
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThanOrEqual(SANDBOX_SEED_MAX);
    expect(Number.isInteger(seed)).toBe(true);
  });

  it('stays within the documented range for the high boundary', () => {
    const seed = randomSandboxSeed(() => 0.999999);
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThanOrEqual(SANDBOX_SEED_MAX);
    expect(Number.isInteger(seed)).toBe(true);
  });

  it('round-trips through clamping unchanged — a rolled seed is always replayable', () => {
    for (const r of [0.1, 0.42, 0.87]) {
      const seed = randomSandboxSeed(() => r);
      expect(clampSandboxConfig({ seed }).seed).toBe(seed);
    }
  });
});

describe('sandboxLevelDef', () => {
  it('carries the chosen biome, seed and starting cash onto the level', () => {
    const level = sandboxLevelDef(clampSandboxConfig({
      biome: 'alpine_granite', seed: 777, difficulty: 'hard',
    }));
    expect(level.id).toBe(SANDBOX_LEVEL_ID);
    expect(level.biome).toBe('alpine_granite');
    expect(level.terrainSeed).toBe(777);
    expect(level.startingCash).toBe(SANDBOX_DIFFICULTIES.hard.startingCash);
  });

  it('takes climateBias from the chosen biome so terrain lands in that biome', () => {
    for (const biome of getAllBiomes()) {
      const level = sandboxLevelDef(clampSandboxConfig({ biome: biome.id }));
      expect(level.climateBias).toEqual(getBiome(biome.id)!.climateCenter);
    }
  });

  it('fixes grid extents to the shared constants regardless of config', () => {
    for (const biome of getAllBiomes()) {
      for (const difficulty of SANDBOX_DIFFICULTY_ORDER) {
        const level = sandboxLevelDef(clampSandboxConfig({ biome: biome.id, difficulty, seed: 999 }));
        expect(level.gridX).toBe(DEFAULT_GRID_SIZE);
        expect(level.gridZ).toBe(DEFAULT_GRID_SIZE);
        expect(level.gridY).toBe(SANDBOX_GRID_DEPTH);
      }
    }
  });

  it('grants the full explosive catalog, never a partial list', () => {
    const level = sandboxLevelDef(clampSandboxConfig({}));
    expect(level.availableExplosives).toEqual(getAllExplosives().map(e => e.id));
  });

  it('is deterministic — the same config always yields the same level', () => {
    const cfg = clampSandboxConfig({ biome: 'red_canyon', seed: 31337, difficulty: 'normal' });
    expect(sandboxLevelDef(cfg)).toEqual(sandboxLevelDef(cfg));
  });

  it('stays off the campaign world map, which lists difficultyTier > 0', () => {
    expect(sandboxLevelDef(SANDBOX_DEFAULTS).difficultyTier).toBe(0);
  });

  it('varies only startingCash across difficulty presets, holding biome and seed fixed', () => {
    const levels: Record<SandboxDifficultyId, ReturnType<typeof sandboxLevelDef>> =
      Object.fromEntries(SANDBOX_DIFFICULTY_ORDER.map(id => [
        id,
        sandboxLevelDef(clampSandboxConfig({ biome: 'tropical_karst', seed: 555, difficulty: id })),
      ])) as Record<SandboxDifficultyId, ReturnType<typeof sandboxLevelDef>>;

    const [first, ...rest] = SANDBOX_DIFFICULTY_ORDER;
    for (const key of LEVEL_FIELDS_SHARED_ACROSS_DIFFICULTY) {
      for (const id of rest) {
        expect(levels[id][key]).toEqual(levels[first!][key]);
      }
    }

    expect(levels.easy.startingCash).toBe(SANDBOX_DIFFICULTIES.easy.startingCash);
    expect(levels.normal.startingCash).toBe(SANDBOX_DIFFICULTIES.normal.startingCash);
    expect(levels.hard.startingCash).toBe(SANDBOX_DIFFICULTIES.hard.startingCash);

    // Cash presets must actually differ, or the "varies only cash" claim is vacuous.
    expect(levels.easy.startingCash).not.toBe(levels.normal.startingCash);
    expect(levels.normal.startingCash).not.toBe(levels.hard.startingCash);
  });

  it('clamps a hostile config rather than passing it through', () => {
    const level = sandboxLevelDef({
      biome: 'not_a_biome', difficulty: 'legendary' as SandboxDifficultyId, seed: -5,
    });
    expect(level.gridX).toBe(DEFAULT_GRID_SIZE);
    expect(level.gridY).toBe(SANDBOX_GRID_DEPTH);
    expect(level.startingCash).toBe(SANDBOX_DIFFICULTIES[SANDBOX_DEFAULTS.difficulty].startingCash);
  });
});

describe('SANDBOX_FIELDS', () => {
  it('describes exactly the three configurable fields (#504)', () => {
    const keys = SANDBOX_FIELDS.map(f => f.key);
    expect(keys).toEqual(['biome', 'difficulty', 'seed']);
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

  it('resolves options for every choice field', () => {
    for (const field of SANDBOX_FIELDS) {
      if (field.kind !== 'choice') continue;
      const options = field.options?.() ?? [];
      expect(options.length).toBeGreaterThan(0);
      for (const o of options) expect(o.labelKey).toBeTruthy();
    }
  });

  it('the difficulty field offers exactly the three named presets', () => {
    const field = SANDBOX_FIELDS.find(f => f.key === 'difficulty')!;
    const ids = (field.options?.() ?? []).map(o => o.id);
    expect(ids).toEqual(SANDBOX_DIFFICULTY_ORDER);
  });
});
