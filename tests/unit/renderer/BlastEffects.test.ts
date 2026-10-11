// BlastEffects — unit tests

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { BlastEffects, FLASH_LIGHT_POOL_SIZE, flashClusters, type BlastEffectConfig } from '../../../src/renderer/BlastEffects.js';

// performance.now is available in Node via vitest
function makeSetup() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 16/9, 0.5, 4000);
  camera.position.set(50, 80, 100);
  const be = new BlastEffects(scene, camera);
  return { scene, camera, be };
}

function makeConfig(holes = 3, energyLevel = 0.5): BlastEffectConfig {
  return {
    holes: Array.from({ length: holes }, (_, i) => ({
      x: i * 5, y: 0, z: 0,
    })),
    energyLevel,
    origin: new THREE.Vector3(10, 0, 0),
  };
}

describe('BlastEffects', () => {
  it('starts inactive', () => {
    const { be } = makeSetup();
    expect(be.active).toBe(false);
    be.dispose();
  });

  it('trigger makes effects active', () => {
    const { be } = makeSetup();
    be.trigger(makeConfig());
    expect(be.active).toBe(true);
    be.dispose();
  });

  // three.js compiles the scene's light count into every lit shader: a light
  // added or removed at runtime recompiles every material on screen (#1603).
  const pointLights = (scene: THREE.Scene): THREE.PointLight[] =>
    scene.children.filter((c): c is THREE.PointLight => c instanceof THREE.PointLight);

  it('owns a fixed pool of point lights from construction, dark until a blast', () => {
    const { scene, be } = makeSetup();
    const lights = pointLights(scene);
    expect(lights.length).toBe(FLASH_LIGHT_POOL_SIZE);
    for (const l of lights) {
      expect(l.intensity).toBe(0);
      expect(l.visible).toBe(true); // a hidden light drops out of the light count
    }
    be.dispose();
  });

  it('never adds or removes a scene object across trigger, update and stop', () => {
    const { scene, be } = makeSetup();
    const before = [...scene.children];
    for (const holes of [1, FLASH_LIGHT_POOL_SIZE, 30]) {
      be.trigger(makeConfig(holes));
      expect(scene.children).toEqual(before);
      for (let i = 0; i < 400; i++) be.update(0.016);
      expect(scene.children).toEqual(before);
    }
    be.trigger(makeConfig(6));
    be.stop();
    expect(scene.children).toEqual(before);
    be.dispose();
  });

  it('every hole flashes from the first frame (no per-hole stagger)', () => {
    const { scene, be } = makeSetup();
    be.trigger(makeConfig(FLASH_LIGHT_POOL_SIZE));
    be.update(0.016);
    for (const l of pointLights(scene)) expect(l.intensity).toBeGreaterThan(0);
    be.dispose();
  });

  it('a blast with more holes than lights still lights every pooled light', () => {
    const { scene, be } = makeSetup();
    be.trigger(makeConfig(30));
    be.update(0.016);
    for (const l of pointLights(scene)) expect(l.intensity).toBeGreaterThan(0);
    be.dispose();
  });

  it('flash lights go dark once the flash is over, staying in the scene', () => {
    const { scene, be } = makeSetup();
    be.trigger(makeConfig(3));
    for (let i = 0; i < 30; i++) be.update(0.016);
    const lights = pointLights(scene);
    expect(lights.length).toBe(FLASH_LIGHT_POOL_SIZE);
    for (const l of lights) expect(l.intensity).toBe(0);
    be.dispose();
  });

  it('dust is one persistent Points object, drawn empty until a blast', () => {
    const { scene, be } = makeSetup();
    const particles = scene.children.filter((c): c is THREE.Points => c instanceof THREE.Points);
    expect(particles.length).toBe(1);
    const dust = particles[0]!;
    // Idle: still rendered (so its shader compiles with the scene), but empty.
    expect(dust.visible).toBe(true);
    expect(dust.frustumCulled).toBe(false);
    expect(dust.geometry.drawRange.count).toBe(0);
    be.trigger(makeConfig());
    expect(dust.geometry.drawRange.count).toBeGreaterThan(0);
    be.dispose();
  });

  it('stop leaves every light dark and the dust empty', () => {
    const { scene, be } = makeSetup();
    be.trigger(makeConfig(3));
    be.stop();
    expect(be.active).toBe(false);
    for (const l of pointLights(scene)) expect(l.intensity).toBe(0);
    const dust = scene.children.find((c): c is THREE.Points => c instanceof THREE.Points)!;
    expect(dust.geometry.drawRange.count).toBe(0);
    be.dispose();
  });

  it('dispose takes the pooled objects out of the scene', () => {
    const { scene, be } = makeSetup();
    be.dispose();
    expect(pointLights(scene).length).toBe(0);
    expect(scene.children.some(c => c instanceof THREE.Points)).toBe(false);
  });

  it('camera shakes during active blast (position changes)', () => {
    const { camera, be } = makeSetup();
    const basePos = camera.position.clone();
    be.trigger(makeConfig(1, 1.0)); // max energy
    // Run several frames
    let shook = false;
    for (let i = 0; i < 30; i++) {
      be.update(0.016);
      if (camera.position.distanceTo(basePos) > 0.01) {
        shook = true;
        break;
      }
    }
    expect(shook).toBe(true);
    be.dispose();
  });

  it('effects become inactive after sufficient time', () => {
    const { be } = makeSetup();
    be.trigger(makeConfig(1, 0.1)); // small blast, fast settle
    // Run for 10 seconds
    for (let i = 0; i < 625; i++) be.update(0.016);
    expect(be.active).toBe(false);
    be.dispose();
  });

  it('high energy blast has larger shake amplitude', () => {
    const scene1 = new THREE.Scene();
    const cam1 = new THREE.PerspectiveCamera();
    cam1.position.set(0, 50, 100);
    const be1 = new BlastEffects(scene1, cam1);
    be1.trigger(makeConfig(1, 0.0)); // min energy

    const scene2 = new THREE.Scene();
    const cam2 = new THREE.PerspectiveCamera();
    cam2.position.set(0, 50, 100);
    const be2 = new BlastEffects(scene2, cam2);
    be2.trigger(makeConfig(1, 1.0)); // max energy

    let maxShake1 = 0, maxShake2 = 0;
    const base1 = cam1.position.clone();
    const base2 = cam2.position.clone();
    for (let i = 0; i < 30; i++) {
      be1.update(0.016);
      be2.update(0.016);
      maxShake1 = Math.max(maxShake1, cam1.position.distanceTo(base1));
      maxShake2 = Math.max(maxShake2, cam2.position.distanceTo(base2));
    }
    expect(maxShake2).toBeGreaterThanOrEqual(maxShake1);
    be1.dispose();
    be2.dispose();
  });
});

