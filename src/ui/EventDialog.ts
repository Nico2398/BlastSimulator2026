// BlastSimulator2026 — Event Dialog (10.7)
// Modal dialog shown when a pending event requires player decision.

import { t } from '../core/i18n/I18n.js';
import type { GameState } from '../core/state/GameState.js';
import { getEventById } from '../core/events/EventPool.js';

export type GameConsoleFn = (cmd: string) => string;

export class EventDialog {
  private readonly overlay: HTMLElement;
  private readonly box: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly descEl: HTMLElement;
  private readonly optionsEl: HTMLElement;
  private readonly outcomeEl: HTMLElement;
  private gameConsole?: GameConsoleFn;

  constructor(container: HTMLElement) {
    this.overlay = document.createElement('div');
    this.overlay.className = 'bs-confirm-overlay';
    this.overlay.style.display = 'none';

    this.box = document.createElement('div');
    this.box.className = 'bs-confirm-box';
    this.box.style.maxWidth = '320px';

    const header = document.createElement('div');
    header.className = 'bs-panel-title';
    header.style.marginBottom = '6px';
    header.textContent = t('ui.event.title');

    this.titleEl = document.createElement('div');
    this.titleEl.style.cssText = 'font-size:13px;color:#e0c090;font-weight:bold;margin-bottom:6px';

    this.descEl = document.createElement('p');
    this.descEl.style.cssText = 'font-size:11px;color:#c0a070;margin:0 0 10px';

    const chooseLabel = document.createElement('div');
    chooseLabel.style.cssText = 'font-size:10px;color:#808060;margin-bottom:4px';
    chooseLabel.textContent = t('ui.event.choose');

    this.optionsEl = document.createElement('div');
    this.optionsEl.style.cssText = 'display:flex;flex-direction:column;gap:4px';

    this.outcomeEl = document.createElement('div');
    this.outcomeEl.style.cssText = 'font-size:11px;color:#80c080;margin-top:8px;display:none';

    const dismissBtn = document.createElement('button');
    dismissBtn.className = 'bs-btn';
    dismissBtn.style.cssText = 'width:100%;margin-top:8px';
    dismissBtn.textContent = t('ui.event.dismiss');
    dismissBtn.addEventListener('click', () => this.hide());

    this.box.append(header, this.titleEl, this.descEl, chooseLabel, this.optionsEl, this.outcomeEl, dismissBtn);
    this.overlay.appendChild(this.box);
    container.appendChild(this.overlay);
  }

  setGameConsole(fn: GameConsoleFn): void { this.gameConsole = fn; }

  show(): void { this.overlay.style.display = ''; }
  hide(): void { this.overlay.style.display = 'none'; }
  get visible(): boolean { return this.overlay.style.display !== 'none'; }

  showOutcome(msg: string): void {
    this.outcomeEl.style.display = '';
    this.outcomeEl.textContent = `${t('ui.event.outcome')} ${msg}`;
  }

  update(state: GameState): void {
    const pending = state.events.pendingEvent;
    if (!pending) {
      this.hide();
      return;
    }

    const def = getEventById(pending.eventId);
    if (!def) {
      this.hide();
      return;
    }

    this.titleEl.textContent = t(def.titleKey);
    this.descEl.textContent = t(def.descKey);
    this.outcomeEl.style.display = 'none';
    this.outcomeEl.textContent = '';

    this.optionsEl.innerHTML = '';
    for (let i = 0; i < def.options.length; i++) {
      const opt = def.options[i]!;
      const btn = document.createElement('button');
      btn.className = 'bs-btn';
      btn.style.cssText = 'text-align:left;padding:4px 8px;font-size:11px';
      btn.textContent = t(opt.labelKey);
      const idx = i;
      btn.addEventListener('click', () => {
        this.gameConsole?.(`event choose option:${idx}`);
        // Disable all buttons after choice
        const btns = this.optionsEl.querySelectorAll('button');
        btns.forEach(b => { (b as HTMLButtonElement).disabled = true; });
      });
      this.optionsEl.appendChild(btn);
    }
  }

  dispose(): void { this.overlay.remove(); }
}
