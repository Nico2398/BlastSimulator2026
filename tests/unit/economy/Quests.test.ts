// BlastSimulator2026 — Quests: objectives, completion, prerequisites, saves, explosive availability (#2280)

import { describe, it, expect, beforeAll } from 'vitest';
import {
  createQuestState,
  sanitizeQuestState,
  questObjectiveStatuses,
  isQuestCompleted,
  questPrerequisitesMet,
  recordQuestBlast,
  advanceQuests,
  completeQuest,
  unlockedExplosiveTier,
  explosiveLockedByQuest,
  type QuestState,
} from '../../../src/core/economy/Quests.js';
import { getAllQuests, getQuest } from '../../../src/core/economy/QuestCatalog.js';
import { createGradeState } from '../../../src/core/economy/MineGrade.js';
import { createGame, type GameState } from '../../../src/core/state/GameState.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { serialize, deserialize } from '../../../src/core/state/SaveLoad.js';
import { resolveExplosivesFor, isExplosiveAvailableFor, resolveAvailableExplosives } from '../../../src/core/campaign/Level.js';
import { getAllExplosives, explosivesOfTier } from '../../../src/core/world/ExplosiveCatalog.js';
import { optimizerOptionsFor } from '../../../src/core/mining/ChargeOptimizer.js';
import { autoChargeHole, chargePatternHoles } from '../../../src/core/mining/ChargeOrder.js';
import { runTick } from '../../../src/core/engine/TickPipeline.js';
import { Random } from '../../../src/core/math/Random.js';
import { createGameForLevel } from '../../../src/core/campaign/LevelTransition.js';
import { createCampaignState } from '../../../src/core/campaign/Campaign.js';
import { createRunner } from '../../../src/console/createRunner.js';
import { setLocale, t } from '../../../src/core/i18n/I18n.js';
import {
  QUEST_T2_CLEAN_BLASTS, QUEST_T2_EXPLOSIVE_KG,
  QUEST_T3_CLEAN_BLASTS, QUEST_T3_ROCK_KG, QUEST_T3_SAFETY_SCORE,
} from '../../../src/core/config/balance.js';

const T2 = 'quest_explosive_t2';
const T3 = 'quest_explosive_t3';
const B2 = 'quest_building_t2';
const B3 = 'quest_building_t3';

function questSite(): GameState {
  const s = createGame({ seed: 42, mineType: 'desert' });
  s.grade = createGradeState();
  s.quests = createQuestState();
  return s;
}

function meetT2(q: QuestState): void {
  q.cleanBlasts = 2;
  q.explosiveKg = 100;
}

function meetAll(s: GameState): void {
  const q = s.quests!;
  q.cleanBlasts = 5;
  q.explosiveKg = 100;
  q.rockKg = 500_000;
  s.scores.safety = 60;
}

function collect(emitter: EventEmitter): string[] {
  const seen: string[] = [];
  emitter.on('quest:completed', ({ questId }) => seen.push(questId));
  return seen;
}

const ids = (list: readonly { id: string }[]): string[] => list.map(e => e.id);

