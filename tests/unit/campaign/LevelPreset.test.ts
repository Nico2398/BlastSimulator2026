// BlastSimulator2026 — Level presets: every level opens on the one progression ladder (#2292)

import { describe, it, expect } from 'vitest';
import * as LevelModule from '../../../src/core/campaign/Level.js';
import {
  getAllLevels,
  getLevel,
  applyLevelPreset,
  resolveExplosivesFor,
  autoFulfilmentEnabled,
  type LevelDef,
  type LevelPreset,
} from '../../../src/core/campaign/Level.js';
import { sandboxLevelDef, SANDBOX_DEFAULTS } from '../../../src/core/campaign/Sandbox.js';
import { createCampaignState } from '../../../src/core/campaign/Campaign.js';
import { createGameForLevel } from '../../../src/core/campaign/LevelTransition.js';
import { getQuest } from '../../../src/core/economy/QuestCatalog.js';
import { createGame } from '../../../src/core/state/GameState.js';
import { getAllExplosives, getExplosive } from '../../../src/core/world/ExplosiveCatalog.js';
import { MINE_TIERS_PER_GRADE, MINE_LAST_NAMED_GRADE } from '../../../src/core/config/balance.js';

const X2 = 'quest_explosive_t2';
const X3 = 'quest_explosive_t3';
const V2 = 'quest_vehicle_t2';
const V3 = 'quest_vehicle_t3';
const B2 = 'quest_building_t2';
const B3 = 'quest_building_t3';
const RACE = 'quest_race_car';
const ALL_TIER_QUESTS = [X2, X3, V2, V3, B2, B3, RACE];
const VEHICLE_BUILDING_RACE = [V2, V3, B2, B3, RACE];

function unlockedCampaign() {
  const campaign = createCampaignState();
  for (const entry of Object.values(campaign.levels)) entry.unlocked = true;
  return campaign;
}

/** Levels still off the ladder: tutorial_pit until #2318 moves its scenarios and ramp region to G0 rules. */
const OFF_LADDER = ['tutorial_pit'];

function ladderLevels(): LevelDef[] {
  return getAllLevels().filter(l => !OFF_LADDER.includes(l.id));
}

function allLevelDefs(): LevelDef[] {
  return [...ladderLevels(), sandboxLevelDef(SANDBOX_DEFAULTS)];
}

function presetOf(id: string): LevelPreset {
  return getLevel(id)!.preset!;
}

/** Explosive ids a site with exactly `completed` quests may buy: tier 1 plus the tiers whose quest is done. */
function expectedExplosives(completed: readonly string[]): string[] {
  return getAllExplosives()
    .filter(e => e.tier === 1 || (e.tier === 2 && completed.includes(X2)) || (e.tier === 3 && completed.includes(X3)))
    .map(e => e.id);
}

describe('LevelPreset shape (#2292)', () => {
  it('only the levels named in OFF_LADDER lack a preset (#2318)', () => {
    expect(getAllLevels().filter(l => l.preset === undefined).map(l => l.id)).toEqual(OFF_LADDER);
  });

  it('every other campaign level and the sandbox def declare a preset', () => {
    for (const level of allLevelDefs()) {
      expect(level.preset, level.id).toBeDefined();
      expect(typeof level.preset!.grade, level.id).toBe('number');
      expect(Array.isArray(level.preset!.completedQuests), level.id).toBe(true);
    }
  });

  it('every preset grade is a whole number, 0 or more', () => {
    for (const level of allLevelDefs()) {
      expect(Number.isInteger(level.preset!.grade), level.id).toBe(true);
      expect(level.preset!.grade, level.id).toBeGreaterThanOrEqual(0);
    }
  });

  it('every preset tier lies within 1..MINE_TIERS_PER_GRADE', () => {
    for (const level of allLevelDefs()) {
      expect(Number.isInteger(level.preset!.tier), level.id).toBe(true);
      expect(level.preset!.tier, level.id).toBeGreaterThanOrEqual(1);
      expect(level.preset!.tier, level.id).toBeLessThanOrEqual(MINE_TIERS_PER_GRADE);
    }
  });

  it('every completed quest id exists in the quest catalog', () => {
    for (const level of allLevelDefs()) {
      for (const id of level.preset!.completedQuests) {
        expect(getQuest(id), `${level.id}: ${id}`).toBeDefined();
      }
    }
  });

  it('no preset lists a quest twice', () => {
    for (const level of allLevelDefs()) {
      expect(new Set(level.preset!.completedQuests).size, level.id).toBe(level.preset!.completedQuests.length);
    }
  });

  it('no level def carries the retired progression, manualContracts or availableExplosives fields', () => {
    for (const level of allLevelDefs()) {
      expect('progression' in level, `${level.id} progression`).toBe(false);
      expect('manualContracts' in level, `${level.id} manualContracts`).toBe(false);
      expect('availableExplosives' in level, `${level.id} availableExplosives`).toBe(false);
    }
  });

  it('Level.ts no longer exports the level-keyed explosive helpers', () => {
    expect('resolveAvailableExplosives' in LevelModule).toBe(false);
    expect('isExplosiveAvailable' in LevelModule).toBe(false);
  });
});

