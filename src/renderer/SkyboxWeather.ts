// BlastSimulator2026 — Skybox and Weather Visuals
// Sky color changes per weather state with smooth gradual lerp transitions.
// Storm adds rapid flashes (brief white screen flash on DirectionalLight).
// Rain itself is ambient/RainField — it falls on game time, this stays real-time (#1601).
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
type FlashRandom = () => number;

interface SkyboxWeatherOptions {
  /** Injectable for deterministic tests; defaults to the renderer's own source. */
  random?: FlashRandom;
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
  }

  /**
   * Update sky transitions and storm flashes. Call every frame.
   * @param dt - real seconds since last call
   */
  update(dt: number): void {
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

    // Storm flashes advance the boost; the sun intensity is written once below, as baseline + boost
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
    this.scene.remove(this.skyDome);
    this.skyDome.geometry.dispose();
    this.skyDomeMaterial.dispose();
  }

  // ---------- Internal ----------

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
