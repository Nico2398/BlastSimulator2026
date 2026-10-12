// BlastSimulator2026 — Bed feed
// The one rule for driving a loop bed from a director: send a new level only when it moved by
// more than an epsilon (a bed that wobbles by a hair every frame would restart its ramp every
// frame), and always send the final zero (a bed that stops 0.01 short of silence would hiss
// for ever). The handle may be given lazily, so a bed that never sounds is never created.

import type { LoopHandle } from '../AudioPlayer.js';

export class BedFeed {
  private handle: LoopHandle | null = null;
  private sent = 0;

  constructor(
    private readonly source: LoopHandle | (() => LoopHandle),
    private readonly epsilon: number,
  ) {}

  /** Send `level` unless it is within epsilon of what the bed already has; silence is always sent. */
  set(level: number, rampS: number): void {
    const change = Math.abs(level - this.sent);
    const reachedSilence = level === 0 && change > 0;
    if (change === 0 || (change < this.epsilon && !reachedSilence)) return;
    this.sent = level;
    this.handle ??= typeof this.source === 'function' ? this.source() : this.source;
    this.handle.setLevel(level, rampS);
  }
}
