// BlastSimulator2026 — Blast Visual Effects
// Explosion flash → dust cloud → flying fragments → screen shake.
// Every hole fires together at blast start.
//
// Effects:
//   1. Flash: brief bright point lights over the holes
//   2. Dust cloud: expanding sphere of brownish semi-transparent particles
//   3. Screen shake: camera offset proportional to total blast energy
//
// Nothing here adds or removes a scene object after construction (#1603).
// three.js bakes the scene's light count into every lit shader, so a light
// added at detonation recompiled every material on screen — seconds of frozen
// frame. The flash lights are a fixed pool that sits in the scene at zero
// intensity, and the dust cloud is one persistent Points object drawn with an
// empty range while idle, so both shaders compile with the rest of the scene.
//
// All timing is in real-time seconds (not game ticks).

import * as THREE from 'three';

// ---------- Config ----------

// Flash
const FLASH_DURATION = 0.15;       // seconds — visible for ~2 frames at 60fps
const FLASH_INTENSITY_BASE = 80;   // point light intensity at peak, for one hole
const FLASH_COLOR = 0xffdd88;      // warm orange-yellow
const FLASH_DISTANCE = 20;         // metres of light falloff around one hole
/** Point lights permanently in the scene; holes beyond this share a light. */
export const FLASH_LIGHT_POOL_SIZE = 4;

// Dust cloud
const DUST_PARTICLE_COUNT = 300;
const DUST_EXPAND_SPEED = 8.0;     // m/s radius expansion
const DUST_LIFETIME = 3.0;         // seconds before fully faded
const DUST_COLOR = 0xaa8855;       // sandy brown
const DUST_OPACITY = 0.6;

// Screen shake
const SHAKE_DURATION_BASE = 0.5;   // seconds
const SHAKE_AMP_BASE = 0.3;        // metres of camera offset at minimum energy
const SHAKE_AMP_MAX = 2.5;         // maximum shake amplitude

// ---------- Interfaces ----------

export interface HoleDetonation {
  /** Hole grid position. */
  x: number; y: number; z: number;
}

export interface BlastEffectConfig {
  holes: HoleDetonation[];
  /** Normalised energy 0–1 (used to scale shake and dust). */
  energyLevel: number;
  /** Blast origin (centroid of all holes). */
  origin: THREE.Vector3;
}

// ---------- Flash clustering ----------

/** Where one pooled flash light goes, and how many holes it stands for. */
interface FlashCluster {
  x: number; y: number; z: number;
  /** Holes this light stands for. */
  holeCount: number;
  /** Furthest member hole from the cluster centre, in metres. */
  spread: number;
}

/**
 * Group `holes` into at most `poolSize` flash clusters: one per hole while
 * they fit, otherwise contiguous runs along x (then z), each lit from its
 * centroid. Empty for no holes or an empty pool.
 */
export function flashClusters(holes: readonly HoleDetonation[], poolSize: number): FlashCluster[] {
  if (holes.length === 0 || poolSize <= 0) return [];
  const sorted = [...holes].sort((a, b) => a.x - b.x || a.z - b.z);
  const groups = Math.min(poolSize, sorted.length);
  const clusters: FlashCluster[] = [];
  for (let g = 0; g < groups; g++) {
    const members = sorted.slice(Math.floor((g * sorted.length) / groups), Math.floor(((g + 1) * sorted.length) / groups));
    let x = 0, y = 0, z = 0;
    for (const h of members) { x += h.x; y += h.y; z += h.z; }
    x /= members.length; y /= members.length; z /= members.length;
    let spread = 0;
    for (const h of members) spread = Math.max(spread, Math.hypot(h.x - x, h.y - y, h.z - z));
    clusters.push({ x, y, z, holeCount: members.length, spread });
  }
  return clusters;
}

// ---------- Main class ----------

export class BlastEffects {
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.Camera;

  /** Fixed pool, always in the scene — see the file header (#1603). */
  private readonly flashLights: THREE.PointLight[] = [];
  /** Peak intensity per pooled light for the current flash; 0 when unused. */
  private readonly flashPeak: number[] = [];
  private flashRemaining = 0;

