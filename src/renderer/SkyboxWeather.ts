// BlastSimulator2026 — Skybox and Weather Visuals
// Sky color changes per weather state with smooth gradual lerp transitions.
// Rain produces a falling particle system (tiny cylinders / points).
// Storm adds rapid flashes (brief white screen flash on DirectionalLight).
//
// Sky is a large inverted dome (#458 T7.1/D12/A25) rather than a flat
// scene.background color — skyLow feeds the horizon, skyHigh (previously
// dormant — nothing read it) feeds the zenith.

import * as THREE from 'three';
import type { WeatherState } from '../core/weather/WeatherCycle.js';
import { Random } from '../core/math/Random.js';

// ---------- Sky colors per weather state ----------
// skyLow feeds the dome's horizon stop and legacy scene.background fallback;
// skyHigh feeds the dome's zenith stop. THREE.Fog was removed in favour of
// the aerial perspective post-process pass (#458 T5.1/D11).

interface WeatherColors {
  skyHigh: THREE.Color;  // upper sky
  skyLow: THREE.Color;   // horizon
  sunIntensity: number;  // directional light multiplier
  ambientIntensity: number;
}

const WEATHER_COLORS: Record<WeatherState, WeatherColors> = {
  sunny:      { skyHigh: new THREE.Color(0x4fc3f7), skyLow: new THREE.Color(0x87ceeb), sunIntensity: 1.2,  ambientIntensity: 0.55 },
  cloudy:     { skyHigh: new THREE.Color(0x8899aa), skyLow: new THREE.Color(0xaabbcc), sunIntensity: 0.6,  ambientIntensity: 0.50 },
  light_rain: { skyHigh: new THREE.Color(0x607080), skyLow: new THREE.Color(0x7a8a99), sunIntensity: 0.40, ambientIntensity: 0.45 },
  heavy_rain: { skyHigh: new THREE.Color(0x445566), skyLow: new THREE.Color(0x556677), sunIntensity: 0.25, ambientIntensity: 0.38 },
  storm:      { skyHigh: new THREE.Color(0x2a3040), skyLow: new THREE.Color(0x3a4050), sunIntensity: 0.10, ambientIntensity: 0.30 },
  heat_wave:  { skyHigh: new THREE.Color(0xff8800), skyLow: new THREE.Color(0xffbb44), sunIntensity: 1.5,  ambientIntensity: 0.65 },
  cold_snap:  { skyHigh: new THREE.Color(0xbbccdd), skyLow: new THREE.Color(0xddeeff), sunIntensity: 0.8,  ambientIntensity: 0.50 },
};

// ---------- Rain particle config ----------
const RAIN_PARTICLE_COUNT = 1500;
/**
 * Width/depth of the rain box. Scales with the camera's orbit distance
 * (#458 T6.1/D13) — a fixed area sized for the tutorial's close-in camera
 * read as a tiny, sparse patch once the larger campaign levels' cameras
 * pull back to frame a 96-160m site; RAIN_AREA_FACTOR keeps the box roughly
 * matching the visible ground regardless of zoom.
 */
const RAIN_AREA_BASE = 80;
const RAIN_AREA_MIN = 80;
const RAIN_AREA_MAX = 400;
const RAIN_AREA_FACTOR = 1.4; // area = clamp(cameraDistance * factor, min, max)
const RAIN_HEIGHT = 50;  // height rain falls from
const RAIN_SPEED = 20;   // voxels per second downward
const RAIN_POINT_SIZE = 1.4;
const RAIN_STREAK_TEXTURE_SIZE = 16;

/**
 * Build a vertical streak alpha-mask for rain sprites. The default
 * PointsMaterial sprite is a flat filled square, which reads as scattered
 * confetti rather than falling rain — this shapes the point's square quad
 * down to a thin, top/bottom-faded column so it reads as a streak instead (#408).
 *
 * Built as a DataTexture (raw pixel buffer) rather than a canvas so it needs
 * no DOM — SkyboxWeather's constructor runs under Vitest's Node environment.
 */