describe('quest catalog (#2280 C2, C4)', () => {
  beforeAll(() => setLocale('en'));

  it('lists the two explosive quests and the two building quests', () => {
    expect(getAllQuests().map(q => q.id).sort()).toEqual([B2, B3, T2, T3]);
  });

  it('the explosive quests reward explosive tiers, the building quests building tiers', () => {
    for (const q of getAllQuests()) {
      const expected = q.id === B2 || q.id === B3 ? 'building_tier' : 'explosive_tier';
      expect(q.reward.kind, q.id).toBe(expected);
    }
  });

  it('getQuest finds a quest by id and returns undefined for an unknown id', () => {
    expect(getQuest(T2)?.id).toBe(T2);
    expect(getQuest('quest_nope')).toBeUndefined();
  });

  it('T2 rewards tier 2, with no prerequisite and the two stated objectives', () => {
    const q = getQuest(T2)!;
    expect(q.reward).toEqual({ kind: 'explosive_tier', tier: 2 });
    expect(q.requires ?? []).toEqual([]);
    expect(q.objectives).toHaveLength(2);
    expect(q.objectives.find(o => o.kind === 'clean_blasts')!.target).toBe(QUEST_T2_CLEAN_BLASTS);
    expect(q.objectives.find(o => o.kind === 'explosive_kg')!.target).toBe(QUEST_T2_EXPLOSIVE_KG);
    expect(QUEST_T2_CLEAN_BLASTS).toBe(2);
    expect(QUEST_T2_EXPLOSIVE_KG).toBe(100);
  });

  it('T3 rewards tier 3, requires T2 and has three objectives', () => {
    const q = getQuest(T3)!;
    expect(q.reward).toEqual({ kind: 'explosive_tier', tier: 3 });
    expect(q.requires).toEqual([T2]);
    expect(q.objectives).toHaveLength(3);
    expect(q.objectives.find(o => o.kind === 'clean_blasts')!.target).toBe(QUEST_T3_CLEAN_BLASTS);
    expect(q.objectives.find(o => o.kind === 'rock_kg')!.target).toBe(QUEST_T3_ROCK_KG);
    expect(q.objectives.find(o => o.kind === 'safety_score')!.target).toBe(QUEST_T3_SAFETY_SCORE);
    expect(QUEST_T3_CLEAN_BLASTS).toBe(5);
    expect(QUEST_T3_ROCK_KG).toBe(500_000);
    expect(QUEST_T3_SAFETY_SCORE).toBe(60);
  });

  it('both explosive quests share one giver, the explosives supplier', () => {
    expect(getQuest(T2)!.giverKey).toBe(getQuest(T3)!.giverKey);
  });

  it('the building quests are given by someone other than the explosives supplier', () => {
    expect(getQuest(B2)!.giverKey).toBe(getQuest(B3)!.giverKey);
    expect(getQuest(B2)!.giverKey).not.toBe(getQuest(T2)!.giverKey);
  });

  it.each(['en', 'fr'] as const)('every quest string resolves in %s (no raw key shown)', (locale) => {
    setLocale(locale);
    try {
      for (const q of getAllQuests()) {
        for (const key of [q.giverKey, q.titleKey, q.pitchKey]) {
          const text = t(key);
          expect(text, key).not.toBe(key);
          expect(text.trim().length, key).toBeGreaterThan(0);
        }
      }
    } finally {
      setLocale('en');
    }
  });

  it('titles and pitches read differently in French and English', () => {
    const read = (): string[] => getAllQuests().flatMap(q => [t(q.titleKey), t(q.pitchKey), t(q.giverKey)]);
    setLocale('en');
    const en = read();
    setLocale('fr');
    const fr = read();
    setLocale('en');
    expect(fr).not.toEqual(en);
    en.forEach((text, i) => expect(text.length, `string ${i}`).toBeGreaterThan(0));
  });

  it('every quest has a distinct title', () => {
    const titles = getAllQuests().map(q => t(q.titleKey));
    expect(new Set(titles).size).toBe(titles.length);
  });
});

describe('createQuestState (#2280 C6)', () => {
  it('starts with nothing completed and every counter at zero', () => {
    expect(createQuestState()).toEqual({ completed: [], cleanBlasts: 0, explosiveKg: 0, rockKg: 0 });
  });

  it('returns a fresh object each time', () => {
    const a = createQuestState();
    a.completed.push(T2);
    expect(createQuestState().completed).toEqual([]);
  });
});

describe('recordQuestBlast (#2280 C3)', () => {
  it('a clean blast extends the streak and adds to the running totals', () => {
    const q = createQuestState();
    recordQuestBlast(q, { explosiveKg: 30, rockKg: 1_000, flyrockIncident: false });
    recordQuestBlast(q, { explosiveKg: 20, rockKg: 500, flyrockIncident: false });
    expect(q.cleanBlasts).toBe(2);
    expect(q.explosiveKg).toBe(50);
    expect(q.rockKg).toBe(1_500);
  });

  it('a flyrock incident resets the streak to 0 but still books the kilograms', () => {
    const q = createQuestState();
    recordQuestBlast(q, { explosiveKg: 10, rockKg: 100, flyrockIncident: false });
    recordQuestBlast(q, { explosiveKg: 10, rockKg: 100, flyrockIncident: false });
    recordQuestBlast(q, { explosiveKg: 15, rockKg: 200, flyrockIncident: true });
    expect(q.cleanBlasts).toBe(0);
    expect(q.explosiveKg).toBe(35);
    expect(q.rockKg).toBe(400);
  });

  it('the streak restarts from zero after an incident', () => {
    const q = createQuestState();
    recordQuestBlast(q, { explosiveKg: 1, rockKg: 1, flyrockIncident: true });
    recordQuestBlast(q, { explosiveKg: 1, rockKg: 1, flyrockIncident: false });
    expect(q.cleanBlasts).toBe(1);
  });

  it('an incident on the very first blast leaves the streak at 0', () => {
    const q = createQuestState();
    recordQuestBlast(q, { explosiveKg: 5, rockKg: 5, flyrockIncident: true });
    expect(q.cleanBlasts).toBe(0);
  });

  it('is a no-op without quest state', () => {
    expect(() => recordQuestBlast(undefined, { explosiveKg: 10, rockKg: 10, flyrockIncident: false })).not.toThrow();
  });

  it('does not touch the completed list', () => {
    const q = createQuestState();
    q.completed.push(T2);
    recordQuestBlast(q, { explosiveKg: 10, rockKg: 10, flyrockIncident: true });
    expect(q.completed).toEqual([T2]);
  });
});

