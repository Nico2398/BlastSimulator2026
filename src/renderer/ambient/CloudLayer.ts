// BlastSimulator2026 — Ambient cloud layer: drifting instanced clusters, plus
// the CPU-side scroll offset TerrainMaterial's cloud-shadow term reads, so
// visible clouds and their ground shadows never desync (#458 T7.1/D12/A25).
//
// Each cluster is a cartoon cumulus (#1602): a tall smooth puff ringed by
// smaller ones, all squashed onto a shared flat base, painted in toon bands
// (CloudMaterial) and outlined once around its silhouette with the same
// inverted hull every model wears — so the sky reads in the same style as
// the mine below it rather than as faceted low-poly rocks.
//
// Construct-safe under Node (no DOM/WebGL at construction — geometry is
// built from THREE primitives merged in JS, no canvas/texture loads) so it
// can be exercised by a bare `new CloudLayer(scene, seed, ...)` unit test.

import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { WeatherState } from '../../core/weather/WeatherCycle.js';
import { cellRand, subSeed } from '../../core/math/Hash.js';
import { createOutlineMaterial } from '../models/CartoonMaterial.js';
import { CLOUD_PALETTE, createCloudMaterial, lerpCloudPalette, type CloudPalette } from './CloudMaterial.js';
import type { WindVector } from './WindState.js';

const CLUSTER_VARIANTS = 5;
/** Puffs ringed around a cluster's tall middle puff. */
const RING_PUFFS_MIN = 5;
const RING_PUFFS_MAX = 7;
/** Ring radius across the cluster's long (X) and short (Z) axes, in unit (pre-instance-scale) space. */
const RING_RADIUS_X = 1.05;
const RING_RADIUS_Z = 0.62;
/** Radius of the tall middle puff, and the range a ring puff's radius is drawn from. */
const MIDDLE_PUFF_RADIUS = 0.78;
const RING_PUFF_RADIUS_MIN = 0.42;
const RING_PUFF_RADIUS_MAX = 0.6;
/** How high a puff's centre rides above the base plane, as a fraction of its radius — the middle one stands tallest. */
const RING_PUFF_RISE = 0.35;
const MIDDLE_PUFF_RISE = 0.6;
/** Plane every puff is squashed onto — the flat cartoon underside. */
const CLUSTER_BASE_Y = -0.2;
/** Fraction of its depth a puff keeps below the base plane (0 = sliced flat). */
const BASE_SQUASH = 0.15;
/** Icosphere edge subdivisions ((n+1)² triangles per face): big puffs carry the silhouette, small ones never fill enough screen to show a facet. */
const PUFF_DETAIL_LARGE = 6;
const PUFF_DETAIL_SMALL = 4;
const LARGE_PUFF_RADIUS = 0.45;
const INSTANCE_COUNT = 40;
const DISC_RADIUS = 2000;
const HEIGHT_BASE = 180;
const HEIGHT_SPREAD = 80;
const SCALE_MIN = 30;
const SCALE_MAX = 90;
/** Drift speed (m/s) at wind speed 1 (storm). */
const DRIFT_SPEED = 18;
/** CPU shadow-offset accumulates at the same rate as visible drift, so shadow patches track the clouds that cast them exactly. */
const SHADOW_PARALLAX = 1.0;
/**
 * How far each vertex normal leans from its own puff toward the whole
 * cluster's: 0 shades every puff as its own ball (a cloud reads as a pile of
 * bubbles from above), 1 shades one smooth egg. In between, the light/shade
 * line runs across the cloud as one wavy edge that still dips at each bump.
 */
const CLUSTER_NORMAL_BLEND = 0.75;
/**
 * Outline width cap in world metres. The model default (a few cm) suits a
 * worker at arm's length; a cloud hundreds of metres away needs the full
 * screen-constant line, or it loses its outline entirely.
 */
const OUTLINE_MAX_WORLD = 4;
/**
 * Outline depth push, in unit cluster space (`createOutlineMaterial`'s
 * `depthPush`): deep enough that one puff's rim sinks behind the puffs it
 * overlaps, so a cloud is outlined once around its silhouette instead of once
 * per puff — shallow enough to stay in front of the ground behind it.
 */
const OUTLINE_DEPTH_PUSH = 1.0;
/** Fraction of instances still shown at the lightest coverage (sunny/heat_wave) — a totally empty sky reads as "no clouds implemented" rather than "clear day". */
const MIN_VISIBLE_FRACTION = 0.15;

