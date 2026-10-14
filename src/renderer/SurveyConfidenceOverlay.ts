// BlastSimulator2026 — Survey Confidence Overlay
// Colour-coded semi-transparent quads on terrain surfaces showing survey confidence.
// Fresh points are coloured by the estimated ore value of their column on a fixed
// log scale (red = lean → yellow → green = rich); a point without a value falls
// back to its confidence colour. Survey confidence modulates quad opacity.
// Stale (expired) points = grey.

import * as THREE from 'three';
import { SURVEY_OVERLAY_VALUE_FLOOR, SURVEY_OVERLAY_VALUE_CEIL, SURVEY_OVERLAY_QUAD_OPACITY_BASE } from '../core/config/balance.js';
import { GroundTintLayer, FallbackSurfaceSampler, type GroundTintPatch, type SurfaceHeightSampler } from './GroundTint.js';

// ---------- Constants ----------

/** Opacity multiplier for stale (expired) survey points. */
const STALE_OPACITY = 0.6;

/**
 * Z-fighting offset above terrain surface — this overlay's GroundTintLayer
 * epsilon. A flat-ground baseline only: GroundTintLayer scales it up by the
 * local terrain slope (`slopeScaledEpsilon`) so steep, blast-carved faces
 * still clear the terrain mesh.
 */
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
  /** Estimated ore value ($ per m³) of this column, for the value overlay mode. */
  valuePerM3?: number;
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
  return rampColor(confidence);
}

/** Red (0) → yellow (0.5) → green (1) ramp; t is clamped to [0, 1]. */
function rampColor(t: number): THREE.Color {
  const c = Math.max(0, Math.min(1, t));
  return c < 0.5 ? new THREE.Color(1, c / 0.5, 0) : new THREE.Color(1 - (c - 0.5) / 0.5, 1, 0);
}

/**
 * Map an estimated ore value ($ per m³) to the same red → yellow → green ramp
 * on a log scale between SURVEY_OVERLAY_VALUE_FLOOR and _CEIL. Clamped; NaN and
 * negatives read as the floor.
 */
export function valueToColor(valuePerM3: number): THREE.Color {
  if (!(valuePerM3 > SURVEY_OVERLAY_VALUE_FLOOR)) return rampColor(0);
  const span = Math.log(SURVEY_OVERLAY_VALUE_CEIL / SURVEY_OVERLAY_VALUE_FLOOR);
  return rampColor(Math.log(valuePerM3 / SURVEY_OVERLAY_VALUE_FLOOR) / span);
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
      // Determine color: grey for stale, value colour (or confidence fallback) for fresh
      let color: THREE.Color;
      let quadOpacity: number;
      if (!pt.fresh) {
        color = new THREE.Color(0.5, 0.5, 0.5); // stale — grey
        quadOpacity = STALE_OPACITY;
      } else {
        color = pt.valuePerM3 !== undefined ? valueToColor(pt.valuePerM3) : confidenceToColor(pt.confidence);
        quadOpacity = SURVEY_OVERLAY_QUAD_OPACITY_BASE + (1 - SURVEY_OVERLAY_QUAD_OPACITY_BASE) * Math.max(0, Math.min(1, pt.confidence));
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
