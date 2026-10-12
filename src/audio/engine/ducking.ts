// BlastSimulator2026 — Bus ducking maths
// A duck pulls a bus down fast, holds, then releases along an exponential
// curve. The state is tracked here so overlapping ducks resolve to the deeper
// one without reading the AudioParam back, and so the level at any time is a
// pure function (testable without a Web Audio graph).

export interface DuckState {
  /** Linear level the bus was pulled down to. */
  readonly level: number;
  /** Audio-clock time the hold ends and the release begins. */
  readonly holdEnd: number;
  /** Duration of the release (s). */
  readonly releaseS: number;
}

export const NO_DUCK: DuckState = { level: 1, holdEnd: 0, releaseS: 0 };

/** The duck gain at `now`: the level during the hold, then an exponential climb back to 1. */
export function duckLevelAt(state: DuckState, now: number, releaseTimeConstants: number): number {
  if (now < state.holdEnd) return state.level;
  if (state.releaseS <= 0 || now >= state.holdEnd + state.releaseS) return 1;
  const timeConstant = state.releaseS / releaseTimeConstants;
  return 1 - (1 - state.level) * Math.exp(-(now - state.holdEnd) / timeConstant);
}

/**
 * Merge a new duck into the running one. The deeper of the two levels wins; a
 * duck arriving while another still holds extends the hold to whichever ends
 * later, and one arriving mid-release restarts from where the release is.
 */
export function mergeDuck(
  current: DuckState,
  now: number,
  level: number,
  holdS: number,
  releaseS: number,
  attackS: number,
  releaseTimeConstants: number,
): DuckState {
  const present = duckLevelAt(current, now, releaseTimeConstants);
  const holding = now < current.holdEnd;
  const holdEnd = Math.max(now + Math.max(holdS, attackS), holding ? current.holdEnd : 0);
  return { level: Math.min(level, present), holdEnd, releaseS: holding ? Math.max(releaseS, current.releaseS) : releaseS };
}

/** Queue the attack, hold and release of `state` on a gain param, replacing whatever was scheduled. */
export function scheduleDuck(
  param: AudioParam,
  previousLevel: number,
  state: DuckState,
  now: number,
  attackS: number,
  releaseTimeConstants: number,
): void {
  param.cancelScheduledValues(now);
  param.setValueAtTime(previousLevel, now);
  param.linearRampToValueAtTime(state.level, now + attackS);
  param.setValueAtTime(state.level, state.holdEnd);
  param.setTargetAtTime(1, state.holdEnd, state.releaseS / releaseTimeConstants);
  param.setValueAtTime(1, state.holdEnd + state.releaseS);
}
