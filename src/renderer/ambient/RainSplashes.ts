// BlastSimulator2026 — Rain splashes: little cartoon "plips" where drops hit
// the ground (#1601).
//
// Each slot replays one splash over and over on the rain clock (game time).
// Every cycle it lands at a fresh, hash-chosen spot around the view, samples the
// ground height there once, and stays put in the world while its ring spreads —
// so splashes never slide with the camera, freeze mid-ring when the game is
// paused, and come faster at a higher time scale.
//
// Construct-safe under Node (InstancedBufferGeometry + ShaderMaterial, no DOM).

import * as THREE from 'three';
import { cellRand } from '../../core/math/Hash.js';
import { RAIN_SPLASH_VERTEX_SHADER, RAIN_SPLASH_FRAGMENT_SHADER } from './RainShaders.js';

const SPLASH_SLOTS = 1000;
/** Game seconds one splash takes to spread and fade. */
const SPLASH_LIFE = 0.4;
/** Half-width and height (m) of the splash's quad — how far its droplets can fly. */
const SPLASH_SIZE = 0.2;
/** Lifted off the sampled ground so the splat at its foot never z-fights the terrain. */
const SPLASH_LIFT = 0.03;
/** Drawn this far (m) toward the camera, so a splash on a slope is not half buried in it. */
const SPLASH_DEPTH_PULL = 0.3;
/** Width (m) of the square splashes land in, per metre of camera distance. */
const SPLASH_WINDOW_PER_DISTANCE = 2.5;
const SPLASH_WINDOW_MIN = 20;
const SPLASH_WINDOW_MAX = 180;
/** Camera distances (m) over which splashes fade out — past this they are sub-pixel. */
const SPLASH_FADE_START = 45;
const SPLASH_FADE_END = 90;
const SPLASH_COLOR = new THREE.Color(0xe6f2ff);
const SPLASH_OPACITY_SCALE = 0.75;

/** Hash salts — distinct from RainField's so the two never correlate. */
const SALT_PHASE = 21;
const SALT_X = 22;
const SALT_Z = 23;
const SALT_SEED = 24;

/** Ground height at (x, z), or null where there is no ground to splash on. */
export type GroundSampler = (x: number, z: number) => number | null;

/** Placed far in the past, so a slot with nowhere to land draws nothing. */
const NEVER_BORN = -1e9;
/**
 * The shader reads landing times as float32, which would lose the splash's
 * fraction of a second after enough hours of game time — so both the clock and
 * every landing time are kept relative to a base that steps forward this often.
 */
const CLOCK_REBASE_INTERVAL = 1024;

export class RainSplashes {
  private readonly scene: THREE.Scene;
  private readonly seed: number;
  private readonly sampleGround: GroundSampler;
  private readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly splashes: Float32Array;
  private readonly splashAttr: THREE.InstancedBufferAttribute;
  /** Per-slot cycle phase, so slots never all land on the same frame. */
  private readonly phases: Float32Array;
  /** Cycle index each slot was last placed for; -1 forces a placement. */
  private readonly cycles: Float64Array;
  /** Rain-clock origin the GPU-side times are measured from — see CLOCK_REBASE_INTERVAL. */
  private clockBase = 0;

