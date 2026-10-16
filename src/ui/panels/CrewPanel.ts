// BlastSimulator2026 — Crew panel (redesign P6)
// Roster cards (avatar, morale, status tags, Locate) — a row click selects the
// employee in the scene, whose inspector shows the detail. A HIRING section
// below the roster covers headcount.
//
// Root id, the roster toggle's .bs-detail-toggle class, [data-employee-id],
// and the hire button's [data-role] are preserved from the old EmployeePanel
// so tutorialStages.ts, uiActionProbe.ts, and the tutorial/scenario defs keep
// resolving unchanged.

import { PanelBase } from './PanelBase.js';
import { makeLocateButton, focusCameraOn } from '../locateButton.js';
import { t } from '../../core/i18n/I18n.js';
import { el, sectionHeader, panelRoot, panelHeader, panelBody, scrollBoundedSection, replaceChildrenKeepingScroll } from '../dom.js';
import { LocaleTextRegistry } from '../localeText.js';
import type { GameState } from '../../core/state/GameState.js';
import type { Employee, EmployeeRole } from '../../core/entities/Employee.js';
import { makeHiringSection, hiringSignature } from './CrewHiring.js';
import { availableTrainingOffers, planTraining } from '../../core/entities/EmployeeTraining.js';
import { moraleColor, makeAvatar, makeRoleMoraleLine, makeStatusTags, makeManagerEffect } from '../crewDetailSections.js';
import { applyRowSelection } from '../buildMenuRows.js';
import type { GameConsoleFn } from '../gameConsole.js';
import type { ListSelection } from '../selectionRoute.js';


export class CrewPanel extends PanelBase {
  private readonly bodyEl: HTMLElement;
  private gameConsole?: GameConsoleFn;
  private selection: ListSelection = null;
  private lastSignature = '';
  /** Role to scroll into view once the hiring section next renders (revealHiring before first render/show). */
  private pendingHiringRole: EmployeeRole | null = null;
  private lastState: GameState | null = null;
  private onSelectEmployeeCb?: (employeeId: number) => void;
  private readonly locale = new LocaleTextRegistry();

  constructor(container: HTMLElement) {
    super(panelRoot('bs-employee-panel'));

    const { header, titleEl } = panelHeader({
      icon: 'crew',
      accent: 'critical',
      onClose: () => this.onCloseCb?.(),
    });
    this.locale.bindText(titleEl, 'ui.crew.title');

    // Class, not just the id-scoped selector CrewPanel already exposes:
    // scenario coverage needs a stable hook onto the actual scrolling
    // element (this.el itself only clips — overflow:hidden — bodyEl is
    // where overflow-y:auto and the real scrollTop live).
    this.bodyEl = panelBody(8, 'bsx-panel-body');

    this.el.append(header, this.bodyEl);
    container.appendChild(this.el);
  }

  setGameConsole(fn: GameConsoleFn): void { this.gameConsole = fn; }
  /** Wire the callback that selects an employee in the 3D scene (focuses the camera on them). */
  setSelectEmployeeHandler(cb: (employeeId: number) => void): void { this.onSelectEmployeeCb = cb; }

  /** Locate button action: focus the camera on the live employee and select them. */
  private locateEmployee(id: number): void {
    const live = this.lastState?.employees.employees.find(x => x.id === id);
    if (!live) return;
    focusCameraOn(live.x, live.z);
    this.onSelectEmployeeCb?.(id);
  }


  /** Highlight the roster row matching the scene selection `sel`; kept across re-renders, not part of the signature. */
  setSelectedEmployee(sel: ListSelection): void {
    const changed = this.selection?.id !== sel?.id || this.selection?.kind !== sel?.kind;
    this.selection = sel;
    this.applySelection(changed);
  }

  private applySelection(scroll = false): void {
    applyRowSelection([this.bodyEl], this.selection, 'employee', 'data-employee-id');
    if (!scroll || this.selection?.kind !== 'employee') return;
    // Optional chained on the method: jsdom doesn't implement scrollIntoView.
    this.bodyEl.querySelector<HTMLElement>('.bs-row-selected')?.scrollIntoView?.({ block: 'nearest' });
  }

  /** Show the hiring section with candidates of `role` in view. */
  revealHiring(role: EmployeeRole): void {
    if (!this.lastState) {
      this.pendingHiringRole = role;
      return;
    }
    this.scrollToHiring(role);
  }

  private scrollToHiring(role: EmployeeRole): void {
    this.bodyEl.querySelector<HTMLElement>(`[data-hiring-role="${role}"]`)?.scrollIntoView?.({ block: 'start' });
  }

  update(state: GameState): void {
    this.lastState = state;
    const signature = this.computeSignature(state);
    if (signature === this.lastSignature) {
      this.refreshDynamic(state);
      return;
    }
    this.lastSignature = signature;
    this.render(state);
    this.applySelection();
  }

  refreshLocale(): void {
    this.locale.refresh();
    this.lastSignature = '';
    if (this.lastState) this.update(this.lastState);
  }


