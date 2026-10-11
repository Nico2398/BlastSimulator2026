// BlastSimulator2026 — Tutorial rails, stateful half
//
// Owns which control is live and whether the clock is allowed to run.
// tutorialGuide.ts holds the pure decisions; this holds the state they act on,
// so TutorialOverlay is left with the step sequence and the card.

import { t } from '../core/i18n/I18n.js';
import type { GameState } from '../core/state/GameState.js';
import { stagesFor, PICKER_CANVAS, type TutorialStage } from './tutorialStages.js';
import {
  applyRails, clearRails, isReachable, isClippedByScroller, scrollTargetIntoView, resolveStageIndex, resolveWaitStatus, resolveOrderIssued, decideClock, DEFAULT_TICK_BUDGET,
} from './tutorialGuide.js';
import { setPickerRegion } from './tutorialPickerRegion.js';
import {
  SPEED_BUTTON_GROUP, PAUSE_TOGGLE_SELECTOR, PANEL_OPEN_SELECTOR, TUTORIAL_EXIT_SELECTOR, SETTINGS_SESSION_SELECTORS,
} from './tutorialStepHelpers.js';
import { PANEL_CLOSE_SELECTOR } from './panels/PanelBase.js';
import { installActivationGuard } from './tutorialActivationGuard.js';

/**
 * Selectors permanently allowed from the tutorial's very first step onward,
 * independent of any step's own declarations:
 * - the speed bar is the player's from the moment the tutorial starts (#1015).
 * - the play/pause toggle (and Space, which follows it) is always the player's, so a
 *   resumed tutorial can never leave the clock frozen with no way to restart it (#1627).
 * - opening, closing, or switching between panels is navigation, never a
 *   game-state action, so it is always allowed too (#1041) — gating stays on
 *   the controls *inside* a panel (the active stage's own target/also set),
 *   not on getting to that panel in the first place.
 * - the card's own Exit button and the Settings session controls (language,
 *   volume, Save & Load, Return to Menu) so the player can always leave or
 *   manage the session (#1332). Replay Tutorial stays gated.
 */
export const BASE_PERMANENTLY_ALLOWED: readonly string[] = [
  SPEED_BUTTON_GROUP, PAUSE_TOGGLE_SELECTOR, PANEL_OPEN_SELECTOR, PANEL_CLOSE_SELECTOR,
  TUTORIAL_EXIT_SELECTOR, ...SETTINGS_SESSION_SELECTORS,
];

export interface RailsStep {
  id: string;
  highlightTarget?: string;
  tickBudget?: number;
  waitsOnWork?: boolean;
  clockMustRun?: (state: GameState) => boolean;
  /** `false` once the guided part is over and rails are lifted (#1328). */
  guided?: boolean;
}

/** What the card should show about the current stage and the clock. */
export interface RailsView {
  /** Instruction line, already localised, with a stage counter when relevant. */
  hint: string;
  /** True while the clock is being held for the player. */
  clockHeld: boolean;
  stageIndex: number;
  stageTotal: number;
  stageTarget: string | null;
  /** True while an issued order's stage is waiting on the simulation to resolve it. */
  waiting: boolean;
  /** Localised waiting line, or '' when `waiting` is false. */
  waitingHint: string;
}

export class TutorialRails {
  private stages: TutorialStage[] = [];
  private stageIndex = 0;
  private stepStartTick = 0;
  private budget = DEFAULT_TICK_BUDGET;
  private waitsOnWork = false;
  private clockMustRun: ((state: GameState) => boolean) | undefined;
  private held = false;
  private stepId = '';
  /** `${stepId}:${stageIndex}` already brought into view; one scroll per stage activation. */
  private scrolledKey: string | null = null;
  /** True once the step lifted the rails: the clock is never held (#1328). */
  private unguided = false;
  private lastProgressSignature: string | null = null;
  private lastProgressTick = 0;
  private lastProgressTrainingActive = false;
  /** Disposer of the keyboard/programmatic activation guard; set while installed. */
  private disposeActivationGuard: (() => void) | undefined;

  /** Point the rails at a new step and reset its tick allowance. */
  beginStep(step: RailsStep, state: GameState | null): void {
    this.unguided = step.guided === false;
    this.disposeActivationGuard ??= installActivationGuard(document);
    this.stages = this.unguided ? [] : stagesFor(step.id, step.highlightTarget);
    this.stepId = step.id;
    this.scrolledKey = null;
    this.stageIndex = 0;
    this.budget = step.tickBudget ?? DEFAULT_TICK_BUDGET;
    this.waitsOnWork = step.waitsOnWork === true;
    this.clockMustRun = step.clockMustRun;
    this.stepStartTick = state?.tickCount ?? 0;
    this.lastProgressSignature = null;
    this.lastProgressTick = this.stepStartTick;
    this.lastProgressTrainingActive = false;
    // Published now rather than when the picker's stage goes live: the picker
    // opens on the click that ends the previous stage, so publishing later
    // would leave that first picker unconstrained.
    setPickerRegion(this.stages.find(s => s.region)?.region ?? null);
    if (this.unguided) clearRails();
    this.releaseClock(state);
  }

