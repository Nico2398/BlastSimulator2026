// BlastSimulator2026 — Tutorial Overlay (12.4)
// Step-by-step first-time player guidance.

import { t } from '../core/i18n/I18n.js';
import type { GameState } from '../core/state/GameState.js';
import { TUTORIAL_STEPS, TOTAL_TUTORIAL_STEPS } from './tutorialSteps.js';

export class TutorialOverlay {
  private readonly overlay: HTMLElement;
  private readonly box: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly textEl: HTMLElement;
  private readonly stepCounter: HTMLElement;
  private readonly progressEl: HTMLElement;
  private readonly skipBtn: HTMLElement;
  private readonly nextBtn: HTMLElement;
  private readonly commandsHint: HTMLElement;
  private gameState: GameState | null = null;
  private active = false;
  private stepIndex = 0;

  constructor(container: HTMLElement) {
    this.overlay = document.createElement('div');
    this.overlay.className = 'bs-confirm-overlay';
    this.overlay.style.display = 'none';
    this.overlay.style.position = 'fixed';
    this.overlay.style.inset = '0';
    this.overlay.style.zIndex = '600';

    this.box = document.createElement('div');
    this.box.className = 'bs-confirm-box';
    this.box.style.pointerEvents = 'all';

    this.titleEl = document.createElement('div');
    this.titleEl.className = 'bs-panel-title';

    this.textEl = document.createElement('p');

    this.stepCounter = document.createElement('div');

    this.progressEl = document.createElement('div');
    this.progressEl.style.cssText = 'height:4px;background:#f0b840;width:0%;transition:width 0.3s ease';

    this.commandsHint = document.createElement('div');
    this.commandsHint.style.display = 'none';
    this.commandsHint.style.cssText = 'font-size:11px;color:#8a7040;margin-top:8px';

    this.skipBtn = document.createElement('button');
    this.skipBtn.className = 'bs-btn bs-btn-danger';
    this.skipBtn.textContent = t('tutorial.skip');
    this.skipBtn.addEventListener('click', () => this.skip());

    this.nextBtn = document.createElement('button');
    this.nextBtn.className = 'bs-btn bs-btn-primary';
    this.nextBtn.textContent = t('tutorial.next');
    this.nextBtn.addEventListener('click', () => this.advance());

    this.box.append(this.titleEl, this.textEl, this.stepCounter, this.progressEl, this.commandsHint, this.skipBtn, this.nextBtn);
    this.overlay.appendChild(this.box);
    container.appendChild(this.overlay);
  }

  /** Start tutorial from the beginning. */
  start(state?: GameState): void {
    this.gameState = state ?? null;
    this.stepIndex = 0;
    this.active = true;
    this.overlay.style.display = 'flex';
    if (this.gameState) {
      this.gameState.isPaused = true;
    }
    this.render();
  }

  /** Skip the tutorial and persist completion. */
  skip(): void {
    if (!this.active) return;
    this.active = false;
    this.overlay.style.display = 'none';
    if (this.gameState) {
      this.gameState.isPaused = false;
    }
    localStorage.setItem('bs_tutorial_done', '1');
    this.gameState = null;
  }

  /** Whether the tutorial is currently active. */
  get isActive(): boolean {
    return this.active;
  }

  /** Returns true if tutorial was already completed (persisted in localStorage). */
  static isCompleted(): boolean {
    try {
      return !!localStorage.getItem('bs_tutorial_done');
    } catch {
      return false;
    }
  }

  /** Remove the overlay from the DOM. */
  dispose(): void {
    this.overlay.remove();
  }

  /** React to a command being executed — may advance tutorial steps. */
  onCommandExecuted(state: GameState): void {
    if (!this.active) return;
    this.gameState = state;
    const step = TUTORIAL_STEPS[this.stepIndex];
    if (step && step.isComplete(state)) {
      this.advance();
    }
  }

  /** Advance to the next step or complete the tutorial. */
  private advance(): void {
    if (this.stepIndex >= TOTAL_TUTORIAL_STEPS - 1) {
      this.complete();
    } else {
      this.stepIndex++;
      this.render();
    }
  }

  /** Mark the tutorial as complete. */
  private complete(): void {
    this.active = false;
    if (this.gameState) {
      this.gameState.isPaused = false;
    }
    this.overlay.style.display = 'none';
    localStorage.setItem('bs_tutorial_done', '1');
    this.gameState = null;
  }

  /** Render the current step. */
  private render(): void {
    const step = TUTORIAL_STEPS[this.stepIndex];
    if (!step) return;

    this.titleEl.textContent = t(step.titleKey);
    this.textEl.textContent = t(step.textKey);
    this.stepCounter.textContent = `${this.stepIndex + 1} / ${TOTAL_TUTORIAL_STEPS}`;

    if (step.commands && step.commands.length > 0) {
      this.commandsHint.style.display = 'block';
      this.commandsHint.textContent = step.commands.join(', ');
    } else {
      this.commandsHint.style.display = 'none';
    }

    this.progressEl.style.width = `${((this.stepIndex + 1) / TOTAL_TUTORIAL_STEPS) * 100}%`;
  }
}