describe('level presets reproduce the old explosive and tier rules (#2292)', () => {
  it('tutorial_pit keeps its pre-ladder rules until #2318: no preset, tier 1 explosives only', () => {
    const level = getLevel('tutorial_pit')!;
    expect(level.preset).toBeUndefined();
    expect(level.legacy?.manualContracts).toBe(true);
    for (const id of level.legacy!.availableExplosives) expect(getExplosive(id)!.tier, id).toBe(1);
  });

  it('dusty_hollow: no explosive quest, every vehicle, building and race-car quest', () => {
    const done = presetOf('dusty_hollow').completedQuests;
    expect(done).not.toContain(X2);
    expect(done).not.toContain(X3);
    for (const id of VEHICLE_BUILDING_RACE) expect(done).toContain(id);
  });

  it('grumpstone_ridge: explosive tier 2 only, plus every vehicle, building and race-car quest', () => {
    const done = presetOf('grumpstone_ridge').completedQuests;
    expect(done).toContain(X2);
    expect(done).not.toContain(X3);
    for (const id of VEHICLE_BUILDING_RACE) expect(done).toContain(id);
  });

  it('treranium_depths: explosive tiers 2 and 3, plus every vehicle, building and race-car quest', () => {
    const done = presetOf('treranium_depths').completedQuests;
    for (const id of ALL_TIER_QUESTS) expect(done).toContain(id);
  });

  it('shareholder_summit: G0 tier 1 with explosive tiers 2 and 3 completed', () => {
    const p = presetOf('shareholder_summit');
    expect(p.grade).toBe(0);
    expect(p.tier).toBe(1);
    expect(p.completedQuests).toContain(X2);
    expect(p.completedQuests).toContain(X3);
  });

  it('shareholder_summit keeps no vehicle or building tier quest it did not have before', () => {
    const done = presetOf('shareholder_summit').completedQuests;
    for (const id of [V2, V3, B2, B3, RACE]) expect(done).not.toContain(id);
  });

  it('the sandbox def starts at G0 tier 1', () => {
    const p = sandboxLevelDef(SANDBOX_DEFAULTS).preset!;
    expect(p.grade).toBe(0);
    expect(p.tier).toBe(1);
  });

  it('the sandbox def starts with no quest completed', () => {
    expect(sandboxLevelDef(SANDBOX_DEFAULTS).preset!.completedQuests).toEqual([]);
  });

  it('the sandbox preset does not depend on the kit or biome', () => {
    const digger = sandboxLevelDef({ ...SANDBOX_DEFAULTS, kit: 'digger' }).preset!;
    const full = sandboxLevelDef({ ...SANDBOX_DEFAULTS, kit: 'full' }).preset!;
    expect(digger).toEqual(full);
  });
});

