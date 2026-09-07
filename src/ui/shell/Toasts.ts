// BlastSimulator2026 — Toast stack (redesign P1)
// Stacked, severity-colored, click-through-to-source, auto-dismissing.
// Replaces UIManager.showNotification's single fixed toast.

import { iconEl } from '../icons.js';
import { el } from '../dom.js';
import type { NotificationCenter, Toast } from '../notify/NotificationCenter.js';
import { shellLayoutRegistry, type Viewport, type Rect } from './LayoutRegistry.js';
import { TOPBAR_HEIGHT_PX, SPACING_3_PX } from '../tokens.js';
import { MAX_TOASTS } from '../notify/NotificationCenter.js';

/** Right offset of the toast stack, matching its `right:` inline style below. */
const TOASTS_RIGHT_OFFSET_PX = 96;
/** Toast stack width, matching its `width:` inline style below. */
const TOASTS_WIDTH_PX = 296;
/** Gap between stacked toasts, matching its `gap:` inline style below. */
const TOASTS_GAP_PX = 7;
/**
 * Worst-case single-toast height: vertical padding (2×10) + a one-line title
 * (~15px @ 12px/1.25) + column gap (3) + a two-line body — the conservative
 * case, since body text length is content-driven and can wrap within the
 * ~296px stack width (~2×15.4px @ 11px/1.4) + column gap (3) + an optional
 * CTA line (~10px + 2px margin-top), rounded up. See makeToast() below.
 */
const TOAST_ENTRY_HEIGHT_PX = 84;

/**
 * Stack pinned below the top bar, right-aligned. Declared at its worst-case
 * height (MAX_TOASTS entries) rather than the live count: the envelope a
 * region reserves has to hold whatever it may grow to, since the matrix test
 * runs against declared bounds, not a rendered DOM.
 */
function toastsBounds(viewport: Viewport): Rect {
  const height = MAX_TOASTS * TOAST_ENTRY_HEIGHT_PX + (MAX_TOASTS - 1) * TOASTS_GAP_PX;
  return {
    x: viewport.width - TOASTS_RIGHT_OFFSET_PX - TOASTS_WIDTH_PX,
    y: TOPBAR_HEIGHT_PX + SPACING_3_PX,
    width: TOASTS_WIDTH_PX,
    height,
  };
}

export class Toasts {
  private readonly el: HTMLElement;
  private lastSignature = '';

  constructor(container: HTMLElement) {
    this.el = el('div', { className: 'bsx-root', attrs: { id: 'bs-toasts' } });
    this.el.style.cssText = [
      'position:fixed', `right:${TOASTS_RIGHT_OFFSET_PX}px`, 'top:calc(var(--bsx-topbar-height) + var(--bsx-sp-3))', 'z-index:var(--bsx-z-toast)',
      `width:${TOASTS_WIDTH_PX}px`, 'display:flex', 'flex-direction:column', `gap:${TOASTS_GAP_PX}px`,
      'pointer-events:none',
    ].join(';');
    container.appendChild(this.el);

    shellLayoutRegistry.register({ id: 'toasts', layer: 'hud', bounds: toastsBounds });
  }

  update(center: NotificationCenter): void {
    const toasts = center.getToasts();
    const signature = toasts.map(t => t.id).join(',');
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;
    this.el.replaceChildren();
    for (const toast of toasts) this.el.appendChild(this.makeToast(toast, center));
  }

  /** Hidden pre-game (redesign P8) — this is HUD chrome, nothing to show before a level exists. */
  show(): void { this.el.style.display = 'flex'; }
  hide(): void { this.el.style.display = 'none'; }
  get visible(): boolean { return this.el.style.display !== 'none'; }

  dispose(): void {
    this.el.remove();
    shellLayoutRegistry.unregister('toasts');
  }

  private makeToast(toast: Toast, center: NotificationCenter): HTMLElement {
    const box = el('div');
    // No entrance animation (issue #977): a toast's visibility must never depend
    // on an animation frame actually running. Under sustained main-thread load
    // (headless/no-GPU rendering), a CSS animation's currentTime can fail to
    // advance for the toast's entire fixed lifetime, so a fade-in from
    // opacity:0 could leave it never visibly painted before auto-dismiss.
    // The toast is fully visible (opacity:1, no transform offset) from its
    // first painted frame instead.
    box.style.cssText = [
      'display:flex', 'gap:9px', 'padding:10px 11px', 'border-radius:6px',
      'background:rgba(17,21,27,.97)', 'border:1px solid rgba(255,255,255,.1)',
      `border-left:3px solid ${toast.color}`, 'box-shadow:0 8px 24px rgba(0,0,0,.45)',
      'pointer-events:all',
    ].join(';');

    const iconWrap = el('div');
    iconWrap.style.cssText = `color:${toast.color};padding-top:1px`;
    iconWrap.appendChild(iconEl(toast.icon, 15));

    const body = el('div');
    body.style.cssText = 'display:flex;flex-direction:column;gap:3px;flex:1;min-width:0';
    body.appendChild(el('div', { text: toast.title, attrs: { style: 'font:600 12px/1.25 var(--bsx-font-ui);color:var(--bsx-text-primary)' } }));
    body.appendChild(el('div', { text: toast.body, attrs: { style: 'font:400 11px/1.4 var(--bsx-font-ui);color:var(--bsx-text-secondary)' } }));
    if (toast.cta && toast.onCta) {
      const cta = el('button', { text: toast.cta });
      cta.style.cssText = `align-self:flex-start;margin-top:2px;padding:0;border:0;background:transparent;color:${toast.color};font:600 10px/1 var(--bsx-font-ui);letter-spacing:.1em;cursor:pointer;pointer-events:all`;
      cta.addEventListener('click', () => { toast.onCta?.(); center.dismissToast(toast.id); this.lastSignature = ''; });
      body.appendChild(cta);
    }

    const close = el('button');
    close.style.cssText = 'width:18px;height:18px;display:flex;align-items:center;justify-content:center;border:0;background:transparent;color:var(--bsx-text-micro);cursor:pointer;padding:0;pointer-events:all';
    close.appendChild(iconEl('x', 10));
    close.addEventListener('click', () => { center.dismissToast(toast.id); this.lastSignature = ''; });

    box.append(iconWrap, body, close);
    return box;
  }
}
