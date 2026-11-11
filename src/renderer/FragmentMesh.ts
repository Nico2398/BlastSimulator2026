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
import { drain, type Steps } from '../core/engine/Steps.js';
import { rockIndexOf } from '../core/world/RockCatalog.js';
import { oreIndexOf } from '../core/world/OreCatalog.js';
import { FRAGMENT_MIN_RENDER_Y } from '../core/config/balance.js';
import { buildFragmentGeometries } from './FragmentGeometry.js';
import { buildBaseTransform, composeInstanceMatrix, type FragmentBaseTransform, type PlainVec3 } from './FragmentTransformMath.js';

// ---------- Config ----------

// Smallest edge a fragment is drawn with (metres). Fragments are carved at
// sub-voxel resolution, so the finest are a few centimetres across — under about
// this they stop being legible on screen and just alias.
const MIN_RENDER_EXTENT = 0.25;

// Number of irregular shape variants
const SHAPE_VARIANTS = 24;

// Instances a variant bucket starts with. Every fragment on the ground is drawn —
// the player hauls what they see — so a full bucket doubles rather than dropping
// fragments; one instanced draw call per variant whatever the count.
const INITIAL_BUCKET_CAPACITY = 128;

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

/**
 * three's InstancedMesh.raycast caches its bounding sphere on first use. A
 * raycast while count=0 (any pick before the blast) caches an empty sphere and
 * every later fragment pick misses; moved instances stale it too. Dropping the
 * cache makes the next raycast recompute it from the current instances.
 */
function invalidateBounds(im: THREE.InstancedMesh): void {
  im.boundingSphere = null;
  im.boundingBox = null;
}

// ---------- Main class ----------