function buildRainStreakTexture(): THREE.DataTexture {
  const size = RAIN_STREAK_TEXTURE_SIZE;
  const data = new Uint8Array(size * size * 4);
  const centre = size / 2;
  const streakHalfWidth = size * 0.16;
  for (let y = 0; y < size; y++) {
    // Fade the top and bottom of the column so the streak tapers rather than
    // cuts off abruptly.
    const edgeFade = Math.min(1, Math.min(y + 0.5, size - y - 0.5) / (size * 0.2));
    for (let x = 0; x < size; x++) {
      const dx = Math.abs(x + 0.5 - centre);
      const coreAlpha = dx <= streakHalfWidth ? 1 : Math.max(0, 1 - (dx - streakHalfWidth) / 2);
      const i = (y * size + x) * 4;
      data[i] = 200;
      data[i + 1] = 220;
      data[i + 2] = 255;
      data[i + 3] = Math.round(coreAlpha * edgeFade * 255);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  return texture;
}

// ---------- Transition speed ----------
// Lerp factor per second (0.5 = reaches ~63% in 2 seconds)
const TRANSITION_SPEED = 0.5;

/** Fill stays a fixed fraction of sun intensity — matches the original static 0.3/1.2 ratio (#458 T5.1). */
const FILL_INTENSITY_RATIO = 0.25;

/**
 * Anything SkyboxWeather can drive the intensity of — a real DirectionalLight
 * satisfies this structurally, but so does a proxy over CSM's cascade lights
 * (#458 T5.1/D11: "give it a setter interface rather than reaching into
 * sm.sun", since CSM has no single light to hand over directly).
 */
export interface SunLightSource {
  intensity: number;
}

// ---------- Storm flash ----------
export const STORM_FLASH_INTERVAL_MIN = 3.0;  // seconds between lightning
export const STORM_FLASH_INTERVAL_MAX = 8.0;
export const STORM_FLASH_FIRST_DELAY = 4.0;   // seconds until the first flash
export const STORM_FLASH_PEAK_BOOST = 3.4;    // sun intensity added at envelope level 1

/** Flash brightness keyframes: `at` seconds into the flash, `level` 0..1. */
export const STORM_FLASH_ENVELOPE: readonly { at: number; level: number }[] = [
  { at: 0, level: 1 },
  { at: 0.06, level: 1 },
  { at: 0.10, level: 0 },
  { at: 0.16, level: 0 },
  { at: 0.19, level: 0.6 },
  { at: 0.28, level: 0 },
];

/** Seconds the whole flash lasts — the last envelope keyframe. */
export const STORM_FLASH_DURATION = STORM_FLASH_ENVELOPE[STORM_FLASH_ENVELOPE.length - 1]!.at;

/** Seed of the fallback flash source when the caller injects none. */
const DEFAULT_FLASH_SEED = 0x1f1a5;

/** Source of randomness in [0, 1) for flash spacing. */
export type FlashRandom = () => number;

export interface SkyboxWeatherOptions {
  /** Injectable for deterministic tests; defaults to the renderer's own source. */
  random?: () => number;
}

/** Flash brightness level (0..1) `t` seconds into a flash, interpolated from STORM_FLASH_ENVELOPE. */
export function flashLevel(t: number): number {
  const last = STORM_FLASH_ENVELOPE[STORM_FLASH_ENVELOPE.length - 1]!;
  if (t < 0 || t >= last.at) return 0;
  for (let i = 1; i < STORM_FLASH_ENVELOPE.length; i++) {
    const b = STORM_FLASH_ENVELOPE[i]!;
    if (t < b.at) {
      const a = STORM_FLASH_ENVELOPE[i - 1]!;
      const span = b.at - a.at;
      return span <= 0 ? b.level : a.level + ((b.level - a.level) * (t - a.at)) / span;
    }
  }
  return 0;
}

// ---------- Gradient sky dome (#458 T7.1/D12/A25) ----------
// Comfortably bigger than the far plane (6000, #458 T6.1/D13) so the dome
// never clips into view, and bigger than any camera excursion the pan leash
// allows — a fixed dome at the world origin never needs to follow the camera.
const SKY_DOME_RADIUS = 3000;
const SKY_DOME_SEGMENTS = 16;

const SKY_DOME_VERTEX_SHADER = `
varying vec3 vWorldPosition;
void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

const SKY_DOME_FRAGMENT_SHADER = `
uniform vec3 uSkyLow;
uniform vec3 uSkyHigh;
varying vec3 vWorldPosition;
void main() {
  float h = normalize(vWorldPosition).y;
  float t = smoothstep(-0.05, 0.6, h);
  gl_FragColor = vec4(mix(uSkyLow, uSkyHigh, t), 1.0);
}
`;

// ---------- Main class ----------

export class SkyboxWeather {
  private readonly scene: THREE.Scene;
  private readonly sun: SunLightSource;
  private readonly ambient: THREE.AmbientLight;
  private readonly fill: SunLightSource;

  private currentWeather: WeatherState = 'sunny';
  private readonly currentSky = new THREE.Color(WEATHER_COLORS.sunny.skyLow);
  private readonly currentSkyHigh = new THREE.Color(WEATHER_COLORS.sunny.skyHigh);
  /** False until the first setWeather() call, which snaps instead of lerping. */
  private weatherInitialised = false;

  // Gradient sky dome
  private readonly skyDome: THREE.Mesh;
  private readonly skyDomeMaterial: THREE.ShaderMaterial;

  // Rain
  private rainPoints: THREE.Points | null = null;
  private readonly rainPositions: Float32Array;
  private rainVisible = false;
  /** Current rain-box width/depth — rescaled each frame from camera distance (#458 T6.1/D13). */
  private rainArea = RAIN_AREA_BASE;

  // Storm
  /** Weather-lerped sun intensity; the flash boost is added on top and never feeds back. */
  private sunBaseline: number;
  /** Seconds into the running flash; null while idle. */
  private flashElapsed: number | null = null;
  private flashCountdown = STORM_FLASH_FIRST_DELAY;
  private readonly flashRandom: FlashRandom;

  constructor(
    scene: THREE.Scene,
    sun: SunLightSource,
    ambient: THREE.AmbientLight,
    fill: SunLightSource,
    options: SkyboxWeatherOptions = {},
  ) {
    const defaultRandom = new Random(DEFAULT_FLASH_SEED);
    this.flashRandom = options.random ?? (() => defaultRandom.next());
    this.sunBaseline = sun.intensity;
    this.scene = scene;
    this.sun = sun;
    this.ambient = ambient;
    this.fill = fill;

    // Gradient sky dome — replaces the flat scene.background color.
    this.skyDomeMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uSkyLow: { value: this.currentSky.clone() },
        uSkyHigh: { value: this.currentSkyHigh.clone() },
      },
      vertexShader: SKY_DOME_VERTEX_SHADER,
      fragmentShader: SKY_DOME_FRAGMENT_SHADER,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      lights: false,
    });
    const domeGeo = new THREE.SphereGeometry(SKY_DOME_RADIUS, SKY_DOME_SEGMENTS, SKY_DOME_SEGMENTS);
    this.skyDome = new THREE.Mesh(domeGeo, this.skyDomeMaterial);
    // Rendered first, behind everything real geometry can occlude — matters
    // for the aerial-perspective/bloom passes reading depth downstream.
    this.skyDome.renderOrder = -1;
    this.scene.add(this.skyDome);
    this.scene.background = null;

    // Pre-allocate rain positions
    this.rainPositions = new Float32Array(RAIN_PARTICLE_COUNT * 3);
    this.initRainPositions();
    this.buildRainPoints();
  }

  /**
   * Set the weather state. Transition is gradual (lerp each frame).
   */
  setWeather(state: WeatherState): void {
    this.currentWeather = state;

    // The first assignment snaps. Lerping in from the hardcoded blue would open
    // the game on several seconds of a muddy in-between colour.
    if (!this.weatherInitialised) {
      this.weatherInitialised = true;
      const colors = WEATHER_COLORS[state];
      this.currentSky.copy(colors.skyLow);
      this.currentSkyHigh.copy(colors.skyHigh);
      (this.skyDomeMaterial.uniforms['uSkyLow']!.value as THREE.Color).copy(this.currentSky);
      (this.skyDomeMaterial.uniforms['uSkyHigh']!.value as THREE.Color).copy(this.currentSkyHigh);
      this.sunBaseline = colors.sunIntensity;
      this.sun.intensity = colors.sunIntensity;
      this.ambient.intensity = colors.ambientIntensity;
      this.fill.intensity = colors.sunIntensity * FILL_INTENSITY_RATIO;
    }

    if (state !== 'storm') this.clearStormFlash();

    const isRaining = state === 'light_rain' || state === 'heavy_rain' || state === 'storm';
    if (this.rainPoints) {
      this.rainPoints.visible = isRaining;
      this.rainVisible = isRaining;
    }

    // Scale rain density by intensity
    if (this.rainPoints) {
      const mat = this.rainPoints.material as THREE.PointsMaterial;
      mat.opacity = state === 'heavy_rain' || state === 'storm' ? 0.7 : 0.4;
    }
  }

  /**
   * Update weather animations. Call every frame.
   * @param dt - seconds since last call
   * @param cameraX - camera X position (rain follows camera)
   * @param cameraZ - camera Z position
   * @param cameraDistance - camera orbit distance, scales the rain box so it
   *   doesn't read as a sparse patch once the camera pulls back on a larger
   *   level (#458 T6.1/D13). Omit to keep the base area, so existing test/
   *   scenario call sites that predate this parameter still work.
   */
  update(dt: number, cameraX: number, cameraZ: number, cameraDistance?: number): void {
    this.rainArea = cameraDistance === undefined
      ? RAIN_AREA_BASE
      : Math.min(RAIN_AREA_MAX, Math.max(RAIN_AREA_MIN, cameraDistance * RAIN_AREA_FACTOR));
    const target = WEATHER_COLORS[this.currentWeather];

    // Lerp sky color — dome uniforms are the same THREE.Color objects, so
    // this write reaches the GPU on the next draw without a clone.
    this.currentSky.lerp(target.skyLow, TRANSITION_SPEED * dt);
    this.currentSkyHigh.lerp(target.skyHigh, TRANSITION_SPEED * dt);
    (this.skyDomeMaterial.uniforms['uSkyLow']!.value as THREE.Color).copy(this.currentSky);
    (this.skyDomeMaterial.uniforms['uSkyHigh']!.value as THREE.Color).copy(this.currentSkyHigh);

    // Lerp sun / ambient / fill
    this.sunBaseline += (target.sunIntensity - this.sunBaseline) * TRANSITION_SPEED * dt;
    this.ambient.intensity += (target.ambientIntensity - this.ambient.intensity) * TRANSITION_SPEED * dt;
    const targetFill = target.sunIntensity * FILL_INTENSITY_RATIO;
    this.fill.intensity += (targetFill - this.fill.intensity) * TRANSITION_SPEED * dt;

    // Rain animation
    if (this.rainVisible) {
      this.updateRain(dt, cameraX, cameraZ);
    }

    // Storm flashes — single write point for sun intensity
    if (this.currentWeather === 'storm') {
      this.updateStormFlash(dt);
    } else {
      this.clearStormFlash();
    }
    const boost = this.flashElapsed === null
      ? 0
      : flashLevel(this.flashElapsed) * STORM_FLASH_PEAK_BOOST;
    this.sun.intensity = this.sunBaseline + boost;
  }

  /** Current lerped sky color — AerialPerspectivePass tints haze to match it each frame (#458 T5.2). */
  get skyColor(): THREE.Color {
    return this.currentSky;
  }

  dispose(): void {
    if (this.rainPoints) {
      this.scene.remove(this.rainPoints);
      this.rainPoints.geometry.dispose();
      (this.rainPoints.material as THREE.Material).dispose();
      this.rainPoints = null;
    }
    this.scene.remove(this.skyDome);
    this.skyDome.geometry.dispose();
    this.skyDomeMaterial.dispose();
  }

  // ---------- Internal ----------

  private initRainPositions(): void {
    for (let i = 0; i < RAIN_PARTICLE_COUNT; i++) {
      this.rainPositions[i * 3]     = (Math.random() - 0.5) * this.rainArea;
      this.rainPositions[i * 3 + 1] = Math.random() * RAIN_HEIGHT;
      this.rainPositions[i * 3 + 2] = (Math.random() - 0.5) * this.rainArea;
    }
  }

  private buildRainPoints(): void {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.rainPositions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xaaccff,
      size: RAIN_POINT_SIZE,
      map: buildRainStreakTexture(),
      alphaTest: 0.05,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
    });
    this.rainPoints = new THREE.Points(geo, mat);
    this.rainPoints.visible = false;
    this.scene.add(this.rainPoints);
  }

  private updateRain(dt: number, cx: number, cz: number): void {
    if (!this.rainPoints) return;

    const drop = RAIN_SPEED * dt;
    const halfArea = this.rainArea / 2;

    for (let i = 0; i < RAIN_PARTICLE_COUNT; i++) {
      const yIdx = i * 3 + 1;
      this.rainPositions[yIdx] = (this.rainPositions[yIdx] ?? 0) - drop;
      // Wrap around when particle hits ground
      if ((this.rainPositions[yIdx] ?? 0) < 0) {
        // Positions are local to the rainPoints mesh (which is translated to cx,cz).
        // Adding cx/cz here would double the offset.
        this.rainPositions[i * 3]     = (Math.random() - 0.5) * this.rainArea;
        this.rainPositions[i * 3 + 1] = RAIN_HEIGHT;
        this.rainPositions[i * 3 + 2] = (Math.random() - 0.5) * this.rainArea;
      }
    }

    // Follow camera
    this.rainPoints.position.x = cx;
    this.rainPoints.position.z = cz;
    void halfArea; // future: clamp particles relative to camera

    const geo = this.rainPoints.geometry;
    (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  private clearStormFlash(): void {
    this.flashElapsed = null;
    this.flashCountdown = STORM_FLASH_FIRST_DELAY;
    this.sun.intensity = this.sunBaseline;
  }

  private updateStormFlash(dt: number): void {
    if (this.flashElapsed !== null) {
      this.flashElapsed += dt;
      if (this.flashElapsed >= STORM_FLASH_DURATION) {
        this.flashElapsed = null;
        this.flashCountdown =
          STORM_FLASH_INTERVAL_MIN +
          this.flashRandom() * (STORM_FLASH_INTERVAL_MAX - STORM_FLASH_INTERVAL_MIN);
      }
    } else {
      this.flashCountdown -= dt;
      if (this.flashCountdown <= 0) this.flashElapsed = 0;
    }
  }
}
