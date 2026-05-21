// BlastSimulator2026 — Survey Confidence Overlay
// Colour-coded semi-transparent quads on terrain surfaces showing survey confidence.
// Fresh points = green (high confidence) → yellow → red (low confidence).
// Stale (expired) points = grey.

import * as THREE from 'three';

// ---------- Constants ----------

/** Size of each confidence indicator quad in world units. */
const CONFIDENCE_QUAD_SIZE = 1.8;

/** Opacity multiplier for stale (expired) survey points. */
const STALE_OPACITY = 0.25;

/** Z-fighting offset above terrain surface. */
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
  private readonly scene: THREE.Scene;
  private readonly group = new THREE.Group();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.scene.add(this.group);
    this.group.visible = false;
  }

  /**
   * Display the confidence overlay with the given points.
   * Replaces any previously shown overlay data.
   */
  show(options: SurveyConfidenceOverlayOptions): void {
    this.clear();
    this.group.visible = true;

    const { points, opacity } = options;

    for (const pt of points) {
      // Determine color: grey for stale, confidence-colour for fresh
      let color: THREE.Color;
      let quadOpacity: number;

      if (!pt.fresh) {
        // Stale survey point — grey
        color = new THREE.Color(0.5, 0.5, 0.5);
        quadOpacity = STALE_OPACITY;
      } else {
        // Fresh — colour-map confidence
        color = confidenceToColor(pt.confidence);
        quadOpacity = 1.0;
      }

      // Build a flat quad at the terrain surface, oriented horizontally
      const geo = new THREE.PlaneGeometry(CONFIDENCE_QUAD_SIZE, CONFIDENCE_QUAD_SIZE);
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: opacity * quadOpacity,
        depthWrite: false,
        side: THREE.DoubleSide,
      });

      const mesh = new THREE.Mesh(geo, mat);
      // Rotate quad to lie flat on the terrain surface (default PlaneGeometry faces +Z)
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(pt.x, pt.surfaceY + OVERLAY_Y_OFFSET, pt.z);
      mesh.renderOrder = 100; // render above terrain

      this.group.add(mesh);
    }
  }

  /** Hide the overlay without clearing data. */
  hide(): void {
    this.group.visible = false;
  }

  /** Remove all overlay meshes from the scene. */
  clear(): void {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        // Material can be Material or Material[] — handle both safely
        const mat = child.material;
        if (Array.isArray(mat)) {
          mat.forEach(m => m.dispose());
        } else {
          mat.dispose();
        }
      }
    }
  }

  /** Remove overlay and release all GPU resources. */
  dispose(): void {
    this.clear();
    this.scene.remove(this.group);
  }
}
