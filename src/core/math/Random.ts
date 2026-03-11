// BlastSimulator2026 — Seeded PRNG (mulberry32)
// Deterministic random number generator for reproducible gameplay and tests.
// All game randomness MUST go through this class so replays and tests work.

/**
 * Mulberry32: a fast 32-bit seeded PRNG.
 * Period: 2^32. Quality: passes BigCrush. Speed: ~1ns per call.
 * Reference: https://gist.github.com/tommyettinger/46a874533244883189143505d203312c
 */
export class Random {
  private state: number;

  constructor(seed: number) {
    // Ensure seed is a 32-bit integer
    this.state = seed | 0;
  }

  /** Return a float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Return an integer in [min, max] (inclusive). */
  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  /** Return a float in [min, max). */
  nextFloat(min: number, max: number): number {
    return this.next() * (max - min) + min;
  }

  /** Return true with the given probability (0-1). */
  chance(probability: number): boolean {
    return this.next() < probability;
  }

  /** Pick a random element from an array. */
  pick<T>(array: readonly T[]): T {
    return array[Math.floor(this.next() * array.length)] as T;
  }
}
