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
  private lastEventId: string | null = null;

  constructor(container: HTMLElement) {
    this.overlay = document.createElement('div');
    this.overlay.className = 'bs-confirm-overlay';
    this.overlay.style.display = 'none';

    this.box = document.createElement('div');
    this.box.className = 'bs-confirm-box';
    this.box.style.cssText = 'max-width:480px;width:92%;text-align:left';

    const header = document.createElement('div');
    header.className = 'bs-panel-title';
    header.textContent = t('ui.event.title');

    this.titleEl = document.createElement('div');
    this.titleEl.className = 'bs-event-title';

    this.descEl = document.createElement('p');
    this.descEl.className = 'bs-event-text';
    this.descEl.style.cssText = 'margin:0 0 14px';

    const chooseLabel = document.createElement('div');
    chooseLabel.style.cssText = 'font-size:10px;color:#7a7060;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px';
    chooseLabel.textContent = t('ui.event.choose');

    this.optionsEl = document.createElement('div');
    this.optionsEl.className = 'bs-event-choices';

    this.outcomeEl = document.createElement('div');
    this.outcomeEl.className = 'bs-event-outcome';
    this.outcomeEl.style.display = 'none';

    const dismissBtn = document.createElement('button');
    dismissBtn.className = 'bs-btn';
    dismissBtn.style.cssText = 'width:100%;margin-top:12px';
    dismissBtn.textContent = t('ui.event.dismiss');
    dismissBtn.addEventListener('click', () => this.hide());

    this.box.append(header, this.titleEl, this.descEl, chooseLabel, this.optionsEl, this.outcomeEl, dismissBtn);
    this.overlay.appendChild(this.box);
    container.appendChild(this.overlay);
  }

  setGameConsole(fn: GameConsoleFn): void { this.gameConsole = fn; }

  show(): void { this.overlay.style.display = ''; }
  hide(): void { this.overlay.style.display = 'none'; this.lastEventId = null; }
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

    // Only rebuild buttons when the event changes — prevents destroying buttons mid-click at 60fps
    if (pending.eventId !== this.lastEventId) {
      this.lastEventId = pending.eventId;
      this.outcomeEl.style.display = 'none';
      this.outcomeEl.textContent = '';

      this.optionsEl.innerHTML = '';
      for (let i = 0; i < def.options.length; i++) {
        const opt = def.options[i]!;
        const btn = document.createElement('button');
        btn.className = 'bs-btn bs-event-choice';
        btn.textContent = t(opt.labelKey);
        const idx = i;
        btn.addEventListener('click', () => {
          this.gameConsole?.(`event choose ${idx}`);
          // Disable buttons immediately so user can't double-click
          this.optionsEl.querySelectorAll<HTMLButtonElement>('button')
            .forEach(b => { b.disabled = true; });
        });
        this.optionsEl.appendChild(btn);
      }
    }
  }

  dispose(): void { this.overlay.remove(); }
}
