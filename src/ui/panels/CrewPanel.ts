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
import { el, explainable, gauge, panelHeader, replaceChildrenKeepingScroll } from '../dom.js';
import { windowRoot, windowBody } from '../windowKit.js';
import { LocaleTextRegistry } from '../localeText.js';
import type { GameState } from '../../core/state/GameState.js';
import type { Employee, EmployeeRole } from '../../core/entities/Employee.js';
import { FilterBarSelection, filterBar } from '../filterBar.js';
import { HIRING_ROLES } from '../../core/entities/HiringPool.js';
import { CREW_SORT_KEYS, CREW_STATUS_CHOICES, crewCriteriaFromSelection, filterEmployees } from '../crewFilter.js';
import { makeHiringSection, hiringSignature } from './CrewHiring.js';
import { moraleColor, makeStatusTags, makeManagerEffect, describeActivity, bandColor, perHour } from '../crewDetailSections.js';
import { cardGrid, kpiRow, kpiTile, windowSection } from '../windowKit.js';
import { employeePortraitSpec, portraitEl } from '../portraits.js';
import { staffCoverageSection, coverageSignature, syncStaffCoverage } from '../staffCoverageView.js';
import { computeEmployeeActivity } from '../../core/entities/EmployeeActivity.js';
import { NEED_THRESHOLDS } from '../../core/config/balance.js';
import { fatigueExplain, moraleExplain } from '../statExplain.js';
import type { GameConsoleFn } from '../gameConsole.js';
import { syncRowSelection, selectionChanged, type ListSelection } from '../selectionRoute.js';


export class CrewPanel extends PanelBase {
  private readonly bodyEl: HTMLElement;
  private gameConsole?: GameConsoleFn;
  private selection: ListSelection = null;
  private lastSignature = '';
  /** Role to scroll into view once the hiring section next renders (revealHiring before first render/show). */
  private pendingHiringRole: EmployeeRole | null = null;
  private lastState: GameState | null = null;
  /** Candidate whose sheet is open; survives re-renders. */
  private openCandidateId: number | null = null;
  private readonly hiringSelection = new FilterBarSelection();
  private readonly rosterSelection = new FilterBarSelection();
  private onSelectEmployeeCb?: (employeeId: number) => void;
  private readonly locale = new LocaleTextRegistry();
  /** Figures the coverage tiles last showed; they refresh in place, never through a roster rebuild. */
  private coverageSignature = '';

  constructor(container: HTMLElement) {
    super(windowRoot('bs-employee-panel'));

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
    this.bodyEl = windowBody('bsx-panel-body');

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
    const changed = selectionChanged(this.selection, sel);
    this.selection = sel;
    this.applySelection(changed);
  }

  private applySelection(scroll = false): void {
    syncRowSelection(this.bodyEl, this.selection, 'employee', 'data-employee-id', scroll);
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
   * Structural facts only: which rows exist and what their static card parts
   * show (name, role, flags, collapsing border, qualifications). Morale and status tags
   * (training included) drift on their own; including them here would force a
   * full rebuild and drop whatever the player is mid-click on.
   * refreshDynamic() below writes those in place instead.
   */
  private computeSignature(state: GameState): string {
    const rows = state.employees.employees
      .filter(e => e.alive)
      .map(e => {
        // Qualifications drive the manager-effect line, which refreshDynamic does not repaint.
        const quals = e.qualifications.map(q => `${q.category}${q.proficiencyLevel}${q.licenceLevel ?? ''}`).join(',');
        return `${e.id}:${e.role}:${e.unionized ? 1 : 0}:${e.injured ? 1 : 0}:${e.collapsing ? 1 : 0}:${e.name}:${quals}`;
      })
      .join('|');
    // Status drifts, so a filtered or sorted roster signs the ids it shows: rows entering or leaving the view rebuild it.
    const shown = this.rosterSelection.isActive() ? this.visibleEmployees(state).map(e => e.id).join(',') : '';
    const picked = `${this.rosterSelection.filter}|${this.rosterSelection.sort}|${JSON.stringify(this.rosterSelection.groups)}`;
    return `${rows}#${shown}~${picked}#${hiringSignature(state, this.hiringSelection, this.openCandidateId)}`;
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
      row.querySelector('.bs-crew-energy')?.replaceWith(this.makeEnergyGauge(e.fatigue));
      const activity = row.querySelector<HTMLElement>('.bs-crew-activity');
      const activityText = this.activityText(e, state);
      if (activity && activity.textContent !== activityText) activity.textContent = activityText;

      row.querySelector('.bs-crew-status')?.replaceWith(makeStatusTags(e, state));
    }
    this.bodyEl.querySelector('.bs-crew-kpis')?.replaceWith(this.makeKpis(state));
    this.coverageSignature = syncStaffCoverage(this.bodyEl, state, this.coverageSignature);
  }

