// BlastSimulator2026 — Fragment render sampling helpers
// Split out of FragmentMesh.ts (file-size convention) — these are pure,
// render-only helpers that pick which fragments to draw and where to draw
// them, without touching gameplay-significant FragmentData.

import type { FragmentData } from '../core/mining/BlastExecution.js';
import {
  FRAGMENT_RENDER_JITTER_RADIUS,
  FRAGMENT_PROJECTION_RENDER_DISTANCE_SCALE,
  FRAGMENT_PROJECTION_RENDER_MAX_DISTANCE,
} from '../core/config/balance.js';

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

/**
 * Render-only (x, z) offset for a fragment's InstancedMesh transform.
 * Does not touch `FragmentData.position`, which gameplay logic (debris hauler
 * travel, projection impact damage) still reads unmodified.
 */
export function computeRenderScatter(frag: FragmentData): { x: number; z: number } {
  const jx = (hash01(frag.id * 2 + 1) - 0.5) * 2 * FRAGMENT_RENDER_JITTER_RADIUS;
  const jz = (hash01(frag.id * 2 + 2) - 0.5) * 2 * FRAGMENT_RENDER_JITTER_RADIUS;
  let x = frag.position.x + jx;
  let z = frag.position.z + jz;

  if (frag.isProjection) {
    const vx = frag.initialVelocity.x;
    const vz = frag.initialVelocity.z;
    const horizSpeed = Math.hypot(vx, vz);
    if (horizSpeed > 1e-6) {
      const dist = Math.min(
        FRAGMENT_PROJECTION_RENDER_MAX_DISTANCE,
        horizSpeed * FRAGMENT_PROJECTION_RENDER_DISTANCE_SCALE,
      );
      x += (vx / horizSpeed) * dist;
      z += (vz / horizSpeed) * dist;
    }
  }

  return { x, z };
}
