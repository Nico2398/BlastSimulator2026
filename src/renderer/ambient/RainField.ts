// BlastSimulator2026 — Rain: fine streaks anchored in the world, falling on
// game time (#1601).
//
// The drops are one periodic field filling all of space: drop i sits at its
// seeded spot in a repeating cell, shifted by how far the rain has fallen (and
// drifted with the wind) since the level began. Only the copy of each drop that
// lands inside a window around the view is drawn, so the camera pans and zooms
// *through* the rain — no drop ever travels with it — while a fixed budget of
// drops still covers whatever the camera sees.
//
// The window grows with the zoom in powers of two. Two layers are drawn at once,
// the level just big enough for the view and the next one up, cross-faded by
// how far the zoom sits between them, so zooming never pops or rescales the
// rain. Both layers share the same seeds, which is what lets a layer hand its
// level over to the other without a visible change.
//
// The fall advances with game time: frozen in mid-air while paused (each drop
// drawn as a little cartoon teardrop), quicker at a higher time scale, its
// streak stretching with the speed. Weather changes ease in on game time too.
//
// Construct-safe under Node (InstancedBufferGeometry + ShaderMaterial, no DOM).

import * as THREE from 'three';
import type { WeatherState } from '../../core/weather/WeatherCycle.js';
import { cellRand, subSeed } from '../../core/math/Hash.js';
import type { WindVector } from './WindState.js';
import { RainSplashes, type GroundSampler } from './RainSplashes.js';
import { RAIN_STREAK_VERTEX_SHADER, RAIN_STREAK_FRAGMENT_SHADER } from './RainShaders.js';

const DROPS_PER_LAYER = 9000;
const LAYER_COUNT = 2;
/** Width (m) of the smallest window, used at the closest zooms. */
const BASE_WINDOW = 16;
/** Window width wanted per metre of camera orbit distance — enough to cover the view at any pitch. */
const WINDOW_PER_DISTANCE = 3;
/** Window height as a fraction of its width. */
const WINDOW_HEIGHT_RATIO = 0.5;
/** Fraction of the window's height that sits below the view target, for ground lower than the target. */
const WINDOW_FLOOR_RATIO = 0.25;
/**
 * Window width (m) at which every drop is shown. A smaller window — a closer
 * zoom — shows only a share of them, shrinking as (width / this)^falloff: every
 * window holds the same drop count, so without thinning a close-up would pack
 * its few cubic metres into a white curtain, each streak there also being
 * many more pixels long.
 */
const FULL_DENSITY_WINDOW = 256;
const DENSITY_FALLOFF = 0.9;

/** Horizontal drift (m/s) at wind speed 1 (storm) — the rain slants with the same wind the clouds ride. */
const WIND_DRIFT = 5;
/** Seconds of motion one streak spans: the stylised "shutter" that turns a drop into a streak. */
const STREAK_SHUTTER = 0.04;
/**
 * Streaks lengthen by this fraction per metre of orbit distance. A streak true
 * to its world length is a speck from the overview; stretching it with the zoom
 * keeps rain reading as rain there, while drop positions stay world-anchored.
 */
const STREAK_ZOOM_STRETCH = 1 / 120;
/** Longest streak (m), however fast the game runs — past this fast-forward reads as a blur. */
const MAX_STREAK = 2;
/** Streak length of a frozen drop, as a multiple of its radius — enough to read as a teardrop. */
const TEARDROP_TAIL_RATIO = 4;
/**
 * A frozen drop is drawn this much bigger than a falling one. A falling drop's
 * streak is its own width; at rest it is a bead, and a bead the width of a
 * streak is a speck nobody reads as a drop hanging in the air.
 */
