// BlastSimulator2026 — Blast Workshop panel (redesign P4)
// Replaces BlastPlanUI with a 5-step workflow (Drill → Charge → Sequence →
// Preview → Fire) plus a sticky footer, all built to the full design spec
// (tasks P4/#22-26). Firing is a two-step handoff out of this panel: the
// footer's FIRE button requests a Preflight confirm (setFireRequestedHandler,
// wired by UIManager to PreflightModal — a separate top-level overlay, not a
// child of this panel), and DETONATE there is what actually dispatches
// `blast`.

import { t } from '../../core/i18n/I18n.js';
import { el } from '../dom.js';
import { iconEl } from '../icons.js';
import { LocaleTextRegistry } from '../localeText.js';
import type { GameState } from '../../core/state/GameState.js';
import type { WeatherState } from '../../core/weather/WeatherCycle.js';
import type { PlacementKit } from '../scene/PlacementKit.js';
import type { CommandResult } from '../../console/ConsoleRunner.js';
import { assembleBlastPlan, validateBlastPlan } from '../../core/mining/BlastPlan.js';
import { BlastFooter } from './blastFooter.js';
import { DrillStep } from './blastSteps/Drill.js';
import { ChargeStep } from './blastSteps/Charge.js';
import { SequenceStep } from './blastSteps/Sequence.js';
import { PreviewStep } from './blastSteps/Preview.js';
import { FireStep } from './blastSteps/Fire.js';

export type GameConsoleFn = (cmd: string) => CommandResult;

export type StepId = 1 | 2 | 3 | 4 | 5;
const STEP_KEYS: Record<StepId, string> = {
  1: 'ui.blast_workshop.step.drill',
  2: 'ui.blast_workshop.step.charge',
  3: 'ui.blast_workshop.step.sequence',
  4: 'ui.blast_workshop.step.preview',
  5: 'ui.blast_workshop.step.fire',
};

export class BlastWorkshop {
  private readonly el: HTMLElement;
  private readonly tabButtons: Record<StepId, HTMLButtonElement>;
  private readonly tabNumberEls: Record<StepId, HTMLElement>;
  private readonly tabStateEls: Record<StepId, HTMLElement>;
  private readonly bodyEl: HTMLElement;
  private readonly footer: BlastFooter;

  private readonly drillStep: DrillStep;
  private readonly chargeStep: ChargeStep;
  private readonly sequenceStep: SequenceStep;
  private readonly previewStep: PreviewStep;
  private readonly fireStep: FireStep;

  private activeStep: StepId = 1;
  /** True from the moment the panel opens until the player manually picks a tab — keeps the tutorial's "open panel, click this step's control" flow landing on the right step without locking out manual review of a completed one. */
  private autoAdvance = true;
  private onCloseCb?: () => void;
  private lastTabSignature = '';
  private readonly locale = new LocaleTextRegistry();

