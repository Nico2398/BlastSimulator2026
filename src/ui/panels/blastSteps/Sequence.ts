// BlastSimulator2026 — Blast Workshop: Sequence step (redesign P4)
// Interim stub: a single Auto Sequence (V-pattern) button, enough to keep
// the tutorial's sequence flow working. Task P4/#24 replaces this with the
// delay-step stepper and per-hole delay rows.

import { el } from '../../dom.js';
import { LocaleTextRegistry } from '../../localeText.js';
import type { CommandResult } from '../../../console/ConsoleRunner.js';

export type GameConsoleFn = (cmd: string) => CommandResult;

export class SequenceStep {
  private readonly el: HTMLElement;
  private gameConsole?: GameConsoleFn;
  private readonly locale = new LocaleTextRegistry();

  constructor(container: HTMLElement) {
    this.el = el('div');
    this.el.style.cssText = 'display:flex;flex-direction:column;gap:10px';

    const sectionEl = el('div', { className: 'bsx-section' });
    sectionEl.append(
      this.locale.bindText(el('span', { className: 'bsx-section-label' }), 'ui.blast_workshop.sequence.section'),
      el('span', { className: 'bsx-section-rule' }),
    );

    const autoBtn = el('button', { className: 'bsx-btn bsx-btn-primary' });
    this.locale.bindText(autoBtn, 'ui.blast_workshop.sequence.auto');
    autoBtn.dataset['action'] = 'auto-sequence';
    autoBtn.addEventListener('click', () => this.gameConsole?.('sequence auto delay_step:25ms'));

    const comingSoon = el('div', { className: 'bsx-empty' });
    this.locale.bindText(comingSoon, 'ui.blast_workshop.sequence.coming_soon');

    this.el.append(sectionEl, autoBtn, comingSoon);
    container.appendChild(this.el);
  }

  get root(): HTMLElement { return this.el; }

  setGameConsole(fn: GameConsoleFn): void { this.gameConsole = fn; }

  refreshLocale(): void { this.locale.refresh(); }
}
