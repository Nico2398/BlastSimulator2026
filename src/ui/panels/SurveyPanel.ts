// BlastSimulator2026 — Survey panel (redesign P7)
// Method cards (cost/accuracy/radius/depth/duration/note, incl. the seismic
// damage warning), PICK TARGET IN SCENE (migrated from SurveyUI.ts's already-
// working PlacementKit wiring), then a results list: age, a stale badge
// (isSurveyStale, set by markSurveysStaleByBlast once a blast clears a column in the survey's disc), a locate button (same
// window.__cameraFocus bridge as FleetPanel's, P6), ore bars, confidence.
//
// Root id, [data-method] on method rows, #bs-survey-run, and .bs-survey-status
// (read by uiActionProbe.ts's REGION_HINTS to explain a disabled Run) are
// preserved from the old SurveyUI so tutorialStages.ts and uiActionProbe.ts
// keep resolving unchanged — same convention FleetPanel/CrewPanel established
// for their own root ids in P6.

import { PanelBase } from './PanelBase.js';
import { makeLocateButton, focusCameraOn } from '../locateButton.js';
import { t } from '../../core/i18n/I18n.js';
import { el, card, button, sectionHeader, emptyState, reasonLine, paintToggleButton, panelRoot, panelHeader, panelHeaderButton, panelBody } from '../dom.js';
import { iconEl } from '../icons.js';
import { LocaleTextRegistry } from '../localeText.js';
import type { GameState } from '../../core/state/GameState.js';
import { surveyCostFor, type SurveyMethod, type SurveyResult } from '../../core/mining/SurveyCalc.js';
import { isSurveyStale } from '../../core/mining/SurveyStaleness.js';
import {
  SURVEY_BASE_ERROR, SURVEY_COVERAGE_RADIUS, SURVEY_DURATION_TICKS, SURVEY_DEPTH_BELOW_SURFACE,
  SEISMIC_SURVEY_DAMAGE_RADIUS, SEISMIC_SURVEY_DAMAGE_HP,
} from '../../core/config/balance.js';
import { armPointPick, type PlacementKit } from '../scene/PlacementKit.js';
import { buildDepthLog } from './surveyDepthSection.js';
import { resolveMarketId } from '../../core/campaign/Level.js';
import type { MarketId } from '../../core/economy/Market.js';
import { summarizeSurveyOres } from '../../core/mining/SurveyOreSummary.js';
import { buildOreRows } from './surveyOreRows.js';
import type { GameConsoleFn } from '../gameConsole.js';
import type { NotifyInput } from '../notify/NotificationCenter.js';


/** Qualification a surveyor needs before any survey can be dispatched. */
const SURVEYOR_SKILL = 'geology';

/** How long (ms) a panel-produced status message survives update() calls. */
const STATUS_HOLD_MS = 5000;

/** Most recent surveys shown, newest first — matches the old panel's cap and the design's own sample count. */
const MAX_RESULTS_SHOWN = 4;

/** Ores listed per result card, richest by estimated value first. */
const MAX_ORES_SHOWN = 4;

/** Methods offered, cheapest first so the tutorial's default is affordable. */
const METHOD_ORDER: SurveyMethod[] = ['core_sample', 'seismic', 'aerial'];

export class SurveyPanel extends PanelBase {
  private readonly bodyEl: HTMLElement;
  private readonly methodsEl: HTMLElement;
  private readonly runBtn: HTMLButtonElement;
  private readonly blockerEl: HTMLElement;
  private readonly blockerTextEl: HTMLElement;
  private readonly hireBtn: HTMLButtonElement;
  private readonly statusEl: HTMLElement;
  private readonly resultsEl: HTMLElement;
  private gameConsole?: GameConsoleFn;
  private readonly overlayToggleBtn: HTMLButtonElement;
  private readonly wallToggleBtn: HTMLButtonElement;
  /** Wall stability overlay preference (#1943), mirrored from GameRenderer via UIManager; off by default. */
  private wallOverlayVisible = false;
  private onToggleWallOverlayCb?: (visible: boolean) => void;
  /** Player-facing visibility preference for the survey confidence overlay (#496), mirrored from GameRenderer via UIManager. */
  private overlayVisible = true;
  private onToggleOverlayCb?: (visible: boolean) => void;
  private notifyCb?: (n: NotifyInput) => void;
  private hireSurveyorCb?: () => void;
  private placementKit: PlacementKit | null = null;
  private selectedMethod: SurveyMethod = 'seismic';
  private worldSizeX = 40;
  private worldSizeZ = 40;
  /** West/north edge of the site's bounding box — the point tool's initial-selection centre (#473). */
  private worldOriginX = 0;
  private worldOriginZ = 0;
  private lastResultCount = -1;
  private lastPendingCount = -1;
  private statusIsTransient = false;
  private statusTimer: ReturnType<typeof setTimeout> | null = null;
  private lastState: GameState | null = null;
  private readonly locale = new LocaleTextRegistry();