  constructor(scene: THREE.Scene, seed: number, sampleGround: GroundSampler) {
    this.scene = scene;
    this.seed = seed;
    this.sampleGround = sampleGround;

    this.splashes = new Float32Array(SPLASH_SLOTS * 4);
    this.phases = new Float32Array(SPLASH_SLOTS);
    this.cycles = new Float64Array(SPLASH_SLOTS).fill(-1);
    const seeds = new Float32Array(SPLASH_SLOTS);
    for (let i = 0; i < SPLASH_SLOTS; i++) {
      this.phases[i] = cellRand(seed, i, 0, SALT_PHASE);
      seeds[i] = cellRand(seed, i, 0, SALT_SEED);
      this.splashes[i * 4 + 3] = NEVER_BORN;
    }

    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0], 3));
    geo.setIndex([0, 2, 1, 1, 2, 3]);
    this.splashAttr = new THREE.InstancedBufferAttribute(this.splashes, 4);
    this.splashAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aSplash', this.splashAttr);
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
    geo.instanceCount = SPLASH_SLOTS;

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uClock: { value: 0 },
        uLife: { value: SPLASH_LIFE },
        uSize: { value: SPLASH_SIZE },
        uDepthPull: { value: SPLASH_DEPTH_PULL },
        uOpacity: { value: 0 },
        uDensity: { value: 0 },
        uColor: { value: SPLASH_COLOR.clone() },
      },
      vertexShader: RAIN_SPLASH_VERTEX_SHADER,
      fragmentShader: RAIN_SPLASH_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'rain-splashes';
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.scene.add(this.mesh);
  }

  /** Splash slots — for tests. */
  get slotCount(): number {
    return SPLASH_SLOTS;
  }

  /** Whether any splash can currently show. */
  get visible(): boolean {
    return this.mesh.visible;
  }

  /** World position and landing time (rain clock, game seconds) of one slot's current splash — for tests. */
  splashAt(slot: number): { x: number; y: number; z: number; born: number } {
    const o = slot * 4;
    return {
      x: this.splashes[o]!, y: this.splashes[o + 1]!, z: this.splashes[o + 2]!,
      born: this.splashes[o + 3]! + this.clockBase,
    };
  }

  /**
   * Advance to rain-clock `clock` (game seconds). Slots whose cycle rolled over
   * land somewhere new inside the window around (focusX, focusZ); the rest keep
   * their world position untouched.
   */
  update(
    clock: number, focusX: number, focusZ: number, distance: number,
    opacity: number, density: number,
  ): void {
    const fade = 1 - THREE.MathUtils.smoothstep(distance, SPLASH_FADE_START, SPLASH_FADE_END);
    const visibleOpacity = opacity * SPLASH_OPACITY_SCALE * fade;
    this.mesh.visible = visibleOpacity > 0.002 && density > 0.002;
    if (clock - this.clockBase >= CLOCK_REBASE_INTERVAL) this.rebaseClock(clock);
    this.material.uniforms['uClock']!.value = clock - this.clockBase;
    this.material.uniforms['uOpacity']!.value = visibleOpacity;
    this.material.uniforms['uDensity']!.value = density;
    if (!this.mesh.visible) return;

    const window = Math.min(SPLASH_WINDOW_MAX, Math.max(SPLASH_WINDOW_MIN, distance * SPLASH_WINDOW_PER_DISTANCE));
    let changed = false;
    for (let i = 0; i < SPLASH_SLOTS; i++) {
      const phase = this.phases[i]!;
      const cycle = Math.floor(clock / SPLASH_LIFE + phase);
      if (cycle === this.cycles[i]) continue;
      this.cycles[i] = cycle;
      changed = true;
      const x = focusX + (cellRand(this.seed, i, cycle, SALT_X) - 0.5) * window;
      const z = focusZ + (cellRand(this.seed, i, cycle, SALT_Z) - 0.5) * window;
      const ground = this.sampleGround(x, z);
      const o = i * 4;
      this.splashes[o] = x;
      this.splashes[o + 1] = ground === null ? 0 : ground + SPLASH_LIFT;
      this.splashes[o + 2] = z;
      this.splashes[o + 3] = ground === null ? NEVER_BORN : (cycle - phase) * SPLASH_LIFE - this.clockBase;
    }
    if (changed) this.splashAttr.needsUpdate = true;
  }

  private rebaseClock(clock: number): void {
    const step = Math.floor((clock - this.clockBase) / CLOCK_REBASE_INTERVAL) * CLOCK_REBASE_INTERVAL;
    this.clockBase += step;
    for (let i = 0; i < SPLASH_SLOTS; i++) {
      const o = i * 4 + 3;
      if (this.splashes[o]! > NEVER_BORN) this.splashes[o] = this.splashes[o]! - step;
    }
    this.splashAttr.needsUpdate = true;
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
