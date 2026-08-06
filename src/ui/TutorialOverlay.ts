// BlastSimulator2026 — Tutorial Overlay (12.4)
// Step-by-step first-time player guidance, on rails.

import { t } from '../core/i18n/I18n.js';
import type { GameState } from '../core/state/GameState.js';
import type { CommandResult } from '../console/ConsoleRunner.js';
import { TUTORIAL_STEPS, TOTAL_TUTORIAL_STEPS } from './tutorialSteps.js';
import { buildTutorialCard } from './tutorialOverlayDom.js';
import { GUIDED_CLASS } from './tutorialGuide.js';
import { TutorialRails } from './tutorialRails.js';

/**
 * How often (ms) the guide re-reads the DOM.
 *
 * Fast, because it drives which control is live: a panel the player just opened
 * has to become usable now, not in two seconds. Everything it does is a handful
 * of selector lookups.
 */
const GUIDE_INTERVAL_MS = 250;

/** How long (ms) to show the congratulations step before auto-dismiss. */
const CONGRATULATIONS_DISPLAY_MS = 4000;

/** Index of the final (congratulations) step. */
const LAST_STEP_INDEX = TOTAL_TUTORIAL_STEPS - 1;

/**
 * Coach-mark tutorial that guides new players through the first campaign level.
 *
 * The card docks at the bottom and never covers the control it is pointing at.
 * While it is up the game is on rails: one control is live at a time, every
 * other control is inert, and the clock is held once a step has spent its tick
 * allowance — so the world cannot move on while the player is still reading.
 */
export class TutorialOverlay {
  private readonly overlay: HTMLElement;
  private readonly box: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly textEl: HTMLElement;
  private readonly stageEl: HTMLElement;
  private readonly pausedEl: HTMLElement;
  private readonly pausedChipEl: HTMLElement;
  private readonly stepCounter: HTMLElement;
  private readonly progressEl: HTMLElement;
  private readonly commandsLabel: HTMLElement;
  private readonly commandsHint: HTMLElement;
  private _active = false;
  private _executingCommands = false;
  private stepIndex = 0;
  private readonly rails = new TutorialRails();
  private gameState: GameState | null = null;
  private snapshots: Record<string, unknown> | null = null;
  private autoAdvanceTimer: ReturnType<typeof setTimeout> | null = null;
  private guideTimer: ReturnType<typeof setInterval> | null = null;
  private gameConsole: ((cmd: string) => CommandResult) | null = null;

  constructor(container: HTMLElement) {
    const els = buildTutorialCard(container);
    this.overlay = els.overlay;
    this.box = els.box;
    this.titleEl = els.titleEl;
    this.textEl = els.textEl;
    this.stageEl = els.stageEl;
    this.pausedEl = els.pausedEl;
    this.pausedChipEl = els.pausedChipEl;
    this.stepCounter = els.stepCounter;
    this.progressEl = els.progressEl;
    this.commandsLabel = els.commandsLabel;
    this.commandsHint = els.commandsHint;
  }

  start(state?: GameState): void {
    this.clearAutoAdvance();
    this.stopGuide();
    this.stepIndex = 0;
    this.snapshots = {};
    this._active = true;
    this.overlay.style.display = '';
    document.body.classList.add(GUIDED_CLASS);

    if (state) {
      this.gameState = state;
      this.rails.beginStep(this.step(), state);
      // The opening card pauses so the player can read it before anything moves.
      state.isPaused = true;
      this.captureSnapshotForCurrentStep();
    }

    this.render();
    this.startGuide();
  }

  get isActive(): boolean {
    return this._active;
  }

  /** Which click of the current step the player is on, and how many there are. */
  get stageProgress(): { index: number; total: number; target: string | null } {
    return this.rails.progress;
  }

  static isCompleted(): boolean {
    return !!localStorage.getItem('bs_tutorial_done');
  }

  setGameConsole(fn: (cmd: string) => CommandResult): void {
    this.gameConsole = fn;
  }

  /**
   * Re-apply every piece of card text — step title/body, the "CLOCK HELD"
   * chip and its tooltip, the console-hint label, and the current stage
   * line — against whichever locale is active right now.
   *
   * Every other panel that owns construction-time text exposes this same
   * method and gets it called from a language-change handler (see
   * `LocaleTextRegistry` in `localeText.ts` and `UIManager.refreshLocale()`
   * for the established pattern). TutorialOverlay currently has none of
   * that wiring: this stub is the missing piece of contract, and its call
   * site still needs to be added wherever the app's language-change
   * handlers live (see `main.ts`).
   */
  refreshLocale(): void {
    this.pausedEl.title = t('tutorial.clock_held');
    this.pausedChipEl.textContent = t('tutorial.clock_held_chip');
    this.commandsLabel.textContent = t('tutorial.console_hint');
    // Re-derives title/body/step-counter/commands-hint for the currently
    // displayed step and re-runs the guide's stage-line lookup — the same
    // translation lookups render() already performs on every step change.
    this.render();
  }