/** Target cloud coverage per weather state — same states SkyboxWeather keys off. */
const COVERAGE_TARGET: Record<WeatherState, number> = {
  sunny: 0.25,
  cloudy: 0.7,
  light_rain: 0.9,
  heavy_rain: 0.9,
  storm: 1.0,
  heat_wave: 0.08,
  cold_snap: 0.5,
};

/** Lerp rate matching SkyboxWeather's own sky-color transition speed, so cloud thickening reads as part of the same weather change. */
const TRANSITION_SPEED = 0.5;

interface CloudInstance {
  variant: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
}

interface Puff {
  center: THREE.Vector3;
  radius: number;
}

/**
 * Where a cluster's puffs sit: one tall puff in the middle and a ring of
 * smaller ones around it, every one resting on the same base plane. Seen
 * from any side that is a tall bump with lower bumps stepping down to a flat
 * bottom; seen from above, a flower of rounds — a cartoon cumulus either way.
 */
function layoutPuffs(seed: number, variant: number): Puff[] {
  const rand = (i: number, k: number) => cellRand(seed, variant, i, k);
  const ring = RING_PUFFS_MIN + Math.floor(rand(0, 1) * (RING_PUFFS_MAX - RING_PUFFS_MIN + 1));
  const puffs: Puff[] = [{
    center: new THREE.Vector3(0, CLUSTER_BASE_Y + MIDDLE_PUFF_RADIUS * MIDDLE_PUFF_RISE, 0),
    radius: MIDDLE_PUFF_RADIUS,
  }];
  const phase = rand(0, 2) * Math.PI * 2;
  for (let i = 0; i < ring; i++) {
    const angle = phase + ((i + (rand(i, 3) - 0.5) * 0.4) / ring) * Math.PI * 2;
    const radius = RING_PUFF_RADIUS_MIN + rand(i, 4) * (RING_PUFF_RADIUS_MAX - RING_PUFF_RADIUS_MIN);
    puffs.push({
      center: new THREE.Vector3(
        Math.cos(angle) * RING_RADIUS_X,
        CLUSTER_BASE_Y + radius * RING_PUFF_RISE,
        Math.sin(angle) * RING_RADIUS_Z,
      ),
      radius,
    });
  }
  return puffs;
}

/** One smooth puff: an indexed icosphere (shared vertices, so normals average into a round surface), squashed onto the base plane. */
function buildPuff(puff: Puff): THREE.BufferGeometry {
  const ico = new THREE.IcosahedronGeometry(1, puff.radius >= LARGE_PUFF_RADIUS ? PUFF_DETAIL_LARGE : PUFF_DETAIL_SMALL);
  ico.deleteAttribute('normal');
  ico.deleteAttribute('uv');
  const geo = mergeVertices(ico);
  ico.dispose();
  geo.scale(puff.radius, puff.radius, puff.radius);
  geo.translate(puff.center.x, puff.center.y, puff.center.z);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < CLUSTER_BASE_Y) pos.setY(i, CLUSTER_BASE_Y - (CLUSTER_BASE_Y - y) * BASE_SQUASH);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * True when `p` lies strictly inside another puff of the cluster — such a
 * vertex can never be seen. Every puff shares the same base squash, so
 * un-squashing the point lets it be tested against plain spheres.
 */
function buriedIn(p: THREE.Vector3, puffs: readonly Puff[], self: number): boolean {
  if (p.y < CLUSTER_BASE_Y) p.y = CLUSTER_BASE_Y - (CLUSTER_BASE_Y - p.y) / BASE_SQUASH;
  return puffs.some((other, j) => j !== self && p.distanceTo(other.center) < other.radius * 0.97);
}

/** Drop the triangles a neighbouring puff fully swallows — hidden from every angle, so pure vertex cost. */
function dropBuriedTriangles(geo: THREE.BufferGeometry, puffs: readonly Puff[], self: number): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const index = geo.getIndex()!;
  const p = new THREE.Vector3();
  const buried = Array.from({ length: pos.count }, (_, i) => buriedIn(p.fromBufferAttribute(pos, i), puffs, self));
  const kept: number[] = [];
  for (let t = 0; t < index.count; t += 3) {
    const a = index.getX(t), b = index.getX(t + 1), c = index.getX(t + 2);
    if (!(buried[a] && buried[b] && buried[c])) kept.push(a, b, c);
  }
  geo.setIndex(kept);
}

