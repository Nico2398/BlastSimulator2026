// BlastSimulator2026 — Placement parameter strip (redesign P3)
// The 44px non-modal strip docked bottom-centre while a placement tool is
// armed: instruction chip above it, then title/steppers/RESULT/CONFIRM/ESC.
// Caller (Drill step/BuildMenu/SurveyPanel) owns the parameters and result
// text — this only renders whatever config it's handed, same signature-gated
// rebuild convention as the rest of src/ui/.

import { el, button, stepper } from '../dom.js';
import { iconEl, type IconName } from '../icons.js';
import { t } from '../../core/i18n/I18n.js';

export interface ParamStripField {
  key: string;
  label: string;
  value: number;
  format?: (v: number) => string;
  onDec: () => void;
  onInc: () => void;
}

export interface ParamStripConfig {
  icon: IconName;
  title: string;
  subtitle: string;
  /** Steppers shown between the title block and RESULT. Empty for variants with nothing to tune (survey, building). */
  fields: ParamStripField[];
  result: string;
  /** RESULT turns red (cost exceeds balance) but Confirm stays clickable — the trade is visible, not blocked. */
  resultWarn?: boolean;
  confirmEnabled: boolean;
  /**
   * Shown as a reason line under the strip when Confirm is disabled.
   *
   * Rendered, not just hung on the button's `title`: a tooltip needs a hover a
   * player has no reason to attempt, so before #489 every refusal this strip
   * knew about reached the screen as nothing at all.
   */
  confirmDisabledReason?: string | undefined;
  /** Chip text above the strip while armed, e.g. "Drag across the bench to lay out drill holes". */
  instruction: string;
}

export class ParamStrip {
  private readonly root: HTMLElement;
  private readonly chip: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly reasonEl: HTMLElement;
  private onConfirmHandler: (() => void) | null = null;
  private onCancelHandler: (() => void) | null = null;
  private lastSignature = '';

  constructor(container: HTMLElement) {
    this.root = el('div', { attrs: { id: 'bs-param-strip' } });
    this.root.className = 'bsx-root';
    // bottom offset lives in styles.ts, not here: the guided tutorial's coach
    // card docks at the same screen edge, and an inline style here would beat
    // that CSS override the same way TopBar's inline pointer-events used to
    // beat the tutorial rail (#475 session fix) — an external rule can never
    // win against an inline one, regardless of specificity.
    this.root.style.cssText = [
      'position:fixed', 'left:50%', 'transform:translateX(-50%)',
      'z-index:var(--bsx-z-selection-bar, 120)', 'display:none', 'flex-direction:column',
      'align-items:center', 'gap:10px', 'pointer-events:none',
    ].join(';');

    this.chip = el('div');
    this.chip.style.cssText = [
      'display:flex', 'align-items:center', 'gap:10px', 'padding:6px 12px', 'border-radius:20px',
      'background:rgba(9,12,16,.9)', 'border:1px solid rgba(255,200,64,.4)', 'pointer-events:none',
    ].join(';');

    this.bar = el('div');
    this.bar.id = 'bs-param-strip-bar';
    this.bar.style.cssText = [
      'display:flex', 'align-items:stretch', 'border-radius:7px', 'background:var(--bsx-panel,#141920)',
      'border:1px solid rgba(255,200,64,.34)', 'box-shadow:0 14px 38px rgba(0,0,0,.55)', 'overflow:hidden',
      'pointer-events:all', 'height:44px',
    ].join(';');

    this.reasonEl = el('div', { attrs: { id: 'bs-param-strip-reason' } });
    this.reasonEl.style.cssText = [
      'display:none', 'padding:5px 12px', 'border-radius:5px',
      'background:rgba(255,106,90,.16)', 'border:1px solid rgba(255,106,90,.5)',
      'color:var(--bsx-critical-text,#ff8a7e)', 'font:600 11px/1.3 var(--bsx-font-ui)',
      'max-width:520px', 'text-align:center', 'pointer-events:none',
    ].join(';');

    // Above the bar, not below it: the strip is bottom-docked and the tutorial
    // coach card sits directly under it, so a line appended below is drawn
    // half-behind the card — which is how a reason that exists can still fail
    // to reach the player.
    this.root.append(this.chip, this.reasonEl, this.bar);
    container.appendChild(this.root);
  }

  setConfirmHandler(cb: () => void): void { this.onConfirmHandler = cb; }
  setCancelHandler(cb: () => void): void { this.onCancelHandler = cb; }

