// BlastSimulator2026 — explosive, vehicle and building tier gates read only the completed quests, never the level (#2292)

import { describe, it, expect } from 'vitest';
import { applyLevelPreset, resolveExplosivesFor, isExplosiveAvailableFor, getAllLevels, type LevelPreset } from '../../../src/core/campaign/Level.js';
import { createCampaignState } from '../../../src/core/campaign/Campaign.js';
import { createGameForLevel } from '../../../src/core/campaign/LevelTransition.js';
import { vehicleTierGate, vehicleLock } from '../../../src/core/economy/VehicleTierGate.js';
import { isBuildingTierUnlocked } from '../../../src/core/economy/Quests.js';
import { getAllExplosives } from '../../../src/core/world/ExplosiveCatalog.js';
import { getAllBuildingTypes, isSingleTierType } from '../../../src/core/entities/Building.js';
import { createGame, type GameState } from '../../../src/core/state/GameState.js';

const X2 = 'quest_explosive_t2';
const X3 = 'quest_explosive_t3';
const V2 = 'quest_vehicle_t2';
const V3 = 'quest_vehicle_t3';
const B2 = 'quest_building_t2';
const B3 = 'quest_building_t3';
const RACE = 'quest_race_car';

const MULTI_TIER = () => getAllBuildingTypes().filter(type => !isSingleTierType(type));

function siteWith(completedQuests: string[], levelId: string | null = null): GameState {
  const s = createGame({ seed: 42, mineType: 'desert' });
  const preset: LevelPreset = { grade: 0, tier: 1, completedQuests };
  applyLevelPreset(s, preset);
  s.campaign.activeLevelId = levelId;
  return s;
}

const explosiveIdsOfTier = (tier: number): string[] => getAllExplosives().filter(e => e.tier === tier).map(e => e.id);

function unlockedCampaign() {
  const campaign = createCampaignState();
  for (const entry of Object.values(campaign.levels)) entry.unlocked = true;
  return campaign;
}

describe('explosive gate depends only on completed quests (#2292)', () => {
  it('a site with no completed quest buys exactly the tier 1 explosives', () => {
    expect(resolveExplosivesFor(siteWith([]))).toEqual(explosiveIdsOfTier(1));
  });

  it('completing the tier 2 quest adds the tier 2 explosives', () => {
    const ids = resolveExplosivesFor(siteWith([X2]));
    for (const id of explosiveIdsOfTier(1)) expect(ids).toContain(id);
    for (const id of explosiveIdsOfTier(2)) expect(ids).toContain(id);
    for (const id of explosiveIdsOfTier(3)) expect(ids).not.toContain(id);
  });

  it('completing both explosive quests opens the whole catalog', () => {
    expect(resolveExplosivesFor(siteWith([X2, X3]))).toEqual(getAllExplosives().map(e => e.id));
  });

  it('vehicle and building quests open no explosive', () => {
    expect(resolveExplosivesFor(siteWith([V2, V3, B2, B3, RACE]))).toEqual(explosiveIdsOfTier(1));
  });

  it('isExplosiveAvailableFor refuses a tier 2 explosive until its quest is done', () => {
    const [t2] = explosiveIdsOfTier(2);
    expect(isExplosiveAvailableFor(siteWith([]), t2!)).toBe(false);
    expect(isExplosiveAvailableFor(siteWith([X2]), t2!)).toBe(true);
  });

  it('the active level id does not change what a tutorial-id site with all quests may buy', () => {
    expect(resolveExplosivesFor(siteWith([X2, X3], 'tutorial_pit'))).toEqual(getAllExplosives().map(e => e.id));
  });

  it('the active level id does not unlock anything on a late-level-id site with no quests', () => {
    expect(resolveExplosivesFor(siteWith([], 'treranium_depths'))).toEqual(explosiveIdsOfTier(1));
    expect(resolveExplosivesFor(siteWith([], 'shareholder_summit'))).toEqual(explosiveIdsOfTier(1));
  });

  it('an unknown active level id changes nothing', () => {
    expect(resolveExplosivesFor(siteWith([X2], 'no_such_level'))).toEqual(resolveExplosivesFor(siteWith([X2])));
  });

  it('every level answers with the explosives its own completed quests open', () => {
    for (const level of getAllLevels()) {
      const s = createGameForLevel(unlockedCampaign(), level.id)!;
      const completed = s.quests!.completed;
      const expected = getAllExplosives()
        .filter(e => e.tier === 1 || (e.tier === 2 && completed.includes(X2)) || (e.tier === 3 && completed.includes(X3)))
        .map(e => e.id);
      expect(resolveExplosivesFor(s), level.id).toEqual(expected);
    }
  });
});