describe('questObjectiveStatuses (#2280 C3)', () => {
  it('lists one status per objective, at zero on a fresh site', () => {
    const s = questSite();
    s.scores.safety = 0;
    const statuses = questObjectiveStatuses(s, getQuest(T2)!);
    expect(statuses.map(x => x.kind)).toEqual(getQuest(T2)!.objectives.map(o => o.kind));
    for (const st of statuses) {
      expect(st.current).toBe(0);
      expect(st.met).toBe(false);
      expect(st.needed).toBeGreaterThan(0);
    }
  });

  it('reports each counter as the current value against the target', () => {
    const s = questSite();
    s.quests!.cleanBlasts = 1;
    s.quests!.explosiveKg = 40;
    const statuses = questObjectiveStatuses(s, getQuest(T2)!);
    const clean = statuses.find(x => x.kind === 'clean_blasts')!;
    const kg = statuses.find(x => x.kind === 'explosive_kg')!;
    expect(clean).toEqual({ kind: 'clean_blasts', current: 1, needed: QUEST_T2_CLEAN_BLASTS, met: false });
    expect(kg).toEqual({ kind: 'explosive_kg', current: 40, needed: QUEST_T2_EXPLOSIVE_KG, met: false });
  });

  it('an objective is met at exactly its target (>=)', () => {
    const s = questSite();
    meetT2(s.quests!);
    expect(questObjectiveStatuses(s, getQuest(T2)!).every(x => x.met)).toBe(true);
  });

  it('an objective one short of its target is not met', () => {
    const s = questSite();
    s.quests!.cleanBlasts = QUEST_T2_CLEAN_BLASTS - 1;
    s.quests!.explosiveKg = QUEST_T2_EXPLOSIVE_KG - 0.5;
    expect(questObjectiveStatuses(s, getQuest(T2)!).some(x => x.met)).toBe(false);
  });

  it('rock_kg reads the running rock total', () => {
    const s = questSite();
    s.quests!.rockKg = 123_456;
    const rock = questObjectiveStatuses(s, getQuest(T3)!).find(x => x.kind === 'rock_kg')!;
    expect(rock.current).toBe(123_456);
    expect(rock.needed).toBe(QUEST_T3_ROCK_KG);
    expect(rock.met).toBe(false);
  });

  it('safety_score is a gauge: it reads the live safety score and follows it up and down', () => {
    const s = questSite();
    const safety = () => questObjectiveStatuses(s, getQuest(T3)!).find(x => x.kind === 'safety_score')!;
    s.scores.safety = 59;
    expect(safety()).toMatchObject({ current: 59, needed: QUEST_T3_SAFETY_SCORE, met: false });
    s.scores.safety = 60;
    expect(safety().met).toBe(true);
    s.scores.safety = 80;
    expect(safety()).toMatchObject({ current: 80, met: true });
    s.scores.safety = 10;
    expect(safety().met).toBe(false);
  });
});