  dispose(): void {
    this.stopGuide();
    this.clearAutoAdvance();
    this.rails.clear();
    document.body.classList.remove(GUIDED_CLASS);
    this.overlay.remove();
  }

  /**
   * Re-evaluate the current step after a console command.
   *
   * The step index only moves when the step's own completion condition is
   * satisfied. Advancing on every command would race the tutorial through all
   * 23 steps while the card kept displaying a step the player had not finished.
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
    } else {
      this.refreshGuide();
    }
  }

  private step(): { id: string; highlightTarget?: string; tickBudget?: number } {
    return TUTORIAL_STEPS[this.stepIndex] ?? { id: '' };
  }

  /** Move to the next step, or finish when the last one is already showing. */
  private advanceToNextStep(): void {
    if (!this._active) return;

    if (this.stepIndex >= LAST_STEP_INDEX) {
      this.finish();
      return;
    }

    // From the first advance on, the simulation has to run: survey, drilling,
    // hauling and contract delivery are queued work that only resolves on a tick.
    this.rails.releaseClock(this.gameState);
    this.pausedEl.style.display = 'none';

    this.stepIndex++;
    this.runAutoCommands();

    this.rails.beginStep(this.step(), this.gameState);
    if (this.gameState) {
      this.captureSnapshotForCurrentStep();
    }
    this.render();

    if (this.stepIndex === LAST_STEP_INDEX) {
      // Congratulations: show for a fixed beat, then dismiss.
      this.stopGuide();
      this.clearAutoAdvance();
      this.autoAdvanceTimer = setTimeout(() => this.finish(), CONGRATULATIONS_DISPLAY_MS);
    }
  }

  /**
   * Run the commands the tutorial itself is responsible for (currently only the
   * scripted event demo). A step's `commands` array is a hint shown to the
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
    this.stopGuide();
    this.clearAutoAdvance();
    this.rails.clear();
    document.body.classList.remove(GUIDED_CLASS);
    this.snapshots = {};
    this._active = false;
    if (this.gameState) {
      this.gameState.isPaused = false;
    }
    this.pausedEl.style.display = 'none';
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

    this.clearAutoAdvance();

    if (step.autoAdvanceMs !== undefined && step.autoAdvanceMs > 0) {
      this.autoAdvanceTimer = setTimeout(() => {
        this.advanceToNextStep();
      }, step.autoAdvanceMs);
    }
  }

  // ── Guide loop ──

  private startGuide(): void {
    this.stopGuide();
    if (!this._active) return;
    this.refreshGuide();
    this.guideTimer = setInterval(() => this.tickGuide(), GUIDE_INTERVAL_MS);
  }

  private stopGuide(): void {
    if (this.guideTimer !== null) {
      clearInterval(this.guideTimer);
      this.guideTimer = null;
    }
  }

  /** One pass: check completion, move the rails, hold or release the clock. */
  private tickGuide(): void {
    if (!this._active || !this.gameState) return;

    const step = TUTORIAL_STEPS[this.stepIndex];
    if (step && step.isComplete(this.gameState, this.snapshots ?? {})) {
      this.advanceToNextStep();
      return;
    }

    this.refreshGuide();
    const held = this.rails.updateClock(this.gameState);
    this.pausedEl.style.display = held ? '' : 'none';
  }

  /** Move the rails onto whichever control the player should be using now. */
  private refreshGuide(): void {
    if (!this._active) return;
    this.stageEl.textContent = this.rails.refresh().hint;
  }

  private clearAutoAdvance(): void {
    if (this.autoAdvanceTimer !== null) {
      clearTimeout(this.autoAdvanceTimer);
      this.autoAdvanceTimer = null;
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

    this.updateParamStripClearance();
    this.refreshGuide();

    if (step.commands && step.commands.length > 0) {
      this.commandsLabel.style.display = '';
      this.commandsHint.style.display = '';
      this.commandsHint.textContent = step.commands.join(', ');
    } else {
      this.commandsLabel.style.display = 'none';
      this.commandsHint.style.display = 'none';
    }
  }

  /**
   * The placement param strip has to dock above the coach card, but the
   * card's height varies with each step's own body text — a fixed offset
   * undershoots for a long step and the strip's CONFIRM button ends up
   * rendered underneath the card instead of above it (found via the
   * box-cut step's four-line body, #482). Measured fresh on every render
   * so any step's text — however long — gets real clearance, not a value
   * tuned for whichever step happened to be longest at the time.
   */
  private updateParamStripClearance(): void {
    const clearance = this.box.offsetHeight + 30;
    document.documentElement.style.setProperty('--bsx-tutorial-card-clearance', `${clearance}px`);
  }
}
