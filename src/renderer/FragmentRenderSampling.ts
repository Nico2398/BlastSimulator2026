// BlastSimulator2026 — Fragment render sampling helpers
// Split out of FragmentMesh.ts (file-size convention) — pure, render-only
// helpers that pick which fragments to draw when a blast produces more than
// the instance budget, without touching gameplay-significant FragmentData.

/** Deterministic 0..1 hash of an integer seed — not gameplay randomness, just
 *  per-fragment render variety (kept stable across re-renders of the same id). */
export function hash01(seed: number): number {
  const h = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return h - Math.floor(h);
}

/**
 * Sample up to `max` entries spread across the whole array (stratified: one
 * pick per equal-sized stratum, at a hashed offset within it). Unlike
 * `slice(0, max)`, this keeps coverage of the whole array when it's larger
 * than `max` — required so a large blast's rendered fragments aren't all
 * drawn from a single corner of the raster scan that produced them.
 *
 * The per-stratum offset is hashed (not a fixed stride) because fragment ids
 * are sequential and bucketed into shape variants by `id % SHAPE_VARIANTS` —
 * a fixed stride that shares a factor with SHAPE_VARIANTS (e.g. stride 10
 * against 8 buckets) would only ever land on some buckets, silently
 * under-filling the rest.
 */
export function sampleEvenly<T>(items: readonly T[], max: number): T[] {
  if (items.length <= max) return items as T[];
  const step = items.length / max;
  const sampled: T[] = new Array(max);
  for (let i = 0; i < max; i++) {
    const idx = Math.min(items.length - 1, Math.floor(i * step + hash01(i) * step));
    sampled[i] = items[idx]!;
  }
  return sampled;
}
