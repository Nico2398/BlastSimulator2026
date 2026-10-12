// BlastSimulator2026 — Downmix
// Folds planar channels into one by averaging, the way a mono speaker would sum them.

export function downmixToMono(channels: readonly Float32Array[]): Float32Array {
  const first = channels[0];
  if (!first) return new Float32Array(0);
  const mono = new Float32Array(first.length);
  for (let i = 0; i < mono.length; i++) {
    let sum = 0;
    for (const channel of channels) sum += channel[i]!;
    mono[i] = sum / channels.length;
  }
  return mono;
}
