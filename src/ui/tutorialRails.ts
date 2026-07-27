// BlastSimulator2026 — Tutorial rails, stateful half
//
// Owns which control is live and whether the clock is allowed to run.
// tutorialGuide.ts holds the pure decisions; this holds the state they act on,
// so TutorialOverlay is left with the step sequence and the card.

import { t } from '../core/i18n/I18n.js';
import type { GameState } from '../core/state/GameState.js';
import { stagesFor, type TutorialStage } from './tutorialStages.js';
import {
  applyRails, clearRails, resolveStageIndex, decideClock, DEFAULT_TICK_BUDGET,
} from './tutorialGuide.js';
import { setPickerRegion } from './tutorialPickerRegion.js';

export interface RailsStep {
  id: string;
  highlightTarget?: string;
  tickBudget?: number;
  waitsOnWork?: boolean;
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
}

export class TutorialRails {
  private stages: TutorialStage[] = [];
  private stageIndex = 0;
  private stepStartTick = 0;
  private budget = DEFAULT_TICK_BUDGET;
  private waitsOnWork = false;
  private held = false;

  /** Point the rails at a new step and reset its tick allowance. */
  beginStep(step: RailsStep, state: GameState | null): void {
    this.stages = stagesFor(step.id, step.highlightTarget);
    this.stageIndex = 0;
    this.budget = step.tickBudget ?? DEFAULT_TICK_BUDGET;
    this.waitsOnWork = step.waitsOnWork === true;
    this.stepStartTick = state?.tickCount ?? 0;
    // Published now rather than when the picker's stage goes live: the picker
    // opens on the click that ends the previous stage, so publishing later
    // would leave that first picker unconstrained.
    setPickerRegion(this.stages.find(s => s.region)?.region ?? null);
    this.releaseClock(state);
  }

  /**
   * Re-resolve the live control and move the rails to it.
   *
   * Runs on every pass rather than only when the stage changes: panels are
   * rebuilt as the player interacts, and a rebuilt control has lost its marks.
   */
  refresh(): RailsView {
    if (this.stages.length === 0) {
      clearRails();
      return { hint: '', clockHeld: this.held, stageIndex: 0, stageTotal: 0, stageTarget: null };
    }

    this.stageIndex = resolveStageIndex(this.stages);
    const stage = this.stages[this.stageIndex];
    applyRails(stage);

    const counter = this.stages.length > 1
      ? `  (${this.stageIndex + 1}/${this.stages.length})`
      : '';
    return {
      hint: stage ? `${this.stageHint(stage)}${counter}` : '',
      clockHeld: this.held,
      stageIndex: this.stageIndex,
      stageTotal: this.stages.length,
      stageTarget: stage?.target ?? null,
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
    const text = t(stage.hintKey);
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
    if (!state) return this.held;
    const { hold } = decideClock(state, this.stepStartTick, this.budget, this.waitsOnWork);

    if (hold && !state.isPaused) {
      state.isPaused = true;
      this.held = true;
    } else if (!hold && this.held) {
      state.isPaused = false;
      this.held = false;
    }
    return this.held;
  }

  /** Let the clock run again — the step moved on. */
  releaseClock(state: GameState | null): void {
    this.held = false;
    if (state) state.isPaused = false;
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

  /** Take every mark off the DOM — used when the tutorial ends. */
  clear(): void {
    clearRails();
    setPickerRegion(null);
    this.stages = [];
    this.stageIndex = 0;
    this.held = false;
  }
}
