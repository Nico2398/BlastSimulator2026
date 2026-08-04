// BlastSimulator2026 — Crew panel (redesign P6)
// Roster cards (avatar, morale, status tags) with an expandable detail per
// employee: hired/location, needs, current task, skills. Pay/raise, training,
// dismiss, and hiring land in the next task — this panel is read-only so far.
//
// Single expansion, unlike the old EmployeePanel's multi-expand Set: the
// design mock keeps exactly one card open at a time (clicking a second one
// closes the first), so `expandedId` is a lone id rather than a set.

import { t } from '../../core/i18n/I18n.js';
import { el } from '../dom.js';
import { iconEl } from '../icons.js';
import { LocaleTextRegistry } from '../localeText.js';
import type { GameState } from '../../core/state/GameState.js';
import type { Employee } from '../../core/entities/Employee.js';
import { computeEmployeeActivity } from '../../core/entities/EmployeeActivity.js';
import { roleColorHex, getInitials, moraleColor, makeHiredLocationStrip, makeNeedsSection, makeCurrentTaskSection, makeSkillsSection } from '../crewDetailSections.js';

export class CrewPanel {
  private readonly el: HTMLElement;
  private readonly bodyEl: HTMLElement;
  private onCloseCb?: () => void;
  private expandedId: number | null = null;
  private lastSignature = '';
  private lastState: GameState | null = null;
  private readonly locale = new LocaleTextRegistry();

  constructor(container: HTMLElement) {
    this.el = el('div', { className: 'bsx-root', attrs: { id: 'bs-crew-panel' } });
    this.el.style.cssText = [
      'flex-direction:column', 'width:372px', 'max-height:100%',
      'border-radius:8px', 'background:var(--bsx-panel)', 'border:1px solid var(--bsx-hairline-strong)',
      'box-shadow:0 18px 44px rgba(0,0,0,.55)', 'overflow:hidden', 'pointer-events:all',
    ].join(';');
    this.el.style.display = 'none';

    const header = el('div');
    header.style.cssText = 'flex:0 0 auto;display:flex;align-items:center;gap:10px;height:46px;padding:0 12px;background:#1a2028;border-bottom:1px solid var(--bsx-hairline)';
    const iconChip = el('div', { children: [iconEl('crew', 15)] });
    iconChip.style.cssText = 'width:26px;height:26px;border-radius:5px;display:flex;align-items:center;justify-content:center;background:rgba(255,91,76,.14);color:var(--bsx-critical-text)';
    const titleEl = this.locale.bindText(
      el('div', { attrs: { style: 'font:700 12px/1 var(--bsx-font-ui);letter-spacing:.14em;color:var(--bsx-text-primary)' } }),
      'ui.crew.title',
    );
    const closeBtn = el('button', { children: [iconEl('x', 12)] });
    closeBtn.style.cssText = 'margin-left:auto;width:28px;height:28px;display:flex;align-items:center;justify-content:center;border:1px solid var(--bsx-hairline-strong);border-radius:4px;background:transparent;color:var(--bsx-text-muted);cursor:pointer';
    closeBtn.addEventListener('click', () => this.onCloseCb?.());
    header.append(iconChip, titleEl, closeBtn);

    this.bodyEl = el('div');
    this.bodyEl.style.cssText = 'flex:1 1 auto;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px';

    this.el.append(header, this.bodyEl);
    container.appendChild(this.el);
  }

  get root(): HTMLElement { return this.el; }
  setCloseHandler(cb: () => void): void { this.onCloseCb = cb; }

  show(): void { this.el.style.display = 'flex'; }
  hide(): void { this.el.style.display = 'none'; }
  get visible(): boolean { return this.el.style.display !== 'none'; }

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

  dispose(): void { this.el.remove(); }

  /**
   * Structural facts only: which rows exist, and — for the one expanded row
   * — which controls it shows. Morale, need gauges, and task countdowns
   * drift every tick on their own; including them here would force a full
   * rebuild every tick and drop whatever the player is mid-click on.
   * refreshDynamic() below writes those in place instead.
   */
  private computeSignature(state: GameState): string {
    const rows = state.employees.employees
      .filter(e => e.alive)
      .map(e => {
        const quals = e.qualifications.map(q => `${q.category}${q.proficiencyLevel}`).join(',');
        const activity = computeEmployeeActivity(e, state.vehicles.vehicles);
        return `${e.id}:${e.role}:${e.unionized ? 1 : 0}:${e.injured ? 1 : 0}:${e.collapsing ? 1 : 0}`
          + `:${e.trainingState ? 1 : 0}:${activity.kind}:${e.name}:${quals}`;
      })
      .join('|');
    return `${rows}#${this.expandedId ?? '-'}`;
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
    if (employees.length === 0) {
      this.bodyEl.replaceChildren(el('div', { className: 'bsx-empty', text: t('ui.crew.none') }));
      return;
    }
    this.bodyEl.replaceChildren(...employees.map(e => this.makeRosterCard(e, state)));
  }

  private makeRosterCard(e: Employee, state: GameState): HTMLElement {
    const expanded = e.id === this.expandedId;
    const row = el('div', { attrs: { 'data-employee-id': String(e.id) } });
    row.style.cssText = `border-radius:var(--bsx-r-card);overflow:hidden;border:1px solid ${
      expanded ? 'rgba(255,176,46,.4)' : e.collapsing ? 'rgba(255,91,76,.4)' : 'var(--bsx-hairline)'
    };background:${expanded ? 'rgba(255,176,46,.07)' : 'var(--bsx-card)'}`;

    const toggle = el('button', { attrs: { style: 'width:100%;display:flex;align-items:center;gap:10px;padding:10px 11px;border:0;background:transparent;cursor:pointer;text-align:left' } });
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
    const moraleTrack = el('div', { attrs: { style: 'width:44px;height:4px;border-radius:2px;background:#242c36;overflow:hidden' }, children: [moraleFill] });
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
      const detail = el('div', { className: 'bs-crew-detail', attrs: { style: 'padding:0 11px 12px;display:flex;flex-direction:column;gap:11px' } });
      detail.append(
        makeHiredLocationStrip(e, state),
        this.tag(makeNeedsSection(e), 'bs-crew-needs'),
        this.tag(makeCurrentTaskSection(e, state), 'bs-crew-task'),
        this.tag(makeSkillsSection(e), 'bs-crew-skills'),
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
    for (const tg of tags) {
      const chip = el('span', { attrs: { style: `color:${tg.color}`, title: tg.tip }, children: [iconEl(tg.icon, 13)] });
      wrap.appendChild(chip);
    }
    return wrap;
  }
}
