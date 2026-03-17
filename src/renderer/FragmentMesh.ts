// BlastSimulator2026 — Fragment Meshes (Performance-optimised)
// Renders blast fragments using InstancedMesh for batched GPU rendering.
// 8 shape variants × 1 InstancedMesh each = 8 draw calls regardless of fragment count.
// Fragment mesh size is proportional to fragment volume (cube-root → half-extent).
// Fragments with high ore density show a gold tint; projections are red-orange.
//
// Performance target: 2000 fragments at 60fps
// Previous: 2000 individual meshes × material clones → thousands of draw calls
// Now:      8 InstancedMesh objects → 8 draw calls for any fragment count

import * as THREE from 'three';
import type { FragmentData } from '../core/mining/BlastExecution.js';
import { sampleRockColor } from './ProceduralTexture.js';

// ---------- Config ----------

// Scale: 1 voxel ≈ 1 metre. Fragments are in m³.
// Real mine fragments: 0.001 m³ (fines) to 2 m³ (oversized blocks)
const FRAGMENT_SCALE = 0.5;

const ORE_RICH_THRESHOLD = 0.15;
const ORE_TINT_STRENGTH = 0.25;
const ORE_GOLD = new THREE.Color(0xffd700);
const PROJECTION_COLOR = new THREE.Color(0xff4400);

// Maximum fragments rendered simultaneously (performance guard)
const MAX_RENDERED_FRAGMENTS = 2000;

// Number of irregular shape variants
const SHAPE_VARIANTS = 8;

// Capacity per variant bucket — evenly split; some buckets may have slightly more
const BUCKET_CAPACITY = Math.ceil(MAX_RENDERED_FRAGMENTS / SHAPE_VARIANTS);

// ---------- Shared geometry pool ----------

let sharedGeometries: THREE.BufferGeometry[] | null = null;

function getSharedGeometries(): THREE.BufferGeometry[] {
  if (!sharedGeometries) {
    sharedGeometries = [];
    for (let i = 0; i < SHAPE_VARIANTS; i++) {
      const geo = new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
      const pos = geo.getAttribute('position') as THREE.BufferAttribute;
      const jitter = 0.15 + (i % 4) * 0.05;
      for (let v = 0; v < pos.count; v++) {
        pos.setX(v, pos.getX(v) + (Math.sin(v * 7 + i * 13) * jitter));
        pos.setY(v, pos.getY(v) + (Math.sin(v * 11 + i * 7) * jitter));
        pos.setZ(v, pos.getZ(v) + (Math.sin(v * 13 + i * 5) * jitter));
      }
      pos.needsUpdate = true;
      geo.computeVertexNormals();
      sharedGeometries.push(geo);
    }
  }
  return sharedGeometries;
}

// ---------- Per-instance slot tracking ----------

interface SlotInfo {
  meshIdx: number;
  slotIdx: number;
}

// ---------- Main class ----------

export class FragmentMesh {
  private readonly scene: THREE.Scene;
  /** One InstancedMesh per shape variant */
  private readonly instancedMeshes: THREE.InstancedMesh[] = [];
  /** How many active instances in each bucket */
  private readonly bucketCount: number[] = new Array(SHAPE_VARIANTS).fill(0);
  /** fragId → where it lives (meshIdx, slotIdx) */
  private readonly fragIdToSlot = new Map<number, SlotInfo>();
  /** slotIdx → fragId for each bucket (to support swap-on-delete) */
  private readonly bucketSlotToFrag: number[][] = [];

  private static readonly _mtx = new THREE.Matrix4();
  private static readonly _color = new THREE.Color();
  private static readonly _scale = new THREE.Vector3();
  private static readonly _quat = new THREE.Quaternion();
  private static readonly _pos = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    const geos = getSharedGeometries();
    const mat = new THREE.MeshPhongMaterial({ shininess: 10, side: THREE.FrontSide });

