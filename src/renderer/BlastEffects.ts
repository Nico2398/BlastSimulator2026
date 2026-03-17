// BlastSimulator2026 — Blast Visual Effects
// Explosion flash → dust cloud → flying fragments → screen shake.
// Synchronized with the detonation sequence: each hole fires at its delay time.
//
// Effects:
//   1. Per-hole flash: brief bright point light at hole position
//   2. Dust cloud: expanding sphere of brownish semi-transparent particles
//   3. Screen shake: camera offset proportional to total blast energy
//
// All timing is in real-time seconds (not game ticks).

import * as THREE from 'three';

// ---------- Config ----------

// Flash per hole
const FLASH_DURATION = 0.15;       // seconds
const FLASH_INTENSITY_BASE = 80;   // point light intensity at peak
const FLASH_COLOR = 0xffdd88;      // warm orange-yellow

// Dust cloud
const DUST_PARTICLE_COUNT = 300;
const DUST_EXPAND_SPEED = 8.0;     // m/s radius expansion
const DUST_LIFETIME = 3.0;         // seconds before fully faded
const DUST_COLOR = 0xaa8855;       // sandy brown

// Screen shake
const SHAKE_DURATION_BASE = 0.5;   // seconds
const SHAKE_AMP_BASE = 0.3;        // metres of camera offset at minimum energy
const SHAKE_AMP_MAX = 2.5;         // maximum shake amplitude

// ---------- Interfaces ----------

export interface HoleDetonation {
  /** Hole grid position. */
  x: number; y: number; z: number;
  /** Time relative to blast start when this hole fires (seconds). */
  delaySeconds: number;
}

export interface BlastEffectConfig {
  holes: HoleDetonation[];
  /** Normalised energy 0–1 (used to scale shake and dust). */
  energyLevel: number;
  /** Blast origin (centroid of all holes). */
  origin: THREE.Vector3;
}

// ---------- Internal state ----------

interface FlashState {
  light: THREE.PointLight;
  triggerTime: number;
  remaining: number;
}

interface DustState {
  points: THREE.Points;
  positions: Float32Array;
  velocities: Float32Array;
  remaining: number;
}

// ---------- Main class ----------

export class BlastEffects {
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.Camera;

  private flashes: FlashState[] = [];
  private dust: DustState | null = null;
  private shakeRemaining = 0;
  private shakeAmplitude = 0;
  private cameraBasePos = new THREE.Vector3();

  private isActive = false;
  private startTime = 0;

  constructor(scene: THREE.Scene, camera: THREE.Camera) {
    this.scene = scene;
    this.camera = camera;
  }

  /**
   * Trigger a blast effect sequence.
   * Call immediately after executeBlast() returns.
   */
  trigger(config: BlastEffectConfig): void {
    this.stop(); // clean up any previous blast

    this.isActive = true;
    this.startTime = performance.now() / 1000;
    this.cameraBasePos.copy(this.camera.position);

    // Schedule one flash per hole
    for (const hole of config.holes) {
      const light = new THREE.PointLight(FLASH_COLOR, 0, 20);
      light.position.set(hole.x, hole.y, hole.z);
      this.scene.add(light);
      this.flashes.push({
        light,
        triggerTime: this.startTime + hole.delaySeconds,
        remaining: -1, // not yet triggered
      });
    }

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

    const now = performance.now() / 1000;

    // --- Per-hole flashes ---
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i]!;
      if (f.remaining < 0 && now >= f.triggerTime) {
        // Trigger this hole
        f.remaining = FLASH_DURATION;
        f.light.intensity = FLASH_INTENSITY_BASE;
      }
      if (f.remaining > 0) {
        f.remaining -= dt;
        // Fade out
        f.light.intensity = FLASH_INTENSITY_BASE * (f.remaining / FLASH_DURATION);
        if (f.remaining <= 0) {
          f.light.intensity = 0;
          this.scene.remove(f.light);
          this.flashes.splice(i, 1);
        }
      }
    }

    // --- Dust cloud ---
    if (this.dust) {
      this.dust.remaining -= dt;
      if (this.dust.remaining <= 0) {
        this.scene.remove(this.dust.points);
        this.dust.points.geometry.dispose();
        (this.dust.points.material as THREE.Material).dispose();
        this.dust = null;
      } else {
        const t = 1 - this.dust.remaining / DUST_LIFETIME;
        const mat = this.dust.points.material as THREE.PointsMaterial;
        mat.opacity = 0.6 * (1 - t);

        // Move particles outward
        const pos = this.dust.positions;
        const vel = this.dust.velocities;
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
        (this.dust.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
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
    if (this.flashes.length === 0 && !this.dust && this.shakeRemaining <= 0) {
      this.isActive = false;
    }
  }

  get active(): boolean {
    return this.isActive;
  }

  /** Immediately cancel and clean up all effects. */
  stop(): void {
    for (const f of this.flashes) {
      this.scene.remove(f.light);
    }
    this.flashes = [];

    if (this.dust) {
      this.scene.remove(this.dust.points);
      this.dust.points.geometry.dispose();
      (this.dust.points.material as THREE.Material).dispose();
      this.dust = null;
    }

    if (this.shakeRemaining > 0) {
      this.camera.position.copy(this.cameraBasePos);
    }
    this.shakeRemaining = 0;
    this.isActive = false;
  }

  dispose(): void {
    this.stop();
  }

  // ---------- Internal ----------

  private spawnDust(origin: THREE.Vector3, energyLevel: number): void {
    const positions = new Float32Array(DUST_PARTICLE_COUNT * 3);
    const velocities = new Float32Array(DUST_PARTICLE_COUNT * 3);

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

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: DUST_COLOR,
      size: 1.5 + energyLevel * 2,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
    });

    const points = new THREE.Points(geo, mat);
    this.scene.add(points);

    this.dust = { points, positions, velocities, remaining: DUST_LIFETIME };
  }
}
