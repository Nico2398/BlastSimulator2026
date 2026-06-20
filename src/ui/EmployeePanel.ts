// BlastSimulator2026 — Employee Management Panel (10.6)
// Lists employees with morale/union status; hire, fire, raise controls.

import { t } from '../core/i18n/I18n.js';
import type { GameState } from '../core/state/GameState.js';
import type { Employee, EmployeeRole, TrainingState } from '../core/entities/Employee.js';
import { XP_THRESHOLDS, QUALIFICATION_SALARY_BONUS, BASE_SALARIES } from '../core/config/balance.js';

import type { CommandResult } from '../console/ConsoleRunner.js';

export type GameConsoleFn = (cmd: string) => CommandResult;

const ROLES: EmployeeRole[] = ['driller', 'blaster', 'driver', 'surveyor', 'manager'];
const HIRE_COSTS: Record<EmployeeRole, number> = {
  driller: 1000, blaster: 1500, driver: 800, surveyor: 1200, manager: 2000,
};

export class EmployeePanel {
  private readonly el: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly hireSection: HTMLElement;
  private gameConsole?: GameConsoleFn;

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'bs-employee-panel';
    this.el.classList.add('bs-ui', 'bs-panel');
    this.el.style.display = 'none';

    const title = document.createElement('div');
    title.className = 'bs-panel-title';
    title.textContent = t('ui.employees.title');

    this.listEl = document.createElement('div');

    const hireHeader = document.createElement('div');
    hireHeader.className = 'bs-section-header';
    hireHeader.style.marginTop = '8px';
    hireHeader.textContent = t('ui.employees.hire');

    this.hireSection = document.createElement('div');
    this.buildHireSection();

    const closeBtn = document.createElement('button');
    closeBtn.className = 'bs-btn';
    closeBtn.style.cssText = 'width:100%;margin-top:6px';
    closeBtn.textContent = t('ui.employees.close');
    closeBtn.addEventListener('click', () => this.hide());

