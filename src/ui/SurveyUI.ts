// BlastSimulator2026 — Survey UI (10.8)
// Pick a method, pick a target on the map, run the survey, read the results.

import { t } from '../core/i18n/I18n.js';
import type { GameState } from '../core/state/GameState.js';
import type { SurveyMethod, SurveyResult } from '../core/mining/SurveyCalc.js';
import { SURVEY_COSTS, SURVEY_BASE_ERROR } from '../core/config/balance.js';
import { TileSelectOverlay } from './TileSelectOverlay.js';
import { makeSiteTileFill } from './siteTileShading.js';

import type { CommandResult } from '../console/ConsoleRunner.js';

export type GameConsoleFn = (cmd: string) => CommandResult;

/** Methods offered, cheapest first so the tutorial's default is affordable. */
const METHODS: SurveyMethod[] = ['core_sample', 'seismic', 'aerial'];

/** Qualification a surveyor needs before any survey can be dispatched. */
const SURVEYOR_SKILL = 'geology';

/** How long (ms) a panel-produced status message survives update() calls. */
const STATUS_HOLD_MS = 5000;

/** Configuration for a single method button in the selection panel. */
export interface SurveyMethodButtonConfig {
  /** The survey method this button triggers. */
  method: SurveyMethod;
  /** Display label for the button (i18n key). */
  labelKey: string;
  /** Estimated cost to display beside the button. */
  estimatedCost: number;
  /** Whether this method is currently selected. */
  selected: boolean;
}

/** Result of the method selection panel interaction. */
export interface SurveyMethodSelection {
  /** The method the player selected. */
  method: SurveyMethod;
  /** Grid position where the survey should be placed. */
  targetX: number;
  targetZ: number;
}

export class SurveyUI {
  private readonly el: HTMLElement;
  private readonly methodsEl: HTMLElement;
  private readonly runBtn: HTMLButtonElement;
  private readonly statusEl: HTMLElement;
  private readonly resultsEl: HTMLElement;
  private readonly tileSelect: TileSelectOverlay;
  private gameConsole?: GameConsoleFn;
  private onSelected?: (selection: SurveyMethodSelection) => void;
  private selectedMethod: SurveyMethod = 'seismic';
  private worldSizeX = 40;
  private worldSizeZ = 40;
  private lastResultCount = -1;
  private lastPendingCount = -1;
  private statusIsTransient = false;
  private statusTimer: ReturnType<typeof setTimeout> | null = null;
  /** Latest state, so the target picker can draw the site. */
  private lastState: GameState | null = null;

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'bs-survey-panel';
    this.el.classList.add('bs-ui', 'bs-panel');
    this.el.style.display = 'none';

    const title = document.createElement('div');
    title.className = 'bs-panel-title';
    title.textContent = t('ui.survey.title');

    const methodLabel = document.createElement('div');
    methodLabel.className = 'bs-section-header';
    methodLabel.textContent = t('ui.survey.method');

    this.methodsEl = document.createElement('div');
    this.methodsEl.id = 'bs-survey-methods';

    this.runBtn = document.createElement('button');
    this.runBtn.className = 'bs-btn bs-btn-primary';
    this.runBtn.id = 'bs-survey-run';
    this.runBtn.style.cssText = 'width:100%;margin-top:8px';
    this.runBtn.textContent = t('ui.survey.run');
    this.runBtn.addEventListener('click', () => this.pickTargetAndRun());

    this.statusEl = document.createElement('div');
    this.statusEl.className = 'bs-survey-status';
    this.statusEl.style.cssText = 'font-size:10px;margin-top:6px;min-height:14px;color:#a89060';

    const resultsLabel = document.createElement('div');
    resultsLabel.className = 'bs-section-header';
    resultsLabel.style.marginTop = '8px';
    resultsLabel.textContent = t('ui.survey.results');

    this.resultsEl = document.createElement('div');
    this.resultsEl.id = 'bs-survey-results';
    this.resultsEl.style.cssText = 'font-size:11px;color:#c0a070';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'bs-btn';
    closeBtn.style.cssText = 'width:100%;margin-top:6px';
    closeBtn.textContent = t('ui.survey.close');
    closeBtn.addEventListener('click', () => this.hide());

    this.el.append(
      title, methodLabel, this.methodsEl, this.runBtn, this.statusEl,
      resultsLabel, this.resultsEl, closeBtn,
    );
    container.appendChild(this.el);

