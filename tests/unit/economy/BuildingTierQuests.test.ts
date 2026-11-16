// BlastSimulator2026 — Building-tier quests: catalog, new objective kinds, completion, the tier gate (#2283)

import { describe, it, expect, beforeAll } from 'vitest';
import {
  createQuestState,
  questObjectiveStatuses,
  questPrerequisitesMet,
  advanceQuests,
  completeQuest,
  isBuildingTierUnlocked,
  buildingTierLockedByQuest,
  type QuestDef,
} from '../../../src/core/economy/Quests.js';
import { getAllQuests, getQuest } from '../../../src/core/economy/QuestCatalog.js';
import { createGradeState } from '../../../src/core/economy/MineGrade.js';
import { createGame, type GameState } from '../../../src/core/state/GameState.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { serialize, deserialize } from '../../../src/core/state/SaveLoad.js';
import {
  placeBuilding, getAllBuildingTypes, isSingleTierType, getBuildingPeopleCapacity,
  type BuildingType, type BuildingTier,
} from '../../../src/core/entities/Building.js';
import { createEmployeeState, hireEmployee } from '../../../src/core/entities/Employee.js';
import { runTick } from '../../../src/core/engine/TickPipeline.js';
import { Random } from '../../../src/core/math/Random.js';
import { setLocale, t } from '../../../src/core/i18n/I18n.js';
import {
  QUEST_BUILDING_T2_BUILDINGS, QUEST_BUILDING_T2_CREW_HOUSED,
  QUEST_BUILDING_T3_BUILDINGS, QUEST_BUILDING_T3_CREW_HOUSED, QUEST_BUILDING_T3_SAFETY_SCORE,
} from '../../../src/core/config/balance.js';

const B2 = 'quest_building_t2';
const B3 = 'quest_building_t3';
const T2 = 'quest_explosive_t2';

const MULTI_TIER = (): BuildingType[] => getAllBuildingTypes().filter(type => !isSingleTierType(type));
const SINGLE_TIER = (): BuildingType[] => getAllBuildingTypes().filter(type => isSingleTierType(type));

function questSite(): GameState {
  const s = createGame({ seed: 42, mineType: 'desert' });
  s.grade = createGradeState();
  s.quests = createQuestState();
  s.scores.safety = 0;
  return s;
}

/** Stand `n` buildings on the site; the first is living quarters, the rest management offices on a spread of cells. */
function standBuildings(s: GameState, n: number): void {
  for (let i = 0; i < n; i++) {
    const type: BuildingType = i === 0 ? 'living_quarters' : 'management_office';
    const r = placeBuilding(s.buildings, type, 4 + i * 8, 20, 128, 128);
    expect(r.success, r.error).toBe(true);
  }
}

function hire(s: GameState, n: number): void {
  const pool = createEmployeeState();
  for (let i = 0; i < n; i++) {
    const { employee } = hireEmployee(pool, 'driller', new Random(100 + i), 0, 0);
    employee.id = 1000 + s.employees.employees.length;
    s.employees.employees.push(employee);
  }
}

/** The target of the objective of `kind` (the kind is read as a string: the union may not name it yet). */
function targetOf(q: QuestDef, kind: string): number | undefined {
  return q.objectives.find(o => (o.kind as string) === kind)?.target;
}

function status(s: GameState, def: QuestDef, kind: string) {
  return questObjectiveStatuses(s, def).find(o => o.kind === kind)!;
}

function meetBuildingT2(s: GameState): void {
  standBuildings(s, QUEST_BUILDING_T2_BUILDINGS);
  hire(s, QUEST_BUILDING_T2_CREW_HOUSED);
}

function meetBuildingT3(s: GameState): void {
  standBuildings(s, QUEST_BUILDING_T3_BUILDINGS);
  hire(s, QUEST_BUILDING_T3_CREW_HOUSED);
  s.scores.safety = QUEST_BUILDING_T3_SAFETY_SCORE;
}

