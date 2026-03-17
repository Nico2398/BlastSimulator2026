// BlastSimulator2026 — Blast Plan Visualization Overlays
// When the player edits a blast plan, this module renders visual overlays:
//
//   1. Drill holes → cylinders/vertical lines at hole positions
//   2. Charge amounts → color-coded fills inside hole markers
//   3. Sequence delays → number labels above holes (sprite-based)
//   4. Energy heatmap → colored terrain-projected circles (tier 1 software)
//   5. Fragment size overlay → larger dots = coarser fragments (tier 2)
//   6. Projection arcs → parabolic lines (tier 3)
//   7. Vibration waves → concentric rings at blast origin (tier 4)
//
// All overlays are in a single THREE.Group that can be shown/hidden.

import * as THREE from 'three';
import type { DrillHole } from '../core/mining/DrillPlan.js';
import type { HoleCharge } from '../core/mining/ChargePlan.js';

// ---------- Config ----------

// Hole marker
const HOLE_RADIUS   = 0.3;    // cylinder radius
const HOLE_HEIGHT   = 0.6;    // above-surface marker height
const HOLE_COLOR    = 0xffffff;
const HOLE_SEGMENTS = 6;      // low-poly cylinder

// Charge color scale (empty → max charge)
const CHARGE_COLORS: readonly number[] = [
  0x888888, // no charge
  0x44aaff, // low
  0x44ff88, // medium-low
  0xffdd00, // medium
  0xff8800, // medium-high
  0xff2200, // max charge
];

// Sequence label
const LABEL_OFFSET = 1.2;     // Y above hole marker

// Heatmap
const HEATMAP_MAX_RADIUS = 8; // metres of energy influence
const HEATMAP_SEGMENTS   = 16;

// Fragment overlay (tier 2)
const FRAG_COLOR_FINE   = 0x22ff88;
const FRAG_COLOR_COARSE = 0xff4422;

// Vibration waves (tier 4)
const WAVE_RINGS = 4;
const WAVE_MAX_RADIUS = 20;

// ---------- Interfaces ----------

export interface HoleOverlayData {
  hole: DrillHole;
  charge?: HoleCharge;
  delayMs: number;
  /** Predicted average fragment size for this hole (cm) — for tier-2 overlay. */
  predictedFragSizeCm?: number;
  /** Predicted max projection speed (m/s) — for tier-3. */
  projectionSpeed?: number;
}

export interface BlastPlanOverlayOptions {
  /** Software tier owned: 0=none, 1=energy heatmap, 2=+frag size, 3=+projections, 4=+vibrations */
  softwareTier: number;
  /** Blast centroid position. */
  origin: THREE.Vector3;
  holes: HoleOverlayData[];
}

// ---------- Main class ----------

