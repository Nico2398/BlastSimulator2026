// BlastSimulator2026 — Deterministic hashing for sub-seed derivation
// Lets world generation split one level seed into many independent noise-
// field seeds, so adding, removing, or reordering a field never re-rolls the
// others (#458 T1.1).

/** 32-bit avalanche hash (lowbias32). Deterministic, fast, well distributed. */
export function hash32(x: number): number {
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}

/** Combine a seed with a string label into a derived sub-seed. */
export function subSeed(seed: number, label: string): number {
  let h = seed >>> 0;
  for (let i = 0; i < label.length; i++) h = hash32(h ^ label.charCodeAt(i));
  return h;
}

/** Seeded 2D cell hash for jittered-grid placement. Returns a float in [0, 1). */
export function cellRand(seed: number, cx: number, cz: number, salt: number): number {
  return hash32(seed ^ Math.imul(cx, 0x9e3779b1) ^ Math.imul(cz, 0x85ebca77) ^ salt) / 4294967296;
}