  constructor(container: HTMLElement) {
    this.el = el('div', { className: 'bsx-root', attrs: { id: 'bs-blast-panel' } });
    this.el.style.cssText = [
      'flex-direction:column', 'width:372px', 'max-height:100%',
      'border-radius:8px', 'background:var(--bsx-panel)', 'border:1px solid var(--bsx-hairline-strong)',
      'box-shadow:0 18px 44px rgba(0,0,0,.55)', 'overflow:hidden', 'pointer-events:all',
    ].join(';');
    // Set separately — jsdom's cssText parser can drop this declaration when
    // it shares a cssText string with a var(...) value (see SelectionBar.ts).
    this.el.style.display = 'none';

    // ── Header ──
    const header = el('div');
    header.style.cssText = 'flex:0 0 auto;display:flex;align-items:center;gap:10px;height:46px;padding:0 12px;background:#1a2028;border-bottom:1px solid var(--bsx-hairline)';
    const iconChip = el('div', { children: [iconEl('blast', 15)] });
    iconChip.style.cssText = 'width:26px;height:26px;border-radius:5px;display:flex;align-items:center;justify-content:center;background:rgba(255,176,46,.14);color:var(--bsx-amber)';
    const titleCol = el('div');
    titleCol.style.cssText = 'display:flex;flex-direction:column;gap:2px;min-width:0';
    titleCol.appendChild(this.locale.bindText(
      el('div', { attrs: { style: 'font:700 12px/1 var(--bsx-font-ui);letter-spacing:.14em;color:var(--bsx-text-primary)' } }),
      'ui.blast_workshop.title',
    ));
    const closeBtn = el('button', { children: [iconEl('x', 12)] });
    closeBtn.style.cssText = 'margin-left:auto;width:28px;height:28px;display:flex;align-items:center;justify-content:center;border:1px solid var(--bsx-hairline-strong);border-radius:4px;background:transparent;color:var(--bsx-text-muted);cursor:pointer';
    closeBtn.addEventListener('click', () => this.onCloseCb?.());
    header.append(iconChip, titleCol, closeBtn);

    // ── Step strip ──
    const stripWrap = el('div');
    stripWrap.style.cssText = 'flex:0 0 auto;padding:12px 12px 0;display:flex;gap:3px';
    this.tabButtons = {} as Record<StepId, HTMLButtonElement>;
    this.tabNumberEls = {} as Record<StepId, HTMLElement>;
    this.tabStateEls = {} as Record<StepId, HTMLElement>;
    for (let n = 1; n <= 5; n++) {
      const step = n as StepId;
      const btn = el('button');
      btn.dataset['step'] = String(step);
      btn.style.cssText = 'flex:1;display:flex;flex-direction:column;align-items:center;gap:5px;padding:8px 2px 7px;border-radius:5px;cursor:pointer';
      const numEl = el('div', { text: String(step) });
      numEl.style.cssText = 'display:flex;align-items:center;justify-content:center;width:19px;height:19px;border-radius:50%;font:700 10px/1 var(--bsx-font-mono)';
      const labelEl = this.locale.bindText(
        el('span', { attrs: { style: 'font:700 10px/1 var(--bsx-font-ui);letter-spacing:.08em' } }),
        STEP_KEYS[step],
      );
      const stateEl = el('span', { className: 'bsx-mono' });
      stateEl.style.cssText = 'font:500 10px/1 var(--bsx-font-mono)';
      btn.append(numEl, labelEl, stateEl);
      btn.addEventListener('click', () => this.setActiveStep(step, true));
      this.tabButtons[step] = btn;
      this.tabNumberEls[step] = numEl;
      this.tabStateEls[step] = stateEl;
      stripWrap.appendChild(btn);
    }

    // ── Body ──
    const bodyOuter = el('div', { attrs: { id: 'bs-panel-body' } });
    bodyOuter.style.cssText = 'flex:1 1 auto;overflow-y:auto;overflow-x:hidden;padding:12px';
    this.bodyEl = bodyOuter;

    this.drillStep = new DrillStep(bodyOuter);
    this.chargeStep = new ChargeStep(bodyOuter);
    this.sequenceStep = new SequenceStep(bodyOuter);
    this.previewStep = new PreviewStep(bodyOuter);
    this.fireStep = new FireStep(bodyOuter);

    this.el.append(header, stripWrap, bodyOuter);
    // Constructed last (and appends itself into `this.el`, same self-mounting
    // convention as every other component here) so it lands after the body
    // as a sticky flex sibling, not nested inside it.
    this.footer = new BlastFooter(this.el);

    container.appendChild(this.el);

    this.setActiveStep(1, false);
  }

  get root(): HTMLElement { return this.el; }

  setGameConsole(fn: GameConsoleFn): void {
    this.drillStep.setGameConsole(fn);
    this.chargeStep.setGameConsole(fn);
    this.sequenceStep.setGameConsole(fn);
    this.previewStep.setGameConsole(fn);
    this.fireStep.setGameConsole(fn);
  }

  setPlacementKit(kit: PlacementKit): void {
    this.drillStep.setPlacementKit(kit);
  }

  setCloseHandler(cb: () => void): void { this.onCloseCb = cb; }
  setFireRequestedHandler(cb: () => void): void { this.footer.setFireRequestedHandler(cb); }

  show(): void {
    this.el.style.display = 'flex';
    this.autoAdvance = true;
  }

  hide(): void { this.el.style.display = 'none'; }

  get visible(): boolean { return this.el.style.display !== 'none'; }

  /**
   * Which step tab is currently showing — exposed for the scenario harness's
   * `ensureStep` interaction action (`interaction-executor.ts`), so a step
   * can assert-or-click a tab instead of assuming it, the same "ask the
   * game, not the DOM" reasoning already applied to `pendingEvent`. This
   * panel's own `autoAdvance` (`suggestStep`, above) moves the active tab
   * out from under a scenario mid-sequence, which is what made a scenario's
   * own hardcoded `[data-step="N"]` click land on the wrong tab in PR #616.
   */
  get currentStep(): StepId { return this.activeStep; }

