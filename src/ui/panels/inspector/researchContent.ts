/** Inspector research section for the Research Center. */
import { t } from '../../../core/i18n/I18n.js';
import { formatMoney } from '../../../core/economy/formatMoney.js';
import { isOperating, type Building, type ResearchTask } from '../../../core/entities/Building.js';
import { getActiveResearchTasks, getResearchCenterProfile, getResearchProgress, getResearchTicksRemaining } from '../../../core/entities/BuildingResearch.js';
import type { GameState } from '../../../core/state/GameState.js';
import { liveLine, sectionOf, setLive, type InspectorSection } from './inspectorWidgets.js';

const targetName = (task: ResearchTask): string => t(`building.${task.targetType}.t${task.targetTier}.name`);

const runningText = (task: ResearchTask): string =>
  t('inspector.research_running', {
    name: targetName(task),
    percent: Math.round(getResearchProgress(task).fraction * 100),
    remaining: getResearchTicksRemaining(task),
  });

const pendingText = (task: ResearchTask): string =>
  t('inspector.research_pending', { name: targetName(task), cost: formatMoney(task.cost) });

const speedText = (state: GameState): string => {
  const profile = getResearchCenterProfile(state.buildings);
  return t('inspector.research_speed', { speed: profile?.speed ?? 0, slots: profile?.slots ?? 0 });
};

/** Research progress of a Research Center, or null for any other building. */
export function researchSection(b: Building, state: GameState): InspectorSection | null {
  if (b.type !== 'research_center') return null;
  const queue = state.buildings.researchQueue;
  const paused = queue.length > 0 && !isOperating(b);
  const activeCount = Math.max(1, getActiveResearchTasks(state.buildings).length);
  const rows: HTMLElement[] = [];
  if (queue.length === 0) rows.push(liveLine('research-idle', t('inspector.research_idle')));
  queue.slice(0, activeCount).forEach((task, i) => rows.push(liveLine(`research-running${i}`, runningText(task))));
  queue.slice(activeCount).forEach((task, i) => rows.push(liveLine(`research-pending${i}`, pendingText(task))));
  rows.push(liveLine('research-speed', speedText(state)));
  if (paused) rows.push(liveLine('research-paused', t('inspector.research_paused')));
  const section = sectionOf(t('inspector.section.research'), rows);
  return {
    section,
    rowSignature: `research:${activeCount}:${queue.map(q => `${q.targetType}${q.targetTier}`).join(',')}:${paused ? 'paused' : 'run'}`,
    sync(root) {
      getActiveResearchTasks(state.buildings).forEach((task, i) => setLive(root, `research-running${i}`, runningText(task)));
      setLive(root, 'research-speed', speedText(state));
    },
  };
}