  /**
   * Re-resolve the live control and move the rails to it.
   *
   * Runs on every pass rather than only when the stage changes: panels are
   * rebuilt as the player interacts, and a rebuilt control has lost its marks.
   */
  refresh(state: GameState | null = null): RailsView {
    if (this.stages.length === 0) {
      clearRails();
      return {
        hint: '', clockHeld: this.held, stageIndex: 0, stageTotal: 0, stageTarget: null, waiting: false, waitingHint: '',
      };
    }

    this.stageIndex = resolveStageIndex(this.stages);
    const stage = this.stages[this.stageIndex];
    const waitStatus = resolveWaitStatus(this.stages, state);
    applyRails(stage, document, BASE_PERMANENTLY_ALLOWED, waitStatus.waiting);
    if (stage && !waitStatus.waiting) this.scrollStageIntoViewOnce(stage);

    const counter = this.stages.length > 1
      ? `  (${this.stageIndex + 1}/${this.stages.length})`
      : '';
    return {
      hint: stage ? `${this.stageHint(stage)}${counter}` : '',
      clockHeld: this.held,
      stageIndex: this.stageIndex,
      stageTotal: this.stages.length,
      stageTarget: stage?.target ?? null,
      waiting: waitStatus.waiting,
      waitingHint: waitStatus.waitingKey ? t(waitStatus.waitingKey) : '',
    };
  }

  /**
   * The stage's instruction, with the target rectangle filled in.
   *
   * A step that demands an exact selection has to say which one — "drag a
   * rectangle over the middle of the map" is not an answer when only one
   * rectangle will be accepted.
   */
  private stageHint(stage: TutorialStage): string {
    const text = stage.target === PICKER_CANVAS ? `${t(stage.hintKey, stage.hintParams)} ${t('tutorial.stage.picker_cancel_tip')}` : t(stage.hintKey, stage.hintParams);
    const r = stage.region;
    if (!r) return text;
    return text
      .replace('{x1}', String(r.x1)).replace('{z1}', String(r.z1))
      .replace('{x2}', String(r.x2)).replace('{z2}', String(r.z2));
  }

  /**
   * Hold the clock once the step has spent its allowance, and let it go again
   * when the step finds more work to do. Without this a player who stops to
   * read watches salaries, needs and contract deadlines run past the step the
   * card is describing.
   */
  updateClock(state: GameState | null): boolean {
    if (!state || this.unguided) return this.held;
    const decision = decideClock(
      state, this.stepStartTick, this.budget, this.waitsOnWork,
      {
        signature: this.lastProgressSignature,
        tick: this.lastProgressTick,
        trainingActive: this.lastProgressTrainingActive,
      },
      this.clockMustRun?.(state) === true,
      this.orderNotIssued(state),
    );
    this.lastProgressSignature = decision.progressSignature;
    this.lastProgressTick = decision.lastProgressTick;
    this.lastProgressTrainingActive = decision.trainingActive;
    const { hold } = decision;

    if (hold && !state.isPaused) {
      state.isPaused = true;
      this.held = true;
    } else if (!hold && this.held) {
      state.isPaused = false;
      this.held = false;
    }
    return this.held;
  }

  /** The step has a player order and it is not issued yet (`null`: no player order). */
  private orderNotIssued(state: GameState): boolean {
    return resolveOrderIssued(this.stages, state) === false;
  }

  /** Let the clock run again — the step moved on. */
  releaseClock(state: GameState | null): void {
    this.held = false;
    if (state) state.isPaused = false;
  }

  /**
   * Reconcile the clock after the tutorial is resumed (#1627). A work-waiting
   * step whose order is already issued runs (the work is under way); any other
   * step starts paused. Never adopted as `held`, so a player unpause sticks.
   */
  settleClockAfterResume(state: GameState): void {
    this.held = false;
    const underway = this.waitsOnWork && !this.orderNotIssued(state);
    state.isPaused = !underway;
  }

  get clockHeld(): boolean {
    return this.held;
  }

  get progress(): { index: number; total: number; target: string | null } {
    return {
      index: this.stageIndex,
      total: this.stages.length,
      target: this.stages[this.stageIndex]?.target ?? null,
    };
  }

  /** Brings the stage's target into view once per activation; a missing target retries next refresh. */
  private scrollStageIntoViewOnce(stage: TutorialStage): void {
    const key = `${this.stepId}:${this.stageIndex}`;
    if (this.scrolledKey === key) return;
    const el = document.querySelector(stage.target);
    if (!el || !isReachable(stage.target)) return;
    if (isClippedByScroller(el)) scrollTargetIntoView(el);
    this.scrolledKey = key;
  }

  /** Take every mark off the DOM — used when the tutorial ends or restarts. */
  clear(): void {
    this.disposeActivationGuard?.();
    this.disposeActivationGuard = undefined;
    clearRails();
    setPickerRegion(null);
    this.stages = [];
    this.stageIndex = 0;
    this.scrolledKey = null;
    this.held = false;
    this.unguided = false;
  }
}
