/** Inspector research section for the Research Center. */
import { t } from '../../../core/i18n/I18n.js';
import { formatMoney } from '../../../core/economy/formatMoney.js';
import { isOperating, type Building, type ResearchTask } from '../../../core/entities/Building.js';
import { getResearchProgress } from '../../../core/entities/BuildingResearch.js';
import type { GameState } from '../../../core/state/GameState.js';
import { liveLine, sectionOf, setLive, type InspectorSection } from './inspectorWidgets.js';

const targetName = (task: ResearchTask): string => t(`building.${task.targetType}.t${task.targetTier}.name`);

const runningText = (task: ResearchTask): string =>
  t('inspector.research_running', {
    name: targetName(task),
    percent: Math.round(getResearchProgress(task).fraction * 100),
    remaining: task.ticksRemaining,
  });

const pendingText = (task: ResearchTask): string =>
  t('inspector.research_pending', { name: targetName(task), cost: formatMoney(task.cost) });

/** Research progress of a Research Center, or null for any other building. */
export function researchSection(b: Building, state: GameState): InspectorSection | null {
  if (b.type !== 'research_center') return null;
  const queue = state.buildings.researchQueue;
  const paused = queue.length > 0 && !isOperating(b);
  const rows: HTMLElement[] = [];
  if (queue.length === 0) rows.push(liveLine('research-idle', t('inspector.research_idle')));
  else rows.push(liveLine('research-running', runningText(queue[0]!)));
  queue.slice(1).forEach((task, i) => rows.push(liveLine(`research-pending${i}`, pendingText(task))));
  if (paused) rows.push(liveLine('research-paused', t('inspector.research_paused')));
  const section = sectionOf(t('inspector.section.research'), rows);
  return {
    section,
    rowSignature: `research:${queue.map(q => `${q.targetType}${q.targetTier}`).join(',')}:${paused ? 'paused' : 'run'}`,
    sync(root) {
      const head = state.buildings.researchQueue[0];
      if (head) setLive(root, 'research-running', runningText(head));
    },
  };
}
