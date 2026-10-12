// BlastSimulator2026 — RBJ biquad filter
// A transposed direct form II biquad whose cutoff can move every sample: the
// coefficients are refreshed every `filterControlInterval` samples, which keeps a
// sweeping filter cheap and click-free.

import { SYNTH_LEVELS } from '../../core/config/audio/synth.js';

export type BiquadKind = 'lowpass' | 'highpass' | 'bandpass';

export class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private z1 = 0;
  private z2 = 0;
  private untilUpdate = 0;

  constructor(
    private readonly kind: BiquadKind,
    private readonly sampleRate: number,
    private readonly defaultHz: number,
    private readonly defaultQ = Math.SQRT1_2,
  ) {}

  /** Filter one sample; pass `hz`/`q` to modulate (applied at the next control tick). */
  tick(x: number, hz: number = this.defaultHz, q: number = this.defaultQ): number {
    if (this.untilUpdate === 0) {
      this.update(hz, q);
      this.untilUpdate = SYNTH_LEVELS.filterControlInterval;
    }
    this.untilUpdate--;
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }

  private update(hz: number, q: number): void {
    const w0 = (2 * Math.PI * Math.min(Math.max(hz, 10), this.sampleRate * 0.45)) / this.sampleRate;
    const cos = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * q);
    const a0 = 1 + alpha;
    switch (this.kind) {
      case 'lowpass':
        this.b0 = (1 - cos) / 2 / a0;
        this.b1 = (1 - cos) / a0;
        this.b2 = this.b0;
        break;
      case 'highpass':
        this.b0 = (1 + cos) / 2 / a0;
        this.b1 = -(1 + cos) / a0;
        this.b2 = this.b0;
        break;
      case 'bandpass':
        this.b0 = alpha / a0;
        this.b1 = 0;
        this.b2 = -alpha / a0;
        break;
    }
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
  }
}

/** Run a whole buffer through one fixed filter. */
export function filterBuffer(input: Float32Array, kind: BiquadKind, sampleRate: number, hz: number, q = Math.SQRT1_2): Float32Array {
  const filter = new Biquad(kind, sampleRate, hz, q);
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) out[i] = filter.tick(input[i] as number);
  return out;
}
