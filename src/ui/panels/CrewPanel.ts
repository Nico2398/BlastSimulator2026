// BlastSimulator2026 — Crew panel (redesign P6)
// Roster cards (avatar, morale, status tags) with an expandable detail per
// employee: hired/location, needs, current task, skills, pay/raise,
// training, dismiss. A HIRING section below the roster covers headcount.
//
// Single expansion, unlike the old EmployeePanel's multi-expand Set: the
// design mock keeps exactly one card open at a time (clicking a second one
// closes the first), so `expandedId` is a lone id rather than a set.
//
// Root id, the roster toggle's .bs-detail-toggle class, the detail
// wrapper's .bs-employee-detail class, [data-employee-id], the hire
// button's [data-role], and the train button's .bs-train-btn/[data-skill]/
// [data-employee] are all preserved from the old EmployeePanel so
// tutorialStages.ts, uiActionProbe.ts, and the tutorial/scenario
// defs keep resolving unchanged — same convention ContractsPanel.ts already
// established for #bs-contract-panel in P5.

import { PanelBase } from './PanelBase.js';
import { t } from '../../core/i18n/I18n.js';
import { el, sectionHeader, panelRoot, panelHeader, panelBody, scrollBoundedSection } from '../dom.js';
import { iconEl } from '../icons.js';
import { LocaleTextRegistry } from '../localeText.js';
import type { GameState } from '../../core/state/GameState.js';
import type { Employee, EmployeeRole } from '../../core/entities/Employee.js';
import { HIRING_COSTS, ROLE_STARTING_QUALIFICATION } from '../../core/entities/Employee.js';
import { computeEmployeeActivity } from '../../core/entities/EmployeeActivity.js';
import { availableTrainingOffers, planTraining } from '../../core/entities/EmployeeTraining.js';
import {
  roleColorHex, getInitials, moraleColor, makeHiredLocationStrip, makeNeedsSection,
  makeCurrentTaskSection, makeSkillsSection, makePaySection, makeTrainingSection, makeDismissSection,
} from '../crewDetailSections.js';
import type { ConfirmModalConfig } from './ConfirmModal.js';
import type { GameConsoleFn } from '../gameConsole.js';


const ROLES: EmployeeRole[] = ['driller', 'blaster', 'driver', 'surveyor', 'manager'];

export class CrewPanel extends PanelBase {
  private readonly bodyEl: HTMLElement;
  private gameConsole?: GameConsoleFn;
  private onConfirmRequestCb?: (config: ConfirmModalConfig) => void;
  private expandedId: number | null = null;
  private lastSignature = '';
  private lastState: GameState | null = null;
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
  /** UIManager wires this to its shared ConfirmModal's show() — see ConfirmModal.ts. */
  setConfirmHandler(cb: (config: ConfirmModalConfig) => void): void { this.onConfirmRequestCb = cb; }


  /**
   * Expand a specific employee's card and scroll it into view — the
   * panel-side half of the scene selection bar's DETAIL/TRAIN actions
   * (src/ui/shell/SelectionBar.ts via UIManager.showEmployeeDetail), which
   * pick an employee in the 3D scene and need their card opened here, not
   * just the panel shown.
   */
  expandEmployee(id: number): void {
    this.expandedId = id;
    this.lastSignature = '';
    if (this.lastState) this.update(this.lastState);
    // Optional chained on the method itself, not just the element — jsdom
    // (unit tests) doesn't implement scrollIntoView at all.
    this.bodyEl.querySelector<HTMLElement>(`[data-employee-id="${id}"]`)?.scrollIntoView?.({ block: 'nearest' });
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
  }

  refreshLocale(): void {
    this.locale.refresh();
    this.lastSignature = '';
    if (this.lastState) this.update(this.lastState);
  }