describe('prerequisites and completion state (#2280 C2)', () => {
  it('a quest with no prerequisite has them met', () => {
    expect(questPrerequisitesMet(questSite(), getQuest(T2)!)).toBe(true);
  });

  it('T3 prerequisites are unmet until T2 is completed', () => {
    const s = questSite();
    expect(questPrerequisitesMet(s, getQuest(T3)!)).toBe(false);
    completeQuest(s, T2);
    expect(questPrerequisitesMet(s, getQuest(T3)!)).toBe(true);
  });

  it('isQuestCompleted reads the completed list', () => {
    const s = questSite();
    expect(isQuestCompleted(s, T2)).toBe(false);
    s.quests!.completed.push(T2);
    expect(isQuestCompleted(s, T2)).toBe(true);
    expect(isQuestCompleted(s, T3)).toBe(false);
  });

  it('isQuestCompleted is false on a site without quests and for an unknown id', () => {
    expect(isQuestCompleted(createGame({ seed: 1, mineType: 'desert' }), T2)).toBe(false);
    expect(isQuestCompleted(questSite(), 'quest_nope')).toBe(false);
  });
});

describe('advanceQuests (#2280 C5)', () => {
  it('completes nothing while objectives are short, and emits nothing', () => {
    const s = questSite();
    const emitter = new EventEmitter();
    const seen = collect(emitter);
    s.quests!.cleanBlasts = 1;
    s.quests!.explosiveKg = 500;
    expect(advanceQuests(s, emitter)).toEqual([]);
    expect(isQuestCompleted(s, T2)).toBe(false);
    expect(seen).toEqual([]);
  });

  it('completes T2 when both objectives are met, returning its id and emitting quest:completed once', () => {
    const s = questSite();
    const emitter = new EventEmitter();
    const seen = collect(emitter);
    meetT2(s.quests!);
    expect(advanceQuests(s, emitter)).toEqual([T2]);
    expect(isQuestCompleted(s, T2)).toBe(true);
    expect(isQuestCompleted(s, T3)).toBe(false);
    expect(seen).toEqual([T2]);
  });

  it('a completed quest completes only once: the next call returns nothing and emits nothing', () => {
    const s = questSite();
    const emitter = new EventEmitter();
    const seen = collect(emitter);
    meetT2(s.quests!);
    advanceQuests(s, emitter);
    expect(advanceQuests(s, emitter)).toEqual([]);
    expect(seen).toEqual([T2]);
    expect(s.quests!.completed.filter(id => id === T2)).toHaveLength(1);
  });

  it('the streak counts: one clean blast short blocks, the next one completes', () => {
    const s = questSite();
    const emitter = new EventEmitter();
    recordQuestBlast(s.quests, { explosiveKg: 60, rockKg: 1_000, flyrockIncident: false });
    expect(advanceQuests(s, emitter)).toEqual([]);
    recordQuestBlast(s.quests, { explosiveKg: 60, rockKg: 1_000, flyrockIncident: false });
    expect(advanceQuests(s, emitter)).toEqual([T2]);
  });

  it('an incident that resets the streak blocks completion even with enough explosive', () => {
    const s = questSite();
    recordQuestBlast(s.quests, { explosiveKg: 60, rockKg: 1, flyrockIncident: false });
    recordQuestBlast(s.quests, { explosiveKg: 60, rockKg: 1, flyrockIncident: true });
    expect(advanceQuests(s, new EventEmitter())).toEqual([]);
    expect(isQuestCompleted(s, T2)).toBe(false);
  });

  it('T3 never completes while T2 is open, even with its own objectives met', () => {
    const s = questSite();
    const emitter = new EventEmitter();
    const seen = collect(emitter);
    meetAll(s);
    s.quests!.explosiveKg = 0; // T2's explosive objective stays short
    expect(advanceQuests(s, emitter)).toEqual([]);
    expect(isQuestCompleted(s, T3)).toBe(false);
    expect(seen).toEqual([]);
  });

  it('T2 then T3 complete in one call, T2 first, each emitting once', () => {
    const s = questSite();
    const emitter = new EventEmitter();
    const seen = collect(emitter);
    meetAll(s);
    expect(advanceQuests(s, emitter)).toEqual([T2, T3]);
    expect(seen).toEqual([T2, T3]);
    expect(unlockedExplosiveTier(s)).toBe(3);
  });

  it('with T2 done, T3 waits on its objectives: safety score short keeps it open', () => {
    const s = questSite();
    meetAll(s);
    s.scores.safety = QUEST_T3_SAFETY_SCORE - 1;
    expect(advanceQuests(s, new EventEmitter())).toEqual([T2]);
    expect(isQuestCompleted(s, T3)).toBe(false);
    s.scores.safety = QUEST_T3_SAFETY_SCORE;
    expect(advanceQuests(s, new EventEmitter())).toEqual([T3]);
  });

  it('T3 stays open when only its rock total is short', () => {
    const s = questSite();
    meetAll(s);
    s.quests!.rockKg = QUEST_T3_ROCK_KG - 1;
    expect(advanceQuests(s, new EventEmitter())).toEqual([T2]);
    s.quests!.rockKg = QUEST_T3_ROCK_KG;
    expect(advanceQuests(s, new EventEmitter())).toEqual([T3]);
  });

  it('does nothing on a site without quests', () => {
    const s = createGame({ seed: 42, mineType: 'desert' });
    const emitter = new EventEmitter();
    const seen = collect(emitter);
    expect(advanceQuests(s, emitter)).toEqual([]);
    expect(s.quests).toBeUndefined();
    expect(seen).toEqual([]);
  });

  it('works without an emitter', () => {
    const s = questSite();
    meetT2(s.quests!);
    expect(advanceQuests(s)).toEqual([T2]);
  });

  it('the tick pipeline runs it: a met quest completes during runTick', () => {
    const s = questSite();
    meetT2(s.quests!);
    const emitter = new EventEmitter();
    const seen = collect(emitter);
    runTick(s, null, new Random(s.seed + s.tickCount), emitter, { checkInvariants: false });
    expect(isQuestCompleted(s, T2)).toBe(true);
    expect(seen).toEqual([T2]);
  });

  it('the tick pipeline does not complete a quest whose objectives are unmet', () => {
    const s = questSite();
    runTick(s, null, new Random(s.seed + s.tickCount), new EventEmitter(), { checkInvariants: false });
    expect(s.quests!.completed).toEqual([]);
  });
});

