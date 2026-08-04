// BlastSimulator2026 — Blast Workshop: Fire step (redesign P4)
// Interim placeholder for the step-specific body (danger-zone occupant list,
// SOUND THE HORN, pre-flight checklist) — the FIRE button itself lives in
// the always-visible sticky footer (blastFooter.ts), not here. Task P4/#26
// replaces this with the real danger-zone/pre-flight content.

import { el } from '../../dom.js';
import { LocaleTextRegistry } from '../../localeText.js';

export class FireStep {
  private readonly el: HTMLElement;
  private readonly locale = new LocaleTextRegistry();

  constructor(container: HTMLElement) {
    const body = el('div', { className: 'bsx-empty' });
    this.locale.bindText(body, 'ui.blast_workshop.fire_body.coming_soon');
    this.el = el('div', { children: [body] });
    container.appendChild(this.el);
  }

  get root(): HTMLElement { return this.el; }

  refreshLocale(): void { this.locale.refresh(); }
}
