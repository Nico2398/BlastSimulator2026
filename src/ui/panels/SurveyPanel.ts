// BlastSimulator2026 — Survey panel (redesign P7)
// Method cards (cost/accuracy/radius/depth/duration/note, incl. the seismic
// damage warning), PICK TARGET IN SCENE (migrated from SurveyUI.ts's already-
// working PlacementKit wiring), then a results list: age, a stale badge
// (isSurveyStale, already existed in SurveyCalc.ts), a locate button (same
// window.__cameraFocus bridge as FleetPanel's, P6), ore bars, confidence.
//
// Root id, [data-method] on method rows, #bs-survey-run, and .bs-survey-status
// (read by uiActionProbe.ts's REGION_HINTS to explain a disabled Run) are
// preserved from the old SurveyUI so tutorialStages.ts and uiActionProbe.ts
// keep resolving unchanged — same convention FleetPanel/CrewPanel established
// for their own root ids in P6.

import { t } from '../../core/i18n/I18n.js';
import { el, card, button, sectionHeader, emptyState, reasonLine, progressBar } from '../dom.js';
import { iconEl } from '../icons.js';
import { LocaleTextRegistry } from '../localeText.js';
import type { GameState } from '../../core/state/GameState.js';
import type { SurveyMethod, SurveyResult } from '../../core/mining/SurveyCalc.js';
import { isSurveyStale } from '../../core/mining/SurveyCalc.js';
import {
  SURVEY_COSTS, SURVEY_BASE_ERROR, SURVEY_COVERAGE_RADIUS, SURVEY_DURATION_TICKS,
  SEISMIC_SURVEY_DAMAGE_RADIUS, SEISMIC_SURVEY_DAMAGE_HP,
} from '../../core/config/balance.js';
import { placementRefusalReason, type PlacementKit } from '../scene/PlacementKit.js';
import type { CommandResult } from '../../console/ConsoleRunner.js';

export type GameConsoleFn = (cmd: string) => CommandResult;

/** Qualification a surveyor needs before any survey can be dispatched. */
const SURVEYOR_SKILL = 'geology';

/** How long (ms) a panel-produced status message survives update() calls. */
const STATUS_HOLD_MS = 5000;

/** Most recent surveys shown, newest first — matches the old panel's cap and the design's own sample count. */
const MAX_RESULTS_SHOWN = 4;

/** Methods offered, cheapest first so the tutorial's default is affordable. */
const METHOD_ORDER: SurveyMethod[] = ['core_sample', 'seismic', 'aerial'];

/** Every method except core_sample surveys a disc; core_sample is point-only (radius 0). */
const DEPTH_KIND: Record<SurveyMethod, 'full' | 'surface'> = {
  core_sample: 'full',
  seismic: 'full',
  aerial: 'surface',
};

export class SurveyPanel {
  private readonly el: HTMLElement;
  private readonly bodyEl: HTMLElement;
  private readonly methodsEl: HTMLElement;
  private readonly runBtn: HTMLButtonElement;
  private readonly statusEl: HTMLElement;
  private readonly resultsEl: HTMLElement;
  private onCloseCb?: () => void;
  private gameConsole?: GameConsoleFn;
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
    this.el = el('div', { className: 'bsx-root', attrs: { id: 'bs-survey-panel' } });
    this.el.style.cssText = [
      'flex-direction:column', 'width:372px', 'max-height:100%',
      'border-radius:8px', 'background:var(--bsx-panel)', 'border:1px solid var(--bsx-hairline-strong)',
      'box-shadow:0 18px 44px rgba(0,0,0,.55)', 'overflow:hidden', 'pointer-events:all',
    ].join(';');
    this.el.style.display = 'none';

    const header = el('div');
    header.style.cssText = 'flex:0 0 auto;display:flex;align-items:center;gap:10px;height:46px;padding:0 12px;background:#1a2028;border-bottom:1px solid var(--bsx-hairline)';
    const iconChip = el('div', { children: [iconEl('survey', 15)] });
    iconChip.style.cssText = 'width:26px;height:26px;border-radius:5px;display:flex;align-items:center;justify-content:center;background:rgba(85,168,255,.14);color:var(--bsx-info)';
    const titleEl = this.locale.bindText(
      el('div', { attrs: { style: 'font:700 12px/1 var(--bsx-font-ui);letter-spacing:.14em;color:var(--bsx-text-primary)' } }),
      'ui.survey.title',
    );
    const closeBtn = el('button', { children: [iconEl('x', 12)] });
    closeBtn.style.cssText = 'margin-left:auto;width:28px;height:28px;display:flex;align-items:center;justify-content:center;border:1px solid var(--bsx-hairline-strong);border-radius:4px;background:transparent;color:var(--bsx-text-muted);cursor:pointer';
    closeBtn.addEventListener('click', () => this.onCloseCb?.());
    header.append(iconChip, titleEl, closeBtn);

