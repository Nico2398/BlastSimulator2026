// BlastEffects — unit tests

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { BlastEffects, type BlastEffectConfig } from '../../../src/renderer/BlastEffects.js';

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
      delaySeconds: i * 0.1,
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

  it('trigger adds point lights to scene for each hole', () => {
    const { scene, be } = makeSetup();
    be.trigger(makeConfig(4));
    const lights = scene.children.filter((c) => c instanceof THREE.PointLight);
    expect(lights.length).toBe(4);
    be.dispose();
  });

  it('trigger adds dust particles to scene', () => {
    const { scene, be } = makeSetup();
    be.trigger(makeConfig());
    const particles = scene.children.filter((c) => c instanceof THREE.Points);
    expect(particles.length).toBeGreaterThan(0);
    be.dispose();
  });

  it('stop cleans up all lights and particles', () => {
    const { scene, be } = makeSetup();
    be.trigger(makeConfig(3));
    be.stop();
    expect(be.active).toBe(false);
    be.dispose();
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