describe('building quests in the catalog (#2283 C1)', () => {
  beforeAll(() => setLocale('en'));

  it('T2 has no prerequisite, rewards building tier 2 and names the architect', () => {
    const q = getQuest(B2)!;
    expect(q).toBeDefined();
    expect(q.requires ?? []).toEqual([]);
    expect(q.reward).toEqual({ kind: 'building_tier', tier: 2 });
    expect(q.giverKey).toBe('quest.giver.architect');
  });

  it('T2 objectives are the buildings and the housed crew, at the named constants', () => {
    const q = getQuest(B2)!;
    expect(q.objectives.map(o => o.kind as string).sort()).toEqual(['buildings_built', 'crew_housed']);
    expect(targetOf(q, 'buildings_built')).toBe(QUEST_BUILDING_T2_BUILDINGS);
    expect(targetOf(q, 'crew_housed')).toBe(QUEST_BUILDING_T2_CREW_HOUSED);
  });

  it('T3 requires T2, rewards building tier 3 and has three objectives at the named constants', () => {
    const q = getQuest(B3)!;
    expect(q).toBeDefined();
    expect(q.requires).toEqual([B2]);
    expect(q.reward).toEqual({ kind: 'building_tier', tier: 3 });
    expect(q.giverKey).toBe('quest.giver.architect');
    expect(q.objectives.map(o => o.kind as string).sort()).toEqual(['buildings_built', 'crew_housed', 'safety_score']);
    expect(targetOf(q, 'buildings_built')).toBe(QUEST_BUILDING_T3_BUILDINGS);
    expect(targetOf(q, 'crew_housed')).toBe(QUEST_BUILDING_T3_CREW_HOUSED);
    expect(targetOf(q, 'safety_score')).toBe(QUEST_BUILDING_T3_SAFETY_SCORE);
  });

  it('the balance constants hold the stated values', () => {
    expect(QUEST_BUILDING_T2_BUILDINGS).toBe(4);
    expect(QUEST_BUILDING_T2_CREW_HOUSED).toBe(2);
    expect(QUEST_BUILDING_T3_BUILDINGS).toBe(8);
    expect(QUEST_BUILDING_T3_CREW_HOUSED).toBe(4);
    expect(QUEST_BUILDING_T3_SAFETY_SCORE).toBe(60);
  });

  it('the explosive quests are unchanged', () => {
    expect(getQuest(T2)!.reward).toEqual({ kind: 'explosive_tier', tier: 2 });
    expect(getQuest('quest_explosive_t3')!.reward).toEqual({ kind: 'explosive_tier', tier: 3 });
    expect(getQuest(T2)!.giverKey).toBe('quest.giver.supplier');
  });

  it.each(['en', 'fr'] as const)('every building quest string and objective line resolves in %s', (locale) => {
    setLocale(locale);
    try {
      for (const q of [getQuest(B2)!, getQuest(B3)!]) {
        for (const key of [q.giverKey, q.titleKey, q.pitchKey]) {
          expect(t(key), key).not.toBe(key);
          expect(t(key).trim().length, key).toBeGreaterThan(0);
        }
      }
      for (const kind of ['buildings_built', 'crew_housed']) {
        const key = `quest.objective.${kind}`;
        expect(t(key, { current: 1, needed: 4 }), key).not.toBe(key);
      }
    } finally {
      setLocale('en');
    }
  });

  it('the architect reads differently in French and English', () => {
    setLocale('en');
    const en = t(getQuest(B2)!.giverKey);
    setLocale('fr');
    const fr = t(getQuest(B2)!.giverKey);
    setLocale('en');
    expect(fr).not.toBe(en);
  });
});