  private readonly dustPoints: THREE.Points;
  private readonly dustMaterial: THREE.PointsMaterial;
  private readonly dustPositions = new Float32Array(DUST_PARTICLE_COUNT * 3);
  private readonly dustVelocities = new Float32Array(DUST_PARTICLE_COUNT * 3);
  private dustRemaining = 0;

  private shakeRemaining = 0;
  private shakeAmplitude = 0;
  private cameraBasePos = new THREE.Vector3();

  private isActive = false;

  constructor(scene: THREE.Scene, camera: THREE.Camera) {
    this.scene = scene;
    this.camera = camera;

    for (let i = 0; i < FLASH_LIGHT_POOL_SIZE; i++) {
      // Zero intensity, never `visible = false`: a hidden light drops out of
      // the light count, which is exactly the recompile this pool avoids.
      const light = new THREE.PointLight(FLASH_COLOR, 0, FLASH_DISTANCE);
      this.scene.add(light);
      this.flashLights.push(light);
      this.flashPeak.push(0);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.dustPositions, 3));
    geo.setDrawRange(0, 0); // idle: drawn (so compiled) but empty
    this.dustMaterial = new THREE.PointsMaterial({
      color: DUST_COLOR,
      size: 1.5,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.dustPoints = new THREE.Points(geo, this.dustMaterial);
    // Its positions change every blast; culling against a stale bounding
    // sphere would also skip the load-time compile this object exists for.
    this.dustPoints.frustumCulled = false;
    this.scene.add(this.dustPoints);
  }

  /**
   * Trigger a blast effect sequence.
   * Call immediately after executeBlast() returns.
   */
  trigger(config: BlastEffectConfig): void {
    this.stop(); // clean up any previous blast

    this.isActive = true;
    this.cameraBasePos.copy(this.camera.position);

    // Every hole flashes from the first frame; a pooled light covering
    // several holes burns brighter and reaches further.
    const clusters = flashClusters(config.holes, FLASH_LIGHT_POOL_SIZE);
    clusters.forEach((c, i) => {
      const light = this.flashLights[i]!;
      light.position.set(c.x, c.y, c.z);
      light.distance = FLASH_DISTANCE + c.spread;
      this.flashPeak[i] = FLASH_INTENSITY_BASE * Math.sqrt(c.holeCount);
      light.intensity = this.flashPeak[i]!;
    });
    this.flashRemaining = clusters.length > 0 ? FLASH_DURATION : 0;

    // Dust cloud — burst of particles from blast origin
    this.spawnDust(config.origin, config.energyLevel);

    // Screen shake
    const shakeScale = 0.2 + config.energyLevel * 0.8;
    this.shakeAmplitude = THREE.MathUtils.clamp(
      SHAKE_AMP_BASE + shakeScale * (SHAKE_AMP_MAX - SHAKE_AMP_BASE),
      SHAKE_AMP_BASE, SHAKE_AMP_MAX,
    );
    this.shakeRemaining = SHAKE_DURATION_BASE * (1 + shakeScale);
  }

  /**
   * Update all active effects. Call every frame.
   * @param dt - seconds since last frame
   */
  update(dt: number): void {
    if (!this.isActive) return;

    // --- Flash ---
    if (this.flashRemaining > 0) {
      this.flashRemaining = Math.max(0, this.flashRemaining - dt);
      const fade = this.flashRemaining / FLASH_DURATION;
      this.flashLights.forEach((light, i) => { light.intensity = this.flashPeak[i]! * fade; });
    }

    // --- Dust cloud ---
    if (this.dustRemaining > 0) {
      this.dustRemaining -= dt;
      if (this.dustRemaining <= 0) {
        this.clearDust();
      } else {
        const t = 1 - this.dustRemaining / DUST_LIFETIME;
        this.dustMaterial.opacity = DUST_OPACITY * (1 - t);

        // Move particles outward
        const pos = this.dustPositions;
        const vel = this.dustVelocities;
        for (let i = 0; i < DUST_PARTICLE_COUNT; i++) {
          const i3 = i * 3;
          pos[i3]     = (pos[i3]     ?? 0) + (vel[i3]     ?? 0) * dt;
          pos[i3 + 1] = (pos[i3 + 1] ?? 0) + (vel[i3 + 1] ?? 0) * dt;
          pos[i3 + 2] = (pos[i3 + 2] ?? 0) + (vel[i3 + 2] ?? 0) * dt;
          // Decelerate
          vel[i3]     = (vel[i3]     ?? 0) * (1 - dt * 0.8);
          vel[i3 + 1] = (vel[i3 + 1] ?? 0) * (1 - dt * 1.5);
          vel[i3 + 2] = (vel[i3 + 2] ?? 0) * (1 - dt * 0.8);
        }
        (this.dustPoints.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      }
    }

    // --- Screen shake ---
    if (this.shakeRemaining > 0) {
      this.shakeRemaining -= dt;
      const t = this.shakeRemaining / (SHAKE_DURATION_BASE * 2);
      const amp = this.shakeAmplitude * t;
      const sx = (Math.random() - 0.5) * 2 * amp;
      const sy = (Math.random() - 0.5) * amp;
      const sz = (Math.random() - 0.5) * 2 * amp;
      this.camera.position.set(
        this.cameraBasePos.x + sx,
        this.cameraBasePos.y + sy,
        this.cameraBasePos.z + sz,
      );
      if (this.shakeRemaining <= 0) {
        this.camera.position.copy(this.cameraBasePos);
      }
    }

    // Check if everything is done
    if (this.flashRemaining <= 0 && this.dustRemaining <= 0 && this.shakeRemaining <= 0) {
      this.isActive = false;
    }
  }

  get active(): boolean {
    return this.isActive;
  }

  /** Immediately cancel all effects, leaving the pooled objects idle in the scene. */
  stop(): void {
    this.clearFlash();
    this.clearDust();

    if (this.shakeRemaining > 0) {
      this.camera.position.copy(this.cameraBasePos);
    }
    this.shakeRemaining = 0;
    this.isActive = false;
  }

  /** Stop, then take the pooled objects out of the scene for good. */
  dispose(): void {
    this.stop();
    for (const light of this.flashLights) {
      this.scene.remove(light);
      light.dispose();
    }
    this.scene.remove(this.dustPoints);
    this.dustPoints.geometry.dispose();
    this.dustMaterial.dispose();
  }

  // ---------- Internal ----------

  private clearFlash(): void {
    this.flashRemaining = 0;
    this.flashLights.forEach((light, i) => {
      light.intensity = 0;
      this.flashPeak[i] = 0;
    });
  }

  private clearDust(): void {
    this.dustRemaining = 0;
    this.dustMaterial.opacity = 0;
    this.dustPoints.geometry.setDrawRange(0, 0);
  }

  private spawnDust(origin: THREE.Vector3, energyLevel: number): void {
    const positions = this.dustPositions;
    const velocities = this.dustVelocities;
    const speed = DUST_EXPAND_SPEED * (0.5 + energyLevel);

    for (let i = 0; i < DUST_PARTICLE_COUNT; i++) {
      // Start near blast origin with small jitter
      positions[i * 3]     = origin.x + (Math.random() - 0.5) * 3;
      positions[i * 3 + 1] = origin.y + Math.random() * 2;
      positions[i * 3 + 2] = origin.z + (Math.random() - 0.5) * 3;

      // Spherical outward velocity
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      const r = (0.3 + Math.random() * 0.7) * speed;
      velocities[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
      velocities[i * 3 + 1] = r * Math.abs(Math.cos(phi)) * 1.5; // bias upward
      velocities[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }

    const geo = this.dustPoints.geometry;
    (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    geo.setDrawRange(0, DUST_PARTICLE_COUNT);
    // Size and opacity are uniforms: changing them never recompiles.
    this.dustMaterial.size = 1.5 + energyLevel * 2;
    this.dustMaterial.opacity = DUST_OPACITY;
    this.dustRemaining = DUST_LIFETIME;
  }
}
