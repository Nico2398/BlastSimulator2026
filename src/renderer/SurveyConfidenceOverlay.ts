// BlastSimulator2026 — Survey Confidence Overlay
// Colour-coded semi-transparent quads on terrain surfaces showing survey confidence.
// Fresh points = green (high confidence) → yellow → red (low confidence).
// Stale (expired) points = grey.

import * as THREE from 'three';
import { GroundTintLayer, FallbackSurfaceSampler, type GroundTintPatch, type SurfaceHeightSampler } from './GroundTint.js';

// ---------- Constants ----------

/** Opacity multiplier for stale (expired) survey points. */
const STALE_OPACITY = 0.6;

/** Z-fighting offset above terrain surface — this overlay's GroundTintLayer epsilon. */
const OVERLAY_Y_OFFSET = 0.05;

// ---------- Types ----------

/**
 * Data needed to render a single survey confidence point on the terrain surface.
 *
 * Each point corresponds to a surveyed column (x, z) with a confidence value
 * that degrades over time (stale = expired).
 */
export interface SurveyConfidencePoint {
  /** World-space X coordinate of the surveyed column. */
  x: number;
  /** World-space Z coordinate of the surveyed column. */
  z: number;
  /** Terrain surface Y at this column (for vertical placement). */
  surfaceY: number;
  /** Confidence value in [0, 1] — 1 = highest certainty. */
  confidence: number;
  /** Whether this survey point is still fresh (not stale). */
  fresh: boolean;
}

/** Parameters to configure the survey confidence overlay appearance. */
export interface SurveyConfidenceOverlayOptions {
  /** Array of confidence points across the terrain. */
  points: SurveyConfidencePoint[];
  /** Global opacity of the overlay in [0, 1]. */
  opacity: number;
}

// ---------- Color Mapping ----------

/**
 * Map a confidence value to a color for the overlay quad.
 *
 * - confidence = 1.0 → green   (0.0, 1.0, 0.0)
 * - confidence = 0.5 → yellow  (1.0, 1.0, 0.0)
 * - confidence = 0.0 → red     (1.0, 0.0, 0.0)
 */
export function confidenceToColor(confidence: number): THREE.Color {
  const t = Math.max(0, Math.min(1, confidence));
  if (t < 0.5) {
    // Red → Yellow: (1, 0, 0) → (1, 1, 0)
    const u = t / 0.5; // 0..1
    return new THREE.Color(1, u, 0);
  } else {
    // Yellow → Green: (1, 1, 0) → (0, 1, 0)
    const u = (t - 0.5) / 0.5; // 0..1
    return new THREE.Color(1 - u, 1, 0);
  }
}

// ---------- Overlay Class ----------

/**
 * Renders a colour-coded semi-transparent overlay on terrain surfaces showing
 * survey confidence levels. High confidence = green, low confidence = red.
 * Stale survey points are shown in grey.
 *
 * Create via {@link TerrainMesh.getSurveyOverlay}, then call `show()` to
 * activate or `hide()` to remove from view.
 */
export class SurveyConfidenceOverlay {
  private readonly layer: GroundTintLayer;
  /**
   * `smoothSurfaceYAt`, when given, is the ground-tint sampler (#1006) each
   * confidence quad conforms to instead of the flat, fixed-offset quad it
   * drew before. Optional so every pre-#1006 call site keeps compiling
   * unchanged; falling back to a per-point flat height read from each
   * point's own `surfaceY` field (registered for every corner of its cell)
   * so an un-migrated caller still sees a flat quad at the same height it
   * always did, not a bilinear blend against an unrelated neighbour.
   * Sampler-selection scaffolding is shared with BlastPlanOverlay via
   * FallbackSurfaceSampler.
   */
  private readonly fallbackSampler: FallbackSurfaceSampler;

  constructor(scene: THREE.Scene, smoothSurfaceYAt?: SurfaceHeightSampler) {
    this.fallbackSampler = new FallbackSurfaceSampler(smoothSurfaceYAt);
    this.layer = new GroundTintLayer(scene, this.fallbackSampler.sample, { epsilon: OVERLAY_Y_OFFSET, renderOrder: 100 });
    this.layer.setVisible(false);
  }

  /**
   * Display the confidence overlay with the given points.
   * Replaces any previously shown overlay data.
   */
  show(options: SurveyConfidenceOverlayOptions): void {
    const { points, opacity } = options;

    this.fallbackSampler.clearFlat();
    const patches: GroundTintPatch[] = points.map((pt): GroundTintPatch => {
      // Determine color: grey for stale, confidence-colour for fresh
      let color: THREE.Color;
      let quadOpacity: number;
      if (!pt.fresh) {
        color = new THREE.Color(0.5, 0.5, 0.5); // stale — grey
        quadOpacity = STALE_OPACITY;
      } else {
        color = confidenceToColor(pt.confidence);
        quadOpacity = 1.0;
      }

      if (this.fallbackSampler.usesFlatFallback) {
        // No sampler installed: pin every corner of this point's own cell to
        // its recorded surfaceY, so bilinearSurfaceHeight's per-corner reads
        // resolve to one flat height across the whole quad, exactly as the
        // old fixed-offset plane did.
        for (const [dx, dz] of [[0, 0], [1, 0], [1, 1], [0, 1]] as const) {
          this.fallbackSampler.setFlatCorner(pt.x + dx, pt.z + dz, pt.surfaceY);
        }
      }

      return {
        id: `${pt.x},${pt.z}`,
        shape: { kind: 'cell', x: pt.x, z: pt.z },
        color,
        opacity: opacity * quadOpacity,
      };
    });

    this.layer.replace(patches);
    this.layer.setVisible(true);
  }

  /** Hide the overlay without clearing data. */
  hide(): void {
    this.layer.setVisible(false);
  }

  /** Remove all overlay patches. */
  clear(): void {
    this.layer.clear();
    this.fallbackSampler.clearFlat();
  }

  /** Remove overlay and release all GPU resources. */
  dispose(): void {
    this.layer.dispose();
  }
}