describe('buildings_built objective (#2283 C2)', () => {
  it('reads the number of standing buildings, at zero on an empty site', () => {
    const s = questSite();
    expect(status(s, getQuest(B2)!, 'buildings_built')).toEqual({
      kind: 'buildings_built', current: 0, needed: QUEST_BUILDING_T2_BUILDINGS, met: false,
    });
  });

  it('counts every standing building whatever its type', () => {
    const s = questSite();
    placeBuilding(s.buildings, 'freight_warehouse', 4, 4, 128, 128);
    placeBuilding(s.buildings, 'geology_lab', 40, 4, 128, 128);
    placeBuilding(s.buildings, 'driving_center', 80, 4, 128, 128);
    expect(status(s, getQuest(B2)!, 'buildings_built').current).toBe(3);
  });

  it('is one short, then met exactly at the target', () => {
    const s = questSite();
    standBuildings(s, QUEST_BUILDING_T2_BUILDINGS - 1);
    expect(status(s, getQuest(B2)!, 'buildings_built').met).toBe(false);
    placeBuilding(s.buildings, 'geology_lab', 100, 60, 128, 128);
    const st = status(s, getQuest(B2)!, 'buildings_built');
    expect(st.current).toBe(QUEST_BUILDING_T2_BUILDINGS);
    expect(st.met).toBe(true);
  });

  it('T3 needs more: the T2 count does not meet it', () => {
    const s = questSite();
    standBuildings(s, QUEST_BUILDING_T2_BUILDINGS);
    expect(status(s, getQuest(B3)!, 'buildings_built').met).toBe(false);
    expect(status(s, getQuest(B3)!, 'buildings_built').needed).toBe(QUEST_BUILDING_T3_BUILDINGS);
  });

  it('follows the buildings: a demolished building lowers the count', () => {
    const s = questSite();
    standBuildings(s, QUEST_BUILDING_T2_BUILDINGS);
    s.buildings.buildings.pop();
    expect(status(s, getQuest(B2)!, 'buildings_built').current).toBe(QUEST_BUILDING_T2_BUILDINGS - 1);
  });

  it('planned buildings (orders not yet built) are not standing', () => {
    const s = questSite();
    s.plannedBuildings.push({ id: 90, actionId: 900, type: 'management_office', tier: 1, x: 4, z: 4 } as never);
    expect(status(s, getQuest(B2)!, 'buildings_built').current).toBe(0);
  });
});

describe('crew_housed objective (#2283 C2)', () => {
  it('is zero with crew but no living quarters', () => {
    const s = questSite();
    hire(s, 5);
    expect(status(s, getQuest(B2)!, 'crew_housed')).toEqual({
      kind: 'crew_housed', current: 0, needed: QUEST_BUILDING_T2_CREW_HOUSED, met: false,
    });
  });

  it('is zero with living quarters but no crew', () => {
    const s = questSite();
    standBuildings(s, 1);
    expect(status(s, getQuest(B2)!, 'crew_housed').current).toBe(0);
  });

  it('reads the employee count while beds suffice', () => {
    const s = questSite();
    standBuildings(s, 1);
    hire(s, 3);
    expect(status(s, getQuest(B2)!, 'crew_housed').current).toBe(3);
  });

  it('is capped by the beds of the operating living quarters', () => {
    const s = questSite();
    standBuildings(s, 1);
    const beds = getBuildingPeopleCapacity('living_quarters', 1);
    hire(s, beds + 5);
    expect(status(s, getQuest(B2)!, 'crew_housed').current).toBe(beds);
  });

  it('adds up the beds of several living quarters', () => {
    const s = questSite();
    placeBuilding(s.buildings, 'living_quarters', 4, 20, 128, 128);
    placeBuilding(s.buildings, 'living_quarters', 60, 20, 128, 128);
    const beds = getBuildingPeopleCapacity('living_quarters', 1);
    hire(s, 2 * beds + 3);
    expect(status(s, getQuest(B2)!, 'crew_housed').current).toBe(2 * beds);
  });

  it('a higher-tier living quarters shelters more', () => {
    const s = questSite();
    placeBuilding(s.buildings, 'living_quarters', 4, 20, 128, 128, 2);
    const beds = getBuildingPeopleCapacity('living_quarters', 2);
    hire(s, beds + 1);
    expect(status(s, getQuest(B2)!, 'crew_housed').current).toBe(beds);
  });

  it('living quarters switched off house nobody', () => {
    const s = questSite();
    standBuildings(s, 1);
    hire(s, 3);
    s.buildings.buildings[0]!.active = false;
    expect(status(s, getQuest(B2)!, 'crew_housed').current).toBe(0);
  });

  it('living quarters closed by an event house nobody', () => {
    const s = questSite();
    standBuildings(s, 1);
    hire(s, 3);
    s.buildings.buildings[0]!.outOfService = true;
    expect(status(s, getQuest(B2)!, 'crew_housed').current).toBe(0);
  });

  it('other building types give no beds', () => {
    const s = questSite();
    placeBuilding(s.buildings, 'management_office', 4, 20, 128, 128);
    placeBuilding(s.buildings, 'geology_lab', 40, 20, 128, 128);
    hire(s, 4);
    expect(status(s, getQuest(B2)!, 'crew_housed').current).toBe(0);
  });

  it('is met exactly at the target and not one short', () => {
    const s = questSite();
    standBuildings(s, 1);
    hire(s, QUEST_BUILDING_T2_CREW_HOUSED - 1);
    expect(status(s, getQuest(B2)!, 'crew_housed').met).toBe(false);
    hire(s, 1);
    expect(status(s, getQuest(B2)!, 'crew_housed').met).toBe(true);
  });
});

