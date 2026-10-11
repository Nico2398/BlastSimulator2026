// BlastSimulator2026 — Ridged height field and ladder chunks for landscape seam tests.
//
// Shared by LandscapeSeam.test.ts (a join built by hand) and
// LandscapeChunkStreamer.test.ts (a join built by the streamer, #1655). A flat
// field hides a missing chord completely — every chunk at every step reads the
// same height — so both suites sample this deliberately ridged one instead.

import { NODES_PER_CHUNK, type LandscapeChunk, type LandscapeChunkId } from '../../src/core/world/LandscapeMap.js';

/**
 * Ridged and curved at 3-6 m wavelengths — shorter than a 4m coarse step, so
 * no chord through it is exact and any node that takes one is measurably off.
 */
export function heightField(x: number, z: number): number {
  return 11
    + 1.8 * Math.sin(x * 0.9)
    + 1.4 * Math.cos(z * 1.1)
    + 0.7 * Math.sin((x + z) * 1.7)
    + 0.06 * x - 0.04 * z;
}

/** One ladder chunk at `step`, its lattice sampled from `heightField` starting at (originX, originZ). */
export function makeLadderChunk(
  id: LandscapeChunkId, originX: number, originZ: number, step: number, compId: number,
): LandscapeChunk {
  const n = NODES_PER_CHUNK;
  const heights = new Float32Array(n * n);
  const biomeIds = new Uint8Array(n * n);
  const surfCompIds = new Uint16Array(n * n).fill(compId);
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) heights[row * n + col] = heightField(originX + col * step, originZ + row * step);
  }
  return { id, step, originX, originZ, heights, biomeIds, surfCompIds };
}
