// BlastSimulator2026 — the camera's right-hand direction on the ground (the audio listener's pan axis)
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { cameraGroundRight } from '../../../src/renderer/cameraGroundRight.js';

/** A camera at `position` looking at `target`, with its world matrix up to date. */
function cameraLooking(position: THREE.Vector3, target: THREE.Vector3): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 500);
  camera.position.copy(position);
  camera.lookAt(target);
  camera.updateMatrixWorld(true);
  return camera;
}

describe('cameraGroundRight', () => {
  it('points along +x when the camera looks down -z (the three.js default)', () => {
    const right = cameraGroundRight(cameraLooking(new THREE.Vector3(0, 20, 30), new THREE.Vector3(0, 0, 0)).matrixWorld.elements);
    expect(right.x).toBeCloseTo(1, 6);
    expect(right.z).toBeCloseTo(0, 6);
  });

  it('turns with the camera: looking along +x puts right at +z', () => {
    const right = cameraGroundRight(cameraLooking(new THREE.Vector3(-30, 20, 0), new THREE.Vector3(0, 0, 0)).matrixWorld.elements);
    expect(right.x).toBeCloseTo(0, 6);
    expect(right.z).toBeCloseTo(1, 6);
  });

  it('is a unit vector at any pitch and yaw', () => {
    for (const [px, py, pz] of [[10, 40, 25], [-20, 5, -7], [3, 80, 1]] as const) {
      const right = cameraGroundRight(cameraLooking(new THREE.Vector3(px, py, pz), new THREE.Vector3(0, 0, 0)).matrixWorld.elements);
      expect(Math.hypot(right.x, right.z)).toBeCloseTo(1, 9);
    }
  });

  it('ignores the camera position, so a blast shake cannot move it', () => {
    const camera = cameraLooking(new THREE.Vector3(0, 20, 30), new THREE.Vector3(0, 0, 0));
    const still = cameraGroundRight(camera.matrixWorld.elements);
    camera.position.add(new THREE.Vector3(1.5, -0.8, 2));
    camera.updateMatrixWorld(true);
    expect(cameraGroundRight(camera.matrixWorld.elements)).toEqual(still);
  });

  it('falls back to +x for a degenerate matrix (nothing to flatten) or non-finite entries', () => {
    expect(cameraGroundRight(new Array<number>(16).fill(0))).toEqual({ x: 1, z: 0 });
    expect(cameraGroundRight([0, 1, 0, 0])).toEqual({ x: 1, z: 0 }); // right axis straight up
    expect(cameraGroundRight([Number.NaN, 0, 1])).toEqual({ x: 1, z: 0 });
    expect(cameraGroundRight([])).toEqual({ x: 1, z: 0 });
  });
});