  /**
   * Structural facts only: which rows exist and what their tags show. Morale
   * and status drift every tick on their own; including them here would force a full
   * rebuild every tick and drop whatever the player is mid-click on.
   * refreshDynamic() below writes those in place instead.
   *
   * Cash is bucketed to affordability, not included as a raw number: a
   * training fee or hire cost only needs a rebuild when it crosses from
   * affordable to not (or back), the same way OperationsPanel/legacy
   * EmployeePanel bucket cash against their own price thresholds.
   */
  private computeSignature(state: GameState): string {
    const rows = state.employees.employees
      .filter(e => e.alive)
      .map(e => {
        const quals = e.qualifications.map(q => `${q.category}${q.proficiencyLevel}${q.licenceLevel ?? ''}`).join(',');
        return `${e.id}:${e.role}:${e.unionized ? 1 : 0}:${e.injured ? 1 : 0}:${e.collapsing ? 1 : 0}`
          + `:${e.trainingState ? 1 : 0}:${e.pendingTrainingState ? 1 : 0}:${e.name}:${quals}:${this.affordsAnyCourse(e, state) ? 1 : 0}`;
      })
      .join('|');
    const schools = state.buildings.buildings.map(b => `${b.type}${b.tier}`).sort().join(',');
    return `${rows}#${hiringSignature(state)}#${schools}`;
  }

  private affordsAnyCourse(e: Employee, state: GameState): boolean {
    if (e.trainingState || e.pendingTrainingState || e.injured) return false;
    return availableTrainingOffers(state.buildings.buildings).some(({ skill, building }) => {
      const plan = planTraining(e, skill, building.tier);
      return plan !== null && state.cash >= plan.fee;
    });
  }

  /** Re-paint values that drift every tick without rebuilding the DOM under an in-flight click. */
  private refreshDynamic(state: GameState): void {
    for (const e of state.employees.employees) {
      if (!e.alive) continue;
      const row = this.bodyEl.querySelector<HTMLElement>(`[data-employee-id="${e.id}"]`);
      if (!row) continue;

      const fill = row.querySelector<HTMLElement>('.bs-crew-morale-fill');
      const value = row.querySelector<HTMLElement>('.bs-crew-morale-value');
      const color = moraleColor(e.morale);
      if (fill) fill.style.width = `${e.morale}%`;
      if (fill) fill.style.background = color;
      if (value) { value.textContent = `${Math.round(e.morale)}%`; value.style.color = color; }

      row.querySelector('.bs-crew-status')?.replaceWith(makeStatusTags(e, state));
    }
  }

  private render(state: GameState): void {
    const employees = state.employees.employees.filter(e => e.alive);
    const cards = employees.length === 0
      ? [el('div', { className: 'bsx-empty', text: t('ui.crew.none') })]
      : employees.map(e => this.makeRosterCard(e, state));
    // className hook: this inner div, not bodyEl, is now the roster's real
    // scrolling container (overflow-y:auto lives here per scrollBoundedSection),
    // so scenario coverage needs a stable selector for it (#964 CI fix).
    replaceChildrenKeepingScroll(this.bodyEl, [
      scrollBoundedSection(cards, 200, { gap: 8, className: 'bsx-roster-scroll', scrollKey: 'roster' }),
      sectionHeader(t('ui.crew.hiring')),
      ...makeHiringSection(state, (role, candidateId) => this.gameConsole?.(`employee hire role:${role} candidate:${candidateId}`)),
    ]);
    if (this.pendingHiringRole) {
      this.scrollToHiring(this.pendingHiringRole);
      this.pendingHiringRole = null;
    }
  }

  private makeRosterCard(e: Employee, state: GameState): HTMLElement {
    const row = el('div', { attrs: { 'data-employee-id': String(e.id), 'data-employee-role': e.role } });
    row.style.cssText = `border-radius:var(--bsx-r-card);overflow:hidden;flex-shrink:0;border:1px solid ${
      e.collapsing ? 'rgba(255,91,76,.4)' : 'var(--bsx-hairline)'
    };background:var(--bsx-card)`;

    const toggle = el('button', { className: 'bs-detail-toggle', attrs: { style: 'flex:1;min-width:0;display:flex;align-items:center;gap:10px;padding:10px 11px;border:0;background:transparent;color:var(--bsx-text-primary);cursor:pointer;text-align:left' } });
    toggle.addEventListener('click', () => {
      this.onSelectEmployeeCb?.(e.id);
    });

    const avatar = makeAvatar(e);

    const nameLine = el('div', { attrs: { style: 'display:flex;align-items:baseline;gap:6px' } });
    nameLine.append(
      el('span', { text: e.name, attrs: { style: 'font:600 12px/1 var(--bsx-font-ui);color:var(--bsx-text-primary)' } }),
      el('span', { text: `#${e.id}`, className: 'bsx-mono', attrs: { style: 'font-size:10px;color:var(--bsx-text-micro)' } }),
    );

    const roleLine = makeRoleMoraleLine(e);

    const managerEffect = makeManagerEffect(e);
    const col = el('div', { attrs: { style: 'display:flex;flex-direction:column;gap:4px;min-width:0;flex:1' }, children: managerEffect ? [nameLine, roleLine, managerEffect] : [nameLine, roleLine] });

    toggle.append(avatar, col, makeStatusTags(e, state));
    const locateBtn = makeLocateButton({
      title: t('ui.crew.locate'),
      onClick: () => this.locateEmployee(e.id),
    });
    locateBtn.addEventListener('click', ev => ev.stopPropagation());
    locateBtn.style.marginRight = '11px';
    const header = el('div', { attrs: { style: 'display:flex;align-items:center' }, children: [toggle, locateBtn] });
    row.appendChild(header);

    return row;
  }
}
