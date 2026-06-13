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
  private _active = false;
  private stepIndex = 0;
  private stepSnapshots: Record<string, unknown>[] = [];
  private autoAdvanceTimer: ReturnType<typeof setTimeout> | null = null;

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
    this.commandsHint.style.cssText = 'display:none;font-size:11px;color:#8a7040;margin-top:8px';

    this.skipBtn = this.createButton('tutorial.skip', 'bs-btn bs-btn-danger', () => this.skip());
    this.nextBtn = this.createButton('tutorial.next', 'bs-btn bs-btn-primary', () => this.advanceToNextStep());

    this.box.append(this.titleEl, this.textEl, this.stepCounter, this.progressEl, this.commandsHint, this.skipBtn, this.nextBtn);
    this.overlay.appendChild(this.box);
    container.appendChild(this.overlay);
  }

  /** Factory to create a button with i18n label, class name, and click handler. */
  private createButton(i18nKey: string, className: string, handler: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = className;
    btn.textContent = t(i18nKey);
    btn.addEventListener('click', handler);
    return btn;
  }

  /** Start tutorial from the beginning. */
  start(state?: GameState): void {
    this.gameState = state ?? null;
    this.stepIndex = 0;
    this.stepSnapshots = [];
    this._active = true;
    this.overlay.style.display = 'flex';
    if (this.gameState) {
      this.gameState.isPaused = true;
    }
    if (this.gameState) {
      this.captureSnapshotForCurrentStep();
    }
    this.render();
  }

  /** Skip the tutorial and persist completion. */
  skip(): void {
    if (!this._active) return;
    this.finish();
  }

  /** Whether the tutorial is currently active. */
  get isActive(): boolean {
    return this._active;
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
    if (!this._active) return;
    this.gameState = state;
    const step = TUTORIAL_STEPS[this.stepIndex];
    const snapshot = this.stepSnapshots[this.stepIndex] ?? {};
    if (step && step.isComplete(state, snapshot)) {
      this.advanceToNextStep();
    }
  }

  /** Advance to the next step or finish the tutorial. */
  private advanceToNextStep(): void {
    if (this.stepIndex >= TOTAL_TUTORIAL_STEPS - 1) {
      this.finish();
    } else {
      this.stepIndex++;
      if (this.gameState) {
        this.captureSnapshotForCurrentStep();
      }
      this.render();
    }
  }

  /** Finish the tutorial: deactivate, hide overlay, unpause game, persist completion. */
  private finish(): void {
    this.clearAutoAdvanceTimer();
    this.stepSnapshots = [];
    this._active = false;
    if (this.gameState) {
      this.gameState.isPaused = false;
    }
    this.overlay.style.display = 'none';
    localStorage.setItem('bs_tutorial_done', '1');
    this.gameState = null;
  }

  /** Capture snapshot for the current step and set up auto-advance if needed. */
  private captureSnapshotForCurrentStep(): void {
    const step = TUTORIAL_STEPS[this.stepIndex];
    if (!step) return;

    const snapshot = step.captureSnapshot?.(this.gameState!) ?? {};
    this.stepSnapshots[this.stepIndex] = snapshot;

    if (step.autoAdvanceMs != null && step.autoAdvanceMs > 0) {
      this.clearAutoAdvanceTimer();
      this.autoAdvanceTimer = setTimeout(() => {
        const currentStep = TUTORIAL_STEPS[this.stepIndex];
        // Only auto-advance if the current step still has autoAdvanceMs (safety check)
        if (currentStep?.autoAdvanceMs != null) {
          this.advanceToNextStep();
        }
      }, step.autoAdvanceMs);
    }
  }

  /** Clear any pending auto-advance timer. */
  private clearAutoAdvanceTimer(): void {
    if (this.autoAdvanceTimer != null) {
      clearTimeout(this.autoAdvanceTimer);
      this.autoAdvanceTimer = null;
    }
  }

  /** Render the current step. */
  private render(): void {
    const step = TUTORIAL_STEPS[this.stepIndex];
    if (!step) return;

    this.titleEl.textContent = t(step.titleKey);
    this.textEl.textContent = t(step.textKey);
    this.stepCounter.textContent = `${this.stepIndex + 1} / ${TOTAL_TUTORIAL_STEPS}`;

    if (step.autoAdvanceMs != null) {
      // Auto-advance steps: hide next button and commands hint
      this.nextBtn.style.display = 'none';
      this.commandsHint.style.display = 'none';
    } else {
      this.nextBtn.style.display = '';
      if (step.commands && step.commands.length > 0) {
        this.commandsHint.style.display = 'block';
        this.commandsHint.textContent = step.commands.join(', ');
      } else {
        this.commandsHint.style.display = 'none';
      }
    }

    this.progressEl.style.width = `${((this.stepIndex + 1) / TOTAL_TUTORIAL_STEPS) * 100}%`;
  }
}
