// BlastSimulator2026 — Equal-power fades for music gains
// A rising fade follows sin and a falling one 1 - cos, so a fade out and a fade
// in over the same span sum to constant power. Fades start from wherever the
// gain currently is, so a track switch in the middle of a crossfade never jumps.

export interface Fade {
  readonly from: number;
  readonly to: number;
  /** Start on the clock the fade is scheduled against (s). */
  readonly startS: number;
  readonly durationS: number;
}

function shape(progress: number, rising: boolean): number {
  const angle = progress * Math.PI / 2;
  return rising ? Math.sin(angle) : 1 - Math.cos(angle);
}

/** Gain of `fade` at clock time `t`; holds `from` before the start and `to` after the end. */
export function fadeLevelAt(fade: Fade, t: number): number {
  const progress = (t - fade.startS) / fade.durationS;
  if (progress <= 0) return fade.from;
  if (progress >= 1) return fade.to;
  return fade.from + (fade.to - fade.from) * shape(progress, fade.to >= fade.from);
}

/** `points` evenly spaced gain samples over the fade, for `setValueCurveAtTime`. */
export function buildFadeCurve(fade: Fade, points: number): Float32Array {
  const curve = new Float32Array(points);
  for (let i = 0; i < points; i++) {
    curve[i] = fadeLevelAt(fade, fade.startS + fade.durationS * i / (points - 1));
  }
  return curve;
}

/**
 * Queue `fade` on a gain param, replacing anything already queued. Browsers differ on what an overlapping
 * curve does (some throw NotSupportedError from `setValueAtTime` inside a running one), so every step is
 * fenced: curve, else linear ramp, else the end level assigned at once. It never throws.
 */
export function scheduleFade(param: AudioParam, fade: Fade, points: number): void {
  try {
    param.cancelScheduledValues(fade.startS);
    param.setValueAtTime(fade.from, fade.startS);
    try {
      param.setValueCurveAtTime(buildFadeCurve(fade, points), fade.startS, fade.durationS);
    } catch {
      param.linearRampToValueAtTime(fade.to, fade.startS + fade.durationS);
    }
  } catch {
    assignLevel(param, fade.to);
  }
}

/** Set `value` outright, dropping what is queued; a param that refuses even that is left as it is. */
export function assignLevel(param: AudioParam, value: number): void {
  try {
    param.cancelScheduledValues(0);
  } catch {
    // nothing queued that can be dropped
  }
  try {
    param.value = value;
  } catch {
    // the param is unreachable: the fade is lost, the music keeps its last level
  }
}
