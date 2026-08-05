// BlastSimulator2026 — Fragment Meshes (Performance-optimised)
// Renders blast fragments using InstancedMesh for batched GPU rendering.
// 24 shape variants × 1 InstancedMesh each = 24 draw calls regardless of count
// (was 2000 individual meshes × material clones). Each instance is scaled to
// the fragment's own bounding box, carries a seeded orientation and slight
// shear so two instances of one variant never read as the same rock, and
// shades rock/ore identity (aRockA/aRockB/aRockWeight/aOre) through the
// shared TerrainMaterial (#458 T4.1/D9/A18). The rotation/shear/tumble-axis
// math lives in FragmentTransformMath.ts, shared with FragmentAnimator so a
// settled fragment's transform is bit-identical to its spawn one (#485).

import * as THREE from 'three';
import type { FragmentData } from '../core/mining/BlastExecution.js';
import { rockIndexOf } from '../core/world/RockCatalog.js';
import { oreIndexOf } from '../core/world/OreCatalog.js';
import { FRAGMENT_MIN_RENDER_Y } from '../core/config/balance.js';
import { sampleEvenly } from './FragmentRenderSampling.js';
import { buildFragmentGeometries } from './FragmentGeometry.js';
import { buildBaseTransform, composeInstanceMatrix, type FragmentBaseTransform, type PlainVec3 } from './FragmentTransformMath.js';

// ---------- Config ----------

// Smallest edge a fragment is drawn with (metres). Fragments are carved at
// sub-voxel resolution, so the finest are a few centimetres across — under about
// this they stop being legible on screen and just alias.
const MIN_RENDER_EXTENT = 0.25;

// Maximum fragments rendered simultaneously (performance guard)
const MAX_RENDERED_FRAGMENTS = 2000;

// Number of irregular shape variants
const SHAPE_VARIANTS = 24;

// Capacity per variant bucket — evenly split; some buckets may have slightly more
const BUCKET_CAPACITY = Math.ceil(MAX_RENDERED_FRAGMENTS / SHAPE_VARIANTS);

// ---------- Shared geometry pool ----------

let sharedGeometries: THREE.BufferGeometry[] | null = null;

function getSharedGeometries(): THREE.BufferGeometry[] {
  if (!sharedGeometries) sharedGeometries = buildFragmentGeometries(SHAPE_VARIANTS);
  return sharedGeometries;
}

// ---------- Per-instance slot tracking ----------

interface SlotInfo {
  meshIdx: number;
  slotIdx: number;
}

/**
 * Per-instance transform data written by the animator each frame: current
 * position plus how far it has tumbled and settled since spawn (#485).
 */
export interface FragmentInstanceTransform {
  x: number;
  y: number;
  z: number;
  /** Extra rotation (radians) about the fragment's own seeded tumble axis, on top of its spawn orientation. 0 = untouched. */
  tumbleAngle: number;
  /** Multiplier on the fragment's spawn scale. (1,1,1) = untouched. */
  settleScale: PlainVec3;
}

