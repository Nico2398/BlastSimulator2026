// BlastSimulator2026 — Tutorial Overlay (12.4)
// Step-by-step first-time player guidance, on rails.

import { t } from '../core/i18n/I18n.js';
import type { GameState } from '../core/state/GameState.js';
import { clearTutorialProgress, readTutorialProgress, recordTutorialProgress } from '../core/state/TutorialProgress.js';
import type { CommandResult } from '../console/ConsoleRunner.js';
import { TUTORIAL_STEPS, TOTAL_TUTORIAL_STEPS } from './tutorialSteps.js';
import { buildTutorialCard } from './tutorialOverlayDom.js';
import { goalChipParams } from './tutorialStepsClosing.js';
import { TUTORIAL_LEVEL_ID, isDefeatReason } from './tutorialTrigger.js';
import { CARD_CLASS, GUIDED_CLASS } from './tutorialGuide.js';
import { TutorialRails, type RailsStep } from './tutorialRails.js';
import type { LocaleTextRegistry } from './localeText.js';
import type { ConfirmModalConfig } from './panels/ConfirmModal.js';

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

/** CSS var the placement param strip docks against; equals card height plus the gap below. */
const CLEARANCE_VAR = '--bsx-tutorial-card-clearance';

/** Gap (px) between the coach card's top edge and the param strip above it. */
const PARAM_STRIP_CARD_GAP_PX = 30;

/** Index of the final (congratulations) step. */
const LAST_STEP_INDEX = TOTAL_TUTORIAL_STEPS - 1;