    this.bodyEl = el('div');
    this.bodyEl.style.cssText = 'flex:1 1 auto;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:9px';

    this.methodsEl = el('div', { attrs: { style: 'display:flex;flex-direction:column;gap:7px' } });

    this.runBtn = button('primary', t('ui.survey.pick_target_scene'), { icon: 'locate' });
    this.runBtn.id = 'bs-survey-run';
    this.runBtn.style.cssText = 'width:100%;height:38px';
    this.runBtn.addEventListener('click', () => this.pickTargetAndRun());

    this.statusEl = el('div', { className: 'bs-survey-status' });
    this.statusEl.style.cssText = 'font:400 10px/1.4 var(--bsx-font-ui);color:var(--bsx-text-muted);min-height:14px';

    this.resultsEl = el('div', { attrs: { style: 'display:flex;flex-direction:column;gap:8px' } });

    this.bodyEl.append(
      sectionHeader(t('ui.survey.method')),
      this.methodsEl,
      this.runBtn,
      this.statusEl,
      sectionHeader(t('ui.survey.results')),
      this.resultsEl,
    );

    this.el.append(header, this.bodyEl);
    container.appendChild(this.el);

    this.buildMethodList();
  }

  get root(): HTMLElement { return this.el; }
  setCloseHandler(cb: () => void): void { this.onCloseCb = cb; }
  setGameConsole(fn: GameConsoleFn): void { this.gameConsole = fn; }
  setPlacementKit(kit: PlacementKit): void { this.placementKit = kit; }

  show(): void { this.el.style.display = 'flex'; }
  hide(): void { this.el.style.display = 'none'; }
  get visible(): boolean { return this.el.style.display !== 'none'; }

  refreshLocale(): void {
    this.locale.refresh();
    this.runBtn.replaceChildren();
    this.runBtn.appendChild(iconEl('locate', 12));
    this.runBtn.appendChild(el('span', { text: t('ui.survey.pick_target_scene') }));
    this.methodsEl.replaceChildren();
    this.buildMethodList();
    this.lastResultCount = -1;
    this.lastPendingCount = -1;
    if (this.lastState) this.update(this.lastState);
  }

  dispose(): void {
    if (this.statusTimer) clearTimeout(this.statusTimer);
    this.el.remove();
  }

  update(state: GameState): void {
    this.lastState = state;
    if (state.world) {
      this.worldSizeX = state.world.sizeX;
      this.worldSizeZ = state.world.sizeZ;
      this.worldOriginX = state.world.minX;
      this.worldOriginZ = state.world.minZ;
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
    // out. A message the panel itself just set (queued, or a command error)
    // wins over both until it expires — otherwise this would wipe it next frame.
    if (!hasSurveyor) {
      this.showStatus(t('ui.survey.no_surveyor'));
    } else if (!affordable) {
      this.showStatus(t('ui.survey.insufficient_funds', { cost: String(cost) }));
    } else if (pending > 0) {
      this.showStatus(t('ui.survey.in_progress', { count: String(pending) }));
    } else if (!this.statusIsTransient) {
      this.showStatus('');
    }

    // Refresh the readout only when a count moves, not on every rendered frame.
    if (pending !== this.lastPendingCount || done !== this.lastResultCount) {
      this.lastPendingCount = pending;
      this.lastResultCount = done;
      this.renderResults(state.surveyResults, state.tickCount);
    }
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

  private makeMethodCard(method: SurveyMethod): HTMLElement {
    const radius = SURVEY_COVERAGE_RADIUS[method];
    const accuracy = Math.round((1 - SURVEY_BASE_ERROR[method]) * 100);
    const selected = method === this.selectedMethod;

    // A real <button> here gets blocked by the tutorial rails' CSS
    // (body.bs-tutorial-guided button:not(.bs-tutorial-allowed) { pointer-
    // events: none }) whenever this isn't the rails' current highlighted
    // stage — which it usually isn't, since seismic is pre-selected and
    // resolveStageIndex's "last reachable wins" skips straight to the Run
    // button. A plain div with a click listener isn't covered by that CSS
    // selector at all, matching the old SurveyUI.ts's own element choice here.
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
      el('span', { text: `$${SURVEY_COSTS[method].toLocaleString('en-US')}`, className: 'bsx-mono', attrs: { style: 'margin-left:auto;font-size:11px;font-weight:600;color:var(--bsx-amber)' } }),
    );

    const meta = el('div', { className: 'bsx-mono', attrs: { style: 'display:flex;gap:10px;font-size:10px;color:var(--bsx-text-muted)' } });
    meta.append(
      el('span', { text: t('ui.survey.method_accuracy', { pct: accuracy }) }),
      el('span', { text: radius > 0 ? t('ui.survey.radius_cells', { radius }) : t('ui.survey.radius_point') }),
      el('span', { text: DEPTH_KIND[method] === 'full' ? t('ui.survey.depth_full') : t('ui.survey.depth_surface') }),
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
  }

  private pickTargetAndRun(): void {
    const kit = this.placementKit;
    if (!kit) return;
    const { controller, overlay, strip } = kit;
    if (controller.isArmed) { controller.cancel(); return; }

    const radius = SURVEY_COVERAGE_RADIUS[this.selectedMethod];
    const refresh = (): void => {
      if (controller.currentPhase === 'idle') { overlay.clear(); strip.hide(); return; }
      const sel = controller.selection;
      overlay.update(sel ? { shape: 'point', x: sel.x1, z: sel.z1, tone: 'survey', ...(radius > 0 ? { radius } : {}) } : null);
      strip.show({
        icon: 'survey',
        title: t('ui.survey.pick_target'),
        subtitle: t(`survey.${this.selectedMethod}`),
        fields: [],
        result: sel ? `(${sel.x1}, ${sel.z1}) · $${SURVEY_COSTS[this.selectedMethod].toLocaleString('en-US')}` : '—',
        confirmEnabled: controller.canConfirm,
        confirmDisabledReason: placementRefusalReason(controller),
        instruction: t('ui.survey.pick_instruction'),
      });
    };

    controller.setConfirmHandler((sel) => {
      const cmd = this.gameConsole?.(`survey ${this.selectedMethod} x:${sel.x1} z:${sel.z1}`);
      this.setTransientStatus(cmd?.success ? t('ui.survey.queued') : (cmd?.output ?? ''));
      overlay.flashConfirm();
    });
    controller.setChangeHandler(refresh);
    // Show the pit aimed at the middle so the player is never staring at a blank scene.
    controller.arm({
      shape: 'point',
      initialSelection: {
        x: Math.floor(this.worldOriginX + this.worldSizeX / 2),
        z: Math.floor(this.worldOriginZ + this.worldSizeZ / 2),
      },
    });
    refresh();
  }

  // ── Results ──────────────────────────────────────────────────────────────

  private renderResults(results: readonly SurveyResult[], currentTick: number): void {
    this.resultsEl.replaceChildren();

    if (results.length === 0) {
      this.resultsEl.appendChild(emptyState(t('ui.survey.results_none')));
      return;
    }

    for (const survey of results.slice(-MAX_RESULTS_SHOWN).reverse()) {
      this.resultsEl.appendChild(this.makeResultCard(survey, currentTick));
    }
  }

  private makeResultCard(survey: SurveyResult, currentTick: number): HTMLElement {
    const stale = isSurveyStale(survey, currentTick);
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
    const locateBtn = el('button', { attrs: { style: 'width:24px;height:24px;display:flex;align-items:center;justify-content:center;border:1px solid var(--bsx-hairline-strong);border-radius:4px;background:transparent;color:var(--bsx-text-muted);cursor:pointer' }, children: [iconEl('locate', 11)] });
    locateBtn.addEventListener('click', () => window.__cameraFocus?.(survey.centerX, survey.centerZ, 15));
    head.appendChild(locateBtn);

    const rows: HTMLElement[] = [head];

    if (stale) rows.push(reasonLine(t('ui.survey.stale_warning'), true));

    const best = richestOrePerType(survey);
    if (best.size === 0) {
      rows.push(el('span', { text: t('ui.survey.no_ore'), attrs: { style: 'font-size:10px;color:var(--bsx-text-muted)' } }));
    } else {
      const oreRows = el('div', { attrs: { style: 'display:flex;flex-direction:column;gap:5px' } });
      const ranked = [...best.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
      for (const [oreId, density] of ranked) {
        const pct = Math.round(density * 100);
        const bar = progressBar(pct, 'var(--bsx-ore)');
        bar.style.flex = '1';
        oreRows.append(el('div', {
          attrs: { style: 'display:flex;align-items:center;gap:8px' },
          children: [
            el('span', { text: t(`ore.${oreId}.name`), attrs: { style: 'width:62px;font-size:10px;color:var(--bsx-text-secondary)' } }),
            bar,
            el('span', { text: `${pct}%`, className: 'bsx-mono', attrs: { style: 'width:28px;text-align:right;font-size:10px;color:var(--bsx-text-muted)' } }),
          ],
        }));
      }
      rows.push(oreRows);
    }

    rows.push(el('span', {
      text: t('ui.survey.confidence_pct', { pct: Math.round(survey.confidence * 100) }),
      className: 'bsx-mono',
      attrs: { style: 'font-size:10px;color:var(--bsx-text-muted)' },
    }));

    return card(rows);
  }
}

/** Richest density per ore across every column the survey covered. */
function richestOrePerType(survey: SurveyResult): Map<string, number> {
  const best = new Map<string, number>();
  for (const column of Object.values(survey.estimates)) {
    for (const [oreId, density] of Object.entries(column)) {
      if (density > (best.get(oreId) ?? 0)) best.set(oreId, density);
    }
  }
  return best;
}