    for (let i = 0; i < SHAPE_VARIANTS; i++) {
      const im = new THREE.InstancedMesh(geos[i]!, mat.clone(), BUCKET_CAPACITY);
      im.count = 0;
      im.frustumCulled = false; // fragments fly around; disable per-instance culling
      scene.add(im);
      this.instancedMeshes.push(im);
      this.bucketSlotToFrag.push(new Array<number>(BUCKET_CAPACITY).fill(-1));
    }
  }

  /**
   * Spawn meshes for a set of blast fragments.
   * Call after executeBlast() returns a BlastResult.
   */
  spawnFragments(fragments: FragmentData[]): void {
    const toRender = fragments.slice(0, MAX_RENDERED_FRAGMENTS);

    for (const frag of toRender) {
      const meshIdx = frag.id % SHAPE_VARIANTS;
      const count = this.bucketCount[meshIdx]!;
      if (count >= BUCKET_CAPACITY) continue; // bucket full

      const halfExtent = Math.cbrt(frag.volume) * FRAGMENT_SCALE;
      const im = this.instancedMeshes[meshIdx]!;

      // Build transform matrix
      FragmentMesh._pos.set(frag.position.x, frag.position.y, frag.position.z);
      FragmentMesh._scale.setScalar(halfExtent * 2);
      FragmentMesh._quat.setFromEuler(new THREE.Euler(
        (frag.id * 1.3) % (Math.PI * 2),
        (frag.id * 2.7) % (Math.PI * 2),
        (frag.id * 0.9) % (Math.PI * 2),
      ));
      FragmentMesh._mtx.compose(
        FragmentMesh._pos,
        FragmentMesh._quat,
        FragmentMesh._scale,
      );
      im.setMatrixAt(count, FragmentMesh._mtx);

      // Determine color
      let color: THREE.Color;
      if (frag.isProjection) {
        color = PROJECTION_COLOR;
      } else {
        color = sampleRockColor(frag.rockId, frag.position.x, frag.position.y, frag.position.z);
        const oreSum = Object.values(frag.oreDensities).reduce((a, b) => a + b, 0);
        if (oreSum > ORE_RICH_THRESHOLD) {
          const t = Math.min(1, (oreSum - ORE_RICH_THRESHOLD) / 0.3) * ORE_TINT_STRENGTH;
          FragmentMesh._color.copy(color).lerp(ORE_GOLD, t);
          color = FragmentMesh._color;
        }
      }
      im.setColorAt(count, color);

      // Track slot
      this.fragIdToSlot.set(frag.id, { meshIdx, slotIdx: count });
      this.bucketSlotToFrag[meshIdx]![count] = frag.id;
      this.bucketCount[meshIdx] = count + 1;
    }

    // Mark instance attributes dirty for all buckets with content
    for (let i = 0; i < SHAPE_VARIANTS; i++) {
      const im = this.instancedMeshes[i]!;
      im.count = this.bucketCount[i]!;
      if (im.instanceMatrix) im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }

  /**
   * Update fragment positions during physics simulation.
   * Call on each physics step with the current body positions.
   */
  updatePositions(positions: Map<number, { x: number; y: number; z: number }>): void {
    const dirtyBuckets = new Set<number>();
    for (const [id, pos] of positions) {
      const slot = this.fragIdToSlot.get(id);
      if (!slot) continue;
      const im = this.instancedMeshes[slot.meshIdx]!;
      im.getMatrixAt(slot.slotIdx, FragmentMesh._mtx);
      // Decompose, update position, recompose
      FragmentMesh._mtx.decompose(FragmentMesh._pos, FragmentMesh._quat, FragmentMesh._scale);
      FragmentMesh._pos.set(pos.x, pos.y, pos.z);
      FragmentMesh._mtx.compose(FragmentMesh._pos, FragmentMesh._quat, FragmentMesh._scale);
      im.setMatrixAt(slot.slotIdx, FragmentMesh._mtx);
      dirtyBuckets.add(slot.meshIdx);
    }
    for (const idx of dirtyBuckets) {
      this.instancedMeshes[idx]!.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * Remove a specific fragment from the scene (e.g. when collected by excavator).
   * Uses swap-with-last to avoid expensive compaction.
   */
  removeFragment(fragmentId: number): void {
    const slot = this.fragIdToSlot.get(fragmentId);
    if (!slot) return;

    const { meshIdx, slotIdx } = slot;
    const im = this.instancedMeshes[meshIdx]!;
    const lastIdx = this.bucketCount[meshIdx]! - 1;

    if (slotIdx !== lastIdx) {
      // Swap with the last instance
      im.getMatrixAt(lastIdx, FragmentMesh._mtx);
      im.setMatrixAt(slotIdx, FragmentMesh._mtx);
      if (im.instanceColor) {
        im.getColorAt(lastIdx, FragmentMesh._color);
        im.setColorAt(slotIdx, FragmentMesh._color);
      }
      const swappedFragId = this.bucketSlotToFrag[meshIdx]![lastIdx]!;
      this.bucketSlotToFrag[meshIdx]![slotIdx] = swappedFragId;
      this.fragIdToSlot.set(swappedFragId, { meshIdx, slotIdx });
    }

    this.bucketCount[meshIdx] = lastIdx;
    im.count = lastIdx;
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;

    this.fragIdToSlot.delete(fragmentId);
    this.bucketSlotToFrag[meshIdx]![lastIdx] = -1;
  }

  /** Remove all fragment meshes from the scene. */
  clearAll(): void {
    for (let i = 0; i < SHAPE_VARIANTS; i++) {
      this.bucketCount[i] = 0;
      this.instancedMeshes[i]!.count = 0;
    }
    this.fragIdToSlot.clear();
    for (const bucket of this.bucketSlotToFrag) bucket.fill(-1);
  }

  /** Get count of currently rendered fragments. */
  get count(): number {
    return this.bucketCount.reduce((a, b) => a + b, 0);
  }

  /** Release instanced mesh resources. */
  dispose(): void {
    this.clearAll();
    for (const im of this.instancedMeshes) {
      this.scene.remove(im);
      (im.material as THREE.Material).dispose();
    }
    this.instancedMeshes.length = 0;
    // Shared geometries are intentionally kept alive for reuse
  }
}