/** Lean every vertex normal toward the normal of the ellipsoid enclosing the whole cluster (see CLUSTER_NORMAL_BLEND). */
function blendClusterNormals(geo: THREE.BufferGeometry): void {
  geo.computeBoundingBox();
  const box = geo.boundingBox!;
  const center = box.getCenter(new THREE.Vector3());
  // Sit the ellipsoid's centre low, near the base, so the flat underside
  // keeps facing down and the dome above it faces up and out.
  center.y = box.min.y + (box.max.y - box.min.y) * 0.25;
  const half = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const normal = geo.getAttribute('normal') as THREE.BufferAttribute;
  const p = new THREE.Vector3();
  const own = new THREE.Vector3();
  const outer = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).sub(center);
    outer.set(p.x / (half.x * half.x), p.y / (half.y * half.y), p.z / (half.z * half.z)).normalize();
    own.fromBufferAttribute(normal, i).lerp(outer, CLUSTER_NORMAL_BLEND).normalize();
    normal.setXYZ(i, own.x, own.y, own.z);
  }
  normal.needsUpdate = true;
}

/** One cartoon cumulus: its puffs merged into a single smooth-shaded BufferGeometry. */
function buildClusterGeometry(seed: number, variant: number): THREE.BufferGeometry {
  const layout = layoutPuffs(seed, variant);
  const puffs = layout.map((puff, i) => {
    const geo = buildPuff(puff);
    dropBuriedTriangles(geo, layout, i);
    return geo;
  });
  const merged = mergeGeometries(puffs, false) ?? new THREE.IcosahedronGeometry(1, PUFF_DETAIL_LARGE);
  for (const puff of puffs) puff.dispose();
  blendClusterNormals(merged);
  return merged;
}

export class CloudLayer {
  private readonly scene: THREE.Scene;
  /** One surface mesh per variant; each carries its outline hull as a child sharing its instance buffer. */
  private readonly meshes: THREE.InstancedMesh[] = [];
  private readonly outlines: THREE.InstancedMesh[] = [];
  private readonly material: THREE.ShaderMaterial;
  private readonly outlineMaterial: THREE.ShaderMaterial;
  /** Instances grouped by variant, in the fixed order they're drawn — visible count is taken from the front of each group. */
  private readonly byVariant: CloudInstance[][] = [];
  private readonly seed: number;
  private readonly centerX: number;
  private readonly centerZ: number;
  private readonly dummy = new THREE.Object3D();

  private coverage: number;
  private targetCoverage: number;
  private targetPalette: CloudPalette = CLOUD_PALETTE.sunny;
  private readonly cloudOffsetVec = new THREE.Vector2(0, 0);

  constructor(scene: THREE.Scene, levelSeed: number, centerX: number, centerZ: number) {
    this.scene = scene;
    this.seed = subSeed(levelSeed, 'clouds');
    this.centerX = centerX;
    this.centerZ = centerZ;
    this.coverage = COVERAGE_TARGET.sunny;
    this.targetCoverage = COVERAGE_TARGET.sunny;

    this.material = createCloudMaterial(this.targetPalette);
    this.outlineMaterial = createOutlineMaterial(undefined, { maxWorld: OUTLINE_MAX_WORLD, depthPush: OUTLINE_DEPTH_PUSH });
    lerpCloudPalette(this.material, this.outlineMaterial, this.targetPalette, 1);

    for (let v = 0; v < CLUSTER_VARIANTS; v++) {
      const geo = buildClusterGeometry(this.seed, v);
      const capacity = Math.ceil(INSTANCE_COUNT / CLUSTER_VARIANTS);
      const mesh = new THREE.InstancedMesh(geo, this.material, capacity);
      mesh.name = 'cloud-cluster';
      const outline = new THREE.InstancedMesh(geo, this.outlineMaterial, capacity);
      outline.name = 'cloud-cluster-outline';
      outline.instanceMatrix = mesh.instanceMatrix;
      outline.raycast = () => {};
      for (const m of [mesh, outline]) {
        m.castShadow = false;
        m.receiveShadow = false;
        // Instances drift across a 2 km disc; a bounding sphere computed
        // once at first draw would cull clouds that drifted out of it.
        m.frustumCulled = false;
        m.count = 0;
      }
      mesh.add(outline);
      this.scene.add(mesh);
      this.meshes.push(mesh);
      this.outlines.push(outline);
      this.byVariant.push([]);
    }

    for (let i = 0; i < INSTANCE_COUNT; i++) {
      const variant = i % CLUSTER_VARIANTS;
      this.byVariant[variant]!.push(this.spawnInstance(i, variant));
    }
    this.writeAllInstances();
    this.applyVisibleCounts();
  }

