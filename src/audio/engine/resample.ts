// BlastSimulator2026 — Sample-rate conversion

/** Linear-interpolation resample. Plenty for a noise-like reverb impulse; not for tonal material. */
export function resampleLinear(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate || input.length === 0) return input;
  const length = Math.max(1, Math.round((input.length * toRate) / fromRate));
  const out = new Float32Array(length);
  const last = input.length - 1;
  for (let i = 0; i < length; i++) {
    const position = (i * fromRate) / toRate;
    const lower = Math.min(Math.floor(position), last);
    const upper = Math.min(lower + 1, last);
    const fraction = position - lower;
    out[i] = input[lower]! + (input[upper]! - input[lower]!) * fraction;
  }
  return out;
}
