// BlastSimulator2026 — Instanced ghost cubes (#1603)
//
// A large blast queues one haul or breaker order per fragment, thousands of
// them, each with a ghost cube. As separate meshes those cost a Mesh each to
// create — tens of milliseconds in the tick that queued them — and a draw call
// each, every frame, for as long as the muck pile lasts. One batch per ghost
// material draws them all in one call: a ghost is a slot, and adding, moving
// or removing one is a matrix write.

import * as THREE from 'three';
import { markSceneOverlay } from './post/SceneOverlay.js';

/** Slots a batch starts with; it doubles whenever it fills. */
const INITIAL_CAPACITY = 64;

export class GhostInstanceBatch {
  private mesh: THREE.InstancedMesh;
  /** Ghost id in each live slot, slot order. */
  private readonly ids: number[] = [];
  private static readonly matrix = new THREE.Matrix4();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly geometry: THREE.BufferGeometry,
    private readonly material: THREE.Material,
    private readonly renderOrder: number,
    /** Told when removing another ghost moved `id` into `slot`. */
    private readonly onMove: (id: number, slot: number) => void,
  ) {
    this.mesh = this.createMesh(INITIAL_CAPACITY);
  }

  /** Live ghosts in the batch. */
  get count(): number {
    return this.ids.length;
  }

  /** The drawn object, for tests and inspection. */
  get object(): THREE.InstancedMesh {
    return this.mesh;
  }

  /** Add ghost `id` with its cube centred at (x, y, z); returns its slot. */
  add(id: number, x: number, y: number, z: number): number {
    if (this.ids.length === this.mesh.instanceMatrix.count) this.grow();
    const slot = this.ids.length;
    this.ids.push(id);
    this.mesh.setMatrixAt(slot, GhostInstanceBatch.matrix.makeTranslation(x, y, z));
    this.mesh.count = this.ids.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    return slot;
  }

  /** Remove the ghost in `slot`; the last ghost moves into it. */
  remove(slot: number): void {
    const last = this.ids.length - 1;
    if (slot !== last) {
      this.mesh.getMatrixAt(last, GhostInstanceBatch.matrix);
      this.mesh.setMatrixAt(slot, GhostInstanceBatch.matrix);
      const moved = this.ids[last]!;
      this.ids[slot] = moved;
      this.onMove(moved, slot);
    }
    this.ids.pop();
    this.mesh.count = this.ids.length;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.dispose();
  }

  private createMesh(capacity: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, capacity);
    mesh.count = 0;
    mesh.renderOrder = this.renderOrder;
    // Instances spread over the whole site: the batch's own bounds would be its first cube's.
    mesh.frustumCulled = false;
    markSceneOverlay(mesh);
    this.scene.add(mesh);
    return mesh;
  }

  private grow(): void {
    const old = this.mesh;
    const grown = this.createMesh(old.instanceMatrix.count * 2);
    grown.instanceMatrix.array.set(old.instanceMatrix.array);
    grown.count = old.count;
    this.scene.remove(old);
    old.dispose();
    this.mesh = grown;
  }
}
