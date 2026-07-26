// BlastSimulator2026 — Tutorial guide rails
//
// Enforcement for the guided tutorial: exactly one control is live at a time,
// everything else is inert, and the clock cannot run far enough ahead for the
// game state to drift away from the step the card is describing.
//
// Kept apart from TutorialOverlay, which owns the card and the step sequence.

import type { GameState } from '../core/state/GameState.js';
import type { TutorialStage } from './tutorialStages.js';

/** Marks the body while the tutorial holds the rails. */
export const GUIDED_CLASS = 'bs-tutorial-guided';
/** Marks the controls the player is allowed to use right now. */
export const ALLOWED_CLASS = 'bs-tutorial-allowed';
/** Marks the one control the step is pointing at. */
export const HIGHLIGHT_CLASS = 'bs-tutorial-highlight';

/**
 * Ticks a step may consume before the clock is held.
 *
 * The tutorial has to let time run — surveying, hauling and delivery are queued
 * work that only resolves on a tick — but unbounded time is what lets the world
 * move on while the player is still reading. Each step gets an allowance;
 * spending it pauses the game until the player does the thing being asked.
 */
export const DEFAULT_TICK_BUDGET = 10;

/**
 * Extra ticks granted while queued work is outstanding. Pausing with work in
 * flight would deadlock a step whose completion depends on that work finishing,
 * so the clock keeps running — but not forever.
 */
export const WORK_GRACE_TICKS = 40;

/** A control the player may use: on screen, sized, and not disabled. */
export function isReachable(selector: string): boolean {
  const el = document.querySelector(selector) as (HTMLElement & { disabled?: boolean }) | null;
  if (!el) return false;
  if (el.disabled === true) return false;
  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  // Deliberately does NOT consult pointer-events: the guide itself sets that on
  // everything it is blocking, so testing it here would make a stage's
  // reachability depend on the answer it is being used to compute.
  let node: HTMLElement | null = el.parentElement;
  while (node) {
    const s = getComputedStyle(node);
    if (s.display === 'none' || s.visibility === 'hidden') return false;
    node = node.parentElement;
  }
  return true;
}

/**
 * Which stage the player is on.
 *
 * The last reachable stage wins. Later stages live behind earlier ones — a
 * panel's button does not exist until the panel is open, a picker's Confirm is
 * disabled until a tile is chosen — so reachability tracks progress through the
 * sequence without the guide having to watch for clicks. It also recovers on
 * its own: close the panel and the stage falls back to the button that opens it.
 */
export function resolveStageIndex(stages: TutorialStage[]): number {
  for (let i = stages.length - 1; i >= 0; i--) {
    if (isReachable(stages[i]!.target)) return i;
  }
  return 0;
}

/**
 * Modal overlays. Their controls stay live no matter which stage is active: a
 * modal covers the whole screen, so blocking its own buttons would seal the
 * game behind it with nothing left to click — and there is no Skip button to
 * escape with any more.
 */
const MODAL_SELECTOR = '.bs-confirm-overlay';

/** Every selector the player may interact with during a stage. */
export function allowedSelectors(stage: TutorialStage | undefined): string[] {
  if (!stage) return [];
  return [stage.target, ...(stage.also ?? [])];
}

/** Controls inside any modal that is currently on screen. */
function visibleModalControls(root: ParentNode): Element[] {
  const controls: Element[] = [];
  for (const modal of Array.from(root.querySelectorAll(MODAL_SELECTOR))) {
    if (getComputedStyle(modal as HTMLElement).display === 'none') continue;
    controls.push(...Array.from(modal.querySelectorAll('button, select, input')));
  }
  return controls;
}

/**
 * Put the rails on the DOM: glow the stage's control, mark it and its helpers
 * live, and clear the marks from everything else.
 *
 * Blocking is done in CSS off `GUIDED_CLASS`, so a control that appears between
 * two passes is inert from the moment it is rendered rather than briefly
 * clickable.
 */
export function applyRails(stage: TutorialStage | undefined, root: ParentNode = document): void {
  for (const el of Array.from(root.querySelectorAll(`.${ALLOWED_CLASS}`))) {
    el.classList.remove(ALLOWED_CLASS);
  }
  for (const el of Array.from(root.querySelectorAll(`.${HIGHLIGHT_CLASS}`))) {
    el.classList.remove(HIGHLIGHT_CLASS);
  }
  // An open modal is always operable, even mid-stage.
  for (const el of visibleModalControls(root)) el.classList.add(ALLOWED_CLASS);

  if (!stage) return;

  for (const selector of allowedSelectors(stage)) {
    for (const el of Array.from(root.querySelectorAll(selector))) {
      el.classList.add(ALLOWED_CLASS);
    }
  }
  const target = root.querySelector(stage.target);
  if (target) target.classList.add(HIGHLIGHT_CLASS);
}

/** Take the rails off — used when the tutorial ends. */
export function clearRails(root: ParentNode = document): void {
  applyRails(undefined, root);
}

export interface ClockDecision {
  /** True when the clock should be held until the player acts. */
  hold: boolean;
  /** Ticks consumed by the current step so far. */
  spent: number;
}

/**
 * Whether the clock has run far enough for this step.
 *
 * Work in flight keeps it running up to a grace cap, so a step waiting on a
 * surveyor cannot pause itself into a deadlock; an idle queue means the step is
 * waiting on the player, and waiting on the player is not a reason for the
 * world to keep moving.
 */
export function decideClock(
  state: GameState,
  stepStartTick: number,
  budget: number = DEFAULT_TICK_BUDGET,
): ClockDecision {
  const spent = Math.max(0, (state.tickCount ?? 0) - stepStartTick);
  if (spent < budget) return { hold: false, spent };

  const working = (state.pendingActions?.length ?? 0) > 0
    || state.employees.employees.some(e => e.activeActionId !== null);
  if (working && spent < budget + WORK_GRACE_TICKS) return { hold: false, spent };

  return { hold: true, spent };
}
