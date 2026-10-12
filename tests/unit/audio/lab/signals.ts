// BlastSimulator2026 — Synthetic signals for the lab tests
// Known-level signals the statistics are checked against.

/** A sine of peak `amplitude`, `seconds` long. */
export function sine(frequencyHz: number, amplitude: number, seconds: number, sampleRate: number): Float32Array {
  const out = new Float32Array(Math.round(seconds * sampleRate));
  for (let i = 0; i < out.length; i++) out[i] = amplitude * Math.sin((2 * Math.PI * frequencyHz * i) / sampleRate);
  return out;
}

/** Full-scale-ish square wave: every sample is +/-amplitude. */
export function square(frequencyHz: number, amplitude: number, seconds: number, sampleRate: number): Float32Array {
  const out = new Float32Array(Math.round(seconds * sampleRate));
  for (let i = 0; i < out.length; i++) out[i] = Math.sin((2 * Math.PI * frequencyHz * i) / sampleRate) >= 0 ? amplitude : -amplitude;
  return out;
}

export function silence(seconds: number, sampleRate: number): Float32Array {
  return new Float32Array(Math.round(seconds * sampleRate));
}

/** Concatenate signals one after another. */
export function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export const dbToAmplitude = (db: number): number => Math.pow(10, db / 20);
