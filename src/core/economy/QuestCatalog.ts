// BlastSimulator2026 — Quest catalog (#2280)
// Quests are data: a new quest is an addition here, with its locale strings.

import type { QuestDef } from './Quests.js';
import {
  QUEST_T2_CLEAN_BLASTS, QUEST_T2_EXPLOSIVE_KG,
  QUEST_T3_CLEAN_BLASTS, QUEST_T3_ROCK_KG, QUEST_T3_SAFETY_SCORE,
  QUEST_BUILDING_T2_BUILDINGS, QUEST_BUILDING_T2_CREW_HOUSED,
  QUEST_BUILDING_T3_BUILDINGS, QUEST_BUILDING_T3_CREW_HOUSED, QUEST_BUILDING_T3_SAFETY_SCORE,
} from '../config/balance.js';

const QUESTS: readonly QuestDef[] = [
  {
    id: 'quest_explosive_t2',
    giverKey: 'quest.giver.supplier',
    titleKey: 'quest.explosive_t2.title',
    pitchKey: 'quest.explosive_t2.pitch',
    objectives: [
      { kind: 'clean_blasts', target: QUEST_T2_CLEAN_BLASTS },
      { kind: 'explosive_kg', target: QUEST_T2_EXPLOSIVE_KG },
    ],
    reward: { kind: 'explosive_tier', tier: 2 },
  },
  {
    id: 'quest_explosive_t3',
    giverKey: 'quest.giver.supplier',
    titleKey: 'quest.explosive_t3.title',
    pitchKey: 'quest.explosive_t3.pitch',
    objectives: [
      { kind: 'clean_blasts', target: QUEST_T3_CLEAN_BLASTS },
      { kind: 'rock_kg', target: QUEST_T3_ROCK_KG },
      { kind: 'safety_score', target: QUEST_T3_SAFETY_SCORE },
    ],
    reward: { kind: 'explosive_tier', tier: 3 },
    requires: ['quest_explosive_t2'],
  },
  {
    id: 'quest_building_t2',
    giverKey: 'quest.giver.architect',
    titleKey: 'quest.building_t2.title',
    pitchKey: 'quest.building_t2.pitch',
    objectives: [
      { kind: 'buildings_built', target: QUEST_BUILDING_T2_BUILDINGS },
      { kind: 'crew_housed', target: QUEST_BUILDING_T2_CREW_HOUSED },
    ],
    reward: { kind: 'building_tier', tier: 2 },
  },
  {
    id: 'quest_building_t3',
    giverKey: 'quest.giver.architect',
    titleKey: 'quest.building_t3.title',
    pitchKey: 'quest.building_t3.pitch',
    objectives: [
      { kind: 'buildings_built', target: QUEST_BUILDING_T3_BUILDINGS },
      { kind: 'crew_housed', target: QUEST_BUILDING_T3_CREW_HOUSED },
      { kind: 'safety_score', target: QUEST_BUILDING_T3_SAFETY_SCORE },
    ],
    reward: { kind: 'building_tier', tier: 3 },
    requires: ['quest_building_t2'],
  },
];

export function getAllQuests(): readonly QuestDef[] {
  return QUESTS;
}

export function getQuest(id: string): QuestDef | undefined {
  return QUESTS.find(q => q.id === id);
}
