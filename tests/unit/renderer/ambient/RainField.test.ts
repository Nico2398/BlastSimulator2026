// RainField — unit tests (#1601): world-anchored rain that falls on game time.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { RainField, type RainView } from '../../../../src/renderer/ambient/RainField.js';
import type { GroundSampler } from '../../../../src/renderer/ambient/RainSplashes.js';

const DT = 1 / 60;
const CALM = { x: 0, z: 0 };
/** A view whose window cross-fades two layers (distance 74 → wanted width 222, between 128 and 256). */
const VIEW: RainView = { x: 40, y: 10, z: 40, distance: 74 };

function makeRain(seed = 42, ground?: GroundSampler) {
  const scene = new THREE.Scene();
  const rain = new RainField(scene, seed, ground);
  return { scene, rain };
}

function rainMeshes(scene: THREE.Scene): THREE.Mesh[] {
  return scene.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh && c.name.startsWith('rain-layer-'));
}

function positions(rain: RainField, layer: number): THREE.Vector3[] {
  return Array.from({ length: rain.dropsPerLayer }, (_, i) => rain.dropPosition(layer, i));
}

function raining(seed = 42, ground?: GroundSampler) {
  const setup = makeRain(seed, ground);
  setup.rain.setWeather('heavy_rain');
  setup.rain.update(DT, DT, VIEW, CALM);
  return setup;
}

/** True when `a` and `b` are the same point of the periodic field: equal on every axis up to whole windows. */
function samePeriodicPoint(a: THREE.Vector3, b: THREE.Vector3, width: number): boolean {
  const height = width / 2;
  const onAxis = (d: number, period: number) => {
    const k = Math.round(d / period);
    return Math.abs(d - k * period) < 1e-3;
  };
  return onAxis(b.x - a.x, width) && onAxis(b.y - a.y, height) && onAxis(b.z - a.z, width);
}

describe('RainField — construction and weather', () => {
  it('builds two streak layers without a DOM, hidden until it rains', () => {
    const { scene, rain } = makeRain();
    expect(rainMeshes(scene)).toHaveLength(2);
    rain.update(DT, DT, VIEW, CALM);
    expect(rain.visible).toBe(false);
    rain.dispose();
  });

  it('a first rainy setWeather snaps the rain on — a level loaded mid-storm opens raining', () => {
    const { rain } = makeRain();
    rain.setWeather('storm');
    rain.update(0, DT, VIEW, CALM); // even paused
    expect(rain.visible).toBe(true);
    rain.dispose();
  });

  it('dry weather fades the rain out on game time, and not at all while paused', () => {
    const { rain } = raining();
    rain.setWeather('sunny');
    for (let i = 0; i < 600; i++) rain.update(0, DT, VIEW, CALM);
    expect(rain.visible).toBe(true);
    for (let i = 0; i < 1200; i++) rain.update(DT, DT, VIEW, CALM);
    expect(rain.visible).toBe(false);
    rain.dispose();
  });

  it('starting to rain mid-game eases in rather than popping', () => {
    const { scene, rain } = makeRain();
    rain.setWeather('sunny');
    rain.update(DT, DT, VIEW, CALM);
    rain.setWeather('heavy_rain');
    rain.update(DT, DT, VIEW, CALM);
    const density = () => Math.max(...rainMeshes(scene).map(m => (m.material as THREE.ShaderMaterial).uniforms['uDensity']!.value as number));
    const early = density();
    for (let i = 0; i < 600; i++) rain.update(DT, DT, VIEW, CALM);
    expect(early).toBeGreaterThan(0);
    expect(density()).toBeGreaterThan(early * 5);
    rain.dispose();
  });

  it('dispose removes every rain mesh from the scene', () => {
    const { scene, rain } = makeRain(42, () => 0);
    const before = scene.children.length;
    rain.dispose();
    expect(scene.children.length).toBe(before - 3);
  });
});

