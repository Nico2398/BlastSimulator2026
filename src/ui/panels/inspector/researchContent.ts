/** Inspector research section for the Research Center. */
import { t } from '../../../core/i18n/I18n.js';
import { formatMoney } from '../../../core/economy/formatMoney.js';
import { isOperating, type Building, type ResearchTask } from '../../../core/entities/Building.js';
import { getResearchProgress } from '../../../core/entities/BuildingResearch.js';
import type { GameState } from '../../../core/state/GameState.js';
import { el } from '../../dom.js';
import { markLive, sectionOf, setLive } from './inspectorWidgets.js';

/** A research section plus its live-sync hook. */
interface ResearchSection {
  readonly section: HTMLElement;
  /** Names the row set: when it changes the section must be rebuilt, not synced in place. */
  readonly rowSignature: string;
  readonly sync: (root: HTMLElement) => void;
}

const targetName = (task: ResearchTask): string => t(`building.${task.targetType}.t${task.targetTier}.name`);

const runningText = (task: ResearchTask): string =>
  t('inspector.research_running', {
    name: targetName(task),
    percent: Math.round(getResearchProgress(task).fraction * 100),
    remaining: task.ticksRemaining,
  });

const pendingText = (task: ResearchTask): string =>
  t('inspector.research_pending', { name: targetName(task), cost: formatMoney(task.cost) });

function line(key: string, text: string): HTMLElement {
  const node = markLive(el('div', { text, className: 'bsx-mono' }), key);
  node.style.fontSize = '11px';
  return node;
}

/** Research progress of a Research Center, or null for any other building. */
export function researchSection(b: Building, state: GameState): ResearchSection | null {
  if (b.type !== 'research_center') return null;
  const queue = state.buildings.researchQueue;
  const paused = queue.length > 0 && !isOperating(b);
  const rows: HTMLElement[] = [];
  if (queue.length === 0) rows.push(line('research-idle', t('inspector.research_idle')));
  else rows.push(line('research-running', runningText(queue[0]!)));
  queue.slice(1).forEach((task, i) => rows.push(line(`research-pending${i}`, pendingText(task))));
  if (paused) rows.push(line('research-paused', t('inspector.research_paused')));
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
