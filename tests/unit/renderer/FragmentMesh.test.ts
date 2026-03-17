// FragmentMesh — unit tests (InstancedMesh-based renderer)
//
// The renderer now uses 8 InstancedMesh objects (one per shape variant)
// for batched GPU rendering — 8 draw calls for any fragment count.
// Tests verify count tracking, position updates, removal, and capping.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { FragmentData } from '../../../src/core/mining/BlastExecution.js';
import { FragmentMesh } from '../../../src/renderer/FragmentMesh.js';

const SHAPE_VARIANTS = 8;

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

describe('FragmentMesh (InstancedMesh)', () => {
  it('constructor adds SHAPE_VARIANTS InstancedMesh objects to scene', () => {
    const scene = new THREE.Scene();
    const fm = new FragmentMesh(scene);
    expect(scene.children.length).toBe(SHAPE_VARIANTS);
    fm.dispose();
  });

  it('spawnFragments updates count correctly', () => {
    const scene = new THREE.Scene();
    const fm = new FragmentMesh(scene);
    fm.spawnFragments([makeFragment(1), makeFragment(2), makeFragment(3)]);
    expect(fm.count).toBe(3);
    fm.dispose();
  });

  it('count starts at 0 before spawning', () => {
    const scene = new THREE.Scene();
    const fm = new FragmentMesh(scene);
    expect(fm.count).toBe(0);
    fm.dispose();
  });

  it('spawnFragments places fragments into instanced buckets', () => {
    const scene = new THREE.Scene();
    const fm = new FragmentMesh(scene);
    // Spawn 8 fragments — one per shape variant (id % 8 distributes them)
    const frags = Array.from({ length: 8 }, (_, i) => makeFragment(i));
    fm.spawnFragments(frags);
    expect(fm.count).toBe(8);
    fm.dispose();
  });

  it('projection fragments are rendered (isProjection=true)', () => {
    const scene = new THREE.Scene();
    const fm = new FragmentMesh(scene);
    fm.spawnFragments([makeFragment(0, { isProjection: true })]);
    expect(fm.count).toBe(1);
    // Instanced mesh for bucket 0 should have count=1
    const im = scene.children[0] as THREE.InstancedMesh;
    expect(im.count).toBe(1);
    fm.dispose();
  });

  it('updatePositions changes instance matrix position', () => {
    const scene = new THREE.Scene();
    const fm = new FragmentMesh(scene);
    fm.spawnFragments([makeFragment(0)]);
    fm.updatePositions(new Map([[0, { x: 10, y: 20, z: 30 }]]));

    // Extract position from the instanced matrix
    const im = scene.children[0] as THREE.InstancedMesh;
    const mtx = new THREE.Matrix4();
    im.getMatrixAt(0, mtx);
    const pos = new THREE.Vector3();
    pos.setFromMatrixPosition(mtx);
    expect(pos.x).toBeCloseTo(10);
    expect(pos.y).toBeCloseTo(20);
    expect(pos.z).toBeCloseTo(30);
    fm.dispose();
  });

  it('removeFragment decrements count using swap-with-last', () => {
    const scene = new THREE.Scene();
    const fm = new FragmentMesh(scene);
    // Use fragments in same bucket (all id % 8 === 0)
    fm.spawnFragments([makeFragment(0), makeFragment(8), makeFragment(16)]);
    expect(fm.count).toBe(3);
    fm.removeFragment(8); // Remove middle fragment
    expect(fm.count).toBe(2);
    fm.dispose();
  });

  it('clearAll resets all counts to 0', () => {
    const scene = new THREE.Scene();
    const fm = new FragmentMesh(scene);
    fm.spawnFragments([makeFragment(0), makeFragment(1), makeFragment(2)]);
    fm.clearAll();
    expect(fm.count).toBe(0);
    // All instanced meshes should have count 0
    for (const child of scene.children) {
      expect((child as THREE.InstancedMesh).count).toBe(0);
    }
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

  it('dispose() removes all instanced meshes from scene', () => {
    const scene = new THREE.Scene();
    const fm = new FragmentMesh(scene);
    fm.spawnFragments([makeFragment(0), makeFragment(1)]);
    fm.dispose();
    expect(scene.children.length).toBe(0);
  });

  it('2000 fragments spawn without error (performance smoke test)', () => {
    const scene = new THREE.Scene();
    const fm = new FragmentMesh(scene);
    const frags = Array.from({ length: 2000 }, (_, i) => makeFragment(i));
    expect(() => fm.spawnFragments(frags)).not.toThrow();
    expect(fm.count).toBe(2000);
    fm.dispose();
  });
});
