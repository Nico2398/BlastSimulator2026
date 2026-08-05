// BlastSimulator2026 — Confirm Modal (redesign P6)
// Generic confirm-before-destructive-action overlay, shared by CrewPanel's
// DISMISS and FleetPanel's SCRAP (and any future irreversible action) — all
// content is caller-supplied at show() time, already localized; this owns
// only the chrome and the confirm/cancel wiring, nothing domain-specific.
//
// Kept on .bs-confirm-overlay (not a new class) so the tutorial rail's modal
// carve-out (tutorialGuide.ts's MODAL_SELECTOR) and uiActionProbe's `confirm`
// region keep resolving it without changes there — same convention
// PreflightModal/BlastReportModal already established in P4.

import { t } from '../../core/i18n/I18n.js';
import { el } from '../dom.js';
import { iconEl, type IconName } from '../icons.js';

export interface ConfirmModalConfig {
  icon: IconName;
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
}

export class ConfirmModal {
  private readonly overlay: HTMLElement;
  private readonly iconChip: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly bodyEl: HTMLElement;
  private readonly confirmBtn: HTMLButtonElement;
  private readonly cancelBtn: HTMLButtonElement;

  private open = false;
  private onConfirmCb: (() => void) | null = null;

  constructor(container: HTMLElement) {
    this.overlay = el('div', {
      className: 'bs-confirm-overlay',
      // Same reasoning as SavesModal's own z-index override: a panel raising
      // a confirm on itself (Settings' RETURN TO MAIN MENU, P10) needs the
      // confirm to beat the menu tier it's sitting in — but only THIS
      // overlay, not every .bs-confirm-overlay user (PreflightModal,
      // BlastReportModal keep the class's own lower base tier; see the
      // comment on .bs-confirm-overlay in styles.ts for what raising the
      // shared rule instead broke).
      attrs: { style: 'z-index:var(--bsx-z-modal)' },
    });
    this.overlay.style.display = 'none';

    const box = el('div');
    box.style.cssText = 'width:420px;max-width:92vw;display:flex;flex-direction:column;border-radius:9px;background:var(--bsx-panel);border:1px solid rgba(255,91,76,.4);box-shadow:0 30px 80px rgba(0,0,0,.7);overflow:hidden';

    const stripe = el('div');
    stripe.style.cssText = 'height:6px;flex:0 0 auto;background:repeating-linear-gradient(45deg,#ff5b4c 0 11px,var(--bsx-panel) 11px 22px)';

    const header = el('div');
    header.style.cssText = 'padding:18px 20px 4px;display:flex;align-items:center;gap:11px';
    this.iconChip = el('div');
    this.iconChip.style.cssText = 'width:32px;height:32px;border-radius:6px;display:flex;align-items:center;justify-content:center;background:rgba(255,91,76,.16);color:var(--bsx-critical-text);flex:0 0 auto';
    this.titleEl = el('span', { attrs: { style: 'font:800 14px/1 var(--bsx-font-ui);letter-spacing:.06em' } });
    header.append(this.iconChip, this.titleEl);

    this.bodyEl = el('div', { attrs: { style: 'padding:10px 20px 18px;font:400 12px/1.5 var(--bsx-font-ui);color:var(--bsx-text-secondary)' } });

    const footer = el('div');
    footer.style.cssText = 'padding:14px 20px;background:var(--bsx-well);border-top:1px solid var(--bsx-hairline);display:flex;gap:9px';
    this.cancelBtn = el('button', { className: 'bsx-btn' });
    this.cancelBtn.style.cssText = 'flex:1;height:38px';
    this.cancelBtn.dataset['action'] = 'confirm-cancel';
    this.cancelBtn.addEventListener('click', () => this.hide());

    // bs-btn-danger alongside the bsx- token classes: PreflightModal's
    // detonate button carries it too, so the tutorial rails' blast-confirm
    // target (.bs-confirm-overlay .bs-btn-danger, tutorialStages.ts) matches
    // consistently across every .bs-confirm-overlay-based modal.
    this.confirmBtn = el('button', { className: 'bsx-btn bsx-btn-danger-solid bs-btn-danger' });
    this.confirmBtn.style.cssText = 'flex:1.4;height:38px';
    this.confirmBtn.dataset['action'] = 'confirm-yes';
    this.confirmBtn.addEventListener('click', () => this.confirm());

    footer.append(this.cancelBtn, this.confirmBtn);
    box.append(stripe, header, this.bodyEl, footer);
    this.overlay.appendChild(box);
    container.appendChild(this.overlay);
  }

  get root(): HTMLElement { return this.overlay; }

  show(config: ConfirmModalConfig): void {
    this.onConfirmCb = config.onConfirm;
    this.iconChip.replaceChildren(iconEl(config.icon, 18));
    this.titleEl.textContent = config.title;
    this.bodyEl.textContent = config.body;
    this.confirmBtn.textContent = config.confirmLabel;
    this.cancelBtn.textContent = t('ui.confirm.cancel');
    this.open = true;
    this.overlay.style.display = '';
  }

  hide(): void {
    this.open = false;
    this.overlay.style.display = 'none';
    this.onConfirmCb = null;
  }

  get visible(): boolean { return this.open; }

  /**
   * No LocaleTextRegistry binding: every piece of text is set fresh by the
   * caller at show() time, already localized, and the modal is a full-screen
   * overlay — nothing behind it (including Settings' language buttons) is
   * reachable while it's open, so there is no "stale language while visible"
   * case to guard against.
   */
  refreshLocale(): void {}

  dispose(): void { this.overlay.remove(); }

  private confirm(): void {
    const cb = this.onConfirmCb;
    this.hide();
    cb?.();
  }
}