describe('a quest never reads the permit grade (#2280 C2)', () => {
  it.each([0, 1, 2, 3, 4])('T2 completes the same at grade %i', (grade) => {
    const s = questSite();
    s.grade!.grade = grade;
    meetT2(s.quests!);
    expect(advanceQuests(s, new EventEmitter())).toEqual([T2]);
  });

  it('a grade change alone completes nothing and unmet objectives stay unmet at any grade', () => {
    const s = questSite();
    s.grade!.grade = 3;
    expect(advanceQuests(s, new EventEmitter())).toEqual([]);
  });

  it('objective statuses are identical across grades', () => {
    const a = questSite();
    const b = questSite();
    b.grade!.grade = 3;
    b.grade!.tier = 3;
    for (const s of [a, b]) {
      s.quests!.cleanBlasts = 1;
      s.quests!.rockKg = 77;
      s.scores.safety = 42;
    }
    for (const def of getAllQuests()) {
      expect(questObjectiveStatuses(b, def)).toEqual(questObjectiveStatuses(a, def));
    }
  });

  it('works with no grade state at all', () => {
    const s = createGame({ seed: 42, mineType: 'desert' });
    s.quests = createQuestState();
    meetT2(s.quests);
    expect(advanceQuests(s, new EventEmitter())).toEqual([T2]);
  });
});

describe('completeQuest — the scenario shortcut (#2280 C8)', () => {
  it('completes a quest without its objectives and emits quest:completed', () => {
    const s = questSite();
    const emitter = new EventEmitter();
    const seen = collect(emitter);
    expect(completeQuest(s, T2, emitter)).toEqual({ ok: true });
    expect(isQuestCompleted(s, T2)).toBe(true);
    expect(seen).toEqual([T2]);
    expect(s.quests!.cleanBlasts).toBe(0);
  });

  it('refuses a quest already completed, without a second event', () => {
    const s = questSite();
    const emitter = new EventEmitter();
    const seen = collect(emitter);
    completeQuest(s, T2, emitter);
    expect(completeQuest(s, T2, emitter)).toEqual({ ok: false, reason: 'already' });
    expect(seen).toEqual([T2]);
  });

  it('refuses an unknown quest id', () => {
    const s = questSite();
    expect(completeQuest(s, 'quest_nope')).toEqual({ ok: false, reason: 'unknown' });
    expect(s.quests!.completed).toEqual([]);
  });

  it('refuses on a site without quests', () => {
    const s = createGame({ seed: 42, mineType: 'desert' });
    expect(completeQuest(s, T2)).toEqual({ ok: false, reason: 'no_quests' });
    expect(s.quests).toBeUndefined();
  });

  it('T3 may be completed before T2, and that does not complete T2', () => {
    const s = questSite();
    expect(completeQuest(s, T3)).toEqual({ ok: true });
    expect(isQuestCompleted(s, T3)).toBe(true);
    expect(isQuestCompleted(s, T2)).toBe(false);
  });

  it('works without an emitter', () => {
    const s = questSite();
    expect(completeQuest(s, T2)).toEqual({ ok: true });
  });
});

