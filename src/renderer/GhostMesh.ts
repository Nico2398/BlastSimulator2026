// BlastSimulator2026 — Ghost Mesh Renderer
// Renders pending-action previews as blue translucent pulsing meshes.
// Each GhostPreview maps to a semi-transparent box at the target grid position.
// Opacity pulses between min and max to signal "waiting for worker" state.

import * as THREE from 'three';
import type { GhostPreview } from '../core/state/GameState.js';

// ---------- Config ----------

const GHOST_COLOR     = 0x44aaff;        // blue tint
const EMISSIVE_COLOR  = new THREE.Color(0x1166cc); // deeper blue glow
const OPACITY_MIN     = 0.20;            // dimmest pulse value
const OPACITY_MAX     = 0.60;            // brightest pulse value
const PULSE_SPEED     = 2.2;             // radians / second
const GHOST_SIZE      = 0.9;             // box half-extent in metres

// A claimed ghost (employee walking to it, #547) stays visible but dims and
// slows its pulse — signalling "already spoken for" rather than "waiting for
// a worker", while keeping the same base blue color/emissive.
const CLAIMED_OPACITY_MIN = 0.08;            // dimmest pulse value, claimed
const CLAIMED_OPACITY_MAX = 0.28;            // brightest pulse value, claimed
const CLAIMED_PULSE_SPEED = PULSE_SPEED * 0.4; // radians / second, claimed

// ---------- Main class ----------

export class GhostMesh {
  private readonly scene: THREE.Scene;
  private readonly meshes = new Map<number, THREE.Mesh>();
  private readonly claimedById = new Map<number, boolean>();
  private readonly material: THREE.MeshPhongMaterial;
  private readonly claimedMaterial: THREE.MeshPhongMaterial;
  private time = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.material = new THREE.MeshPhongMaterial({
      color: GHOST_COLOR,
      emissive: EMISSIVE_COLOR,
      emissiveIntensity: 0.5,
      transparent: true,
      opacity: OPACITY_MIN,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.claimedMaterial = new THREE.MeshPhongMaterial({
      color: GHOST_COLOR,
      emissive: EMISSIVE_COLOR,
      emissiveIntensity: 0.5,
      transparent: true,
      opacity: CLAIMED_OPACITY_MIN,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }

  /**
   * Sync ghost meshes against the current ghost preview list.
   * Adds meshes for new previews, removes meshes for gone ones, and swaps
   * an existing mesh's material when its `claimed` state changed (#547) —
   * without destroying/recreating the mesh.
   * Call after syncFromContext() whenever ghostPreviews may have changed.
   */
  sync(previews: GhostPreview[]): void {
    const activeIds = new Set(previews.map(p => p.id));

    // Remove stale ghosts
    for (const [id, mesh] of this.meshes) {
      if (!activeIds.has(id)) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        this.meshes.delete(id);
        this.claimedById.delete(id);
      }
    }

    // Add newly queued ghosts / update material on claimed-state change
    for (const preview of previews) {
      const existing = this.meshes.get(preview.id);
      if (existing === undefined) {
        const geo = new THREE.BoxGeometry(GHOST_SIZE, GHOST_SIZE, GHOST_SIZE);
        const mesh = new THREE.Mesh(geo, preview.claimed ? this.claimedMaterial : this.material);
        mesh.position.set(
          preview.targetX,
          preview.targetY + GHOST_SIZE / 2,
          preview.targetZ,
        );
        this.scene.add(mesh);
        this.meshes.set(preview.id, mesh);
        this.claimedById.set(preview.id, preview.claimed);
        continue;
      }

      if (this.claimedById.get(preview.id) !== preview.claimed) {
        existing.material = preview.claimed ? this.claimedMaterial : this.material;
        this.claimedById.set(preview.id, preview.claimed);
      }
    }
  }

  /**
   * Animate ghost opacity. Call every frame with elapsed seconds.
   */
  update(dt: number): void {
    if (this.meshes.size === 0) return;
    this.time += dt;
    const t = (Math.sin(this.time * PULSE_SPEED) + 1) * 0.5; // 0..1
    this.material.opacity = OPACITY_MIN + t * (OPACITY_MAX - OPACITY_MIN);
    const claimedT = (Math.sin(this.time * CLAIMED_PULSE_SPEED) + 1) * 0.5; // 0..1
    this.claimedMaterial.opacity = CLAIMED_OPACITY_MIN + claimedT * (CLAIMED_OPACITY_MAX - CLAIMED_OPACITY_MIN);
  }

  /** Remove all ghost meshes from the scene. */
  clearAll(): void {
    for (const mesh of this.meshes.values()) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
    }
    this.meshes.clear();
    this.claimedById.clear();
  }

  /** Number of ghost meshes currently rendered. */
  get count(): number {
    return this.meshes.size;
  }

  dispose(): void {
    this.clearAll();
    this.material.dispose();
    this.claimedMaterial.dispose();
  }
}
