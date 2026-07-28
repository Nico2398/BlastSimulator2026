// BlastSimulator2026 — Employee detail renderers
// Skills, XP, need bars, and the task queue shown when a roster row is expanded.
// Split out of EmployeePanel to keep both files within the file-size limit.

import { t } from '../core/i18n/I18n.js';
import type { GameState } from '../core/state/GameState.js';
import type { Employee } from '../core/entities/Employee.js';
import { XP_THRESHOLDS } from '../core/config/balance.js';

/**
 * Class names an employee roster row should carry for its current state
 * (e.g. `collapsing` while a need has driven the employee to a stop).
 * Extracted so a unit test can assert the class independent of DOM
 * construction and of whatever CSS rule renders it.
 */
export function getEmployeeRowClassNames(_e: Employee): string[] {
  // TODO: implement
  return [];
}

export function makeSkillStars(level: number): string {
  const filled = '★'.repeat(level);
  const empty = '☆'.repeat(5 - level);
  return filled + empty;
}

export function makeSkillSection(e: Employee): HTMLElement {
  const el = document.createElement('div');

  if (e.qualifications.length === 0) {
    const msg = document.createElement('div');
    msg.textContent = t('ui.employees.no_skills');
    el.appendChild(msg);
    return el;
  }

  for (const q of e.qualifications) {
    const row = document.createElement('div');
    row.className = 'bs-skill-row';

    const catEl = document.createElement('span');
    catEl.className = 'bs-skill-category';
    catEl.textContent = q.category;

    const starsEl = document.createElement('span');
    starsEl.className = 'bs-skill-stars';
    starsEl.textContent = makeSkillStars(q.proficiencyLevel);

    const xpBar = makeXpBar(q.xp, q.proficiencyLevel);

    row.append(catEl, starsEl, xpBar);
    el.appendChild(row);
  }
  return el;
}

export function makeXpBar(xp: number, level: number): HTMLElement {
  const el = document.createElement('div');
  el.className = 'bs-xp-bar-bg';

  const fill = document.createElement('div');
  fill.className = 'bs-xp-bar-fill';

  const currentThreshold = XP_THRESHOLDS[level as keyof typeof XP_THRESHOLDS] ?? 0;
  let pct = 100;
  if (level < 5) {
    const nextThreshold = XP_THRESHOLDS[(level + 1) as keyof typeof XP_THRESHOLDS] ?? currentThreshold;
    const range = nextThreshold - currentThreshold;
    if (range > 0) {
      pct = Math.min(100, Math.round(((xp - currentThreshold) / range) * 100));
    } else {
      pct = 0;
    }
  }
  fill.style.width = `${Math.max(0, pct)}%`;

  el.appendChild(fill);
  return el;
}

/**
 * Need gauges drain by fractional amounts each tick, so the raw number reaches
 * the screen as `69.85000000000016`. A gauge is read at a glance — whole
 * percent is all the precision it can carry.
 */
export function formatNeed(value: number): string {
  return String(Math.round(value));
}

export function makeNeedBar(label: string, value: number, color: string, key?: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'bs-need-row';
  // Addressable so the panel can write a drifting gauge in place instead of
  // rebuilding the row out from under a click.
  if (key) el.dataset['need'] = key;

  const labelEl = document.createElement('span');
  labelEl.className = 'bs-need-label';
  labelEl.textContent = label;

  const barBg = document.createElement('div');
  barBg.className = 'bs-need-bar-bg';

  const barFill = document.createElement('div');
  barFill.className = 'bs-need-bar-fill';
  barFill.style.width = `${value}%`;
  barFill.style.background = color;
  if (value <= 15) barFill.classList.add('critical');
  else if (value <= 35) barFill.classList.add('low');
  else barFill.classList.add('normal');

  const valueEl = document.createElement('span');
  valueEl.className = 'bs-need-value';
  valueEl.textContent = formatNeed(value);

  barBg.appendChild(barFill);
  el.append(labelEl, barBg, valueEl);
  return el;
}

export function makeTaskQueue(e: Employee, state: GameState): HTMLElement {
  const el = document.createElement('div');
  el.className = 'bs-task-queue';

  // Current task section
  const currentLabel = document.createElement('div');
  currentLabel.style.cssText = 'font-size:9px;color:#857b6b;text-transform:uppercase;margin-bottom:2px';
  currentLabel.textContent = t('ui.employees.active_task');
  el.appendChild(currentLabel);

  const hasActive = e.activeActionId !== null;
  const actions = state.pendingActions;

  if (hasActive) {
    const taskEl = document.createElement('div');
    taskEl.className = 'bs-task-entry current';
    const action = actions.find(a => a.id === e.activeActionId);
    taskEl.textContent = action ? `#${action.id} (${action.type})` : t('ui.employees.active_fallback', { id: String(e.activeActionId) });
    el.appendChild(taskEl);
  } else {
    const noTask = document.createElement('div');
    noTask.className = 'bs-queue-empty';
    noTask.textContent = t('ui.employees.no_task');
    el.appendChild(noTask);
  }

  // Show pending actions (up to 5)
  const displayActions = actions.slice(0, 5);
  const overflow = actions.length > 5 ? actions.length - 5 : 0;

  for (const a of displayActions) {
    const entry = document.createElement('div');
    entry.className = 'bs-task-entry';
    if (a.id === e.activeActionId) entry.classList.add('current');
    entry.textContent = `#${a.id} (${a.type})`;
    el.appendChild(entry);
  }

  if (overflow > 0) {
    const overflowEl = document.createElement('div');
    overflowEl.className = 'bs-task-entry';
    overflowEl.textContent = t('ui.employees.overflow', { count: String(overflow) });
    el.appendChild(overflowEl);
  }

  if (actions.length === 0 && !hasActive) {
    const emptyEl = document.createElement('div');
    emptyEl.className = 'bs-queue-empty';
    emptyEl.textContent = t('ui.employees.queue_empty');
    el.appendChild(emptyEl);
  }

  return el;
}
