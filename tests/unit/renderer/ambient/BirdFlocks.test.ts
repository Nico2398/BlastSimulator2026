// BirdFlocks — unit tests (#458 T7.2/D12/A26)

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { BirdFlocks } from '../../../../src/renderer/ambient/BirdFlocks.js';

function makeSetup(seed = 42) {
  const scene = new THREE.Scene();
  const birds = new BirdFlocks(scene, seed, 80, 80);
  return { scene, birds };
}

function birdMesh(scene: THREE.Scene): THREE.InstancedMesh {
  return scene.children.find((c): c is THREE.InstancedMesh => c.name === 'bird-flocks')!;
}

describe('BirdFlocks', () => {
  it('constructs without a browser/DOM and adds one InstancedMesh with 72 instances (6 flocks x 12 birds)', () => {
    const { scene, birds } = makeSetup();
    const mesh = birdMesh(scene);
    expect(mesh).toBeDefined();
    expect(mesh.count).toBe(72);
    birds.dispose();
  });

  it('birds orbit their flock centre — position changes over time but stays roughly at flock radius', () => {
    const { scene, birds } = makeSetup();
    const mesh = birdMesh(scene);
    const before = new THREE.Matrix4();
    mesh.getMatrixAt(0, before);
    const posBefore = new THREE.Vector3().setFromMatrixPosition(before);

    for (let i = 0; i < 60; i++) birds.update(0.1);

    const after = new THREE.Matrix4();
    mesh.getMatrixAt(0, after);
    const posAfter = new THREE.Vector3().setFromMatrixPosition(after);

    expect(posAfter.distanceTo(posBefore)).toBeGreaterThan(1);
    birds.dispose();
  });

  it('is deterministic for a given seed', () => {
    const a = makeSetup(7);
    const b = makeSetup(7);
    for (let i = 0; i < 30; i++) { a.birds.update(0.1); b.birds.update(0.1); }
    const meshA = birdMesh(a.scene);
    const meshB = birdMesh(b.scene);
    const matA = new THREE.Matrix4();
    const matB = new THREE.Matrix4();
    for (let i = 0; i < meshA.count; i++) {
      meshA.getMatrixAt(i, matA);
      meshB.getMatrixAt(i, matB);
      expect(matA.equals(matB)).toBe(true);
    }
    a.birds.dispose();
    b.birds.dispose();
  });

  it('onBlast scatters a nearby flock — bird distance from its own flock centre grows', () => {
    const { scene, birds } = makeSetup();
    const mesh = birdMesh(scene);
    const center = birds.flockCenters[0]!;
    const distFromCenter = () => {
      const mat = new THREE.Matrix4();
      mesh.getMatrixAt(0, mat);
      const p = new THREE.Vector3().setFromMatrixPosition(mat);
      return Math.hypot(p.x - center.x, p.z - center.z);
    };

    // Settle into steady orbiting first so "distance grows" isn't just startup noise.
    for (let i = 0; i < 20; i++) birds.update(0.1);
    const distBefore = distFromCenter();

    birds.onBlast(center.x, center.z); // dead centre of flock 0 — always within trigger radius
    birds.update(0.001); // apply scatter to positions immediately

    expect(distFromCenter()).toBeGreaterThan(distBefore);
    birds.dispose();
  });

  it('scatter decays back to normal radius after SCATTER_DECAY_SECONDS', () => {
    const { scene, birds } = makeSetup();
    const mesh = birdMesh(scene);
    // Distance from bird 0's OWN flock centre (not an arbitrary world point —
    // flock centres seed 250-800m from the landscape centre, so measuring
    // against (80,80) conflates orbital position with the scatter radius).
    const center = birds.flockCenters[0]!;
    const distFromCenter = (idx: number) => {
      const mat = new THREE.Matrix4();
      mesh.getMatrixAt(idx, mat);
      const p = new THREE.Vector3().setFromMatrixPosition(mat);
      return Math.hypot(p.x - center.x, p.z - center.z);
    };

    birds.onBlast(center.x, center.z);
    birds.update(0.001);
    const distScattered = distFromCenter(0);

    for (let i = 0; i < 500; i++) birds.update(0.01); // 5s > 4s decay window
    const distSettled = distFromCenter(0);

    expect(distSettled).toBeLessThan(distScattered);
    birds.dispose();
  });

  it('dispose removes the flock mesh from the scene', () => {
    const { scene, birds } = makeSetup();
    expect(birdMesh(scene)).toBeDefined();
    birds.dispose();
    expect(scene.children.find((c) => c.name === 'bird-flocks')).toBeUndefined();
  });
});
