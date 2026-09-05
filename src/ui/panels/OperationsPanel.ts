// BlastSimulator2026 — Operations panel (redesign P5)
// Logistics (fragments + storage), ore on hand, last ore report, incidents
// (DamageState), and site policy — migrated out of Settings, where it never
// belonged (a strategic lever buried in an app-settings menu).
//
// Deviations from the design mock: tonnes ("21.4 t") become kilograms, matching
// every other kg-denominated number in this UI (Contracts, Charge) rather than
// mixing units. The stored row drops the mock's specific warehouse-building
// name ("The Slightly Bigger Pile (T2)") — correlating stored mass back to a
// particular placed building isn't data logistics tracks. Incidents resolve
// real names: employees stay in their array with alive:false so a live lookup
// always works; buildings/vehicles use the entityLabel type snapshot added in
// P5-core, since destroyBuilding/destroyVehicle splice the entity out (a plain
// live lookup after a *_destroyed accident would find nothing).

import { PanelBase } from './PanelBase.js';
import { t } from '../../core/i18n/I18n.js';
import { el, card, sectionHeader, emptyState, chip, button, panelRoot, panelHeader, panelBody, scrollBoundedSection } from '../dom.js';
import { iconEl } from '../icons.js';
import { LocaleTextRegistry } from '../localeText.js';
import { formatMoney } from '../../core/economy/formatMoney.js';
import { getFragmentCounts } from '../../core/economy/Logistics.js';
import { getOre } from '../../core/world/OreCatalog.js';
import { ACCIDENT_STYLE, accidentText } from '../accidentLookup.js';
import type { ShiftMode } from '../../core/entities/SitePolicy.js';
import type { GameState, PendingAction, PendingActionStatus } from '../../core/state/GameState.js';
import type { AccidentRecord } from '../../core/entities/Damage.js';
import type { GameConsoleFn } from '../gameConsole.js';
import { ACTION_LABEL_KEY } from '../crewDetailSections.js';


const RECENT_INCIDENTS = 10;

/** Shift modes accepted by `set_policy` (mirrors SettingsMenu.ts's own list — SitePolicy.ts doesn't export one). */
const SHIFT_MODES: ShiftMode[] = ['shift_8h', 'shift_12h', 'continuous', 'custom'];

const WORK_QUEUE_STATUS_KEY: Record<PendingActionStatus, string> = {
  queued: 'ui.operations.work_queue_status_queued',
  assigned: 'ui.operations.work_queue_status_assigned',
  in_progress: 'ui.operations.work_queue_status_in_progress',
};

export class OperationsPanel extends PanelBase {
  private readonly bodyEl: HTMLElement;
  private readonly shiftButtons: Record<ShiftMode, HTMLButtonElement>;
  private readonly fatigueInput: HTMLInputElement;
  private readonly policyStatusEl: HTMLElement;
  private readonly policyCard: HTMLElement;
  private readonly policyNoteEl: HTMLElement;
  private gameConsole?: GameConsoleFn;
  /** True once the player has touched a policy control — stops sync clobbering (mirrors SettingsMenu's old behavior). */
  private policyDirty = false;
  private activeShift: ShiftMode = 'shift_8h';
  private lastSignature = '';
  private readonly locale = new LocaleTextRegistry();