describe('advanceQuests completes the building quests (#2283 C2)', () => {
  it('completes nothing on an empty site', () => {
    const s = questSite();
    const emitter = new EventEmitter();
    const seen: string[] = [];
    emitter.on('quest:completed', ({ questId }) => seen.push(questId));
    expect(advanceQuests(s, emitter)).toEqual([]);
    expect(seen).toEqual([]);
  });

  it('completes T2 once buildings and housed crew are met, emitting once', () => {
    const s = questSite();
    meetBuildingT2(s);
    const emitter = new EventEmitter();
    const seen: string[] = [];
    emitter.on('quest:completed', ({ questId }) => seen.push(questId));
    expect(advanceQuests(s, emitter)).toEqual([B2]);
    expect(seen).toEqual([B2]);
    expect(s.quests!.completed).toContain(B2);
    expect(advanceQuests(s, emitter)).toEqual([]);
    expect(seen).toEqual([B2]);
  });

  it('enough buildings without housed crew leaves T2 open', () => {
    const s = questSite();
    standBuildings(s, QUEST_BUILDING_T2_BUILDINGS);
    expect(advanceQuests(s)).toEqual([]);
  });

  it('housed crew without enough buildings leaves T2 open', () => {
    const s = questSite();
    standBuildings(s, QUEST_BUILDING_T2_BUILDINGS - 1);
    hire(s, QUEST_BUILDING_T2_CREW_HOUSED);
    expect(advanceQuests(s)).toEqual([]);
  });

  it('T3 waits for T2: its own objectives alone complete T2 only', () => {
    const s = questSite();
    s.quests!.completed = [];
    meetBuildingT3(s);
    s.scores.safety = 0;
    expect(advanceQuests(s)).toEqual([B2]);
    expect(questPrerequisitesMet(s, getQuest(B3)!)).toBe(true);
  });

  it('T2 then T3 complete in one call, T2 first', () => {
    const s = questSite();
    meetBuildingT3(s);
    expect(advanceQuests(s)).toEqual([B2, B3]);
  });

  it('T3 stays open with the safety score short', () => {
    const s = questSite();
    meetBuildingT3(s);
    s.scores.safety = QUEST_BUILDING_T3_SAFETY_SCORE - 1;
    expect(advanceQuests(s)).toEqual([B2]);
    expect(s.quests!.completed).not.toContain(B3);
  });

  it('T3 stays open with the buildings short', () => {
    const s = questSite();
    meetBuildingT2(s);
    advanceQuests(s);
    hire(s, QUEST_BUILDING_T3_CREW_HOUSED);
    s.scores.safety = QUEST_BUILDING_T3_SAFETY_SCORE;
    expect(advanceQuests(s)).toEqual([]);
  });

  it('a completed quest stays completed when a building falls', () => {
    const s = questSite();
    meetBuildingT2(s);
    advanceQuests(s);
    s.buildings.buildings.length = 0;
    expect(advanceQuests(s)).toEqual([]);
    expect(s.quests!.completed).toContain(B2);
  });

  it('building quests do not complete the explosive ones', () => {
    const s = questSite();
    meetBuildingT3(s);
    advanceQuests(s);
    expect(s.quests!.completed).not.toContain(T2);
  });

  it('does nothing on a site without quests', () => {
    const s = createGame({ seed: 42, mineType: 'desert' });
    meetBuildingT3(s);
    expect(advanceQuests(s)).toEqual([]);
    expect(s.quests).toBeUndefined();
  });

  it('the tick pipeline completes a met building quest', () => {
    const s = questSite();
    meetBuildingT2(s);
    s.cash = 10_000_000;
    runTick(s, null, new Random(s.seed + s.tickCount), new EventEmitter(), { checkInvariants: false });
    expect(s.quests!.completed).toContain(B2);
  });
});

