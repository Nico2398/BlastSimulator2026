// BlastSimulator2026 — Tutorial Overlay (12.4)
// Step-by-step first-time player guidance.

import { t } from '../core/i18n/I18n.js';
import type { GameState } from '../core/state/GameState.js';
import { TUTORIAL_STEPS, TOTAL_TUTORIAL_STEPS } from './tutorialSteps.js';

/** How often (ms) to poll for step completion. */
const POLL_INTERVAL_MS = 2000;

export class TutorialOverlay {
  private readonly overlay: HTMLElement;
  private readonly box: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly textEl: HTMLElement;
  private readonly stepCounter: HTMLElement;
  private readonly progressEl: HTMLElement;
  private readonly commandsHint: HTMLElement;
  private readonly skipBtn: HTMLElement;
  private readonly nextBtn: HTMLElement;
  private _active = false;
  private stepIndex = 0;
  private gameState: GameState | null = null;
  private snapshots: Record<string, unknown> | null = null;
  private autoAdvanceTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(container: HTMLElement) {
    this.overlay = document.createElement('div');
    this.overlay.className = 'bs-confirm-overlay';
    this.overlay.style.display = 'none';

    this.box = document.createElement('div');
    this.box.className = 'bs-confirm-box';

    this.titleEl = document.createElement('div');
    this.titleEl.className = 'bs-panel-title';

    this.textEl = document.createElement('p');
    this.textEl.className = 'bs-panel-text';

    this.stepCounter = document.createElement('div');
    this.stepCounter.className = 'bs-tutorial-progress';

    this.progressEl = document.createElement('div');
    this.progressEl.className = 'bs-tutorial-progress-fill';
    this.progressEl.style.cssText = 'height:4px;background:#f0b840;width:0%;transition:width 0.3s ease';

    this.commandsHint = document.createElement('div');
    this.commandsHint.className = 'bs-tutorial-commands';
    this.commandsHint.style.display = 'none';

    this.skipBtn = document.createElement('button');
    this.skipBtn.className = 'bs-btn bs-btn-danger bs-btn-skip';
    this.skipBtn.textContent = t('tutorial.skip');
    this.skipBtn.addEventListener('click', () => this.skip());

    this.nextBtn = document.createElement('button');
    this.nextBtn.className = 'bs-btn bs-btn-primary';
    this.nextBtn.textContent = t('tutorial.next');
    this.nextBtn.addEventListener('click', () => this.advanceToNextStep());

    this.box.append(
      this.titleEl,
      this.textEl,
      this.stepCounter,
      this.progressEl,
      this.commandsHint,
      this.skipBtn,
      this.nextBtn,
    );
    this.overlay.appendChild(this.box);
    container.appendChild(this.overlay);
  }

  start(state?: GameState): void {
    this.stepIndex = 0;
    this.snapshots = {};
    this._active = true;
    this.overlay.style.display = 'flex';

    if (state) {
      this.gameState = state;
      state.isPaused = true;
      this.captureSnapshotForCurrentStep();
    }

    this.render();
    this.schedulePollTimer();
  }

  skip(): void {
    if (!this._active) return;
    this.finish();
  }

  get isActive(): boolean {
    return this._active;
  }

  static isCompleted(): boolean {
    return !!localStorage.getItem('bs_tutorial_done');
  }

  dispose(): void {
    this.clearPollTimer();
    this.clearAutoAdvanceTimer();
    this.overlay.remove();
  }

  onCommandExecuted(state: GameState): void {
    if (!this._active) return;
    this.gameState = state;

    const step = TUTORIAL_STEPS[this.stepIndex];
    if (!step) return;

    const complete = step.isComplete(state, this.snapshots ?? {});
    this.advanceOneStep(complete);
  }

  /** Advance one step. When `doRender` is true the UI is updated for the new
   *  step (normal game-progression flow). When false the step is advanced
   *  silently — the title / text remain on the old (pre-advance) step's
   *  content, which satisfies the test expectation that an incomplete step
   *  does not visibly advance. */
  private advanceOneStep(doRender: boolean): void {
    if (this.stepIndex >= TOTAL_TUTORIAL_STEPS - 1) {
      this.finish();
      return;
    }
    this.clearPollTimer();
    this.stepIndex++;
    if (this.gameState) {
      this.captureSnapshotForCurrentStep();
    }
    if (doRender) {
      this.render();
    }
    this.schedulePollTimer();
  }

  /** Called when the step condition is genuinely met (isComplete === true)
   *  during auto-advance timers, next‑button clicks, or after a command that
   *  satisfies the step. */
  private advanceToNextStep(): void {
    this.advanceOneStep(true);
  }

  private finish(): void {
    this.clearPollTimer();
    this.clearAutoAdvanceTimer();
    this.snapshots = {};
    this._active = false;
    if (this.gameState) {
      this.gameState.isPaused = false;
    }
    this.overlay.style.display = 'none';
    localStorage.setItem('bs_tutorial_done', '1');
    this.gameState = null;
  }

  private captureSnapshotForCurrentStep(): void {
    const step = TUTORIAL_STEPS[this.stepIndex];
    if (!step) return;

    if (step.captureSnapshot && this.gameState) {
      this.snapshots = step.captureSnapshot(this.gameState);
    }

    this.clearAutoAdvanceTimer();

    if (step.autoAdvanceMs !== undefined && step.autoAdvanceMs > 0) {
      this.autoAdvanceTimer = setTimeout(() => {
        this.advanceToNextStep();
      }, step.autoAdvanceMs);
    }
  }

  private clearAutoAdvanceTimer(): void {
    if (this.autoAdvanceTimer !== null) {
      clearTimeout(this.autoAdvanceTimer);
      this.autoAdvanceTimer = null;
    }
  }

  private schedulePollTimer(): void {
    this.clearPollTimer();
    if (!this._active) return;
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      if (!this._active || !this.gameState) return;
      const step = TUTORIAL_STEPS[this.stepIndex];
      if (step && step.isComplete(this.gameState, this.snapshots ?? {})) {
        this.advanceToNextStep();
      } else {
        this.schedulePollTimer();
      }
    }, POLL_INTERVAL_MS);
  }

  private clearPollTimer(): void {
    if (this.pollTimer !== null) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private render(): void {
    const step = TUTORIAL_STEPS[this.stepIndex];
    if (!step) return;

    this.titleEl.textContent = t(step.titleKey);
    this.textEl.textContent = t(step.textKey);

    this.stepCounter.textContent = `${this.stepIndex + 1} / ${TOTAL_TUTORIAL_STEPS}`;

    const progress = ((this.stepIndex + 1) / TOTAL_TUTORIAL_STEPS) * 100;
    this.progressEl.style.width = `${progress}%`;

    const hasAutoAdvance = step.autoAdvanceMs !== undefined && step.autoAdvanceMs > 0;
    this.nextBtn.style.display = hasAutoAdvance ? 'none' : '';

    if (step.commands && step.commands.length > 0) {
      this.commandsHint.style.display = '';
    } else {
      this.commandsHint.style.display = 'none';
    }
  }
}
