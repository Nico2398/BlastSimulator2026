// CloudLayer — unit tests (#458 T7.1/D12/A25)

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CloudLayer } from '../../../../src/renderer/ambient/CloudLayer.js';

function makeSetup(seed = 42) {
  const scene = new THREE.Scene();
  const clouds = new CloudLayer(scene, seed, 80, 80);
  return { scene, clouds };
}

function instancedMeshes(scene: THREE.Scene): THREE.InstancedMesh[] {
  return scene.children.filter((c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh);
}

describe('CloudLayer', () => {
  it('constructs without a browser/DOM and adds 5 cluster-variant InstancedMeshes to the scene', () => {
    const { scene, clouds } = makeSetup();
    const meshes = instancedMeshes(scene);
    expect(meshes).toHaveLength(5);
    clouds.dispose();
  });

  it('starts with a non-empty cloud coverage matching the sunny default', () => {
    const { clouds } = makeSetup();
    expect(clouds.cloudCoverage).toBeGreaterThan(0);
    expect(clouds.cloudCoverage).toBeLessThan(1);
    clouds.dispose();
  });

  it('cloudOffset accumulates with a non-zero wind vector and stays put with none', () => {
    const { clouds } = makeSetup();
    const before = clouds.cloudOffset.clone();
    clouds.update(1, { x: 0, z: 0 });
    expect(clouds.cloudOffset.x).toBeCloseTo(before.x, 10);
    expect(clouds.cloudOffset.y).toBeCloseTo(before.y, 10);

    clouds.update(1, { x: 1, z: 0 });
    expect(clouds.cloudOffset.x).toBeGreaterThan(before.x);
    clouds.dispose();
  });

  it('setWeather(storm) raises coverage toward 1.0 over successive updates', () => {
    const { clouds } = makeSetup();
    clouds.setWeather('storm');
    const before = clouds.cloudCoverage;
    for (let i = 0; i < 200; i++) clouds.update(0.05, { x: 0, z: 0 });
    expect(clouds.cloudCoverage).toBeGreaterThan(before);
    expect(clouds.cloudCoverage).toBeGreaterThan(0.95);
    clouds.dispose();
  });

  it('setWeather(heat_wave) lowers coverage toward its sparse target', () => {
    const { clouds } = makeSetup();
    clouds.setWeather('storm');
    for (let i = 0; i < 200; i++) clouds.update(0.05, { x: 0, z: 0 });
    clouds.setWeather('heat_wave');
    for (let i = 0; i < 200; i++) clouds.update(0.05, { x: 0, z: 0 });
    expect(clouds.cloudCoverage).toBeLessThan(0.15);
    clouds.dispose();
  });

  it('higher coverage draws at least as many total instances as lower coverage', () => {
    const { scene, clouds } = makeSetup();
    clouds.setWeather('heat_wave');
    for (let i = 0; i < 200; i++) clouds.update(0.05, { x: 0, z: 0 });
    const sparseTotal = instancedMeshes(scene).reduce((s, m) => s + m.count, 0);

    clouds.setWeather('storm');
    for (let i = 0; i < 200; i++) clouds.update(0.05, { x: 0, z: 0 });
    const denseTotal = instancedMeshes(scene).reduce((s, m) => s + m.count, 0);

    expect(denseTotal).toBeGreaterThan(sparseTotal);
    clouds.dispose();
  });

  it('is deterministic for a given seed — same seed places instances identically', () => {
    const a = makeSetup(99);
    const b = makeSetup(99);
    const meshesA = instancedMeshes(a.scene);
    const meshesB = instancedMeshes(b.scene);
    const matA = new THREE.Matrix4();
    const matB = new THREE.Matrix4();
    for (let v = 0; v < meshesA.length; v++) {
      meshesA[v]!.getMatrixAt(0, matA);
      meshesB[v]!.getMatrixAt(0, matB);
      expect(matA.equals(matB)).toBe(true);
    }
    a.clouds.dispose();
    b.clouds.dispose();
  });

  it('dispose removes all cluster meshes from the scene', () => {
    const { scene, clouds } = makeSetup();
    expect(instancedMeshes(scene)).toHaveLength(5);
    clouds.dispose();
    expect(instancedMeshes(scene)).toHaveLength(0);
  });
});
