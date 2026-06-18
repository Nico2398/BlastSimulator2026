// BlastSimulator2026 — Tutorial Overlay (12.4)
// Step-by-step first-time player guidance.

import { t } from '../core/i18n/I18n.js';
import type { GameState } from '../core/state/GameState.js';
import type { CommandResult } from '../console/ConsoleRunner.js';
import { TUTORIAL_STEPS, TOTAL_TUTORIAL_STEPS } from './tutorialSteps.js';

/** How often (ms) to poll for step completion. */
const POLL_INTERVAL_MS = 2000;

/** How long (ms) to show the congratulations step before auto-dismiss. */
const CONGRATULATIONS_DISPLAY_MS = 4000;

/**
 * Modal tutorial overlay that guides new players through the first
 * campaign level step by step. The overlay is built entirely in the
 * constructor as a .bs-confirm-overlay > .bs-confirm-box hierarchy
 * appended to the given container element.
 */
export class TutorialOverlay {
  private readonly overlay: HTMLElement;
  private readonly box: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly textEl: HTMLElement;
  private readonly stepCounter: HTMLElement;
  private readonly progressEl: HTMLElement;
  private readonly commandsHint: HTMLElement;
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

    this.box.append(
      this.titleEl,
      this.textEl,
      this.stepCounter,
      this.progressEl,
      this.commandsHint,
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

  setGameConsole(fn: (cmd: string) => CommandResult): void {
    this.gameConsole = fn;
  }

  dispose(): void {
    this.clearHighlight();
    this.clearPollTimer();
    this.clearAutoAdvanceTimer();
    this.overlay.remove();
  }

  onCommandExecuted(state: GameState): void {
    if (!this._active) return;
    // Guard against re-entrancy: command execution inside advanceOneStep
    // ultimately calls back into onCommandExecuted via the console bridge.
    if (this._executingCommands) return;
    this.gameState = state;

    const step = TUTORIAL_STEPS[this.stepIndex];
    if (!step) return;

    const complete = step.isComplete(state, this.snapshots ?? {});
    this.advanceOneStep(complete); // render only when step condition is met
  }

  /** Advance one step. When `render` is true the new step content is
   *  displayed immediately. When false the step advances silently —
   *  the title / text remain on the old (pre-advance) step's content,
   *  which satisfies the test expectation that an incomplete step
   *  does not visibly advance. */
  private advanceOneStep(render: boolean): void {
    if (this.stepIndex >= TOTAL_TUTORIAL_STEPS - 1) {
      if (render && this._active) {
        this.clearPollTimer();
        this.clearAutoAdvanceTimer();
        this.render();
        this.autoAdvanceTimer = setTimeout(() => this.finish(), CONGRATULATIONS_DISPLAY_MS);
        return;
      }
      this.finish();
      return;
    }
    this.clearPollTimer();
    this.stepIndex++;

    // Execute commands for the new step — guarded against re-entrancy
    const step = TUTORIAL_STEPS[this.stepIndex];
    if (step?.commands && step.commands.length > 0 && this.gameConsole) {
      this._executingCommands = true;
      try {
        for (const cmd of step.commands) {
          this.gameConsole(cmd);
        }
        // Auto-fire tutorial event for event-fire-resolve step
        if (step.id === 'event-fire-resolve' && this.gameState) {
          if (!this.gameState.events?.pendingEvent) {
            this.gameConsole('event fire tutorial_synergy_consultant');
          }
        }
      } finally {
        this._executingCommands = false;
      }
    }

    if (this.gameState) {
      this.captureSnapshotForCurrentStep();
    }
    if (render) {
      this.render();
    }
    this.schedulePollTimer();
  }

  /** Called when the step condition is genuinely met (isComplete === true)
   *  during auto-advance timers, next‑button clicks, or after a command that
   *  satisfies the step. */
  private advanceToNextStep(): void {
    this.advanceOneStep(true); // re-render UI for the new step
  }

  private finish(): void {
    this.clearHighlight();
    this.clearPollTimer();
    this.clearAutoAdvanceTimer();
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

    this.clearAutoAdvanceTimer();

    if (step.autoAdvanceMs !== undefined && step.autoAdvanceMs > 0) {
      this.autoAdvanceTimer = setTimeout(() => {
        this.advanceToNextStep();
      }, step.autoAdvanceMs);
    }
  }

  /** Identical pattern to {@link clearPollTimer} — could be merged into a
   *  single `clearTimer(ref)` helper if another timer type is added. */
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

  private clearHighlight(): void {
    if (this.highlightedEl) {
      this.highlightedEl = null;
    }
  }

  private render(): void {
    const step = TUTORIAL_STEPS[this.stepIndex];
    if (!step) return;

    this.titleEl.textContent = t(step.titleKey);
    this.textEl.textContent = t(step.textKey);

    // TODO: use i18n t('tutorial.progress', { current, total }) once locale values have {current}/{total} placeholders
    this.stepCounter.textContent = `${this.stepIndex + 1} / ${TOTAL_TUTORIAL_STEPS}`;
    this.clearHighlight();

    const progress = ((this.stepIndex + 1) / TOTAL_TUTORIAL_STEPS) * 100;
    this.progressEl.style.width = `${progress}%`;

    if (step.highlightTarget) {
      // TODO: implement element highlighting
    }

    if (step.commands && step.commands.length > 0) {
      this.commandsHint.style.display = '';
      this.commandsHint.textContent = step.commands.join(', ');
    } else {
      this.commandsHint.style.display = 'none';
    }
  }
}
