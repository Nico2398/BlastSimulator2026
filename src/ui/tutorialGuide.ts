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
    const stage = stages[i]!;
    if (isReachable(stage.target)) return i;
    // `target` is gone — before falling back to an earlier stage, check
    // whether this stage's own action is what made it disappear (#903): a
    // booked course replaces the Train button with a status view, and that
    // status view is this stage's `doneTarget`. Only reached here because
    // `target` already failed, so `target` still wins whenever it resolves.
    if (stage.doneTarget && isReachable(stage.doneTarget)) return i;
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

/**
 * A modal's own dismiss/cancel/close control — stays allowed even when a
 * stage narrows the rest of that modal's controls down to a single target
 * (#951), so a player can still back out of the modal the stage is pointing
 * into.
 */
export const MODAL_DISMISS_SELECTOR = '[data-action$="-cancel"], [data-action$="-close"], .bs-event-dismiss';

/** Every selector the player may interact with during a stage. */
export function allowedSelectors(stage: TutorialStage | undefined): string[] {
  if (!stage) return [];
  return [stage.target, ...(stage.also ?? [])];
}

/**
 * Every modal currently on screen (matches `MODAL_SELECTOR` and its own
 * `display` is not `none`).
 *
 * Used by `applyRails` to decide, per modal, whether it gets blanket-allowed
 * or narrowed down to the active stage's own target (#951).
 */
export function visibleModals(root: ParentNode | Document): Element[] {
  return Array.from(root.querySelectorAll(MODAL_SELECTOR)).filter(
    (modal) => getComputedStyle(modal as HTMLElement).display !== 'none',
  );
}

/**
 * Whether `stage`'s target/also selectors resolve to an element contained by
 * `modal`.
 *
 * `applyRails` blanket-allows a modal's controls only when no active stage
 * targets a control inside it; when one does, that modal is narrowed to the
 * stage's own target plus `MODAL_DISMISS_SELECTOR` instead (#951).
 */
export function stageTargetsInsideModal(
  stage: TutorialStage | undefined,
  modal: Element,
  root: ParentNode | Document,
): boolean {
  for (const selector of allowedSelectors(stage)) {
    for (const el of Array.from(root.querySelectorAll(selector))) {
      if (modal.contains(el)) return true;
    }
  }
  return false;
}

/**
 * Put the rails on the DOM: glow the stage's control, mark it and its helpers
 * live, and clear the marks from everything else.
 *
 * Blocking is done in CSS off `GUIDED_CLASS`, so a control that appears between
 * two passes is inert from the moment it is rendered rather than briefly
 * clickable.
 */
export function applyRails(
  stage: TutorialStage | undefined,
  root: ParentNode = document,
  // Selectors a past step (#923's speed buttons, once its lesson pair is
  // done) left permanently clickable — stay live across every later stage,
  // stage present or not.
  extraAllowed: string[] = [],
): void {
  for (const el of Array.from(root.querySelectorAll(`.${ALLOWED_CLASS}`))) {
    el.classList.remove(ALLOWED_CLASS);
  }
  for (const el of Array.from(root.querySelectorAll(`.${HIGHLIGHT_CLASS}`))) {
    el.classList.remove(HIGHLIGHT_CLASS);
  }
  // An open modal is always operable, unless the active stage targets one of
  // its own controls (#951) — then only that target and the modal's own
  // dismiss control stay allowed, so a player can still back out.
  for (const modal of visibleModals(root)) {
    if (stageTargetsInsideModal(stage, modal, root)) {
      for (const el of Array.from(modal.querySelectorAll(MODAL_DISMISS_SELECTOR))) {
        el.classList.add(ALLOWED_CLASS);
      }
    } else {
      for (const el of Array.from(modal.querySelectorAll('button, select, input'))) {
        el.classList.add(ALLOWED_CLASS);
      }
    }
  }

  for (const selector of extraAllowed) {
    for (const el of Array.from(root.querySelectorAll(selector))) {
      el.classList.add(ALLOWED_CLASS);
    }
  }

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
  /**
   * True when this decision found at least one employee mid-course. Carried
   * forward into the next check's `ClockProgress` (#903) so a course that
   * finishes between two checks — `tickTraining` clears `trainingState` on
   * the very tick `decideClock` next runs — still reads as "work just
   * finished" rather than "nothing was ever happening", and does not snap the
   * hold on before the step's own `isComplete` gets a chance to fire.
   */
  trainingActive: boolean;
}

/** Tracks the outstanding work's signature and when it last changed. */
export interface ClockProgress {
  signature: string | null;
  tick: number;
  /** Mirrors `ClockDecision.trainingActive` from the previous check. */
  trainingActive?: boolean;
}

