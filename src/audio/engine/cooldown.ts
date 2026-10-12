// BlastSimulator2026 — Cooldown gate
// Lets a key through at most once per cooldown. The one implementation behind
// both rate limiters: the voice budget (catalog cooldowns, milliseconds) and the
// director's cue gate (seconds). It is unit-agnostic: the clock and the cooldowns
// passed to it just have to share a unit, so no caller converts anything.

import { VOICE_CONFIG } from '../../core/config/audio/engine.js';

export class CooldownGate {
  private readonly until = new Map<string, number>();

  /**
   * @param now clock in the unit the cooldowns use
   * @param sweepThreshold expired entries are dropped once the table holds more keys than this
   */
  constructor(private readonly now: () => number, private readonly sweepThreshold: number = VOICE_CONFIG.cooldownSweepThreshold) {}

  /** True when `key` is off cooldown; does not start one. */
  isReady(key: string): boolean {
    const until = this.until.get(key);
    return until === undefined || this.now() >= until;
  }

  /** Put `key` on cooldown for `cooldown` from now, whatever state it was in. */
  start(key: string, cooldown: number): void {
    const now = this.now();
    this.until.set(key, now + cooldown);
    if (this.until.size > this.sweepThreshold) this.sweep(now);
  }

  /** True (and the key goes on cooldown) when `key` is off cooldown. */
  tryPass(key: string, cooldown: number): boolean {
    if (!this.isReady(key)) return false;
    this.start(key, cooldown);
    return true;
  }

  clear(): void {
    this.until.clear();
  }

  private sweep(now: number): void {
    for (const [key, expiry] of this.until) if (expiry <= now) this.until.delete(key);
  }
}
