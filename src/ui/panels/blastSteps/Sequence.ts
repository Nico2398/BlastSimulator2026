// BlastSimulator2026 — Blast Workshop: Sequence step (redesign P4)
// Delay-step stepper + Auto V-Pattern, and a per-hole row list for manual
// overrides (increment/decrement one hole's delay independently).
//
// Deviation from the design mock: there, clicking a hole row re-dispatches
// its own current delay (a no-op — the mock has no real per-hole editor) and
// the info callout claims clicking a hole *in the scene* opens an editor,
// which nothing implements. Real in-scene delay editing doesn't exist yet
// (scene click only selects/focuses a hole, see SelectionBar's 'hole' case),
// so the callout here only claims what's real — the firing order IS drawn on
// the holes (BlastPlanOverlay's delay labels) — and each row gets its own
// +/- stepper as the actual edit mechanism, stepping by the same delay-step
// value the Auto V-Pattern button uses.
//
// "Row" grouping is computed from each hole's real z coordinate (distinct z
// values, sorted, 1-indexed) — the same grouping autoVPattern() itself uses
// — not the design mock's placeholder `Math.ceil(n / 3)`.

import { t } from '../../../core/i18n/I18n.js';
import { el, stepper, emptyState } from '../../dom.js';
import { iconEl, type IconName } from '../../icons.js';
import { LocaleTextRegistry } from '../../localeText.js';
import type { GameState } from '../../../core/state/GameState.js';
import type { DrillHole } from '../../../core/mining/DrillPlan.js';
import type { CommandResult } from '../../../console/ConsoleRunner.js';

export type GameConsoleFn = (cmd: string) => CommandResult;

const DEFAULT_DELAY_STEP_MS = 25;
const MIN_DELAY_STEP_MS = 5;
const DELAY_STEP_INCREMENT = 5;

export class SequenceStep {
  private readonly el: HTMLElement;
  private readonly dstepValueEl: HTMLElement;
  private readonly holeListEl: HTMLElement;

  private gameConsole?: GameConsoleFn;
  private dstepMs = DEFAULT_DELAY_STEP_MS;
  private lastDelays: Record<string, number> = {};
  private lastSignature = '';
  private readonly locale = new LocaleTextRegistry();

  constructor(container: HTMLElement) {
    this.el = el('div');
    this.el.style.cssText = 'display:flex;flex-direction:column;gap:11px';

    const sectionEl = el('div', { className: 'bsx-section' });
    sectionEl.append(
      this.locale.bindText(el('span', { className: 'bsx-section-label' }), 'ui.blast_workshop.sequence.section'),
      el('span', { className: 'bsx-section-rule' }),
    );

    const fieldLabelStyle = 'font:600 10px/1 var(--bsx-font-ui);letter-spacing:.12em;color:var(--bsx-text-micro)';
    const dstepStepperEl = stepper(`${this.dstepMs} ms`, () => this.adjustDelayStep(-DELAY_STEP_INCREMENT), () => this.adjustDelayStep(DELAY_STEP_INCREMENT));
    this.dstepValueEl = dstepStepperEl.querySelector('.bsx-stepper-value') as HTMLElement;
    const dstepField = el('div', { children: [
      this.locale.bindText(el('span', { attrs: { style: fieldLabelStyle } }), 'ui.blast_workshop.sequence.delay_step'),
      dstepStepperEl,
    ] });
    dstepField.style.cssText = 'flex:1;display:flex;flex-direction:column;gap:4px';

    const autoBtn = el('button', { className: 'bsx-btn bsx-btn-primary' });
    autoBtn.style.cssText = 'flex:1;align-self:flex-end;height:32px';
    autoBtn.dataset['action'] = 'auto-sequence';
    this.locale.bindText(autoBtn, 'ui.blast_workshop.sequence.auto');
    autoBtn.addEventListener('click', () => this.gameConsole?.(`sequence auto delay_step:${this.dstepMs}ms`));

    const controlRow = el('div', { children: [dstepField, autoBtn] });
    controlRow.style.cssText = 'display:flex;gap:8px;align-items:flex-end';

    const callout = el('div');
    callout.style.cssText = 'display:flex;align-items:center;gap:7px;padding:9px 11px;border-radius:5px;background:rgba(169,140,255,.08);border:1px solid rgba(169,140,255,.24)';
    const calloutIcon = el('div', { attrs: { style: 'color:var(--bsx-ore)' }, children: [iconEl('eye', 14)] });
    const calloutText = this.locale.bindText(
      el('span', { attrs: { style: 'font:400 11px/1.4 var(--bsx-font-ui);color:var(--bsx-text-secondary);flex:1' } }),
      'ui.blast_workshop.sequence.callout',
    );
    callout.append(calloutIcon, calloutText);

    this.holeListEl = el('div');
    // Bounded + independently scrollable, same reasoning as Charge's product
    // list: a full tutorial-sized plan (16 holes) would otherwise inflate the
    // step far past the panel's fold.
    this.holeListEl.style.cssText = 'display:flex;flex-direction:column;gap:3px;max-height:220px;overflow-y:auto';

    this.el.append(sectionEl, controlRow, callout, this.holeListEl);
    container.appendChild(this.el);
  }

