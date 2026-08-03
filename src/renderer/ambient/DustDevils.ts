// BlastSimulator2026 — Dust devils: spinning, wandering translucent funnels
// for arid biomes (#458 T7.3 per-biome ambient extra, executor's pick).
//
// Construct-safe under Node (basic geometry + material, no canvas/DOM).

import * as THREE from 'three';
import { cellRand, subSeed } from '../../core/math/Hash.js';

const DEVIL_COUNT = 4;
const SPAWN_RADIUS_MIN = 40;
const SPAWN_RADIUS_MAX = 160;
const SPIN_SPEED_MIN = 1.5;
const SPIN_SPEED_MAX = 3;
const WANDER_RADIUS_MIN = 3;
const WANDER_RADIUS_MAX = 9;
const WANDER_SPEED_MIN = 0.15;
const WANDER_SPEED_MAX = 0.35;
const HEIGHT = 10;
const TOP_RADIUS = 0.4;
const BASE_RADIUS = 1.8;
const BREATHE_AMPLITUDE = 0.15;
const BREATHE_FREQUENCY = 0.8;

interface Devil {
  baseX: number;
  baseZ: number;
  spinSpeed: number;
  wanderRadius: number;
  wanderSpeed: number;
  phase: number;
}

export class DustDevils {
  private readonly scene: THREE.Scene;
  private readonly mesh: THREE.InstancedMesh;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly devils: Devil[] = [];
  private time = 0;
  private readonly dummy = new THREE.Object3D();

  constructor(
    scene: THREE.Scene, levelSeed: number, centerX: number, centerZ: number,
    private readonly sampleHeight: (x: number, z: number) => number,
  ) {
    this.scene = scene;
    const seed = subSeed(levelSeed, 'dust-devils');

    this.material = new THREE.MeshBasicMaterial({
      color: 0xc9a878,
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const geo = new THREE.CylinderGeometry(TOP_RADIUS, BASE_RADIUS, HEIGHT, 8, 1, true);
    geo.translate(0, HEIGHT / 2, 0);
    this.mesh = new THREE.InstancedMesh(geo, this.material, DEVIL_COUNT);
    this.mesh.name = 'dust-devils';
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.scene.add(this.mesh);

    for (let i = 0; i < DEVIL_COUNT; i++) {
      const angle = cellRand(seed, i, 0, 1) * Math.PI * 2;
      const dist = SPAWN_RADIUS_MIN + cellRand(seed, i, 0, 2) * (SPAWN_RADIUS_MAX - SPAWN_RADIUS_MIN);
      this.devils.push({
        baseX: centerX + Math.cos(angle) * dist,
        baseZ: centerZ + Math.sin(angle) * dist,
        spinSpeed: SPIN_SPEED_MIN + cellRand(seed, i, 0, 3) * (SPIN_SPEED_MAX - SPIN_SPEED_MIN),
        wanderRadius: WANDER_RADIUS_MIN + cellRand(seed, i, 0, 4) * (WANDER_RADIUS_MAX - WANDER_RADIUS_MIN),
        wanderSpeed: WANDER_SPEED_MIN + cellRand(seed, i, 0, 5) * (WANDER_SPEED_MAX - WANDER_SPEED_MIN),
        phase: cellRand(seed, i, 0, 6) * Math.PI * 2,
      });
    }

    this.writeAllInstances();
  }

  /** Devil count — for tests verifying instance placement. */
  get devilCount(): number {
    return this.devils.length;
  }

  update(dt: number): void {
    this.time += dt;
    this.writeAllInstances();
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
  }

  // ---------- Internal ----------

  private writeAllInstances(): void {
    for (let i = 0; i < this.devils.length; i++) {
      const devil = this.devils[i]!;
      const wanderAngle = this.time * devil.wanderSpeed + devil.phase;
      const x = devil.baseX + Math.cos(wanderAngle) * devil.wanderRadius;
      const z = devil.baseZ + Math.sin(wanderAngle) * devil.wanderRadius;
      const breathe = 1 + BREATHE_AMPLITUDE * Math.sin(this.time * BREATHE_FREQUENCY + devil.phase);

      this.dummy.position.set(x, this.sampleHeight(x, z), z);
      this.dummy.rotation.set(0, this.time * devil.spinSpeed, 0);
      this.dummy.scale.set(breathe, 1, breathe);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