interface TutorialOverlayOptions {
  /** true (default): the 250 ms guide pass advances steps and may hold/release the clock. false (scenario mode): the timer only refreshes presentation; clock writes and step transitions happen solely at command boundaries (onCommandExecuted), so scripted `tick N` runs in full and step ticks are deterministic (#1550, #1580). */
  clockFollowsTimer?: boolean;
}

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
  private readonly stageLine: HTMLElement;
  private readonly pausedEl: HTMLElement;
  private readonly pausedChipEl: HTMLElement;
  private readonly waitingChipEl: HTMLElement;
  private readonly goalChipEl: HTMLElement;
  private readonly goalParams: Record<string, string | number>;
  private readonly stepCounter: HTMLElement;
  private readonly progressEl: HTMLElement;
  private readonly commandsLabel: HTMLElement;
  private readonly commandsHint: HTMLElement;
  private readonly locale: LocaleTextRegistry;
  private _active = false;
  private _executingCommands = false;
  private stepIndex = 0;
  private clearanceObserver: ResizeObserver | null = null;
  private lastClearancePx = -1;
  private readonly rails = new TutorialRails();
  private gameState: GameState | null = null;
  private snapshots: Record<string, unknown> | null = null;
  private congratulationsTimer: ReturnType<typeof setTimeout> | null = null;
  private guideTimer: ReturnType<typeof setInterval> | null = null;
  private gameConsole: ((cmd: string) => CommandResult) | null = null;
  private confirmHandler: ((config: ConfirmModalConfig) => void) | null = null;

  /** Whether the real-time guide pass may hold/release the clock. */
  private clockFollowsTimer: boolean;

  constructor(container: HTMLElement, options: TutorialOverlayOptions = {}) {
    this.clockFollowsTimer = options.clockFollowsTimer ?? true;
    const els = buildTutorialCard(container);
    this.overlay = els.overlay;
    this.box = els.box;
    this.titleEl = els.titleEl;
    this.textEl = els.textEl;
    this.stageEl = els.stageEl;
    this.stageLine = els.stageLine;
    this.pausedEl = els.pausedEl;
    this.pausedChipEl = els.pausedChipEl;
    this.waitingChipEl = els.waitingChipEl;
    // Its text is owned by `this.locale` now (bound in buildTutorialCard()); kept as
    // a field only so direct DOM introspection (tests, debugging) can still reach it.
    void this.pausedChipEl;
    this.goalChipEl = els.goalChipEl;
    this.goalParams = els.goalChipParams;
    this.stepCounter = els.stepCounter;
    this.progressEl = els.progressEl;
    this.commandsLabel = els.commandsLabel;
    this.commandsHint = els.commandsHint;
    this.locale = els.locale;
    els.exitBtn.addEventListener('click', () => this.requestExit());
  }

  start(state?: GameState): void {
    this.activate(0, {});
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

  /** Shared setup head of start() and resume(): reset timers, show the card on `index`. */
  private activate(index: number, snapshots: Record<string, unknown>): void {
    this.clearCongratulationsTimer();
    this.stopGuide();
    this.stepIndex = index;
    this.snapshots = snapshots;
    this._active = true;
    this.overlay.style.display = '';
    document.body.classList.add(CARD_CLASS);
    this.applyGuidedClass();
    this.observeCardResize();
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
   * for the established pattern). TutorialOverlay follows the same pattern:
   * `this.locale` holds the bindings for its construction-time text, and
   * `main.ts` calls `tutorial.refreshLocale()` from both of its
   * language-change fan-out sites.
   */
  refreshLocale(): void {
    this.locale.refresh();
    // Re-derives title/body/step-counter/commands-hint for the currently
    // displayed step and re-runs the guide's stage-line lookup — the same
    // translation lookups render() already performs on every step change.
    this.render();
  }

  dispose(): void {
    this.stopGuide();
    this.clearCongratulationsTimer();
    this.rails.clear();
    this.hideGuidedChrome();
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

    if (this.shortCircuitOnDefeat()) return;

    const step = TUTORIAL_STEPS[this.stepIndex];
    if (!step) return;

    if (step.isComplete(state, this.snapshots ?? {})) {
      this.advanceToNextStep();
      return;
    }

    // A command that didn't finish the step may still have unblocked queued
    // work that only resolves on a tick -- delivering against a contract
    // frees warehouse room so hauling can resume, for one (#959). Without
    // releasing here, a step whose budget had already run out stays paused
    // forever: the held clock stops tickCount from ever advancing again, so
    // decideClock (tutorialGuide.ts) never gets a fresh tick to re-evaluate
    // from and the world can never prove it isn't stuck. Scoped to
    // waitsOnWork steps -- the ones whose completion genuinely depends on
    // ticks resuming -- so a plain click-only step keeps holding as before.
    if (step.waitsOnWork) {
      this.rails.releaseClock(state);
    }
    this.refreshGuide();
  }

  /** Drop the rails class and hide the goal chip (tutorial ending or disposed). */
  private hideGuidedChrome(): void {
    document.body.classList.remove(GUIDED_CLASS, CARD_CLASS);
    this.goalChipEl.style.display = 'none';
    this.stopObservingCardResize();
    document.documentElement.style.removeProperty(CLEARANCE_VAR);
    this.lastClearancePx = -1;
  }

  private step(): RailsStep {
    return TUTORIAL_STEPS[this.stepIndex] ?? { id: '' };
  }

  /**
   * Tail of reaching the last (closing) step: show it for a fixed beat, then
   * auto-dismiss the tutorial.
   *
   * Extracted from advanceToNextStep()'s own "reached last step" branch —
   * behavior unchanged. Has a second call site in shortCircuitOnDefeat()
   * (#959), which lands on the same closing step when state.levelEndReason
   * reports a non-completed defeat mid-tutorial instead of only being
   * reached by stepping through every step in order; the two share the
   * "move onto a step" sequence itself via landOnStep(), below.
   */
  private jumpToLastStep(): void {
    this.stopGuide();
    this.clearCongratulationsTimer();
    this.congratulationsTimer = setTimeout(() => this.finish(), CONGRATULATIONS_DISPLAY_MS);
  }

  /**
   * If the level just ended in anything but a win while an earlier step is
   * still showing, jump straight to the closing card instead of hanging on
   * a condition that can no longer be satisfied (#959) -- a bankruptcy mid
   * 'sell-ore', say, leaves that step's own isComplete permanently false.
   * Generic across every step (not sell-ore-specific): called from both the
   * guide-tick and command-handling paths, mirroring the tail of
   * advanceToNextStep() that already lands on this same last step normally.
   */
  private shortCircuitOnDefeat(): boolean {
    if (!isDefeatReason(this.gameState?.levelEndReason)) return false;
    if (this.stepIndex >= LAST_STEP_INDEX) return false;

    this.landOnStep(LAST_STEP_INDEX);
    this.jumpToLastStep();
    return true;
  }

  /** Move to the next step, or finish when the last one is already showing. */
  private advanceToNextStep(): void {
    if (!this._active) return;

    if (this.stepIndex >= LAST_STEP_INDEX) {
      this.finish();
      return;
    }

    this.landOnStep(this.stepIndex + 1, () => this.runAutoCommands());

    if (this.stepIndex === LAST_STEP_INDEX) {
      this.jumpToLastStep();
    }
  }

  /**
   * Shared tail of moving onto a given step: release the clock (from here on
   * the simulation has to run: survey, drilling, hauling and contract
   * delivery are queued work that only resolves on a tick), hide the paused
   * chip, set the step index, run any caller-specific work that has to see
   * the new index before the rails/render do (`advanceToNextStep`'s
   * `runAutoCommands`), then re-arm the rails, snapshot the new step and
   * re-render. Shared by `advanceToNextStep` and `shortCircuitOnDefeat` so
   * the two ways of landing on a step can't drift apart from each other.
   */
  private landOnStep(index: number, afterIndexSet?: () => void): void {
    this.rails.releaseClock(this.gameState);
    this.pausedEl.style.display = 'none';

    this.stepIndex = index;
    this.applyGuidedClass();
    afterIndexSet?.();

    this.rails.beginStep(this.step(), this.gameState);
    if (this.gameState) {
      this.captureSnapshotForCurrentStep();
    }
    this.render();
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

  /**
   * Ends the tutorial like finish() but does not record bs_tutorial_done.
   * Stop entry point when the live level switches away from the tutorial map.
   */
  abandon(): void {
    this.end(false);
  }

  /**
   * Suspends the tutorial (Return to Menu): tears down UI, clock hold, rails and guide timers,
   * keeps state.tutorialProgress, does not record bs_tutorial_done, unpauses. No-op when inactive.
   */
  suspend(): void {
    if (!this._active) return;
    this.teardown(false);
  }

  /** Resumes the tutorial from state.tutorialProgress; false when there is nothing to resume (#1333). */
  resume(state: GameState): boolean {
    if (state.campaign.activeLevelId !== TUTORIAL_LEVEL_ID) return false;
    const progress = readTutorialProgress(state, TUTORIAL_STEPS.length);
    if (!progress) return false;
    this.activate(progress.stepIndex, progress.snapshot);
    this.gameState = state;
    this.rails.beginStep(this.step(), state);
    // Work already under way keeps running; otherwise start paused, and the
    // player owns the pause button (#1627).
    this.rails.settleClockAfterResume(state);
    this.render();
    if (this.stepIndex === LAST_STEP_INDEX) {
      this.jumpToLastStep();
    } else {
      this.startGuide();
    }
    return true;
  }

  /** Injects the confirm-modal opener used by requestExit (#1332). */
  setConfirmHandler(cb: (config: ConfirmModalConfig) => void): void {
    this.confirmHandler = cb;
  }

  /** Asks the player to confirm leaving the tutorial (#1332). */
  requestExit(): void {
    if (!this.confirmHandler) { this.exit(); return; }
    this.confirmHandler({
      icon: 'warn',
      title: t('tutorial.exit_confirm_title'),
      body: t('tutorial.exit_confirm_body'),
      confirmLabel: t('tutorial.exit_confirm_button'),
      onConfirm: () => this.exit(),
    });
  }

  /** Leaves the tutorial immediately (#1332). */
  exit(): void {
    this.end(true);
  }

  private finish(): void {
    this.end(true);
  }

  /**
   * Single teardown path; `markDone` records bs_tutorial_done so it will not auto-start again.
   * A tutorial ending on a defeat (bankruptcy etc.) never counts as completed (#1631): the
   * outcome is read before teardown drops the game state, so finish, exit and the
   * defeat short-circuit all share the rule.
   */
  private end(markDone: boolean): void {
    if (!this._active) return;
    const endedInDefeat = isDefeatReason(this.gameState?.levelEndReason);
    this.teardown(true);
    if (!markDone || endedInDefeat) return;
    try {
      localStorage.setItem('bs_tutorial_done', '1');
    } catch {
      // Silently ignore — localStorage may be unavailable in restricted browsing environments
    }
  }

  /** `clearProgress` false keeps state.tutorialProgress so resume() can pick the step back up. */
  private teardown(clearProgress: boolean): void {
    this.stopGuide();
    this.clearCongratulationsTimer();
    this.rails.clear();
    this.hideGuidedChrome();
    this.snapshots = {};
    this._active = false;
    if (this.gameState) {
      if (clearProgress) clearTutorialProgress(this.gameState);
      this.gameState.isPaused = false;
    }
    this.pausedEl.style.display = 'none';
    this.overlay.style.display = 'none';
    this.gameState = null;
  }

  private captureSnapshotForCurrentStep(): void {
    const step = TUTORIAL_STEPS[this.stepIndex];
    if (!step) return;

    if (step.captureSnapshot && this.gameState) {
      this.snapshots = step.captureSnapshot(this.gameState);
    }

    if (this.gameState) recordTutorialProgress(this.gameState, this.stepIndex, this.snapshots ?? {});
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

  /** One pass: check completion, move the rails, hold or release the clock. With clockFollowsTimer false (scenario mode, until a scenario opts in via setClockFollowsTimer) it only refreshes presentation. */
  private tickGuide(): void {
    if (!this._active || !this.gameState) return;

    // Scenario mode: step transitions and defeat short-circuit belong to the
    // deterministic command boundary (onCommandExecuted); the wall-clock timer
    // would race the harness's `tick 1` polling (#1580).
    if (this.clockFollowsTimer) {
      if (this.shortCircuitOnDefeat()) return;
      const done = TUTORIAL_STEPS[this.stepIndex];
      if (done && done.isComplete(this.gameState, this.snapshots ?? {})) {
        this.advanceToNextStep();
        return;
      }
    }

    const step = TUTORIAL_STEPS[this.stepIndex];
    if (step?.textParamsFor) this.renderText(step);
    this.refreshGuide();
    if (step?.guided === false) {
      this.pausedEl.style.display = 'none';
      return;
    }
    if (!this.clockFollowsTimer) return;
    const held = this.rails.updateClock(this.gameState);
    this.pausedEl.style.display = held ? '' : 'none';
  }

  /** Switch the real-time guide pass (clock hold/release) on or off after construction. */
  setClockFollowsTimer(enabled: boolean): void {
    this.clockFollowsTimer = enabled;
    if (this._active) this.refreshGuide();
  }

  /** Rails (inert controls) only apply while the current step is guided (#1328). */
  private applyGuidedClass(): void {
    document.body.classList.toggle(GUIDED_CLASS, this.step().guided !== false);
  }

  /** Show the goal chip on `goalChip` steps and refresh its live figures; bound through the locale registry. */
  private renderGoalChip(): void {
    const show = TUTORIAL_STEPS[this.stepIndex]?.goalChip === true && this.gameState !== null;
    this.goalChipEl.style.display = show ? '' : 'none';
    if (show && this.gameState) {
      Object.assign(this.goalParams, goalChipParams(this.gameState));
      this.locale.refresh();
    }
  }

  /** Move the rails onto whichever control the player should be using now. */
  private refreshGuide(): void {
    if (!this._active) return;
    const view = this.rails.refresh(this.gameState);
    this.stageEl.textContent = view.waiting ? view.waitingHint : view.hint;
    this.stageLine.classList.toggle('bs-tutorial-stage-line--waiting', view.waiting);
    this.waitingChipEl.style.display = view.waiting ? '' : 'none';
    this.renderGoalChip();
    this.updateParamStripClearance();
  }

  private clearCongratulationsTimer(): void {
    if (this.congratulationsTimer !== null) {
      clearTimeout(this.congratulationsTimer);
      this.congratulationsTimer = null;
    }
  }

  /** Body text; steps with `textParamsFor` show live figures, so this reruns each guide tick. */
  private renderText(step: (typeof TUTORIAL_STEPS)[number]): void {
    const key = step.textKeyFor && this.gameState ? step.textKeyFor(this.gameState) : step.textKey;
    const params = this.gameState ? step.textParamsFor?.(this.gameState) : undefined;
    this.textEl.textContent = t(key, params);
  }

  private render(): void {
    const step = TUTORIAL_STEPS[this.stepIndex];
    if (!step) return;

    this.titleEl.textContent = t(step.titleKeyFor && this.gameState ? step.titleKeyFor(this.gameState) : step.titleKey);
    this.renderText(step);
    this.stepCounter.textContent = `${this.stepIndex + 1} / ${TOTAL_TUTORIAL_STEPS}`;

    const progress = ((this.stepIndex + 1) / TOTAL_TUTORIAL_STEPS) * 100;
    this.progressEl.style.width = `${progress}%`;

    this.refreshGuide();

    // The console equivalent stays off the card.
    //
    // It reads as an instruction, and the ones that carry coordinates —
    // `build_ramp start:10,23 end:10,35`, `drill_plan ... start:14,24` — read
    // as coordinates the player is expected to reproduce by hand. There is no
    // control in the game that takes a typed tile, so a player who tried was
    // stuck (#489: "expects the player to use the exact coordinates that are
    // just printed out... this is impossible to do"). The scene outline is the
    // hint now; `commands` stays on the step as documentation of what the step
    // is equivalent to.
    this.commandsLabel.style.display = 'none';
    this.commandsHint.style.display = 'none';
    this.commandsHint.textContent = '';
  }

  /**
   * The placement param strip has to dock above the coach card, but the
   * card's height varies with each step's own body text — a fixed offset
   * undershoots for a long step and the strip's CONFIRM button ends up
   * rendered underneath the card instead of above it (found via the
   * box-cut step's four-line body, #482). The card also grows after render
   * (live `textParamsFor` figures, stage hint, waiting/goal chips, locale),
   * so this runs at the end of refreshGuide() and from the card's
   * ResizeObserver (#1630). Skips while inactive and writes the CSS var only
   * when the measured value changed.
   */
  private updateParamStripClearance(): void {
    if (!this._active) return;
    const clearance = this.box.offsetHeight + PARAM_STRIP_CARD_GAP_PX;
    if (clearance === this.lastClearancePx) return;
    this.lastClearancePx = clearance;
    document.documentElement.style.setProperty(CLEARANCE_VAR, `${clearance}px`);
  }

  /** Re-measures param strip clearance whenever the coach card resizes (#1630). */
  private observeCardResize(): void {
    this.stopObservingCardResize();
    if (typeof ResizeObserver === 'undefined') return;
    this.clearanceObserver = new ResizeObserver(() => {
      if (this._active) this.updateParamStripClearance();
    });
    this.clearanceObserver.observe(this.box);
  }

  /** Disconnects the card resize observer (#1630). */
  private stopObservingCardResize(): void {
    this.clearanceObserver?.disconnect();
    this.clearanceObserver = null;
  }
}