  get root(): HTMLElement { return this.el; }

  setGameConsole(fn: GameConsoleFn): void { this.gameConsole = fn; }

  update(state: GameState): void {
    const holes = state.drillHoles;
    this.lastDelays = state.sequenceDelays;

    const signature = JSON.stringify({
      holes: holes.map(h => [h.id, h.z]),
      delays: state.sequenceDelays,
      dstep: this.dstepMs,
    });
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;

    if (holes.length === 0) {
      this.holeListEl.replaceChildren(emptyState(t('ui.blast_workshop.sequence.no_holes')));
      return;
    }

    const distinctZs = [...new Set(holes.map(h => h.z))].sort((a, b) => a - b);
    const rowIndex = new Map(distinctZs.map((z, i) => [z, i + 1]));
    this.holeListEl.replaceChildren(...holes.map(h => this.makeHoleRow(h, rowIndex.get(h.z)!)));
  }

  refreshLocale(): void {
    this.locale.refresh();
    this.lastSignature = '';
  }

  dispose(): void { this.el.remove(); }

  private makeHoleRow(hole: DrillHole, rowNumber: number): HTMLElement {
    const row = el('div');
    row.style.cssText = 'display:flex;align-items:center;gap:9px;height:32px;padding:0 10px;border:1px solid var(--bsx-hairline);border-radius:4px;background:var(--bsx-card)';
    row.dataset['hole'] = hole.id;

    const tag = el('span', { text: hole.id, attrs: { style: 'font:600 11px/1 var(--bsx-font-mono);color:var(--bsx-ore);width:24px' } });
    const rowLabel = el('span', {
      text: t('ui.blast_workshop.sequence.row', { n: rowNumber }),
      attrs: { style: 'font:400 10px/1 var(--bsx-font-ui);color:var(--bsx-text-micro)' },
    });

    const delayMs = this.lastDelays[hole.id];
    const valueEl = el('span', {
      text: delayMs !== undefined ? `${delayMs} ms` : '—',
      attrs: { style: 'font:600 11px/1 var(--bsx-font-mono);color:var(--bsx-text-primary);min-width:46px;text-align:center' },
    });
    const dec = this.microStepBtn('minus', 'delay-dec', () => this.adjustHoleDelay(hole.id, -this.dstepMs, valueEl));
    const inc = this.microStepBtn('plus', 'delay-inc', () => this.adjustHoleDelay(hole.id, this.dstepMs, valueEl));

    const controls = el('div', { children: [dec, valueEl, inc] });
    controls.style.cssText = 'display:flex;align-items:center;gap:2px;margin-left:auto';

    row.append(tag, rowLabel, controls);
    return row;
  }

  private microStepBtn(icon: IconName, action: string, onClick: () => void): HTMLButtonElement {
    const btn = el('button');
    btn.style.cssText = 'width:20px;height:20px;display:flex;align-items:center;justify-content:center;border:0;background:transparent;color:var(--bsx-text-micro);cursor:pointer;padding:0';
    btn.dataset['action'] = action;
    btn.appendChild(iconEl(icon, 9));
    btn.addEventListener('click', onClick);
    return btn;
  }

  private adjustDelayStep(delta: number): void {
    this.dstepMs = Math.max(MIN_DELAY_STEP_MS, this.dstepMs + delta);
    this.dstepValueEl.textContent = `${this.dstepMs} ms`;
    this.lastSignature = '';
  }

  private adjustHoleDelay(holeId: string, delta: number, valueEl: HTMLElement): void {
    const current = this.lastDelays[holeId] ?? 0;
    const next = Math.max(0, current + delta);
    valueEl.textContent = `${next} ms`;
    this.gameConsole?.(`sequence set hole:${holeId} delay:${next}ms`);
    this.lastSignature = '';
  }
}