describe('completeQuest on a building quest (#2283 C2)', () => {
  it('completes it without its objectives and emits quest:completed', () => {
    const s = questSite();
    const emitter = new EventEmitter();
    const seen: string[] = [];
    emitter.on('quest:completed', ({ questId }) => seen.push(questId));
    expect(completeQuest(s, B2, emitter)).toEqual({ ok: true });
    expect(seen).toEqual([B2]);
    expect(s.quests!.completed).toEqual([B2]);
  });

  it('refuses a second completion and a site without quests', () => {
    const s = questSite();
    completeQuest(s, B2);
    expect(completeQuest(s, B2)).toEqual({ ok: false, reason: 'already' });
    const plain = createGame({ seed: 42, mineType: 'desert' });
    expect(completeQuest(plain, B2)).toEqual({ ok: false, reason: 'no_quests' });
  });
});

describe('isBuildingTierUnlocked on a quest site (#2283 C3)', () => {
  it.each(MULTI_TIER())('%s: tier 1 always, tiers 2 and 3 locked at the start', (type) => {
    const s = questSite();
    expect(isBuildingTierUnlocked(s, type, 1)).toBe(true);
    expect(isBuildingTierUnlocked(s, type, 2)).toBe(false);
    expect(isBuildingTierUnlocked(s, type, 3)).toBe(false);
  });

  it.each(MULTI_TIER())('%s: the T2 quest opens tier 2 only', (type) => {
    const s = questSite();
    completeQuest(s, B2);
    expect(isBuildingTierUnlocked(s, type, 2)).toBe(true);
    expect(isBuildingTierUnlocked(s, type, 3)).toBe(false);
  });

  it.each(MULTI_TIER())('%s: both quests open every tier', (type) => {
    const s = questSite();
    completeQuest(s, B2);
    completeQuest(s, B3);
    for (const tier of [1, 2, 3] as BuildingTier[]) expect(isBuildingTierUnlocked(s, type, tier)).toBe(true);
  });

  it('the T3 quest alone opens tier 3 and not tier 2', () => {
    const s = questSite();
    completeQuest(s, B3);
    expect(isBuildingTierUnlocked(s, 'living_quarters', 3)).toBe(true);
    expect(isBuildingTierUnlocked(s, 'living_quarters', 2)).toBe(false);
  });

  it('the explosive quests open no building tier', () => {
    const s = questSite();
    completeQuest(s, T2);
    completeQuest(s, 'quest_explosive_t3');
    expect(isBuildingTierUnlocked(s, 'living_quarters', 2)).toBe(false);
    expect(isBuildingTierUnlocked(s, 'living_quarters', 3)).toBe(false);
  });

  it('one quest unlocks every type at once', () => {
    const s = questSite();
    completeQuest(s, B2);
    for (const type of MULTI_TIER()) expect(isBuildingTierUnlocked(s, type, 2), type).toBe(true);
  });

  it.each(SINGLE_TIER())('single-tier %s never unlocks above tier 1', (type) => {
    const s = questSite();
    completeQuest(s, B2);
    completeQuest(s, B3);
    s.buildings.unlockedTiers[type] = 3;
    expect(isBuildingTierUnlocked(s, type, 1)).toBe(true);
    expect(isBuildingTierUnlocked(s, type, 2)).toBe(false);
    expect(isBuildingTierUnlocked(s, type, 3)).toBe(false);
  });

  it('unlockedTiers (grandfathered by past research) also unlocks, for its own type only', () => {
    const s = questSite();
    s.buildings.unlockedTiers['living_quarters'] = 2;
    expect(isBuildingTierUnlocked(s, 'living_quarters', 2)).toBe(true);
    expect(isBuildingTierUnlocked(s, 'living_quarters', 3)).toBe(false);
    expect(isBuildingTierUnlocked(s, 'geology_lab', 2)).toBe(false);
    s.buildings.unlockedTiers['living_quarters'] = 3;
    expect(isBuildingTierUnlocked(s, 'living_quarters', 3)).toBe(true);
    expect(isBuildingTierUnlocked(s, 'living_quarters', 2)).toBe(true);
  });

  it('unlockedTiers at 1 unlocks nothing', () => {
    const s = questSite();
    s.buildings.unlockedTiers['living_quarters'] = 1;
    expect(isBuildingTierUnlocked(s, 'living_quarters', 2)).toBe(false);
  });
});

