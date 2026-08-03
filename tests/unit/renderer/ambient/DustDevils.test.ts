// DustDevils — unit tests (#458 T7.3)

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { DustDevils } from '../../../../src/renderer/ambient/DustDevils.js';

const flatGround = () => 5;

function mesh(scene: THREE.Scene): THREE.InstancedMesh | undefined {
  return scene.children.find((c): c is THREE.InstancedMesh => c.name === 'dust-devils');
}

describe('DustDevils', () => {
  it('constructs without a browser/DOM, adding one InstancedMesh of devils', () => {
    const scene = new THREE.Scene();
    const devils = new DustDevils(scene, 42, 50, 50, flatGround);
    expect(mesh(scene)).toBeDefined();
    expect(devils.devilCount).toBeGreaterThan(0);
    devils.dispose();
  });

  it('is deterministic for a given seed', () => {
    const sceneA = new THREE.Scene();
    const sceneB = new THREE.Scene();
    const a = new DustDevils(sceneA, 7, 50, 50, flatGround);
    const b = new DustDevils(sceneB, 7, 50, 50, flatGround);
    a.update(1.5);
    b.update(1.5);

    const meshA = mesh(sceneA)!;
    const meshB = mesh(sceneB)!;
    const matA = new THREE.Matrix4();
    const matB = new THREE.Matrix4();
    for (let i = 0; i < a.devilCount; i++) {
      meshA.getMatrixAt(i, matA);
      meshB.getMatrixAt(i, matB);
      expect(matA.equals(matB)).toBe(true);
    }
    a.dispose();
    b.dispose();
  });

  it('produces different seeds a different layout', () => {
    const sceneA = new THREE.Scene();
    const sceneB = new THREE.Scene();
    const a = new DustDevils(sceneA, 1, 50, 50, flatGround);
    const b = new DustDevils(sceneB, 2, 50, 50, flatGround);

    const meshA = mesh(sceneA)!;
    const meshB = mesh(sceneB)!;
    const matA = new THREE.Matrix4();
    const matB = new THREE.Matrix4();
    let anyDifferent = false;
    for (let i = 0; i < a.devilCount; i++) {
      meshA.getMatrixAt(i, matA);
      meshB.getMatrixAt(i, matB);
      if (!matA.equals(matB)) anyDifferent = true;
    }
    expect(anyDifferent).toBe(true);
    a.dispose();
    b.dispose();
  });

  it('spins and wanders over time — position/rotation changes between updates', () => {
    const scene = new THREE.Scene();
    const devils = new DustDevils(scene, 42, 50, 50, flatGround);
    const m = mesh(scene)!;
    const before = new THREE.Matrix4();
    m.getMatrixAt(0, before);

    devils.update(2);
    const after = new THREE.Matrix4();
    m.getMatrixAt(0, after);

    expect(before.equals(after)).toBe(false);
    devils.dispose();
  });

  it('samples ground height for vertical placement', () => {
    const scene = new THREE.Scene();
    const heights = new Map<string, number>();
    const sampler = (x: number, z: number) => {
      const h = 20 + x * 0.1;
      heights.set(`${Math.round(x)},${Math.round(z)}`, h);
      return h;
    };
    const devils = new DustDevils(scene, 42, 50, 50, sampler);
    expect(heights.size).toBeGreaterThan(0);
    devils.dispose();
  });

  it('dispose removes the mesh from the scene', () => {
    const scene = new THREE.Scene();
    const devils = new DustDevils(scene, 42, 50, 50, flatGround);
    expect(mesh(scene)).toBeDefined();
    devils.dispose();
    expect(mesh(scene)).toBeUndefined();
  });
});