  /** Living employees that pass the roster bar, in its sort order. */
  private visibleEmployees(state: GameState): Employee[] {
    const living = state.employees.employees.filter(e => e.alive);
    return filterEmployees(living, crewCriteriaFromSelection(this.rosterSelection), state);
  }

  /** The roster bar: role, status, skill (categories living employees hold), and the four sorts. */
  private makeRosterBar(state: GameState): HTMLElement {
    const skills = [...new Set(state.employees.employees.filter(e => e.alive).flatMap(e => e.qualifications.map(q => q.category)))];
    return filterBar(this.rosterSelection, {
      choices: HIRING_ROLES.map(role => ({ value: role, label: t(`role.${role}`) })),
      groups: [
        { id: 'status', label: t('ui.crew.filter_status'), choices: CREW_STATUS_CHOICES.map(value => ({ value, label: t(`ui.crew.filter_status_${value}`) })) },
        { id: 'skill', label: t('ui.crew.filter_skill'), choices: skills.map(value => ({ value, label: t(`skill.${value}`) })) },
      ],
      sorts: CREW_SORT_KEYS.map(key => ({ key, label: t(`ui.crew.sort_${key}`) })),
      onChange: () => { if (this.lastState) { this.lastSignature = ''; this.update(this.lastState); } },
      filterLabel: t('ui.crew.filter_role'), sortLabel: t('ui.filter.sort'),
      allLabel: t('ui.filter.all'), clearLabel: t('ui.filter.clear'),
    });
  }

  private render(state: GameState): void {
    const living = state.employees.employees.filter(e => e.alive);
    const employees = this.visibleEmployees(state);
    const cards = living.length === 0
      ? [el('div', { className: 'bsx-empty', text: t('ui.crew.none') })]
      : employees.length === 0
        ? [el('div', { className: 'bsx-empty', text: t('ui.crew.filter_no_match') })]
        : [cardGrid(employees.map(e => this.makeRosterCard(e, state)), 250)];
    // The roster keeps its `bsx-roster-scroll` hook, but a window scrolls once, in its body (#2242).
    const roster = el('div', { className: 'bsx-roster-scroll', children: living.length === 0 ? cards : [this.makeRosterBar(state), ...cards] });
    roster.style.cssText = 'display:flex;flex-direction:column;gap:10px';
    this.coverageSignature = coverageSignature(state);
    replaceChildrenKeepingScroll(this.bodyEl, [
      living.length > 0 ? this.makeKpis(state) : null,
      staffCoverageSection(state),
      windowSection({ title: t('ui.crew.roster'), count: String(living.length), className: 'bs-crew-roster', children: [roster] }),
      windowSection({
        title: t('ui.crew.hiring'),
        count: String(state.hiringPool.candidates.length),
        note: t('ui.crew.hiring_note'),
        className: 'bs-crew-hiring',
        children: makeHiringSection(state, (role, candidateId) => {
          const wasOpen = this.openCandidateId === candidateId;
          if (wasOpen) this.openCandidateId = null;
          this.gameConsole?.(`employee hire role:${role} candidate:${candidateId}`);
          if (wasOpen && this.lastState) { this.lastSignature = ''; this.update(this.lastState); }
        }, {
          selection: this.hiringSelection,
          openCandidateId: this.openCandidateId,
          onOpenCandidate: id => { this.openCandidateId = id; if (this.lastState) { this.lastSignature = ''; this.update(this.lastState); } },
          onChange: () => { if (this.lastState) { this.lastSignature = ''; this.update(this.lastState); } },
        }),
      }),
    ]);
    if (this.pendingHiringRole) {
      this.scrollToHiring(this.pendingHiringRole);
      this.pendingHiringRole = null;
    }
  }

