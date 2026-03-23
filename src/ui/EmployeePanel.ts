// BlastSimulator2026 — Employee Management Panel (10.6)
// Lists employees with morale/union status; hire, fire, raise controls.

import { t } from '../core/i18n/I18n.js';
import type { GameState } from '../core/state/GameState.js';
import type { Employee, EmployeeRole } from '../core/entities/Employee.js';

export type GameConsoleFn = (cmd: string) => string;

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
        if (e.alive) this.listEl.appendChild(this.makeEmployeeRow(e));
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

  private makeEmployeeRow(e: Employee): HTMLElement {
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

    btnRow.append(raiseBtn, fireBtn);
    const col = document.createElement('div');
    col.style.cssText = 'flex:1;min-width:0';
    col.append(nameEl, details, btnRow);
    row.appendChild(col);
    return row;
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
