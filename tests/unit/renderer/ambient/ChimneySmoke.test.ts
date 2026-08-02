// ChimneySmoke — unit tests (#458 T7.2/D12/A26)

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { ChimneySmoke } from '../../../../src/renderer/ambient/ChimneySmoke.js';
import type { Village, House } from '../../../../src/core/world/Structures.js';

function makeHouse(overrides?: Partial<House>): House {
  return { x: 0, z: 0, rotation: 0, w: 5, d: 6, h: 4, hasChimney: true, ...overrides };
}

function makeVillage(houses: House[]): Village {
  return { x: 0, z: 0, radius: 40, houses };
}

function smokeMesh(scene: THREE.Scene): THREE.InstancedMesh | undefined {
  return scene.children.find((c): c is THREE.InstancedMesh => c.name === 'chimney-smoke');
}

describe('ChimneySmoke', () => {
  it('constructs without a browser/DOM and adds one InstancedMesh sized 4 puffs per chimneyed house', () => {
    const scene = new THREE.Scene();
    const villages = [makeVillage([
      makeHouse({ x: 10, z: 10, hasChimney: true }),
      makeHouse({ x: 20, z: 20, hasChimney: true }),
      makeHouse({ x: 30, z: 30, hasChimney: false }), // no chimney — excluded
    ])];
    const smoke = new ChimneySmoke(scene, 42, villages);

    const mesh = smokeMesh(scene);
    expect(mesh).toBeDefined();
    expect(mesh!.count).toBe(2 * 4); // 2 chimneyed houses x 4 puffs
    smoke.dispose();
  });

  it('adds no mesh when no house has a chimney', () => {
    const scene = new THREE.Scene();
    const villages = [makeVillage([makeHouse({ hasChimney: false })])];
    const smoke = new ChimneySmoke(scene, 42, villages);
    expect(smokeMesh(scene)).toBeUndefined();
    smoke.dispose(); // must not throw with no mesh
  });

  it('update() does not throw with no villages and no camera activity needed', () => {
    const scene = new THREE.Scene();
    const smoke = new ChimneySmoke(scene, 42, []);
    expect(() => smoke.update(0.1, { x: 0, z: 0 }, new THREE.Vector3(0, 10, 10))).not.toThrow();
    smoke.dispose();
  });

  it('a puff rises over its cycle and resets — Y position oscillates rather than climbing forever', () => {
    const scene = new THREE.Scene();
    const villages = [makeVillage([makeHouse({ x: 0, z: 0, h: 4, hasChimney: true })])];
    const smoke = new ChimneySmoke(scene, 42, villages);
    const mesh = smokeMesh(scene)!;
    const camera = new THREE.Vector3(0, 50, 50);

    const yAt = (idx: number) => {
      const m = new THREE.Matrix4();
      mesh.getMatrixAt(idx, m);
      return new THREE.Vector3().setFromMatrixPosition(m).y;
    };

    const ys: number[] = [];
    for (let i = 0; i < 120; i++) {
      smoke.update(0.1, { x: 0, z: 0 }, camera);
      ys.push(yAt(0));
    }
    // Over 12 real seconds (2 full 6s cycles), Y must both rise and fall —
    // never monotonically increasing — proving it's a repeating puff, not a
    // single fragment climbing away forever.
    const roseAtSomePoint = ys.some((y, i) => i > 0 && y > ys[i - 1]!);
    const fellAtSomePoint = ys.some((y, i) => i > 0 && y < ys[i - 1]!);
    expect(roseAtSomePoint).toBe(true);
    expect(fellAtSomePoint).toBe(true);
    smoke.dispose();
  });

  it('is deterministic for a given seed', () => {
    const villages = [makeVillage([makeHouse({ x: 5, z: 5, hasChimney: true })])];
    const sceneA = new THREE.Scene();
    const sceneB = new THREE.Scene();
    const a = new ChimneySmoke(sceneA, 7, villages);
    const b = new ChimneySmoke(sceneB, 7, villages);
    const camera = new THREE.Vector3(0, 50, 50);
    for (let i = 0; i < 30; i++) {
      a.update(0.1, { x: 0.1, z: 0.05 }, camera);
      b.update(0.1, { x: 0.1, z: 0.05 }, camera);
    }
    const meshA = smokeMesh(sceneA)!;
    const meshB = smokeMesh(sceneB)!;
    const matA = new THREE.Matrix4();
    const matB = new THREE.Matrix4();
    for (let i = 0; i < meshA.count; i++) {
      meshA.getMatrixAt(i, matA);
      meshB.getMatrixAt(i, matB);
      expect(matA.equals(matB)).toBe(true);
    }
    a.dispose();
    b.dispose();
  });

  it('dispose removes the smoke mesh from the scene', () => {
    const scene = new THREE.Scene();
    const villages = [makeVillage([makeHouse({ hasChimney: true })])];
    const smoke = new ChimneySmoke(scene, 42, villages);
    expect(smokeMesh(scene)).toBeDefined();
    smoke.dispose();
    expect(smokeMesh(scene)).toBeUndefined();
  });
});
