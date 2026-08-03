// BlastSimulator2026 — Blast step 4b: grouping thrown rock into projectiles
//
// A big blast throws thousands of fragments, and flying each one independently
// is the one part of the pipeline whose cost grows without bound. Fragments that
// are next to each other and moving the same way are indistinguishable in the
// air, so they travel as one projectile and split back into their own pieces
// when they land.
//
// This caps the cost of motion without ever touching fragment identity: sizes,
// masses and count are exactly what the blast produced. Grouping decides how
// many things fly, never how the rock broke.
//
// Refactor plan: docs/plans/rock-fragmentation-refactor.md §6/A5.

import { vec3, type Vec3 } from '../math/Vec3.js';
import {
  MAX_ACTIVE_PROJECTILES,
  PROJECTILE_GROUP_RADIUS,
  PROJECTILE_GROUP_DIR_COS,
  PROJECTILE_GROUP_SPEED_TOL,
} from '../config/balance.js';

/** The minimum a fragment must expose to be flown as part of a projectile. */
export interface ThrowableFragment {
  id: number;
  position: Vec3;
  mass: number;
  initialVelocity: Vec3;
}

export interface Projectile {
  id: number;
  /** Fragments travelling inside this projectile, in ascending id order. */
  memberIds: number[];
  massKg: number;
  origin: Vec3;
  velocity: Vec3;
}

function speedOf(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

/**
 * Group thrown fragments into at most `MAX_ACTIVE_PROJECTILES` bodies.
 *
 * Fastest fragments open groups first, so the pieces that travel furthest — the
 * ones a player actually watches — keep the truest trajectories, and slower rock
 * is what gets consolidated.
 *
 * Below the cap every fragment flies on its own. Above it, a fragment joins a
 * nearby group heading the same way at a similar speed; anything left over when
 * the cap is reached joins the nearest group regardless, because the cap is hard.
 */
export function groupProjectiles(fragments: readonly ThrowableFragment[]): Projectile[] {
  if (fragments.length === 0) return [];

  const order = [...fragments].sort((a, b) => {
    const d = speedOf(b.initialVelocity) - speedOf(a.initialVelocity);
    return d !== 0 ? d : a.id - b.id;
  });

  if (order.length <= MAX_ACTIVE_PROJECTILES) {
    return order
      .map((f, i) => makeProjectile(i, [f]))
      .sort((a, b) => a.memberIds[0]! - b.memberIds[0]!)
      .map((p, i) => ({ ...p, id: i }));
  }

  const perGroup = Math.ceil(order.length / MAX_ACTIVE_PROJECTILES);
  const taken = new Set<number>();
  const groups: ThrowableFragment[][] = [];

  for (const seed of order) {
    if (taken.has(seed.id)) continue;
    if (groups.length >= MAX_ACTIVE_PROJECTILES) break;

    taken.add(seed.id);
    const group = [seed];
    const seedSpeed = speedOf(seed.initialVelocity);

    for (const candidate of order) {
      if (group.length >= perGroup) break;
      if (taken.has(candidate.id)) continue;
      if (!isNear(seed, candidate)) continue;
      if (!isSimilarMotion(seed.initialVelocity, seedSpeed, candidate.initialVelocity)) continue;
      taken.add(candidate.id);
      group.push(candidate);
    }

    groups.push(group);
  }

  // The cap is hard: whatever is still loose joins the group it is nearest to,
  // similar heading or not.
  for (const leftover of order) {
    if (taken.has(leftover.id)) continue;
    let best = 0;
    let bestDist = Infinity;
    for (let g = 0; g < groups.length; g++) {
      const head = groups[g]![0]!;
      const d = distanceSq(head.position, leftover.position);
      if (d < bestDist) { bestDist = d; best = g; }
    }
    groups[best]!.push(leftover);
    taken.add(leftover.id);
  }

  return groups
    .map((members, i) => makeProjectile(i, members))
    .sort((a, b) => a.memberIds[0]! - b.memberIds[0]!)
    .map((p, i) => ({ ...p, id: i }));
}

/** Mass-weighted aggregate of a group. */
function makeProjectile(id: number, members: readonly ThrowableFragment[]): Projectile {
  let mass = 0;
  let ox = 0, oy = 0, oz = 0;
  let vx = 0, vy = 0, vz = 0;

  for (const f of members) {
    // A zero-mass fragment must not vanish from the group, so weight by at
    // least a token amount.
    const w = f.mass > 0 ? f.mass : 1e-6;
    mass += w;
    ox += f.position.x * w; oy += f.position.y * w; oz += f.position.z * w;
    vx += f.initialVelocity.x * w; vy += f.initialVelocity.y * w; vz += f.initialVelocity.z * w;
  }

  return {
    id,
    memberIds: members.map(f => f.id).sort((a, b) => a - b),
    massKg: members.reduce((s, f) => s + f.mass, 0),
    origin: vec3(ox / mass, oy / mass, oz / mass),
    velocity: vec3(vx / mass, vy / mass, vz / mass),
  };
}

function distanceSq(a: Vec3, b: Vec3): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
}

function isNear(a: ThrowableFragment, b: ThrowableFragment): boolean {
  return distanceSq(a.position, b.position) <= PROJECTILE_GROUP_RADIUS ** 2;
}

function isSimilarMotion(seedVelocity: Vec3, seedSpeed: number, other: Vec3): boolean {
  const otherSpeed = speedOf(other);
  const faster = Math.max(seedSpeed, otherSpeed);
  if (faster <= 0) return true; // both at rest: indistinguishable
  if (Math.abs(seedSpeed - otherSpeed) / faster > PROJECTILE_GROUP_SPEED_TOL) return false;
  if (seedSpeed <= 0 || otherSpeed <= 0) return false;

  const dot = (seedVelocity.x * other.x + seedVelocity.y * other.y + seedVelocity.z * other.z)
    / (seedSpeed * otherSpeed);
  return dot >= PROJECTILE_GROUP_DIR_COS;
}
