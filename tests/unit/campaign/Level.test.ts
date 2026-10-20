import { describe, it, expect } from 'vitest';
import { getLevel, getAllLevels, resolveContractOres, type LevelDef, resolveContractPriceMultiplier, resolveAvailableExplosives, isExplosiveAvailable } from '../../../src/core/campaign/Level.js';
import { getAllExplosives } from '../../../src/core/world/ExplosiveCatalog.js';
import { createGame, createWorldState, type GameState } from '../../../src/core/state/GameState.js';
import { generateTerrain, resolveGeneratedBiome } from '../../../src/core/world/TerrainGen.js';
import { getAllBiomes, getBiome } from '../../../src/core/world/BiomeCatalog.js';
import { getRock, oresYieldedByRocks } from '../../../src/core/world/RockCatalog.js';
import { getAllOres } from '../../../src/core/world/OreCatalog.js';
import { sandboxLevelDef, SANDBOX_DEFAULTS, SANDBOX_LEVEL_ID } from '../../../src/core/campaign/Sandbox.js';
import {
  TUTORIAL_CONTRACT_PRICE_MULTIPLIER, DUSTY_HOLLOW_CONTRACT_PRICE_MULTIPLIER, DUSTY_HOLLOW_STARTING_SITE,
  SANDBOX_ORE_GRADE_SCALE, SHAREHOLDER_SUMMIT_STARTING_SITE, SHAREHOLDER_SUMMIT_STARTING_CASH,
  SHAREHOLDER_SUMMIT_PROFIT_TARGET, SHAREHOLDER_SUMMIT_BOARD,
} from '../../../src/core/config/balance.js';

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

  it('all 5 levels are defined with progressive difficulty', () => {
    const levels = getAllLevels();
    expect(levels).toHaveLength(5);
    expect(levels[4]!.id).toBe('shareholder_summit');

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
    expect(levels[4]!.difficultyTier).toBe(4);
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

  it('authored campaign levels keep legacy veins: oreDeposits is undefined, except the shareholder summit (#1682, #1949)', () => {
    for (const level of getAllLevels()) {
      if (level.id === 'shareholder_summit') {
        expect(level.oreDeposits, level.id).toBe(true);
        continue;
      }
      expect(level.oreDeposits, level.id).toBeUndefined();
    }
  });

  it('the sandbox level opts in to oreDeposits (#1682)', () => {
    expect(sandboxLevelDef(SANDBOX_DEFAULTS).oreDeposits).toBe(true);
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
    expect(level!.startingCash).toBe(500000);
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
    expect(getLevel('shareholder_summit')!.datum).toBeGreaterThan(0);
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
  function oresInGrid(level: LevelDef, seed: number = level.terrainSeed, climateBias: readonly [number, number] = level.climateBias): Set<string> {
    const grid = generateTerrain({
      sizeX: level.gridX, datum: level.datum, sizeZ: level.gridZ,
      seed, climateBias,
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

  it('mixed hardness never widens the ores relative to the same biome unmixed', () => {
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

  it('without a world, falls back to the declared biome rocks', () => {
    const state = createGame({ seed: 1, mineType: 'desert' });
    state.world = null;
    state.campaign.activeLevelId = null;
    expect([...resolveContractOres(state)]).toEqual(oresYieldedByRocks(getBiome('desert')!.dominantRocks));
  });

  describe('new_game path (state.seed differs from any level terrainSeed)', () => {
    for (const biome of getAllBiomes()) {
      it(`biome ${biome.id}: offered covers the grid and is yieldable by the generated biome`, () => {
        const level = sandboxLevelDef({ biome: biome.id, kit: 'digger', seed: 12345 });
        expect(level.terrainSeed).not.toBe(getLevel('tutorial_pit')!.terrainSeed);
        const state = stateFor(level, null);
        state.seed = 12345;
        const offered = new Set(resolveContractOres(state));
        for (const ore of oresInGrid(level, 12345, biome.climateCenter)) expect(offered.has(ore)).toBe(true);
        const generated = resolveGeneratedBiome(12345, level.gridX, level.gridZ, biome.climateCenter);
        const yieldable = new Set(oresYieldedByRocks(generated.dominantRocks));
        for (const ore of offered) expect(yieldable.has(ore)).toBe(true);
      });
    }
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
        const level = sandboxLevelDef({ biome: biome.id, kit: 'digger', seed: 7 });
        const state = stateFor(level, SANDBOX_LEVEL_ID);
        // sandbox start persists the per-seed bias on the world (regenerateGrid)
        state.world!.climateBias = [level.climateBias[0], level.climateBias[1]];
        const offered = new Set(resolveContractOres(state));
        const inGrid = oresInGrid(level);
        for (const ore of inGrid) expect(offered.has(ore)).toBe(true);
      });
    }
  });
});

describe('Dusty Hollow opens staffed and equipped (#1363)', () => {
  it('declares the dusty hollow starting site: crew, fleet, warehouse', () => {
    expect(getLevel('dusty_hollow')!.startingSite).toBe(DUSTY_HOLLOW_STARTING_SITE);
  });

  it('the starting site is a driller, a blaster, a driver, a drill rig, a debris hauler, a charging truck, a T1 freight warehouse and a T1 spoil heap', () => {
    expect(DUSTY_HOLLOW_STARTING_SITE.employees.map(e => e.role).sort()).toEqual(['blaster', 'driller', 'driver']);
    expect(DUSTY_HOLLOW_STARTING_SITE.vehicles.map(v => v.role).sort()).toEqual(['charging_truck', 'debris_hauler', 'drill_rig']);
    expect(DUSTY_HOLLOW_STARTING_SITE.buildings).toEqual([
      { type: 'freight_warehouse', tier: 1 },
      { type: 'spoil_heap', tier: 1 },
    ]);
  });

  it('every level declares a starting site; levels 2, 3 and the summit open with the digger kit (#1672, #1949); the tutorial opens with just a spoil heap (#1574)', () => {
    for (const level of getAllLevels()) {
      if (level.id === 'dusty_hollow') continue;
      if (level.id === 'shareholder_summit') {
        expect(level.startingSite, level.id).toBe(SHAREHOLDER_SUMMIT_STARTING_SITE);
        continue;
      }
      if (level.id === 'grumpstone_ridge' || level.id === 'treranium_depths') {
        expect(level.startingSite!.vehicles.map((v) => v.role).sort(), level.id)
          .toEqual(['charging_truck', 'debris_hauler', 'drill_rig', 'rock_digger']);
        expect(level.startingSite!.employees, level.id).toHaveLength(4);
        expect(level.startingSite!.buildings, level.id)
          .toEqual([{ type: 'freight_warehouse', tier: 1 }, { type: 'spoil_heap', tier: 1 }]);
        continue;
      }
      if (level.id === 'tutorial_pit') {
        expect(level.startingSite!.employees).toEqual([]);
        expect(level.startingSite!.vehicles).toEqual([]);
        expect(level.startingSite!.buildings).toEqual([{ type: 'spoil_heap', tier: 1 }]);
        continue;
      }
      expect(level.startingSite, level.id).toBeUndefined();
    }
  });

  it('keeps the $50k starting cash: staffing is free', () => {
    expect(getLevel('dusty_hollow')!.startingCash).toBe(50000);
  });

  it('dusty hollow uses DUSTY_HOLLOW_CONTRACT_PRICE_MULTIPLIER as its price multiplier', () => {
    expect(getLevel('dusty_hollow')!.contractPriceMultiplier).toBe(DUSTY_HOLLOW_CONTRACT_PRICE_MULTIPLIER);
  });

  // The multiplier is a tuning lever: it must be raised above the old 1.2
  // placeholder (the level could not be won at 1.2) yet stay far below the
  // tutorial's 52x, so Level 1 stays a real market. The upper bound of 12 (10 until
  // #1648's re-bisect, see the constant's doc comment) is a
  // deliberate sanity cap, not a target: a win bought with a runaway multiplier
  // proves nothing about the economy.
  it('DUSTY_HOLLOW_CONTRACT_PRICE_MULTIPLIER sits in the sensible mid-window (1.2, 12]', () => {
    expect(DUSTY_HOLLOW_CONTRACT_PRICE_MULTIPLIER).toBeGreaterThan(1.2);
    expect(DUSTY_HOLLOW_CONTRACT_PRICE_MULTIPLIER).toBeLessThanOrEqual(12);
    expect(DUSTY_HOLLOW_CONTRACT_PRICE_MULTIPLIER).toBeLessThan(TUTORIAL_CONTRACT_PRICE_MULTIPLIER);
  });

  it('later levels stay tighter markets than dusty hollow', () => {
    expect(getLevel('grumpstone_ridge')!.contractPriceMultiplier).toBeLessThan(DUSTY_HOLLOW_CONTRACT_PRICE_MULTIPLIER);
  });
});

describe('fixed weather per level (#1585)', () => {
  it('tutorial_pit pins sunny weather', () => {
    expect(getLevel('tutorial_pit')!.fixedWeather).toBe('sunny');
  });

  it('every other level keeps its weather cycle', () => {
    for (const level of getAllLevels()) {
      if (level.id === 'tutorial_pit') continue;
      expect(level.fixedWeather, level.id).toBeUndefined();
    }
  });
});

// ── Scripted tutorial content (#1600) ──

import { resolveHiringScript, resolveScriptedOreSale } from '../../../src/core/campaign/Level.js';
import { TUTORIAL_HIRING_SCRIPT, TUTORIAL_ORE_SALE_OFFER } from '../../../src/core/config/balance.js';

describe('scripted hiring and ore sale (#1600)', () => {
  it('only tutorial_pit defines hiringScript and scriptedOreSale', () => {
    for (const level of getAllLevels()) {
      if (level.id === 'tutorial_pit') {
        expect(level.hiringScript).toBe(TUTORIAL_HIRING_SCRIPT);
        expect(level.scriptedOreSale).toBe(TUTORIAL_ORE_SALE_OFFER);
      } else {
        expect(level.hiringScript, level.id).toBeUndefined();
        expect(level.scriptedOreSale, level.id).toBeUndefined();
      }
    }
  });

  it('the sandbox level has neither', () => {
    const def = sandboxLevelDef(SANDBOX_DEFAULTS);
    expect(def.hiringScript).toBeUndefined();
    expect(def.scriptedOreSale).toBeUndefined();
  });

  it('resolvers return the tutorial data while tutorial_pit is active', () => {
    const s = createGame({ seed: 1, mineType: 'desert' });
    s.campaign.activeLevelId = 'tutorial_pit';
    expect(resolveHiringScript(s)).toBe(TUTORIAL_HIRING_SCRIPT);
    expect(resolveScriptedOreSale(s)).toBe(TUTORIAL_ORE_SALE_OFFER);
  });

  it('resolvers return undefined for other levels, the sandbox and no level', () => {
    for (const id of ['dusty_hollow', SANDBOX_LEVEL_ID, null] as const) {
      const s = createGame({ seed: 1, mineType: 'desert' });
      s.campaign.activeLevelId = id;
      expect(resolveHiringScript(s), String(id)).toBeUndefined();
      expect(resolveScriptedOreSale(s), String(id)).toBeUndefined();
    }
  });

  it('the tutorial script has one candidate per hiring role with unique ids', () => {
    expect(TUTORIAL_HIRING_SCRIPT.map(c => c.role).sort()).toEqual(['blaster', 'driller', 'driver', 'manager', 'surveyor']);
    expect(new Set(TUTORIAL_HIRING_SCRIPT.map(c => c.id)).size).toBe(TUTORIAL_HIRING_SCRIPT.length);
  });
});

describe('Shareholder Summit level (#1949)', () => {
  const level = () => getLevel('shareholder_summit')!;

  it('is the last level and the only tier-4 level', () => {
    const all = getAllLevels();
    expect(all[all.length - 1]!.id).toBe('shareholder_summit');
    expect(all.filter(l => l.difficultyTier === 4).map(l => l.id)).toEqual(['shareholder_summit']);
    expect(level().difficultyTier).toBe(4);
  });

  it('carries its i18n keys and the volcanic_flats biome', () => {
    expect(level().id).toBe('shareholder_summit');
    expect(level().nameKey).toBe('level.shareholder_summit.name');
    expect(level().descKey).toBe('level.shareholder_summit.desc');
    expect(level().biome).toBe('volcanic_flats');
    expect(getBiome(level().biome)).toBeDefined();
  });

  it('opts in to progression, the production market and ore deposits', () => {
    expect(level().progression).toBe(true);
    expect(level().market).toBe('production');
    expect(level().oreDeposits).toBe(true);
    expect(level().oreGradeScale).toBe(SANDBOX_ORE_GRADE_SCALE);
  });

  it('wires its balance constants into the definition', () => {
    expect(level().startingCash).toBe(SHAREHOLDER_SUMMIT_STARTING_CASH);
    expect(level().unlockThreshold).toBe(SHAREHOLDER_SUMMIT_PROFIT_TARGET);
    expect(level().board).toEqual(SHAREHOLDER_SUMMIT_BOARD);
  });

  it('balance constants are tuned: positive cash, profit target and board targets', () => {
    expect(SHAREHOLDER_SUMMIT_STARTING_CASH).toBeGreaterThan(0);
    expect(SHAREHOLDER_SUMMIT_PROFIT_TARGET).toBeGreaterThan(0);
    expect(SHAREHOLDER_SUMMIT_BOARD.quarterTicks).toBeGreaterThan(0);
    expect(SHAREHOLDER_SUMMIT_BOARD.oreTargetT).toBeGreaterThan(0);
    expect(SHAREHOLDER_SUMMIT_BOARD.profitTarget).toBeGreaterThan(0);
    expect(SHAREHOLDER_SUMMIT_BOARD.growth ?? 1).toBeGreaterThan(0);
  });

  it('opens with the digger composition plus a tier-1 freight warehouse and no extra buildings', () => {
    const site = level().startingSite!;
    expect(site).toBe(SHAREHOLDER_SUMMIT_STARTING_SITE);
    expect(site.vehicles.map(v => v.role).sort()).toEqual(['charging_truck', 'debris_hauler', 'drill_rig', 'rock_digger']);
    expect(site.employees).toHaveLength(4);
    expect(site.buildings).toContainEqual({ type: 'freight_warehouse', tier: 1 });
  });

  it('has cash, a profit target and at least treranium_depths\' explosive roster', () => {
    expect(level().unlockThreshold).toBeGreaterThan(0);
    expect(level().startingCash).toBeGreaterThan(0);
    expect(level().availableExplosives.length).toBeGreaterThanOrEqual(getLevel('treranium_depths')!.availableExplosives.length);
  });

  it('sets a positive grid, datum and seed distinct from the earlier levels', () => {
    expect(level().gridX).toBeGreaterThan(0);
    expect(level().gridZ).toBeGreaterThan(0);
    expect(level().datum).toBeGreaterThan(0);
    const others = getAllLevels().filter(l => l.id !== 'shareholder_summit').map(l => l.terrainSeed);
    expect(others).not.toContain(level().terrainSeed);
  });

  it('terrain generated for the level resolves to volcanic_flats', () => {
    const l = level();
    expect(resolveGeneratedBiome(l.terrainSeed, l.gridX, l.gridZ, l.climateBias).id).toBe('volcanic_flats');
  });

  it('contract ores cover the ores generated into the grid (drift lock)', () => {
    const l = level();
    const state = createGame({ seed: l.terrainSeed, mineType: l.biome });
    state.world = createWorldState(l.gridX, l.datum, l.gridZ, false);
    state.world.mixedRockHardness = l.mixedRockHardness;
    state.campaign.activeLevelId = l.id;
    const offered = new Set(resolveContractOres(state));
    expect(offered.size).toBeGreaterThan(0);
    const generated = resolveGeneratedBiome(l.terrainSeed, l.gridX, l.gridZ, l.climateBias);
    const yieldable = new Set(oresYieldedByRocks(generated.dominantRocks));
    for (const ore of offered) expect(yieldable.has(ore)).toBe(true);
  });

  it('is not a pinned-weather, scripted level', () => {
    expect(level().fixedWeather).toBeUndefined();
    expect(level().hiringScript).toBeUndefined();
    expect(level().scriptedOreSale).toBeUndefined();
  });

  it('only the summit sets progression, market or a board among the authored levels', () => {
    for (const l of getAllLevels()) {
      if (l.id === 'shareholder_summit') continue;
      expect(l.progression, l.id).toBeUndefined();
      expect(l.market, l.id).toBeUndefined();
      expect(l.board, l.id).toBeUndefined();
    }
  });
});