export class BlastPlanOverlay {
  private readonly scene: THREE.Scene;
  private readonly group = new THREE.Group();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.scene.add(this.group);
    this.group.visible = false;
  }

  /**
   * Show overlays for the current blast plan.
   * Call when the player opens the blast plan editor.
   */
  show(options: BlastPlanOverlayOptions): void {
    this.clear();
    this.group.visible = true;

    for (const hd of options.holes) {
      this.addHoleMarker(hd);
    }

    if (options.softwareTier >= 1) {
      this.addEnergyHeatmap(options);
    }
    if (options.softwareTier >= 2) {
      this.addFragSizeOverlay(options);
    }
    if (options.softwareTier >= 3) {
      this.addProjectionArcs(options);
    }
    if (options.softwareTier >= 4) {
      this.addVibrationWaves(options.origin);
    }
  }

  /** Hide all overlays (but keep them in memory for re-show). */
  hide(): void {
    this.group.visible = false;
  }

  /** Clear and remove all overlay geometry. */
  clear(): void {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      } else if (child instanceof THREE.Group) {
        disposeGroup(child);
      }
    }
  }

  dispose(): void {
    this.clear();
    this.scene.remove(this.group);
  }

  // ---------- Per-hole markers ----------

  private addHoleMarker(hd: HoleOverlayData): void {
    const { hole, charge, delayMs } = hd;

    // Outer ring (white cylinder outline)
    const ringGeo = new THREE.CylinderGeometry(HOLE_RADIUS, HOLE_RADIUS, HOLE_HEIGHT, HOLE_SEGMENTS, 1, true);
    const ringMat = new THREE.MeshBasicMaterial({ color: HOLE_COLOR, side: THREE.DoubleSide, wireframe: true });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.set(hole.x, HOLE_HEIGHT / 2, hole.z);
    this.group.add(ring);

    // Charge fill (solid inner cylinder)
    if (charge && charge.amountKg > 0) {
      const chargeLevel = Math.min(1, charge.amountKg / 200); // normalise to 200 kg max
      const colorIdx = Math.min(CHARGE_COLORS.length - 1, Math.floor(chargeLevel * (CHARGE_COLORS.length - 1)) + 1);
      const fillGeo = new THREE.CylinderGeometry(HOLE_RADIUS * 0.6, HOLE_RADIUS * 0.6, HOLE_HEIGHT * 0.8, HOLE_SEGMENTS);
      const fillMat = new THREE.MeshBasicMaterial({ color: CHARGE_COLORS[colorIdx], transparent: true, opacity: 0.8 });
      const fill = new THREE.Mesh(fillGeo, fillMat);
      fill.position.set(hole.x, HOLE_HEIGHT / 2, hole.z);
      this.group.add(fill);
    }

    // Depth indicator line (going down into terrain)
    const lineMat = new THREE.LineBasicMaterial({ color: 0x888888 });
    const lineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(hole.x, 0, hole.z),
      new THREE.Vector3(hole.x, -hole.depth, hole.z),
    ]);
    this.group.add(new THREE.Line(lineGeo, lineMat));

    // Delay label (sprite-like flat plane with delay number rendered via canvas)
    if (delayMs >= 0) {
      const label = this.makeDelayLabel(delayMs);
      label.position.set(hole.x, HOLE_HEIGHT + LABEL_OFFSET, hole.z);
      this.group.add(label);
    }
  }

  // ---------- Software overlays ----------

  /** Tier 1: energy heatmap — colored circles under each hole, radius = influence. */
  private addEnergyHeatmap(options: BlastPlanOverlayOptions): void {
    for (const hd of options.holes) {
      if (!hd.charge) continue;
      const energy = hd.charge.amountKg / 50; // rough scale
      const radius = Math.min(HEATMAP_MAX_RADIUS, 1 + energy * 3);
      const intensity = Math.min(1, energy / 4);

      // Color: green (low) → yellow → red (high)
      const r = Math.min(1, intensity * 2);
      const g = Math.min(1, 2 - intensity * 2);
      const color = new THREE.Color(r, g, 0);

      const geo = new THREE.CircleGeometry(radius, HEATMAP_SEGMENTS);
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const circle = new THREE.Mesh(geo, mat);
      circle.rotation.x = -Math.PI / 2;
      circle.position.set(hd.hole.x, 0.1, hd.hole.z); // just above terrain
      this.group.add(circle);
    }
  }

  /** Tier 2: fragment size overlay — dot color indicates coarse (red) vs fine (green). */
  private addFragSizeOverlay(options: BlastPlanOverlayOptions): void {
    for (const hd of options.holes) {
      if (!hd.predictedFragSizeCm) continue;
      // > 30cm = coarse (red), < 10cm = fine (green)
      const t = Math.min(1, Math.max(0, (hd.predictedFragSizeCm - 10) / 20));
      const color = new THREE.Color().lerpColors(
        new THREE.Color(FRAG_COLOR_FINE),
        new THREE.Color(FRAG_COLOR_COARSE),
        t,
      );
      const geo = new THREE.SphereGeometry(0.5, 6, 4);
      const mat = new THREE.MeshBasicMaterial({ color });
      const dot = new THREE.Mesh(geo, mat);
      dot.position.set(hd.hole.x, HOLE_HEIGHT + 0.6, hd.hole.z);
      this.group.add(dot);
    }
  }

  /** Tier 3: projection arcs — parabolic lines for high-projection-speed holes. */
  private addProjectionArcs(options: BlastPlanOverlayOptions): void {
    for (const hd of options.holes) {
      if (!hd.projectionSpeed || hd.projectionSpeed < 5) continue;
      const arc = this.makeProjectionArc(hd.hole.x, hd.hole.z, hd.projectionSpeed);
      this.group.add(arc);
    }
  }

  /** Tier 4: vibration wave rings around blast origin. */
  private addVibrationWaves(origin: THREE.Vector3): void {
    for (let i = 1; i <= WAVE_RINGS; i++) {
      const r = (i / WAVE_RINGS) * WAVE_MAX_RADIUS;
      const geo = new THREE.RingGeometry(r - 0.1, r + 0.1, 32);
      const mat = new THREE.MeshBasicMaterial({
        color: 0x44aaff,
        transparent: true,
        opacity: 0.5 * (1 - i / WAVE_RINGS),
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const ring = new THREE.Mesh(geo, mat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(origin.x, 0.15, origin.z);
      this.group.add(ring);
    }
  }

  // ---------- Helpers ----------

  private makeDelayLabel(delayMs: number): THREE.Mesh {
    // Flat box as a stand-in for a text label (canvas text labels require DOM)
    // Color-codes by delay bucket: 0ms=white, 50ms=cyan, 100ms=yellow, 500ms+=red
    const level = Math.min(4, Math.floor(delayMs / 100));
    const colors = [0xffffff, 0x44ffff, 0xffff44, 0xff8844, 0xff4444];
    const color = colors[level]!;
    const geo = new THREE.BoxGeometry(0.6, 0.3, 0.06);
    const mat = new THREE.MeshBasicMaterial({ color });
    return new THREE.Mesh(geo, mat);
  }

  private makeProjectionArc(
    hx: number, hz: number, speed: number,
  ): THREE.Line {
    // Simple parabola: y = v² sin(2θ)/g, θ=45°
    const g = 9.81;
    const range = (speed * speed) / g;
    const points: THREE.Vector3[] = [];
    const steps = 20;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const px = hx + Math.cos(0.8) * range * t;
      const py = range * 0.5 * t * (1 - t) * 2;
      const pz = hz + Math.sin(0.8) * range * t;
      points.push(new THREE.Vector3(px, py, pz));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({ color: 0xff6600 });
    return new THREE.Line(geo, mat);
  }
}

function disposeGroup(group: THREE.Group): void {
  for (const child of group.children) {
    if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
      child.geometry.dispose();
      (child.material as THREE.Material).dispose();
    }
  }
}
