// FragmentMesh — unit tests

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { FragmentData } from '../../../src/core/mining/BlastExecution.js';
import { FragmentMesh } from '../../../src/renderer/FragmentMesh.js';

function makeFragment(id: number, overrides: Partial<FragmentData> = {}): FragmentData {
  return {
    id,
    position: { x: id * 2, y: 0.5, z: 0 },
    volume: 0.5,
    mass: 1350,
    rockId: 'sandite',
    oreDensities: {},
    initialVelocity: { x: 0, y: 5, z: 0 },
    isProjection: false,
    ...overrides,
  };
}

describe('FragmentMesh', () => {
  it('spawnFragments adds meshes to scene', () => {
    const scene = new THREE.Scene();
    const fm = new FragmentMesh(scene);
    fm.spawnFragments([makeFragment(1), makeFragment(2), makeFragment(3)]);
    expect(scene.children.length).toBe(3);
    expect(fm.count).toBe(3);
    fm.dispose();
  });

  it('fragments are sized relative to volume', () => {
    const scene = new THREE.Scene();
    const fm = new FragmentMesh(scene);
    const small = makeFragment(1, { volume: 0.1 });
    const large = makeFragment(2, { volume: 2.0 });
    fm.spawnFragments([small, large]);

    const m1 = scene.children[0] as THREE.Mesh;
    const m2 = scene.children[1] as THREE.Mesh;
    // Large fragment should have larger scale
    expect(m2.scale.x).toBeGreaterThan(m1.scale.x);
    fm.dispose();
  });

  it('projection fragments are rendered (isProjection=true)', () => {
    const scene = new THREE.Scene();
    const fm = new FragmentMesh(scene);
    fm.spawnFragments([makeFragment(10, { isProjection: true })]);
    expect(scene.children.length).toBe(1);
    // Material color should be reddish
    const mesh = scene.children[0] as THREE.Mesh;
    const mat = mesh.material as THREE.MeshPhongMaterial;
    expect(mat.color.r).toBeGreaterThan(mat.color.b);
    fm.dispose();
  });

  it('ore-rich fragments are tinted toward gold', () => {
    const scene = new THREE.Scene();
    const fm = new FragmentMesh(scene);
    const orePoor = makeFragment(1, { oreDensities: { gold: 0.01 }, rockId: 'cruite' });
    const oreRich = makeFragment(2, { oreDensities: { gold: 0.50 }, rockId: 'cruite' });
    fm.spawnFragments([orePoor, oreRich]);

    const mPoor = scene.children[0] as THREE.Mesh;
    const mRich = scene.children[1] as THREE.Mesh;
    const cPoor = (mPoor.material as THREE.MeshPhongMaterial).color;
    const cRich = (mRich.material as THREE.MeshPhongMaterial).color;
    // Gold tint should make ore-rich fragment have more red+green than poor
    const goldnessPoor = cPoor.r + cPoor.g;
    const goldnessRich = cRich.r + cRich.g;
    expect(goldnessRich).toBeGreaterThan(goldnessPoor);
    fm.dispose();
  });

  it('updatePositions moves mesh to new position', () => {
    const scene = new THREE.Scene();
    const fm = new FragmentMesh(scene);
    fm.spawnFragments([makeFragment(5)]);
    fm.updatePositions(new Map([[5, { x: 10, y: 20, z: 30 }]]));
    const mesh = scene.children[0] as THREE.Mesh;
    expect(mesh.position.x).toBeCloseTo(10);
    expect(mesh.position.y).toBeCloseTo(20);
    expect(mesh.position.z).toBeCloseTo(30);
    fm.dispose();
  });

  it('removeFragment removes specific mesh from scene', () => {
    const scene = new THREE.Scene();
    const fm = new FragmentMesh(scene);
    fm.spawnFragments([makeFragment(1), makeFragment(2), makeFragment(3)]);
    fm.removeFragment(2);
    expect(scene.children.length).toBe(2);
    expect(fm.count).toBe(2);
    fm.dispose();
  });

  it('clearAll removes all fragments', () => {
    const scene = new THREE.Scene();
    const fm = new FragmentMesh(scene);
    fm.spawnFragments([makeFragment(1), makeFragment(2), makeFragment(3)]);
    fm.clearAll();
    expect(scene.children.length).toBe(0);
    expect(fm.count).toBe(0);
    fm.dispose();
  });

  it('caps rendered fragments at MAX_RENDERED (2000)', () => {
    const scene = new THREE.Scene();
    const fm = new FragmentMesh(scene);
    const frags = Array.from({ length: 3000 }, (_, i) => makeFragment(i));
    fm.spawnFragments(frags);
    expect(fm.count).toBeLessThanOrEqual(2000);
    fm.dispose();
  });
});
