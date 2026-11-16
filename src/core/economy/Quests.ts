// BlastSimulator2026 — Quest system (#2280)
// One lock per unlock: the permit grade opens zones, ores and tier 1; quests open the higher tiers.
// A quest is data (QuestCatalog); objectives are measured from game state and blast events.
// A quest never reads the permit grade.

import type { GameState } from '../state/GameState.js';
import type { EventEmitter } from '../state/EventEmitter.js';
import type { ExplosiveTier } from '../world/ExplosiveCatalog.js';

export type QuestObjectiveKind = 'clean_blasts' | 'explosive_kg' | 'rock_kg' | 'safety_score';

export interface QuestObjectiveDef {
  kind: QuestObjectiveKind;
  target: number;
}

/** What completing a quest makes purchasable. */
export interface QuestReward {
  kind: 'explosive_tier';
  tier: ExplosiveTier;
}

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

export type CompleteQuestResult = { ok: true } | { ok: false; reason: 'no_quests' | 'unknown' | 'already' };

export function createQuestState(): QuestState {
  throw new Error('not implemented');
}

/** Validate a loaded quest sub-state; undefined when malformed. */
export function sanitizeQuestState(_raw: unknown): QuestState | undefined {
  throw new Error('not implemented');
}

export function questObjectiveStatuses(_state: GameState, _def: QuestDef): QuestObjectiveStatus[] {
  throw new Error('not implemented');
}

export function isQuestCompleted(_state: GameState, _questId: string): boolean {
  throw new Error('not implemented');
}

export function questPrerequisitesMet(_state: GameState, _def: QuestDef): boolean {
  throw new Error('not implemented');
}

/** Book one fired blast. No-op without quest state. */
export function recordQuestBlast(
  _quests: QuestState | undefined,
  _blast: { explosiveKg: number; rockKg: number; flyrockIncident: boolean },
): void {
  throw new Error('not implemented');
}

/** Complete every quest whose prerequisites and objectives are met; emits `quest:completed` per quest; returns their ids. */
export function advanceQuests(_state: GameState, _emitter?: Pick<EventEmitter, 'emit'>): string[] {
  throw new Error('not implemented');
}

/** Scenario shortcut: mark a quest completed without its objectives. */
export function completeQuest(_state: GameState, _questId: string, _emitter?: Pick<EventEmitter, 'emit'>): CompleteQuestResult {
  throw new Error('not implemented');
}

/** Highest explosive tier the site may buy: 1, plus the tiers whose quest is completed. */
export function unlockedExplosiveTier(_state: GameState): ExplosiveTier {
  throw new Error('not implemented');
}

/** The open quest gating an explosive on a quest site; null when it is available or the site has no quests. */
export function explosiveLockedByQuest(_state: GameState, _explosiveId: string): QuestDef | null {
  throw new Error('not implemented');
}
