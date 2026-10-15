// BlastSimulator2026 — fill fraction of a gauge: value / capacity clamped to [0, 1].

/** `value / capacity` clamped to [0, 1]; 0 when `capacity` is not positive. */
export function fractionOf(value: number, capacity: number): number {
  return capacity > 0 ? Math.min(1, Math.max(0, value / capacity)) : 0;
}
