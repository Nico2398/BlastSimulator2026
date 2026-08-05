// BlastSimulator2026 — Fragment instance-transform math
//
// Pure Three.js matrix/quaternion helpers shared by FragmentMesh's spawn path
// and FragmentAnimator's per-frame update path. No THREE.Scene or
// InstancedMesh state lives here — everything is a function of a fragment's
// own seeded shape and the transform the caller supplies for this frame.
//
// A fragment's spawn transform is T(position) · R(shapeSeed) · Shear(shapeSeed)
// · Scale(size). The rotation/shear/size part never changes over a fragment's
// life, so it is built once (buildBaseTransform) and folded into `rs`; each
// frame only recomposes the cheap part — an extra tumble rotation and a
// settle-scale multiplier on top of `rs` (composeInstanceMatrix). With
// tumbleAngle 0 and settleScale (1,1,1) this reduces to exactly the spawn
// matrix, which is what keeps a settled fragment bit-identical to where the
// blast put it (#485).

import * as THREE from 'three';

// How far a fragment's unit shape is skewed by its per-instance shear. Small on
// purpose: at 0.18 the silhouette changes, the volume barely does.
const SHEAR_MAX = 0.18;

/** Deterministic pseudo-random in [0, 1) from a fragment's shape seed. */
export function seedUnit(seed: number, salt: number): number {
  const x = Math.sin(seed * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Seeded spawn-orientation quaternion for a fragment's shape seed. */
export function spawnOrientation(shapeSeed: number): THREE.Quaternion {
  const euler = new THREE.Euler(
    seedUnit(shapeSeed, 1) * Math.PI * 2,
    seedUnit(shapeSeed, 2) * Math.PI * 2,
    seedUnit(shapeSeed, 3) * Math.PI * 2,
  );
  return new THREE.Quaternion().setFromEuler(euler);
}

/**
 * Seeded slight shear matrix, so two instances of one shape variant never
 * read as identical. Sits *between* rotation and scale (R·Shear·S): applied
 * outside the scale, a slab's long axis would bleed into its thin one and a
 * flat fragment stopped rendering flat.
 */
export function spawnShear(shapeSeed: number): THREE.Matrix4 {
  const shear = new THREE.Matrix4();
  const e = shear.elements;
  e[4] = (seedUnit(shapeSeed, 4) * 2 - 1) * SHEAR_MAX;  // x from y
  e[8] = (seedUnit(shapeSeed, 5) * 2 - 1) * SHEAR_MAX;  // x from z
  e[9] = (seedUnit(shapeSeed, 6) * 2 - 1) * SHEAR_MAX;  // y from z
  return shear;
}

/**
 * Seeded axis a fragment tumbles about while it falls. Distinct salts from
 * orientation (1-3) and shear (4-6) so the tumble axis is independent of the
 * fragment's spawn look.
 */
export function tumbleAxis(shapeSeed: number): THREE.Vector3 {
  const v = new THREE.Vector3(
    seedUnit(shapeSeed, 7) * 2 - 1,
    seedUnit(shapeSeed, 8) * 2 - 1,
    seedUnit(shapeSeed, 9) * 2 - 1,
  );
  if (v.lengthSq() < 1e-8) return new THREE.Vector3(0, 1, 0);
  return v.normalize();
}

/** The rotation+shear part of a fragment's spawn transform, and the axis it tumbles about, fixed for the fragment's lifetime. */
export interface FragmentBaseTransform {
  /** R(shapeSeed) · Shear(shapeSeed) · Scale(size) — everything about a fragment's look that never changes after spawn. */
  rs: THREE.Matrix4;
  axis: THREE.Vector3;
}

/** Build a fragment's base (rotation, shear, tumble axis) transform from its shape seed and spawn scale. */
export function buildBaseTransform(shapeSeed: number, scale: THREE.Vector3): FragmentBaseTransform {
  const rs = new THREE.Matrix4().makeRotationFromQuaternion(spawnOrientation(shapeSeed));
  rs.multiply(spawnShear(shapeSeed));
  rs.scale(scale);
  return { rs, axis: tumbleAxis(shapeSeed) };
}

/**
 * Compose a fragment's full per-frame instance matrix from its fixed base
 * transform, current position, extra tumble rotation, and settle scale.
 * Writes into `out` rather than allocating, so a per-frame update over many
 * fragments costs no garbage.
 *
 * out = T(position) · Rotation(base.axis, tumbleAngle) · base.rs · Scale(settleScale)
 *
 * With tumbleAngle 0 (Rotation = identity) and settleScale (1,1,1) (Scale =
 * identity) this is exactly T(position) · base.rs — the same matrix
 * `spawnFragments` composes at spawn time, bit-for-bit.
 */
export function composeInstanceMatrix(
  base: FragmentBaseTransform,
  position: { x: number; y: number; z: number },
  tumbleAngle: number,
  settleScale: { x: number; y: number; z: number },
  out: THREE.Matrix4,
): void {
  out.makeRotationAxis(base.axis, tumbleAngle);
  out.multiply(base.rs);
  out.scale(settleScale as THREE.Vector3);
  out.setPosition(position.x, position.y, position.z);
}