  /**
   * Structural facts only: which rows exist, and — for the one expanded row
   * — which controls it shows. Morale, need gauges, and task countdowns
   * drift every tick on their own; including them here would force a full
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
        const quals = e.qualifications.map(q => `${q.category}${q.proficiencyLevel}`).join(',');
        const activity = computeEmployeeActivity(e, state.vehicles.vehicles);
        return `${e.id}:${e.role}:${e.unionized ? 1 : 0}:${e.injured ? 1 : 0}:${e.collapsing ? 1 : 0}`
          + `:${e.trainingState ? 1 : 0}:${activity.kind}:${e.name}:${quals}:${this.affordsAnyCourse(e, state) ? 1 : 0}`;
      })
      .join('|');
    const hireAffordable = ROLES.map(r => (state.cash < HIRING_COSTS[r] ? '0' : '1')).join('');
    const headcounts = ROLES.map(r => state.employees.employees.filter(e => e.alive && e.role === r).length).join(',');
    const schools = state.buildings.buildings.map(b => `${b.type}${b.tier}`).sort().join(',');
    return `${rows}#${this.expandedId ?? '-'}#${hireAffordable}#${headcounts}#${schools}`;
  }

  private affordsAnyCourse(e: Employee, state: GameState): boolean {
    if (e.trainingState || e.injured) return false;
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

      if (e.id !== this.expandedId) continue;
      const detail = row.querySelector<HTMLElement>('.bs-crew-detail');
      if (!detail) continue;
      detail.querySelector('.bs-crew-needs')?.replaceWith(this.tag(makeNeedsSection(e), 'bs-crew-needs'));
      detail.querySelector('.bs-crew-task')?.replaceWith(this.tag(makeCurrentTaskSection(e, state), 'bs-crew-task'));
      detail.querySelector('.bs-crew-skills')?.replaceWith(this.tag(makeSkillsSection(e), 'bs-crew-skills'));
    }
  }

  private tag(elToTag: HTMLElement, className: string): HTMLElement {
    elToTag.classList.add(className);
    return elToTag;
  }

  private render(state: GameState): void {
    const employees = state.employees.employees.filter(e => e.alive);
    const cards = employees.length === 0
      ? [el('div', { className: 'bsx-empty', text: t('ui.crew.none') })]
      : employees.map(e => this.makeRosterCard(e, state));
    this.bodyEl.replaceChildren(
      scrollBoundedSection(cards, 200, { gap: 8 }),
      sectionHeader(t('ui.crew.hiring')),
      ...this.makeHiringRows(state),
    );
  }

  private makeHiringRows(state: GameState): HTMLElement[] {
    return ROLES.map(role => {
      const count = state.employees.employees.filter(e => e.alive && e.role === role).length;
      const row = el('div', { attrs: { style: 'display:flex;align-items:center;gap:10px;padding:9px 11px;border:1px solid var(--bsx-hairline);border-radius:5px;background:var(--bsx-card)' } });
      const info = el('div', { attrs: { style: 'display:flex;flex-direction:column;gap:3px;flex:1;min-width:0' } });
      info.append(
        el('span', { text: t(`role.${role}`), attrs: { style: 'font:600 11px/1 var(--bsx-font-ui)' } }),
        el('span', {
          text: t('ui.crew.hire_starts_with', { qual: t(`skill.${ROLE_STARTING_QUALIFICATION[role]}`), count }),
          attrs: { style: 'font:400 10px/1 var(--bsx-font-ui);color:var(--bsx-text-micro)' },
        }),
      );
      const cost = el('span', { text: `$${HIRING_COSTS[role]}`, className: 'bsx-mono', attrs: { style: 'font-size:11px;font-weight:600;color:var(--bsx-amber)' } });
      const hireBtn = el('button', { className: 'bsx-btn', text: t('ui.crew.hire'), attrs: { 'data-role': role } });
      hireBtn.disabled = state.cash < HIRING_COSTS[role];
      hireBtn.addEventListener('click', () => this.gameConsole?.(`employee hire role:${role}`));
      row.append(info, cost, hireBtn);
      return row;
    });
  }

  private makeRosterCard(e: Employee, state: GameState): HTMLElement {
    const expanded = e.id === this.expandedId;
    const row = el('div', { attrs: { 'data-employee-id': String(e.id) } });
    // flex-shrink:0 — overflow:hidden (for the rounded corners) drops this
    // row's automatic min-height from content-based to 0, which without this
    // lets bodyEl's flex layout compress an expanded row to fit instead of
    // leaving it at natural size and scrolling past it (the panel's own
    // overflow-y:auto is otherwise a no-op: nothing left to overflow with).
    row.style.cssText = `border-radius:var(--bsx-r-card);overflow:hidden;flex-shrink:0;border:1px solid ${
      expanded ? 'rgba(255,176,46,.4)' : e.collapsing ? 'rgba(255,91,76,.4)' : 'var(--bsx-hairline)'
    };background:${expanded ? 'rgba(255,176,46,.07)' : 'var(--bsx-card)'}`;

    const toggle = el('button', { className: 'bs-detail-toggle', attrs: { style: 'width:100%;display:flex;align-items:center;gap:10px;padding:10px 11px;border:0;background:transparent;cursor:pointer;text-align:left' } });
    toggle.addEventListener('click', () => {
      this.expandedId = expanded ? null : e.id;
      this.lastSignature = '';
      this.update(state);
    });

    const avatar = el('div', { text: getInitials(e.name), attrs: { style: `width:30px;height:30px;flex:0 0 30px;border-radius:5px;display:flex;align-items:center;justify-content:center;background:${roleColorHex(e.role)};color:#12161c;font:800 11px/1 var(--bsx-font-ui)` } });

    const nameLine = el('div', { attrs: { style: 'display:flex;align-items:baseline;gap:6px' } });
    nameLine.append(
      el('span', { text: e.name, attrs: { style: 'font:600 12px/1 var(--bsx-font-ui);color:var(--bsx-text-primary)' } }),
      el('span', { text: `#${e.id}`, className: 'bsx-mono', attrs: { style: 'font-size:10px;color:var(--bsx-text-micro)' } }),
    );

    const moraleFill = el('div', { className: 'bs-crew-morale-fill', attrs: { style: `height:100%;background:${moraleColor(e.morale)};width:${e.morale}%` } });
    const moraleTrack = el('div', { attrs: { style: 'width:44px;height:4px;border-radius:2px;overflow:hidden;background:#242c36' }, children: [moraleFill] });
    const moraleValue = el('span', { className: 'bs-crew-morale-value bsx-mono', text: `${Math.round(e.morale)}%`, attrs: { style: `font-size:11px;color:${moraleColor(e.morale)}` } });

    const roleLine = el('div', { attrs: { style: 'display:flex;align-items:center;gap:7px' } });
    roleLine.append(
      el('span', { text: t(`role.${e.role}`), attrs: { style: 'font:400 10px/1 var(--bsx-font-ui);color:var(--bsx-text-muted)' } }),
      moraleTrack, moraleValue,
    );

    const col = el('div', { attrs: { style: 'display:flex;flex-direction:column;gap:4px;min-width:0;flex:1' }, children: [nameLine, roleLine] });

    toggle.append(avatar, col, this.makeStatusTags(e, state), iconEl('chev', 12, 0.4));
    row.appendChild(toggle);

    if (expanded) {
      const detail = el('div', { className: 'bs-crew-detail bs-employee-detail', attrs: { style: 'padding:0 11px 12px;display:flex;flex-direction:column;gap:11px' } });
      detail.append(
        makeHiredLocationStrip(e, state),
        this.tag(makeNeedsSection(e), 'bs-crew-needs'),
        this.tag(makeCurrentTaskSection(e, state), 'bs-crew-task'),
        this.tag(makeSkillsSection(e), 'bs-crew-skills'),
        this.tag(makePaySection(e, amount => this.gameConsole?.(`employee raise ${e.id} amount:${amount}`)), 'bs-crew-pay'),
        this.tag(makeTrainingSection(e, state, (skill, buildingId) => this.gameConsole?.(`employee train ${e.id} skill:${skill} building:${buildingId}`)), 'bs-crew-training'),
        this.tag(makeDismissSection(e, () => this.requestDismiss(e)), 'bs-crew-dismiss'),
      );
      row.appendChild(detail);
    }
    return row;
  }

  private makeStatusTags(e: Employee, state: GameState): HTMLElement {
    const activity = computeEmployeeActivity(e, state.vehicles.vehicles);
    const wrap = el('div', { attrs: { style: 'display:flex;gap:4px;flex:0 0 auto' } });
    const tags: Array<{ icon: Parameters<typeof iconEl>[0]; color: string; tip: string }> = [];
    if (e.unionized) tags.push({ icon: 'union', color: 'var(--bsx-ore)', tip: t('ui.crew.tag_union') });
    if (e.injured) tags.push({ icon: 'injured', color: 'var(--bsx-critical-text)', tip: t('ui.crew.tag_injured') });
    if (e.collapsing) tags.push({ icon: 'collapse', color: 'var(--bsx-critical)', tip: t('ui.crew.tag_collapsed') });
    if (e.trainingState) tags.push({ icon: 'training', color: 'var(--bsx-info)', tip: t('ui.crew.tag_training') });
    if (activity.kind === 'driving') tags.push({ icon: 'drive', color: 'var(--bsx-info)', tip: t('ui.crew.tag_driving') });
    if (activity.kind === 'driving_to_task') tags.push({ icon: 'drive', color: 'var(--bsx-amber)', tip: t('ui.crew.tag_driving_task') });
    for (const tg of tags) {
      const chip = el('span', { attrs: { style: `color:${tg.color}`, title: tg.tip }, children: [iconEl(tg.icon, 13)] });
      wrap.appendChild(chip);
    }
    return wrap;
  }

  /**
   * fireEmployee splices the employee out permanently — there is no severance
   * payment or reversal — so this always routes through the shared confirm
   * overlay rather than firing on the first click.
   */
  private requestDismiss(e: Employee): void {
    this.onConfirmRequestCb?.({
      icon: 'injured',
      title: t('ui.crew.dismiss_confirm_title'),
      body: t('ui.crew.dismiss_confirm_body', { name: e.name }),
      confirmLabel: t('ui.crew.dismiss'),
      onConfirm: () => this.gameConsole?.(`employee fire ${e.id}`),
    });
  }
}