  constructor(container: HTMLElement) {
    super(panelRoot('bs-survey-panel'));

    // Player-facing toggle for the survey confidence overlay (#496) — a
    // view-only preference, wired up (click handler, tooltip, pressed state)
    // by the implementer.
    this.overlayToggleBtn = panelHeaderButton('survey', () => this.handleOverlayToggleClick());
    this.overlayToggleBtn.setAttribute('data-role', 'overlay-toggle');
    this.locale.bindTitle(this.overlayToggleBtn, 'ui.survey.overlay_toggle_tip');

    this.wallToggleBtn = panelHeaderButton('warn', () => this.handleWallToggleClick());
    this.wallToggleBtn.setAttribute('data-role', 'wall-overlay-toggle');
    this.locale.bindTitle(this.wallToggleBtn, 'ui.survey.wall_overlay_toggle_tip');

    const { header, titleEl } = panelHeader({
      icon: 'survey',
      accent: 'info',
      extras: [this.overlayToggleBtn, this.wallToggleBtn],
      onClose: () => this.onCloseCb?.(),
    });
    this.locale.bindText(titleEl, 'ui.survey.title');

    this.bodyEl = panelBody(9);

    this.methodsEl = el('div', { attrs: { style: 'display:flex;flex-direction:column;gap:7px' } });

    this.runBtn = button('primary', t('ui.survey.pick_target_scene'), { icon: 'locate' });
    this.runBtn.id = 'bs-survey-run';
    this.runBtn.style.cssText = 'width:100%;height:38px';
    this.runBtn.addEventListener('click', () => this.pickTargetAndRun());

    this.statusEl = el('div', { className: 'bs-survey-status' });
    this.statusEl.style.cssText = 'font:400 10px/1.4 var(--bsx-font-ui);color:var(--bsx-text-muted);min-height:14px';

    this.resultsEl = el('div', { attrs: { style: 'display:flex;flex-direction:column;gap:8px' } });

    // Prominent no-surveyor block above the method list; shown only while blocked on that.
    this.blockerTextEl = el('div', { attrs: { style: 'font:600 12px/1.4 var(--bsx-font-ui);color:var(--bsx-critical-text)' } });
    this.hireBtn = button('primary', t('ui.survey.hire_surveyor'));
    this.hireBtn.id = 'bs-survey-hire';
    this.hireBtn.style.cssText = 'width:100%;height:34px';
    this.hireBtn.addEventListener('click', () => this.hireSurveyorCb?.());
    this.blockerEl = el('div', {
      className: 'bs-survey-blocker',
      attrs: { style: 'display:none;flex-direction:column;gap:8px;padding:10px 11px;border:1px solid var(--bsx-critical-text);border-radius:5px;background:var(--bsx-card)' },
    });
    this.blockerEl.append(this.blockerTextEl, this.hireBtn);

    this.bodyEl.append(
      this.blockerEl,
      sectionHeader(t('ui.survey.method')),
      this.methodsEl,
      this.runBtn,
      this.statusEl,
      sectionHeader(t('ui.survey.results')),
      this.resultsEl,
    );
    // The body is the scroll region: its children keep their natural height
    // rather than flex-shrinking (a squashed button, clipped result cards).
    for (const child of Array.from(this.bodyEl.children)) (child as HTMLElement).style.flexShrink = '0';

    this.el.append(header, this.bodyEl);
    container.appendChild(this.el);

    this.buildMethodList();
    this.syncOverlayButton();
    paintToggleButton(this.wallToggleBtn, this.wallOverlayVisible);
  }

  setGameConsole(fn: GameConsoleFn): void { this.gameConsole = fn; }
  setPlacementKit(kit: PlacementKit): void { this.placementKit = kit; }

  /** Register the callback fired when the player clicks the overlay-visibility toggle button (#496). */
  setOverlayToggleHandler(cb: (visible: boolean) => void): void { this.onToggleOverlayCb = cb; }

  /**
   * External sync path (keyboard-shortcut flow via main.ts/UIManager, #496):
   * reflect the survey confidence overlay's current visibility preference in
   * the toggle button's state. Must NOT invoke onToggleOverlayCb — that would
   * feed back into the renderer that just called this.
   */
  setOverlayVisible(visible: boolean): void {
    this.overlayVisible = visible;
    this.syncOverlayButton();
  }


