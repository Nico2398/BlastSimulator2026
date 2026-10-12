// BlastSimulator2026 — Real-time rate limiting for audio cues
// A cooldown gate (per key) and a token bucket (shared budget), both driven by
// the director's real-time clock, never by game ticks.

import { DIRECTOR_CONFIG } from '../../core/config/audio/game.js';

/** Lets a key through at most once per cooldown. */
export class CooldownGate {
  private readonly until = new Map<string, number>();

  constructor(private readonly now: () => number) {}

  /** True when `key` is off cooldown; does not start one. */
  isReady(key: string): boolean {
    const until = this.until.get(key);
    return until === undefined || this.now() >= until;
  }

  /** True (and the key goes on cooldown) when `key` is off cooldown. */
  tryPass(key: string, cooldownS: number): boolean {
    const now = this.now();
    if (!this.isReady(key)) return false;
    this.until.set(key, now + cooldownS);
    if (this.until.size > DIRECTOR_CONFIG.cooldownSweepThreshold) this.sweep(now);
    return true;
  }

  clear(): void {
    this.until.clear();
  }

  private sweep(now: number): void {
    for (const [key, expiry] of this.until) if (expiry <= now) this.until.delete(key);
  }
}

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