    // Appended to body so the picker escapes the left column's stacking context.
    this.tileSelect = new TileSelectOverlay(document.body);
    this.buildMethodList();
  }

  setGameConsole(fn: GameConsoleFn): void { this.gameConsole = fn; }

  show(): void { this.el.style.display = ''; }
  hide(): void { this.el.style.display = 'none'; }
  get visible(): boolean { return this.el.style.display !== 'none'; }

  update(state: GameState): void {
    this.lastState = state;
    if (state.world) {
      this.worldSizeX = state.world.sizeX;
      this.worldSizeZ = state.world.sizeZ;
    }

    const hasSurveyor = state.employees.employees.some(
      e => e.alive && e.qualifications.some(q => q.category === SURVEYOR_SKILL),
    );
    const cost = SURVEY_COSTS[this.selectedMethod];
    const affordable = state.cash >= cost;

    this.runBtn.disabled = !hasSurveyor || !affordable;

    const pending = state.pendingActions.filter(a => a.type === 'survey').length;
    const done = state.surveyResults.length;

    // Blockers outrank progress: the player needs to know *why* Run is greyed
    // out. A message the panel itself just set (queued, or a command error) wins
    // over both until it expires, otherwise this would wipe it the next frame.
    if (!hasSurveyor) {
      this.showStatus(t('ui.survey.no_surveyor'));
    } else if (!affordable) {
      this.showStatus(t('ui.survey.insufficient_funds', { cost: String(cost) }));
    } else if (pending > 0) {
      this.showStatus(t('ui.survey.in_progress', { count: String(pending) }));
    } else if (!this.statusIsTransient) {
      this.showStatus('');
    }

    // Refresh the readout only when a count moves, so the list is not rebuilt
    // on every rendered frame.
    if (pending !== this.lastPendingCount || done !== this.lastResultCount) {
      this.lastPendingCount = pending;
      this.lastResultCount = done;
      this.renderResults(state.surveyResults, pending);
    }
  }

  /** Show a raw survey readout for one column (terrain click path). */
  showSurveyResult(x: number, z: number, result: string): void {
    this.resultsEl.replaceChildren();

    const posLine = document.createElement('div');
    posLine.style.cssText = 'color:#a08060;margin-bottom:4px';
    posLine.textContent = t('ui.survey.pos', { x: String(x), z: String(z) });

    const content = document.createElement('pre');
    content.style.cssText = 'margin:0;font-family:inherit;font-size:10px;white-space:pre-wrap;color:#c0a070';
    content.textContent = result;

    this.resultsEl.append(posLine, content);
  }

  /** Highlight one of the method rows as selected. */
  showMethodSelection(methods: SurveyMethodButtonConfig[]): void {
    for (const cfg of methods) {
      const row = this.methodsEl.querySelector<HTMLElement>(`[data-method="${cfg.method}"]`);
      row?.classList.toggle('selected', cfg.selected);
      if (cfg.selected) this.selectedMethod = cfg.method;
    }
  }

  /** Collapse the method list (kept for API compatibility). */
  hideMethodSelection(): void {
    this.methodsEl.style.display = 'none';
  }

  /** Register a callback invoked once the player has picked method and target. */
  onMethodSelected(callback: (selection: SurveyMethodSelection) => void): void {
    this.onSelected = callback;
  }

  /** The method currently armed for the next survey. */
  getSelectedMethod(): SurveyMethod | null {
    return this.selectedMethod;
  }

  dispose(): void {
    if (this.statusTimer) clearTimeout(this.statusTimer);
    this.el.remove();
    this.tileSelect.dispose();
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /**
   * Write a status that reflects current state. This also releases any transient
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

  /**
   * Show a message the panel itself produced (dispatch confirmation, command
   * error) and protect it from the next update() for a few seconds.
   */
  private setTransientStatus(msg: string): void {
    this.showStatus(msg);
    this.statusIsTransient = true;
    this.statusTimer = setTimeout(() => {
      this.statusIsTransient = false;
      this.statusTimer = null;
    }, STATUS_HOLD_MS);
  }

  private buildMethodList(): void {
    for (const method of METHODS) {
      const row = document.createElement('div');
      row.className = 'bs-survey-method';
      row.dataset['method'] = method;
      if (method === this.selectedMethod) row.classList.add('selected');

      const name = document.createElement('div');
      name.className = 'bs-survey-method-name';
      name.textContent = t(`survey.${method}`);

      const meta = document.createElement('div');
      meta.className = 'bs-survey-method-meta';
      // Base error is the inverse of accuracy — surface it as a percentage so
      // the player can weigh a cheap rough scan against an expensive precise one.
      const accuracy = Math.round((1 - SURVEY_BASE_ERROR[method]) * 100);
      meta.textContent = `$${SURVEY_COSTS[method].toLocaleString('en-US')} · ${t('ui.survey.accuracy')} ${accuracy}%`;

      row.append(name, meta);
      row.addEventListener('click', () => this.selectMethod(method));
      this.methodsEl.appendChild(row);
    }
  }

  private selectMethod(method: SurveyMethod): void {
    this.selectedMethod = method;
    this.methodsEl.querySelectorAll<HTMLElement>('.bs-survey-method').forEach(row => {
      row.classList.toggle('selected', row.dataset['method'] === method);
    });
  }

  private pickTargetAndRun(): void {
    this.tileSelect.open({
      mode: 'point',
      worldSizeX: this.worldSizeX,
      worldSizeZ: this.worldSizeZ,
      title: t('ui.survey.pick_target'),
      // Show the pit and anything already known about it, and start aimed at
      // the middle so the player is never staring at a blank grid.
      ...(this.lastState ? { tileFill: makeSiteTileFill(this.lastState) } : {}),
      initialSelection: {
        x: Math.floor(this.worldSizeX / 2),
        z: Math.floor(this.worldSizeZ / 2),
      },
      onConfirm: (result) => {
        this.onSelected?.({ method: this.selectedMethod, targetX: result.x, targetZ: result.z });
        const cmd = this.gameConsole?.(`survey ${this.selectedMethod} x:${result.x} z:${result.z}`);
        this.setTransientStatus(cmd?.success ? t('ui.survey.queued') : (cmd?.output ?? ''));
      },
    });
  }

  private renderResults(results: SurveyResult[], pending: number): void {
    this.resultsEl.replaceChildren();

    if (results.length === 0 && pending === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'color:#806050;font-size:10px';
      empty.textContent = t('ui.survey.results_none');
      this.resultsEl.appendChild(empty);
      return;
    }

    for (const survey of results.slice(-4).reverse()) {
      this.resultsEl.appendChild(this.makeResultRow(survey));
    }
  }

  private makeResultRow(survey: SurveyResult): HTMLElement {
    const row = document.createElement('div');
    row.className = 'bs-survey-result';

    const head = document.createElement('div');
    head.style.cssText = 'color:#d0b090;font-size:10px';
    head.textContent = `${t(`survey.${survey.method}`)} (${survey.centerX}, ${survey.centerZ}) — ${t('ui.survey.confidence')} ${Math.round(survey.confidence * 100)}%`;
    row.appendChild(head);

    // Richest ore per type across the surveyed columns.
    const best = new Map<string, number>();
    for (const column of Object.values(survey.estimates)) {
      for (const [oreId, density] of Object.entries(column)) {
        if (density > (best.get(oreId) ?? 0)) best.set(oreId, density);
      }
    }

    if (best.size === 0) {
      const barren = document.createElement('div');
      barren.style.cssText = 'font-size:10px;color:#806050';
      barren.textContent = t('ui.survey.no_ore');
      row.appendChild(barren);
      return row;
    }

    const ranked = [...best.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    for (const [oreId, density] of ranked) {
      const oreRow = document.createElement('div');
      oreRow.className = 'bs-ore-row';

      const label = document.createElement('span');
      label.style.cssText = 'width:96px;font-size:10px;color:#c0a070';
      label.textContent = t(`ore.${oreId}.name`);

      const barBg = document.createElement('div');
      barBg.className = 'bs-ore-bar-bg';
      const fill = document.createElement('div');
      fill.className = 'bs-ore-bar-fill';
      fill.style.width = `${Math.round(density * 100)}%`;
      barBg.appendChild(fill);

      const value = document.createElement('span');
      value.style.cssText = 'font-size:10px;color:#a08060';
      value.textContent = `${Math.round(density * 100)}%`;

      oreRow.append(label, barBg, value);
      row.appendChild(oreRow);
    }

    return row;
  }
}