/** Fragments written between two yields of a resumable spawn (a power of two). */
const SPAWN_SLICE = 512;

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
  /** Scratch quaternion for Matrix4.decompose in fragmentPosition() — its value is discarded, only position is read. */
  private static readonly _quat = new THREE.Quaternion();
  /** Identity settle-scale, reused for the spawn matrix (fragment is at rest, untumbled, unsettled). */
  private static readonly _unitScale = { x: 1, y: 1, z: 1 };
  /** Which buckets `updateTransforms` touched this call — reused so a frame with many fragments allocates nothing. */
  private readonly dirtyBuckets = new Array<boolean>(SHAPE_VARIANTS).fill(false);

  /** `material` is the shared TerrainMaterial (borrowed from TerrainMesh, which owns and disposes it — #458 T4.1/D9). */
  constructor(scene: THREE.Scene, material: THREE.Material) {
    this.scene = scene;
    const geos = getSharedGeometries();

    for (let i = 0; i < SHAPE_VARIANTS; i++) {
      this.instanceRockA.push(instanceAttribute(INITIAL_BUCKET_CAPACITY, 1));
      this.instanceRockB.push(instanceAttribute(INITIAL_BUCKET_CAPACITY, 1));
      this.instanceRockWeight.push(instanceAttribute(INITIAL_BUCKET_CAPACITY, 1));
      this.instanceOre.push(instanceAttribute(INITIAL_BUCKET_CAPACITY, 2));
      this.bindAttributes(i, geos[i]!);
      const im = this.makeBucketMesh(i, geos[i]!, material, INITIAL_BUCKET_CAPACITY);
      scene.add(im);
      this.instancedMeshes.push(im);
      this.bucketSlotToFrag.push(new Array<number>(INITIAL_BUCKET_CAPACITY).fill(-1));
    }
  }

  private bindAttributes(i: number, geo: THREE.BufferGeometry): void {
    geo.setAttribute('aRockA', this.instanceRockA[i]!);
    geo.setAttribute('aRockB', this.instanceRockB[i]!);
    geo.setAttribute('aRockWeight', this.instanceRockWeight[i]!);
    geo.setAttribute('aOre', this.instanceOre[i]!);
  }

  private makeBucketMesh(i: number, geo: THREE.BufferGeometry, material: THREE.Material, capacity: number): THREE.InstancedMesh {
    const im = new THREE.InstancedMesh(geo, material, capacity);
    im.count = 0;
    im.frustumCulled = false; // fragments fly around; disable per-instance culling
    // Tagged for scene picking (P2): one InstancedMesh represents many
    // fragments, so a raycast hit resolves via (bucketIndex, instanceId) →
    // fragmentIdAt() rather than a single entityId like other entity kinds.
    im.userData['entityKind'] = 'fragment';
    im.userData['bucketIndex'] = i;
    return im;
  }

  /** Double a full bucket: an InstancedMesh's instance count is fixed at construction, so it is rebuilt with the instances copied over. */
  private growBucket(i: number): void {
    const old = this.instancedMeshes[i]!;
    const capacity = this.bucketSlotToFrag[i]!.length * 2;
    this.instanceRockA[i] = grownAttribute(this.instanceRockA[i]!, capacity);
    this.instanceRockB[i] = grownAttribute(this.instanceRockB[i]!, capacity);
    this.instanceRockWeight[i] = grownAttribute(this.instanceRockWeight[i]!, capacity);
    this.instanceOre[i] = grownAttribute(this.instanceOre[i]!, capacity);
    this.bindAttributes(i, old.geometry);
    const im = this.makeBucketMesh(i, old.geometry, old.material as THREE.Material, capacity);
    im.instanceMatrix.array.set(old.instanceMatrix.array);
    im.count = old.count;
    this.scene.remove(old);
    old.dispose();
    this.scene.add(im);
    this.instancedMeshes[i] = im;
    const slots = this.bucketSlotToFrag[i]!;
    for (let k = slots.length; k < capacity; k++) slots.push(-1);
  }

  /** The preferred bucket, grown first when it is full. */
  private pickBucket(preferred: number): number {
    if (this.bucketCount[preferred]! >= this.bucketSlotToFrag[preferred]!.length) this.growBucket(preferred);
    return preferred;
  }

  /**
   * Spawn meshes for a set of blast fragments.
   * Call after executeBlast() returns a BlastResult.
   */
  spawnFragments(fragments: FragmentData[]): void {
    drain(this.spawnFragmentsSteps(fragments));
  }

  /**
   * `spawnFragments`, yielding every few hundred fragments (#1603): a large
   * blast's thousands of instances took a frame's budget to write. The new
   * instances are drawn only once all are written.
   */
  *spawnFragmentsSteps(fragments: FragmentData[]): Steps<void> {
    for (let k = 0; k < fragments.length; k++) {
      if ((k & (SPAWN_SLICE - 1)) === 0) yield;
      const frag = fragments[k]!;
      // Already drawn (the per-sync reconcile got to it first): keep its slot.
      if (this.fragIdToSlot.has(frag.id)) continue;
      // Keyed on the shape seed, not the id — ids run consecutively so
      // `id % SHAPE_VARIANTS` marched through variants in lockstep, giving a
      // visible repeating pattern.
      const meshIdx = this.pickBucket(frag.shapeSeed % SHAPE_VARIANTS);
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
      invalidateBounds(im);
      if (im.instanceMatrix) im.instanceMatrix.needsUpdate = true;
      this.instanceRockA[i]!.needsUpdate = true;
      this.instanceRockB[i]!.needsUpdate = true;
      this.instanceRockWeight[i]!.needsUpdate = true;
      this.instanceOre[i]!.needsUpdate = true;
    }
  }

  /**
   * Make the drawn fragments match the state's on-ground ones: a fragment a
   * hauler loaded leaves the scene, one dropped back or newly broken appears.
   * A no-op (one lookup per fragment) when nothing changed.
   */
  syncOnGround(onGround: readonly FragmentData[]): void {
    if (onGround.length === this.fragIdToSlot.size && onGround.every(f => this.fragIdToSlot.has(f.id))) return;
    const ids = new Set(onGround.map(f => f.id));
    for (const id of [...this.fragIdToSlot.keys()]) if (!ids.has(id)) this.removeFragment(id);
    this.spawnFragments(onGround.filter(f => !this.fragIdToSlot.has(f.id)));
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
      if (!this.dirtyBuckets[i]) continue;
      const im = this.instancedMeshes[i]!;
      im.instanceMatrix.needsUpdate = true;
      invalidateBounds(im);
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
    invalidateBounds(im);
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
      invalidateBounds(this.instancedMeshes[i]!);
    }
    this.fragIdToSlot.clear();
    this.fragBaseTransform.clear();
    for (const bucket of this.bucketSlotToFrag) bucket.fill(-1);
  }

  /** Get count of currently rendered fragments. */
  get count(): number {
    return this.bucketCount.reduce((a, b) => a + b, 0);
  }

  /** Root objects raycastable for scene picking — the shape-variant buckets, tagged in the constructor. */
  pickables(): THREE.Object3D[] {
    return this.instancedMeshes;
  }

  /**
   * Resolve a raycast hit on a fragment bucket (bucketIndex from
   * `im.userData['bucketIndex']`, instanceId from the Intersection) back to
   * the fragment id occupying that instance slot. Returns null out of range.
   */
  fragmentIdAt(bucketIndex: number, instanceId: number): number | null {
    const bucket = this.bucketSlotToFrag[bucketIndex];
    const fragId = bucket?.[instanceId];
    return fragId === undefined || fragId < 0 ? null : fragId;
  }

  /** World-space position of a fragment still on the field, or null if it isn't (removed/never spawned). */
  fragmentPosition(fragmentId: number): THREE.Vector3 | null {
    const slot = this.fragIdToSlot.get(fragmentId);
    if (!slot) return null;
    const im = this.instancedMeshes[slot.meshIdx]!;
    im.getMatrixAt(slot.slotIdx, FragmentMesh._mtx);
    FragmentMesh._mtx.decompose(FragmentMesh._pos, FragmentMesh._quat, FragmentMesh._scale);
    return FragmentMesh._pos.clone();
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

function instanceAttribute(capacity: number, itemSize: number): THREE.InstancedBufferAttribute {
  return new THREE.InstancedBufferAttribute(new Float32Array(capacity * itemSize), itemSize);
}

function grownAttribute(old: THREE.InstancedBufferAttribute, capacity: number): THREE.InstancedBufferAttribute {
  const grown = instanceAttribute(capacity, old.itemSize);
  grown.array.set(old.array as Float32Array);
  return grown;
}
