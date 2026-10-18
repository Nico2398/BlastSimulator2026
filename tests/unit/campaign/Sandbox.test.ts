// Sandbox config — pure-logic tests
//
// #504: sandbox setup collapsed from 11 controls to 3 — biome, starting kit,
// seed (#1891 replaced difficulty with kit). Grid extents are fixed constants
// and starting cash comes from the named kit rather than a free field.

import { describe, it, expect } from 'vitest';
import {
  SANDBOX_DEFAULTS,
  SANDBOX_KITS,
  SANDBOX_KIT_ORDER,
  SANDBOX_FIELDS,
  SANDBOX_LEVEL_ID,
  SANDBOX_SEED_MAX,
  clampSandboxConfig,
  randomSandboxSeed,
  sandboxLevelDef,
  type SandboxConfig,
  type SandboxKitId,
  resolveSandboxKitId,
} from '../../../src/core/campaign/Sandbox.js';
import { isValidOreGradeScale } from '../../../src/core/economy/OreGrade.js';
import { getLevel } from '../../../src/core/campaign/Level.js';
import { getAllBiomes, getBiome } from '../../../src/core/world/BiomeCatalog.js';
import { getAllExplosives } from '../../../src/core/world/ExplosiveCatalog.js';
import { DEFAULT_GRID_SIZE, SANDBOX_DATUM, DUSTY_HOLLOW_STARTING_SITE } from '../../../src/core/config/balance.js';
import { resolveGeneratedBiome } from '../../../src/core/world/TerrainGen.js';
import { WorldNoiseFields } from '../../../src/core/world/NoiseFields.js';

const LEVEL_FIELDS_SHARED_ACROSS_KITS = [
  'unlockThreshold',
  'eventFreqMultiplier',
  'contractPriceMultiplier',
  'scoreDecayRate',
  'mixedRockHardness',
] as const;

describe('SANDBOX_KITS (#1891)', () => {
  it('maps each named kit to its documented starting cash', () => {
    expect(SANDBOX_KITS.digger.startingCash).toBe(210_000);
    expect(SANDBOX_KITS.full.startingCash).toBe(250_000);
  });

  it('carries the kit id and order consistently', () => {
    for (const id of SANDBOX_KIT_ORDER) {
      expect(SANDBOX_KITS[id].id).toBe(id);
      expect(SANDBOX_KITS[id].labelKey).toBe(`sandbox.kit.${id}`);
    }
    expect(SANDBOX_KIT_ORDER).toEqual(['digger', 'full']);
  });

  it('defaults to the digger kit', () => {
    expect(SANDBOX_DEFAULTS.kit).toBe('digger');
  });

  it('feeds sandboxLevelDef the matching starting cash for each kit', () => {
    for (const id of SANDBOX_KIT_ORDER) {
      const level = sandboxLevelDef(clampSandboxConfig({ kit: id }));
      expect(level.startingCash).toBe(SANDBOX_KITS[id].startingCash);
    }
  });
});

describe('resolveSandboxKitId (#1891)', () => {
  it('returns a kit id unchanged', () => {
    expect(resolveSandboxKitId('digger')).toBe('digger');
    expect(resolveSandboxKitId('full')).toBe('full');
  });

  it('maps legacy difficulty names: easy -> full, normal/hard -> digger', () => {
    expect(resolveSandboxKitId('easy')).toBe('full');
    expect(resolveSandboxKitId('normal')).toBe('digger');
    expect(resolveSandboxKitId('hard')).toBe('digger');
  });

  it('lowercases and trims', () => {
    expect(resolveSandboxKitId('  FULL ')).toBe('full');
    expect(resolveSandboxKitId('Easy')).toBe('full');
    expect(resolveSandboxKitId(' Digger')).toBe('digger');
  });

  it('returns undefined for unknown, empty and prototype-key input', () => {
    expect(resolveSandboxKitId('legendary')).toBeUndefined();
    expect(resolveSandboxKitId('')).toBeUndefined();
    expect(resolveSandboxKitId('constructor')).toBeUndefined();
    expect(resolveSandboxKitId('__proto__')).toBeUndefined();
    expect(resolveSandboxKitId('toString')).toBeUndefined();
  });
});

