// BlastSimulator2026 — Blast step 4a: what throws a fragment, and how hard
//
// Three things decide whether rock is thrown rather than merely broken:
//
//   what is left over  — only energy that passed out of the rock can move it;
//                        what it absorbed went into breaking it
//   where it can go    — rock at a free face has somewhere to move, rock deep
//                        in the mass is held by its neighbours and can only settle
//   how well it is stemmed — stemming keeps the gases working on the rock instead
//                        of venting up the hole, so an under-stemmed hole is what
//                        turns a blast into flyrock
//
// Refactor plan: docs/plans/rock-fragmentation-refactor.md §6/A4.

import { vec3, normalize, scale, length as vecLength, type Vec3 } from '../math/Vec3.js';
import {
  SURFACE_PROXIMITY_DECAY,
  MAX_PROJECTION_VELOCITY,
  PROJECTION_ENERGY_TO_KINETIC,
  MIN_THROW_FRACTION,
  FREE_FACE_WEIGHT,
} from '../config/balance.js';
import { type EnergyField, contains, indexOf, overflowAt } from './EnergyPropagation.js';
import type { VoxelContribution } from './FragmentComposition.js';

/** Sample a field array at a world coordinate, or `fallback` outside the box. */
function sampleAt(field: EnergyField, data: Float32Array, x: number, y: number, z: number, fallback: number): number {
  return contains(field, x, y, z) ? data[indexOf(field, x, y, z)]! : fallback;
}

/**
 * Unit vector pointing at the nearest open air, from the distance-to-air field.
 *
 * Rock is thrown out of the face it can reach, not radially away from the hole
 * that broke it — a charge at the bottom of a hole would otherwise fling its
 * deepest fragments down and sideways into solid rock.
 *
 * Returns zero where the field is flat (rock equidistant from air on all sides).
 */
export function freeFaceDirection(field: EnergyField, x: number, y: number, z: number): Vec3 {
  const here = sampleAt(field, field.distAir, x, y, z, 0);
  const gradient = vec3(
    sampleAt(field, field.distAir, x + 1, y, z, here) - sampleAt(field, field.distAir, x - 1, y, z, here),
    sampleAt(field, field.distAir, x, y + 1, z, here) - sampleAt(field, field.distAir, x, y - 1, z, here),
    sampleAt(field, field.distAir, x, y, z + 1, here) - sampleAt(field, field.distAir, x, y, z - 1, here),
  );
  // Distance to air falls toward the face, so the way out is down the gradient.
  return vecLength(gradient) < 1e-6 ? vec3(0, 0, 0) : normalize(scale(gradient, -1));
}

/**
 * Unit vector pointing away from where the energy was, from the energy field.
 *
 * On its own this is a poor guide — it points away from the charge even when
 * that means driving rock deeper into the mass — but blended with the free-face
 * direction it keeps fragments beside a hole from all flying perfectly parallel.
 */
export function energyGradientDirection(field: EnergyField, x: number, y: number, z: number): Vec3 {
  const here = sampleAt(field, field.effective, x, y, z, 0);
  const gradient = vec3(
    sampleAt(field, field.effective, x + 1, y, z, here) - sampleAt(field, field.effective, x - 1, y, z, here),
    sampleAt(field, field.effective, x, y + 1, z, here) - sampleAt(field, field.effective, x, y - 1, z, here),
    sampleAt(field, field.effective, x, y, z + 1, here) - sampleAt(field, field.effective, x, y, z - 1, here),
  );
  return vecLength(gradient) < 1e-6 ? vec3(0, 0, 0) : normalize(scale(gradient, -1));
}

/**
 * The share of a fragment's leftover energy that still throws it, given how well
 * the hole that broke it was stemmed.
 *
 * Squared, so the penalty for poor stemming bites sharply and the gap between a
 * properly stemmed shot and a careless one is a real decision rather than a
 * gentle slope.
 */
export function throwFractionForBlowout(blowout: number): number {
  const b = Math.min(1, Math.max(0, blowout));
  return MIN_THROW_FRACTION + (1 - MIN_THROW_FRACTION) * b * b;
}

/**
 * Velocity for one fragment.
 *
 * Direction blends the free face with the energy gradient; magnitude comes from
 * the leftover energy the fragment inherited from the rock it was carved out of,
 * damped by how deeply that rock was buried.
 */
export function computeFragmentVelocity(
  origin: Vec3,
  sources: readonly VoxelContribution[],
  massKg: number,
  field: EnergyField,
  throwFraction: number,
): Vec3 {
  if (massKg <= 0) return vec3(0, 0, 0);

  let throwEnergy = 0;
  for (const source of sources) {
    throwEnergy += overflowAt(field, source.x, source.y, source.z) * source.weight;
  }
  throwEnergy *= throwFraction;
  if (throwEnergy <= 0) return vec3(0, 0, 0);

  const x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);

  const face = freeFaceDirection(field, x, y, z);
  const gradient = energyGradientDirection(field, x, y, z);
  const blended = vec3(
    FREE_FACE_WEIGHT * face.x + (1 - FREE_FACE_WEIGHT) * gradient.x,
    FREE_FACE_WEIGHT * face.y + (1 - FREE_FACE_WEIGHT) * gradient.y,
    FREE_FACE_WEIGHT * face.z + (1 - FREE_FACE_WEIGHT) * gradient.z,
  );
  // Rock with no direction to prefer is simply lifted.
  const direction = vecLength(blended) < 1e-6 ? vec3(0, 1, 0) : normalize(blended);

  const confinement = Math.exp(-sampleAt(field, field.distAir, x, y, z, 0) * SURFACE_PROXIMITY_DECAY);
  const speed = Math.min(
    MAX_PROJECTION_VELOCITY,
    Math.sqrt((2 * PROJECTION_ENERGY_TO_KINETIC * throwEnergy) / massKg) * confinement,
  );

  return scale(direction, speed);
}
