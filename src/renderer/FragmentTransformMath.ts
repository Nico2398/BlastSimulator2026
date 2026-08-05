// BlastSimulator2026 — Fragment instance-transform math
//
// Pure Three.js matrix/quaternion helpers shared by FragmentMesh's spawn path
// and FragmentAnimator's per-frame update path. No THREE.Scene or
// InstancedMesh state lives here — everything is a function of a fragment's
// own seeded shape and the transform the caller supplies for this frame.
//
// TODO: implement — extraction of existing spawnFragments math
// (src/renderer/FragmentMesh.ts) plus new tumble/compose pieces (#485).

import * as THREE from 'three';

/** Deterministic pseudo-random in [0, 1) from a fragment's shape seed. */
export function seedUnit(_seed: number, _salt: number): number {
  return undefined as unknown as number;
}

/** Seeded spawn-orientation quaternion for a fragment's shape seed. */
export function spawnOrientation(_shapeSeed: number): THREE.Quaternion {
  return undefined as unknown as THREE.Quaternion;
}

/** Seeded slight shear matrix, so two instances of one shape variant never read as identical. */
export function spawnShear(_shapeSeed: number): THREE.Matrix4 {
  return undefined as unknown as THREE.Matrix4;
}

/** Seeded axis a fragment tumbles about while it falls. */
export function tumbleAxis(_shapeSeed: number): THREE.Vector3 {
  return undefined as unknown as THREE.Vector3;
}

/** The rotation+shear part of a fragment's spawn transform, and the axis it tumbles about, fixed for the fragment's lifetime. */
export interface FragmentBaseTransform {
  rs: THREE.Matrix4;
  axis: THREE.Vector3;
}

/** Build a fragment's base (rotation, shear, tumble axis) transform from its shape seed and spawn scale. */
export function buildBaseTransform(_shapeSeed: number, _scale: THREE.Vector3): FragmentBaseTransform {
  return undefined as unknown as FragmentBaseTransform;
}

/**
 * Compose a fragment's full per-frame instance matrix from its fixed base
 * transform, current position, extra tumble rotation, and settle scale.
 * Writes into `out` rather than allocating, so a per-frame update over many
 * fragments costs no garbage.
 */
export function composeInstanceMatrix(
  _base: FragmentBaseTransform,
  _position: { x: number; y: number; z: number },
  _tumbleAngle: number,
  _settleScale: { x: number; y: number; z: number },
  _out: THREE.Matrix4,
): void {
  // TODO: implement
}