describe('vehicle gate depends only on completed quests (#2292)', () => {
  it('tier 1 is open on a site with no quest', () => {
    expect(vehicleTierGate(siteWith([]), 1)).toBeNull();
  });

  it('tiers 2 and 3 are locked until their quests are done', () => {
    const s = siteWith([]);
    expect(vehicleTierGate(s, 2)?.id).toBe(V2);
    expect(vehicleTierGate(s, 3)?.id).toBe(V3);
  });

  it('completing the tier 2 quest opens tier 2 and leaves tier 3 locked', () => {
    const s = siteWith([V2]);
    expect(vehicleTierGate(s, 2)).toBeNull();
    expect(vehicleTierGate(s, 3)?.id).toBe(V3);
  });

  it('both vehicle quests open both tiers', () => {
    const s = siteWith([V2, V3]);
    expect(vehicleTierGate(s, 2)).toBeNull();
    expect(vehicleTierGate(s, 3)).toBeNull();
  });

  it('the race car follows its own quest', () => {
    expect(vehicleLock(siteWith([]), 'travel_vehicle', 2)).not.toBeNull();
    expect(vehicleLock(siteWith([RACE]), 'travel_vehicle', 2)).toBeNull();
  });

  it('an explosive quest opens no vehicle tier', () => {
    const s = siteWith([X2, X3]);
    expect(vehicleTierGate(s, 2)?.id).toBe(V2);
    expect(vehicleTierGate(s, 3)?.id).toBe(V3);
  });

  it('the active level id does not unlock a vehicle tier', () => {
    expect(vehicleTierGate(siteWith([], 'treranium_depths'), 3)?.id).toBe(V3);
  });

  it('the active level id does not lock a completed vehicle tier', () => {
    expect(vehicleTierGate(siteWith([V2, V3], 'tutorial_pit'), 3)).toBeNull();
  });
});

describe('building tier gate depends only on completed quests (#2292)', () => {
  it('tier 1 is always open', () => {
    for (const type of MULTI_TIER()) expect(isBuildingTierUnlocked(siteWith([]), type, 1), type).toBe(true);
  });

  it('tiers 2 and 3 are locked on a site with no quest', () => {
    for (const type of MULTI_TIER()) {
      expect(isBuildingTierUnlocked(siteWith([]), type, 2), type).toBe(false);
      expect(isBuildingTierUnlocked(siteWith([]), type, 3), type).toBe(false);
    }
  });

  it('the tier 2 quest opens tier 2 and leaves tier 3 locked', () => {
    const s = siteWith([B2]);
    for (const type of MULTI_TIER()) {
      expect(isBuildingTierUnlocked(s, type, 2), type).toBe(true);
      expect(isBuildingTierUnlocked(s, type, 3), type).toBe(false);
    }
  });

  it('both building quests open both tiers', () => {
    const s = siteWith([B2, B3]);
    for (const type of MULTI_TIER()) {
      expect(isBuildingTierUnlocked(s, type, 2), type).toBe(true);
      expect(isBuildingTierUnlocked(s, type, 3), type).toBe(true);
    }
  });

  it('a vehicle or explosive quest opens no building tier', () => {
    const s = siteWith([V2, V3, X2, X3, RACE]);
    for (const type of MULTI_TIER()) expect(isBuildingTierUnlocked(s, type, 2), type).toBe(false);
  });

  it('the active level id does not change a building tier gate', () => {
    for (const type of MULTI_TIER()) {
      expect(isBuildingTierUnlocked(siteWith([], 'dusty_hollow'), type, 2), type).toBe(false);
      expect(isBuildingTierUnlocked(siteWith([B2, B3], 'tutorial_pit'), type, 3), type).toBe(true);
    }
  });
});

describe('level start states gate tiers by their preset quests (#2292)', () => {
  const start = (id: string) => createGameForLevel(unlockedCampaign(), id)!;

  it('the tutorial locks every explosive, vehicle and building tier above 1', () => {
    const s = start('tutorial_pit');
    expect(vehicleTierGate(s, 2)).not.toBeNull();
    expect(vehicleTierGate(s, 3)).not.toBeNull();
    expect(vehicleLock(s, 'travel_vehicle', 2)).not.toBeNull();
    for (const type of MULTI_TIER()) expect(isBuildingTierUnlocked(s, type, 2), type).toBe(false);
  });

  for (const id of ['dusty_hollow', 'grumpstone_ridge', 'treranium_depths']) {
    it(`${id} has every vehicle, race car and building tier open`, () => {
      const s = start(id);
      expect(vehicleTierGate(s, 2)).toBeNull();
      expect(vehicleTierGate(s, 3)).toBeNull();
      expect(vehicleLock(s, 'travel_vehicle', 2)).toBeNull();
      for (const type of MULTI_TIER()) {
        expect(isBuildingTierUnlocked(s, type, 2), type).toBe(true);
        expect(isBuildingTierUnlocked(s, type, 3), type).toBe(true);
      }
    });
  }

  it('shareholder_summit leaves vehicle and building tiers above 1 locked', () => {
    const s = start('shareholder_summit');
    expect(vehicleTierGate(s, 2)).not.toBeNull();
    for (const type of MULTI_TIER()) expect(isBuildingTierUnlocked(s, type, 2), type).toBe(false);
  });

  it('dusty_hollow buys tier 1 explosives only, grumpstone_ridge adds tier 2, treranium_depths all', () => {
    expect(resolveExplosivesFor(start('dusty_hollow'))).toEqual(explosiveIdsOfTier(1));
    const grumpstone = resolveExplosivesFor(start('grumpstone_ridge'));
    for (const id of explosiveIdsOfTier(2)) expect(grumpstone).toContain(id);
    for (const id of explosiveIdsOfTier(3)) expect(grumpstone).not.toContain(id);
    expect(resolveExplosivesFor(start('treranium_depths'))).toEqual(getAllExplosives().map(e => e.id));
    expect(resolveExplosivesFor(start('shareholder_summit'))).toEqual(getAllExplosives().map(e => e.id));
  });
});
