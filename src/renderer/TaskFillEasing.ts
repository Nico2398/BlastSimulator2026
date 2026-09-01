// BlastSimulator2026 — Task Fill Easing (#906)
// Pure per-tick fill-fraction easing for TaskProgressBar, mirroring the
// position-tween pattern in MovementInterpolation.ts but for a single scalar
// (a task progress bar's fill fraction) instead of an (x, z) position.
// No THREE import — same pure-logic-out-of-mesh-class seam.

// Green phase: reuse `smoothstep` from '../core/math/Smoothstep.js' and the
// `MOVE_TWEEN_DURATION_S` constant from './MovementInterpolation.js' for the
// eased-duration math below — do not redefine either.

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
  void tween; void renderFraction; void targetFraction; void dt;
  // TODO: implement in green phase
  throw new Error('not implemented');
}
