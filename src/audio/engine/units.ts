// BlastSimulator2026 — Audio unit conversions

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Decibels to a linear amplitude factor. */
export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/** Pitch shift in cents to a playback-rate factor. */
export function centsToRate(cents: number): number {
  return Math.pow(2, cents / 1200);
}