  update(state: GameState, weather?: WeatherState, tutorialActive: boolean = false): void {
    if (this.autoAdvance) {
      const suggested = suggestStep(state);
      if (suggested !== this.activeStep) this.setActiveStep(suggested, false);
    }

    this.renderTabs(state);
    this.drillStep.update(state, weather);
    this.chargeStep.update(state, weather);
    this.sequenceStep.update(state);
    this.previewStep.update(state);
    this.fireStep.update(state, weather);
    this.footer.update(state, tutorialActive);
  }

  refreshLocale(): void {
    this.locale.refresh();
    this.drillStep.refreshLocale();
    this.chargeStep.refreshLocale();
    this.sequenceStep.refreshLocale();
    this.previewStep.refreshLocale();
    this.fireStep.refreshLocale();
    this.footer.refreshLocale();
    // Forces the next update()-driven renderTabs() to rebuild even though the
    // game state it reads hasn't changed — only the locale has.
    this.lastTabSignature = '';
  }

  dispose(): void {
    this.drillStep.dispose();
    this.chargeStep.dispose();
    this.sequenceStep.dispose();
    this.previewStep.dispose();
    this.fireStep.dispose();
    this.footer.dispose();
    this.el.remove();
  }

  private setActiveStep(step: StepId, manual: boolean): void {
    this.activeStep = step;
    if (manual) this.autoAdvance = false;
    this.drillStep.root.style.display = step === 1 ? '' : 'none';
    this.chargeStep.root.style.display = step === 2 ? '' : 'none';
    this.sequenceStep.root.style.display = step === 3 ? '' : 'none';
    this.previewStep.root.style.display = step === 4 ? '' : 'none';
    this.fireStep.root.style.display = step === 5 ? '' : 'none';
    this.lastTabSignature = '';
    this.bodyEl.scrollTop = 0;
  }

  private renderTabs(state: GameState): void {
    const stateTexts = stepStateTexts(state);
    const signature = JSON.stringify({ active: this.activeStep, states: stateTexts });
    if (signature === this.lastTabSignature) return;
    this.lastTabSignature = signature;

    for (let n = 1; n <= 5; n++) {
      const step = n as StepId;
      const active = step === this.activeStep;
      const btn = this.tabButtons[step];
      btn.style.border = `1px solid ${active ? 'rgba(255,176,46,.5)' : 'rgba(255,255,255,.07)'}`;
      btn.style.background = active ? 'rgba(255,176,46,.13)' : '#1a2028';
      btn.style.color = active ? 'var(--bsx-amber)' : 'var(--bsx-text-muted)';
      this.tabNumberEls[step].style.background = active ? 'var(--bsx-amber)' : 'rgba(255,255,255,.09)';
      this.tabNumberEls[step].style.color = active ? 'var(--bsx-text-on-amber)' : 'var(--bsx-text-tinted)';

      const text = stateTexts[step];
      const stateEl = this.tabStateEls[step];
      stateEl.textContent = text.text;
      stateEl.style.color = text.critical ? 'var(--bsx-critical-text)' : (active ? 'var(--bsx-text-tinted)' : 'var(--bsx-text-micro)');
    }
  }
}

interface StepStateText { text: string; critical?: boolean }

function stepStateTexts(state: GameState): Record<StepId, StepStateText> {
  const holes = state.drillHoles;
  const charged = holes.filter(h => state.chargesByHole[h.id]).length;
  const sequenced = holes.filter(h => state.sequenceDelays[h.id] !== undefined).length;
  const plan = assembleBlastPlan(holes, state.chargesByHole, state.sequenceDelays);
  const fireOk = holes.length > 0 && validateBlastPlan(plan).length === 0;

  return {
    1: { text: t('ui.blast_workshop.step_state.holes', { count: holes.length }) },
    2: { text: `${charged} / ${holes.length}` },
    3: { text: `${sequenced} / ${holes.length}` },
    4: { text: t('ui.blast_workshop.step_state.tier', { tier: state.softwareTier }) },
    5: { text: t(fireOk ? 'ui.blast_workshop.step_state.ready' : 'ui.blast_workshop.step_state.blocked'), critical: !fireOk },
  };
}

/** First incomplete step, given the current plan — where the panel lands on a fresh open. */
function suggestStep(state: GameState): StepId {
  const holes = state.drillHoles;
  if (holes.length === 0) return 1;
  if (!holes.every(h => state.chargesByHole[h.id])) return 2;
  if (!holes.every(h => state.sequenceDelays[h.id] !== undefined)) return 3;
  return 5; // drilled + charged + sequenced: Preview is optional, go straight to Fire
}
