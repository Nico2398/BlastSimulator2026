// BlastSimulator2026 — Audio unit conversions

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** `value` when it is a finite number, else `fallback`: keeps NaN and Infinity out of AudioParam automation, which throws on them. */
export function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/** Decibels to a linear amplitude factor. */
export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/** Pitch shift in cents to a playback-rate factor. */
export function centsToRate(cents: number): number {
  return Math.pow(2, cents / 1200);
}
