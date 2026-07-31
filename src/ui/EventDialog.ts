// BlastSimulator2026 — Event Dialog (10.7)
// Modal dialog shown when a pending event requires player decision.

import { t } from '../core/i18n/I18n.js';
import type { GameState } from '../core/state/GameState.js';
import { getEventById } from '../core/events/EventPool.js';

import type { CommandResult } from '../console/ConsoleRunner.js';

export type GameConsoleFn = (cmd: string) => CommandResult;

export class EventDialog {
  private readonly overlay: HTMLElement;
  private readonly box: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly descEl: HTMLElement;
  private readonly chooseLabel: HTMLElement;
  private readonly optionsEl: HTMLElement;
  private readonly outcomeHeadlineEl: HTMLElement;
  private readonly outcomeEl: HTMLElement;
  private readonly dismissBtn: HTMLElement;
  private gameConsole?: GameConsoleFn;
  private lastEventId: string | null = null;
  /** True while we're displaying the outcome of a resolved event. */
  private showingOutcome = false;

  constructor(container: HTMLElement) {
    this.overlay = document.createElement('div');
    // The stylesheet has always carried #bs-event-dialog rules; without the id
    // they were dead and the dialog had no stable selector for UI tests.
    this.overlay.id = 'bs-event-dialog';
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

    this.chooseLabel = document.createElement('div');
    this.chooseLabel.style.cssText = 'font-size:10px;color:#857b6b;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px';
    this.chooseLabel.textContent = t('ui.event.choose');

    this.optionsEl = document.createElement('div');
    this.optionsEl.className = 'bs-event-choices';

    this.outcomeHeadlineEl = document.createElement('div');
    this.outcomeHeadlineEl.className = 'bs-event-outcome-headline';
    this.outcomeHeadlineEl.style.display = 'none';

    this.outcomeEl = document.createElement('div');
    this.outcomeEl.className = 'bs-event-outcome';
    this.outcomeEl.style.display = 'none';

    this.dismissBtn = document.createElement('button');
    this.dismissBtn.className = 'bs-btn bs-event-dismiss';
    this.dismissBtn.style.cssText = 'width:100%;margin-top:12px';
    this.dismissBtn.textContent = t('ui.event.dismiss');
    this.dismissBtn.style.display = 'none';
    this.dismissBtn.addEventListener('click', () => this.hide());

    this.box.append(header, this.titleEl, this.descEl, this.chooseLabel, this.optionsEl, this.outcomeHeadlineEl, this.outcomeEl, this.dismissBtn);
    this.overlay.appendChild(this.box);
    container.appendChild(this.overlay);
  }

  setGameConsole(fn: GameConsoleFn): void { this.gameConsole = fn; }

  show(): void { this.overlay.style.display = ''; }
  hide(): void {
    this.overlay.style.display = 'none';
    this.lastEventId = null;
    this.showingOutcome = false;
  }
  get visible(): boolean { return this.overlay.style.display !== 'none'; }
  /** True when the dialog is displaying a resolved event's outcome. */
  get isShowingOutcome(): boolean { return this.showingOutcome; }

  update(state: GameState): void {
    const pending = state.events.pendingEvent;
    if (!pending) {
      // Don't hide while displaying outcome of a just-resolved event
      if (!this.showingOutcome) this.hide();
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
      this.showingOutcome = false;
      this.outcomeHeadlineEl.style.display = 'none';
      this.outcomeHeadlineEl.textContent = '';
      this.outcomeEl.style.display = 'none';
      this.outcomeEl.textContent = '';
      this.chooseLabel.style.display = '';
      this.optionsEl.style.display = '';
      this.dismissBtn.style.display = 'none';

      this.optionsEl.innerHTML = '';
      for (let i = 0; i < def.options.length; i++) {
        const opt = def.options[i]!;
        const btn = document.createElement('button');
        btn.className = 'bs-btn bs-event-choice';
        btn.textContent = t(opt.labelKey);
        const idx = i;
        btn.addEventListener('click', () => {
          // Set flag before calling gameConsole — it triggers uiManager.update()
          // which would hide this dialog since pendingEvent gets cleared.
          this.showingOutcome = true;
          const result = this.gameConsole?.(`event choose ${idx}`);
          this.enterOutcomePhase(result?.output ?? '');
        });
        this.optionsEl.appendChild(btn);
      }
    }
  }

  /** Switch dialog to outcome display after a choice is made. */
  private enterOutcomePhase(consoleOutput: string): void {
    this.showingOutcome = true;
    // Hide choice UI
    this.chooseLabel.style.display = 'none';
    this.optionsEl.style.display = 'none';

    const lines = consoleOutput.split('\n');
    // The resolved-outcome sentence sits between "Event resolved: <id>" and
    // "Consequences:" — everything else is the numeric effect bullets below it.
    const resolvedIdx = lines.findIndex(l => l.startsWith('Event resolved:'));
    const consequencesIdx = lines.findIndex(l => l.startsWith('Consequences:'));
    const headline = resolvedIdx !== -1 && consequencesIdx !== -1 && consequencesIdx > resolvedIdx + 1
      ? lines.slice(resolvedIdx + 1, consequencesIdx).join(' ').trim()
      : '';
    this.outcomeHeadlineEl.textContent = headline;
    this.outcomeHeadlineEl.style.display = headline ? '' : 'none';

    // Parse the numeric effects (lines starting with "  • ") as fine print below it
    const effects = lines
      .filter(l => l.startsWith('  • '))
      .map(l => l.slice(4));
    const outcomeText = effects.length > 0
      ? `${t('ui.event.outcome')} ${effects.join(', ')}`
      : t('ui.event.outcome');
    this.outcomeEl.textContent = outcomeText;
    this.outcomeEl.style.display = '';
    this.dismissBtn.style.display = '';
  }

  dispose(): void { this.overlay.remove(); }
}