describe('flashClusters', () => {
  const holes = (n: number) => Array.from({ length: n }, (_, i) => ({ x: i * 4, y: 10, z: (i % 3) * 4 }));

  it('gives one cluster per hole while the holes fit the pool', () => {
    const clusters = flashClusters(holes(3), 4);
    expect(clusters.length).toBe(3);
    for (const c of clusters) {
      expect(c.holeCount).toBe(1);
      expect(c.spread).toBe(0);
    }
  });

  it('groups extra holes so the pool size is never exceeded and every hole is counted', () => {
    const clusters = flashClusters(holes(30), 4);
    expect(clusters.length).toBe(4);
    expect(clusters.reduce((n, c) => n + c.holeCount, 0)).toBe(30);
    for (const c of clusters) expect(c.spread).toBeGreaterThan(0);
  });

  it('places each cluster at its holes\' centroid', () => {
    const [c] = flashClusters([{ x: 0, y: 2, z: 0 }, { x: 4, y: 4, z: 6 }], 1);
    expect(c).toMatchObject({ x: 2, y: 3, z: 3, holeCount: 2 });
  });

  it('is empty for no holes or an empty pool', () => {
    expect(flashClusters([], 4)).toEqual([]);
    expect(flashClusters(holes(3), 0)).toEqual([]);
  });
});