describe('RainField — anchored in the world', () => {
  it('panning the camera moves no drop: each stays on its own point of the field', () => {
    const { rain } = raining();
    const before = [positions(rain, 0), positions(rain, 1)];
    const widths = [rain.layerWindow(0), rain.layerWindow(1)];

    rain.update(0, DT, { ...VIEW, x: VIEW.x + 7, z: VIEW.z - 4 }, CALM);

    for (let l = 0; l < 2; l++) {
      const after = positions(rain, l);
      expect(rain.layerWindow(l)).toBe(widths[l]);
      let unmoved = 0;
      for (let i = 0; i < after.length; i++) {
        // Only the copy at the window's far edge is swapped for its twin at the near edge.
        expect(samePeriodicPoint(before[l]![i]!, after[i]!, widths[l]!)).toBe(true);
        if (before[l]![i]!.distanceTo(after[i]!) < 1e-3) unmoved++;
      }
      expect(unmoved / after.length).toBeGreaterThan(0.9);
    }
    rain.dispose();
  });

  it('a pan does not drag the drops along with the camera, as the old rain box did', () => {
    const { rain } = raining();
    const before = positions(rain, 0);
    rain.update(0, DT, { ...VIEW, x: VIEW.x + 7 }, CALM);
    const after = positions(rain, 0);
    const dragged = after.filter((p, i) => Math.abs(p.x - before[i]!.x - 7) < 1e-3).length;
    expect(dragged).toBe(0);
    rain.dispose();
  });

  it('zooming across a level boundary keeps the level both layers share in place', () => {
    const { rain } = raining();
    // Wanted width 3·d crosses 256 at d ≈ 85.33: below it levels 128/256, above it 256/512.
    rain.update(0, DT, { ...VIEW, distance: 85 }, CALM);
    const shared = [0, 1].find(l => rain.layerWindow(l) === 256)!;
    const before = positions(rain, shared);
    rain.update(0, DT, { ...VIEW, distance: 87 }, CALM);
    expect(rain.layerWindow(shared)).toBe(256);
    expect(rain.layerWindow(1 - shared)).toBe(512);
    const after = positions(rain, shared);
    for (let i = 0; i < after.length; i++) expect(after[i]!.distanceTo(before[i]!)).toBeLessThan(1e-3);
    rain.dispose();
  });

  it('the window grows with the zoom so drops cover the view at any distance', () => {
    const { rain } = raining();
    for (const distance of [5, 30, 74, 200, 1200]) {
      rain.update(0, DT, { ...VIEW, distance }, CALM);
      const widest = Math.max(rain.layerWindow(0), rain.layerWindow(1));
      expect(widest).toBeGreaterThanOrEqual(distance * 3);
    }
    rain.dispose();
  });

  it('every drop is drawn inside the window around the view', () => {
    const { rain } = raining();
    for (let l = 0; l < 2; l++) {
      const half = rain.layerWindow(l) / 2;
      for (const p of positions(rain, l)) {
        expect(Math.abs(p.x - VIEW.x)).toBeLessThanOrEqual(half + 1e-3);
        expect(Math.abs(p.z - VIEW.z)).toBeLessThanOrEqual(half + 1e-3);
      }
    }
    rain.dispose();
  });
});

describe('RainField — follows game time', () => {
  it('paused (gameDt 0), the drops hang still however much real time passes', () => {
    const { rain } = raining();
    const motion = rain.motion;
    const before = positions(rain, 0);
    for (let i = 0; i < 300; i++) rain.update(0, DT, VIEW, { x: 0.8, z: -0.4 });
    expect(rain.motion.equals(motion)).toBe(true);
    const after = positions(rain, 0);
    for (let i = 0; i < after.length; i++) expect(after[i]!.equals(before[i]!)).toBe(true);
    rain.dispose();
  });

  it('falls 4x as far at 4x time scale as at 1x over the same real time', () => {
    const a = raining();
    const b = raining();
    const startA = a.rain.motion;
    const startB = b.rain.motion;
    for (let i = 0; i < 30; i++) {
      a.rain.update(DT, DT, VIEW, CALM);
      b.rain.update(4 * DT, DT, VIEW, CALM);
    }
    const fallA = startA.y - a.rain.motion.y;
    const fallB = startB.y - b.rain.motion.y;
    expect(fallA).toBeGreaterThan(0);
    expect(fallB).toBeCloseTo(fallA * 4, 6);
    a.rain.dispose();
    b.rain.dispose();
  });

  it('a falling drop moves down by exactly the field motion unless it wraps back to the top', () => {
    const { rain } = raining();
    const before = positions(rain, 0);
    const start = rain.motion;
    rain.update(0.1, 0.1, VIEW, CALM);
    const fall = start.y - rain.motion.y;
    const after = positions(rain, 0);
    const fell = after.filter((p, i) => Math.abs(before[i]!.y - p.y - fall) < 1e-3).length;
    expect(fell / after.length).toBeGreaterThan(0.9);
    rain.dispose();
  });

  it('the wind slants the fall the way it blows', () => {
    const { rain } = raining();
    const start = rain.motion;
    for (let i = 0; i < 60; i++) rain.update(DT, DT, VIEW, { x: 1, z: -0.5 });
    const moved = rain.motion.sub(start);
    expect(moved.y).toBeLessThan(0);
    expect(moved.x).toBeGreaterThan(0);
    expect(moved.z).toBeLessThan(0);
    rain.dispose();
  });

  it('a paused drop is drawn as a short, bigger teardrop; fast-forward stretches it, up to a cap', () => {
    const streakOf = (rate: number) => {
      const { scene, rain } = raining();
      for (let i = 0; i < 120; i++) rain.update(rate * DT, DT, VIEW, CALM);
      const u = (rainMeshes(scene).find(m => m.visible)!.material as THREE.ShaderMaterial).uniforms;
      const out = { length: (u['uTrail']!.value as THREE.Vector3).length(), radius: u['uRadius']!.value as number };
      rain.dispose();
      return out;
    };
    const paused = streakOf(0);
    const normal = streakOf(1);
    const fast = streakOf(4);
    const faster = streakOf(8);
    expect(paused.length).toBeLessThan(normal.length / 3);
    expect(paused.radius).toBeGreaterThan(normal.radius);
    expect(fast.length).toBeGreaterThan(normal.length * 2);
    // Capped: uncapped, 8x would draw twice as long as 4x — fast-forward never smears into a blur.
    expect(faster.length).toBeLessThan(fast.length * 1.2);
  });
});

