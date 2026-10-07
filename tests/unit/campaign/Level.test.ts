import { describe, it, expect } from 'vitest';
import { getLevel, getAllLevels, resolveContractOres, type LevelDef, resolveContractPriceMultiplier, resolveAvailableExplosives, isExplosiveAvailable } from '../../../src/core/campaign/Level.js';
import { getAllExplosives } from '../../../src/core/world/ExplosiveCatalog.js';
import { createGame, createWorldState, type GameState } from '../../../src/core/state/GameState.js';
import { generateTerrain } from '../../../src/core/world/TerrainGen.js';
import { getAllBiomes, getBiome } from '../../../src/core/world/BiomeCatalog.js';
import { getRock, oresYieldedByRocks } from '../../../src/core/world/RockCatalog.js';
import { getAllOres } from '../../../src/core/world/OreCatalog.js';
import { sandboxLevelDef, SANDBOX_LEVEL_ID } from '../../../src/core/campaign/Sandbox.js';
import { TUTORIAL_CONTRACT_PRICE_MULTIPLIER } from '../../../src/core/config/balance.js';

describe('Level definition system (7.1)', () => {
  it('getLevel("dusty_hollow") returns valid level data with all required fields', () => {
    const level = getLevel('dusty_hollow');
    expect(level).toBeDefined();
    expect(level!.id).toBe('dusty_hollow');
    expect(level!.nameKey).toBe('level.dusty_hollow.name');
    expect(level!.descKey).toBe('level.dusty_hollow.desc');
    expect(level!.biome).toBe('desert_badlands');
    expect(level!.terrainSeed).toBeGreaterThan(0);
    expect(level!.gridX).toBeGreaterThan(0);
    expect(level!.datum).toBeGreaterThan(0);
    expect(level!.gridZ).toBeGreaterThan(0);
    expect(level!.startingCash).toBeGreaterThan(0);
    expect(level!.availableExplosives.length).toBeGreaterThan(0);
    expect(level!.unlockThreshold).toBeGreaterThan(0);
    expect(typeof level!.eventFreqMultiplier).toBe('number');
    expect(typeof level!.contractPriceMultiplier).toBe('number');
    expect(typeof level!.scoreDecayRate).toBe('number');
    expect(typeof level!.mixedRockHardness).toBe('boolean');
    expect(level!.difficultyTier).toBe(1);
  });

  it('all 4 levels are defined with progressive difficulty', () => {
    const levels = getAllLevels();
    expect(levels).toHaveLength(4);

    // Event frequency should increase or stay same across tiers
    expect(levels[0]!.eventFreqMultiplier).toBe(0);
    expect(levels[1]!.eventFreqMultiplier).toBeGreaterThanOrEqual(levels[0]!.eventFreqMultiplier);
    expect(levels[2]!.eventFreqMultiplier).toBeGreaterThan(levels[1]!.eventFreqMultiplier);
    expect(levels[3]!.eventFreqMultiplier).toBeGreaterThan(levels[2]!.eventFreqMultiplier);

    // Score decay should increase across tiers
    expect(levels[1]!.scoreDecayRate).toBeGreaterThan(levels[0]!.scoreDecayRate);
    expect(levels[2]!.scoreDecayRate).toBeGreaterThan(levels[1]!.scoreDecayRate);
    expect(levels[3]!.scoreDecayRate).toBeGreaterThan(levels[2]!.scoreDecayRate);

    // Difficulty tier
    expect(levels[0]!.difficultyTier).toBe(0);
    expect(levels[1]!.difficultyTier).toBe(1);
    expect(levels[2]!.difficultyTier).toBe(2);
    expect(levels[3]!.difficultyTier).toBe(3);
  });

  it('level unlock thresholds increase with difficulty', () => {
    const levels = getAllLevels();
    expect(levels[0]!.unlockThreshold).toBeLessThan(levels[1]!.unlockThreshold);
    expect(levels[1]!.unlockThreshold).toBeLessThan(levels[2]!.unlockThreshold);
    expect(levels[2]!.unlockThreshold).toBeLessThan(levels[3]!.unlockThreshold);
  });

  it('treranium_depths includes all explosive types, dusty_hollow only starter explosives', () => {
    const dustyHollow = getLevel('dusty_hollow')!;
    const treraniumDepths = getLevel('treranium_depths')!;

    // Dusty Hollow should only have starter explosives
    expect(dustyHollow.availableExplosives).not.toContain('dynatomics');
    expect(dustyHollow.availableExplosives).not.toContain('obliviax');

    // Treranium Depths should have all explosives including endgame
    expect(treraniumDepths.availableExplosives).toContain('pop_rock');
    expect(treraniumDepths.availableExplosives).toContain('dynatomics');
    expect(treraniumDepths.availableExplosives.length).toBeGreaterThan(dustyHollow.availableExplosives.length);
  });

  it('level 3 has mixed rock hardness enabled', () => {
    const level3 = getLevel('treranium_depths')!;
    expect(level3.mixedRockHardness).toBe(true);
  });

  it('level 1 has mixed rock hardness disabled', () => {
    const level1 = getLevel('dusty_hollow')!;
    expect(level1.mixedRockHardness).toBe(false);
  });

  it('getLevel returns undefined for unknown id', () => {
    expect(getLevel('nonexistent_mine')).toBeUndefined();
  });

  it('getLevel("tutorial_pit") returns valid level data with all required fields', () => {
    const level = getLevel('tutorial_pit');
    expect(level).toBeDefined();
    expect(level!.id).toBe('tutorial_pit');
    expect(level!.nameKey).toBe('level.tutorial_pit.name');
    expect(level!.descKey).toBe('level.tutorial_pit.desc');
    expect(level!.biome).toBe('desert_badlands');
    expect(level!.terrainSeed).toBe(42);
    expect(level!.gridX).toBe(32);
    expect(level!.datum).toBe(11);
    expect(level!.gridZ).toBe(32);
    expect(level!.startingCash).toBe(340000);
    expect(level!.availableExplosives).toContain('pop_rock');
    expect(level!.availableExplosives).toContain('boomite');
    expect(level!.unlockThreshold).toBe(5000);
    expect(level!.eventFreqMultiplier).toBe(0);
    expect(level!.contractPriceMultiplier).toBe(TUTORIAL_CONTRACT_PRICE_MULTIPLIER);
    expect(level!.scoreDecayRate).toBe(0.01);
    expect(level!.mixedRockHardness).toBe(false);
    expect(level!.difficultyTier).toBe(0);
  });

  it('getAllLevels()[0] is tutorial_pit', () => {
    const all = getAllLevels();
    expect(all[0]!.id).toBe('tutorial_pit');
    expect(all[0]!.difficultyTier).toBe(0);
  });

  it('tutorial_pit has zero event frequency multiplier', () => {
    expect(getLevel('tutorial_pit')!.eventFreqMultiplier).toBe(0);
  });

  it('no LevelDef carries a revoltImmune field (#681)', () => {
    const levels = getAllLevels();
    expect(levels.length).toBeGreaterThan(0);
    for (const level of levels) {
      expect('revoltImmune' in level).toBe(false);
    }
  });

  describe('resolveContractPriceMultiplier (#1086)', () => {
    it('returns 1 when no level is active', () => {
      const state = createGame({ seed: 1 });
      expect(state.campaign.activeLevelId).toBeNull();
      expect(resolveContractPriceMultiplier(state)).toBe(1);
    });

    it("returns the active level's own contractPriceMultiplier when one is active", () => {
      const state = createGame({ seed: 1 });
      state.campaign.activeLevelId = 'dusty_hollow';
      expect(resolveContractPriceMultiplier(state)).toBe(getLevel('dusty_hollow')!.contractPriceMultiplier);
    });

    it('falls back to 1 when the active id no longer resolves to a known level', () => {
      const state = createGame({ seed: 1 });
      state.campaign.activeLevelId = 'nonexistent_mine';
      expect(resolveContractPriceMultiplier(state)).toBe(1);
    });
  });

  it('every level carries its documented datum (#1191)', () => {
    expect(getLevel('tutorial_pit')!.datum).toBe(11);
    expect(getLevel('dusty_hollow')!.datum).toBe(22);
    expect(getLevel('grumpstone_ridge')!.datum).toBe(30);
    expect(getLevel('treranium_depths')!.datum).toBe(35);
  });

  it('tutorial_pit only has basic explosives', () => {
    const level = getLevel('tutorial_pit')!;
    expect(level.availableExplosives).toContain('pop_rock');
    expect(level.availableExplosives).toContain('boomite');
    expect(level.availableExplosives).not.toContain('krackle');
    expect(level.availableExplosives).not.toContain('big_bada_boom');
    expect(level.availableExplosives).not.toContain('shatternite');
    expect(level.availableExplosives).not.toContain('rumblox');
    expect(level.availableExplosives).not.toContain('obliviax');
    expect(level.availableExplosives).not.toContain('dynatomics');
  });
});