    this.el.append(title, this.listEl, hireHeader, this.hireSection, closeBtn);
    container.appendChild(this.el);
  }

  setGameConsole(fn: GameConsoleFn): void { this.gameConsole = fn; }

  show(): void { this.el.style.display = ''; }
  hide(): void { this.el.style.display = 'none'; }
  get visible(): boolean { return this.el.style.display !== 'none'; }

  update(state: GameState): void {
    const { employees } = state.employees;
    this.listEl.innerHTML = '';

    if (employees.length === 0) {
      const msg = document.createElement('div');
      msg.style.cssText = 'color:#806050;font-size:11px;margin:4px 0';
      msg.textContent = t('ui.employees.none');
      this.listEl.appendChild(msg);
    } else {
      for (const e of employees) {
        if (e.alive) this.listEl.appendChild(this.makeEmployeeRow(e, state));
      }
    }

    // Update hire button disabled states
    const hireBtns = this.hireSection.querySelectorAll<HTMLButtonElement>('[data-role]');
    hireBtns.forEach(btn => {
      const role = btn.dataset['role'] as EmployeeRole;
      btn.disabled = state.cash < HIRE_COSTS[role];
    });
  }

  dispose(): void { this.el.remove(); }

  private makeEmployeeRow(e: Employee, state: GameState): HTMLElement {
    const row = document.createElement('div');
    row.className = 'bs-employee-row';

    const nameEl = document.createElement('div');
    nameEl.style.cssText = 'font-size:11px;color:#d0b090;font-weight:bold';
    nameEl.textContent = e.name;

    const details = document.createElement('div');
    details.style.cssText = 'font-size:10px;color:#a08060';
    const unionTag = e.unionized ? ` [${t('ui.employees.union')}]` : '';
    const injuredTag = e.injured ? ' ⚠️' : '';
    details.textContent = `${e.role} | ${t('ui.employees.morale')}: ${e.morale}%${unionTag}${injuredTag}`;

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:4px;margin-top:3px';

    const raiseBtn = document.createElement('button');
    raiseBtn.className = 'bs-btn';
    raiseBtn.style.cssText = 'padding:1px 6px;font-size:10px';
    raiseBtn.textContent = t('ui.employees.raise');
    raiseBtn.addEventListener('click', () => this.gameConsole?.(`employee raise id:${e.id}`));

    const fireBtn = document.createElement('button');
    fireBtn.className = 'bs-btn bs-btn-danger';
    fireBtn.style.cssText = 'padding:1px 6px;font-size:10px';
    fireBtn.textContent = t('ui.employees.fire');
    fireBtn.disabled = e.unionized;
    fireBtn.title = e.unionized ? t('ui.employees.cant_fire_union') : '';
    fireBtn.addEventListener('click', () => {
      if (!e.unionized) this.gameConsole?.(`employee fire id:${e.id}`);
    });

    const toggleEl = document.createElement('div');
    toggleEl.className = 'bs-detail-toggle';
    toggleEl.textContent = t('ui.employees.click_expand');
    toggleEl.addEventListener('click', () => this.toggleDetail(row, e, state));

    btnRow.append(raiseBtn, fireBtn, toggleEl);
    const col = document.createElement('div');
    col.style.cssText = 'flex:1;min-width:0';
    col.append(nameEl, details, btnRow);
    row.appendChild(col);
    return row;
  }

  // ── Skill/detail display stubs (Phase 10.6.2) ──

  private makeSkillStars(level: number): string {
    const filled = '★'.repeat(level);
    const empty = '☆'.repeat(5 - level);
    return filled + empty;
  }

  private makeSkillSection(e: Employee): HTMLElement {
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
      starsEl.textContent = this.makeSkillStars(q.proficiencyLevel);

      const xpBar = this.makeXpBar(q.xp, q.proficiencyLevel);

      row.append(catEl, starsEl, xpBar);
      el.appendChild(row);
    }
    return el;
  }

  private makeXpBar(xp: number, level: number): HTMLElement {
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
    fill.style.width = `${pct}%`;

    el.appendChild(fill);
    return el;
  }

  private makeNeedBar(label: string, value: number, color: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'bs-need-row';

    const labelEl = document.createElement('span');
    labelEl.className = 'bs-need-label';
    labelEl.textContent = label;

    const barBg = document.createElement('div');
    barBg.className = 'bs-need-bar-bg';

    const barFill = document.createElement('div');
    barFill.className = 'bs-need-bar-fill';
    barFill.style.width = `${value}%`;
    barFill.style.background = color;

    const valueEl = document.createElement('span');
    valueEl.textContent = String(value);

    barBg.appendChild(barFill);
    el.append(labelEl, barBg, valueEl);
    return el;
  }

  private makeTaskQueue(e: Employee, state: GameState): HTMLElement {
    const el = document.createElement('div');
    el.className = 'bs-task-queue';

    // Current task section
    const currentLabel = document.createElement('div');
    currentLabel.style.cssText = 'font-size:9px;color:#7a7060;text-transform:uppercase;margin-bottom:2px';
    currentLabel.textContent = t('ui.employees.active_task');
    el.appendChild(currentLabel);

    if (e.activeActionId !== null) {
      const taskEl = document.createElement('div');
      taskEl.className = 'bs-task-entry current';
      const action = state.pendingActions.find(a => a.id === e.activeActionId);
      taskEl.textContent = action ? `#${action.id} (${action.type})` : `#${e.activeActionId}`;
      el.appendChild(taskEl);
    } else {
      const noTask = document.createElement('div');
      noTask.className = 'bs-queue-empty';
      noTask.textContent = t('ui.employees.no_task');
      el.appendChild(noTask);
    }

    return el;
  }

  private makeSalaryBreakdown(e: Employee): HTMLElement {
    const el = document.createElement('div');
    el.className = 'bs-salary-breakdown';

    const baseText = document.createElement('div');
    baseText.textContent = `${t('ui.employees.base_salary')}: $${BASE_SALARIES[e.role]}`;
    el.appendChild(baseText);

    for (const q of e.qualifications) {
      const bonus = QUALIFICATION_SALARY_BONUS[q.proficiencyLevel];
      const bonusText = document.createElement('div');
      bonusText.textContent = `${t('ui.employees.skill_bonus')} (${q.category}): +$${bonus}`;
      el.appendChild(bonusText);
    }

    const totalBonus = e.qualifications.reduce((sum, q) => sum + QUALIFICATION_SALARY_BONUS[q.proficiencyLevel], 0);
    const total = document.createElement('div');
    total.className = 'bs-salary-total';
    total.textContent = `${t('ui.employees.total_salary')}: $${BASE_SALARIES[e.role] + totalBonus}`;
    el.appendChild(total);

    return el;
  }

  private makeModifiersSection(e: Employee): HTMLElement {
    const el = document.createElement('div');

    if (e.morale >= 70) {
      const tag = document.createElement('span');
      tag.className = 'bs-modifier-tag';
      tag.textContent = t('ui.employees.proficiency_5');
      el.appendChild(tag);
    }
    if (e.collapsing) {
      const tag = document.createElement('span');
      tag.className = 'bs-modifier-tag';
      tag.textContent = 'Collapsing';
      el.appendChild(tag);
    }
    if (e.injured) {
      const tag = document.createElement('span');
      tag.className = 'bs-modifier-tag';
      tag.textContent = 'Injured';
      el.appendChild(tag);
    }

    return el;
  }

  private makeTrainingBadge(e: Employee): HTMLElement | null {
    const ts: TrainingState | null = e.trainingState;
    if (ts) {
      const badge = document.createElement('span');
      badge.className = 'bs-training-badge';
      badge.textContent = `${t('ui.employees.training')}: ${ts.skill} (${ts.ticksRemaining}t)`;
      return badge;
    }
    return null;
  }

  private toggleDetail(row: HTMLElement, e: Employee, state: GameState): void {
    const existing = row.querySelector('.bs-employee-detail');
    if (existing) {
      existing.remove();
      return;
    }

    const detail = document.createElement('div');
    detail.className = 'bs-employee-detail';

    // Skills section
    detail.appendChild(this.makeSkillSection(e));

    // Need meters
    const needRow = document.createElement('div');
    needRow.style.cssText = 'margin-top:4px';
    needRow.appendChild(this.makeNeedBar(t('ui.employees.hunger'), e.hunger, '#e09040'));
    needRow.appendChild(this.makeNeedBar(t('ui.employees.fatigue'), e.fatigue, '#7090c0'));
    needRow.appendChild(this.makeNeedBar(t('ui.employees.break'), e.breakNeed, '#90b070'));
    detail.appendChild(needRow);

    // Task queue
    detail.appendChild(this.makeTaskQueue(e, state));

    // Salary breakdown
    detail.appendChild(this.makeSalaryBreakdown(e));

    // Modifiers
    detail.appendChild(this.makeModifiersSection(e));

    // Training badge
    const badge = this.makeTrainingBadge(e);
    if (badge) detail.appendChild(badge);

    row.appendChild(detail);
  }

  private buildHireSection(): void {
    for (const role of ROLES) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:4px';

      const label = document.createElement('div');
      label.style.cssText = 'flex:1;font-size:11px;color:#d0b090';
      label.textContent = `${role} ($${HIRE_COSTS[role]})`;

      const btn = document.createElement('button');
      btn.className = 'bs-btn bs-btn-primary';
      btn.style.cssText = 'padding:2px 8px;font-size:10px';
      btn.textContent = t('ui.employees.hire');
      btn.dataset['role'] = role;
      btn.addEventListener('click', () => this.gameConsole?.(`employee hire role:${role}`));

      row.append(label, btn);
      this.hireSection.appendChild(row);
    }
  }
}
