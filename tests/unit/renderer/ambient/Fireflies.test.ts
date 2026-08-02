// Fireflies — unit tests (#458 T7.3)

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Fireflies } from '../../../../src/renderer/ambient/Fireflies.js';

const flatGround = () => 5;

function points(scene: THREE.Scene): THREE.Points | undefined {
  return scene.children.find((c): c is THREE.Points => c.name === 'fireflies');
}

describe('Fireflies', () => {
  it('constructs without a browser/DOM, adding one Points cloud', () => {
    const scene = new THREE.Scene();
    const fireflies = new Fireflies(scene, 42, 50, 50, flatGround);
    expect(points(scene)).toBeDefined();
    expect(fireflies.fireflyCount).toBeGreaterThan(0);
    fireflies.dispose();
  });

  it('is deterministic for a given seed', () => {
    const sceneA = new THREE.Scene();
    const sceneB = new THREE.Scene();
    const a = new Fireflies(sceneA, 7, 50, 50, flatGround);
    const b = new Fireflies(sceneB, 7, 50, 50, flatGround);
    a.update(1.5);
    b.update(1.5);

    const posA = points(sceneA)!.geometry.attributes['position']!.array;
    const posB = points(sceneB)!.geometry.attributes['position']!.array;
    expect(Array.from(posA)).toEqual(Array.from(posB));
    a.dispose();
    b.dispose();
  });

  it('produces a different seed a different layout', () => {
    const sceneA = new THREE.Scene();
    const sceneB = new THREE.Scene();
    const a = new Fireflies(sceneA, 1, 50, 50, flatGround);
    const b = new Fireflies(sceneB, 2, 50, 50, flatGround);

    const posA = Array.from(points(sceneA)!.geometry.attributes['position']!.array);
    const posB = Array.from(points(sceneB)!.geometry.attributes['position']!.array);
    expect(posA).not.toEqual(posB);
    a.dispose();
    b.dispose();
  });

  it('drifts and pulses over time — position/color changes between updates', () => {
    const scene = new THREE.Scene();
    const fireflies = new Fireflies(scene, 42, 50, 50, flatGround);
    const geo = points(scene)!.geometry;
    const posBefore = Array.from(geo.attributes['position']!.array);
    const colorBefore = Array.from(geo.attributes['color']!.array);

    fireflies.update(1);
    const posAfter = Array.from(geo.attributes['position']!.array);
    const colorAfter = Array.from(geo.attributes['color']!.array);

    expect(posAfter).not.toEqual(posBefore);
    expect(colorAfter).not.toEqual(colorBefore);
    fireflies.dispose();
  });

  it('samples ground height for vertical placement', () => {
    const scene = new THREE.Scene();
    const heights = new Map<string, number>();
    const sampler = (x: number, z: number) => {
      const h = 20 + x * 0.1;
      heights.set(`${Math.round(x)},${Math.round(z)}`, h);
      return h;
    };
    const fireflies = new Fireflies(scene, 42, 50, 50, sampler);
    expect(heights.size).toBeGreaterThan(0);
    fireflies.dispose();
  });

  it('dispose removes the points cloud from the scene', () => {
    const scene = new THREE.Scene();
    const fireflies = new Fireflies(scene, 42, 50, 50, flatGround);
    expect(points(scene)).toBeDefined();
    fireflies.dispose();
    expect(points(scene)).toBeUndefined();
  });
});
