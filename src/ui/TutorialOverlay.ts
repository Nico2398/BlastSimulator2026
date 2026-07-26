// BlastSimulator2026 — Tutorial Overlay (12.4)
// Step-by-step first-time player guidance.

import { t } from '../core/i18n/I18n.js';
import type { GameState } from '../core/state/GameState.js';
import type { CommandResult } from '../console/ConsoleRunner.js';
import { TUTORIAL_STEPS, TOTAL_TUTORIAL_STEPS } from './tutorialSteps.js';
import { buildTutorialCard } from './tutorialOverlayDom.js';

/** How often (ms) to poll for step completion. */
const POLL_INTERVAL_MS = 2000;

/** How long (ms) to show the congratulations step before auto-dismiss. */
const CONGRATULATIONS_DISPLAY_MS = 4000;

/** Index of the final (congratulations) step. */
const LAST_STEP_INDEX = TOTAL_TUTORIAL_STEPS - 1;

/**
 * Coach-mark tutorial overlay that guides new players through the first
 * campaign level step by step.
 *
 * The card is deliberately NOT a modal: it docks at the bottom of the screen,
 * lets pointer events through everywhere except on the card itself, and sits
 * below the event dialog in the stacking order. A tutorial that tells the
 * player to click the Crew button has to leave that button visible and
 * clickable.
 */
export class TutorialOverlay {
  private readonly overlay: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly textEl: HTMLElement;
  private readonly stepCounter: HTMLElement;
  private readonly progressEl: HTMLElement;
  private readonly commandsLabel: HTMLElement;
  private readonly commandsHint: HTMLElement;
  private readonly skipBtn: HTMLButtonElement;
  private highlightedEl: HTMLElement | null = null;
  private _active = false;
  private _executingCommands = false;
  private stepIndex = 0;
  private gameState: GameState | null = null;
  private snapshots: Record<string, unknown> | null = null;
  private autoAdvanceTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private gameConsole: ((cmd: string) => CommandResult) | null = null;

  constructor(container: HTMLElement) {
    const els = buildTutorialCard(container);
    this.overlay = els.overlay;
    this.titleEl = els.titleEl;
    this.textEl = els.textEl;
    this.stepCounter = els.stepCounter;
    this.progressEl = els.progressEl;
    this.commandsLabel = els.commandsLabel;
    this.commandsHint = els.commandsHint;
    this.skipBtn = els.skipBtn;

    this.skipBtn.addEventListener('click', () => this.skip());
  }

