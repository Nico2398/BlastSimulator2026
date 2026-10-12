// BlastSimulator2026 — Mixing helpers

/** tanh saturation normalised so an input of +-1 stays at +-1; warms low-end thumps. */
export function saturate(x: number, drive: number): number {
  return Math.tanh(x * drive) / Math.tanh(drive);
}

/** Add `source` scaled by `gain` into `target` starting at `offset`; samples past the end are dropped. */
export function mixInto(target: Float32Array, source: ArrayLike<number>, gain: number, offset = 0): void {
  const end = Math.min(target.length, offset + source.length);
  for (let i = Math.max(0, offset); i < end; i++) {
    target[i] = (target[i] as number) + gain * (source[i - offset] as number);
  }
}

/** Like `mixInto` but samples running past the end wrap to the start (for loops). */
export function mixIntoCircular(target: Float32Array, source: ArrayLike<number>, gain: number, offset: number): void {
  const length = target.length;
  for (let i = 0; i < source.length; i++) {
    const at = (offset + i) % length;
    target[at] = (target[at] as number) + gain * (source[i] as number);
  }
}

/** Linear gain for a level in dB. */
export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}