  /** Wire the notification sink used when a blocked method is clicked. */
  setNotifyHandler(cb: (n: NotifyInput) => void): void {
    this.notifyCb = cb;
  }

  /** Wire the blocker's hire button (opens Crew hiring for the surveyor role). */
  setHireSurveyorHandler(cb: () => void): void {
    this.hireSurveyorCb = cb;
  }

  refreshLocale(): void {
    this.locale.refresh();
    this.runBtn.replaceChildren();
    this.runBtn.appendChild(iconEl('locate', 12));
    this.runBtn.appendChild(el('span', { text: t('ui.survey.pick_target_scene') }));
    this.blockerTextEl.textContent = t('ui.survey.no_surveyor');
    this.hireBtn.textContent = t('ui.survey.hire_surveyor');
    this.methodsEl.replaceChildren();
    this.buildMethodList();
    this.lastResultCount = -1;
    this.lastPendingCount = -1;
    if (this.lastState) this.update(this.lastState);
  }

  override dispose(): void {
    if (this.statusTimer) clearTimeout(this.statusTimer);
    super.dispose();
  }

  update(state: GameState): void {
    this.lastState = state;
    if (state.world) {
      this.worldSizeX = state.world.sizeX;
      this.worldSizeZ = state.world.sizeZ;
      this.worldOriginX = state.world.minX;
      this.worldOriginZ = state.world.minZ;
    }

    const hasSurveyor = this.hasSurveyor(state);
    const reason = this.blockReason(state);
    this.runBtn.disabled = reason !== null;
    this.blockerTextEl.textContent = t('ui.survey.no_surveyor');
    this.blockerEl.style.display = hasSurveyor ? 'none' : 'flex';

    // Deliberately not filtered by status like OperationsPanel's `unclaimed`
    // count (status === 'queued') — this is meant to span the whole
    // queued+assigned+in_progress window, matching this panel's "in
    // progress" label. Pre-#547, claiming deleted the record immediately, so
    // this undercounted (a claimed-but-not-yet-complete survey vanished from
    // the total); now the record persists through completion, so this
    // correctly reflects everything still underway. Don't "fix" this to
    // match OperationsPanel's filter.
    const pending = state.pendingActions.filter(a => a.type === 'survey').length;
    const done = state.surveyResults.length;

    // Blockers outrank progress: the player needs to know *why* Run is greyed
    // out. A message the panel itself just set (queued, or a command error)
    // wins over both until it expires — otherwise this would wipe it next frame.
    if (reason !== null) {
      this.showStatus(reason);
    } else if (pending > 0) {
      this.showStatus(t('ui.survey.in_progress', { count: String(pending) }));
    } else if (!this.statusIsTransient) {
      this.showStatus('');
    }

    // Refresh the readout only when a count moves, not on every rendered frame.
    if (pending !== this.lastPendingCount || done !== this.lastResultCount) {
      this.lastPendingCount = pending;
      this.lastResultCount = done;
      this.renderResults(state.surveyResults, state.tickCount, resolveMarketId(state));
    }
  }

  /** Register the callback fired when the player clicks the wall stability overlay toggle (#1943). */
  setWallOverlayToggleHandler(cb: (visible: boolean) => void): void { this.onToggleWallOverlayCb = cb; }

  /** External sync path (shortcut flow): reflect the wall overlay preference without firing the handler. */
  setWallOverlayVisible(visible: boolean): void {
    this.wallOverlayVisible = visible;
    paintToggleButton(this.wallToggleBtn, visible);
  }

  private handleWallToggleClick(): void {
    this.setWallOverlayVisible(!this.wallOverlayVisible);
    this.onToggleWallOverlayCb?.(this.wallOverlayVisible);
  }

  /** Overlay-toggle button click (#496): delegate to the same set-and-repaint path the external sync uses, then notify. */
  private handleOverlayToggleClick(): void {
    this.setOverlayVisible(!this.overlayVisible);
    this.onToggleOverlayCb?.(this.overlayVisible);
  }

