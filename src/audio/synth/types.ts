// BlastSimulator2026 — Synth contract
// What a generative sound looks like to the engine: planar PCM, rendered once at
// startup from a deterministic recipe. No Web Audio in here, so recipes run and
// are tested in plain Node.

/** Planar float PCM: one Float32Array per channel, all the same length. */
export interface RenderedAudio {
  readonly sampleRate: number;
  readonly channels: readonly Float32Array[];
}

export interface SynthRecipe {
  /** How many distinct renderings exist (e.g. three different thunder claps). */
  readonly variants: number;
  /** True when the buffer must loop with no audible seam (first sample continues the last). */
  readonly loop: boolean;
  /** Deterministic: the same variant always renders the same samples. */
  render(variant: number): RenderedAudio;
}