  show(config: ParamStripConfig): void {
    this.root.style.display = 'flex';
    const sig = JSON.stringify({
      icon: config.icon, title: config.title, subtitle: config.subtitle,
      fields: config.fields.map(f => [f.key, f.value]),
      result: config.result, warn: config.resultWarn, confirm: config.confirmEnabled,
      reason: config.confirmDisabledReason, instr: config.instruction,
    });
    if (sig === this.lastSignature) return;
    this.lastSignature = sig;
    this.render(config);
  }

  hide(): void {
    this.root.style.display = 'none';
    this.lastSignature = '';
  }

  /** Force the next show() to rebuild, so a language switch is picked up even though nothing else changed. */
  refreshLocale(): void { this.lastSignature = ''; }

  private render(config: ParamStripConfig): void {
    this.chip.replaceChildren(
      iconEl(config.icon, 14),
      el('span', { text: config.instruction, attrs: { style: 'font:600 11px/1 var(--bsx-font-ui);color:var(--bsx-text-primary,#e6e9ee)' } }),
      el('span', { attrs: { style: 'width:1px;height:14px;background:rgba(255,255,255,.16)' } }),
      el('span', { text: t('shell.placement.camera_hint'), attrs: { style: 'font:500 10px/1 var(--bsx-font-mono);color:var(--bsx-text-muted)' } }),
    );

    const titleBlock = el('div');
    titleBlock.style.cssText = 'display:flex;align-items:center;gap:9px;padding:0 14px;background:rgba(255,200,64,.1);border-right:1px solid rgba(255,255,255,.09)';
    const titleCol = el('div');
    titleCol.style.cssText = 'display:flex;flex-direction:column;gap:2px';
    titleCol.append(
      el('span', { text: config.title, attrs: { style: 'font:700 11px/1 var(--bsx-font-ui);letter-spacing:.1em;color:#ffc840' } }),
      el('span', { text: config.subtitle, attrs: { style: 'font:500 10px/1 var(--bsx-font-mono);color:var(--bsx-text-muted)' } }),
    );
    titleBlock.append(iconEl(config.icon, 15), titleCol);

    const fieldEls = config.fields.map((f) => {
      // data-field, not just a positional wrapper: without it there is no
      // selector a click-only scenario/playtest step can target to set an
      // exact spacing/depth before confirming a grid — only the whole-strip
      // default was reachable, silently making an explicit spacing:N in a
      // scenario's command field describe a different grid than the click
      // actually drags (found converting scenarios to real assertions,
      // issue #479 follow-up).
      const wrap = el('div', { attrs: { 'data-field': f.key } });
      wrap.style.cssText = 'display:flex;flex-direction:column;gap:4px;padding:7px 12px;border-right:1px solid rgba(255,255,255,.07);justify-content:center';
      wrap.append(
        el('span', { text: f.label, attrs: { style: 'font:600 10px/1 var(--bsx-font-ui);letter-spacing:.12em;color:var(--bsx-text-muted)' } }),
        stepper(f.format ? f.format(f.value) : String(f.value), f.onDec, f.onInc),
      );
      return wrap;
    });

    const resultBlock = el('div');
    resultBlock.style.cssText = 'display:flex;flex-direction:column;gap:4px;padding:7px 14px;border-right:1px solid rgba(255,255,255,.07);justify-content:center';
    resultBlock.append(
      el('span', { text: t('shell.placement.result'), attrs: { style: 'font:600 10px/1 var(--bsx-font-ui);letter-spacing:.12em;color:var(--bsx-text-muted)' } }),
      el('span', { text: config.result, attrs: { style: `font:600 12px/1 var(--bsx-font-mono);color:${config.resultWarn ? 'var(--bsx-critical-text,#ff8a7e)' : '#ffc840'}` } }),
    );

    const actions = el('div');
    actions.style.cssText = 'display:flex;align-items:center;gap:7px;padding:7px 12px';
    const confirmBtn = button('primary', t('shell.placement.confirm'), {
      icon: 'check',
      dataAction: 'confirm',
      disabled: !config.confirmEnabled,
      onClick: () => this.onConfirmHandler?.(),
      ...(config.confirmDisabledReason ? { title: config.confirmDisabledReason } : {}),
    });
    confirmBtn.id = 'bs-tile-select-confirm'; // preserved id — every scenario/playtest def targeting the old 2D picker's Confirm keeps resolving
    const escBtn = button('ghost', t('shell.placement.esc'), { onClick: () => this.onCancelHandler?.() });
    actions.append(confirmBtn, escBtn);

    this.bar.replaceChildren(titleBlock, ...fieldEls, resultBlock, actions);

    const reason = !config.confirmEnabled ? config.confirmDisabledReason : undefined;
    this.reasonEl.textContent = reason ?? '';
    this.reasonEl.style.display = reason ? 'block' : 'none';
  }

  dispose(): void { this.root.remove(); }
}