const BEAD_SCALE = 1.8;
/** Tail brightness relative to the head: a falling streak fades out behind; a frozen teardrop is solid. */
const MOVING_TAIL_ALPHA = 0.2;
const FROZEN_TAIL_ALPHA = 0.85;
/**
 * A streak longer than at 1× spreads the same drop over more pixels, so it is
 * dimmed in proportion (motion blur keeps its ink) — but never below this, or
 * fast-forward rain would vanish.
 */
const STREAK_MIN_INK = 0.45;
/** How quickly (1/s, real time) the streak follows a speed change, so pausing reads as a quick ease, not a cut. */
const STREAK_EASE_RATE = 12;
/** How quickly (1/s, game time) the rain's look follows a weather change. */
const WEATHER_EASE_RATE = 0.6;
/** Camera depth (m), per metre of orbit distance, under which drops fade out in front of the lens. */
const NEAR_FADE_PER_DISTANCE = 0.25;
const NEAR_FADE_MIN = 3.5;

const DROP_COLOR = new THREE.Color(0xcfe2ff);
const DROP_RIM_COLOR = new THREE.Color(0x7aa0d6);

/** What the rain looks like in one weather state. */
interface RainLook {
  /** Fraction of the field's drops shown. */
  density: number;
  /** Fall speed, m/s of game time. */
  fallSpeed: number;
  /** Drop radius, m. */
  radius: number;
  opacity: number;
}

/** Rainy states only — any other weather fades the drops out and keeps the last look meanwhile. */
const RAIN_LOOKS: Partial<Record<WeatherState, RainLook>> = {
  light_rain: { density: 0.3, fallSpeed: 9, radius: 0.009, opacity: 0.45 },
  heavy_rain: { density: 0.65, fallSpeed: 12, radius: 0.012, opacity: 0.55 },
  storm: { density: 1, fallSpeed: 15, radius: 0.014, opacity: 0.65 },
};
const FALLBACK_LOOK: RainLook = RAIN_LOOKS.heavy_rain!;

/** Hash salts for the per-drop seeds. */
const SALT_X = 1;
const SALT_Y = 2;
const SALT_Z = 3;
const SALT_SEED = 4;

/** Where the camera is looking: the window centres on the orbit target, sized by the orbit distance. */
export interface RainView {
  x: number;
  y: number;
  z: number;
  distance: number;
}

/** How every drop is drawn this frame, shared by both layers. */
interface StreakStyle {
  /** World vector from a drop's head to its tail. */
  trail: THREE.Vector3;
  radius: number;
  tailAlpha: number;
  /** Opacity multiplier from stretching — see STREAK_MIN_INK. */
  ink: number;
  /** Camera depth under which drops fade out. */
  nearFade: number;
}

interface RainLayer {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  readonly heads: Float32Array;
  readonly headAttr: THREE.InstancedBufferAttribute;
  /** Window level assigned: width BASE_WINDOW * 2^level. -1 until the first rainy update. */
  level: number;
  /** Last inputs the heads were written for — an unchanged frame (paused, still camera) writes nothing. */
  writtenFor: string;
}

/** Width (m) of the window at `level`. */
function windowWidth(level: number): number {
  return BASE_WINDOW * 2 ** level;
}

/** `value` wrapped into [min, min + period). */
function wrapInto(value: number, min: number, period: number): number {
  const r = (value - min) % period;
  return min + (r < 0 ? r + period : r);
}

export class RainField {
  private readonly scene: THREE.Scene;
  /** Unit-cell coordinates of every drop, 3 per drop, shared by both layers. */
  private readonly cellPositions: Float32Array;
  private readonly layers: RainLayer[] = [];
  private readonly splashes: RainSplashes | null;

  /** False until the first setWeather(), which snaps instead of easing — a level loaded mid-storm opens in it. */
  private weatherInitialised = false;
  /** Target look, and the eased look currently drawn. */
  private targetDensity = 0;
  private targetLook: RainLook = FALLBACK_LOOK;
  private readonly look: RainLook = { ...FALLBACK_LOOK, density: 0 };
  /** Distance the whole field has moved since the level began — the fall plus the wind drift, in game time. */
  private readonly offset = new THREE.Vector3();
  /** Game seconds of rain so far — the splashes' clock. */
  private clock = 0;
  /** Eased game-time rate (gameDt / dt) — 0 paused, 4 at 4× — that stretches the streaks. */
  private streakRate = 1;