  start(state?: GameState): void {
    this.clearTimer('pollTimer');
    this.clearTimer('autoAdvanceTimer');
    this.stepIndex = 0;
    this.snapshots = {};
    this._active = true;
    this.overlay.style.display = '';

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

  setGameConsole(fn: (cmd: string) => CommandResult): void {
    this.gameConsole = fn;
  }

  dispose(): void {
    this.clearHighlight();
    this.clearTimer('pollTimer');
    this.clearTimer('autoAdvanceTimer');
    this.overlay.remove();
  }

  /**
   * Re-evaluate the current step after a console command.
   *
   * The step index only moves when the step's own completion condition is
   * satisfied. Advancing on every command would race the tutorial through all
   * 23 steps — running their commands along the way — while the card kept
   * displaying a step the player had not finished.
   */
  onCommandExecuted(state: GameState): void {
    if (!this._active) return;
    // Guard against re-entrancy: command execution inside advanceToNextStep
    // ultimately calls back into onCommandExecuted via the console bridge.
    if (this._executingCommands) return;
    this.gameState = state;

    const step = TUTORIAL_STEPS[this.stepIndex];
    if (!step) return;

    if (step.isComplete(state, this.snapshots ?? {})) {
      this.advanceToNextStep();
    }
  }

  /** Move to the next step, or finish when the last one is already showing. */
  private advanceToNextStep(): void {
    if (!this._active) return;
    this.clearTimer('pollTimer');

    if (this.stepIndex >= LAST_STEP_INDEX) {
      this.finish();
      return;
    }

    // The opening card pauses so the player can read it. From the first
    // advance on, the simulation has to run: survey, drilling, hauling and
    // contract delivery are all queued work that only resolves on a tick, so a
    // tutorial that stayed paused could never get past "Survey Terrain".
    if (this.gameState) {
      this.gameState.isPaused = false;
    }

    this.stepIndex++;
    this.runAutoCommands();

    if (this.gameState) {
      this.captureSnapshotForCurrentStep();
    }
    this.render();

    if (this.stepIndex === LAST_STEP_INDEX) {
      // Congratulations: show for a fixed beat, then dismiss. No polling —
      // otherwise a later command would keep re-arming the timer.
      this.clearTimer('autoAdvanceTimer');
      this.autoAdvanceTimer = setTimeout(() => this.finish(), CONGRATULATIONS_DISPLAY_MS);
      return;
    }

    this.schedulePollTimer();
  }

  /**
   * Run the commands the tutorial itself is responsible for (currently only
   * the scripted event demo). A step's `commands` array is a hint shown to the
   * player and is never executed on their behalf.
   */
  private runAutoCommands(): void {
    const step = TUTORIAL_STEPS[this.stepIndex];
    if (!step || !this.gameConsole) return;
    const auto = step.autoCommands;
    if (!auto || auto.length === 0) return;

    this._executingCommands = true;
    try {
      for (const cmd of auto) {
        this.gameConsole(cmd);
      }
    } finally {
      this._executingCommands = false;
    }
  }

  private finish(): void {
    this.clearHighlight();
    this.clearTimer('pollTimer');
    this.clearTimer('autoAdvanceTimer');
    this.snapshots = {};
    this._active = false;
    if (this.gameState) {
      this.gameState.isPaused = false;
    }
    this.overlay.style.display = 'none';
    try {
      localStorage.setItem('bs_tutorial_done', '1');
    } catch {
      // Silently ignore — localStorage may be unavailable in restricted browsing environments
    }
    this.gameState = null;
  }

  private captureSnapshotForCurrentStep(): void {
    const step = TUTORIAL_STEPS[this.stepIndex];
    if (!step) return;

    if (step.captureSnapshot && this.gameState) {
      this.snapshots = step.captureSnapshot(this.gameState);
    }

    this.clearTimer('autoAdvanceTimer');

    if (step.autoAdvanceMs !== undefined && step.autoAdvanceMs > 0) {
      this.autoAdvanceTimer = setTimeout(() => {
        this.advanceToNextStep();
      }, step.autoAdvanceMs);
    }
  }

  private schedulePollTimer(): void {
    this.clearTimer('pollTimer');
    if (!this._active) return;
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      if (!this._active || !this.gameState) return;
      const step = TUTORIAL_STEPS[this.stepIndex];
      if (step && step.isComplete(this.gameState, this.snapshots ?? {})) {
        this.advanceToNextStep();
      } else {
        // Panels are rebuilt as the player interacts; re-attach the glow so the
        // step's target keeps pulsing for as long as the step is active.
        this.applyHighlight();
        this.schedulePollTimer();
      }
    }, POLL_INTERVAL_MS);
  }

  private clearHighlight(): void {
    if (this.highlightedEl) {
      this.highlightedEl.classList.remove('bs-tutorial-highlight');
      this.highlightedEl = null;
    }
  }

  /** Re-attach the pulsing glow to the current step's highlight target. */
  private applyHighlight(): void {
    const step = TUTORIAL_STEPS[this.stepIndex];
    this.clearHighlight();
    if (!step?.highlightTarget) return;

    const target = document.querySelector(step.highlightTarget) as HTMLElement | null;
    if (target) {
      target.classList.add('bs-tutorial-highlight');
      this.highlightedEl = target;
    }
  }

  /** Unified helper — clears the referenced timeout and resets it to null. */
  private clearTimer(timerName: 'autoAdvanceTimer' | 'pollTimer'): void {
    const timer = timerName === 'autoAdvanceTimer' ? this.autoAdvanceTimer : this.pollTimer;
    if (timer !== null) {
      clearTimeout(timer);
      if (timerName === 'autoAdvanceTimer') {
        this.autoAdvanceTimer = null;
      } else {
        this.pollTimer = null;
      }
    }
  }

  private render(): void {
    const step = TUTORIAL_STEPS[this.stepIndex];
    if (!step) return;

    this.titleEl.textContent = t(step.titleKey);
    this.textEl.textContent = t(step.textKey);

    // TODO: use i18n t('tutorial.progress', { current, total }) once locale values have {current}/{total} placeholders
    this.stepCounter.textContent = `${this.stepIndex + 1} / ${TOTAL_TUTORIAL_STEPS}`;

    const progress = ((this.stepIndex + 1) / TOTAL_TUTORIAL_STEPS) * 100;
    this.progressEl.style.width = `${progress}%`;

    this.applyHighlight();

    if (step.commands && step.commands.length > 0) {
      this.commandsLabel.style.display = '';
      this.commandsHint.style.display = '';
      this.commandsHint.textContent = step.commands.join(', ');
    } else {
      this.commandsLabel.style.display = 'none';
      this.commandsHint.style.display = 'none';
    }

    // On the final card the escape hatch becomes a plain dismissal.
    const isLast = this.stepIndex >= LAST_STEP_INDEX;
    this.skipBtn.textContent = isLast ? t('tutorial.finish') : t('tutorial.skip');
  }
}
