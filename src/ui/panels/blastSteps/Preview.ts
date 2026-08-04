// BlastSimulator2026 — Blast Workshop: Preview step (redesign P4)
// Interim placeholder — no load-bearing data-action targets this step (the
// old panel's own `preview` button had none either). Task P4/#25 replaces
// this with the Analysis Suite tier list and PREDICTED-result rows.

import { el } from '../../dom.js';
import { LocaleTextRegistry } from '../../localeText.js';

export class PreviewStep {
  private readonly el: HTMLElement;
  private readonly locale = new LocaleTextRegistry();

  constructor(container: HTMLElement) {
    const body = el('div', { className: 'bsx-empty' });
    this.locale.bindText(body, 'ui.blast_workshop.preview.coming_soon');
    this.el = el('div', { children: [body] });
    container.appendChild(this.el);
  }

  get root(): HTMLElement { return this.el; }

  refreshLocale(): void { this.locale.refresh(); }
}
