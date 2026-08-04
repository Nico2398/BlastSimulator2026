// BlastSimulator2026 — Fragment Meshes (Performance-optimised)
// Renders blast fragments using InstancedMesh for batched GPU rendering.
// 24 shape variants × 1 InstancedMesh each = 24 draw calls regardless of count.
// Each instance is scaled to the fragment's own bounding box, so the size and
// proportions the blast carved are what the player sees.
// Rock/ore identity is carried per-instance (aRockA/aRockB/aRockWeight/aOre)
// and shaded by the shared TerrainMaterial, so a fragment's cut face matches
// the rock it broke off from (#458 T4.1/D9/A18).
//
// The variant geometries are closed cut-stone polyhedra (FragmentGeometry.ts).
// Each instance also gets a seeded orientation and a slight shear, so two
// instances of one variant never read as the same rock. The shear lives inside
// the instance matrix — position updates must preserve it (see updatePositions).
//
// Performance target: 2000 fragments at 60fps
// Previous: 2000 individual meshes × material clones → thousands of draw calls
// Now:      24 InstancedMesh objects → 24 draw calls for any fragment count

import * as THREE from 'three';
import type { FragmentData } from '../core/mining/BlastExecution.js';
import { rockIndexOf } from '../core/world/RockCatalog.js';
import { oreIndexOf } from '../core/world/OreCatalog.js';
import { FRAGMENT_MIN_RENDER_Y } from '../core/config/balance.js';
import { sampleEvenly } from './FragmentRenderSampling.js';
import { buildFragmentGeometries } from './FragmentGeometry.js';

// ---------- Config ----------

// Smallest edge a fragment is drawn with (metres). Fragments are carved at
// sub-voxel resolution, so the finest are a few centimetres across — under about
// this they stop being legible on screen and just alias.
const MIN_RENDER_EXTENT = 0.25;

// Maximum fragments rendered simultaneously (performance guard)
const MAX_RENDERED_FRAGMENTS = 2000;

// Number of irregular shape variants
const SHAPE_VARIANTS = 24;

// How far a fragment's unit shape is skewed by its per-instance shear. Small on
// purpose: at 0.18 the silhouette changes, the volume barely does.
const SHEAR_MAX = 0.18;

// Capacity per variant bucket — evenly split; some buckets may have slightly more
const BUCKET_CAPACITY = Math.ceil(MAX_RENDERED_FRAGMENTS / SHAPE_VARIANTS);

// ---------- Shared geometry pool ----------

let sharedGeometries: THREE.BufferGeometry[] | null = null;

function getSharedGeometries(): THREE.BufferGeometry[] {
  if (!sharedGeometries) sharedGeometries = buildFragmentGeometries(SHAPE_VARIANTS);
  return sharedGeometries;
}

/** Deterministic pseudo-random in [0, 1) from a fragment's shape seed. */
function seedUnit(seed: number, salt: number): number {
  const x = Math.sin(seed * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

// ---------- Per-instance slot tracking ----------

interface SlotInfo {
  meshIdx: number;
  slotIdx: number;
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

  /** Per-shape-variant per-instance rock/ore attributes, shading the shared TerrainMaterial (#458 T4.1/A18). */
  private readonly instanceRockA: THREE.InstancedBufferAttribute[] = [];
  private readonly instanceRockB: THREE.InstancedBufferAttribute[] = [];
  private readonly instanceRockWeight: THREE.InstancedBufferAttribute[] = [];
  private readonly instanceOre: THREE.InstancedBufferAttribute[] = [];

  private static readonly _mtx = new THREE.Matrix4();
  private static readonly _shear = new THREE.Matrix4();
  private static readonly _scale = new THREE.Vector3();
  private static readonly _quat = new THREE.Quaternion();
  private static readonly _pos = new THREE.Vector3();
  private static readonly _euler = new THREE.Euler();
  private static readonly _unit = new THREE.Vector3(1, 1, 1);

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

  /**
   * The preferred bucket if it has room, otherwise the next one that does.
   * Returns -1 when every bucket is full.
   */
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
      // Keyed on the fragment's own shape seed rather than its id: ids run
      // consecutively, so `id % SHAPE_VARIANTS` marched through the variants in
      // lockstep and produced a visible repeating pattern across the muck pile.
      // Shape seeds are random, so buckets do not fill evenly. Falling through
      // to any bucket with room keeps the full render budget usable instead of
      // dropping fragments once one variant happens to fill up.
      const meshIdx = this.pickBucket(frag.shapeSeed % SHAPE_VARIANTS);
      if (meshIdx < 0) continue; // every bucket full
      const count = this.bucketCount[meshIdx]!;

      const im = this.instancedMeshes[meshIdx]!;

      // Each fragment is drawn at the size and proportions it was carved with,
      // so a slab reads as a slab and a boulder as a boulder. Positions are the
      // real centroids of the rock that broke, inside the volume the blast just
      // removed — no crater offset or scatter is needed to fake that any more.
      FragmentMesh._pos.set(frag.position.x, Math.max(FRAGMENT_MIN_RENDER_Y, frag.position.y), frag.position.z);
      FragmentMesh._scale.set(
        Math.max(MIN_RENDER_EXTENT, frag.halfExtents.x * 2),
        Math.max(MIN_RENDER_EXTENT, frag.halfExtents.y * 2),
        Math.max(MIN_RENDER_EXTENT, frag.halfExtents.z * 2),
      );
      FragmentMesh._quat.setFromEuler(FragmentMesh._euler.set(
        seedUnit(frag.shapeSeed, 1) * Math.PI * 2,
        seedUnit(frag.shapeSeed, 2) * Math.PI * 2,
        seedUnit(frag.shapeSeed, 3) * Math.PI * 2,
      ));
      // A slight seeded shear, so two instances of the same variant stone never
      // read as identical. It sits *between* rotation and scale (T·R·Shear·S):
      // applied outside the scale, a slab's long axis would bleed into its thin
      // one and a flat fragment stopped rendering flat.
      const shear = FragmentMesh._shear.identity();
      const e = shear.elements;
      e[4] = (seedUnit(frag.shapeSeed, 4) * 2 - 1) * SHEAR_MAX;  // x from y
      e[8] = (seedUnit(frag.shapeSeed, 5) * 2 - 1) * SHEAR_MAX;  // x from z
      e[9] = (seedUnit(frag.shapeSeed, 6) * 2 - 1) * SHEAR_MAX;  // y from z
      FragmentMesh._mtx.compose(FragmentMesh._pos, FragmentMesh._quat, FragmentMesh._unit);
      FragmentMesh._mtx.multiply(shear);
      FragmentMesh._mtx.scale(FragmentMesh._scale);
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
      // Only the translation column changes. Decomposing to TRS and
      // recomposing — the old way — silently destroyed the per-instance shear
      // (TRS cannot represent it), and cost a decompose per fragment per frame.
      FragmentMesh._mtx.setPosition(pos.x, pos.y, pos.z);
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

  /** Remove instanced meshes from the scene. Geometries are shared (kept alive); material is borrowed from TerrainMesh, which owns and disposes it. */
  dispose(): void {
    this.clearAll();
    for (const im of this.instancedMeshes) {
      this.scene.remove(im);
    }
    this.instancedMeshes.length = 0;
  }
}
