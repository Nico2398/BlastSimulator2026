// FragmentMesh — unit tests (InstancedMesh-based renderer)
//
// The renderer uses SHAPE_VARIANTS InstancedMesh objects (one per shape
// variant) for batched GPU rendering — one draw call per variant regardless
// of fragment count. Tests verify count tracking, position updates, removal,
// and capping.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import type { FragmentData } from '../../../src/core/mining/BlastExecution.js';
import { FragmentMesh } from '../../../src/renderer/FragmentMesh.js';
import { rockIndexOf } from '../../../src/core/world/RockCatalog.js';
import { oreIndexOf } from '../../../src/core/world/OreCatalog.js';

const SHAPE_VARIANTS = 24;

/** A cheap stand-in for the shared TerrainMaterial — these tests exercise slot bookkeeping, not shading. */
function makeMaterial(): THREE.Material {
  return new THREE.MeshBasicMaterial();
}

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
    halfExtents: { x: 0.4, y: 0.4, z: 0.4 },
    shapeSeed: id * 2654435761 % 2147483647,
    ...overrides,
  };
}

/** Read the rendered position of one instance out of its InstancedMesh matrix. */
function getInstancePosition(im: THREE.InstancedMesh, index: number): THREE.Vector3 {
  const mtx = new THREE.Matrix4();
  im.getMatrixAt(index, mtx);
  const pos = new THREE.Vector3();
  pos.setFromMatrixPosition(mtx);
  return pos;
}

/** Every InstancedMesh bucket in the scene. */
function collectInstancedMeshes(scene: THREE.Scene): THREE.InstancedMesh[] {
  return scene.children.filter((c): c is THREE.InstancedMesh => (c as THREE.InstancedMesh).isInstancedMesh === true);
}

/** Collect the rendered position of every instance across every shape bucket in the scene. */
function collectInstancePositions(scene: THREE.Scene): THREE.Vector3[] {
  const positions: THREE.Vector3[] = [];
  for (const child of scene.children) {
    const im = child as THREE.InstancedMesh;
    for (let i = 0; i < im.count; i++) positions.push(getInstancePosition(im, i));
  }
  return positions;
}