describe('unlockedExplosiveTier and explosiveLockedByQuest (#2280 C7)', () => {
  it('tier 1 until a quest completes', () => {
    expect(unlockedExplosiveTier(questSite())).toBe(1);
  });

  it('completing T2 opens tier 2, and T3 opens tier 3', () => {
    const s = questSite();
    completeQuest(s, T2);
    expect(unlockedExplosiveTier(s)).toBe(2);
    completeQuest(s, T3);
    expect(unlockedExplosiveTier(s)).toBe(3);
  });

  it('every tier-1 explosive is never locked', () => {
    const s = questSite();
    for (const e of explosivesOfTier(1)) expect(explosiveLockedByQuest(s, e.id), e.id).toBeNull();
  });

  it('every tier-2 explosive is locked by the T2 quest until it completes', () => {
    const s = questSite();
    for (const e of explosivesOfTier(2)) expect(explosiveLockedByQuest(s, e.id)?.id, e.id).toBe(T2);
    completeQuest(s, T2);
    for (const e of explosivesOfTier(2)) expect(explosiveLockedByQuest(s, e.id), e.id).toBeNull();
  });

  it('every tier-3 explosive is locked by the T3 quest, T2 done or not', () => {
    const s = questSite();
    for (const e of explosivesOfTier(3)) expect(explosiveLockedByQuest(s, e.id)?.id, e.id).toBe(T3);
    completeQuest(s, T2);
    for (const e of explosivesOfTier(3)) expect(explosiveLockedByQuest(s, e.id)?.id, e.id).toBe(T3);
    completeQuest(s, T3);
    for (const e of explosivesOfTier(3)) expect(explosiveLockedByQuest(s, e.id), e.id).toBeNull();
  });

  it('a site without quests has nothing locked by a quest', () => {
    const s = createGame({ seed: 1, mineType: 'desert' });
    for (const e of getAllExplosives()) expect(explosiveLockedByQuest(s, e.id), e.id).toBeNull();
  });

  it('an unknown explosive id is not locked by a quest', () => {
    expect(explosiveLockedByQuest(questSite(), 'nope')).toBeNull();
  });
});

