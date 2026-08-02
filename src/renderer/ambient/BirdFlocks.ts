// BlastSimulator2026 — Ambient bird flocks: seeded circular flight paths,
// wing-flap animation, and blast-triggered scatter (#458 T7.2/D12/A26)

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { cellRand, subSeed } from '../../core/math/Hash.js';

const FLOCK_COUNT = 6;
const BIRDS_PER_FLOCK = 12;
const TOTAL_BIRDS = FLOCK_COUNT * BIRDS_PER_FLOCK;

const RADIUS_MIN = 80;
const RADIUS_MAX = 200;
const HEIGHT_MIN = 60;
const HEIGHT_MAX = 120;
const ANGULAR_SPEED_MIN = 0.05;
const ANGULAR_SPEED_MAX = 0.1;
/** How far a flock's centre may seed from the landscape centre. */
const CENTER_OFFSET_MIN = 250;
const CENTER_OFFSET_MAX = 800;

/** Per-bird stagger along the flock's circle (radians). */
const BIRD_STAGGER = 0.12;
const BOB_AMPLITUDE = 1.5;
const BOB_FREQUENCY = 2;
const WING_AMPLITUDE = 0.4;
const WING_FREQUENCY = 9;
const BIRD_SCALE = 0.6;

/** A blast within this many metres of a flock's centre scatters it. */
const SCATTER_TRIGGER_RADIUS = 250;
const SCATTER_DECAY_SECONDS = 4;
const SCATTER_OUTWARD_OFFSET_MAX = 20;

interface Flock {
  centerX: number;
  centerZ: number;
  height: number;
  baseRadius: number;
  angularSpeed: number;
  direction: 1 | -1;
  phase: number;
  /** 0 (calm) to 1 (just scattered), decaying linearly over SCATTER_DECAY_SECONDS. */
  scatter: number;
}

/** Fuselage cone + two flattened-box wings, merged into one ~30-tri geometry. */
function buildBirdGeometry(): THREE.BufferGeometry {
  const body = new THREE.ConeGeometry(0.3, 1.2, 6);
  body.rotateX(Math.PI / 2);

  const wingL = new THREE.BoxGeometry(1.6, 0.05, 0.4);
  wingL.translate(-0.9, 0, 0);
  const wingR = new THREE.BoxGeometry(1.6, 0.05, 0.4);
  wingR.translate(0.9, 0, 0);

  const merged = mergeGeometries([body, wingL, wingR], false) ?? body;
  merged.computeVertexNormals();
  body.dispose();
  wingL.dispose();
  wingR.dispose();
  return merged;
}

export class BirdFlocks {
  private readonly scene: THREE.Scene;
  private readonly mesh: THREE.InstancedMesh;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly flocks: Flock[] = [];
  private time = 0;
  private readonly dummy = new THREE.Object3D();

  constructor(scene: THREE.Scene, levelSeed: number, centerX: number, centerZ: number) {
    this.scene = scene;
    const seed = subSeed(levelSeed, 'birds');

    this.material = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.8 });
    const geo = buildBirdGeometry();
    this.mesh = new THREE.InstancedMesh(geo, this.material, TOTAL_BIRDS);
    this.mesh.name = 'bird-flocks';
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.scene.add(this.mesh);

    for (let f = 0; f < FLOCK_COUNT; f++) {
      const offsetAngle = cellRand(seed, f, 0, 1) * Math.PI * 2;
      const offsetDist = CENTER_OFFSET_MIN + cellRand(seed, f, 0, 2) * (CENTER_OFFSET_MAX - CENTER_OFFSET_MIN);
      this.flocks.push({
        centerX: centerX + Math.cos(offsetAngle) * offsetDist,
        centerZ: centerZ + Math.sin(offsetAngle) * offsetDist,
        height: HEIGHT_MIN + cellRand(seed, f, 0, 3) * (HEIGHT_MAX - HEIGHT_MIN),
        baseRadius: RADIUS_MIN + cellRand(seed, f, 0, 4) * (RADIUS_MAX - RADIUS_MIN),
        angularSpeed: ANGULAR_SPEED_MIN + cellRand(seed, f, 0, 5) * (ANGULAR_SPEED_MAX - ANGULAR_SPEED_MIN),
        direction: cellRand(seed, f, 0, 6) < 0.5 ? 1 : -1,
        phase: cellRand(seed, f, 0, 7) * Math.PI * 2,
        scatter: 0,
      });
    }

    this.writeAllInstances();
  }

  /** Flock centre positions — read-only, for tests verifying scatter/orbit radius against a flock's own centre rather than an arbitrary world point. */
  get flockCenters(): ReadonlyArray<{ x: number; z: number }> {
    return this.flocks.map(f => ({ x: f.centerX, z: f.centerZ }));
  }

  /** A blast fired at (originX, originZ) — flocks within SCATTER_TRIGGER_RADIUS panic. */
  onBlast(originX: number, originZ: number): void {
    for (const flock of this.flocks) {
      const dx = flock.centerX - originX;
      const dz = flock.centerZ - originZ;
      if (dx * dx + dz * dz <= SCATTER_TRIGGER_RADIUS * SCATTER_TRIGGER_RADIUS) {
        flock.scatter = 1;
      }
    }
  }

  update(dt: number): void {
    this.time += dt;
    for (const flock of this.flocks) {
      if (flock.scatter > 0) {
        flock.scatter = Math.max(0, flock.scatter - dt / SCATTER_DECAY_SECONDS);
      }
    }
    this.writeAllInstances();
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
  }

  // ---------- Internal ----------

  private writeAllInstances(): void {
    let idx = 0;
    for (const flock of this.flocks) {
      const radius = flock.baseRadius * (1 + flock.scatter) + flock.scatter * SCATTER_OUTWARD_OFFSET_MAX;
      const angularSpeed = flock.angularSpeed * (1 + 2 * flock.scatter) * flock.direction;
      const a = flock.phase + this.time * angularSpeed;

      for (let i = 0; i < BIRDS_PER_FLOCK; i++) {
        const birdAngle = a + i * BIRD_STAGGER;
        const cos = Math.cos(birdAngle);
        const sin = Math.sin(birdAngle);
        const bob = BOB_AMPLITUDE * Math.sin(this.time * BOB_FREQUENCY + i);
        const x = flock.centerX + radius * cos;
        const y = flock.height + bob;
        const z = flock.centerZ + radius * sin;

        // Tangent to the circle at this angle, signed by travel direction.
        const dir = flock.direction;
        const tangentX = -sin * dir;
        const tangentZ = cos * dir;
        const heading = Math.atan2(tangentX, tangentZ);

        const wingFlap = 1 + WING_AMPLITUDE * Math.sin(this.time * WING_FREQUENCY + i);

        this.dummy.position.set(x, y, z);
        this.dummy.rotation.set(0, heading, 0);
        this.dummy.scale.set(BIRD_SCALE, BIRD_SCALE * wingFlap, BIRD_SCALE);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(idx, this.dummy.matrix);
        idx++;
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