  constructor(scene: THREE.Scene, levelSeed: number, sampleGround?: GroundSampler) {
    this.scene = scene;
    const seed = subSeed(levelSeed, 'rain');

    this.cellPositions = new Float32Array(DROPS_PER_LAYER * 3);
    const seeds = new Float32Array(DROPS_PER_LAYER);
    for (let i = 0; i < DROPS_PER_LAYER; i++) {
      this.cellPositions[i * 3] = cellRand(seed, i, 0, SALT_X);
      this.cellPositions[i * 3 + 1] = cellRand(seed, i, 0, SALT_Y);
      this.cellPositions[i * 3 + 2] = cellRand(seed, i, 0, SALT_Z);
      seeds[i] = cellRand(seed, i, 0, SALT_SEED);
    }

    const corners = new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0], 3);
    const seedAttr = new THREE.InstancedBufferAttribute(seeds, 1);
    for (let l = 0; l < LAYER_COUNT; l++) {
      const heads = new Float32Array(DROPS_PER_LAYER * 3);
      const headAttr = new THREE.InstancedBufferAttribute(heads, 3);
      headAttr.setUsage(THREE.DynamicDrawUsage);
      const geo = new THREE.InstancedBufferGeometry();
      geo.setAttribute('position', corners);
      geo.setIndex([0, 2, 1, 1, 2, 3]);
      geo.setAttribute('aHead', headAttr);
      geo.setAttribute('aSeed', seedAttr);
      geo.instanceCount = DROPS_PER_LAYER;

      const material = new THREE.ShaderMaterial({
        uniforms: {
          uTrail: { value: new THREE.Vector3(0, 1, 0) },
          uRadius: { value: FALLBACK_LOOK.radius },
          uTailAlpha: { value: MOVING_TAIL_ALPHA },
          uViewport: { value: new THREE.Vector2(1280, 720) },
          uOpacity: { value: 0 },
          uDensity: { value: 0 },
          uFocus: { value: new THREE.Vector3() },
          uHalfWindow: { value: new THREE.Vector3(1, 1, 1) },
          uWindowTopY: { value: 0 },
          uNearFade: { value: NEAR_FADE_MIN },
          uColor: { value: DROP_COLOR.clone() },
          uRimColor: { value: DROP_RIM_COLOR.clone() },
        },
        vertexShader: RAIN_STREAK_VERTEX_SHADER,
        fragmentShader: RAIN_STREAK_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
      });

      const mesh = new THREE.Mesh(geo, material);
      mesh.name = `rain-layer-${l}`;
      // Positions are already world space and span the whole view — no bounds to cull against.
      mesh.frustumCulled = false;
      mesh.visible = false;
      // The streak is sized in pixels, so the shader needs the target's size.
      const viewport = new THREE.Vector4();
      mesh.onBeforeRender = (renderer) => {
        renderer.getCurrentViewport(viewport);
        (material.uniforms['uViewport']!.value as THREE.Vector2).set(viewport.z, viewport.w);
      };
      this.scene.add(mesh);
      this.layers.push({ mesh, material, heads, headAttr, level: -1, writtenFor: '' });
    }

    this.splashes = sampleGround ? new RainSplashes(scene, seed, sampleGround) : null;
  }

  /** Drops in each layer — for tests. */
  get dropsPerLayer(): number {
    return DROPS_PER_LAYER;
  }

  /** Whether any rain is currently drawn. */
  get visible(): boolean {
    return this.layers.some(l => l.mesh.visible);
  }

  /** Distance the field has moved since the level began (game time) — for tests. */
  get motion(): THREE.Vector3 {
    return this.offset.clone();
  }

  /** The splash layer, when a ground sampler was given — for tests. */
  get splashLayer(): RainSplashes | null {
    return this.splashes;
  }

  /** World position of one drop in one layer, as last written — for tests. */
  dropPosition(layer: number, drop: number): THREE.Vector3 {
    const heads = this.layers[layer]!.heads;
    return new THREE.Vector3(heads[drop * 3], heads[drop * 3 + 1], heads[drop * 3 + 2]);
  }

  /** Window width (m) one layer is drawing at — for tests. */
  layerWindow(layer: number): number {
    return windowWidth(this.layers[layer]!.level);
  }

  /** Weather drives density and look; a dry state fades the rain out. */
  setWeather(state: WeatherState): void {
    const look = RAIN_LOOKS[state];
    this.targetDensity = look ? look.density : 0;
    if (look) this.targetLook = look;
    if (!this.weatherInitialised) {
      this.weatherInitialised = true;
      Object.assign(this.look, this.targetLook, { density: this.targetDensity });
    }
  }

  /**
   * Advance the rain.
   * @param gameDt - game seconds this frame: `dt * timeScale`, 0 while paused. Moves the drops and eases weather changes.
   * @param dt - real seconds this frame. Eases the streak into and out of a pause.
   * @param view - orbit target and distance; places the window, never the drops.
   * @param wind - shared wind vector; slants the fall.
   */
  update(gameDt: number, dt: number, view: RainView, wind: WindVector): void {
    const ease = Math.min(1, WEATHER_EASE_RATE * gameDt);
    this.look.density += (this.targetDensity - this.look.density) * ease;
    this.look.fallSpeed += (this.targetLook.fallSpeed - this.look.fallSpeed) * ease;
    this.look.radius += (this.targetLook.radius - this.look.radius) * ease;
    this.look.opacity += (this.targetLook.opacity - this.look.opacity) * ease;

    const velocity = new THREE.Vector3(wind.x * WIND_DRIFT, -this.look.fallSpeed, wind.z * WIND_DRIFT);
    if (gameDt > 0) {
      this.offset.addScaledVector(velocity, gameDt);
      this.clock += gameDt;
    }
    if (dt > 0) {
      const rate = gameDt / dt;
      this.streakRate += (rate - this.streakRate) * Math.min(1, STREAK_EASE_RATE * dt);
    }

    const distance = Number.isFinite(view.distance) && view.distance > 0 ? view.distance : 0;
    if (this.look.density <= 0.002) {
      for (const layer of this.layers) layer.mesh.visible = false;
      this.splashes?.update(this.clock, view.x, view.z, distance, 0, 0);
      return;
    }

    const style = this.streakStyle(velocity, distance);
    // Level of detail: the window just covering the view, cross-faded with the next one up.
    const wanted = Math.max(BASE_WINDOW, distance * WINDOW_PER_DISTANCE);
    const lod = Math.log2(wanted / BASE_WINDOW);
    const lower = Math.floor(lod);
    const blend = lod - lower;
    for (let l = 0; l < LAYER_COUNT; l++) {
      // A layer keeps its level's parity, so the level both layers agree on
      // stays on the same mesh as the zoom crosses a boundary.
      const level = lower % 2 === l ? lower : lower + 1;
      const weight = level === lower ? 1 - blend : blend;
      this.updateLayer(this.layers[l]!, level, weight, view, style);
    }

    this.splashes?.update(this.clock, view.x, view.z, distance, this.look.opacity, this.look.density);
  }

  dispose(): void {
    for (const layer of this.layers) {
      this.scene.remove(layer.mesh);
      layer.mesh.geometry.dispose();
      layer.material.dispose();
    }
    this.splashes?.dispose();
  }

  // ---------- Internal ----------

  /**
   * The streak for this frame: back from the head along the motion, as long as
   * the motion the eased game rate covers in one shutter. Paused, it eases down
   * to a solid little teardrop, bigger than the streak was wide.
   */
  private streakStyle(velocity: THREE.Vector3, distance: number): StreakStyle {
    const stillness = 1 - THREE.MathUtils.clamp(this.streakRate, 0, 1);
    const radius = this.look.radius * (1 + (BEAD_SCALE - 1) * stillness);
    const speed = velocity.length();
    const realTimeStreak = speed * STREAK_SHUTTER;
    const streak = THREE.MathUtils.clamp(
      realTimeStreak * Math.max(0, this.streakRate), radius * TEARDROP_TAIL_RATIO, MAX_STREAK,
    );
    const stretch = 1 + distance * STREAK_ZOOM_STRETCH;
    return {
      trail: velocity.clone().multiplyScalar(-(streak * stretch) / speed),
      radius,
      tailAlpha: THREE.MathUtils.lerp(MOVING_TAIL_ALPHA, FROZEN_TAIL_ALPHA, stillness),
      ink: THREE.MathUtils.clamp(realTimeStreak / streak, STREAK_MIN_INK, 1),
      nearFade: Math.max(NEAR_FADE_MIN, distance * NEAR_FADE_PER_DISTANCE),
    };
  }

  private updateLayer(layer: RainLayer, level: number, weight: number, view: RainView, style: StreakStyle): void {
    layer.level = level;
    layer.mesh.visible = weight > 0.01;
    if (!layer.mesh.visible) return;

    const width = windowWidth(level);
    const height = width * WINDOW_HEIGHT_RATIO;
    const minX = view.x - width / 2;
    const minY = view.y - height * WINDOW_FLOOR_RATIO;
    const minZ = view.z - width / 2;

    const u = layer.material.uniforms;
    (u['uTrail']!.value as THREE.Vector3).copy(style.trail);
    u['uRadius']!.value = style.radius;
    u['uTailAlpha']!.value = style.tailAlpha;
    u['uOpacity']!.value = this.look.opacity * weight * style.ink;
    u['uDensity']!.value = this.look.density * Math.min(1, (width / FULL_DENSITY_WINDOW) ** DENSITY_FALLOFF);
    (u['uFocus']!.value as THREE.Vector3).set(view.x, view.y, view.z);
    (u['uHalfWindow']!.value as THREE.Vector3).set(width / 2, height / 2, width / 2);
    u['uWindowTopY']!.value = minY + height;
    u['uNearFade']!.value = style.nearFade;

    const key = `${level}|${minX}|${minY}|${minZ}|${this.offset.x}|${this.offset.y}|${this.offset.z}`;
    if (key === layer.writtenFor) return;
    layer.writtenFor = key;

    // Each drop sits at cell * size + offset, wrapped into [min, min + size).
    // The offset-minus-min part is the same for every drop, so wrap it once:
    // cell * size lies in [0, size), the sum in [0, 2 * size), and one
    // conditional subtract finishes the wrap — no per-drop modulo.
    const shiftX = wrapInto(this.offset.x - minX, 0, width);
    const shiftY = wrapInto(this.offset.y - minY, 0, height);
    const shiftZ = wrapInto(this.offset.z - minZ, 0, width);
    const cell = this.cellPositions;
    const heads = layer.heads;
    for (let i = 0; i < DROPS_PER_LAYER; i++) {
      const o = i * 3;
      const x = cell[o]! * width + shiftX;
      const y = cell[o + 1]! * height + shiftY;
      const z = cell[o + 2]! * width + shiftZ;
      heads[o] = minX + (x >= width ? x - width : x);
      heads[o + 1] = minY + (y >= height ? y - height : y);
      heads[o + 2] = minZ + (z >= width ? z - width : z);
    }
    layer.headAttr.needsUpdate = true;
  }
}