describe('explosive availability on progression and other sites (#2280 C7)', () => {
  it('a progression site offers tier 1 only at the start', () => {
    const s = questSite();
    expect([...resolveExplosivesFor(s)].sort()).toEqual(ids(explosivesOfTier(1)).sort());
  });

  it('T2 completed adds the tier-2 explosives and not tier 3', () => {
    const s = questSite();
    completeQuest(s, T2);
    expect([...resolveExplosivesFor(s)].sort()).toEqual([...ids(explosivesOfTier(1)), ...ids(explosivesOfTier(2))].sort());
  });

  it('both quests completed offer the full catalog', () => {
    const s = questSite();
    completeQuest(s, T2);
    completeQuest(s, T3);
    expect([...resolveExplosivesFor(s)].sort()).toEqual(ids(getAllExplosives()).sort());
  });

  it('the progression site ignores the level availableExplosives list', () => {
    const s = questSite();
    s.campaign.activeLevelId = null;
    expect([...resolveExplosivesFor(s)].sort()).toEqual(ids(explosivesOfTier(1)).sort());
  });

  it('a non-progression site keeps its level list', () => {
    const s = createGame({ seed: 42, mineType: 'desert' });
    s.campaign.activeLevelId = 'dusty_hollow';
    expect([...resolveExplosivesFor(s)]).toEqual([...resolveAvailableExplosives('dusty_hollow')]);
    s.campaign.activeLevelId = null;
    expect([...resolveExplosivesFor(s)]).toEqual([...resolveAvailableExplosives(null)]);
    expect(resolveExplosivesFor(s)).toHaveLength(getAllExplosives().length);
  });

  it('isExplosiveAvailableFor: locked until the quest completes on a progression site', () => {
    const s = questSite();
    expect(isExplosiveAvailableFor(s, 'boomite')).toBe(true);
    expect(isExplosiveAvailableFor(s, 'big_bada_boom')).toBe(false);
    expect(isExplosiveAvailableFor(s, 'obliviax')).toBe(false);
    completeQuest(s, T2);
    expect(isExplosiveAvailableFor(s, 'big_bada_boom')).toBe(true);
    expect(isExplosiveAvailableFor(s, 'obliviax')).toBe(false);
  });

  it('isExplosiveAvailableFor on a non-progression site follows the level list', () => {
    const s = createGame({ seed: 42, mineType: 'desert' });
    s.campaign.activeLevelId = 'dusty_hollow';
    expect(isExplosiveAvailableFor(s, 'krackle')).toBe(true);
    expect(isExplosiveAvailableFor(s, 'dynatomics')).toBe(false);
  });

  it('isExplosiveAvailableFor rejects an unknown id', () => {
    expect(isExplosiveAvailableFor(questSite(), 'nope')).toBe(false);
  });

  it('the charge optimizer offers only the unlocked explosives', () => {
    const s = questSite();
    expect([...optimizerOptionsFor(s).explosiveIds!].sort()).toEqual(ids(explosivesOfTier(1)).sort());
    completeQuest(s, T2);
    expect(optimizerOptionsFor(s).explosiveIds).toContain('big_bada_boom');
    expect(optimizerOptionsFor(s).explosiveIds).not.toContain('obliviax');
  });

  it('a pattern charge of a locked explosive is cleared, not ordered', () => {
    const s = questSite();
    s.patternCharge = { explosiveId: 'big_bada_boom', amountKg: 5, stemmingM: 2 };
    const hole = { id: 'H1', x: 10, z: 10, depth: 8, diameter: 0.089 };
    expect(autoChargeHole(s, hole)).toBe('skipped');
    expect(s.patternCharge).toBeNull();
    expect(s.plannedChargesByHole['H1']).toBeUndefined();
  });

  it('chargePatternHoles drops a locked pattern the same way', () => {
    const s = questSite();
    s.patternCharge = { explosiveId: 'dynatomics', amountKg: 5, stemmingM: 2 };
    const hole = { id: 'H1', x: 10, z: 10, depth: 8, diameter: 0.089 };
    expect(chargePatternHoles(s, [hole]).ordered).toEqual([]);
    expect(s.patternCharge).toBeNull();
  });

  it('a pattern charge of an unlocked explosive is ordered', () => {
    const s = questSite();
    completeQuest(s, T2);
    s.patternCharge = { explosiveId: 'big_bada_boom', amountKg: 5, stemmingM: 2 };
    const hole = { id: 'H1', x: 10, z: 10, depth: 8, diameter: 0.089 };
    expect(autoChargeHole(s, hole)).toBe('ordered');
    expect(s.plannedChargesByHole['H1']?.explosiveId).toBe('big_bada_boom');
  });
});

describe('sanitizeQuestState (#2280 C6)', () => {
  it('round-trips a valid state', () => {
    const q: QuestState = { completed: [T2], cleanBlasts: 3, explosiveKg: 120.5, rockKg: 9_999 };
    expect(sanitizeQuestState(q)).toEqual(q);
  });

  it('drops unknown quest ids and keeps the known ones', () => {
    const out = sanitizeQuestState({ completed: [T2, 'quest_nope'], cleanBlasts: 0, explosiveKg: 0, rockKg: 0 });
    expect(out?.completed).toEqual([T2]);
  });

  it.each([undefined, null, 7, 'quests', [], true])('a non-object (%s) is rejected', (raw) => {
    expect(sanitizeQuestState(raw)).toBeUndefined();
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, 'many'])('a bad counter (%s) never survives', (bad) => {
    const out = sanitizeQuestState({ completed: [], cleanBlasts: bad, explosiveKg: 5, rockKg: 5 });
    if (out) {
      expect(Number.isFinite(out.cleanBlasts)).toBe(true);
      expect(out.cleanBlasts).toBeGreaterThanOrEqual(0);
      expect(out.cleanBlasts).not.toBe(bad);
    }
  });

  it.each(['explosiveKg', 'rockKg'] as const)('a negative %s never survives', (field) => {
    const out = sanitizeQuestState({ completed: [], cleanBlasts: 1, explosiveKg: 5, rockKg: 5, [field]: -10 });
    if (out) expect(out[field]).toBeGreaterThanOrEqual(0);
  });
});

