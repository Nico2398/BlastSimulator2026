// BlastSimulator2026 — Console command: quest list|detail|complete (#2280)

import type { CommandResult } from '../ConsoleRunner.js';
import type { GameContext } from './world.js';
import { t } from '../../core/i18n/I18n.js';
import { requireGame } from './commandUtils.js';
import { getAllQuests, getQuest } from '../../core/economy/QuestCatalog.js';
import {
  completeQuest, isQuestCompleted, unlockedExplosiveTier, questObjectiveStatuses, questPrerequisitesMet,
  type QuestDef, type QuestObjectiveStatus,
  questRewardLine,
} from '../../core/economy/Quests.js';
import { formatGradeAmount } from '../../core/economy/MineGrade.js';
import type { GameState } from '../../core/state/GameState.js';

function objectiveLine(o: QuestObjectiveStatus): string {
  const text = t(`quest.objective.${o.kind}`, { current: formatGradeAmount(o.current), needed: formatGradeAmount(o.needed) });
  return `  [${o.met ? 'x' : ' '}] ${text}`;
}

function statusOf(state: GameState, def: QuestDef): string {
  return t(isQuestCompleted(state, def.id) ? 'quest.status.completed' : 'quest.status.available');
}

function rewardLine(def: QuestDef): string {
  return questRewardLine(def);
}

function questList(state: GameState): CommandResult {
  const lines = getAllQuests().flatMap(def => [
    `${def.id}: ${t(def.titleKey)} [${statusOf(state, def)}]`,
    ...questObjectiveStatuses(state, def).map(objectiveLine),
  ]);
  return { success: true, output: [t('quest.list.header'), ...lines, t('quest.list.tier', { tier: unlockedExplosiveTier(state) })].join('\n') };
}

function questDetail(state: GameState, id: string | undefined): CommandResult {
  const def = id ? getQuest(id) : undefined;
  if (!def) return { success: false, output: t('quest.unknown', { id: id ?? '' }) };
  const lines = [
    `${def.id}: ${t(def.titleKey)} [${statusOf(state, def)}]`,
    t('quest.detail.giver', { giver: t(def.giverKey) }),
    t(def.pitchKey),
    ...questObjectiveStatuses(state, def).map(objectiveLine),
    rewardLine(def),
  ];
  const missing = (def.requires ?? []).filter(r => !isQuestCompleted(state, r)).map(r => t(getQuest(r)?.titleKey ?? r));
  if (!questPrerequisitesMet(state, def)) lines.push(t('quest.detail.requires', { quests: missing.join(', ') }));
  return { success: true, output: lines.join('\n') };
}

function questComplete(ctx: GameContext, id: string | undefined): CommandResult {
  const state = ctx.state!;
  const def = id ? getQuest(id) : undefined;
  if (!def) return { success: false, output: t('quest.unknown', { id: id ?? '' }) };
  const result = completeQuest(state, def.id, ctx.emitter);
  if (result.ok) return { success: true, output: t('quest.complete.success', { title: t(def.titleKey) }) };
  return { success: false, output: t(`quest.complete.${result.reason}`, { title: t(def.titleKey) }) };
}

/** `quest list`, `quest detail <id>`, `quest complete <id>` (scenario-only shortcut). */
export function questCommand(
  ctx: GameContext,
  args: string[],
  _named: Record<string, string>,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return err;
  const state = ctx.state!;
  if (!state.quests) return { success: false, output: t('quest.no_quests') };
  switch (args[0]) {
    case 'list': return questList(state);
    case 'detail': return questDetail(state, args[1]);
    case 'complete': return questComplete(ctx, args[1]);
    default: return { success: false, output: t('quest.usage') };
  }
}
