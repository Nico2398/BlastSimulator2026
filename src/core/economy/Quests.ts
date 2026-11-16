// BlastSimulator2026 — Quest system (#2280)
// One lock per unlock: the permit grade opens zones, ores and tier 1; quests open the higher tiers.
// A quest is data (QuestCatalog); objectives are measured from game state and blast events.
// A quest never reads the permit grade.

import type { GameState } from '../state/GameState.js';
import type { EventEmitter } from '../state/EventEmitter.js';
import { isSingleTierType, type BuildingType, type BuildingTier } from '../entities/Building.js';
import { getBedCapacity } from '../entities/BuildingWellbeing.js';
import { getExplosive, type ExplosiveTier } from '../world/ExplosiveCatalog.js';
import { getAllQuests, getQuest } from './QuestCatalog.js';

type QuestObjectiveKind =
  'clean_blasts' | 'explosive_kg' | 'rock_kg' | 'safety_score' | 'buildings_built' | 'crew_housed';

interface QuestObjectiveDef {
  kind: QuestObjectiveKind;
  target: number;
}

/** What completing a quest makes purchasable. */
export type QuestReward =
  | { kind: 'explosive_tier'; tier: ExplosiveTier }
  | { kind: 'building_tier'; tier: 2 | 3 };

export interface QuestDef {
  id: string;
  /** Locale key of the satirical character who gives the quest. */
  giverKey: string;
  titleKey: string;
  pitchKey: string;
  objectives: readonly QuestObjectiveDef[];
  reward: QuestReward;
  /** Quest ids that must be completed first. */
  requires?: readonly string[];
}

export interface QuestState {
  /** Ids of completed quests. */
  completed: string[];
  /** Blasts in a row fired with no flyrock impact. */
  cleanBlasts: number;
  /** Running total of explosive detonated, kg. */
  explosiveKg: number;
  /** Running total of rock broken, kg. */
  rockKg: number;
}

export interface QuestObjectiveStatus {
  kind: QuestObjectiveKind;
  current: number;
  needed: number;
  met: boolean;
}

type CompleteQuestResult = { ok: true } | { ok: false; reason: 'no_quests' | 'unknown' | 'already' };

export function createQuestState(): QuestState {
  return { completed: [], cleanBlasts: 0, explosiveKg: 0, rockKg: 0 };
}

function isCount(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

/** Validate a loaded quest sub-state; undefined when malformed. Unknown or repeated quest ids are dropped; a non-finite or negative counter reads 0. */
export function sanitizeQuestState(raw: unknown): QuestState | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const { completed, cleanBlasts, explosiveKg, rockKg } = raw as Record<string, unknown>;
  if (!Array.isArray(completed)) return undefined;
  const known = completed.filter(
    (id, i): id is string => typeof id === 'string' && getQuest(id) !== undefined && completed.indexOf(id) === i,
  );
  const count = (v: unknown): number => (isCount(v) ? v : 0);
  return { completed: known, cleanBlasts: count(cleanBlasts), explosiveKg: count(explosiveKg), rockKg: count(rockKg) };
}

/** Counters live on the quest state; the safety score is read from the site. */
function objectiveProgress(state: GameState, kind: QuestObjectiveKind): number {
  const q = state.quests;
  switch (kind) {
    case 'clean_blasts': return q?.cleanBlasts ?? 0;
    case 'explosive_kg': return q?.explosiveKg ?? 0;
    case 'rock_kg': return q?.rockKg ?? 0;
    case 'safety_score': return state.scores.safety;
    case 'buildings_built': return state.buildings.buildings.length;
    case 'crew_housed': return Math.min(state.employees.employees.length, getBedCapacity(state.buildings));
  }
}

export function questObjectiveStatuses(state: GameState, def: QuestDef): QuestObjectiveStatus[] {
  return def.objectives.map(o => {
    const current = objectiveProgress(state, o.kind);
    return { kind: o.kind, current, needed: o.target, met: current >= o.target };
  });
}

export function isQuestCompleted(state: Pick<GameState, 'quests'>, questId: string): boolean {
  return state.quests?.completed.includes(questId) ?? false;
}