describe('FragmentMesh (InstancedMesh)', () => {
  let scene: THREE.Scene;
  let fm: FragmentMesh;

  beforeEach(() => {
    scene = new THREE.Scene();
    fm = new FragmentMesh(scene, makeMaterial());
  });

  afterEach(() => {
    // A test that exercises dispose() itself already disposed fm; dispose()
    // isn't meant to be idempotent, so guard the cleanup call rather than
    // double-releasing instanced meshes that are already gone.
    try {
      fm.dispose();
    } catch {
      // already disposed by the test body
    }
  });

  it('constructor adds SHAPE_VARIANTS InstancedMesh objects to scene', () => {
    expect(scene.children.length).toBe(SHAPE_VARIANTS);
  });

  it('spawnFragments updates count correctly', () => {
    fm.spawnFragments([makeFragment(1), makeFragment(2), makeFragment(3)]);
    expect(fm.count).toBe(3);
  });

  it('count starts at 0 before spawning', () => {
    expect(fm.count).toBe(0);
  });

  it('spawnFragments places fragments into instanced buckets', () => {
    // Spawn 8 fragments — one per shape variant (id % 8 distributes them)
    const frags = Array.from({ length: 8 }, (_, i) => makeFragment(i));
    fm.spawnFragments(frags);
    expect(fm.count).toBe(8);
  });

  it('draws a fragment where the rock it was carved from actually was', () => {
    fm.spawnFragments([makeFragment(0, { position: { x: 5, y: 10, z: 5 } })]);

    const im = collectInstancedMeshes(scene).find(m => m.count > 0)!;
    const pos = getInstancePosition(im, 0);

    // The blast has already removed the rock at this point, so the fragment
    // belongs at its own centroid — no crater offset or scatter to fake it.
    expect(pos.x).toBeCloseTo(5, 5);
    expect(pos.y).toBeCloseTo(10, 5);
    expect(pos.z).toBeCloseTo(5, 5);
  });

  it('clamps the render height to the minimum floor near y=0', () => {
    fm.spawnFragments([makeFragment(0, { position: { x: 5, y: 0.01, z: 5 } })]);

    const im = collectInstancedMeshes(scene).find(m => m.count > 0)!;
    const pos = getInstancePosition(im, 0);

    expect(pos.y).toBeCloseTo(0.05, 5);
  });

  it('scales each instance to the fragment own bounding box', () => {
    fm.spawnFragments([makeFragment(0, { halfExtents: { x: 1.5, y: 0.3, z: 0.75 } })]);

    const im = collectInstancedMeshes(scene).find(m => m.count > 0)!;
    const mtx = new THREE.Matrix4();
    im.getMatrixAt(0, mtx);

    // A flat slab must render flat, not as a cube of equivalent volume. The
    // instance matrix carries rotation and a slight shear as well as the
    // scale, so read the singular values: the lengths of the images of the
    // basis vectors approximate the axis extents whatever the orientation.
    const cols = [
      Math.hypot(mtx.elements[0]!, mtx.elements[1]!, mtx.elements[2]!),
      Math.hypot(mtx.elements[4]!, mtx.elements[5]!, mtx.elements[6]!),
      Math.hypot(mtx.elements[8]!, mtx.elements[9]!, mtx.elements[10]!),
    ].sort((a, b) => a - b);

    // Shear sits between rotation and scale, so it stretches a column by at
    // most sqrt(1 + 2·SHEAR_MAX²) ≈ 3% — a flat slab stays flat.
    expect(cols[0]!).toBeGreaterThan(0.58);
    expect(cols[0]!).toBeLessThan(0.63);
    expect(cols[2]!).toBeGreaterThan(2.95);
    expect(cols[2]!).toBeLessThan(3.1);
  });

  it('projection fragments are rendered (isProjection=true)', () => {
    fm.spawnFragments([makeFragment(0, { isProjection: true })]);
    expect(fm.count).toBe(1);
    // Instanced mesh for bucket 0 should have count=1
    const im = scene.children[0] as THREE.InstancedMesh;
    expect(im.count).toBe(1);
  });

  it('updateTransforms changes instance matrix position', () => {
    fm.spawnFragments([makeFragment(0)]);
    fm.updateTransforms(new Map([[0, { x: 10, y: 20, z: 30, tumbleAngle: 0, settleScale: { x: 1, y: 1, z: 1 } }]]));

    // Extract position from the instanced matrix
    const im = scene.children[0] as THREE.InstancedMesh;
    const pos = getInstancePosition(im, 0);
    expect(pos.x).toBeCloseTo(10);
    expect(pos.y).toBeCloseTo(20);
    expect(pos.z).toBeCloseTo(30);
  });

  it('removeFragment decrements count using swap-with-last', () => {
    // Use fragments in same bucket (all id % 8 === 0)
    fm.spawnFragments([makeFragment(0), makeFragment(8), makeFragment(16)]);
    expect(fm.count).toBe(3);
    fm.removeFragment(8); // Remove middle fragment
    expect(fm.count).toBe(2);
  });

  it('clearAll resets all counts to 0', () => {
    fm.spawnFragments([makeFragment(0), makeFragment(1), makeFragment(2)]);
    fm.clearAll();
    expect(fm.count).toBe(0);
    // All instanced meshes should have count 0
    for (const child of scene.children) {
      expect((child as THREE.InstancedMesh).count).toBe(0);
    }
  });

  it('caps rendered fragments at MAX_RENDERED (2000)', () => {
    const frags = Array.from({ length: 3000 }, (_, i) => makeFragment(i));
    fm.spawnFragments(frags);
    expect(fm.count).toBeLessThanOrEqual(2000);
  });

  it('dispose() removes all instanced meshes from scene', () => {
    fm.spawnFragments([makeFragment(0), makeFragment(1)]);
    fm.dispose();
    expect(scene.children.length).toBe(0);
  });

  it('2000 fragments spawn without error (performance smoke test)', () => {
    const frags = Array.from({ length: 2000 }, (_, i) => makeFragment(i));
    expect(() => fm.spawnFragments(frags)).not.toThrow();
    expect(fm.count).toBe(2000);
  });

  it('samples the whole fragment array, not a leading prefix, when over the render cap', () => {
    // Regression: a large blast's fragments are generated in raster-scan
    // order, so a plain slice(0, cap) only ever showed one corner of the
    // blast zone — a visible "grid at the crater rim" artifact. All 20000
    // fragments span x=0..19999; rendered instances must cover that whole
    // span, not just the low end.
    const frags = Array.from({ length: 20000 }, (_, i) =>
      makeFragment(i, { position: { x: i, y: 0.5, z: 0 } }));
    fm.spawnFragments(frags);
    // Sampling is hashed per-stratum (see sampleEvenly), so bucket fill isn't
    // perfectly even — assert "close to the cap", not exactly at it.
    expect(fm.count).toBeGreaterThan(1900);
    expect(fm.count).toBeLessThanOrEqual(2000);

    const xs = collectInstancePositions(scene).map(p => p.x);
    expect(Math.max(...xs)).toBeGreaterThan(15000);
  });

  it('spreads fragments across the shape variants rather than marching through them in order', () => {
    // Fragment ids run consecutively, so keying the variant off the id alone
    // cycled through the eight shapes in lockstep and produced a visibly
    // repeating pattern across the muck pile.
    const frags = Array.from({ length: 64 }, (_, i) => makeFragment(i));
    fm.spawnFragments(frags);

    const used = collectInstancedMeshes(scene).filter(m => m.count > 0).length;
    expect(used).toBeGreaterThan(1);
  });

  describe('per-instance rock/ore attributes (#458 T4.1/A18)', () => {
    it('sets aRockA/aRockB to the fragment rock index and aRockWeight to 0 — a fragment is one source voxel', () => {
      fm.spawnFragments([makeFragment(0, { rockId: 'titanite' })]);
      const im = scene.children[0] as THREE.InstancedMesh;
      const expected = rockIndexOf('titanite');
      expect(im.geometry.getAttribute('aRockA').getX(0)).toBe(expected);
      expect(im.geometry.getAttribute('aRockB').getX(0)).toBe(expected);
      expect(im.geometry.getAttribute('aRockWeight').getX(0)).toBe(0);
    });

    it('sets aOre to (-1, 0) when the fragment carries no ore', () => {
      fm.spawnFragments([makeFragment(0, { oreDensities: {} })]);
      const im = scene.children[0] as THREE.InstancedMesh;
      const ore = im.geometry.getAttribute('aOre');
      expect(ore.getX(0)).toBe(-1);
      expect(ore.getY(0)).toBe(0);
    });

    it('sets aOre to the dominant ore index and its density when the fragment carries several ores', () => {
      fm.spawnFragments([makeFragment(0, { oreDensities: { rustite: 0.05, blingite: 0.22 } })]);
      const im = scene.children[0] as THREE.InstancedMesh;
      const ore = im.geometry.getAttribute('aOre');
      expect(ore.getX(0)).toBe(oreIndexOf('blingite'));
      expect(ore.getY(0)).toBeCloseTo(0.22, 6);
    });

    it('removeFragment swaps rock/ore attributes along with the matrix (swap-with-last)', () => {
      // A shared shape seed puts all three in one bucket, so the swap is
      // observable; distinct rocks make it visible which one moved.
      fm.spawnFragments([
        makeFragment(0, { rockId: 'cruite', shapeSeed: 8 }),
        makeFragment(8, { rockId: 'molite', shapeSeed: 8 }),
        makeFragment(16, { rockId: 'titanite', oreDensities: { treranium: 0.4 }, shapeSeed: 8 }),
      ]);
      const im = collectInstancedMeshes(scene).find(m => m.count > 0)!;

      fm.removeFragment(8); // vacates slot 1; slot 2 (titanite/treranium) swaps into it

      expect(im.geometry.getAttribute('aRockA').getX(1)).toBe(rockIndexOf('titanite'));
      expect(im.geometry.getAttribute('aRockB').getX(1)).toBe(rockIndexOf('titanite'));
      const ore = im.geometry.getAttribute('aOre');
      expect(ore.getX(1)).toBe(oreIndexOf('treranium'));
      expect(ore.getY(1)).toBeCloseTo(0.4, 6);
    });
  });

  describe('scene picking (P2)', () => {
    it('pickables() returns the 24 shape-variant buckets, each tagged with its bucket index', () => {
      const pickables = fm.pickables();
      expect(pickables).toHaveLength(SHAPE_VARIANTS);
      expect(pickables.every(o => o.userData['entityKind'] === 'fragment')).toBe(true);
      expect(pickables.map(o => o.userData['bucketIndex']).sort((a, b) => a - b))
        .toEqual(Array.from({ length: SHAPE_VARIANTS }, (_, i) => i));
    });

    it('fragmentIdAt() resolves a bucket slot back to the fragment id occupying it', () => {
      // Explicit matching shapeSeed forces both into bucket 3 — bucket assignment
      // is shapeSeed % SHAPE_VARIANTS, not id-derived, so two ids alone don't collide.
      fm.spawnFragments([makeFragment(3, { shapeSeed: 3 }), makeFragment(11, { shapeSeed: 3 })]);
      expect(fm.fragmentIdAt(3, 0)).toBe(3);
      expect(fm.fragmentIdAt(3, 1)).toBe(11);
    });

    it('fragmentIdAt() returns null for an empty slot', () => {
      fm.spawnFragments([makeFragment(3, { shapeSeed: 3 })]);
      expect(fm.fragmentIdAt(3, 1)).toBeNull();
    });

    it('fragmentIdAt() tracks a swap-with-last after removal', () => {
      fm.spawnFragments([
        makeFragment(0, { shapeSeed: 0 }),
        makeFragment(8, { shapeSeed: 0 }),
        makeFragment(16, { shapeSeed: 0 }),
      ]); // all bucket 0
      fm.removeFragment(8); // vacates slot 1; slot 2 (frag 16) swaps into it
      expect(fm.fragmentIdAt(0, 1)).toBe(16);
    });

    it('fragmentPosition() returns the fragment\'s current world position', () => {
      // Explicit shapeSeed pins the fragment to bucket 2, matching scene.children[2] below.
      fm.spawnFragments([makeFragment(2, { position: { x: 5, y: 1, z: -3 }, shapeSeed: 2 })]);
      const pos = fm.fragmentPosition(2);
      const rendered = getInstancePosition(scene.children[2] as THREE.InstancedMesh, 0);
      expect(pos?.x).toBeCloseTo(rendered.x);
      expect(pos?.y).toBeCloseTo(rendered.y);
      expect(pos?.z).toBeCloseTo(rendered.z);
    });

    it('fragmentPosition() reflects updateTransforms()', () => {
      fm.spawnFragments([makeFragment(2)]);
      fm.updateTransforms(new Map([[2, { x: 40, y: 2, z: -10, tumbleAngle: 0, settleScale: { x: 1, y: 1, z: 1 } }]]));
      const pos = fm.fragmentPosition(2);
      expect(pos?.x).toBeCloseTo(40);
      expect(pos?.y).toBeCloseTo(2);
      expect(pos?.z).toBeCloseTo(-10);
    });

    it('fragmentPosition() returns null for a fragment that was never spawned', () => {
      expect(fm.fragmentPosition(999)).toBeNull();
    });

    it('fragmentPosition() returns null for a fragment that has been removed', () => {
      fm.spawnFragments([makeFragment(4)]);
      fm.removeFragment(4);
      expect(fm.fragmentPosition(4)).toBeNull();
    });
  });
});
