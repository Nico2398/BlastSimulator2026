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

  it('spawnFragments displaces fragments downward so they sit inside the crater', () => {
    const scene = new THREE.Scene();
    const fm = new FragmentMesh(scene);
    fm.spawnFragments([makeFragment(0, { position: { x: 5, y: 10, z: 5 } })]);

    const im = scene.children[0] as THREE.InstancedMesh;
    const mtx = new THREE.Matrix4();
    im.getMatrixAt(0, mtx);
    const pos = new THREE.Vector3();
    pos.setFromMatrixPosition(mtx);

    // Rendered Y must be below the fragment's raw source position (crater offset),
    // but never pushed below the render floor.
    expect(pos.y).toBeLessThan(10);
    expect(pos.y).toBeGreaterThanOrEqual(9.4);
    fm.dispose();
  });

  it('spawnFragments clamps the render height to the minimum floor near y=0', () => {
    const scene = new THREE.Scene();
    const fm = new FragmentMesh(scene);
    fm.spawnFragments([makeFragment(0, { position: { x: 5, y: 0.1, z: 5 } })]);

    const im = scene.children[0] as THREE.InstancedMesh;
    const mtx = new THREE.Matrix4();
    im.getMatrixAt(0, mtx);
    const pos = new THREE.Vector3();
    pos.setFromMatrixPosition(mtx);

    // A fragment near the floor must be clamped to the render floor, not pushed to/below 0.
    expect(pos.y).toBeCloseTo(0.05, 5);
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

  it('samples the whole fragment array, not a leading prefix, when over the render cap', () => {
    // Regression: a large blast's fragments are generated in raster-scan
    // order, so a plain slice(0, cap) only ever showed one corner of the
    // blast zone — a visible "grid at the crater rim" artifact. All 20000
    // fragments span x=0..19999; rendered instances must cover that whole
    // span, not just the low end.
    const scene = new THREE.Scene();
    const fm = new FragmentMesh(scene);
    const frags = Array.from({ length: 20000 }, (_, i) =>
      makeFragment(i, { position: { x: i, y: 0.5, z: 0 } }));
    fm.spawnFragments(frags);
    // Sampling is hashed per-stratum (see sampleEvenly), so bucket fill isn't
    // perfectly even — assert "close to the cap", not exactly at it.
    expect(fm.count).toBeGreaterThan(1900);
    expect(fm.count).toBeLessThanOrEqual(2000);

    const xs: number[] = [];
    const mtx = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    for (const child of scene.children) {
      const im = child as THREE.InstancedMesh;
      for (let i = 0; i < im.count; i++) {
        im.getMatrixAt(i, mtx);
        pos.setFromMatrixPosition(mtx);
        xs.push(pos.x);
      }
    }
    expect(Math.max(...xs)).toBeGreaterThan(15000);
    fm.dispose();
  });

  it('scatters rendered (x, z) around the source voxel instead of stacking every fragment at the exact same point', () => {
    const scene = new THREE.Scene();
    const fm = new FragmentMesh(scene);
    // All fragments share the same source voxel (as multiple fragments from
    // one voxel do) — without render-only jitter they'd render at identical
    // (x, z), reading as a regular lattice instead of settled rubble.
    const frags = Array.from({ length: 20 }, (_, i) =>
      makeFragment(i, { position: { x: 5, y: 0.5, z: 5 } }));
    fm.spawnFragments(frags);

    const xz = new Set<string>();
    const mtx = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    for (const child of scene.children) {
      const im = child as THREE.InstancedMesh;
      for (let i = 0; i < im.count; i++) {
        im.getMatrixAt(i, mtx);
        pos.setFromMatrixPosition(mtx);
        xz.add(`${pos.x.toFixed(3)},${pos.z.toFixed(3)}`);
      }
    }
    expect(xz.size).toBeGreaterThan(1);
    fm.dispose();
  });

  it('displaces projected fragments along their initial velocity direction', () => {
    const scene = new THREE.Scene();
    const fm = new FragmentMesh(scene);
    fm.spawnFragments([makeFragment(0, {
      position: { x: 5, y: 0.5, z: 5 },
      isProjection: true,
      initialVelocity: { x: 20, y: 5, z: 0 },
    })]);

    const im = scene.children[0] as THREE.InstancedMesh;
    const mtx = new THREE.Matrix4();
    im.getMatrixAt(0, mtx);
    const pos = new THREE.Vector3();
    pos.setFromMatrixPosition(mtx);

    // Positive x velocity must displace the rendered fragment further in +x
    // than jitter alone (jitter radius is well under a metre).
    expect(pos.x).toBeGreaterThan(6);
    fm.dispose();
  });
});
