// BlastSimulator2026 — resumable computations (#1603)
//
// A computation too long for one frame is written as a generator that yields
// between bounded slices of work, and returns its result at the end. Nothing
// about the work changes between a run in slices and a run in one go — the
// same statements execute in the same order — so a caller that cannot wait
// (the console, a test) drains it at once and gets the identical result, and
// one that can (the browser's frame loop) runs it a few slices per frame.
// Core stays clock-free: deciding how many slices fit in a frame is the
// caller's business.

/** A computation that yields between slices of work and returns `T`. */
export type Steps<T> = Generator<void, T, void>;

/** Run `steps` to the end in one go. */
export function drain<T>(steps: Steps<T>): T {
  for (;;) {
    const next = steps.next();
    if (next.done === true) return next.value;
  }
}

/**
 * Advance `steps` until it finishes or `outOfTime()` says the slice budget is
 * spent — at least one step either way, so a slow machine still progresses.
 * Returns `{ done: true, value }` once finished.
 */
export function advance<T>(steps: Steps<T>, outOfTime: () => boolean): IteratorResult<void, T> {
  for (;;) {
    const next = steps.next();
    if (next.done === true || outOfTime()) return next;
  }
}
