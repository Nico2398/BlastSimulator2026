// BlastSimulator2026 — Activity log drawer (redesign P1)
// Right-side drawer, z500, holding every notification ever raised — nothing
// is lost once a toast's 6.5s expire.

import { iconEl } from '../icons.js';
import { el } from '../dom.js';
import { t } from '../../core/i18n/I18n.js';
import type { NotificationCenter } from '../notify/NotificationCenter.js';

export class ActivityLog {
  private readonly el: HTMLElement;
  private readonly body: HTMLElement;
  private _visible = false;
  private lastSignature = '';

  constructor(container: HTMLElement) {
    this.el = el('div', { className: 'bsx-root' });
    this.el.style.cssText = [
      'position:fixed', 'right:0', 'top:0', 'bottom:0', 'width:352px',
      'z-index:var(--bsx-z-log)', 'background:var(--bsx-panel)',
      'border-left:1px solid var(--bsx-hairline-strong)',
      'box-shadow:-18px 0 44px rgba(0,0,0,.5)', 'display:none',
      'flex-direction:column', 'pointer-events:all',
    ].join(';');

    const header = el('div');
    header.style.cssText = 'display:flex;align-items:center;gap:10px;height:46px;padding:0 12px;background:var(--bsx-chrome);border-bottom:1px solid var(--bsx-hairline-strong)';
    header.appendChild(iconEl('bell', 15));
    const title = el('span', { text: t('shell.log.title') });
    title.style.cssText = 'font:700 12px/1 var(--bsx-font-ui);letter-spacing:.14em;color:var(--bsx-text-primary)';
    const close = el('button');
    close.style.cssText = 'margin-left:auto;width:28px;height:28px;display:flex;align-items:center;justify-content:center;border:1px solid var(--bsx-hairline-strong);border-radius:4px;background:transparent;color:var(--bsx-text-muted);cursor:pointer;pointer-events:all';
    close.appendChild(iconEl('x', 12));
    close.addEventListener('click', () => this.hide());
    header.append(title, close);

    this.body = el('div');
    this.body.style.cssText = 'flex:1;overflow-y:auto;padding:10px';

    this.el.append(header, this.body);
    container.appendChild(this.el);
  }

  show(): void { this._visible = true; this.el.style.display = 'flex'; this.lastSignature = ''; }
  hide(): void { this._visible = false; this.el.style.display = 'none'; }
  toggle(): void { this._visible ? this.hide() : this.show(); }
  get visible(): boolean { return this._visible; }

  update(center: NotificationCenter): void {
    if (!this._visible) return;
    const log = center.getLog();
    const signature = log.map(e => e.id).join(',');
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;
    this.body.replaceChildren();
    if (log.length === 0) {
      this.body.appendChild(el('div', { className: 'bsx-empty', text: t('shell.log.empty') }));
      return;
    }
    for (const entry of log) {
      const row = el('div');
      row.style.cssText = 'display:flex;gap:9px;padding:10px 8px;border-bottom:1px solid var(--bsx-hairline)';
      const iconWrap = el('div');
      iconWrap.style.cssText = `color:${entry.color};padding-top:1px`;
      iconWrap.appendChild(iconEl(entry.icon, 14));
      const body = el('div');
      body.style.cssText = 'display:flex;flex-direction:column;gap:3px;flex:1;min-width:0';
      body.appendChild(el('div', { text: entry.title, attrs: { style: 'font:600 11px/1.3 var(--bsx-font-ui);color:var(--bsx-text-primary)' } }));
      body.appendChild(el('div', { text: entry.body, attrs: { style: 'font:400 10px/1.45 var(--bsx-font-ui);color:var(--bsx-text-muted)' } }));
      const when = el('span', { className: 'bsx-mono', text: `t${entry.tick}` });
      when.style.cssText = 'font-size:11px;color:var(--bsx-text-micro);white-space:nowrap';
      row.append(iconWrap, body, when);
      this.body.appendChild(row);
    }
  }

  dispose(): void { this.el.remove(); }
}