/** The highest-density ore in a fragment's ore record, or '' if none (#458 T4.1/A18). */
function dominantOre(oreDensities: Record<string, number>): { id: string; amt: number } {
  let id = '';
  let amt = 0;
  for (const [oreId, density] of Object.entries(oreDensities)) {
    if (density > amt) { id = oreId; amt = density; }
  }
  return { id, amt };
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
  /** fragId → the fixed rotation/shear/tumble-axis part of its spawn transform (#485). */
  private readonly fragBaseTransform = new Map<number, FragmentBaseTransform>();

  /** Per-shape-variant per-instance rock/ore attributes, shading the shared TerrainMaterial (#458 T4.1/A18). */
  private readonly instanceRockA: THREE.InstancedBufferAttribute[] = [];
  private readonly instanceRockB: THREE.InstancedBufferAttribute[] = [];
  private readonly instanceRockWeight: THREE.InstancedBufferAttribute[] = [];
  private readonly instanceOre: THREE.InstancedBufferAttribute[] = [];

  private static readonly _mtx = new THREE.Matrix4();
  private static readonly _scale = new THREE.Vector3();
  private static readonly _pos = new THREE.Vector3();
  /** Identity settle-scale, reused for the spawn matrix (fragment is at rest, untumbled, unsettled). */
  private static readonly _unitScale = { x: 1, y: 1, z: 1 };
  /** Which buckets `updateTransforms` touched this call — reused so a frame with many fragments allocates nothing. */
  private readonly dirtyBuckets = new Array<boolean>(SHAPE_VARIANTS).fill(false);

  /** `material` is the shared TerrainMaterial (borrowed from TerrainMesh, which owns and disposes it — #458 T4.1/D9). */
  constructor(scene: THREE.Scene, material: THREE.Material) {
    this.scene = scene;
    const geos = getSharedGeometries();

    for (let i = 0; i < SHAPE_VARIANTS; i++) {
      const geo = geos[i]!;
      const rockA = new THREE.InstancedBufferAttribute(new Float32Array(BUCKET_CAPACITY), 1);
      const rockB = new THREE.InstancedBufferAttribute(new Float32Array(BUCKET_CAPACITY), 1);
      const rockWeight = new THREE.InstancedBufferAttribute(new Float32Array(BUCKET_CAPACITY), 1);
      const ore = new THREE.InstancedBufferAttribute(new Float32Array(BUCKET_CAPACITY * 2), 2);
      geo.setAttribute('aRockA', rockA);
      geo.setAttribute('aRockB', rockB);
      geo.setAttribute('aRockWeight', rockWeight);
      geo.setAttribute('aOre', ore);
      this.instanceRockA.push(rockA);
      this.instanceRockB.push(rockB);
      this.instanceRockWeight.push(rockWeight);
      this.instanceOre.push(ore);

      const im = new THREE.InstancedMesh(geo, material, BUCKET_CAPACITY);
      im.count = 0;
      im.frustumCulled = false; // fragments fly around; disable per-instance culling
      scene.add(im);
      this.instancedMeshes.push(im);
      this.bucketSlotToFrag.push(new Array<number>(BUCKET_CAPACITY).fill(-1));
    }
  }

  /** The preferred bucket if it has room, otherwise the next that does; -1 if all full. */
  private pickBucket(preferred: number): number {
    for (let i = 0; i < SHAPE_VARIANTS; i++) {
      const idx = (preferred + i) % SHAPE_VARIANTS;
      if (this.bucketCount[idx]! < BUCKET_CAPACITY) return idx;
    }
    return -1;
  }

  /**
   * Spawn meshes for a set of blast fragments.
   * Call after executeBlast() returns a BlastResult.
   */
  spawnFragments(fragments: FragmentData[]): void {
    // Sample evenly across the whole fragment array rather than taking the
    // first N. Fragments come out ordered by where in the blast they were
    // carved, so taking a prefix only ever shows one corner of a large blast.
    const toRender = sampleEvenly(fragments, MAX_RENDERED_FRAGMENTS);

    for (const frag of toRender) {
      // Keyed on the shape seed, not the id — ids run consecutively so
      // `id % SHAPE_VARIANTS` marched through variants in lockstep, giving a
      // visible repeating pattern. Falling through to any bucket with room
      // keeps the full render budget usable once a variant fills up.
      const meshIdx = this.pickBucket(frag.shapeSeed % SHAPE_VARIANTS);
      if (meshIdx < 0) continue; // every bucket full
      const count = this.bucketCount[meshIdx]!;

      const im = this.instancedMeshes[meshIdx]!;

      // Fragment is drawn at the size/proportions it was carved with, at its
      // real centroid inside the volume the blast removed.
      FragmentMesh._pos.set(frag.position.x, Math.max(FRAGMENT_MIN_RENDER_Y, frag.position.y), frag.position.z);
      FragmentMesh._scale.set(
        Math.max(MIN_RENDER_EXTENT, frag.halfExtents.x * 2),
        Math.max(MIN_RENDER_EXTENT, frag.halfExtents.y * 2),
        Math.max(MIN_RENDER_EXTENT, frag.halfExtents.z * 2),
      );
      // Rotation, shear, and size are fixed for the fragment's whole life —
      // build that part once and keep it, so each frame's update only has to
      // recompose the cheap tumble/settle part on top (#485).
      const base = buildBaseTransform(frag.shapeSeed, FragmentMesh._scale);
      this.fragBaseTransform.set(frag.id, base);
      composeInstanceMatrix(base, FragmentMesh._pos, 0, FragmentMesh._unitScale, FragmentMesh._mtx);
      im.setMatrixAt(count, FragmentMesh._mtx);

      // Rock/ore identity for the shared TerrainMaterial shader — a fragment
      // is one source voxel, so both rock slots are the same index and the
      // blend weight is 0 (#458 T4.1/A18).
      const rockIdx = Math.max(0, rockIndexOf(frag.rockId));
      this.instanceRockA[meshIdx]!.setX(count, rockIdx);
      this.instanceRockB[meshIdx]!.setX(count, rockIdx);
      this.instanceRockWeight[meshIdx]!.setX(count, 0);
      const { id: oreId, amt: oreAmt } = dominantOre(frag.oreDensities);
      const oreIdx = oreId ? oreIndexOf(oreId) : -1;
      this.instanceOre[meshIdx]!.setXY(count, oreIdx, oreIdx >= 0 ? oreAmt : 0);

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
      this.instanceRockA[i]!.needsUpdate = true;
      this.instanceRockB[i]!.needsUpdate = true;
      this.instanceRockWeight[i]!.needsUpdate = true;
      this.instanceOre[i]!.needsUpdate = true;
    }
  }

  /** Update fragment position/tumble/settle-scale during collapse playback. */
  updateTransforms(updates: Map<number, FragmentInstanceTransform>): void {
    this.dirtyBuckets.fill(false);

    for (const [fragId, transform] of updates) {
      const slot = this.fragIdToSlot.get(fragId);
      const base = this.fragBaseTransform.get(fragId);
      if (!slot || !base) continue;

      composeInstanceMatrix(base, transform, transform.tumbleAngle, transform.settleScale, FragmentMesh._mtx);
      this.instancedMeshes[slot.meshIdx]!.setMatrixAt(slot.slotIdx, FragmentMesh._mtx);
      this.dirtyBuckets[slot.meshIdx] = true;
    }

    for (let i = 0; i < SHAPE_VARIANTS; i++) {
      if (this.dirtyBuckets[i]) this.instancedMeshes[i]!.instanceMatrix.needsUpdate = true;
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

      const rockA = this.instanceRockA[meshIdx]!;
      const rockB = this.instanceRockB[meshIdx]!;
      const rockWeight = this.instanceRockWeight[meshIdx]!;
      const ore = this.instanceOre[meshIdx]!;
      rockA.setX(slotIdx, rockA.getX(lastIdx));
      rockB.setX(slotIdx, rockB.getX(lastIdx));
      rockWeight.setX(slotIdx, rockWeight.getX(lastIdx));
      ore.setXY(slotIdx, ore.getX(lastIdx), ore.getY(lastIdx));

      const swappedFragId = this.bucketSlotToFrag[meshIdx]![lastIdx]!;
      this.bucketSlotToFrag[meshIdx]![slotIdx] = swappedFragId;
      this.fragIdToSlot.set(swappedFragId, { meshIdx, slotIdx });
    }

    this.bucketCount[meshIdx] = lastIdx;
    im.count = lastIdx;
    im.instanceMatrix.needsUpdate = true;
    this.instanceRockA[meshIdx]!.needsUpdate = true;
    this.instanceRockB[meshIdx]!.needsUpdate = true;
    this.instanceRockWeight[meshIdx]!.needsUpdate = true;
    this.instanceOre[meshIdx]!.needsUpdate = true;

    this.fragIdToSlot.delete(fragmentId);
    this.fragBaseTransform.delete(fragmentId);
    this.bucketSlotToFrag[meshIdx]![lastIdx] = -1;
  }

  /** Remove all fragment meshes from the scene. */
  clearAll(): void {
    for (let i = 0; i < SHAPE_VARIANTS; i++) {
      this.bucketCount[i] = 0;
      this.instancedMeshes[i]!.count = 0;
    }
    this.fragIdToSlot.clear();
    this.fragBaseTransform.clear();
    for (const bucket of this.bucketSlotToFrag) bucket.fill(-1);
  }

  /** Get count of currently rendered fragments. */
  get count(): number {
    return this.bucketCount.reduce((a, b) => a + b, 0);
  }

  /** Remove instanced meshes from the scene. Geometries are shared (kept alive); material is borrowed from TerrainMesh, which owns and disposes it. */
  dispose(): void {
    this.clearAll();
    for (const im of this.instancedMeshes) {
      this.scene.remove(im);
    }
    this.instancedMeshes.length = 0;
  }
}
