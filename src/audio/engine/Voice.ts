// BlastSimulator2026 — One running sound
// Owns the nodes of a playing voice (source -> optional filter/pan -> gain) and
// its budget ticket: fades and stops without clicks, and cleans up exactly once
// when the source ends, is stopped or is stolen.

import type { VoiceTicket } from './VoiceBudget.js';
import { rampTo } from './audioParams.js';
import { finiteOr } from './units.js';

interface VoiceParts {
  readonly source: AudioBufferSourceNode;
  /** The voice's own level control, last stage before the bus. */
  readonly gain: GainNode;
  /** Every node to disconnect once the voice is over (source and gain included). */
  readonly nodes: readonly AudioNode[];
  readonly ticket: VoiceTicket;
  /** Called once when the voice is over. */
  readonly onFinish: () => void;
}

export class Voice {
  private stopped = false;
  private finished = false;

  constructor(
    private readonly clock: { readonly currentTime: number },
    private readonly parts: VoiceParts,
    private readonly stopMarginS: number,
  ) {
    parts.source.onended = () => this.finish();
  }

  get gain(): AudioParam { return this.parts.gain.gain; }

  /** True until stop() or the end of the source. */
  get active(): boolean { return !this.stopped && !this.finished; }

  /** Fade out over `fadeS` (a non-finite or negative one counts as 0) and stop the source; the budget slot is free immediately. */
  stop(fadeS: number): void {
    if (!this.active) return;
    this.stopped = true;
    this.parts.ticket.release();
    const now = this.clock.currentTime;
    const fade = Math.max(finiteOr(fadeS, 0), 0);
    rampTo(this.parts.gain.gain, 0, now, fade);
    try {
      this.parts.source.stop(now + fade + this.stopMarginS);
    } catch {
      // never started or already stopped: nothing left to silence
    }
  }

  /** Release everything. Idempotent: `ended` and a stop may both arrive. */
  finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.parts.ticket.release();
    for (const node of this.parts.nodes) node.disconnect();
    this.parts.onFinish();
  }
}
