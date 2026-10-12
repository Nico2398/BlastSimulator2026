// BlastSimulator2026 — Real-time rate limiting for audio cues
// A cooldown gate (per key) and a token bucket (shared budget), both driven by
// the director's real-time clock, never by game ticks. The gate is the engine's:
// the voice budget runs the same one, on milliseconds.

export { CooldownGate } from '../engine/cooldown.js';

/** A budget that refills over time and starts full. */
export class TokenBucket {
  private tokens: number;

  constructor(private readonly capacity: number, private readonly refillPerS: number) {
    this.tokens = capacity;
  }

  refill(dtS: number): void {
    this.tokens = Math.min(this.capacity, this.tokens + dtS * this.refillPerS);
  }

  canTake(): boolean {
    return this.tokens >= 1;
  }

  take(): void {
    this.tokens = Math.max(0, this.tokens - 1);
  }

  reset(): void {
    this.tokens = this.capacity;
  }
}
