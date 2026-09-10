// Billboard — unit tests (#1013)
// faceCamera() fixes a real bug: the naive `target.quaternion.copy(camera.quaternion)`
// billboard technique is only correct when target.parent has identity world
// rotation. CharacterMesh.animateGait() rotates the anchor group to face an
// employee's walk direction, so any billboard parented under a
// non-identity-rotated anchor needs the composed WORLD quaternion — not the
// LOCAL one — to equal the camera's. This test fails against the naive
// implementation (verified by hand: swapping faceCamera's body for
// `target.quaternion.copy(camera.quaternion)` makes the assertion below
// fail, since the composed world orientation then includes the parent's
// extra rotation) and passes against the real fix.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { faceCamera } from '../../../src/renderer/Billboard.js';

describe('faceCamera', () => {
  it('billboards a child under a NON-identity-rotated parent to match the camera\'s WORLD orientation', () => {
    const scene = new THREE.Scene();

    const parent = new THREE.Group();
    parent.rotation.y = Math.PI / 2; // mirrors CharacterMesh.animateGait() turning the anchor
    scene.add(parent);

    const child = new THREE.Object3D();
    parent.add(child);

    const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.5, 4000);
    camera.quaternion.setFromEuler(new THREE.Euler(0.3, 0.9, 0.1));
    scene.add(camera);

    // Sanity: parent's own rotation is non-identity, so a naive local-copy
    // billboard (`child.quaternion.copy(camera.quaternion)`) would NOT match
    // the camera's world orientation once composed with the parent's turn —
    // otherwise this test would pass even against the old, buggy code.
    scene.updateMatrixWorld(true);
    const naiveWorldQuat = new THREE.Quaternion();
    child.quaternion.copy(camera.quaternion);
    scene.updateMatrixWorld(true);
    child.getWorldQuaternion(naiveWorldQuat);
    expect(naiveWorldQuat.equals(camera.quaternion)).toBe(false);

    faceCamera(child, camera);
    scene.updateMatrixWorld(true);

    const childWorldQuat = new THREE.Quaternion();
    child.getWorldQuaternion(childWorldQuat);

    expect(childWorldQuat.x).toBeCloseTo(camera.quaternion.x, 5);
    expect(childWorldQuat.y).toBeCloseTo(camera.quaternion.y, 5);
    expect(childWorldQuat.z).toBeCloseTo(camera.quaternion.z, 5);
    expect(childWorldQuat.w).toBeCloseTo(camera.quaternion.w, 5);
  });

  it('falls back to a direct quaternion copy when target has no parent', () => {
    const target = new THREE.Object3D();
    const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.5, 4000);
    camera.quaternion.setFromEuler(new THREE.Euler(0.2, 0.5, 0.0));

    faceCamera(target, camera);

    expect(target.quaternion.equals(camera.quaternion)).toBe(true);
  });
});
