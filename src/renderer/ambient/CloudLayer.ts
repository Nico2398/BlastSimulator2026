// BlastSimulator2026 — Ambient cloud layer: drifting instanced clusters, plus
// the CPU-side scroll offset TerrainMaterial's cloud-shadow term reads, so
// visible clouds and their ground shadows never desync (#458 T7.1/D12/A25).
//
// Construct-safe under Node (no DOM/WebGL at construction — geometry is
// built from THREE primitives merged in JS, no canvas/texture loads) so it
// can be exercised by a bare `new CloudLayer(scene, seed, ...)` unit test.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { WeatherState } from '../../core/weather/WeatherCycle.js';
import { cellRand, subSeed } from '../../core/math/Hash.js';
import type { WindVector } from './WindState.js';

const CLUSTER_VARIANTS = 5;
const PUFFS_PER_CLUSTER_MIN = 3;
const PUFFS_PER_CLUSTER_MAX = 7;
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
const CLOUD_COLOR = new THREE.Color(0xfff6e8);
const STORM_CLOUD_COLOR = new THREE.Color(0x555a63);
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
  scale: number;
}

/** One low-poly puff cluster: several stretched icospheres merged into a single flat-shaded BufferGeometry. */
function buildClusterGeometry(seed: number, variant: number): THREE.BufferGeometry {
  const puffCount = PUFFS_PER_CLUSTER_MIN
    + Math.floor(cellRand(seed, variant, 0, 1) * (PUFFS_PER_CLUSTER_MAX - PUFFS_PER_CLUSTER_MIN + 1));

  const puffs: THREE.BufferGeometry[] = [];
  for (let i = 0; i < puffCount; i++) {
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const rx = 0.6 + cellRand(seed, variant, i, 2) * 0.8;
    const ry = 0.35 + cellRand(seed, variant, i, 3) * 0.35;
    const rz = 0.6 + cellRand(seed, variant, i, 4) * 0.8;
    geo.scale(rx, ry, rz);
    const ox = (cellRand(seed, variant, i, 5) - 0.5) * 2.4;
    const oy = (cellRand(seed, variant, i, 6) - 0.5) * 0.5;
    const oz = (cellRand(seed, variant, i, 7) - 0.5) * 2.4;
    geo.translate(ox, oy, oz);
    puffs.push(geo);
  }

  const merged = mergeGeometries(puffs, false) ?? new THREE.IcosahedronGeometry(1, 0);
  merged.computeVertexNormals();
  for (const puff of puffs) puff.dispose();
  return merged;
}

export class CloudLayer {
  private readonly scene: THREE.Scene;
  private readonly meshes: THREE.InstancedMesh[] = [];
  private readonly material: THREE.MeshStandardMaterial;
  /** Instances grouped by variant, in the fixed order they're drawn — visible count is taken from the front of each group. */
  private readonly byVariant: CloudInstance[][] = [];
  private readonly seed: number;
  private readonly centerX: number;
  private readonly centerZ: number;
  private readonly dummy = new THREE.Object3D();

  private coverage: number;
  private targetCoverage: number;
  private readonly cloudOffsetVec = new THREE.Vector2(0, 0);

  constructor(scene: THREE.Scene, levelSeed: number, centerX: number, centerZ: number) {
    this.scene = scene;
    this.seed = subSeed(levelSeed, 'clouds');
    this.centerX = centerX;
    this.centerZ = centerZ;
    this.coverage = COVERAGE_TARGET.sunny;
    this.targetCoverage = COVERAGE_TARGET.sunny;

    this.material = new THREE.MeshStandardMaterial({
      color: CLOUD_COLOR,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });

    for (let v = 0; v < CLUSTER_VARIANTS; v++) {
      const geo = buildClusterGeometry(this.seed, v);
      const capacity = Math.ceil(INSTANCE_COUNT / CLUSTER_VARIANTS);
      const mesh = new THREE.InstancedMesh(geo, this.material, capacity);
      mesh.name = 'cloud-cluster';
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.count = 0;
      this.scene.add(mesh);
      this.meshes.push(mesh);
      this.byVariant.push([]);
    }

    for (let i = 0; i < INSTANCE_COUNT; i++) {
      const variant = i % CLUSTER_VARIANTS;
      this.byVariant[variant]!.push(this.spawnInstance(i, variant));
    }
    this.writeAllInstances();
    this.applyVisibleCounts();
  }

  /** Weather changed — retarget coverage; update() lerps toward it at the same rate SkyboxWeather lerps sky color. */
  setWeather(state: WeatherState): void {
    this.targetCoverage = COVERAGE_TARGET[state];
    this.material.color.copy(state === 'storm' ? STORM_CLOUD_COLOR : CLOUD_COLOR);
  }

  /** Advance drift and coverage. Call every frame with the shared WindState's current vector. */
  update(dt: number, wind: WindVector): void {
    this.coverage += (this.targetCoverage - this.coverage) * TRANSITION_SPEED * dt;

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
      this.meshes[v]!.count = Math.min(group.length, share);
    }
  }
}
