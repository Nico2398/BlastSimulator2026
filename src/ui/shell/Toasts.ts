// BlastSimulator2026 — Toast stack (redesign P1)
// Stacked, severity-colored, click-through-to-source, auto-dismissing.
// Replaces UIManager.showNotification's single fixed toast.

import { iconEl } from '../icons.js';
import { el } from '../dom.js';
import type { NotificationCenter, Toast } from '../notify/NotificationCenter.js';

export class Toasts {
  private readonly el: HTMLElement;
  private lastSignature = '';

  constructor(container: HTMLElement) {
    this.el = el('div', { className: 'bsx-root' });
    this.el.style.cssText = [
      'position:fixed', 'right:96px', 'top:12px', 'z-index:var(--bsx-z-panel)',
      'width:296px', 'display:flex', 'flex-direction:column', 'gap:7px',
      'pointer-events:none',
    ].join(';');
    container.appendChild(this.el);
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

  dispose(): void { this.el.remove(); }

  private makeToast(toast: Toast, center: NotificationCenter): HTMLElement {
    const box = el('div');
    box.style.cssText = [
      'display:flex', 'gap:9px', 'padding:10px 11px', 'border-radius:6px',
      'background:rgba(17,21,27,.97)', 'border:1px solid rgba(255,255,255,.1)',
      `border-left:3px solid ${toast.color}`, 'box-shadow:0 8px 24px rgba(0,0,0,.45)',
      'pointer-events:all', 'animation:bsx-toast-in .18s ease-out',
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