  /** Weather changed — retarget coverage and paint; update() lerps toward both at the same rate SkyboxWeather lerps sky color. */
  setWeather(state: WeatherState): void {
    this.targetCoverage = COVERAGE_TARGET[state];
    this.targetPalette = CLOUD_PALETTE[state];
  }

  /** Advance drift and coverage. Call every frame with the shared WindState's current vector. */
  update(dt: number, wind: WindVector): void {
    const blend = Math.min(1, TRANSITION_SPEED * dt);
    this.coverage += (this.targetCoverage - this.coverage) * blend;
    lerpCloudPalette(this.material, this.outlineMaterial, this.targetPalette, blend);

    const dx = wind.x * DRIFT_SPEED * dt;
    const dz = wind.z * DRIFT_SPEED * dt;
    this.cloudOffsetVec.x += dx * SHADOW_PARALLAX;
    this.cloudOffsetVec.y += dz * SHADOW_PARALLAX;

    const discRadiusSq = DISC_RADIUS * DISC_RADIUS;
    for (const group of this.byVariant) {
      for (const inst of group) {
        inst.x += dx;
        inst.z += dz;
        const rx = inst.x - this.centerX;
        const rz = inst.z - this.centerZ;
        if (rx * rx + rz * rz > discRadiusSq) {
          // Re-enter at the antipode, with a fresh seeded lateral offset so
          // it doesn't retrace the exact same drift line every lap.
          const angle = Math.atan2(rz, rx) + Math.PI;
          const lateralSeed = Math.round(this.cloudOffsetVec.x * 100) ^ Math.round(this.cloudOffsetVec.y * 100);
          const lateral = (cellRand(this.seed, inst.variant, lateralSeed, 9) - 0.5) * DISC_RADIUS * 0.4;
          const perpAngle = angle + Math.PI / 2;
          inst.x = this.centerX + Math.cos(angle) * DISC_RADIUS + Math.cos(perpAngle) * lateral;
          inst.z = this.centerZ + Math.sin(angle) * DISC_RADIUS + Math.sin(perpAngle) * lateral;
        }
      }
    }
    this.writeAllInstances();
    this.applyVisibleCounts();
  }

  /** Accumulated wind-scroll offset — feeds TerrainMaterial's `uCloudOffset` uniform directly. */
  get cloudOffset(): THREE.Vector2 {
    return this.cloudOffsetVec;
  }

  /** Current lerped coverage [0,1] — feeds TerrainMaterial's `uCloudCoverage` uniform directly. */
  get cloudCoverage(): number {
    return this.coverage;
  }

  dispose(): void {
    for (const mesh of this.meshes) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
    }
    this.material.dispose();
    this.outlineMaterial.dispose();
  }

  // ---------- Internal ----------

  private spawnInstance(index: number, variant: number): CloudInstance {
    const angle = cellRand(this.seed, variant, index, 10) * Math.PI * 2;
    const radius = Math.sqrt(cellRand(this.seed, variant, index, 11)) * DISC_RADIUS;
    return {
      variant,
      x: this.centerX + Math.cos(angle) * radius,
      y: HEIGHT_BASE + cellRand(this.seed, variant, index, 12) * HEIGHT_SPREAD,
      z: this.centerZ + Math.sin(angle) * radius,
      yaw: cellRand(this.seed, variant, index, 14) * Math.PI * 2,
      scale: SCALE_MIN + cellRand(this.seed, variant, index, 13) * (SCALE_MAX - SCALE_MIN),
    };
  }

  private writeAllInstances(): void {
    for (let v = 0; v < CLUSTER_VARIANTS; v++) {
      const mesh = this.meshes[v]!;
      const group = this.byVariant[v]!;
      for (let i = 0; i < group.length; i++) {
        const inst = group[i]!;
        this.dummy.position.set(inst.x, inst.y, inst.z);
        this.dummy.rotation.y = inst.yaw;
        this.dummy.scale.setScalar(inst.scale);
        this.dummy.updateMatrix();
        mesh.setMatrixAt(i, this.dummy.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Coverage drives how many of each variant's instances are actually drawn. */
  private applyVisibleCounts(): void {
    const fraction = Math.max(MIN_VISIBLE_FRACTION, this.coverage);
    const totalVisible = Math.round(INSTANCE_COUNT * fraction);
    for (let v = 0; v < CLUSTER_VARIANTS; v++) {
      const group = this.byVariant[v]!;
      const share = Math.floor(totalVisible / CLUSTER_VARIANTS) + (v < totalVisible % CLUSTER_VARIANTS ? 1 : 0);
      const count = Math.min(group.length, share);
      this.meshes[v]!.count = count;
      this.outlines[v]!.count = count;
    }
  }
}
