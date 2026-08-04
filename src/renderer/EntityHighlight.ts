// BlastSimulator2026 — Entity selection highlight (redesign P2)
// A dashed ring on the ground under the selected entity — the Three.js side
// of scene selection. ScenePicking (src/ui/scene/) decides *what* is
// selected; this only draws it.

import * as THREE from 'three';
import type { PickableKind } from './Pickable.js';

const RING_COLOR = 0xffb02e; // --bsx-amber
const RING_SEGMENTS = 48;
const RING_Y_OFFSET = 0.05; // lifted off the ground to avoid z-fighting with terrain
const DASH_SIZE = 0.4;
const GAP_SIZE = 0.3;
/** Full pulse cycle length, seconds — subtle breathing so the ring reads as "live", not static. */
const PULSE_PERIOD_S = 2.2;
const PULSE_MIN_OPACITY = 0.55;
const PULSE_MAX_OPACITY = 1.0;

/** Ground-ring radius by entity kind — footprint-appropriate default; callers with exact size may override. */
const DEFAULT_RADIUS: Record<PickableKind, number> = {
  building: 2.4,
  vehicle: 1.5,
  employee: 0.55,
  fragment: 0.7,
  // Comfortably outside BlastPlanOverlay's HOLE_RADIUS (0.6) — every other
  // kind's default sits outside its own visual footprint with a clear gap,
  // and the marker already has a white wireframe ring at 0.6 that an
  // equal-radius amber ring would sit flush against instead of surrounding.
  hole: 1.0,
};

export class EntityHighlight {
  private readonly scene: THREE.Scene;
  private ring: THREE.LineLoop | null = null;
  private time = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /** Show the ring under a world-space position. Replaces any ring already shown. */
  show(position: THREE.Vector3, kind: PickableKind, radius: number = DEFAULT_RADIUS[kind]): void {
    this.hide();

    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= RING_SEGMENTS; i++) {
      const angle = (i / RING_SEGMENTS) * Math.PI * 2;
      points.push(new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius));
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineDashedMaterial({
      color: RING_COLOR,
      dashSize: DASH_SIZE,
      gapSize: GAP_SIZE,
      transparent: true,
      opacity: PULSE_MAX_OPACITY,
    });
    const ring = new THREE.LineLoop(geometry, material);
    ring.computeLineDistances(); // required for dashed materials to render dashes at all
    ring.position.copy(position);
    ring.position.y += RING_Y_OFFSET;
    this.scene.add(ring);
    this.ring = ring;
    this.time = 0;
  }

  /** Move the ring to follow its entity (vehicles/employees move every frame while selected). */
  setPosition(position: THREE.Vector3): void {
    if (!this.ring) return;
    this.ring.position.set(position.x, position.y + RING_Y_OFFSET, position.z);
  }

  hide(): void {
    if (!this.ring) return;
    this.scene.remove(this.ring);
    this.ring.geometry.dispose();
    (this.ring.material as THREE.Material).dispose();
    this.ring = null;
  }

  get visible(): boolean { return this.ring !== null; }

  /** Advance the pulse animation. Call every frame; a no-op while nothing is selected. */
  update(dt: number): void {
    if (!this.ring) return;
    this.time += dt;
    const phase = (Math.sin((this.time / PULSE_PERIOD_S) * Math.PI * 2) + 1) / 2; // 0..1
    const material = this.ring.material as THREE.LineDashedMaterial;
    material.opacity = PULSE_MIN_OPACITY + phase * (PULSE_MAX_OPACITY - PULSE_MIN_OPACITY);
  }

  dispose(): void {
    this.hide();
  }
}
