// BlastSimulator2026 — Oscillator helpers
// Phase is accumulated from a per-sample frequency track, so pitch glides and vibrato
// never produce the clicks a naive sin(2*pi*f(t)*t) does.

/** One full turn in radians. */
export const TWO_PI = 2 * Math.PI;

/**
 * Phase in cycles at every sample for a frequency track in Hz. With `closeLoop` the track
 * is scaled by a hair so the total phase over the buffer is a whole number of cycles and
 * the waveform continues seamlessly when the buffer wraps.
 */
export function accumulatePhase(frequencyHz: ArrayLike<number>, sampleRate: number, closeLoop = false): Float64Array {
  const length = frequencyHz.length;
  const phase = new Float64Array(length);
  let total = 0;
  for (let i = 0; i < length; i++) total += frequencyHz[i] as number;
  total /= sampleRate;
  const scale = closeLoop ? Math.max(1, Math.round(total)) / total : 1;
  let acc = 0;
  for (let i = 0; i < length; i++) {
    phase[i] = acc;
    acc += ((frequencyHz[i] as number) * scale) / sampleRate;
  }
  return phase;
}

/** Sum of sin(k*theta)/k over harmonics 1..count (all or odd only), by the Chebyshev recurrence: one sin and cos per call. */
function harmonicSeries(phaseCycles: number, frequencyHz: number, sampleRate: number, maxHarmonics: number, oddOnly: boolean): number {
  const count = Math.min(maxHarmonics, Math.max(1, Math.floor((sampleRate * 0.5) / frequencyHz)));
  const theta = TWO_PI * phaseCycles;
  const twoCos = 2 * Math.cos(theta);
  let previous = 0;
  let current = Math.sin(theta);
  let sum = 0;
  for (let k = 1; k <= count; k++) {
    if (!oddOnly || k % 2 === 1) sum += current / k;
    const next = twoCos * current - previous;
    previous = current;
    current = next;
  }
  return sum;
}

/** Band-limited sawtooth by additive synthesis: harmonics 1..n at 1/k, stopping below Nyquist. */
export function sawAt(phaseCycles: number, frequencyHz: number, sampleRate: number, maxHarmonics: number): number {
  return harmonicSeries(phaseCycles, frequencyHz, sampleRate, maxHarmonics, false) * (2 / Math.PI);
}

/** Band-limited square wave: odd harmonics 1, 3, 5... at 1/k, the highest at most `maxHarmonics`. */
export function squareAt(phaseCycles: number, frequencyHz: number, sampleRate: number, maxHarmonics: number): number {
  return harmonicSeries(phaseCycles, frequencyHz, sampleRate, maxHarmonics, true) * (4 / Math.PI);
}

/** Sine with `cycles` whole periods over a buffer of `length` samples, so it wraps seamlessly. */
export function loopSine(index: number, length: number, cycles: number, phaseCycles = 0): number {
  return Math.sin(TWO_PI * ((cycles * index) / length + phaseCycles));
}
