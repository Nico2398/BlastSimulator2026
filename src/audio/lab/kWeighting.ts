// BlastSimulator2026 — K-weighting
// The two-stage pre-filter of ITU-R BS.1770 (a high shelf for the head, then a
// high-pass), with coefficients derived for any sample rate from the standard's
// analogue prototype. Loudness measured through it tracks how loud a mix feels.

interface BiquadCoefficients {
  readonly b0: number;
  readonly b1: number;
  readonly b2: number;
  readonly a1: number;
  readonly a2: number;
}

/** Head-related high shelf: about +4 dB above 1.7 kHz. */
function highShelf(sampleRate: number): BiquadCoefficients {
  const f0 = 1681.9744509555319;
  const gainDb = 3.99984385397;
  const q = 0.7071752369554193;
  const k = Math.tan((Math.PI * f0) / sampleRate);
  const vh = Math.pow(10, gainDb / 20);
  const vb = Math.pow(vh, 0.4996667741545416);
  const a0 = 1 + k / q + k * k;
  return {
    b0: (vh + (vb * k) / q + k * k) / a0,
    b1: (2 * (k * k - vh)) / a0,
    b2: (vh - (vb * k) / q + k * k) / a0,
    a1: (2 * (k * k - 1)) / a0,
    a2: (1 - k / q + k * k) / a0,
  };
}

/** Revised low-frequency B-curve: a second-order high-pass near 38 Hz. */
function highPass(sampleRate: number): BiquadCoefficients {
  const f0 = 38.13547087613982;
  const q = 0.5003270373253953;
  const k = Math.tan((Math.PI * f0) / sampleRate);
  const a0 = 1 + k / q + k * k;
  return { b0: 1, b1: -2, b2: 1, a1: (2 * (k * k - 1)) / a0, a2: (1 - k / q + k * k) / a0 };
}

/** Direct form I, double precision, one new array. */
function filter(input: ArrayLike<number>, c: BiquadCoefficients): Float64Array {
  const out = new Float64Array(input.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x0 = input[i] ?? 0;
    const y0 = c.b0 * x0 + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    out[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  return out;
}

/** The channel as the loudness meter hears it. */
export function kWeight(channel: Float32Array, sampleRate: number): Float64Array {
  return filter(filter(channel, highShelf(sampleRate)), highPass(sampleRate));
}
