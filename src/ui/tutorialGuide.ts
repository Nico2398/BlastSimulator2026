// BlastSimulator2026 — Tutorial guide rails
//
// Enforcement for the guided tutorial: exactly one control is live at a time,
// everything else is inert, and the clock cannot run far enough ahead for the
// game state to drift away from the step the card is describing.
//
// Kept apart from TutorialOverlay, which owns the card and the step sequence.

import type { GameState } from '../core/state/GameState.js';
import type { Employee } from '../core/entities/Employee.js';
import type { Vehicle } from '../core/entities/Vehicle.js';
import type { TutorialStage } from './tutorialStages.js';

/** Marks the body while the tutorial holds the rails. */
export const GUIDED_CLASS = 'bs-tutorial-guided';
/** Marks the controls the player is allowed to use right now. */
export const ALLOWED_CLASS = 'bs-tutorial-allowed';
/**
 * Marks the one control the step is pointing at.
 *
 * `bsx-highlight` (redesign P0, `src/ui/tokens.ts`) is the static three-ring
 * glow the design system specifies. The pre-redesign class this replaced,
 * `bs-tutorial-highlight`, pulsed — a leftover from before P0 ported the
 * design system's own (non-pulsing) highlight token; P10 finally points the
 * rails at it.
 */
export const HIGHLIGHT_CLASS = 'bsx-highlight';

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
 * Extra ticks granted after the outstanding work last showed progress. Pausing
 * with work in flight would deadlock a step whose completion depends on that
 * work finishing, so the clock keeps running while `workSignature` keeps
 * changing — but a signature that stops changing (the work stalled) still
 * gets held once this many ticks have passed since it last moved.
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
  /** Work signature observed at this decision, carried forward by the caller. */
  progressSignature: string | null;
  /** Tick at which the carried-forward signature last changed. */
  lastProgressTick: number;
}

/** Tracks the outstanding work's signature and when it last changed. */
export interface ClockProgress {
  signature: string | null;
  tick: number;
}

/**
 * Whether an employee still has work outstanding: a queued/active action, or
 * movement in flight with no action attached yet (see `isWorkInProgress`).
 * Shared by `isWorkInProgress` and `workSignature` so the two stay in sync.
 */
function hasOutstandingWork(e: Employee): boolean {
  return e.activeActionId !== null || e.pendingDriverVehicleId !== null || e.destinationX !== null;
}

/**
 * True if this vehicle has a live haul or break phase in progress (#552).
 * Not yet wired into hasOutstandingWork/isWorkInProgress/workSignature —
 * that is the implementer's job.
 *
 * Skeleton only — body filled in by the implementer (#552).
 */
function hasOutstandingVehicleWork(v: Vehicle): boolean {
  // TODO: implement
  void v;
  return false;
}

/**
 * Fingerprint of the outstanding work so `decideClock` can tell "still moving"
 * from "stuck" instead of granting a flat grace window from step start.
 *
 * Cheap to compute every call (this runs every frame): covers everything
 * `isWorkInProgress` inspects, generic across every `waitsOnWork` step.
 */
function workSignature(state: GameState): string {
  const pendingIds = (state.pendingActions ?? [])
    .map((a) => a.id)
    .sort((a, b) => a - b)
    .join(',');

  const working = state.employees.employees
    .filter(hasOutstandingWork)
    .slice()
    .sort((a, b) => a.id - b.id)
    .map((e) => [
      e.id, e.x, e.z, e.activeActionId, e.pendingDriverVehicleId,
      e.destinationX, e.destinationZ, e.taskTicksRemaining, e.restTicksRemaining,
      e.pendingTaskDuration, e.pendingRestDuration,
    ].join(','))
    .join(';');

  return `${pendingIds}|${working}`;
}

/**
 * Whether the simulation still owes the player something it can only deliver
 * by running.
 *
 * A queued or active action is the obvious case, but not the only one: an
 * employee walking somewhere is work in flight with no action attached. A
 * driver sent to board a vehicle, in particular, only records
 * `pendingDriverVehicleId` and a destination — ArrivalGate turns that into an
 * actual driver once they arrive. Counting only actions made that walk
 * invisible here, so the clock could be held on an employee mid-stride and
 * they would never arrive.
 */
function isWorkInProgress(state: GameState): boolean {
  if ((state.pendingActions?.length ?? 0) > 0) return true;
  return state.employees.employees.some(hasOutstandingWork);
}

/**
 * Whether the clock has run far enough for this step.
 *
 * Steps that wait on the simulation — a surveyor walking out, ore being hauled
 * in — opt into a grace period so they cannot pause themselves into a deadlock:
 * a paused surveyor never arrives. Every other step holds the moment its
 * allowance runs out, because waiting on the player is not a reason for the
 * world to keep moving. Contract offers, for one, are regenerated on a timer
 * and the oldest is dropped, so a step that asks the player to pick an offer
 * must not let the list churn while they read it.
 *
 * The grace period is measured from the outstanding work's last observed
 * progress, not from step start: `workSignature` fingerprints the work every
 * call, and the window resets whenever that fingerprint changes. Work that
 * keeps moving — a driver still walking toward a vehicle — never runs out the
 * clock; work that genuinely stalls still gets held `WORK_GRACE_TICKS` after
 * it stopped moving.
 */
export function decideClock(
  state: GameState,
  stepStartTick: number,
  budget: number = DEFAULT_TICK_BUDGET,
  waitsOnWork: boolean = false,
  progress: ClockProgress = { signature: null, tick: stepStartTick },
): ClockDecision {
  // hasOutstandingVehicleWork (#552) is not wired in yet — implementer's job.
  void hasOutstandingVehicleWork;
  const tickCount = state.tickCount ?? 0;
  const spent = Math.max(0, tickCount - stepStartTick);
  if (spent < budget) {
    return { hold: false, spent, progressSignature: progress.signature, lastProgressTick: progress.tick };
  }
  if (!waitsOnWork) {
    return { hold: true, spent, progressSignature: progress.signature, lastProgressTick: progress.tick };
  }
  if (!isWorkInProgress(state)) {
    return { hold: true, spent, progressSignature: progress.signature, lastProgressTick: progress.tick };
  }

  const signature = workSignature(state);
  const changed = progress.signature !== null && signature !== progress.signature;
  // No progress observed yet (first-ever check for this step): anchor the
  // grace window to when work-checking begins — stepStartTick + budget — not
  // to progress.tick, which a caller may have left at stepStartTick. Anchoring
  // there would let the grace window start counting before the budget itself
  // had even elapsed, silently widening it.
  const lastProgressTick = progress.signature === null
    ? Math.max(progress.tick, stepStartTick + budget)
    : (changed ? tickCount : progress.tick);
  const sinceProgress = tickCount - lastProgressTick;

  if (sinceProgress < WORK_GRACE_TICKS) {
    return { hold: false, spent, progressSignature: signature, lastProgressTick };
  }
  return { hold: true, spent, progressSignature: signature, lastProgressTick };
}