describe('level explosive availability (#1357)', () => {
  const fullCatalog = getAllExplosives().map(e => e.id);

  it('null level id resolves to the full catalog', () => {
    expect([...resolveAvailableExplosives(null)]).toEqual(fullCatalog);
  });

  it('dusty_hollow resolves to exactly its three explosives', () => {
    expect([...resolveAvailableExplosives('dusty_hollow')]).toEqual(['pop_rock', 'boomite', 'krackle']);
  });

  it('tutorial_pit resolves to its own list, a strict subset of the catalog', () => {
    const ids = [...resolveAvailableExplosives('tutorial_pit')];
    expect(ids).toEqual(getLevel('tutorial_pit')!.availableExplosives);
    expect(ids.length).toBeLessThan(fullCatalog.length);
    expect(ids).not.toContain('dynatomics');
  });

  it('unknown level id (sandbox) resolves to the full catalog', () => {
    expect([...resolveAvailableExplosives('nonexistent_mine')]).toEqual(fullCatalog);
  });

  it('isExplosiveAvailable rejects a catalog explosive outside the level list', () => {
    expect(isExplosiveAvailable('dusty_hollow', 'dynatomics')).toBe(false);
    expect(isExplosiveAvailable('tutorial_pit', 'krackle')).toBe(false);
  });

  it('isExplosiveAvailable accepts every explosive in the level list', () => {
    for (const id of getLevel('dusty_hollow')!.availableExplosives) {
      expect(isExplosiveAvailable('dusty_hollow', id)).toBe(true);
    }
  });

  it('isExplosiveAvailable allows everything for null and unknown level ids', () => {
    expect(isExplosiveAvailable(null, 'dynatomics')).toBe(true);
    expect(isExplosiveAvailable('nonexistent_mine', 'dynatomics')).toBe(true);
  });
});