describe('RainField — deterministic', () => {
  it('the same level seed lays out identical drops; another seed does not', () => {
    const a = raining(7);
    const b = raining(7);
    const c = raining(8);
    for (let i = 0; i < 50; i++) {
      for (const r of [a, b, c]) r.rain.update(DT, DT, VIEW, CALM);
    }
    const pa = positions(a.rain, 0);
    const pb = positions(b.rain, 0);
    const pc = positions(c.rain, 0);
    expect(pa.every((p, i) => p.equals(pb[i]!))).toBe(true);
    expect(pa.some((p, i) => !p.equals(pc[i]!))).toBe(true);
    for (const r of [a, b, c]) r.rain.dispose();
  });
});

describe('RainField — splashes', () => {
  const ground: GroundSampler = (x, z) => 0.1 * x + 0.05 * z;

  it('builds no splash layer without a ground sampler', () => {
    const { rain } = makeRain();
    expect(rain.splashLayer).toBeNull();
    rain.dispose();
  });

  it('a splash lands on the sampled ground and stays put there for its whole life', () => {
    const { rain } = raining(42, ground);
    const splashes = rain.splashLayer!;
    const s = splashes.splashAt(0);
    expect(s.y).toBeCloseTo(ground(s.x, s.z)!, 1);
    rain.update(0.05, 0.05, { ...VIEW, x: VIEW.x + 20 }, CALM);
    const later = splashes.splashAt(0);
    if (later.born === s.born) {
      expect(later.x).toBe(s.x);
      expect(later.z).toBe(s.z);
    }
    rain.dispose();
  });

  it('paused, every splash freezes mid-bounce; running, they keep landing anew', () => {
    const { rain } = raining(42, ground);
    const splashes = rain.splashLayer!;
    const snapshot = () => Array.from({ length: splashes.slotCount }, (_, i) => splashes.splashAt(i));
    const before = snapshot();
    for (let i = 0; i < 120; i++) rain.update(0, DT, VIEW, CALM);
    expect(snapshot()).toEqual(before);
    for (let i = 0; i < 60; i++) rain.update(DT, DT, VIEW, CALM);
    const moved = snapshot().filter((s, i) => s.born !== before[i]!.born).length;
    expect(moved).toBeGreaterThan(splashes.slotCount / 2);
    rain.dispose();
  });

  it('no splash lands where the sampler has no ground', () => {
    const { rain } = raining(42, () => null);
    const splashes = rain.splashLayer!;
    for (let i = 0; i < splashes.slotCount; i++) expect(splashes.splashAt(i).born).toBeLessThan(-1e8);
    rain.dispose();
  });

  it('splashes fade out once the camera is too far for them to read', () => {
    const { rain } = raining(42, ground);
    expect(rain.splashLayer!.visible).toBe(true);
    rain.update(DT, DT, { ...VIEW, distance: 400 }, CALM);
    expect(rain.splashLayer!.visible).toBe(false);
    rain.dispose();
  });
});
