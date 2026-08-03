// BlastSimulator2026 — Chimney smoke: billboard puff emitters at village
// house chimneys, wind-bent (#458 T7.2/D12/A26)
//
// Construct-safe under Node (DataTexture + ShaderMaterial, no canvas/DOM).

import * as THREE from 'three';
import { cellRand, subSeed } from '../../core/math/Hash.js';
import type { Village } from '../../core/world/Structures.js';
import type { WindVector } from './WindState.js';

const PUFFS_PER_CHIMNEY = 4;
const CYCLE_SECONDS = 6;
const RISE_HEIGHT = 8;
const WIND_DRIFT_FACTOR = 6;
const SCALE_MIN = 0.6;
const SCALE_SPREAD = 2.4;
const OPACITY_BASE = 0.5;
const RAMP_TEXTURE_SIZE = 16;

interface Chimney {
  x: number;
  y: number;
  z: number;
  /** Seeded offset (seconds) within the shared 6s cycle, so chimneys don't all puff in lockstep. */
  phase: number;
}

/** Soft round alpha falloff — a puff reads as a soft blob instead of a flat square. */
function buildRadialRampTexture(): THREE.DataTexture {
  const size = RAMP_TEXTURE_SIZE;
  const data = new Uint8Array(size * size * 4);
  const centre = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - centre) / centre;
      const dy = (y - centre) / centre;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const alpha = Math.max(0, 1 - dist);
      const i = (y * size + x) * 4;
      data[i] = 225;
      data[i + 1] = 225;
      data[i + 2] = 225;
      data[i + 3] = Math.round(alpha * alpha * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

export class ChimneySmoke {
  private readonly scene: THREE.Scene;
  private readonly mesh: THREE.InstancedMesh | null = null;
  private readonly material: THREE.ShaderMaterial | null = null;
  private readonly opacityAttr: THREE.InstancedBufferAttribute | null = null;
  private readonly chimneys: Chimney[] = [];
  private time = 0;
  private readonly dummy = new THREE.Object3D();

  constructor(scene: THREE.Scene, levelSeed: number, villages: readonly Village[]) {
    this.scene = scene;
    const seed = subSeed(levelSeed, 'smoke');

    for (const village of villages) {
      for (const house of village.houses) {
        if (!house.hasChimney) continue;
        // Offset toward one roof corner, in the house's own rotated frame,
        // rather than dead-centre (a chimney sits at an edge, not the middle).
        const localX = house.w * 0.25;
        const localZ = house.d * 0.25;
        const cos = Math.cos(house.rotation);
        const sin = Math.sin(house.rotation);
        const x = house.x + localX * cos - localZ * sin;
        const z = house.z + localX * sin + localZ * cos;
        const phase = cellRand(seed, Math.round(house.x * 4), Math.round(house.z * 4), 1) * CYCLE_SECONDS;
        this.chimneys.push({ x, y: house.h + 0.3, z, phase });
      }
    }

    if (this.chimneys.length === 0) return; // no chimneyed houses this level — mesh stays null

    const instanceCount = this.chimneys.length * PUFFS_PER_CHIMNEY;
    const geo = new THREE.PlaneGeometry(1, 1);
    this.opacityAttr = new THREE.InstancedBufferAttribute(new Float32Array(instanceCount), 1);
    geo.setAttribute('aOpacity', this.opacityAttr);

    this.material = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: buildRadialRampTexture() } },
      vertexShader: `
        attribute float aOpacity;
        varying vec2 vUv;
        varying float vOpacity;
        void main() {
          vUv = uv;
          vOpacity = aOpacity;
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D uMap;
        varying vec2 vUv;
        varying float vOpacity;
        void main() {
          vec4 tex = texture2D(uMap, vUv);
          float a = tex.a * vOpacity;
          if (a < 0.01) discard;
          gl_FragColor = vec4(tex.rgb, a);
        }
      `,
      transparent: true,
      depthWrite: false,
    });

    this.mesh = new THREE.InstancedMesh(geo, this.material, instanceCount);
    this.mesh.name = 'chimney-smoke';
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.scene.add(this.mesh);

    this.writeAllInstances({ x: 0, z: 0 }, null);
  }

  update(dt: number, wind: WindVector, cameraPosition: THREE.Vector3): void {
    if (!this.mesh) return;
    this.time += dt;
    this.writeAllInstances(wind, cameraPosition);
  }

  dispose(): void {
    if (!this.mesh) return;
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material!.dispose();
  }

  // ---------- Internal ----------

  private writeAllInstances(wind: WindVector, cameraPosition: THREE.Vector3 | null): void {
    if (!this.mesh || !this.opacityAttr) return;

    let idx = 0;
    for (const chimney of this.chimneys) {
      for (let p = 0; p < PUFFS_PER_CHIMNEY; p++) {
        const puffPhase = chimney.phase + p * (CYCLE_SECONDS / PUFFS_PER_CHIMNEY);
        const t01 = (((this.time + puffPhase) % CYCLE_SECONDS) + CYCLE_SECONDS) % CYCLE_SECONDS / CYCLE_SECONDS;

        const x = chimney.x + wind.x * WIND_DRIFT_FACTOR * t01 * t01;
        const y = chimney.y + RISE_HEIGHT * t01;
        const z = chimney.z + wind.z * WIND_DRIFT_FACTOR * t01 * t01;
        const scale = SCALE_MIN + SCALE_SPREAD * t01;

        this.dummy.position.set(x, y, z);
        if (cameraPosition) {
          this.dummy.lookAt(cameraPosition);
        }
        this.dummy.scale.setScalar(scale);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(idx, this.dummy.matrix);
        this.opacityAttr.setX(idx, OPACITY_BASE * (1 - t01));
        idx++;
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.opacityAttr.needsUpdate = true;
  }
}
