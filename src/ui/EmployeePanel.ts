// BlastSimulator2026 — Employee Management Panel (10.6)
// Lists employees with morale/union status; hire, fire, raise controls.

import { t } from '../core/i18n/I18n.js';
import { LocaleTextRegistry } from './localeText.js';
import type { GameState } from '../core/state/GameState.js';
import type { Employee, EmployeeRole, TrainingState } from '../core/entities/Employee.js';
import { QUALIFICATION_SALARY_BONUS, BASE_SALARIES } from '../core/config/balance.js';
import { makeTrainingSection, availableCourses } from './employeeTrainingSection.js';
import { planTraining } from '../core/entities/EmployeeTraining.js';
import { makeSkillSection, makeNeedBar, makeTaskQueue, formatNeed, applyNeedValueClass, getEmployeeRowClassNames } from './employeeDetailSections.js';

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
  /** Fingerprint of the last rendered roster — guards against per-frame rebuilds. */
  private lastSignature = '';
  /** Employee ids whose detail the player has expanded, kept across rebuilds. */
  private readonly expanded = new Set<number>();
  /** Latest state, so a locale switch can re-render the roster rows. */
  private lastState: GameState | null = null;
  private readonly locale = new LocaleTextRegistry();

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'bs-employee-panel';
    this.el.classList.add('bs-ui', 'bs-panel');
    this.el.style.display = 'none';

    const title = document.createElement('div');
    title.className = 'bs-panel-title';
    this.locale.bindText(title, 'ui.employees.title');

    this.listEl = document.createElement('div');

    const hireHeader = document.createElement('div');
    hireHeader.className = 'bs-section-header';
    hireHeader.style.marginTop = '8px';
    this.locale.bindText(hireHeader, 'ui.employees.hire');

    this.hireSection = document.createElement('div');
    this.buildHireSection();

    const closeBtn = document.createElement('button');
    closeBtn.className = 'bs-btn';
    closeBtn.style.cssText = 'width:100%;margin-top:6px';
    this.locale.bindText(closeBtn, 'ui.employees.close');
    closeBtn.addEventListener('click', () => this.hide());

    this.el.append(title, this.listEl, hireHeader, this.hireSection, closeBtn);
    container.appendChild(this.el);
  }

  setGameConsole(fn: GameConsoleFn): void { this.gameConsole = fn; }

  /** Re-render locale-dependent text (title, roster rows, hire section) after a language change. */
  refreshLocale(): void {
    this.locale.refresh();
    // The roster and the hire list are only rebuilt when the roster changes, so
    // they hold the previous locale until it does — rebuild both now.
    this.hireSection.replaceChildren();
    this.buildHireSection();
    this.lastSignature = '';
    if (this.lastState) this.update(this.lastState);
  }

  show(): void { this.el.style.display = ''; }
  hide(): void { this.el.style.display = 'none'; }
  get visible(): boolean { return this.el.style.display !== 'none'; }

  /**
   * Expand a specific employee's detail row and scroll it into view — the
   * panel-side half of the scene selection bar's DETAIL/TRAIN actions
   * (src/ui/shell/SelectionBar.ts), which pick an employee in the 3D scene
   * and need their row opened here, not just the panel shown.
   */
  expandEmployee(id: number): void {
    this.expanded.add(id);
    this.lastSignature = ''; // force a rebuild so the row renders expanded
    if (this.lastState) this.update(this.lastState);
    // Optional chained on the method itself, not just the element — jsdom
    // (unit tests) doesn't implement scrollIntoView at all.
    this.listEl.querySelector<HTMLElement>(`[data-employee-id="${id}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }

  update(state: GameState): void {
    this.lastState = state;
    const { employees } = state.employees;

    // UIManager.update runs every rendered frame. Rebuilding the list each time
    // destroys any expanded detail panel within a frame of the player opening
    // it, and detaches buttons out from under an in-flight click. Rebuild only
    // when something the list actually shows has changed.
    const signature = this.computeSignature(state);
    if (signature === this.lastSignature) {
      // Nothing structural moved, but morale and the need gauges drift every
      // tick. Write those in place rather than rebuilding: replacing the nodes
      // detaches whatever the player is reaching for, and a click that lands
      // between the query and the rebuild hits nothing at all.
      this.refreshDynamic(state);
      return;
    }
    this.lastSignature = signature;

    this.listEl.replaceChildren();

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

  /**
   * What the roster's *structure* depends on — which rows exist and which
   * controls they carry. Values that drift on their own (morale, need gauges,
   * a training countdown) are deliberately excluded: they change every tick, so
   * including them would rebuild the panel continuously and no control would
   * survive long enough to be clicked. `refreshDynamic` writes those in place.
   *
   * Cash is bucketed to the hire prices, so a salary tick only forces a rebuild
   * when it crosses a price threshold.
   */
  private computeSignature(state: GameState): string {
    const rows = state.employees.employees
      .filter(e => e.alive)
      .map(e => {
        const quals = e.qualifications.map(q => `${q.category}${q.proficiencyLevel}`).join(',');
        // Whether a course is running changes which controls the row shows;
        // how many ticks are left does not.
        const training = e.trainingState ? e.trainingState.skill : '-';
        return `${e.id}:${e.role}:${e.unionized ? 1 : 0}:${e.injured ? 1 : 0}`
          + `:${e.collapsing ? 1 : 0}:${e.name}:${quals}:${training}`;
      })
      .join('|');
    const affordable = ROLES.map(r => (state.cash < HIRE_COSTS[r] ? '0' : '1')).join('');
    // Schools change which courses the panel can offer at all.
    const schools = state.buildings.buildings.map(b => `${b.type}${b.tier}`).sort().join(',');
    // Affording a course flips the Train buttons between enabled and disabled.
    const canTrain = state.employees.employees
      .filter(e => e.alive)
      .map(e => (this.affordsAnyCourse(e, state) ? '1' : '0')).join('');
    return `${rows}#${affordable}#${schools}#${canTrain}`;
  }

  private affordsAnyCourse(e: Employee, state: GameState): boolean {
    return availableCourses(state).some(c => {
      const plan = planTraining(e, c.skill, c.building.tier);
      return plan !== null && state.cash >= plan.fee;
    });
  }

  /**
   * Update the values that change every tick without touching the DOM
   * structure, so an in-flight click keeps its target.
   */
  private refreshDynamic(state: GameState): void {
    for (const e of state.employees.employees) {
      if (!e.alive) continue;
      const row = this.listEl.querySelector<HTMLElement>(`[data-employee-id="${e.id}"]`);
      if (!row) continue;

      const meta = row.querySelector<HTMLElement>('.bs-employee-meta');
      if (meta) meta.textContent = this.metaLine(e);

      for (const [key, value] of [
        ['hunger', e.hunger], ['fatigue', e.fatigue], ['break', e.breakNeed],
      ] as Array<[string, number]>) {
        const fill = row.querySelector<HTMLElement>(`[data-need="${key}"] .bs-need-bar-fill`);
        if (fill) fill.style.width = `${value}%`;
        const readout = row.querySelector<HTMLElement>(`[data-need="${key}"] .bs-need-value`);
        if (readout) {
          readout.textContent = formatNeed(value);
          applyNeedValueClass(readout, value);
        }
      }

      if (e.trainingState) {
        const status = row.querySelector<HTMLElement>('.bs-training-status');
        if (status) {
          status.textContent = t('ui.employees.training_in_progress')
            .replace('{skill}', e.trainingState.skill)
            .replace('{ticks}', String(e.trainingState.ticksRemaining));
        }
        const badge = row.querySelector<HTMLElement>('.bs-training-badge');
        if (badge) {
          badge.textContent = `${t('ui.employees.training')}: ${e.trainingState.skill} `
            + `(${e.trainingState.ticksRemaining}t)`;
        }
      }

      // Task queue (active/queued actions) and modifier tags (morale tier,
      // collapsing, injured) are built once at expand time by makeDetail and
      // never touched again — a task claimed or a morale threshold crossed
      // after expansion was invisible until an unrelated structural change
      // forced a full rebuild. Re-render both sections in place every tick
      // an employee's detail is open, same as the meta line and need bars above.
      const detail = row.querySelector<HTMLElement>('.bs-employee-detail');
      if (detail) {
        const skillEl = detail.querySelector<HTMLElement>('.bs-skill-section');
        if (skillEl) skillEl.replaceWith(makeSkillSection(e));

        const taskQueueEl = detail.querySelector<HTMLElement>('.bs-task-queue');
        if (taskQueueEl) taskQueueEl.replaceWith(makeTaskQueue(e, state));

        const modifiersEl = detail.querySelector<HTMLElement>('.bs-modifiers-section');
        if (modifiersEl) modifiersEl.replaceWith(this.makeModifiersSection(e));
      }
    }
  }

  private metaLine(e: Employee): string {
    const unionTag = e.unionized ? ` [${t('ui.employees.union')}]` : '';
    const injuredTag = e.injured ? ' ⚠️' : '';
    return `${e.role} | ${t('ui.employees.morale')}: ${e.morale}%${unionTag}${injuredTag}`;
  }

  private makeEmployeeRow(e: Employee, state: GameState): HTMLElement {
    const row = document.createElement('div');
    row.className = getEmployeeRowClassNames(e).join(' ');
    row.dataset['employeeId'] = String(e.id);

    const nameEl = document.createElement('div');
    nameEl.style.cssText = 'font-size:11px;color:#d0b090;font-weight:bold';
    nameEl.textContent = e.name;

    const details = document.createElement('div');
    details.className = 'bs-employee-meta';
    details.style.cssText = 'font-size:10px;color:#a08060';
    details.textContent = this.metaLine(e);

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

    // Restore an expansion the player made before the last rebuild.
    if (this.expanded.has(e.id)) row.appendChild(this.makeDetail(e, state));
    return row;
  }


  private makeSalaryBreakdown(e: Employee): HTMLElement {
    const el = document.createElement('div');
    el.className = 'bs-salary-breakdown';

    const header = document.createElement('div');
    header.style.cssText = 'font-size:9px;color:#857b6b;text-transform:uppercase;margin-bottom:2px';
    header.textContent = t('ui.employees.salary_breakdown');
    el.appendChild(header);

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
    // Addressable so refreshDynamic can re-render this section in place each
    // tick a row is expanded — modifiers depend on morale/collapsing/injured,
    // which drift on their own like the meta line and need bars.
    el.className = 'bs-modifiers-section';

    const modifiers = [
      { active: e.morale >= 70, text: t('ui.employees.high_morale') },
      { active: e.collapsing, text: t('ui.employees.collapsing') },
      { active: e.injured, text: t('ui.employees.injured') },
    ];
    for (const m of modifiers) {
      if (m.active) {
        const tag = document.createElement('span');
        tag.className = 'bs-modifier-tag';
        tag.textContent = m.text;
        el.appendChild(tag);
      }
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
      this.expanded.delete(e.id);
      return;
    }
    // Remembered across rebuilds: morale and needs drift every tick, so the
    // roster re-renders on its own. Without this the detail a player just
    // opened — and the training controls inside it — vanish a moment later.
    this.expanded.add(e.id);
    const detail = this.makeDetail(e, state);
    row.appendChild(detail);
    // A row near the top of a long, already-scrolled roster opens off-screen
    // otherwise — its own expansion is never in frame to click or screenshot.
    // jsdom (unit tests) doesn't implement scrollIntoView at all.
    detail.scrollIntoView?.({ block: 'nearest' });
  }

  private makeDetail(e: Employee, state: GameState): HTMLElement {
    const detail = document.createElement('div');
    detail.className = 'bs-employee-detail';

    // Skills section
    detail.appendChild(makeSkillSection(e));

    // Need meters
    const needRow = document.createElement('div');
    needRow.style.cssText = 'margin-top:4px';
    needRow.appendChild(makeNeedBar(t('ui.employees.hunger'), e.hunger, '#e09040', 'hunger'));
    needRow.appendChild(makeNeedBar(t('ui.employees.fatigue'), e.fatigue, '#7090c0', 'fatigue'));
    needRow.appendChild(makeNeedBar(t('ui.employees.break'), e.breakNeed, '#90b070', 'break'));
    detail.appendChild(needRow);

    // Task queue
    detail.appendChild(makeTaskQueue(e, state));

    // Salary breakdown
    detail.appendChild(this.makeSalaryBreakdown(e));

    // Modifiers
    detail.appendChild(this.makeModifiersSection(e));

    // Training badge
    const badge = this.makeTrainingBadge(e);
    if (badge) detail.appendChild(badge);

    // Training controls — the only in-game way to gain a qualification a role
    // is not hired with, or to rise above Rookie.
    detail.appendChild(makeTrainingSection(e, state, this.gameConsole));

    return detail;
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
