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
import { DEFAULT_GRID_SIZE, SANDBOX_DATUM } from '../../../src/core/config/balance.js';
import { resolveGeneratedBiome } from '../../../src/core/world/TerrainGen.js';
import { WorldNoiseFields } from '../../../src/core/world/NoiseFields.js';

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
        expect(level.datum).toBe(SANDBOX_DATUM);
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
    expect(level.datum).toBe(SANDBOX_DATUM);
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

// #1668: the generated biome is the picked one on every seed, not just the ~75-97% whose
// raw climate happens to sit near the picked biome's climate centre.
describe('sandboxLevelDef — generated biome equals the picked biome (#1668)', () => {
  const SEEDS = [...Array.from({ length: 1000 }, (_, i) => i), 28, 29, 34, 39, 60, 72, 106];
  const biomeField = SANDBOX_FIELDS.find(f => f.key === 'biome')!;
  const pickable = (biomeField.kind === 'choice' ? biomeField.options() : []).map(o => o.id);

  it('offers all six biomes', () => {
    expect(pickable).toHaveLength(6);
  });

  it.each(pickable)('%s: resolveGeneratedBiome lands on the picked biome for every seed', (picked) => {
    const misses: string[] = [];
    for (const seed of SEEDS) {
      const level = sandboxLevelDef(clampSandboxConfig({ biome: picked, difficulty: 'normal', seed }));
      const generated = resolveGeneratedBiome(seed, level.gridX, level.gridZ, level.climateBias);
      if (generated.id !== picked) misses.push(`${seed}->${generated.id}`);
    }
    expect(misses.slice(0, 10)).toEqual([]);
  });

  it('is deterministic across calls and across difficulties', () => {
    for (const seed of [29, 34, 106, 4242]) {
      const first = sandboxLevelDef(clampSandboxConfig({ biome: 'desert_badlands', difficulty: 'normal', seed }));
      const again = sandboxLevelDef(clampSandboxConfig({ biome: 'desert_badlands', difficulty: 'normal', seed }));
      expect(again.climateBias).toEqual(first.climateBias);
      for (const difficulty of SANDBOX_DIFFICULTY_ORDER) {
        const other = sandboxLevelDef(clampSandboxConfig({ biome: 'desert_badlands', difficulty, seed }));
        expect(other.climateBias).toEqual(first.climateBias);
      }
    }
  });

  it('keeps the biome climate centre exactly for a seed that already lands on it', () => {
    const centre = getBiome('desert_badlands')!.climateCenter;
    const seed = SEEDS.find(s =>
      resolveGeneratedBiome(s, DEFAULT_GRID_SIZE, DEFAULT_GRID_SIZE, centre).id === 'desert_badlands')!;
    const level = sandboxLevelDef(clampSandboxConfig({ biome: 'desert_badlands', seed }));
    expect([...level.climateBias]).toEqual([...centre]);
  });

  it('shifts the bias off the climate centre for desert seed 29, which drifts to volcanic', () => {
    const centre = getBiome('desert_badlands')!.climateCenter;
    expect(resolveGeneratedBiome(29, DEFAULT_GRID_SIZE, DEFAULT_GRID_SIZE, centre).id).not.toBe('desert_badlands');
    const level = sandboxLevelDef(clampSandboxConfig({ biome: 'desert_badlands', seed: 29 }));
    expect([...level.climateBias]).not.toEqual([...centre]);
  });

  it('cancels the seed raw climate at the site centre when it shifts the bias', () => {
    const centre = getBiome('desert_badlands')!.climateCenter;
    const fields = new WorldNoiseFields(29);
    const rawT = fields.temperature(DEFAULT_GRID_SIZE / 2, DEFAULT_GRID_SIZE / 2);
    const rawH = fields.humidity(DEFAULT_GRID_SIZE / 2, DEFAULT_GRID_SIZE / 2);
    const level = sandboxLevelDef(clampSandboxConfig({ biome: 'desert_badlands', seed: 29 }));
    expect(level.climateBias[0]).toBeCloseTo(centre[0] - rawT, 6);
    expect(level.climateBias[1]).toBeCloseTo(centre[1] - rawH, 6);
  });
});
