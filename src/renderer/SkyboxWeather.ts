// BlastSimulator2026 — Skybox and Weather Visuals
// Sky color changes per weather state with smooth gradual lerp transitions.
// Rain produces a falling particle system (tiny cylinders / points).
// Storm adds rapid flashes (brief white screen flash on DirectionalLight).
//
// No actual skybox texture — procedural color sky matching Three.js scene.background.

import * as THREE from 'three';
import type { WeatherState } from '../core/weather/WeatherCycle.js';

// ---------- Sky colors per weather state ----------
// Colors for: scene.background + scene.fog

interface WeatherColors {
  skyHigh: THREE.Color;  // upper sky
  skyLow: THREE.Color;   // horizon / fog
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
const RAIN_AREA = 80;    // width/depth of rain box
const RAIN_HEIGHT = 50;  // height rain falls from
const RAIN_SPEED = 20;   // voxels per second downward
const RAIN_POINT_SIZE = 0.15;

// ---------- Transition speed ----------
// Lerp factor per second (0.5 = reaches ~63% in 2 seconds)
const TRANSITION_SPEED = 0.5;

// ---------- Storm flash ----------
const STORM_FLASH_INTERVAL_MIN = 3.0;  // seconds between lightning
const STORM_FLASH_INTERVAL_MAX = 8.0;
const STORM_FLASH_DURATION = 0.08;     // seconds the flash lasts

// ---------- Main class ----------

export class SkyboxWeather {
  private readonly scene: THREE.Scene;
  private readonly sun: THREE.DirectionalLight;
  private readonly ambient: THREE.AmbientLight;

  private currentWeather: WeatherState = 'sunny';
  private readonly currentSky = new THREE.Color(WEATHER_COLORS.sunny.skyLow);

  // Rain
  private rainPoints: THREE.Points | null = null;
  private readonly rainPositions: Float32Array;
  private rainVisible = false;

  // Storm
  private stormFlashTimer = 4.0;
  private stormFlashActive = false;
  private stormFlashRemaining = 0;

  constructor(
    scene: THREE.Scene,
    sun: THREE.DirectionalLight,
    ambient: THREE.AmbientLight,
  ) {
    this.scene = scene;
    this.sun = sun;
    this.ambient = ambient;

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
   */
  update(dt: number, cameraX: number, cameraZ: number): void {
    const target = WEATHER_COLORS[this.currentWeather];

    // Lerp sky color
    this.currentSky.lerp(target.skyLow, TRANSITION_SPEED * dt);
    this.scene.background = this.currentSky.clone();

    if (this.scene.fog instanceof THREE.Fog) {
      (this.scene.fog as THREE.Fog).color.copy(this.currentSky);
    }

    // Lerp sun / ambient
    this.sun.intensity += (target.sunIntensity - this.sun.intensity) * TRANSITION_SPEED * dt;
    this.ambient.intensity += (target.ambientIntensity - this.ambient.intensity) * TRANSITION_SPEED * dt;

    // Rain animation
    if (this.rainVisible) {
      this.updateRain(dt, cameraX, cameraZ);
    }

    // Storm flashes
    if (this.currentWeather === 'storm') {
      this.updateStormFlash(dt);
    }
  }

  dispose(): void {
    if (this.rainPoints) {
      this.scene.remove(this.rainPoints);
      this.rainPoints.geometry.dispose();
      (this.rainPoints.material as THREE.Material).dispose();
      this.rainPoints = null;
    }
  }

  // ---------- Internal ----------

  private initRainPositions(): void {
    for (let i = 0; i < RAIN_PARTICLE_COUNT; i++) {
      this.rainPositions[i * 3]     = (Math.random() - 0.5) * RAIN_AREA;
      this.rainPositions[i * 3 + 1] = Math.random() * RAIN_HEIGHT;
      this.rainPositions[i * 3 + 2] = (Math.random() - 0.5) * RAIN_AREA;
    }
  }

  private buildRainPoints(): void {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.rainPositions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xaaccff,
      size: RAIN_POINT_SIZE,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    });
    this.rainPoints = new THREE.Points(geo, mat);
    this.rainPoints.visible = false;
    this.scene.add(this.rainPoints);
  }

  private updateRain(dt: number, cx: number, cz: number): void {
    if (!this.rainPoints) return;

    const drop = RAIN_SPEED * dt;
    const halfArea = RAIN_AREA / 2;

    for (let i = 0; i < RAIN_PARTICLE_COUNT; i++) {
      const yIdx = i * 3 + 1;
      this.rainPositions[yIdx] = (this.rainPositions[yIdx] ?? 0) - drop;
      // Wrap around when particle hits ground
      if ((this.rainPositions[yIdx] ?? 0) < 0) {
        this.rainPositions[i * 3]     = cx + (Math.random() - 0.5) * RAIN_AREA;
        this.rainPositions[i * 3 + 1] = RAIN_HEIGHT;
        this.rainPositions[i * 3 + 2] = cz + (Math.random() - 0.5) * RAIN_AREA;
      }
    }

    // Follow camera
    this.rainPoints.position.x = cx;
    this.rainPoints.position.z = cz;
    void halfArea; // future: clamp particles relative to camera

    const geo = this.rainPoints.geometry;
    (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  private updateStormFlash(dt: number): void {
    if (this.stormFlashActive) {
      this.stormFlashRemaining -= dt;
      if (this.stormFlashRemaining <= 0) {
        // Flash end — restore sun intensity
        this.stormFlashActive = false;
        this.stormFlashTimer =
          STORM_FLASH_INTERVAL_MIN +
          Math.random() * (STORM_FLASH_INTERVAL_MAX - STORM_FLASH_INTERVAL_MIN);
      }
    } else {
      this.stormFlashTimer -= dt;
      if (this.stormFlashTimer <= 0) {
        // Trigger flash
        this.stormFlashActive = true;
        this.stormFlashRemaining = STORM_FLASH_DURATION;
        this.sun.intensity = 3.5; // brief bright flash
      }
    }
  }
}