describe('isBuildingTierUnlocked on a site without quests (#2283 C3)', () => {
  it.each(MULTI_TIER())('%s: every tier is unlocked', (type) => {
    const s = createGame({ seed: 42, mineType: 'desert' });
    for (const tier of [1, 2, 3] as BuildingTier[]) expect(isBuildingTierUnlocked(s, type, tier)).toBe(true);
  });

  it('unlockedTiers plays no part', () => {
    const s = createGame({ seed: 42, mineType: 'desert' });
    s.buildings.unlockedTiers = {};
    expect(isBuildingTierUnlocked(s, 'driving_center', 3)).toBe(true);
    s.buildings.unlockedTiers['driving_center'] = 1;
    expect(isBuildingTierUnlocked(s, 'driving_center', 3)).toBe(true);
  });
});

describe('buildingTierLockedByQuest (#2283 C3)', () => {
  it('names the T2 quest for tier 2 and the T3 quest for tier 3 while locked', () => {
    const s = questSite();
    expect(buildingTierLockedByQuest(s, 'living_quarters', 2)?.id).toBe(B2);
    expect(buildingTierLockedByQuest(s, 'living_quarters', 3)?.id).toBe(B3);
  });

  it('is null for tier 1', () => {
    expect(buildingTierLockedByQuest(questSite(), 'living_quarters', 1)).toBeNull();
  });

  it('is null once the quest is completed, and still names the T3 quest after T2', () => {
    const s = questSite();
    completeQuest(s, B2);
    expect(buildingTierLockedByQuest(s, 'geology_lab', 2)).toBeNull();
    expect(buildingTierLockedByQuest(s, 'geology_lab', 3)?.id).toBe(B3);
    completeQuest(s, B3);
    expect(buildingTierLockedByQuest(s, 'geology_lab', 3)).toBeNull();
  });

  it('is null where the tier is grandfathered by unlockedTiers', () => {
    const s = questSite();
    s.buildings.unlockedTiers['driving_center'] = 2;
    expect(buildingTierLockedByQuest(s, 'driving_center', 2)).toBeNull();
    expect(buildingTierLockedByQuest(s, 'driving_center', 3)?.id).toBe(B3);
  });

  it('is null on a site without quests', () => {
    const s = createGame({ seed: 42, mineType: 'desert' });
    expect(buildingTierLockedByQuest(s, 'living_quarters', 2)).toBeNull();
    expect(buildingTierLockedByQuest(s, 'living_quarters', 3)).toBeNull();
  });

  it('agrees with isBuildingTierUnlocked for every multi-tier type, tier and quest state', () => {
    for (const done of [[], [B2], [B2, B3]]) {
      const s = questSite();
      s.quests!.completed = [...done];
      for (const type of MULTI_TIER()) {
        for (const tier of [1, 2, 3] as BuildingTier[]) {
          expect(buildingTierLockedByQuest(s, type, tier) === null, `${type} T${tier} after ${done.join('+')}`)
            .toBe(isBuildingTierUnlocked(s, type, tier));
        }
      }
    }
  });

  it('the returned quest is a catalog entry', () => {
    const q = buildingTierLockedByQuest(questSite(), 'living_quarters', 2)!;
    expect(getAllQuests()).toContain(q);
  });
});

describe('the tier gate across a save (#2283 C3)', () => {
  function progressionSave(): GameState {
    const s = createGame({ seed: 42, mineType: 'desert' });
    s.grade = createGradeState();
    s.quests = createQuestState();
    return s;
  }

  it('a completed building quest keeps its tier open after load', () => {
    const s = progressionSave();
    completeQuest(s, B2);
    const loaded = deserialize(serialize(s));
    expect(isBuildingTierUnlocked(loaded, 'living_quarters', 2)).toBe(true);
    expect(isBuildingTierUnlocked(loaded, 'living_quarters', 3)).toBe(false);
  });

  it('a grade save already holding unlockedTiers keeps them after load', () => {
    const s = progressionSave();
    s.buildings.unlockedTiers['geology_lab'] = 2;
    const loaded = deserialize(serialize(s));
    expect(loaded.buildings.unlockedTiers['geology_lab']).toBe(2);
    expect(isBuildingTierUnlocked(loaded, 'geology_lab', 2)).toBe(true);
    expect(isBuildingTierUnlocked(loaded, 'geology_lab', 3)).toBe(false);
    expect(isBuildingTierUnlocked(loaded, 'living_quarters', 2)).toBe(false);
  });

  it('a fresh progression save loads with every higher tier locked', () => {
    const loaded = deserialize(serialize(progressionSave()));
    expect(isBuildingTierUnlocked(loaded, 'living_quarters', 2)).toBe(false);
  });
});
