// BlastSimulator2026 — AudioParam scheduling helpers
// A param that already has automation queued ignores a plain assignment, so
// every change first drops the pending events and pins the current value.

/** Move a param to `target` along an exponential approach (`timeConstantS` seconds per 63%). */
export function smoothTo(param: AudioParam, target: number, now: number, timeConstantS: number): void {
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  param.setTargetAtTime(target, now, timeConstantS);
}

/** Set a param immediately, discarding anything queued. */
export function jumpTo(param: AudioParam, value: number, now: number): void {
  param.cancelScheduledValues(now);
  param.setValueAtTime(value, now);
}

/** Linear ramp from the current value to `target`, arriving `durationS` from now. */
export function rampTo(param: AudioParam, target: number, now: number, durationS: number): void {
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  param.linearRampToValueAtTime(target, now + durationS);
}
