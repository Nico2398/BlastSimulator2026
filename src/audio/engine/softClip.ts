// BlastSimulator2026 — Safety soft clipper transfer curve
// The shape of the WaveShaperNode at the very end of the master chain. It is
// the identity up to a knee, then a tanh shoulder bends toward a ceiling it
// never reaches. Odd-symmetric, monotonic, and its slope is 1 at the knee, so
// the join is smooth: the node does nothing to a mix that stays below the knee.
//
// A WaveShaperNode clamps its input to [-1, 1], so the output never exceeds
// `softClip(1, ...)`, a little under the ceiling.

/** Output for one input sample. Identity up to `knee`, tanh shoulder above it, always below `ceiling`. */
export function softClip(x: number, knee: number, ceiling: number): number {
  const magnitude = Math.abs(x);
  if (magnitude <= knee) return x;
  const headroom = ceiling - knee;
  const shaped = knee + headroom * Math.tanh((magnitude - knee) / headroom);
  return x < 0 ? -shaped : shaped;
}

/**
 * The curve for `WaveShaperNode.curve`: `size` samples spread evenly over the
 * input range [-1, 1]. An odd size puts a sample exactly at 0.
 */
export function buildSoftClipCurve(size: number, knee: number, ceiling: number): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(size);
  const mid = (size - 1) / 2;
  for (let i = 0; i < size; i++) curve[i] = softClip((i - mid) / mid, knee, ceiling);
  return curve;
}