describe('tutorial_pit contract price multiplier (#1328)', () => {
  it('Level.ts uses the balance.ts constant rather than a duplicate literal', () => {
    expect(getLevel('tutorial_pit')!.contractPriceMultiplier).toBe(TUTORIAL_CONTRACT_PRICE_MULTIPLIER);
  });
});


describe('resolveContractOres (#1364)', () => {
  const ALL_ORE_IDS = getAllOres().map(o => o.id);

  function stateFor(level: LevelDef, activeLevelId: string | null): GameState {
    const state = createGame({ seed: level.terrainSeed, mineType: level.biome });
    state.world = createWorldState(level.gridX, level.datum, level.gridZ, false);
    state.world.mixedRockHardness = level.mixedRockHardness;
    state.campaign.activeLevelId = activeLevelId;
    return state;
  }

  /** Ore ids actually present (density > 0 voxel with ore density > 0) in a strided sample of the level's grid. */
  function oresInGrid(level: LevelDef): Set<string> {
    const grid = generateTerrain({
      sizeX: level.gridX, datum: level.datum, sizeZ: level.gridZ,
      seed: level.terrainSeed, climateBias: level.climateBias,
      mixedRockHardness: level.mixedRockHardness,
    });
    const found = new Set<string>();
    for (let x = grid.minX; x < grid.maxX; x += 3) {
      for (let z = grid.minZ; z < grid.maxZ; z += 3) {
        for (let y = level.datum - 40; y <= level.datum + 5; y += 2) {
          const v = grid.getVoxel(x, y, z);
          if (!v || v.density <= 0) continue;
          for (const [ore, d] of Object.entries(v.oreDensities)) if (d > 0) found.add(ore);
        }
      }
    }
    return found;
  }

  it('tutorial_pit offers only dirtite, rustite, blingite', () => {
    const level = getLevel('tutorial_pit')!;
    expect([...resolveContractOres(stateFor(level, level.id))].sort()).toEqual(['blingite', 'dirtite', 'rustite']);
  });

  it('dusty_hollow offers only dirtite, rustite, blingite', () => {
    const level = getLevel('dusty_hollow')!;
    expect([...resolveContractOres(stateFor(level, level.id))].sort()).toEqual(['blingite', 'dirtite', 'rustite']);
  });

  it('never includes sparkium or deeper ores on the desert levels', () => {
    for (const id of ['tutorial_pit', 'dusty_hollow']) {
      const level = getLevel(id)!;
      const ores = resolveContractOres(stateFor(level, id));
      for (const deep of ['gloomium', 'sparkium', 'craktonite', 'absurdium', 'treranium']) {
        expect(ores).not.toContain(deep);
      }
    }
  });

  it('returns only known ore ids, no duplicates, in ore catalog order', () => {
    for (const level of getAllLevels()) {
      const ores = resolveContractOres(stateFor(level, level.id));
      expect(ores.length).toBeGreaterThan(0);
      expect(new Set(ores).size).toBe(ores.length);
      expect(ores.every(o => ALL_ORE_IDS.includes(o))).toBe(true);
      expect([...ores]).toEqual(ALL_ORE_IDS.filter(o => ores.includes(o)));
    }
  });

  it('level 3 (mixed hardness) uses only its softest and hardest dominant rock', () => {
    const level = getLevel('treranium_depths')!;
    expect(level.mixedRockHardness).toBe(true);
    const rocks = getBiome(level.biome)!.dominantRocks
      .map(id => getRock(id)!)
      .sort((a, b) => a.hardnessTier - b.hardnessTier);
    const expected = oresYieldedByRocks([rocks[0]!.id, rocks[rocks.length - 1]!.id]);
    expect([...resolveContractOres(stateFor(level, level.id))]).toEqual(expected);
  });

  it('mixed hardness narrows the ores relative to the same biome unmixed', () => {
    const level = getLevel('treranium_depths')!;
    const unmixed = stateFor({ ...level, mixedRockHardness: false }, level.id);
    const mixed = stateFor(level, level.id);
    const all = getBiome(level.biome)!.dominantRocks;
    expect([...resolveContractOres(unmixed)]).toEqual(oresYieldedByRocks(all));
    expect(resolveContractOres(mixed).length).toBeLessThanOrEqual(resolveContractOres(unmixed).length);
  });

  it('unknown biome falls back to every priced ore', () => {
    const state = createGame({ seed: 1, mineType: 'no_such_biome' });
    state.campaign.activeLevelId = null;
    expect([...resolveContractOres(state)]).toEqual(ALL_ORE_IDS);
  });

  describe('drift lock: result is a superset of ores generated into the grid', () => {
    for (const level of getAllLevels()) {
      it(`campaign level ${level.id}`, () => {
        const offered = new Set(resolveContractOres(stateFor(level, level.id)));
        const inGrid = oresInGrid(level);
        expect(inGrid.size).toBeGreaterThan(0);
        for (const ore of inGrid) expect(offered.has(ore)).toBe(true);
      });
    }

    for (const biome of getAllBiomes()) {
      it(`sandbox biome ${biome.id}`, () => {
        const level = sandboxLevelDef({ biome: biome.id, difficulty: 'normal', seed: 7 });
        const offered = new Set(resolveContractOres(stateFor(level, SANDBOX_LEVEL_ID)));
        const inGrid = oresInGrid(level);
        for (const ore of inGrid) expect(offered.has(ore)).toBe(true);
      });
    }
  });
});