  /** Headcount, payroll, morale, energy, idle and hurt hands: the crew at a glance. */
  private makeKpis(state: GameState): HTMLElement {
    const living = state.employees.employees.filter(e => e.alive);
    const n = Math.max(1, living.length);
    const morale = living.reduce((a, e) => a + e.morale, 0) / n;
    const energy = living.reduce((a, e) => a + e.fatigue, 0) / n;
    const payroll = living.reduce((a, e) => a + perHour(e.salary), 0);
    const idle = living.filter(e => computeEmployeeActivity(e, state.vehicles).kind === 'idle').length;
    const hurt = living.filter(e => e.injured || e.collapsing).length;
    const row = kpiRow([
      kpiTile({ label: t('ui.crew.kpi_headcount'), value: String(living.length), key: 'headcount' }),
      kpiTile({ label: t('ui.crew.kpi_payroll'), value: t('ui.crew.kpi_payroll_value', { amount: Math.round(payroll) }), key: 'payroll' }),
      kpiTile({ label: t('ui.crew.kpi_morale'), value: `${Math.round(morale)}%`, tone: morale < 34 ? 'critical' : morale < 67 ? 'warn' : 'positive', key: 'morale', explain: moraleExplain() }),
      kpiTile({ label: t('ui.crew.kpi_energy'), value: `${Math.round(energy)}%`, tone: energy < NEED_THRESHOLDS.fatigue.critical ? 'critical' : energy < NEED_THRESHOLDS.fatigue.low ? 'warn' : 'positive', key: 'energy', explain: fatigueExplain() }),
      kpiTile({ label: t('ui.crew.kpi_idle'), value: String(idle), sub: t('ui.crew.kpi_idle_sub'), tone: idle > 0 ? 'info' : 'neutral', key: 'idle' }),
      kpiTile({ label: t('ui.crew.kpi_hurt'), value: String(hurt), tone: hurt > 0 ? 'critical' : 'neutral', key: 'hurt' }),
    ]);
    row.classList.add('bs-crew-kpis');
    return row;
  }

  private activityText(e: Employee, state: GameState): string {
    return describeActivity(computeEmployeeActivity(e, state.vehicles), state.vehicles);
  }

  /** Energy is the fatigue gauge read the friendly way round: full is rested. */
  private makeEnergyGauge(fatigue: number): HTMLElement {
    const th = NEED_THRESHOLDS.fatigue;
    const row = gauge(t('ui.crew.need_fatigue'), fatigue, bandColor(fatigue, th.critical, th.low), { thresholdPct: th.low, labelWidth: 46, explain: fatigueExplain() });
    row.classList.add('bs-crew-energy');
    return row;
  }

  /** Morale as a gauge row whose fill and value keep the `bs-crew-morale-*` hooks refreshDynamic repaints. */
  private makeMoraleGauge(morale: number): HTMLElement {
    const color = moraleColor(morale);
    const row = gauge(t('ui.crew.morale'), morale, color, { labelWidth: 46 });
    row.querySelector('.bsx-gauge-fill')?.classList.add('bs-crew-morale-fill');
    const value = row.querySelector<HTMLElement>('.bsx-gauge-value');
    if (value) {
      value.classList.add('bs-crew-morale-value');
      value.textContent = `${Math.round(morale)}%`;
      explainable(value, moraleExplain());
    }
    return row;
  }

  private makeRosterCard(e: Employee, state: GameState): HTMLElement {
    const row = el('div', {
      className: `bsx-ecard bs-crew-card${e.collapsing ? ' bs-crew-collapsing' : ''}`,
      attrs: { 'data-employee-id': String(e.id), 'data-employee-role': e.role, 'data-clickable': '' },
    });

    const toggle = el('button', { className: 'bs-detail-toggle bsx-ecard-hit' });
    toggle.addEventListener('click', () => {
      this.onSelectEmployeeCb?.(e.id);
    });

    const title = el('div', { className: 'bsx-ecard-title', children: [
      el('span', { className: 'bsx-ecard-name', text: e.name }),
      el('span', { className: 'bsx-ecard-note bsx-mono', text: `#${e.id}` }),
    ] });
    const sub = el('div', { className: 'bsx-ecard-sub', children: [
      el('span', { text: t(`role.${e.role}`), attrs: { style: 'color:var(--bsx-text-secondary)' } }),
      document.createTextNode(' · '),
      el('span', { className: 'bs-crew-activity', text: this.activityText(e, state) }),
    ] });
    const managerEffect = makeManagerEffect(e);
    const content = el('div', { className: 'bsx-ecard-content', children: [
      el('div', { className: 'bsx-ecard-titles', children: [title, sub] }),
      this.makeMoraleGauge(e.morale),
      this.makeEnergyGauge(e.fatigue),
      managerEffect,
    ] });
    toggle.append(portraitEl(employeePortraitSpec(e), 56), content);

    const locateBtn = makeLocateButton({
      title: t('ui.crew.locate'),
      onClick: () => this.locateEmployee(e.id),
    });
    locateBtn.addEventListener('click', ev => ev.stopPropagation());
    const aside = el('div', { className: 'bs-crew-aside', children: [makeStatusTags(e, state), locateBtn] });
    row.append(el('div', { className: 'bs-crew-card-main', children: [toggle, aside] }));
    return row;
  }
}