describe('applyLevelPreset (#2292)', () => {
  const preset: LevelPreset = { grade: 2, tier: 2, completedQuests: [X2, V2] };

  function bareState() {
    return createGame({ seed: 42, mineType: 'desert' });
  }

  it('gives the state the preset grade and tier', () => {
    const s = bareState();
    applyLevelPreset(s, preset);
    expect(s.grade).toBeDefined();
    expect(s.grade!.grade).toBe(2);
    expect(s.grade!.tier).toBe(2);
  });

  it('gives the state the preset completed quests with fresh counters', () => {
    const s = bareState();
    applyLevelPreset(s, preset);
    expect(s.quests).toBeDefined();
    expect([...s.quests!.completed].sort()).toEqual([V2, X2].sort());
    expect(s.quests!.cleanBlasts).toBe(0);
    expect(s.quests!.explosiveKg).toBe(0);
    expect(s.quests!.rockKg).toBe(0);
  });

  it('an empty preset gives a G0 tier 1 site with no completed quest', () => {
    const s = bareState();
    applyLevelPreset(s, { grade: 0, tier: 1, completedQuests: [] });
    expect(s.grade!.grade).toBe(0);
    expect(s.grade!.tier).toBe(1);
    expect(s.quests!.completed).toEqual([]);
  });

  it('a grade override replaces the preset grade and leaves its tier and quests', () => {
    const s = bareState();
    applyLevelPreset(s, preset, { grade: 1 });
    expect(s.grade!.grade).toBe(1);
    expect(s.grade!.tier).toBe(2);
    expect([...s.quests!.completed].sort()).toEqual([V2, X2].sort());
  });

  it('a tier override replaces the preset tier on a named grade', () => {
    const s = bareState();
    applyLevelPreset(s, preset, { tier: 3 });
    expect(s.grade!.grade).toBe(2);
    expect(s.grade!.tier).toBe(3);
  });

  it('grade and tier overrides apply together', () => {
    const s = bareState();
    applyLevelPreset(s, { grade: 0, tier: 1, completedQuests: [] }, { grade: MINE_LAST_NAMED_GRADE, tier: 2 });
    expect(s.grade!.grade).toBe(MINE_LAST_NAMED_GRADE);
    expect(s.grade!.tier).toBe(2);
  });

  it('a tier override is ignored above the last named grade', () => {
    const s = bareState();
    applyLevelPreset(s, { grade: 0, tier: 1, completedQuests: [] }, { grade: MINE_LAST_NAMED_GRADE + 1, tier: 3 });
    expect(s.grade!.grade).toBe(MINE_LAST_NAMED_GRADE + 1);
    expect(s.grade!.tier).toBe(1);
  });

  it('an override never touches the preset quests', () => {
    const s = bareState();
    applyLevelPreset(s, { grade: 0, tier: 1, completedQuests: [X2] }, { grade: 3, tier: 3 });
    expect(s.quests!.completed).toEqual([X2]);
  });

  it('completing a quest on the state does not edit the preset', () => {
    const own: LevelPreset = { grade: 0, tier: 1, completedQuests: [X2] };
    const s = bareState();
    applyLevelPreset(s, own);
    s.quests!.completed.push(X3);
    expect(own.completedQuests).toEqual([X2]);
  });

  it('two states built from one preset do not share quest state', () => {
    const a = bareState();
    const b = bareState();
    applyLevelPreset(a, preset);
    applyLevelPreset(b, preset);
    a.quests!.completed.push(X3);
    expect(b.quests!.completed).not.toContain(X3);
  });
});

