// BlastSimulator2026 — Fireflies: pulsing, drifting glow points for humid
// tropical biomes (#458 T7.3 per-biome ambient extra, executor's pick).
//
// Construct-safe under Node (Points + BufferGeometry, no canvas/DOM).

import * as THREE from 'three';
import { cellRand, subSeed } from '../../core/math/Hash.js';

const CLUSTER_COUNT = 4;
const PER_CLUSTER = 10;
const TOTAL = CLUSTER_COUNT * PER_CLUSTER;

const CLUSTER_SPAWN_RADIUS_MIN = 20;
const CLUSTER_SPAWN_RADIUS_MAX = 120;
const ORBIT_RADIUS_MIN = 1.5;
const ORBIT_RADIUS_MAX = 5;
const ORBIT_SPEED_MIN = 0.3;
const ORBIT_SPEED_MAX = 0.8;
const HEIGHT_MIN = 0.8;
const HEIGHT_MAX = 2.5;
const PULSE_FREQUENCY_MIN = 1.2;
const PULSE_FREQUENCY_MAX = 2.4;
const GLOW_COLOR = new THREE.Color(0xd6ff7a);
const POINT_SIZE = 0.5;

interface Firefly {
  clusterX: number;
  clusterZ: number;
  orbitRadius: number;
  orbitSpeed: number;
  orbitPhase: number;
  height: number;
  pulseFrequency: number;
  pulsePhase: number;
}

export class Fireflies {
  private readonly scene: THREE.Scene;
  private readonly points: THREE.Points;
  private readonly material: THREE.PointsMaterial;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly fireflies: Firefly[] = [];
  private time = 0;

  constructor(
    scene: THREE.Scene, levelSeed: number, centerX: number, centerZ: number,
    private readonly sampleHeight: (x: number, z: number) => number,
  ) {
    this.scene = scene;
    const seed = subSeed(levelSeed, 'fireflies');

    for (let c = 0; c < CLUSTER_COUNT; c++) {
      const angle = cellRand(seed, c, 0, 1) * Math.PI * 2;
      const dist = CLUSTER_SPAWN_RADIUS_MIN + cellRand(seed, c, 0, 2) * (CLUSTER_SPAWN_RADIUS_MAX - CLUSTER_SPAWN_RADIUS_MIN);
      const clusterX = centerX + Math.cos(angle) * dist;
      const clusterZ = centerZ + Math.sin(angle) * dist;
      for (let i = 0; i < PER_CLUSTER; i++) {
        this.fireflies.push({
          clusterX, clusterZ,
          orbitRadius: ORBIT_RADIUS_MIN + cellRand(seed, c, i, 3) * (ORBIT_RADIUS_MAX - ORBIT_RADIUS_MIN),
          orbitSpeed: ORBIT_SPEED_MIN + cellRand(seed, c, i, 4) * (ORBIT_SPEED_MAX - ORBIT_SPEED_MIN),
          orbitPhase: cellRand(seed, c, i, 5) * Math.PI * 2,
          height: HEIGHT_MIN + cellRand(seed, c, i, 6) * (HEIGHT_MAX - HEIGHT_MIN),
          pulseFrequency: PULSE_FREQUENCY_MIN + cellRand(seed, c, i, 7) * (PULSE_FREQUENCY_MAX - PULSE_FREQUENCY_MIN),
          pulsePhase: cellRand(seed, c, i, 8) * Math.PI * 2,
        });
      }
    }

    this.positions = new Float32Array(TOTAL * 3);
    this.colors = new Float32Array(TOTAL * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));

    this.material = new THREE.PointsMaterial({
      size: POINT_SIZE,
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });

    this.points = new THREE.Points(geo, this.material);
    this.points.name = 'fireflies';
    this.scene.add(this.points);

    this.writeAllInstances();
  }

  /** Firefly count — for tests verifying instance placement. */
  get fireflyCount(): number {
    return this.fireflies.length;
  }

  update(dt: number): void {
    this.time += dt;
    this.writeAllInstances();
  }

  dispose(): void {
    this.scene.remove(this.points);
    this.points.geometry.dispose();
    this.material.dispose();
  }

  // ---------- Internal ----------

  private writeAllInstances(): void {
    for (let i = 0; i < this.fireflies.length; i++) {
      const f = this.fireflies[i]!;
      const orbitAngle = this.time * f.orbitSpeed + f.orbitPhase;
      const x = f.clusterX + Math.cos(orbitAngle) * f.orbitRadius;
      const z = f.clusterZ + Math.sin(orbitAngle) * f.orbitRadius;
      const y = this.sampleHeight(x, z) + f.height;

      this.positions[i * 3] = x;
      this.positions[i * 3 + 1] = y;
      this.positions[i * 3 + 2] = z;

      const pulse = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(this.time * f.pulseFrequency + f.pulsePhase));
      this.colors[i * 3] = GLOW_COLOR.r * pulse;
      this.colors[i * 3 + 1] = GLOW_COLOR.g * pulse;
      this.colors[i * 3 + 2] = GLOW_COLOR.b * pulse;
    }
    this.points.geometry.attributes['position']!.needsUpdate = true;
    this.points.geometry.attributes['color']!.needsUpdate = true;
  }
}