  constructor(container: HTMLElement) {
    super(panelRoot('bs-operations-panel'));

    const { header, titleEl } = panelHeader({
      icon: 'ops',
      accent: 'amber',
      onClose: () => this.onCloseCb?.(),
    });
    this.locale.bindText(titleEl, 'ui.operations.title');

    this.bodyEl = panelBody(10);

    // Site policy controls are built once and reused across re-renders (they
    // carry live edit state — policyDirty, in-progress input values — that a
    // signature-gated rebuild must not clobber mid-edit).
    this.shiftButtons = {} as Record<ShiftMode, HTMLButtonElement>;
    const shiftRow = el('div', { attrs: { id: 'bs-policy-shift' } });
    shiftRow.style.cssText = 'display:flex;gap:3px';
    for (const mode of SHIFT_MODES) {
      const btn = el('button', { className: 'bsx-mono', attrs: { 'data-shift-mode': mode } });
      btn.style.cssText = 'flex:1;height:28px;border:0;border-radius:4px;background:transparent;color:var(--bsx-text-secondary);font-size:10px;font-weight:600;cursor:pointer';
      this.locale.bindText(btn, `ui.policy.${mode}`);
      btn.addEventListener('click', () => { this.policyDirty = true; this.setActiveShift(mode); });
      this.shiftButtons[mode] = btn;
      shiftRow.appendChild(btn);
    }

    this.fatigueInput = this.makeThresholdInput('bs-policy-fatigue');
    const applyBtn = el('button', { className: 'bsx-btn bsx-btn-primary', attrs: { id: 'bs-policy-apply' } });
    applyBtn.style.cssText = 'width:100%;height:32px;margin-top:2px';
    applyBtn.dataset['action'] = 'apply-policy';
    this.locale.bindText(applyBtn, 'ui.policy.apply');
    applyBtn.addEventListener('click', () => this.applyPolicy());
    this.policyStatusEl = el('span', { attrs: { style: 'font:500 10px/1.4 var(--bsx-font-ui);color:var(--bsx-positive);min-height:12px' } });

    const thresholdRow = el('div');
    thresholdRow.style.cssText = 'display:flex;gap:8px';
    thresholdRow.append(
      this.makeThresholdCol('ui.policy.fatigue', this.fatigueInput),
    );

    this.policyNoteEl = el('span', { attrs: { style: 'font:400 10px/1.4 var(--bsx-font-ui);color:var(--bsx-text-micro)' } });
    this.policyCard = card([
      this.locale.bindText(el('span', { attrs: { style: 'font:600 10px/1 var(--bsx-font-ui);letter-spacing:.1em;color:var(--bsx-text-micro)' } }), 'ui.policy.shift_mode'),
      shiftRow,
      this.policyNoteEl,
      thresholdRow,
      applyBtn,
      this.policyStatusEl,
    ]);
    this.setActiveShift(this.activeShift);

    this.el.append(header, this.bodyEl);
    container.appendChild(this.el);
  }

  setGameConsole(fn: GameConsoleFn): void { this.gameConsole = fn; }


  update(state: GameState): void {
    if (!this.policyDirty) {
      this.setActiveShift(state.sitePolicy.shiftMode);
      this.fatigueInput.value = String(state.sitePolicy.fatigueRestThreshold);
    }

    const signature = JSON.stringify({
      stored: Math.round(state.logistics.storedMassKg), cap: state.logistics.storageCapacityKg,
      fragCount: state.logistics.fragments.length,
      ore: state.collectedOre,
      oreReport: state.lastOreReport,
      accidents: state.damage.accidents.length,
      injured: state.employees.employees.filter(e => e.injured && e.alive).map(e => e.id),
      unclaimed: state.pendingActions.filter(a => a.status === 'queued').length,
      // Every live (non-rest) action's id/status/holder — so a claim or a
      // cancellation (#548) triggers a rebuild of the Work Queue section,
      // not just the count already covered by `unclaimed` above.
      workQueue: state.pendingActions
        .filter(a => a.type !== 'rest')
        .map(a => `${a.id}:${a.status}:${a.holderId}`),
      policy: state.sitePolicy.revision,
    });
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;
    this.render(state);
  }

  refreshLocale(): void {
    this.locale.refresh();
    this.setActiveShift(this.activeShift);
    this.lastSignature = '';
  }


  private render(state: GameState): void {
    const sections: HTMLElement[] = [
      sectionHeader(t('ui.operations.logistics')),
      this.makeLogisticsRows(state),
      sectionHeader(t('ui.operations.work_queue')),
      scrollBoundedSection(this.makeWorkQueueRows(state), 220),
      sectionHeader(t('ui.operations.ore_on_hand')),
      ...this.makeOreRows(state),
      sectionHeader(t('ui.operations.last_ore_report')),
      this.makeOreReportCard(state),
      sectionHeader(t('ui.operations.incidents')),
      scrollBoundedSection([...this.makeInjuredList(state), ...this.makeIncidentRows(state)], 200),
      sectionHeader(t('ui.policy.title')),
      this.policyCard,
    ];
    this.bodyEl.replaceChildren(...sections);
  }

  // ── Logistics ──