describe('createGameForLevel opens every ladder level on its preset (#2292)', () => {
  for (const level of ladderLevels()) {
    it(`${level.id}: grade, tier and completed quests come from its preset`, () => {
      const s = createGameForLevel(unlockedCampaign(), level.id)!;
      expect(s).not.toBeNull();
      expect(s.grade).toBeDefined();
      expect(s.quests).toBeDefined();
      expect(s.grade!.grade).toBe(level.preset!.grade);
      expect(s.grade!.tier).toBe(level.preset!.tier);
      expect([...s.quests!.completed].sort()).toEqual([...level.preset!.completedQuests].sort());
    });

    it(`${level.id}: the start override pins grade and tier over the preset`, () => {
      const s = createGameForLevel(unlockedCampaign(), level.id, undefined, { grade: 2, tier: 3 })!;
      expect(s.grade!.grade).toBe(2);
      expect(s.grade!.tier).toBe(3);
      expect([...s.quests!.completed].sort()).toEqual([...level.preset!.completedQuests].sort());
    });

    it(`${level.id}: resolveExplosivesFor is tier 1 plus the tiers its completed quests open`, () => {
      const s = createGameForLevel(unlockedCampaign(), level.id)!;
      expect(resolveExplosivesFor(s)).toEqual(expectedExplosives(level.preset!.completedQuests));
    });
  }

  it('a grade-only override keeps the preset tier', () => {
    const s = createGameForLevel(unlockedCampaign(), 'dusty_hollow', undefined, { grade: 1 })!;
    expect(s.grade!.grade).toBe(1);
    expect(s.grade!.tier).toBe(1);
  });

  it('a tier override above the last named grade is ignored', () => {
    const s = createGameForLevel(unlockedCampaign(), 'dusty_hollow', undefined, { grade: MINE_LAST_NAMED_GRADE + 2, tier: 3 })!;
    expect(s.grade!.grade).toBe(MINE_LAST_NAMED_GRADE + 2);
    expect(s.grade!.tier).toBe(1);
  });

  it('a locked level still returns null with a start override', () => {
    expect(createGameForLevel(createCampaignState(), 'treranium_depths', undefined, { grade: 1 })).toBeNull();
  });

  it('an unknown level still returns null with a start override', () => {
    expect(createGameForLevel(unlockedCampaign(), 'no_such_level', undefined, { grade: 1 })).toBeNull();
  });

  it('two games of one level share no quest state', () => {
    const a = createGameForLevel(unlockedCampaign(), 'dusty_hollow')!;
    const b = createGameForLevel(unlockedCampaign(), 'dusty_hollow')!;
    a.quests!.completed.push(X2);
    expect(b.quests!.completed).not.toContain(X2);
  });
});

describe('tutorial level while off the ladder (#2318)', () => {
  const tutorial = () => {
    const s = createGameForLevel(createCampaignState(), 'tutorial_pit')!;
    s.campaign.activeLevelId = 'tutorial_pit';
    return s;
  };

  it('opens with no grade and no quest state', () => {
    const s = tutorial();
    expect(s.grade).toBeUndefined();
    expect(s.quests).toBeUndefined();
  });

  it('only tier 1 explosives are purchasable', () => {
    const ids = resolveExplosivesFor(tutorial());
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(getExplosive(id)!.tier, id).toBe(1);
  });

  it('no automatic sale or rubble clearance until the player chooses', () => {
    const s = tutorial();
    expect(autoFulfilmentEnabled(s, 'autoSell')).toBe(false);
    expect(autoFulfilmentEnabled(s, 'autoClearRubble')).toBe(false);
  });

  it('the player explicit autoSell choice wins either way', () => {
    const s = tutorial();
    s.contracts.autoSell = true;
    expect(autoFulfilmentEnabled(s, 'autoSell')).toBe(true);
    s.contracts.autoSell = false;
    expect(autoFulfilmentEnabled(s, 'autoSell')).toBe(false);
  });
});

describe('autoFulfilmentEnabled on every ladder level (#2292)', () => {
  for (const level of ladderLevels()) {
    it(`${level.id}: automatic sale and rubble clearance default on`, () => {
      const s = createGameForLevel(unlockedCampaign(), level.id)!;
      expect(autoFulfilmentEnabled(s, 'autoSell')).toBe(true);
      expect(autoFulfilmentEnabled(s, 'autoClearRubble')).toBe(true);
    });
  }

  it('a state with no active level defaults on', () => {
    const s = createGame({ seed: 42, mineType: 'desert' });
    expect(autoFulfilmentEnabled(s, 'autoSell')).toBe(true);
  });
});
