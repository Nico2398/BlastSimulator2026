// SkyboxWeather — unit tests

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { SkyboxWeather } from '../../../src/renderer/SkyboxWeather.js';
import type { WeatherState } from '../../../src/core/weather/WeatherCycle.js';

function makeSetup() {
  const scene = new THREE.Scene();
  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  const ambient = new THREE.AmbientLight(0xffffff, 0.55);
  const fill = new THREE.DirectionalLight(0xd0e8ff, 0.3);
  const sw = new SkyboxWeather(scene, sun, ambient, fill);
  return { scene, sun, ambient, fill, sw };
}

describe('SkyboxWeather', () => {
  it('creates without error and adds rain points to scene', () => {
    const { scene, sw } = makeSetup();
    // Rain particles should be in scene (even if not visible)
    expect(scene.children.length).toBeGreaterThan(0);
    sw.dispose();
  });

  it('setWeather storm makes rain visible', () => {
    const { scene, sw } = makeSetup();
    sw.setWeather('storm');
    const points = scene.children.find((c) => c instanceof THREE.Points);
    expect(points).toBeDefined();
    expect(points!.visible).toBe(true);
    sw.dispose();
  });

  it('setWeather sunny hides rain', () => {
    const { scene, sw } = makeSetup();
    sw.setWeather('heavy_rain');
    sw.setWeather('sunny');
    const points = scene.children.find((c) => c instanceof THREE.Points);
    expect(points!.visible).toBe(false);
    sw.dispose();
  });

  it('update transitions sky color toward target', () => {
    const { scene, sw } = makeSetup();
    sw.setWeather('storm');
    const initialBrightness = () => {
      const bg = scene.background as THREE.Color;
      return bg ? (bg.r + bg.g + bg.b) / 3 : 1;
    };
    const before = initialBrightness();
    // Run many frames to let lerp converge
    for (let i = 0; i < 120; i++) sw.update(0.016, 50, 50);
    const after = initialBrightness();
    // Storm sky should be darker than default sunny sky
    expect(after).toBeLessThan(before);
    sw.dispose();
  });

  it('update reduces sun intensity for rainy weather', () => {
    const { sun, sw } = makeSetup();
    // Sampled before setWeather: the first weather assignment snaps rather than
    // lerping, so sampling after it would already be at the rainy target.
    const initialIntensity = sun.intensity;
    sw.setWeather('heavy_rain');
    for (let i = 0; i < 120; i++) sw.update(0.016, 50, 50);
    expect(sun.intensity).toBeLessThan(initialIntensity);
    sw.dispose();
  });

  it('fill light tracks sun intensity at a fixed ratio, weather-modulated like sun (#458 T5.1)', () => {
    const { sun, fill, sw } = makeSetup();
    sw.setWeather('heat_wave'); // snaps on first call — sunIntensity 1.5
    expect(fill.intensity).toBeCloseTo(sun.intensity * 0.25, 5);

    sw.setWeather('storm'); // sunIntensity 0.10 — well below heat_wave's 1.5
    for (let i = 0; i < 120; i++) sw.update(0.016, 50, 50);
    expect(fill.intensity).toBeCloseTo(sun.intensity * 0.25, 2);
    expect(fill.intensity).toBeLessThan(0.25 * 1.5);
    sw.dispose();
  });

  it('skyColor getter tracks the lerped sky color AerialPerspectivePass tints haze with (#458 T5.2)', () => {
    const { sw } = makeSetup();
    sw.setWeather('storm'); // snaps — skyLow 0x3a4050
    expect(sw.skyColor.getHex()).toBe(0x3a4050);
    sw.setWeather('sunny');
    for (let i = 0; i < 2000; i++) sw.update(0.016, 50, 50);
    expect(sw.skyColor.getHex()).toBe(0x87ceeb);
    sw.dispose();
  });

  it('all weather states can be set without error', () => {
    const { sw } = makeSetup();
    const states: WeatherState[] = ['sunny', 'cloudy', 'light_rain', 'heavy_rain', 'storm', 'heat_wave', 'cold_snap'];
    for (const s of states) {
      sw.setWeather(s);
      sw.update(0.016, 50, 50);
    }
    sw.dispose();
  });

  it('dispose removes rain particles from scene', () => {
    const { scene, sw } = makeSetup();
    const before = scene.children.length;
    sw.dispose();
    expect(scene.children.length).toBeLessThan(before);
  });
});