/**
 * Whether an employee still has work outstanding: a queued/active action, or
 * movement in flight with no action attached yet (see `isWorkInProgress`).
 * Shared by `isWorkInProgress` and `workSignature` so the two stay in sync.
 */
function hasOutstandingWork(e: Employee): boolean {
  return (
    e.activeActionId !== null
    || e.pendingDriverVehicleId !== null
    || e.destinationX !== null
    || e.trainingState != null
  );
}

/**
 * True if any employee is mid-course (#903). Kept separate from
 * `hasOutstandingWork`/`isWorkInProgress` because a live course gets treated
 * differently by `decideClock`: bounded, self-resolving work that must never
 * be judged "stalled", where every other outstanding-work signal can be.
 */
function hasActiveTraining(state: GameState): boolean {
  return state.employees.employees.some((e) => e.trainingState != null);
}

/**
 * True if this vehicle has a live haul or break phase in progress (#552).
 *
 * The employee driving it carries no per-tick signal of its own once
 * boarded — hasOutstandingWork(e) only ever reads activeActionId (which
 * stays at the same haul_debris/fragment_debris action id for the entire
 * multi-tick round trip) and destinationX/Z (never set while aboard: the
 * driver's own x/z sit still the whole time). Without this, workSignature's
 * fingerprint for a hauling driver never changes tick to tick, and the
 * WORK_GRACE_TICKS window would time out mid-trip and hold the clock on a
 * haul that is still visibly making progress.
 */
function hasOutstandingVehicleWork(v: Vehicle): boolean {
  return v.haulingPhase !== null || v.breakPhase !== null;
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
      e.pendingTaskDuration, e.pendingRestDuration, e.trainingState?.ticksRemaining ?? '',
    ].join(','))
    .join(';');

  // A hauling/breaking vehicle's own id/x/z/phase/target-fragment fields
  // (#552) — changes every tick the vehicle moves and at every phase
  // transition, which is what lets a hauling driver's otherwise-static
  // employee signature above still register as "still working" instead of
  // reading stuck the instant WORK_GRACE_TICKS elapses.
  const vehicleWorking = (state.vehicles?.vehicles ?? [])
    .filter(hasOutstandingVehicleWork)
    .slice()
    .sort((a, b) => a.id - b.id)
    .map((v) => [
      v.id, v.x, v.z, v.haulingPhase, v.haulingFragmentId, v.breakPhase, v.breakFragmentId,
    ].join(','))
    .join(';');

  return `${pendingIds}|${working}|${vehicleWorking}`;
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
  if (state.employees.employees.some(hasOutstandingWork)) return true;
  return (state.vehicles?.vehicles ?? []).some(hasOutstandingVehicleWork);
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
  const tickCount = state.tickCount ?? 0;
  const spent = Math.max(0, tickCount - stepStartTick);
  const trainingActive = hasActiveTraining(state);
  if (spent < budget) {
    return {
      hold: false, spent, progressSignature: progress.signature, lastProgressTick: progress.tick, trainingActive,
    };
  }
  if (!waitsOnWork) {
    return {
      hold: true, spent, progressSignature: progress.signature, lastProgressTick: progress.tick, trainingActive,
    };
  }

  // A live course is bounded, self-resolving work: `ticksRemaining` only ever
  // reaches 0 by the sim actually ticking, so holding the clock on one
  // because its signature "looks stale" would be self-defeating — the hold
  // itself is what stops the ticking that would finish the course (#903).
  // Unlike a stalled walk or a blocked haul, a course in progress is never
  // "stuck": it either keeps counting down or it is already done.
  if (trainingActive) {
    const signature = workSignature(state);
    return { hold: false, spent, progressSignature: signature, lastProgressTick: tickCount, trainingActive };
  }

  if (!isWorkInProgress(state)) {
    // A course can clear `trainingState` on the very tick this runs next —
    // `tickTraining` finishes it inside the same simulation tick that is
    // about to make this check's caller re-read `isComplete`. Snapping the
    // hold on immediately would re-pause the game one call before the step
    // notices it is done, and nothing left running would ever lift it again.
    // Give exactly this one check the same "still fine" answer training got
    // one tick ago, then fall back to the normal immediate hold from here.
    if (progress.trainingActive === true) {
      return {
        hold: false, spent, progressSignature: null, lastProgressTick: tickCount, trainingActive: false,
      };
    }
    return {
      hold: true, spent, progressSignature: progress.signature, lastProgressTick: progress.tick, trainingActive,
    };
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
    return { hold: false, spent, progressSignature: signature, lastProgressTick, trainingActive };
  }
  return { hold: true, spent, progressSignature: signature, lastProgressTick, trainingActive };
}