  private makeLogisticsRows(state: GameState): HTMLElement {
    const counts = getFragmentCounts(state.logistics);
    let onGroundKg = 0, inTransitKg = 0;
    for (const f of state.logistics.fragments) {
      if (f.state === 'on_ground') onGroundKg += f.fragment.mass;
      else if (f.state === 'in_transit') inTransitKg += f.fragment.mass;
    }
    const cap = state.logistics.storageCapacityKg;
    const storedPct = cap > 0 ? Math.round((state.logistics.storedMassKg / cap) * 100) : 0;
    // One line for every action nobody has claimed yet, instead of the same
    // pool action repeating on every eligible idle employee's own row — the
    // new CrewPanel shows only an employee's own claimed activity, so this is
    // now the only place an unclaimed action is visible at all (#39).
    const unclaimed = state.pendingActions.filter(a => a.status === 'queued').length;

    const wrap = el('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:6px';
    wrap.append(
      this.makeLogisticsRow(t('ui.operations.on_ground'), t('ui.operations.fragment_count', { count: counts.onGround }), t('ui.operations.mass_kg', { kg: Math.round(onGroundKg).toLocaleString('en-US') })),
      this.makeLogisticsRow(t('ui.operations.in_transit'), t('ui.operations.fragment_count', { count: counts.inTransit }), t('ui.operations.mass_kg', { kg: Math.round(inTransitKg).toLocaleString('en-US') })),
      this.makeLogisticsRow(t('ui.operations.stored'), `${Math.round(state.logistics.storedMassKg).toLocaleString('en-US')} / ${cap.toLocaleString('en-US')} kg`, t('ui.operations.storage_pct', { pct: storedPct })),
      this.makeLogisticsRow(t('ui.operations.unclaimed_work'), t('ui.operations.unclaimed_work_count', { count: unclaimed }), t('ui.operations.unclaimed_work_note')),
    );
    return wrap;
  }

  private makeLogisticsRow(label: string, value: string, note: string): HTMLElement {
    const row = el('div');
    row.style.cssText = 'display:flex;flex-direction:column;gap:4px;padding:10px 11px;border-radius:5px;background:var(--bsx-well)';
    const head = el('div');
    head.style.cssText = 'display:flex;align-items:baseline;gap:8px';
    head.append(
      el('span', { text: label, attrs: { style: 'font:500 11px/1 var(--bsx-font-ui);color:var(--bsx-text-secondary)' } }),
      el('span', { text: value, attrs: { style: 'margin-left:auto;font:600 12px/1 var(--bsx-font-mono)' } }),
    );
    row.append(head, el('span', { text: note, attrs: { style: 'font:400 10px/1 var(--bsx-font-ui);color:var(--bsx-text-micro)' } }));
    return row;
  }

  // ── Work Queue ──

  /**
   * Renders one row per active, player-cancellable PendingAction — every
   * live entry except 'rest', which is engine-owned (needs/collapse/shift
   * cycle) and never player-cancellable (#548).
   */
  private makeWorkQueueRows(state: GameState): HTMLElement[] {
    const live = state.pendingActions.filter(a => a.type !== 'rest');
    if (live.length === 0) return [emptyState(t('ui.operations.work_queue_empty'))];
    return live.map(a => this.makeWorkQueueRow(a, state));
  }

  private makeWorkQueueRow(action: PendingAction, state: GameState): HTMLElement {
    const holder = action.holderId !== null
      ? state.employees.employees.find(e => e.id === action.holderId)
      : undefined;
    const holderText = action.holderId === null
      ? t('ui.operations.work_queue_holder_unclaimed')
      : holder
        ? holder.name
        : t('ui.operations.work_queue_holder_unknown');

    const row = el('div');
    row.style.cssText = 'display:flex;flex-direction:column;gap:4px;padding:9px 11px;border:1px solid var(--bsx-hairline);border-radius:5px;background:var(--bsx-card)';

    const headRow = el('div', { attrs: { style: 'display:flex;align-items:center;gap:8px' } });
    headRow.append(
      el('span', { text: t(ACTION_LABEL_KEY[action.type]), attrs: { style: 'font:600 11px/1 var(--bsx-font-ui)' } }),
      el('span', {
        text: t('ui.crew.location_coords', { x: action.targetX, z: action.targetZ }),
        className: 'bsx-mono',
        attrs: { style: 'font-size:10px;color:var(--bsx-text-micro)' },
      }),
      chip(t(WORK_QUEUE_STATUS_KEY[action.status]), action.status === 'in_progress' ? 'info' : 'neutral'),
    );

    const footRow = el('div', { attrs: { style: 'display:flex;align-items:center;gap:8px' } });
    const cancelBtn = button('danger', t('ui.operations.work_queue_cancel'));
    cancelBtn.style.cssText = 'margin-left:auto;height:24px;padding:0 10px;font:600 10px/1 var(--bsx-font-mono)';
    cancelBtn.dataset['cancelAction'] = String(action.id);
    cancelBtn.addEventListener('click', () => this.gameConsole?.(`employee cancel ${action.id}`));
    footRow.append(
      el('span', { text: holderText, attrs: { style: 'font:500 11px/1 var(--bsx-font-ui);color:var(--bsx-text-secondary)' } }),
      cancelBtn,
    );

    row.append(headRow, footRow);
    return row;
  }

  // ── Ore on hand ──

  private makeOreRows(state: GameState): HTMLElement[] {
    const entries = Object.entries(state.collectedOre).filter(([, kg]) => kg > 0.5);
    if (entries.length === 0) return [emptyState(t('ui.operations.no_ore'))];
    return entries.map(([oreId, kg]) => {
      const ore = getOre(oreId);
      const row = el('div');
      row.style.cssText = 'display:flex;align-items:center;gap:9px;padding:9px 11px;border:1px solid var(--bsx-hairline);border-radius:5px;background:var(--bsx-card)';
      const dot = el('span');
      dot.style.cssText = `width:8px;height:8px;border-radius:2px;background:${ore?.color ?? '#8a94a2'}`;
      row.append(
        dot,
        el('span', { text: ore ? t(ore.nameKey) : oreId, attrs: { style: 'font:600 11px/1 var(--bsx-font-ui)' } }),
        el('span', { text: `${Math.round(kg).toLocaleString('en-US')} kg`, attrs: { style: 'margin-left:auto;font:500 11px/1 var(--bsx-font-mono);color:var(--bsx-text-secondary)' } }),
        el('span', { text: `$${formatMoney(kg * (ore?.valuePerKg ?? 0))}`, attrs: { style: 'font:600 11px/1 var(--bsx-font-mono);color:var(--bsx-positive);width:64px;text-align:right' } }),
      );
      return row;
    });
  }

  // ── Last ore report ──

  private makeOreReportCard(state: GameState): HTMLElement {
    const report = state.lastOreReport;
    if (!report || report.estimatedYieldKg <= 0) return emptyState(t('ui.operations.no_ore_report'));

    const pct = Math.round(report.yieldRatio * 100);
    const breakdown = Object.entries(report.oreYields)
      .filter(([, kg]) => kg > 0)
      .map(([oreId, kg]) => `${t(`ore.${oreId}.name`)} ${kg.toFixed(0)} kg`)
      .join(' · ');

    const headRow = el('div');
    headRow.style.cssText = 'display:flex;align-items:baseline;gap:8px';
    headRow.append(
      el('span', { text: t('ui.blast_workshop.report.ore_report'), attrs: { style: 'font:600 12px/1 var(--bsx-font-ui)' } }),
      el('span', { text: `${pct}%`, attrs: { style: 'margin-left:auto;font:600 14px/1 var(--bsx-font-mono);color:var(--bsx-ore)' } }),
    );
    const detail = el('span', {
      text: t('ui.blast_workshop.report.ore_detail', { actual: report.totalYieldKg.toFixed(0), estimate: report.estimatedYieldKg.toFixed(0), breakdown }),
      attrs: { style: 'font:400 11px/1.4 var(--bsx-font-ui);color:var(--bsx-text-secondary)' },
    });

    const chips: HTMLElement[] = [];
    if (report.hasTreranium) chips.push(chip(t('ui.operations.has_treranium', { ore: t('ore.treranium.name') }), 'ore'));
    if (report.absurdiumFraction > 0) {
      chips.push(chip(t('ui.operations.absurdium_fraction', { pct: Math.round(report.absurdiumFraction * 100), ore: t('ore.absurdium.name') }), 'ore'));
    }
    const chipsRow = chips.length > 0 ? el('div', { attrs: { style: 'display:flex;gap:5px;flex-wrap:wrap' }, children: chips }) : null;

    return card([headRow, detail, chipsRow]);
  }

  // ── Incidents ──

  private makeInjuredList(state: GameState): HTMLElement[] {
    const injured = state.employees.employees.filter(e => e.injured && e.alive);
    if (injured.length === 0) return [];
    const wrap = el('div');
    wrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:5px';
    for (const e of injured) {
      wrap.appendChild(chip(t('ui.operations.injured_chip', { name: e.name }), 'critical'));
    }
    return [wrap];
  }

  private makeIncidentRows(state: GameState): HTMLElement[] {
    const recent = state.damage.accidents.slice(-RECENT_INCIDENTS).reverse();
    if (recent.length === 0) return [emptyState(t('ui.operations.no_incidents'))];
    return recent.map(a => this.makeIncidentRow(a, state));
  }

  private makeIncidentRow(a: AccidentRecord, state: GameState): HTMLElement {
    const style = ACCIDENT_STYLE[a.type];
    const color = style.critical ? 'var(--bsx-critical-text)' : 'var(--bsx-amber)';
    const day = Math.floor(a.tick / 24) + 1;

    const row = el('div');
    row.style.cssText = 'display:flex;gap:9px;padding:9px 10px;border-radius:4px;background:var(--bsx-well)';
    row.append(
      el('div', { attrs: { style: `color:${color};padding-top:1px` }, children: [iconEl(style.icon, 13)] }),
      el('div', {
        attrs: { style: 'display:flex;flex-direction:column;gap:3px;flex:1' },
        children: [
          el('span', { text: accidentText(a, state), attrs: { style: 'font:500 11px/1.3 var(--bsx-font-ui)' } }),
          el('span', { text: t('ui.operations.day_label', { day }), attrs: { style: 'font:400 11px/1 var(--bsx-font-mono);color:var(--bsx-text-micro)' } }),
        ],
      }),
    );
    return row;
  }

  // ── Site policy ──

  private makeThresholdInput(id: string): HTMLInputElement {
    const input = el('input', { className: 'bs-input', attrs: { id, type: 'number', min: '0', max: '100', step: '5' } }) as HTMLInputElement;
    input.style.cssText = 'width:100%;height:28px;padding:0 8px;border:1px solid rgba(255,255,255,.1);border-radius:4px;background:var(--bsx-well);color:var(--bsx-text-primary);font:600 11px/1 var(--bsx-font-mono)';
    input.addEventListener('input', () => { this.policyDirty = true; });
    return input;
  }

  private makeThresholdCol(labelKey: string, input: HTMLInputElement): HTMLElement {
    const col = el('div');
    col.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:5px';
    col.append(this.locale.bindText(el('span', { attrs: { style: 'font:600 10px/1 var(--bsx-font-ui);letter-spacing:.1em;color:var(--bsx-text-micro)' } }), labelKey), input);
    return col;
  }

  /**
   * Paints the active pill and the mode's note. Plain t() rather than the
   * LocaleTextRegistry: registry bindings are for text set once at
   * construction, and this runs on every pill click — going through
   * bindText() here would push a new binding on every click, accumulating
   * forever. refreshLocale() calls this again after a language switch
   * instead, which re-derives the same text in the new language.
   */
  private setActiveShift(mode: ShiftMode): void {
    this.activeShift = mode;
    for (const [m, btn] of Object.entries(this.shiftButtons) as [ShiftMode, HTMLButtonElement][]) {
      const active = m === mode;
      btn.style.background = active ? 'var(--bsx-amber)' : 'transparent';
      btn.style.color = active ? 'var(--bsx-text-on-amber)' : 'var(--bsx-text-secondary)';
    }
    this.policyNoteEl.textContent = t(`ui.policy.note_${mode}`);
  }

  private applyPolicy(): void {
    const result = this.gameConsole?.(
      `set_policy mode:${this.activeShift}` +
      ` fatigue:${this.fatigueInput.value}`,
    );
    this.policyDirty = false;
    this.policyStatusEl.textContent = result?.success ? t('ui.policy.applied') : (result?.output ?? '');
    setTimeout(() => { this.policyStatusEl.textContent = ''; }, 3000);
  }
}
