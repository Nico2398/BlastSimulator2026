// SkyboxWeather — unit tests

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  SkyboxWeather,
  flashLevel,
  STORM_FLASH_INTERVAL_MIN,
  STORM_FLASH_INTERVAL_MAX,
  STORM_FLASH_FIRST_DELAY,
  STORM_FLASH_PEAK_BOOST,
  STORM_FLASH_ENVELOPE,
  STORM_FLASH_DURATION,
} from '../../../src/renderer/SkyboxWeather.js';
import { Random } from '../../../src/core/math/Random.js';
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
  it('creates without error and adds the sky dome to the scene', () => {
    const { scene, sw } = makeSetup();
    expect(scene.children.length).toBeGreaterThan(0);
    sw.dispose();
  });

  it('draws no rain of its own — rain is ambient/RainField, on game time (#1601)', () => {
    const { scene, sw } = makeSetup();
    sw.setWeather('storm');
    sw.update(0.016);
    expect(scene.children.filter((c) => c instanceof THREE.Points)).toHaveLength(0);
    expect(scene.children).toHaveLength(1); // the dome
    sw.dispose();
  });

  it('update transitions sky color toward target', () => {
    const { sw } = makeSetup();
    // #458 T7.1/D12: scene.background is gone (a gradient dome mesh replaces
    // it — see the new "gradient sky dome" tests below), so this reads the
    // same lerped color the dome's uSkyLow uniform gets each frame.
    const brightness = (c: THREE.Color) => (c.r + c.g + c.b) / 3;
    // Sampled before setWeather: the first weather assignment snaps rather
    // than lerping, so sampling after it would already be at the storm target.
    const before = brightness(sw.skyColor);
    sw.setWeather('storm');
    // Run many frames to let lerp converge
    for (let i = 0; i < 120; i++) sw.update(0.016);
    const after = brightness(sw.skyColor);
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
    for (let i = 0; i < 120; i++) sw.update(0.016);
    expect(sun.intensity).toBeLessThan(initialIntensity);
    sw.dispose();
  });

  it('fill light tracks sun intensity at a fixed ratio, weather-modulated like sun (#458 T5.1)', () => {
    const { sun, fill, sw } = makeSetup();
    sw.setWeather('heat_wave'); // snaps on first call — sunIntensity 1.5
    expect(fill.intensity).toBeCloseTo(sun.intensity * 0.25, 5);

    sw.setWeather('storm'); // sunIntensity 0.10 — well below heat_wave's 1.5
    for (let i = 0; i < 120; i++) sw.update(0.016);
    expect(fill.intensity).toBeCloseTo(sun.intensity * 0.25, 2);
    expect(fill.intensity).toBeLessThan(0.25 * 1.5);
    sw.dispose();
  });

  it('skyColor getter tracks the lerped sky color AerialPerspectivePass tints haze with (#458 T5.2)', () => {
    const { sw } = makeSetup();
    sw.setWeather('storm'); // snaps — skyLow 0x3a4050
    expect(sw.skyColor.getHex()).toBe(0x3a4050);
    sw.setWeather('sunny');
    for (let i = 0; i < 2000; i++) sw.update(0.016);
    expect(sw.skyColor.getHex()).toBe(0x87ceeb);
    sw.dispose();
  });

  it('all weather states can be set without error', () => {
    const { sw } = makeSetup();
    const states: WeatherState[] = ['sunny', 'cloudy', 'light_rain', 'heavy_rain', 'storm', 'heat_wave', 'cold_snap'];
    for (const s of states) {
      sw.setWeather(s);
      sw.update(0.016);
    }
    sw.dispose();
  });

  it('dispose removes everything it added from the scene', () => {
    const { scene, sw } = makeSetup();
    sw.dispose();
    expect(scene.children).toHaveLength(0);
  });

  // ── #458 T7.1/D12/A25: gradient sky dome ──

  it('adds a large backside gradient dome to the scene and clears the flat background', () => {
    const { scene, sw } = makeSetup();
    const dome = scene.children.find(
      (c): c is THREE.Mesh => c instanceof THREE.Mesh && c.geometry instanceof THREE.SphereGeometry,
    );
    expect(dome).toBeDefined();
    expect((dome!.material as THREE.ShaderMaterial).side).toBe(THREE.BackSide);
    // A flat scene.background would double-draw behind the dome for nothing —
    // the dome is now the only thing painting the sky.
    expect(scene.background).toBeNull();
    sw.dispose();
  });

  it('dome shader uniforms track skyLow/skyHigh — never construct/lights/fog', () => {
    const { scene, sw } = makeSetup();
    const dome = scene.children.find(
      (c): c is THREE.Mesh => c instanceof THREE.Mesh && c.geometry instanceof THREE.SphereGeometry,
    )!;
    const mat = dome.material as THREE.ShaderMaterial;
    expect(mat.fog).toBe(false);
    expect(mat.lights).toBe(false);

    sw.setWeather('storm'); // snaps — skyLow 0x3a4050, skyHigh 0x2a3040
    expect((mat.uniforms['uSkyLow']!.value as THREE.Color).getHex()).toBe(0x3a4050);
    expect((mat.uniforms['uSkyHigh']!.value as THREE.Color).getHex()).toBe(0x2a3040);

    sw.setWeather('sunny');
    for (let i = 0; i < 2000; i++) sw.update(0.016);
    expect((mat.uniforms['uSkyLow']!.value as THREE.Color).getHex()).toBe(0x87ceeb);
    expect((mat.uniforms['uSkyHigh']!.value as THREE.Color).getHex()).toBe(0x4fc3f7);
    sw.dispose();
  });

  it('dispose removes the sky dome from the scene', () => {
    const { scene, sw } = makeSetup();
    sw.dispose();
    const dome = scene.children.find((c) => c instanceof THREE.Mesh && c.geometry instanceof THREE.SphereGeometry);
    expect(dome).toBeUndefined();
  });
});