describe('quest state in saves (#2280 C6)', () => {
  function progressionSave(): GameState {
    const s = createGame({ seed: 42, mineType: 'desert' });
    s.grade = createGradeState();
    s.quests = { completed: [T2], cleanBlasts: 3, explosiveKg: 250.5, rockKg: 12_345 };
    return s;
  }

  it('round-trips completed quests and every counter', () => {
    const loaded = deserialize(serialize(progressionSave()));
    expect(loaded.quests).toEqual({ completed: [T2], cleanBlasts: 3, explosiveKg: 250.5, rockKg: 12_345 });
  });

  it('a fresh quest state round-trips', () => {
    const s = createGame({ seed: 42, mineType: 'desert' });
    s.grade = createGradeState();
    s.quests = createQuestState();
    expect(deserialize(serialize(s)).quests).toEqual(createQuestState());
  });

  it('a non-progression save carries no quests', () => {
    const loaded = deserialize(serialize(createGame({ seed: 42, mineType: 'desert' })));
    expect(loaded.quests).toBeUndefined();
    expect(loaded.grade).toBeUndefined();
  });

  it('a progression save with no quests (written before quests existed) loads a fresh state', () => {
    const parsed = JSON.parse(serialize(progressionSave())) as Record<string, unknown>;
    delete parsed['quests'];
    const loaded = deserialize(JSON.stringify(parsed));
    expect(loaded.grade).toBeDefined();
    expect(loaded.quests).toEqual(createQuestState());
  });

  it.each([null, 'garbage', 12, [], { completed: 'yes' }])('a progression save with invalid quests (%j) loads a fresh state', (bad) => {
    const parsed = JSON.parse(serialize(progressionSave())) as Record<string, unknown>;
    parsed['quests'] = bad;
    const loaded = deserialize(JSON.stringify(parsed));
    expect(loaded.quests).toEqual(createQuestState());
  });

  it('unknown quest ids in a save are dropped on load', () => {
    const parsed = JSON.parse(serialize(progressionSave())) as Record<string, unknown>;
    (parsed['quests'] as QuestState).completed = [T2, 'quest_from_the_future'];
    expect(deserialize(JSON.stringify(parsed)).quests!.completed).toEqual([T2]);
  });

  it('a negative or non-finite counter never loads as such', () => {
    const parsed = JSON.parse(serialize(progressionSave())) as Record<string, unknown>;
    (parsed['quests'] as Record<string, unknown>)['explosiveKg'] = -5;
    (parsed['quests'] as Record<string, unknown>)['rockKg'] = 'lots';
    const q = deserialize(JSON.stringify(parsed)).quests!;
    expect(q).toBeDefined();
    expect(q.explosiveKg).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(q.rockKg)).toBe(true);
    expect(q.rockKg).toBeGreaterThanOrEqual(0);
  });

  it('a quest state in a save without a ladder is dropped (quests exist only on progression sites)', () => {
    const s = createGame({ seed: 42, mineType: 'desert' });
    s.quests = createQuestState();
    expect(deserialize(serialize(s)).quests).toBeUndefined();
  });
});

describe('where quest state is created (#2280 C6)', () => {
  it('a sandbox start creates quest state with the ladder', () => {
    const { runner, ctx } = createRunner();
    expect(runner.run('sandbox start biome:desert_badlands seed:42').success).toBe(true);
    expect(ctx.state!.grade).toBeDefined();
    expect(ctx.state!.quests).toEqual(createQuestState());
  });

  it('a new_game site without a ladder has no quest state', () => {
    const { runner, ctx } = createRunner();
    expect(runner.run('new_game mine_type:desert seed:42').success).toBe(true);
    expect(ctx.state!.grade).toBeUndefined();
    expect(ctx.state!.quests).toBeUndefined();
  });
});

describe('quest state on a campaign level (#2280 C6)', () => {
  it('a level that opts in to progression starts with quest state', () => {
    const campaign = createCampaignState();
    campaign.levels['shareholder_summit']!.unlocked = true;
    const state = createGameForLevel(campaign, 'shareholder_summit')!;
    expect(state.grade).toBeDefined();
    expect(state.quests).toEqual(createQuestState());
  });

  it('a level without progression has no quest state', () => {
    const state = createGameForLevel(createCampaignState(), 'dusty_hollow')!;
    expect(state.grade).toBeUndefined();
    expect(state.quests).toBeUndefined();
  });
});
