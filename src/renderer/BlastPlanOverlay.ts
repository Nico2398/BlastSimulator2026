// BlastSimulator2026 — Blast Plan Visualization Overlays
// Renders drill holes (X-ray view), charge fills, delay labels, and software-tier overlays.

import * as THREE from 'three';
import type { DrillHole } from '../core/mining/DrillPlan.js';
import { holeNumericId } from '../core/mining/DrillPlan.js';
import type { HoleCharge } from '../core/mining/ChargePlan.js';
import { tagPickable } from './Pickable.js';

// ---------- Config ----------

// Hole marker
const HOLE_RADIUS   = 0.6;    // cylinder radius (visible at default zoom)
const HOLE_HEIGHT   = 1.0;    // above-surface marker cap height
const HOLE_COLOR    = 0xffffff;
const HOLE_SEGMENTS = 8;      // low-poly cylinder

// Ordered-but-undrilled ghost marker (#553) — a single translucent, dashed-look
// wireframe stand-in instead of the full drilled-hole rendering (shaft fill,
// charge indicators, bottom disc): there is nothing to show yet.
const GHOST_HOLE_COLOR = 0x8899aa;
const GHOST_HOLE_OPACITY = 0.35;

// Ordered-but-not-loaded charge marker (#554) — mirrors the ghost-hole
// treatment above for a charge order still queued as a `charge_hole` action.
export const CHARGE_ORDERED_COLOR = 0xffaa00; // matches ChargeHoleList's own amber "ordered" row (var(--bsx-amber))
export const CHARGE_ORDERED_OPACITY = 0.4;

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
const LABEL_OFFSET = 2.5;     // Y above hole marker

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
  /** True once this hole's `drill_hole` action has completed and it lives in `state.drillHoles`; false while still in `state.plannedDrillHoles` awaiting its turn (#553). */
  drilled: boolean;
  /** Terrain surface Y at this hole's (x,z) position. Markers are placed relative to this. */
  surfaceY: number;
  /** Predicted average fragment size for this hole (cm) — for tier-2 overlay. */
  predictedFragSizeCm?: number;
  /** Predicted max projection speed (m/s) — for tier-3. */
  projectionSpeed?: number;
  /** True while this hole's charge order is queued/in-progress as a `charge_hole` action, not yet landed in `charge` (#554). */
  chargeOrdered?: boolean;
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
  /** Surface-anchor position per hole (numeric id, see holeNumericId), for scene-picking's entityWorldPosition. */
  private readonly holePositions = new Map<number, THREE.Vector3>();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.scene.add(this.group);
    this.group.visible = false;
  }

  /**
   * Hole marker meshes raycastable for scene picking (P4). Empty while the
   * overlay is hidden — Three.js's raycaster only checks an object's own
   * `.visible`, not an ancestor's, so a hidden-but-uncleared group would
   * otherwise leave stale holes clickable.
   */
  pickables(): THREE.Object3D[] {
    if (!this.group.visible) return [];
    return this.group.children.filter(c => c.userData['entityKind'] === 'hole');
  }

  /** World-space surface position of a hole by its numeric pick id, or null if not currently shown. */
  getHolePosition(numericId: number): THREE.Vector3 | null {
    return this.holePositions.get(numericId)?.clone() ?? null;
  }

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

  hide(): void {
    this.group.visible = false;
  }

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
    this.holePositions.clear();
  }

  dispose(): void {
    this.clear();
    this.scene.remove(this.group);
  }

  // ---------- Per-hole markers ----------

  private addHoleMarker(hd: HoleOverlayData): void {
    const { hole, delayMs, surfaceY: base } = hd;
    const x = hole.x, z = hole.z, depth = hole.depth;
    const pickId = holeNumericId(hole.id);
    this.holePositions.set(pickId, new THREE.Vector3(x, base, z));

    if (!hd.drilled) {
      this.addGhostHoleMarker(hd, pickId);
      return;
    }

    const { charge } = hd;

    // Surface cap — wireframe ring at terrain surface (X-ray: depthTest off)
    this.addXrayMesh(
      new THREE.CylinderGeometry(HOLE_RADIUS, HOLE_RADIUS, HOLE_HEIGHT, HOLE_SEGMENTS, 1, true),
      { color: HOLE_COLOR, wireframe: true, side: THREE.DoubleSide }, 10, x, base + HOLE_HEIGHT / 2, z, pickId,
    );
    // Underground shaft — translucent cylinder showing full depth
    this.addXrayMesh(
      new THREE.CylinderGeometry(HOLE_RADIUS * 0.5, HOLE_RADIUS * 0.5, depth, HOLE_SEGMENTS),
      { color: 0xaaaaff, transparent: true, opacity: 0.35, side: THREE.DoubleSide }, 9, x, base - depth / 2, z, pickId,
    );
    // Shaft wireframe outline
    this.addXrayMesh(
      new THREE.CylinderGeometry(HOLE_RADIUS * 0.52, HOLE_RADIUS * 0.52, depth, HOLE_SEGMENTS, 1, true),
      { color: 0x6666cc, wireframe: true }, 11, x, base - depth / 2, z, pickId,
    );
    // Bottom disc at hole base
    const bottom = this.addXrayMesh(
      new THREE.CircleGeometry(HOLE_RADIUS * 0.5, HOLE_SEGMENTS),
      { color: 0xff6644, side: THREE.DoubleSide }, 12, x, base - depth, z, pickId,
    );
    bottom.rotation.x = -Math.PI / 2;

    // Charge order still loading (#554) — a distinct low-opacity fill so an
    // ordered-but-unloaded hole reads differently from both an uncharged hole
    // (nothing at all) and a landed charge's amount-scaled fill below.
    if (!charge && hd.chargeOrdered) {
      this.addXrayMesh(
        new THREE.CylinderGeometry(HOLE_RADIUS * 0.4, HOLE_RADIUS * 0.4, depth * 0.3, HOLE_SEGMENTS),
        { color: CHARGE_ORDERED_COLOR, transparent: true, opacity: CHARGE_ORDERED_OPACITY }, 13, x, base - depth + depth * 0.15, z, pickId,
      );
    }

    // Charge fill inside shaft + surface indicator
    if (charge && charge.amountKg > 0) {
      // Scale charge level against a realistic max (10kg) instead of 200kg
      const lvl = Math.min(1, charge.amountKg / 10);
      const ci = Math.min(CHARGE_COLORS.length - 1, Math.floor(lvl * (CHARGE_COLORS.length - 1)) + 1);
      const fillH = depth * Math.min(0.9, lvl + 0.2);
      this.addXrayMesh(
        new THREE.CylinderGeometry(HOLE_RADIUS * 0.4, HOLE_RADIUS * 0.4, fillH, HOLE_SEGMENTS),
        { color: CHARGE_COLORS[ci], transparent: true, opacity: 0.85 }, 13, x, base - depth + fillH / 2, z, pickId,
      );
      this.addXrayMesh(
        new THREE.CylinderGeometry(HOLE_RADIUS * 0.7, HOLE_RADIUS * 0.7, HOLE_HEIGHT * 0.9, HOLE_SEGMENTS),
        { color: CHARGE_COLORS[ci], transparent: true, opacity: 0.8 }, 14, x, base + HOLE_HEIGHT / 2, z, pickId,
      );
    }

    // Delay label above hole
    if (delayMs >= 0) {
      const label = this.makeDelayLabel(delayMs);
      label.renderOrder = 15;
      label.position.set(x, base + HOLE_HEIGHT + LABEL_OFFSET, z);
      tagPickable(label, 'hole', pickId);
      this.group.add(label);
    }
  }

  /**
   * Ghost marker for an ordered-but-undrilled hole (#553) — a single
   * low-opacity wireframe surface ring, no shaft, no charge fill, no bottom
   * disc: none of that exists yet for a hole still waiting on its
   * `drill_hole` action. Still pickable/tagged like a drilled hole's marker.
   */
  private addGhostHoleMarker(hd: HoleOverlayData, pickId: number): void {
    const { hole, surfaceY: base } = hd;
    this.addXrayMesh(
      new THREE.CylinderGeometry(HOLE_RADIUS, HOLE_RADIUS, HOLE_HEIGHT, HOLE_SEGMENTS, 1, true),
      { color: GHOST_HOLE_COLOR, wireframe: true, transparent: true, opacity: GHOST_HOLE_OPACITY, side: THREE.DoubleSide },
      10, hole.x, base + HOLE_HEIGHT / 2, hole.z, pickId,
    );
  }

  /** Helper: create a mesh with depthTest:false (X-ray) and add to group. `pickId`, when given, tags the mesh as that hole for scene picking. */
  private addXrayMesh(
    geo: THREE.BufferGeometry, matOpts: THREE.MeshBasicMaterialParameters,
    order: number, x: number, y: number, z: number, pickId?: number,
  ): THREE.Mesh {
    const mat = new THREE.MeshBasicMaterial({ ...matOpts, depthTest: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = order;
    mesh.position.set(x, y, z);
    if (pickId !== undefined) tagPickable(mesh, 'hole', pickId);
    this.group.add(mesh);
    return mesh;
  }

  // ---------- Software overlays ----------

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
      circle.position.set(hd.hole.x, hd.surfaceY + 0.1, hd.hole.z); // just above terrain surface
      this.group.add(circle);
    }
  }

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
      dot.renderOrder = 16;
      dot.position.set(hd.hole.x, hd.surfaceY + HOLE_HEIGHT + 0.6, hd.hole.z);
      this.group.add(dot);
    }
  }

  private addProjectionArcs(options: BlastPlanOverlayOptions): void {
    for (const hd of options.holes) {
      if (!hd.projectionSpeed || hd.projectionSpeed < 5) continue;
      const arc = this.makeProjectionArc(hd.hole.x, hd.hole.z, hd.surfaceY, hd.projectionSpeed);
      this.group.add(arc);
    }
  }

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
      // Sit just above the blast-site surface, not a hardcoded near-zero world Y
      // — mine sites rarely sit near y=0, so a fixed offset rendered underground.
      ring.position.set(origin.x, origin.y + 0.15, origin.z);
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
    const geo = new THREE.BoxGeometry(2.0, 1.0, 0.15);
    const mat = new THREE.MeshBasicMaterial({ color, depthTest: false });
    return new THREE.Mesh(geo, mat);
  }

  private makeProjectionArc(hx: number, hz: number, surfaceY: number, speed: number): THREE.Line {
    // Simple parabola: y = v² sin(2θ)/g, θ=45°
    const g = 9.81;
    const range = (speed * speed) / g;
    const points: THREE.Vector3[] = [];
    const steps = 20;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const px = hx + Math.cos(0.8) * range * t;
      // Offset from the terrain surface, not world y=0 — a blast site rarely
      // sits near y=0, so an unoffset arc rendered underground (see the
      // vibration-wave fix above for the same class of bug).
      const py = surfaceY + range * 0.5 * t * (1 - t) * 2;
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