  /** Paint the toggle button's on/off visual state, matching MiniMap's own nav-toggle-button convention. */
  private syncOverlayButton(): void {
    paintToggleButton(this.overlayToggleBtn, this.overlayVisible);
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /**
   * Write a status that reflects current state. Also releases any transient
   * hold — otherwise the hold would pin whatever was last displayed, so a
   * finished survey kept reading "1 in progress" until the timer expired.
   */
  private showStatus(msg: string): void {
    this.statusEl.textContent = msg;
    this.statusIsTransient = false;
    if (this.statusTimer) {
      clearTimeout(this.statusTimer);
      this.statusTimer = null;
    }
  }

  /** Show a message the panel itself produced (dispatch confirmation, command error) and protect it from the next update() for a few seconds. */
  private setTransientStatus(msg: string): void {
    this.showStatus(msg);
    this.statusIsTransient = true;
    this.statusTimer = setTimeout(() => {
      this.statusIsTransient = false;
      this.statusTimer = null;
    }, STATUS_HOLD_MS);
  }

  private buildMethodList(): void {
    for (const method of METHOD_ORDER) {
      this.methodsEl.appendChild(this.makeMethodCard(method));
    }
  }

  /** Survey price after live survey_cost modifiers (base price before the first state arrives). */
  private costOf(method: SurveyMethod, state: GameState | null): number {
    return surveyCostFor(method, state?.events.activeModifiers ?? [], state?.tickCount ?? 0);
  }

  private makeMethodCard(method: SurveyMethod): HTMLElement {
    const radius = SURVEY_COVERAGE_RADIUS[method];
    const accuracy = Math.round((1 - SURVEY_BASE_ERROR[method]) * 100);
    const selected = method === this.selectedMethod;

    // A plain div, not a <button>: the tutorial rails' button rule would block
    // it unless it were the stage target, and seismic is pre-selected so the
    // rails skip straight to Run. The rails block it through the explicit
    // `.bs-survey-method` rule in styles.ts instead, and the survey-run stage
    // allows only the seismic row, so other methods are inert.
    const row = el('div', {
      className: 'bs-survey-method',
      attrs: {
        style: `display:flex;flex-direction:column;gap:7px;padding:10px 11px;border:1px solid ${selected ? 'var(--bsx-info)' : 'var(--bsx-hairline)'};border-radius:5px;background:${selected ? 'rgba(85,168,255,.08)' : 'var(--bsx-card)'};cursor:pointer;text-align:left`,
        'data-method': method,
      },
    });
    if (selected) row.classList.add('selected');

    const head = el('div', { attrs: { style: 'display:flex;align-items:center;gap:8px;width:100%' } });
    head.append(
      iconEl('survey', 14),
      el('span', { text: t(`survey.${method}`), attrs: { style: 'font:600 12px/1 var(--bsx-font-ui);color:var(--bsx-text-primary)' } }),
      el('span', { text: `$${this.costOf(method, this.lastState).toLocaleString('en-US')}`, className: 'bsx-mono', attrs: { style: 'margin-left:auto;font-size:11px;font-weight:600;color:var(--bsx-amber)' } }),
    );

    const meta = el('div', { className: 'bsx-mono', attrs: { style: 'display:flex;gap:10px;font-size:10px;color:var(--bsx-text-muted)' } });
    meta.append(
      el('span', { text: t('ui.survey.method_accuracy', { pct: accuracy }) }),
      el('span', { text: radius > 0 ? t('ui.survey.radius_cells', { radius }) : t('ui.survey.radius_point') }),
      el('span', { text: t('ui.survey.depth_metres', { depth: SURVEY_DEPTH_BELOW_SURFACE[method] }) }),
      el('span', { text: t('ui.survey.duration_ticks', { ticks: SURVEY_DURATION_TICKS[method] }) }),
    );

    const note = el('span', {
      text: this.methodNote(method),
      attrs: { style: 'font:400 10px/1.4 var(--bsx-font-ui);color:var(--bsx-text-muted)' },
    });

    row.append(head, meta, note);
    row.addEventListener('click', () => this.selectMethod(method));
    return row;
  }

  private methodNote(method: SurveyMethod): string {
    switch (method) {
      case 'core_sample': return t('ui.survey.note_core_sample');
      case 'seismic': return t('ui.survey.note_seismic', { radius: SEISMIC_SURVEY_DAMAGE_RADIUS, hp: SEISMIC_SURVEY_DAMAGE_HP });
      case 'aerial': return t('ui.survey.note_aerial');
    }
  }

  private selectMethod(method: SurveyMethod): void {
    this.selectedMethod = method;
    this.methodsEl.replaceChildren();
    this.buildMethodList();
    if (this.lastState) this.update(this.lastState);

    const kit = this.placementKit;
    if (!kit) return;
    const reason = this.lastState ? this.blockReason(this.lastState) : null;
    if (reason !== null) {
      this.notifyCb?.({ severity: 'warn', title: t('ui.survey.blocked_title'), body: reason });
      this.showStatus(reason);
      return;
    }
    // Armed already: cancel so armPointPick re-arms for the newly chosen method.
    if (kit.controller.isArmed) kit.controller.cancel();
    this.armPick();
  }

  private hasSurveyor(state: GameState): boolean {
    return state.employees.employees.some(
      e => e.alive && e.qualifications.some(q => q.category === SURVEYOR_SKILL),
    );
  }

  /** Reason no survey can run now (no geology-qualified employee, or cash short), or null when unblocked. */
  private blockReason(state: GameState): string | null {
    if (!this.hasSurveyor(state)) return t('ui.survey.no_surveyor');
    const cost = this.costOf(this.selectedMethod, state);
    if (state.cash < cost) return t('ui.survey.insufficient_funds', { cost: String(cost) });
    return null;
  }

  /** Run button: arms the pick, but leaves an already-armed pick alone (armPointPick would toggle it off). */
  private pickTargetAndRun(): void {
    if (this.placementKit?.controller.isArmed) return;
    this.armPick();
  }

  /** Arm the point pick for the selected method. */
  private armPick(): void {
    const kit = this.placementKit;
    if (!kit) return;

    const radius = SURVEY_COVERAGE_RADIUS[this.selectedMethod];

    armPointPick(kit, {
      icon: 'survey',
      title: t('ui.survey.pick_target'),
      subtitle: t(`survey.${this.selectedMethod}`),
      instruction: t('ui.survey.pick_instruction'),
      result: (sel) => `(${sel.x1}, ${sel.z1}) · $${this.costOf(this.selectedMethod, this.lastState).toLocaleString('en-US')}`,
      marker: { tone: 'survey', ...(radius > 0 ? { radius } : {}) },
      // Show the pit aimed at the middle so the player is never staring at a blank scene.
      initialSelection: {
        x: Math.floor(this.worldOriginX + this.worldSizeX / 2),
        z: Math.floor(this.worldOriginZ + this.worldSizeZ / 2),
      },
      onConfirm: (sel) => {
        const cmd = this.gameConsole?.(`survey ${this.selectedMethod} x:${sel.x1} z:${sel.z1}`);
        this.setTransientStatus(cmd?.success ? t('ui.survey.queued') : (cmd?.output ?? ''));
      },
    });
  }

  // ── Results ──────────────────────────────────────────────────────────────

  private renderResults(results: readonly SurveyResult[], currentTick: number, marketId: MarketId): void {
    this.resultsEl.replaceChildren();

    if (results.length === 0) {
      this.resultsEl.appendChild(emptyState(t('ui.survey.results_none')));
      return;
    }

    for (const survey of results.slice(-MAX_RESULTS_SHOWN).reverse()) {
      this.resultsEl.appendChild(this.makeResultCard(survey, currentTick, marketId));
    }
  }

  private makeResultCard(survey: SurveyResult, currentTick: number, marketId: MarketId): HTMLElement {
    const stale = isSurveyStale(survey);
    const age = currentTick - survey.completedTick;

    const head = el('div', { attrs: { style: 'display:flex;align-items:center;gap:8px' } });
    head.append(
      el('span', { text: t(`survey.${survey.method}`), attrs: { style: 'font:600 11px/1 var(--bsx-font-ui)' } }),
      el('span', { text: `(${survey.centerX}, ${survey.centerZ})`, className: 'bsx-mono', attrs: { style: 'font-size:10px;color:var(--bsx-text-muted)' } }),
      el('span', {
        text: t('ui.survey.age_ticks', { ticks: age }),
        className: 'bsx-mono',
        attrs: { style: `margin-left:auto;font-size:10px;color:${stale ? 'var(--bsx-critical-text)' : 'var(--bsx-text-muted)'}` },
      }),
    );
    head.appendChild(makeLocateButton({
      title: t('ui.survey.locate'),
      size: 24,
      onClick: () => focusCameraOn(survey.centerX, survey.centerZ),
    }));

    const rows: HTMLElement[] = [head];

    if (stale) rows.push(reasonLine(t('ui.survey.stale_warning'), true));

    const ores = summarizeSurveyOres(survey, marketId).slice(0, MAX_ORES_SHOWN);
    if (ores.length === 0) {
      rows.push(el('span', { text: t('ui.survey.no_ore'), attrs: { style: 'font-size:10px;color:var(--bsx-text-muted)' } }));
    } else {
      rows.push(buildOreRows(survey, ores));
      const depthLog = buildDepthLog(survey);
      if (depthLog) rows.push(depthLog);
    }

    rows.push(el('span', {
      text: t('ui.survey.confidence_pct', { pct: Math.round(survey.confidence * 100) }),
      className: 'bsx-mono',
      attrs: { style: 'font-size:10px;color:var(--bsx-text-muted)' },
    }));

    return card(rows);
  }
}
