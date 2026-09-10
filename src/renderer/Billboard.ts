// BlastSimulator2026 — Billboard orientation helper
//
// Both TaskProgressBar and EmployeePictograms parent a camera-facing plane
// under an employee's CharacterMesh anchor group and, every frame, need that
// plane's WORLD orientation to equal the camera's. Naively copying the
// camera's quaternion straight onto the child's LOCAL quaternion
// (`mesh.quaternion.copy(camera.quaternion)`) is only correct when the
// anchor itself has identity rotation. CharacterMesh's animateGait() turns
// the whole anchor group to face an employee's walk direction
// (`entry.group.rotation.y = ...`), so for any employee not coincidentally
// facing the default heading, that shortcut composes the anchor's own
// rotation on top of the camera's, silently misorienting the plane —
// severely enough, at some headings, to point its front face away from the
// camera and disappear entirely under MeshBasicMaterial's default
// front-face-only culling (#1013).
//
// The fix: solve for the LOCAL quaternion that makes the composed WORLD
// quaternion equal the camera's, given the anchor's actual (possibly
// rotated) world orientation.

import * as THREE from 'three';

const scratchQuat = new THREE.Quaternion();

/**
 * Set `target`'s local quaternion so its WORLD orientation matches
 * `camera`'s, regardless of `target.parent`'s own rotation. `target` must
 * already be parented (billboarded meshes/groups always are, under a
 * CharacterMesh anchor) — falls back to a direct copy if it somehow isn't.
 */
export function faceCamera(target: THREE.Object3D, camera: THREE.Camera): void {
  const parent = target.parent;
  if (!parent) {
    target.quaternion.copy(camera.quaternion);
    return;
  }
  parent.getWorldQuaternion(scratchQuat);
  target.quaternion.copy(scratchQuat).invert().multiply(camera.quaternion);
}