export function questPrerequisitesMet(state: GameState, def: QuestDef): boolean {
  return (def.requires ?? []).every(id => isQuestCompleted(state, id));
}

/** Book one fired blast. No-op without quest state. */
export function recordQuestBlast(
  quests: QuestState | undefined,
  blast: { explosiveKg: number; rockKg: number; flyrockIncident: boolean },
): void {
  if (!quests) return;
  quests.cleanBlasts = blast.flyrockIncident ? 0 : quests.cleanBlasts + 1;
  if (blast.explosiveKg > 0) quests.explosiveKg += blast.explosiveKg;
  if (blast.rockKg > 0) quests.rockKg += blast.rockKg;
}

/** Complete every quest whose prerequisites and objectives are met; emits `quest:completed` per quest; returns their ids. */
export function advanceQuests(state: GameState, emitter?: Pick<EventEmitter, 'emit'>): string[] {
  const quests = state.quests;
  if (!quests) return [];
  const done: string[] = [];
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const def of getAllQuests()) {
      if (isQuestCompleted(state, def.id) || !questPrerequisitesMet(state, def)) continue;
      if (!questObjectiveStatuses(state, def).every(o => o.met)) continue;
      quests.completed.push(def.id);
      done.push(def.id);
      emitter?.emit('quest:completed', { questId: def.id });
      progressed = true;
    }
  }
  return done;
}

/** Scenario shortcut: mark a quest completed without its objectives. */
export function completeQuest(state: GameState, questId: string, emitter?: Pick<EventEmitter, 'emit'>): CompleteQuestResult {
  if (!state.quests) return { ok: false, reason: 'no_quests' };
  if (!getQuest(questId)) return { ok: false, reason: 'unknown' };
  if (isQuestCompleted(state, questId)) return { ok: false, reason: 'already' };
  state.quests.completed.push(questId);
  emitter?.emit('quest:completed', { questId });
  return { ok: true };
}

/** The quest whose reward opens `tier`, if any. */
function questForTier(tier: ExplosiveTier): QuestDef | undefined {
  return getAllQuests().find(q => q.reward.kind === 'explosive_tier' && q.reward.tier === tier);
}

/** The quest whose reward opens building `tier`, if any. */
function questForBuildingTier(tier: 2 | 3): QuestDef | undefined {
  return getAllQuests().find(q => q.reward.kind === 'building_tier' && q.reward.tier === tier);
}

/** Highest explosive tier the site may buy: 1, plus the tiers whose quest is completed. */
export function unlockedExplosiveTier(state: Pick<GameState, 'quests'>): ExplosiveTier {
  let top: ExplosiveTier = 1;
  for (const tier of [2, 3] as const) {
    const q = questForTier(tier);
    if (q && isQuestCompleted(state, q.id)) top = tier;
  }
  return top;
}

/** The open quest gating an explosive on a quest site; null when it is available or the site has no quests. */
export function explosiveLockedByQuest(state: Pick<GameState, 'quests'>, explosiveId: string): QuestDef | null {
  if (!state.quests) return null;
  const tier = getExplosive(explosiveId)?.tier;
  if (tier === undefined || tier === 1) return null;
  const q = questForTier(tier);
  return q && !isQuestCompleted(state, q.id) ? q : null;
}

/** The open quest gating `tier` of a building type; null when it is unlocked or the site has no quests. */
export function buildingTierLockedByQuest(
  state: Pick<GameState, 'buildings' | 'quests'>, type: BuildingType, tier: BuildingTier,
): QuestDef | null {
  if (!state.quests || tier === 1 || isSingleTierType(type)) return null;
  if ((state.buildings.unlockedTiers[type] ?? 1) >= tier) return null;
  const q = questForBuildingTier(tier);
  return q && !isQuestCompleted(state, q.id) ? q : null;
}

/** Whether `tier` of a building type may be ordered: tier 1 always, never above 1 for a single-tier type, every tier on a site without quests. */
export function isBuildingTierUnlocked(
  state: Pick<GameState, 'buildings' | 'quests'>, type: BuildingType, tier: BuildingTier,
): boolean {
  if (tier === 1) return true;
  if (isSingleTierType(type)) return false;
  return buildingTierLockedByQuest(state, type, tier) === null;
}