describe('storm lightning flash', () => {
  const DT = 1 / 60;
  const STORM_BASE = 0.10; // storm sunIntensity; first setWeather snaps to it
  const EPS = 1e-9;

  function makeStorm(random: () => number = () => 0.5) {
    const scene = new THREE.Scene();
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    const ambient = new THREE.AmbientLight(0xffffff, 0.55);
    const fill = new THREE.DirectionalLight(0xd0e8ff, 0.3);
    const sw = new SkyboxWeather(scene, sun, ambient, fill, { random });
    sw.setWeather('storm');
    return { sun, sw };
  }

  /** Step `seconds` of sim in DT frames; returns sun intensity after each frame with its end time. */
  function run(sw: SkyboxWeather, sun: { intensity: number }, seconds: number, startT = 0) {
    const out: { t: number; v: number }[] = [];
    const n = Math.round(seconds / DT);
    for (let i = 1; i <= n; i++) {
      sw.update(DT);
      out.push({ t: startT + i * DT, v: sun.intensity });
    }
    return out;
  }

  /** Start times of flashes: first frame of each run above baseline + threshold. */
  function flashStarts(series: { t: number; v: number }[], base = STORM_BASE, thr = 0.5) {
    const starts: number[] = [];
    let prevHigh = false;
    let lastHighT = -Infinity;
    for (const { t, v } of series) {
      const high = v > base + thr;
      // a flash is one cluster: runs closer than the flash duration are the same flash
      if (high && !prevHigh && t - lastHighT > STORM_FLASH_DURATION) starts.push(t);
      if (high) lastHighT = t;
      prevHigh = high;
    }
    return starts;
  }

  describe('flashLevel / envelope', () => {
    it('envelope is ascending in time, starts at 0s and ends at level 0', () => {
      for (let i = 1; i < STORM_FLASH_ENVELOPE.length; i++) {
        expect(STORM_FLASH_ENVELOPE[i]!.at).toBeGreaterThan(STORM_FLASH_ENVELOPE[i - 1]!.at);
      }
      expect(STORM_FLASH_ENVELOPE[0]!.at).toBe(0);
      expect(STORM_FLASH_ENVELOPE[STORM_FLASH_ENVELOPE.length - 1]!.level).toBe(0);
    });

    it('duration equals last keyframe and is at most 0.3s', () => {
      expect(STORM_FLASH_DURATION).toBe(STORM_FLASH_ENVELOPE[STORM_FLASH_ENVELOPE.length - 1]!.at);
      expect(STORM_FLASH_DURATION).toBeLessThanOrEqual(0.3);
    });

    it('returns keyframe levels at keyframe times', () => {
      for (const k of STORM_FLASH_ENVELOPE) expect(flashLevel(k.at)).toBeCloseTo(k.level, 9);
    });

    it('interpolates linearly between keyframes', () => {
      expect(flashLevel(0.03)).toBeCloseTo(1, 9);
      expect(flashLevel(0.08)).toBeCloseTo(0.5, 9);
      expect(flashLevel(0.13)).toBeCloseTo(0, 9);
      expect(flashLevel(0.235)).toBeCloseTo(0.3, 9);
    });

    it('is 0 before the flash and at or after its end', () => {
      expect(flashLevel(-0.01)).toBe(0);
      expect(flashLevel(-100)).toBe(0);
      expect(flashLevel(STORM_FLASH_DURATION)).toBe(0);
      expect(flashLevel(STORM_FLASH_DURATION + 0.001)).toBe(0);
      expect(flashLevel(1000)).toBe(0);
    });

    it('stays within 0..1 everywhere', () => {
      for (let t = -0.1; t < 0.5; t += 0.005) {
        expect(flashLevel(t)).toBeGreaterThanOrEqual(0);
        expect(flashLevel(t)).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('timing', () => {
    it('first setWeather snap has no flash', () => {
      const { sun } = makeStorm();
      expect(sun.intensity).toBeCloseTo(STORM_BASE, 9);
    });

    it('no flash before STORM_FLASH_FIRST_DELAY', () => {
      const { sun, sw } = makeStorm();
      const series = run(sw, sun, STORM_FLASH_FIRST_DELAY - 0.2);
      for (const { v } of series) expect(Math.abs(v - STORM_BASE)).toBeLessThan(EPS);
    });

    it('first flash fires at STORM_FLASH_FIRST_DELAY after entering storm', () => {
      const { sun, sw } = makeStorm();
      const series = run(sw, sun, STORM_FLASH_FIRST_DELAY + 0.5);
      const first = series.find((p) => p.v > STORM_BASE + 0.5);
      expect(first).toBeDefined();
      expect(first!.t).toBeGreaterThanOrEqual(STORM_FLASH_FIRST_DELAY - 2 * DT);
      expect(first!.t).toBeLessThanOrEqual(STORM_FLASH_FIRST_DELAY + 2 * DT);
    });

    it('no flash outside storm weather', () => {
      const scene = new THREE.Scene();
      const sun = new THREE.DirectionalLight(0xffffff, 1.2);
      const sw = new SkyboxWeather(scene, sun, new THREE.AmbientLight(), new THREE.DirectionalLight(), {
        random: () => 0,
      });
      sw.setWeather('heavy_rain');
      const series = run(sw, sun, 30);
      for (const { v } of series) expect(v).toBeLessThanOrEqual(1.2 + 1e-6);
    });
  });

  describe('envelope in the sun light', () => {
    it('reaches the peak boost above baseline', () => {
      const { sun, sw } = makeStorm();
      const series = run(sw, sun, STORM_FLASH_FIRST_DELAY + 0.5);
      const max = Math.max(...series.map((p) => p.v));
      expect(max).toBeGreaterThanOrEqual(STORM_BASE + 0.9 * STORM_FLASH_PEAK_BOOST);
      expect(max).toBeLessThanOrEqual(STORM_BASE + STORM_FLASH_PEAK_BOOST + 1e-6);
    });

    it('returns to baseline within 0.3s of the flash start', () => {
      const { sun, sw } = makeStorm();
      const series = run(sw, sun, STORM_FLASH_FIRST_DELAY + 1);
      const start = series.find((p) => p.v > STORM_BASE + 1e-6)!;
      expect(start).toBeDefined();
      for (const p of series) {
        if (p.t >= start.t + 0.3) expect(Math.abs(p.v - STORM_BASE)).toBeLessThan(EPS);
      }
    });

    it('one frame after the envelope ends the boost is gone (no slow decay)', () => {
      const { sun, sw } = makeStorm();
      const series = run(sw, sun, STORM_FLASH_FIRST_DELAY + 1);
      const startIdx = series.findIndex((p) => p.v > STORM_BASE + 1e-6);
      const afterIdx = startIdx + Math.ceil(STORM_FLASH_DURATION / DT) + 1;
      expect(series[afterIdx]!.v - STORM_BASE).toBeLessThan(0.01);
    });

    it('double flicker yields two separate bright runs with a dip between', () => {
      const { sun, sw } = makeStorm();
      const series = run(sw, sun, STORM_FLASH_FIRST_DELAY + 0.6);
      const startIdx = series.findIndex((p) => p.v > STORM_BASE + 1e-6);
      const win = series.slice(startIdx, startIdx + Math.ceil(STORM_FLASH_DURATION / DT) + 2);
      let runs = 0;
      let inRun = false;
      for (const { v } of win) {
        const high = v > STORM_BASE + 0.3;
        if (high && !inRun) runs++;
        inRun = high;
      }
      expect(runs).toBe(2);
      const first = win.findIndex((p) => p.v > STORM_BASE + 0.9 * STORM_FLASH_PEAK_BOOST);
      expect(first).toBeGreaterThanOrEqual(0);
      const dip = Math.min(...win.slice(first).map((p) => p.v).slice(0, Math.ceil(0.2 / DT)));
      expect(dip).toBeLessThan(STORM_BASE + 0.1);
    });

    it('sun follows baseline + flashLevel(t) * boost frame by frame', () => {
      const { sun, sw } = makeStorm();
      const series = run(sw, sun, STORM_FLASH_FIRST_DELAY + 0.6);
      const start = series.find((p) => p.v > STORM_BASE + 1e-6)!;
      for (const p of series) {
        const dt = p.t - start.t;
        if (dt < 0 || dt > 0.3) continue;
        // envelope level is 1 at t=0, so the first visible frame is elapsed 0
        expect(p.v).toBeCloseTo(STORM_BASE + flashLevel(dt) * STORM_FLASH_PEAK_BOOST, 6);
      }
    });

    it('baseline is not polluted across several flashes', () => {
      const { sun, sw } = makeStorm();
      const series = run(sw, sun, 60);
      const calm = series.filter((p) => Math.abs(p.v - STORM_BASE) < 1e-6);
      expect(calm.length).toBeGreaterThan(series.length * 0.8);
      // after the last frame of a long run that ends between flashes, check a settled sample
      for (const p of calm) expect(Math.abs(p.v - STORM_BASE)).toBeLessThan(EPS);
      // never dips below baseline
      for (const p of series) expect(p.v).toBeGreaterThanOrEqual(STORM_BASE - EPS);
    });

    it('a large dt spike ends a running flash in one step', () => {
      const { sun, sw } = makeStorm();
      let guard = 0;
      while (sun.intensity <= STORM_BASE + 1 && guard++ < 1000) sw.update(DT);
      expect(sun.intensity).toBeGreaterThan(STORM_BASE + 1);
      sw.update(0.5);
      expect(Math.abs(sun.intensity - STORM_BASE)).toBeLessThan(1e-6);
    });
  });

  describe('weather changes', () => {
    it('leaving storm mid-flash clears the boost and no flash fires afterwards', () => {
      const { sun, sw } = makeStorm();
      let guard = 0;
      while (sun.intensity <= STORM_BASE + 1 && guard++ < 1000) sw.update(DT);
      sw.setWeather('sunny');
      sw.update(DT);
      expect(sun.intensity).toBeLessThan(0.3);
      const series = run(sw, sun, 40);
      for (const { v } of series) expect(v).toBeLessThanOrEqual(1.2 + 1e-6);
    });

    it('re-entering storm restarts the first-flash delay', () => {
      const { sun, sw } = makeStorm();
      run(sw, sun, 1.0);
      sw.setWeather('cloudy');
      run(sw, sun, 10);
      sw.setWeather('storm');
      const early = run(sw, sun, STORM_FLASH_FIRST_DELAY - 0.4);
      for (const { v } of early) expect(v).toBeLessThan(1.0);
      const later = run(sw, sun, 0.8);
      expect(Math.max(...later.map((p) => p.v))).toBeGreaterThan(3);
    });
  });

  describe('injected random', () => {
    function secondFlashGap(r: number) {
      const { sun, sw } = makeStorm(() => r);
      const series = run(sw, sun, STORM_FLASH_FIRST_DELAY + STORM_FLASH_INTERVAL_MAX + 3);
      return flashStarts(series);
    }

    it('random 0 spaces flashes by the minimum interval', () => {
      const starts = secondFlashGap(0);
      expect(starts.length).toBeGreaterThanOrEqual(2);
      const gap = starts[1]! - starts[0]!;
      expect(gap).toBeGreaterThanOrEqual(STORM_FLASH_INTERVAL_MIN + STORM_FLASH_DURATION - 2 * DT);
      expect(gap).toBeLessThanOrEqual(STORM_FLASH_INTERVAL_MIN + STORM_FLASH_DURATION + 2 * DT);
    });

    it('random 0.999999 spaces flashes by about the maximum interval', () => {
      const starts = secondFlashGap(0.999999);
      expect(starts.length).toBeGreaterThanOrEqual(2);
      const gap = starts[1]! - starts[0]!;
      expect(gap).toBeGreaterThanOrEqual(STORM_FLASH_INTERVAL_MAX + STORM_FLASH_DURATION - 2 * DT);
      expect(gap).toBeLessThanOrEqual(STORM_FLASH_INTERVAL_MAX + STORM_FLASH_DURATION + 2 * DT);
    });

    it('random 0.5 gives the mid interval', () => {
      const mid = STORM_FLASH_INTERVAL_MIN + 0.5 * (STORM_FLASH_INTERVAL_MAX - STORM_FLASH_INTERVAL_MIN);
      const starts = secondFlashGap(0.5);
      const gap = starts[1]! - starts[0]!;
      expect(gap).toBeGreaterThanOrEqual(mid + STORM_FLASH_DURATION - 2 * DT);
      expect(gap).toBeLessThanOrEqual(mid + STORM_FLASH_DURATION + 2 * DT);
    });

    it('draws from the injected source once a flash has happened', () => {
      let calls = 0;
      const { sun, sw } = makeStorm(() => { calls++; return 0.5; });
      run(sw, sun, STORM_FLASH_FIRST_DELAY + 1);
      expect(calls).toBeGreaterThanOrEqual(1);
    });

    it('same seed gives identical sun series; different seed differs', () => {
      const a = new Random(42);
      const b = new Random(42);
      const c = new Random(7);
      const ra = makeStorm(() => a.next());
      const rb = makeStorm(() => b.next());
      const rc = makeStorm(() => c.next());
      const sa = run(ra.sw, ra.sun, 60).map((p) => p.v);
      const sb = run(rb.sw, rb.sun, 60).map((p) => p.v);
      const sc = run(rc.sw, rc.sun, 60).map((p) => p.v);
      expect(sa).toEqual(sb);
      expect(sa).not.toEqual(sc);
    });
  });
});
