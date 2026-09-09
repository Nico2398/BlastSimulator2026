// BlastSimulator2026 — Ground Tint shared unit (#1006)
// One conforming, sloped-terrain-following ground overlay primitive shared by
// every renderer call site that paints a tint/ring on the ground: survey
// confidence, selection/pinned-region/blocked-tile, survey radius ring, and
// blast energy heatmap. Each previously built its own flat, axis-aligned
// quad/circle lifted by a fixed Y offset — this samples the same smoothed
// marching-cubes surface height the terrain mesh renders, at each patch's own
// footprint, so painted colour follows the slope instead of floating above it.

import * as THREE from 'three';

/** A callback answering the smoothed (marching-cubes) terrain surface height at a world (x, z) column. */
export type SurfaceHeightSampler = (x: number, z: number) => number;

/**
 * Bilinear blend of the four grid-corner heights around (x, z), using
 * `cornerSampler` for the corner values — a conforming ground tint's shape
 * (cell or disc) samples through this at each of its own vertices rather
 * than the single flat height its corner cell would otherwise supply.
 */
export function bilinearSurfaceHeight(_cornerSampler: SurfaceHeightSampler, _x: number, _z: number): number {
  throw new Error('not implemented');
}

/** One ground-tint patch's footprint: a single grid cell, or a disc (survey radius rings, blast energy heatmap). */
export type GroundTintShape =
  | { kind: 'cell'; x: number; z: number }
  | { kind: 'disc'; cx: number; cz: number; radius: number; segments?: number };

/** One colour-and-opacity patch a GroundTintLayer draws, conforming to the terrain surface under its shape. */
export interface GroundTintPatch {
  id: string;
  shape: GroundTintShape;
  color: THREE.Color | number;
  opacity: number;
}

/** Metres above the sampled surface a ground tint patch is drawn, to avoid z-fighting with the terrain mesh. */
export const GROUND_TINT_Y_EPSILON = 0.03;

/**
 * Shared ground-tint renderer: draws colour patches that conform to the
 * sloped marching-cubes surface instead of floating as flat axis-aligned
 * plates. Replaces the ad hoc quad/circle/ring geometry every overlay
 * (survey confidence, selection/pinned-region/blocked-tile, survey radius
 * ring, blast energy heatmap) previously built for itself.
 */
export class GroundTintLayer {
  constructor(
    _scene: THREE.Scene,
    _sampler: SurfaceHeightSampler,
    _opts?: { epsilon?: number; renderOrder?: number },
  ) {
    // TODO: implement
  }

  /** Replace every currently-drawn patch with `patches`. */
  replace(_patches: GroundTintPatch[]): void {
    // TODO: implement
  }

  /** Add (or, by id, replace) patches without touching the rest. */
  add(_patches: GroundTintPatch[]): void {
    // TODO: implement
  }

  /** Remove patches by id. */
  remove(_ids: string[]): void {
    // TODO: implement
  }

  /** Remove every patch. */
  clear(): void {
    // TODO: implement
  }

  /** Remove every patch and release GPU resources. */
  dispose(): void {
    // TODO: implement
  }

  get patchCount(): number {
    throw new Error('not implemented');
  }
}

/**
 * A ring of line segments following the terrain surface around (cx, cz) at
 * the given radius — the conforming replacement for a flat circle geometry
 * lifted by a fixed Y offset (survey radius ring).
 */
export function buildConformingRing(
  _sampler: SurfaceHeightSampler,
  _cx: number,
  _cz: number,
  _radius: number,
  _segments: number,
  _color: number,
  _opacity: number,
): THREE.LineLoop {
  throw new Error('not implemented');
}