describe('clampSandboxConfig', () => {
  it('returns the defaults for an empty partial', () => {
    expect(clampSandboxConfig({})).toEqual(SANDBOX_DEFAULTS);
  });

  it('keeps a biome, kit and seed that are already valid', () => {
    const cfg = clampSandboxConfig({ biome: 'alpine_granite', kit: 'full', seed: 777 });
    expect(cfg.biome).toBe('alpine_granite');
    expect(cfg.kit).toBe('full');
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

  it('falls back to the default kit for an id that is not a named kit', () => {
    const cfg = clampSandboxConfig({ kit: 'legendary' as SandboxKitId });
    expect(cfg.kit).toBe(SANDBOX_DEFAULTS.kit);
  });

  it('falls back to the default kit for an inherited Object.prototype key (#504 prototype pollution)', () => {
    const cfg = clampSandboxConfig({ kit: 'constructor' as SandboxKitId });
    expect(cfg.kit).toBe(SANDBOX_DEFAULTS.kit);
    expect(() => clampSandboxConfig({ kit: 'constructor' as SandboxKitId })).not.toThrow();
  });

  it('accepts every named kit', () => {
    for (const id of SANDBOX_KIT_ORDER) {
      expect(clampSandboxConfig({ kit: id }).kit).toBe(id);
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
      { kit: 123 as unknown as SandboxKitId },
      { kit: null as unknown as SandboxKitId },
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
  it('turns ore deposits on, for every biome and kit (#1682)', () => {
    for (const biome of getAllBiomes()) {
      for (const kit of SANDBOX_KIT_ORDER) {
        expect(sandboxLevelDef(clampSandboxConfig({ biome: biome.id, kit })).oreDeposits).toBe(true);
      }
    }
  });

  it('carries the chosen biome, seed and starting cash onto the level', () => {
    const level = sandboxLevelDef(clampSandboxConfig({
      biome: 'alpine_granite', seed: 777, kit: 'full',
    }));
    expect(level.id).toBe(SANDBOX_LEVEL_ID);
    expect(level.biome).toBe('alpine_granite');
    expect(level.terrainSeed).toBe(777);
    expect(level.startingCash).toBe(SANDBOX_KITS.full.startingCash);
  });

  it('solves climateBias per seed so terrain lands in the chosen biome', () => {
    for (const biome of getAllBiomes()) {
      const level = sandboxLevelDef(clampSandboxConfig({ biome: biome.id }));
      const landed = resolveGeneratedBiome(level.terrainSeed, level.gridX, level.gridZ, level.climateBias);
      expect(landed.id).toBe(biome.id);
    }
  });

  it('fixes grid extents to the shared constants regardless of config', () => {
    for (const biome of getAllBiomes()) {
      for (const kit of SANDBOX_KIT_ORDER) {
        const level = sandboxLevelDef(clampSandboxConfig({ biome: biome.id, kit, seed: 999 }));
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
    const cfg = clampSandboxConfig({ biome: 'red_canyon', seed: 31337, kit: 'digger' });
    expect(sandboxLevelDef(cfg)).toEqual(sandboxLevelDef(cfg));
  });

  it('stays off the campaign world map, which lists difficultyTier > 0', () => {
    expect(sandboxLevelDef(SANDBOX_DEFAULTS).difficultyTier).toBe(0);
  });

  it('varies only startingCash and startingSite across kits, holding biome and seed fixed (#1671)', () => {
    const levels: Record<SandboxKitId, ReturnType<typeof sandboxLevelDef>> =
      Object.fromEntries(SANDBOX_KIT_ORDER.map(id => [
        id,
        sandboxLevelDef(clampSandboxConfig({ biome: 'tropical_karst', seed: 555, kit: id })),
      ])) as Record<SandboxKitId, ReturnType<typeof sandboxLevelDef>>;

    const [first, ...rest] = SANDBOX_KIT_ORDER;
    for (const key of LEVEL_FIELDS_SHARED_ACROSS_KITS) {
      for (const id of rest) {
        expect(levels[id][key]).toEqual(levels[first!][key]);
      }
    }

    expect(levels.digger.startingCash).toBe(SANDBOX_KITS.digger.startingCash);
    expect(levels.full.startingCash).toBe(SANDBOX_KITS.full.startingCash);

    // startingSite is the one other field allowed to differ (#1671); every other key is shared.
    expect(levels.full.startingSite).not.toEqual(levels.digger.startingSite);
    // Cash presets must actually differ, or the "varies only cash" claim is vacuous.
    expect(levels.full.startingCash).not.toBe(levels.digger.startingCash);
  });

  it('clamps a hostile config rather than passing it through', () => {
    const level = sandboxLevelDef({
      biome: 'not_a_biome', kit: 'legendary' as SandboxKitId, seed: -5,
    });
    expect(level.gridX).toBe(DEFAULT_GRID_SIZE);
    expect(level.datum).toBe(SANDBOX_DATUM);
    expect(level.startingCash).toBe(SANDBOX_KITS[SANDBOX_DEFAULTS.kit].startingCash);
  });
});

describe('SANDBOX_FIELDS', () => {
  it('describes exactly the three configurable fields (#504)', () => {
    const keys = SANDBOX_FIELDS.map(f => f.key);
    expect(keys).toEqual(['biome', 'kit', 'seed']);
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

  it('the kit field offers exactly the two named kits and labels itself "Starting kit"', () => {
    const field = SANDBOX_FIELDS.find(f => f.key === 'kit')!;
    expect(field.labelKey).toBe('sandbox.field.kit');
    const ids = (field.options?.() ?? []).map(o => o.id);
    expect(ids).toEqual(SANDBOX_KIT_ORDER);
  });
});

// #1668: the generated biome is the picked one on every seed, not just the ~75-97% whose
// raw climate happens to sit near the picked biome's climate centre.
describe('sandboxLevelDef — generated biome equals the picked biome (#1668)', () => {
  const SEEDS = [...Array.from({ length: 1000 }, (_, i) => i), 28, 29, 34, 39, 60, 72, 106];
  const biomeField = SANDBOX_FIELDS.find(f => f.key === 'biome')!;
  const pickable = (biomeField.kind === 'choice' ? biomeField.options?.() ?? [] : []).map(o => o.id);

  it('offers all six biomes', () => {
    expect(pickable).toHaveLength(6);
  });

  it.each(pickable)('%s: resolveGeneratedBiome lands on the picked biome for every seed', (picked) => {
    const misses: string[] = [];
    for (const seed of SEEDS) {
      const level = sandboxLevelDef(clampSandboxConfig({ biome: picked, kit: 'digger', seed }));
      const generated = resolveGeneratedBiome(seed, level.gridX, level.gridZ, level.climateBias);
      if (generated.id !== picked) misses.push(`${seed}->${generated.id}`);
    }
    expect(misses.slice(0, 10)).toEqual([]);
  });

  it('is deterministic across calls and across kits', () => {
    for (const seed of [29, 34, 106, 4242]) {
      const first = sandboxLevelDef(clampSandboxConfig({ biome: 'desert_badlands', kit: 'digger', seed }));
      const again = sandboxLevelDef(clampSandboxConfig({ biome: 'desert_badlands', kit: 'digger', seed }));
      expect(again.climateBias).toEqual(first.climateBias);
      for (const kit of SANDBOX_KIT_ORDER) {
        const other = sandboxLevelDef(clampSandboxConfig({ biome: 'desert_badlands', kit, seed }));
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

// #1671: every kit opens on a free starting kit able to drill, charge, fire and haul.
describe('sandbox starting site per kit (#1671, #1891)', () => {
  const siteOf = (id: SandboxKitId) =>
    sandboxLevelDef(clampSandboxConfig({ kit: id, biome: 'desert_badlands', seed: 42 })).startingSite;

  /** Every qualification category held by any employee in the kit. */
  const skillsOf = (id: SandboxKitId) =>
    new Set(siteOf(id)!.employees.flatMap(e => e.qualifications.map(q => q.category)));

  /** One key per slot, so a kit compares as a multiset. */
  const slotKeys = (id: SandboxKitId): string[] => {
    const site = siteOf(id)!;
    return [
      ...site.employees.map(e => `e:${e.role}:${e.qualifications.map(q => `${q.category}${q.proficiencyLevel}`).sort().join('+')}`),
      ...site.vehicles.map(v => `v:${v.role}:${v.tier}`),
      ...site.buildings.map(b => `b:${b.type}:${b.tier}`),
    ];
  };

  const isSubMultiset = (small: string[], big: string[]): boolean => {
    const pool = [...big];
    for (const k of small) {
      const i = pool.indexOf(k);
      if (i < 0) return false;
      pool.splice(i, 1);
    }
    return true;
  };

  it.each(SANDBOX_KIT_ORDER)('%s level defines a startingSite', (id) => {
    expect(siteOf(id)).toBeDefined();
    expect(SANDBOX_KITS[id].startingSite).toBe(siteOf(id));
  });

  it.each(SANDBOX_KIT_ORDER)('%s crew covers blasting, drill rig and truck driving, plus a hauler driver', (id) => {
    const skills = skillsOf(id);
    expect(skills.has('blasting')).toBe(true);
    expect(skills.has('driving.drill_rig')).toBe(true);
    expect(skills.has('driving.truck')).toBe(true);
    // The charging truck and the debris hauler both need a truck-licensed hand,
    // and the blaster is busy charging: at least two truck licences in the crew.
    const truckHolders = siteOf(id)!.employees.filter(e => e.qualifications.some(q => q.category === 'driving.truck'));
    expect(truckHolders.length).toBeGreaterThanOrEqual(2);
  });

  it.each(SANDBOX_KIT_ORDER)('%s fleet has a drill rig, debris hauler and charging truck', (id) => {
    const roles = siteOf(id)!.vehicles.map(v => v.role);
    expect(roles).toContain('drill_rig');
    expect(roles).toContain('debris_hauler');
    expect(roles).toContain('charging_truck');
  });

  it.each(SANDBOX_KIT_ORDER)('%s buildings include a freight warehouse and a spoil heap', (id) => {
    const types = siteOf(id)!.buildings.map(b => b.type);
    expect(types).toContain('freight_warehouse');
    expect(types).toContain('spoil_heap');
  });

  it('digger kit is a subset of the full kit, which adds exactly a rock fragmenter and its driver (#1891)', () => {
    expect(isSubMultiset(slotKeys('digger'), slotKeys('full'))).toBe(true);
    const extra = [...slotKeys('full')];
    for (const k of slotKeys('digger')) extra.splice(extra.indexOf(k), 1);
    expect(extra.sort()).toEqual([
      'e:driver:driving.rock_fragmenter1',
      'v:rock_fragmenter:1',
    ].sort());
  });

  it('keeps cash at 210k digger / 250k full alongside the kit', () => {
    expect(sandboxLevelDef(clampSandboxConfig({ kit: 'digger' })).startingCash).toBe(210_000);
    expect(sandboxLevelDef(clampSandboxConfig({ kit: 'full' })).startingCash).toBe(250_000);
  });

  it('SANDBOX_STARTING_SITES and SANDBOX_STARTING_CASH are keyed by kit (#1891)', () => {
    expect(Object.keys(SANDBOX_STARTING_SITES).sort()).toEqual(['digger', 'full']);
    expect(Object.keys(SANDBOX_STARTING_CASH).sort()).toEqual(['digger', 'full']);
    expect(SANDBOX_STARTING_CASH.digger).toBe(210_000);
    expect(SANDBOX_STARTING_CASH.full).toBe(250_000);
  });

  it('digger kit includes a rock digger and a driver holding driving.excavator (#1874)', () => {
    expect(siteOf('digger')!.vehicles.some(v => v.role === 'rock_digger' && v.tier === 1)).toBe(true);
    expect(skillsOf('digger').has('driving.excavator')).toBe(true);
    expect(skillsOf('digger').has('driving.rock_fragmenter')).toBe(false);
  });

  it('full kit adds a rock fragmenter and a driving.rock_fragmenter driver (#1891)', () => {
    expect(siteOf('full')!.vehicles.some(v => v.role === 'rock_fragmenter')).toBe(true);
    expect(skillsOf('full').has('driving.rock_fragmenter')).toBe(true);
    expect(skillsOf('full').has('driving.excavator')).toBe(true);
  });

  it('the digger kit no longer shares the Dusty Hollow site, and Dusty Hollow keeps its own start (#1874)', () => {
    expect(siteOf('digger')).not.toEqual(DUSTY_HOLLOW_STARTING_SITE);
    expect(DUSTY_HOLLOW_STARTING_SITE.vehicles.some(v => v.role === 'rock_digger')).toBe(false);
    expect(DUSTY_HOLLOW_STARTING_SITE.employees.some(e => e.qualifications.some(q => q.category === 'driving.excavator'))).toBe(false);
    const level = getLevel('dusty_hollow')!;
    expect(level.startingSite).toBe(DUSTY_HOLLOW_STARTING_SITE);
    expect(level.startingCash).toBe(50_000);
  });

  it('a hostile kit falls back to the default digger kit', () => {
    const level = sandboxLevelDef({ biome: 'not_a_biome', kit: 'legendary' as SandboxKitId, seed: -5 });
    expect(level.startingSite).toEqual(SANDBOX_KITS[SANDBOX_DEFAULTS.kit].startingSite);
    expect(level.startingSite!.vehicles.length).toBeGreaterThan(0);
  });
});

// ─── #1686: biome traits and kit details ─────────────────────────────

import {
  sandboxBiomeTraits,
  sandboxKitDetails,
} from '../../../src/core/campaign/Sandbox.js';
import { getRock, oresYieldedByRocks } from '../../../src/core/world/RockCatalog.js';
import { getOre } from '../../../src/core/world/OreCatalog.js';
import {
  SANDBOX_STARTING_SITES,
  SANDBOX_STARTING_CASH,
  SANDBOX_RUGGEDNESS_ROLLING_PV,
  SANDBOX_RUGGEDNESS_STEEP_PV,
} from '../../../src/core/config/balance.js';

describe('sandboxBiomeTraits (#1686)', () => {
  it('returns the biome descKey for every catalog biome', () => {
    for (const b of getAllBiomes()) {
      expect(sandboxBiomeTraits(b.id).descKey).toBe(b.descKey);
    }
  });

  it('hardness range is min/max of the dominant rocks hardness tiers, for every biome', () => {
    for (const b of getAllBiomes()) {
      const tiers = b.dominantRocks.map(id => getRock(id)?.hardnessTier).filter((x): x is number => x !== undefined);
      const traits = sandboxBiomeTraits(b.id);
      expect(traits.hardnessTierMin, b.id).toBe(Math.min(...tiers));
      expect(traits.hardnessTierMax, b.id).toBe(Math.max(...tiers));
      expect(traits.hardnessTierMin).toBeLessThanOrEqual(traits.hardnessTierMax);
    }
  });

  it('sanity: desert is soft (tier 1-2), volcanic and tropical are hard (tier 4-5)', () => {
    const desert = sandboxBiomeTraits('desert_badlands');
    expect(desert.hardnessTierMin).toBe(1);
    expect(desert.hardnessTierMax).toBe(2);
    for (const id of ['volcanic_flats', 'tropical_karst']) {
      const tr = sandboxBiomeTraits(id);
      expect(tr.hardnessTierMin, id).toBeGreaterThanOrEqual(4);
      expect(tr.hardnessTierMax, id).toBeLessThanOrEqual(5);
    }
  });

  it('ores are exactly those the dominant rocks yield, with the global ore depth windows', () => {
    for (const b of getAllBiomes()) {
      const expected = oresYieldedByRocks(b.dominantRocks);
      const ores = sandboxBiomeTraits(b.id).ores;
      expect(ores.map(o => o.oreId), b.id).toEqual(expected);
      for (const o of ores) {
        const def = getOre(o.oreId)!;
        expect(o.nameKey).toBe(def.nameKey);
        expect(o.depthMin).toBe(def.depthMin);
        expect(o.depthMax).toBe(def.depthMax);
      }
    }
  });

  it('aggregate ore depth spans the shallowest min to the deepest max', () => {
    for (const b of getAllBiomes()) {
      const traits = sandboxBiomeTraits(b.id);
      expect(traits.ores.length, b.id).toBeGreaterThan(0);
      expect(traits.oreDepthMin).toBe(Math.min(...traits.ores.map(o => o.depthMin)));
      expect(traits.oreDepthMax).toBe(Math.max(...traits.ores.map(o => o.depthMax)));
    }
  });

  it('pvAmplitude is copied from the biome and ruggedness follows the balance thresholds', () => {
    for (const b of getAllBiomes()) {
      const traits = sandboxBiomeTraits(b.id);
      expect(traits.pvAmplitude).toBe(b.pvAmplitude);
      const expected = b.pvAmplitude < SANDBOX_RUGGEDNESS_ROLLING_PV ? 'flat'
        : b.pvAmplitude < SANDBOX_RUGGEDNESS_STEEP_PV ? 'rolling' : 'steep';
      expect(traits.ruggedness, b.id).toBe(expected);
    }
  });

  it('ruggedness uses all three buckets across the catalog (flat < 20 <= rolling < 40 <= steep)', () => {
    expect(SANDBOX_RUGGEDNESS_ROLLING_PV).toBe(20);
    expect(SANDBOX_RUGGEDNESS_STEEP_PV).toBe(40);
    const kinds = new Set(getAllBiomes().map(b => sandboxBiomeTraits(b.id).ruggedness));
    expect(kinds).toEqual(new Set(['flat', 'rolling', 'steep']));
  });

  it('an unknown biome id resolves to the default biome traits', () => {
    expect(sandboxBiomeTraits('no_such_biome')).toEqual(sandboxBiomeTraits(SANDBOX_DEFAULTS.biome));
    expect(sandboxBiomeTraits('')).toEqual(sandboxBiomeTraits(SANDBOX_DEFAULTS.biome));
  });
});

describe('sandboxKitDetails (#1686)', () => {
  const count = <T>(items: readonly T[], keyOf: (x: T) => string): Map<string, number> => {
    const m = new Map<string, number>();
    for (const i of items) m.set(keyOf(i), (m.get(keyOf(i)) ?? 0) + 1);
    return m;
  };

  it('carries id, labelKey and the kit starting cash', () => {
    for (const id of SANDBOX_KIT_ORDER) {
      const d = sandboxKitDetails(id);
      expect(d.id).toBe(id);
      expect(d.labelKey).toBe(SANDBOX_KITS[id].labelKey);
      expect(d.startingCash).toBe(SANDBOX_KITS[id].startingCash);
    }
  });

  it('crew counts per role match the starting site employees', () => {
    for (const id of SANDBOX_KIT_ORDER) {
      const site = SANDBOX_STARTING_SITES[id];
      const expected = count(site.employees, e => e.role);
      const got = sandboxKitDetails(id).crew;
      expect(got.length, id).toBe(expected.size);
      for (const g of got) expect(g.count, `${id}/${g.role}`).toBe(expected.get(g.role));
    }
  });

  it('vehicle counts per role and tier match the starting site vehicles', () => {
    for (const id of SANDBOX_KIT_ORDER) {
      const expected = count(SANDBOX_STARTING_SITES[id].vehicles, v => `${v.role}|${v.tier}`);
      const got = sandboxKitDetails(id).vehicles;
      expect(got.length, id).toBe(expected.size);
      for (const g of got) expect(g.count).toBe(expected.get(`${g.role}|${g.tier}`));
    }
  });

  it('building counts per type and tier match the starting site buildings', () => {
    for (const id of SANDBOX_KIT_ORDER) {
      const expected = count(SANDBOX_STARTING_SITES[id].buildings, b => `${b.type}|${b.tier}`);
      const got = sandboxKitDetails(id).buildings;
      expect(got.length, id).toBe(expected.size);
      for (const g of got) expect(g.count).toBe(expected.get(`${g.type}|${g.tier}`));
    }
  });

  it('every grouped count is a positive integer and totals match the site', () => {
    for (const id of SANDBOX_KIT_ORDER) {
      const d = sandboxKitDetails(id);
      const site = SANDBOX_STARTING_SITES[id];
      expect(d.crew.reduce((s, c) => s + c.count, 0)).toBe(site.employees.length);
      expect(d.vehicles.reduce((s, c) => s + c.count, 0)).toBe(site.vehicles.length);
      expect(d.buildings.reduce((s, c) => s + c.count, 0)).toBe(site.buildings.length);
      for (const c of [...d.crew, ...d.vehicles, ...d.buildings]) {
        expect(Number.isInteger(c.count) && c.count > 0).toBe(true);
      }
    }
  });

  it('full opens with at least everything digger does', () => {
    const easy = sandboxKitDetails('full'); // the richer kit
    const normal = sandboxKitDetails('digger'); // the baseline kit
    const covers = <T extends { count: number }>(big: readonly T[], small: readonly T[], k: (x: T) => string) =>
      small.every(s => (big.find(b => k(b) === k(s))?.count ?? 0) >= s.count);
    expect(covers(easy.crew, normal.crew, c => (c as { role: string }).role)).toBe(true);
    expect(covers(easy.vehicles, normal.vehicles, c => { const v = c as { role: string; tier: number }; return `${v.role}|${v.tier}`; })).toBe(true);
    expect(covers(easy.buildings, normal.buildings, c => { const v = c as { type: string; tier: number }; return `${v.type}|${v.tier}`; })).toBe(true);
    expect(easy.startingCash).toBeGreaterThan(normal.startingCash);
  });
});

// ─── #1680: sandbox sites carry a stronger pit mask so flat ground exists ───
import {
  SANDBOX_PIT_MASK,
  DEFAULT_PIT_MASK,
  SANDBOX_FLAT_PAD_TARGET,
} from '../../../src/core/config/balance.js';
import { getAllLevels } from '../../../src/core/campaign/Level.js';
import { generateTerrain, buildTerrainContext } from '../../../src/core/world/TerrainGen.js';
import { computeVoxelColumnSurfaceY, CompositionPalette } from '../../../src/core/world/VoxelGrid.js';
import { sandboxTerrainConfig, flatPadShare } from '../../helpers/sandboxSite.js';
import { sampleSurfaceHeightY } from '../../../src/core/world/WorldGen.js';
import { sampleLandscapeColumn } from '../../../src/core/world/LandscapeMap.js';
import { type StructureSet } from '../../../src/core/world/Structures.js';

describe('sandbox pit mask (#1680)', () => {
  it('sandboxLevelDef carries SANDBOX_PIT_MASK', () => {
    expect(sandboxLevelDef(SANDBOX_DEFAULTS).pitMask).toEqual(SANDBOX_PIT_MASK);
  });

  it('SANDBOX_PIT_MASK is stronger than the default: shorter ramp, less relief kept', () => {
    expect(SANDBOX_PIT_MASK.margin).toBeLessThan(DEFAULT_PIT_MASK.margin);
    expect(SANDBOX_PIT_MASK.reliefKeep).toBeLessThan(DEFAULT_PIT_MASK.reliefKeep);
    expect(SANDBOX_PIT_MASK).toEqual({ margin: 14, reliefKeep: 0.05, envelopeSlope: 0.25, outlineWobble: 3, cornerRadius: 8 });
  });

  it('every campaign level leaves pitMask undefined (default mask)', () => {
    for (const level of getAllLevels()) expect(level.pitMask, level.id).toBeUndefined();
  });

  it('every level def leaves oreGradeScale unset or valid (#1932)', () => {
    for (const level of [...getAllLevels(), sandboxLevelDef(SANDBOX_DEFAULTS)]) {
      if (level.oreGradeScale !== undefined) expect(isValidOreGradeScale(level.oreGradeScale), level.id).toBe(true);
    }
  });

  it('the sandbox terrain config reaches the generator context', () => {
    const { worldGen } = buildTerrainContext(sandboxTerrainConfig('alpine_granite', 42));
    expect(worldGen.pitMask).toEqual(SANDBOX_PIT_MASK);
  });

  describe.each(getAllBiomes().map(b => b.id))('flat pads in %s', (biome) => {
    it.each([1, 7, 42])(`seed %i: at least ${SANDBOX_FLAT_PAD_TARGET * 100}% of pads are flat`, (seed) => {
      const grid = generateTerrain(sandboxTerrainConfig(biome, seed));
      expect(grid.sizeX).toBe(DEFAULT_GRID_SIZE);
      expect(flatPadShare(grid)).toBeGreaterThanOrEqual(SANDBOX_FLAT_PAD_TARGET);
    });
  });

  it('relief beyond the rim stays dramatic for alpine seed 42', () => {
    const masked = buildTerrainContext(sandboxTerrainConfig('alpine_granite', 42)).worldGen;
    const unmasked = buildTerrainContext({ ...sandboxTerrainConfig('alpine_granite', 42), pitMask: { margin: 1e-6, reliefKeep: 1 } }).worldGen;
    const relief = (ctx: typeof masked, inside: boolean): number => {
      let lo = Infinity, hi = -Infinity;
      for (let x = -200; x <= 264; x += 8) for (let z = -200; z <= 264; z += 8) {
        const within = x >= 0 && x <= 64 && z >= 0 && z <= 64;
        if (within !== inside) continue;
        const y = sampleSurfaceHeightY(ctx, x, z);
        lo = Math.min(lo, y); hi = Math.max(hi, y);
      }
      return hi - lo;
    };
    // The envelope cone (#1734) trims only the nearest foothills; the ridges stay.
    expect(relief(masked, false)).toBeGreaterThanOrEqual(relief(unmasked, false) * 0.9);
    // ...while inside the playable rect the mask flattens it.
    expect(relief(masked, true)).toBeLessThan(relief(unmasked, true));
  });

  it('landscape columns agree with the playable grid under the sandbox mask', () => {
    const config = sandboxTerrainConfig('alpine_granite', 42);
    const grid = generateTerrain(config);
    const { worldGen, strata } = buildTerrainContext(config);
    const empty: StructureSet = { overlays: [], spatialIndex: new Map(), rivers: [], villages: [], trees: [], landmarks: [] };
    const palette = new CompositionPalette();
    for (const [x, z] of [[0, 32], [5, 32], [10, 40], [32, 32]] as const) {
      const landscape = sampleLandscapeColumn(worldGen, config.climateBias, empty, strata, palette, x, z);
      expect(landscape.height, `(${x},${z})`).toBeCloseTo(sampleSurfaceHeightY(worldGen, x, z), 6);
      expect(Math.abs(landscape.height - computeVoxelColumnSurfaceY(grid, x, z)!), `grid (${x},${z})`).toBeLessThanOrEqual(1);
    }
  });
});


describe('sandbox market (#1681)', () => {
  it('every biome and kit runs on the production market', async () => {
    const { getAllBiomes } = await import('../../../src/core/world/BiomeCatalog.js');
    for (const biome of getAllBiomes()) {
      for (const kit of SANDBOX_KIT_ORDER) {
        const level = sandboxLevelDef(clampSandboxConfig({ biome: biome.id, kit }));
        expect(level.market, `${biome.id}/${kit}`).toBe('production');
      }
    }
  });

  it('campaign levels leave the market unset (legacy)', async () => {
    const { getAllLevels, resolveMarketId } = await import('../../../src/core/campaign/Level.js');
    const { createGame } = await import('../../../src/core/state/GameState.js');
    for (const level of getAllLevels()) expect(level.market, level.id).toBeUndefined();
    const state = createGame({ seed: 42 });
    expect(resolveMarketId(state)).toBe('legacy');
  });

  it('resolveMarketId reads the contract board market, defaulting to legacy', async () => {
    const { resolveMarketId } = await import('../../../src/core/campaign/Level.js');
    const { createGame } = await import('../../../src/core/state/GameState.js');
    const state = createGame({ seed: 42 });
    state.contracts.market = 'production';
    expect(resolveMarketId(state)).toBe('production');
    delete state.contracts.market;
    expect(resolveMarketId(state)).toBe('legacy');
  });
});
