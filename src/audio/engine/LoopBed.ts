// BlastSimulator2026 — Looped bed handle
// A reusable LoopHandle: the underlying voice only exists while the level is
// above zero. Rising from silence starts a voice, falling to zero fades it out
// and lets it go, so a muted bed costs nothing.

import type { LoopHandle } from '../AudioPlayer.js';
import { rampTo } from './audioParams.js';
import { clamp } from './units.js';
import type { Voice } from './Voice.js';

interface LoopBedOptions {
  readonly clock: { readonly currentTime: number };
  /** Start a fresh silent voice, or null when it cannot start (assets missing, budget full). */
  readonly start: () => Voice | null;
  /** Catalog trim as a linear factor. */
  readonly trim: number;
  readonly defaultRampS: number;
  readonly minFadeOutS: number;
}

export class LoopBed implements LoopHandle {
  private voice: Voice | null = null;
  private level = 0;

  constructor(private readonly options: LoopBedOptions) {}

  setLevel(level: number, rampS = this.options.defaultRampS): void {
    this.level = clamp(Number.isFinite(level) ? level : 0, 0, 1);
    this.apply(rampS);
  }

  stop(fadeS = this.options.defaultRampS): void {
    this.setLevel(0, fadeS);
  }

  /** Retry a start that was refused earlier (assets arrived, a slot freed). */
  refresh(): void {
    if (this.level > 0 && !this.voice?.active) this.apply(this.options.defaultRampS);
  }

  private apply(rampS: number): void {
    const now = this.options.clock.currentTime;
    if (this.level <= 0) {
      if (this.voice?.active) this.voice.stop(Math.max(rampS, this.options.minFadeOutS));
      this.voice = null;
      return;
    }
    if (!this.voice?.active) this.voice = this.options.start();
    if (this.voice) rampTo(this.voice.gain, this.level * this.options.trim, now, Math.max(rampS, 0));
  }
}
