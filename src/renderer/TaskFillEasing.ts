// BlastSimulator2026 — Task Fill Easing (#906)
// Pure per-tick fill-fraction easing for TaskProgressBar, mirroring the
// position-tween pattern in MovementInterpolation.ts but for a single scalar
// (a task progress bar's fill fraction) instead of an (x, z) position.
// No THREE import — same pure-logic-out-of-mesh-class seam.

import { smoothstep } from '../core/math/Smoothstep.js';
import { MOVE_TWEEN_DURATION_S } from './MovementInterpolation.js';

export interface FillTween {
  prevFraction: number;
  targetFraction: number;
  elapsedS: number;
}

// Tolerance for treating a retarget as "forward" (ease) vs "backward" (snap).
// A tiny epsilon absorbs floating-point noise around an unchanged target.
export const FILL_SNAP_BACKWARD_EPSILON = 1e-6;

export function createFillTween(initialFraction: number): FillTween {
  return {
    prevFraction: initialFraction,
    targetFraction: initialFraction,
    elapsedS: 0,
  };
}

// Stateful per-frame step: advances `tween` by `dt` real seconds (mutates it)
// and returns the eased fraction to render. Forward retarget (new target at
// or above the current render fraction, within FILL_SNAP_BACKWARD_EPSILON)
// eases smoothly over MOVE_TWEEN_DURATION_S. Backward retarget (new target
// below renderFraction - FILL_SNAP_BACKWARD_EPSILON — task changed,
// cancelled, or re-dispatched) snaps instantly to targetFraction.
export function stepFillTween(
  tween: FillTween,
  renderFraction: number,
  targetFraction: number,
  dt: number,
): number {
  // Backward retarget — the underlying task changed (fresh task, cancelled,
  // re-dispatched). Snap instantly instead of easing backward, regardless of
  // dt (even dt === 0 — e.g. a sync() call ahead of the next update() frame).
  if (targetFraction < renderFraction - FILL_SNAP_BACKWARD_EPSILON) {
    tween.prevFraction = targetFraction;
    tween.targetFraction = targetFraction;
    tween.elapsedS = MOVE_TWEEN_DURATION_S;
    return targetFraction;
  }

  // Forward retarget: target changed since the last step (or this is the
  // first step toward it) — re-tween from the currently rendered fraction,
  // not the tween's stale prev/target, so a mid-ease retarget doesn't pop.
  if (targetFraction !== tween.targetFraction) {
    tween.prevFraction = renderFraction;
    tween.targetFraction = targetFraction;
    tween.elapsedS = 0;
  }

  if (dt === 0) return renderFraction;

  tween.elapsedS += dt;

  // Converged (or a large dt jumped past the duration) — return the target
  // exactly rather than relying on smoothstep(1)'s arithmetic to cancel out.
  if (tween.elapsedS >= MOVE_TWEEN_DURATION_S) {
    tween.elapsedS = MOVE_TWEEN_DURATION_S;
    tween.prevFraction = targetFraction;
    return targetFraction;
  }

  const ease = smoothstep(0, MOVE_TWEEN_DURATION_S, tween.elapsedS);
  return tween.prevFraction + (tween.targetFraction - tween.prevFraction) * ease;
}
