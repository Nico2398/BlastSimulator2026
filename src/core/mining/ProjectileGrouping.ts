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
// Runs inside the one synchronous frame the whole blast resolves in, over
// thousands of fragments — so neighbours come from a spatial hash rather than
// scans, and speeds are computed once per fragment rather than per comparison.
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

/** A fragment with its speed computed once, so comparisons never recompute it. */
interface Mover {
  fragment: ThrowableFragment;
  speed: number;
}

export interface Projectile {
  id: number;
  /** Fragments travelling inside this projectile, in ascending id order. */
  memberIds: number[];
  massKg: number;
  origin: Vec3;
  velocity: Vec3;
}

/**
 * Cells of `PROJECTILE_GROUP_RADIUS` metres, so any fragment within grouping
 * range of a point is in that point's cell or one of its 26 neighbours.
 */
function cellKeyOf(x: number, y: number, z: number): number {
  const r = PROJECTILE_GROUP_RADIUS;
  // 12 bits per axis, offset positive — collision-free for any world position.
  return ((Math.floor(x / r) + 2048) * 4096 + (Math.floor(y / r) + 2048)) * 4096
    + (Math.floor(z / r) + 2048);
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

  const order: Mover[] = fragments.map(fragment => {
    const v = fragment.initialVelocity;
    return { fragment, speed: Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) };
  });
  order.sort((a, b) => (b.speed - a.speed) || (a.fragment.id - b.fragment.id));

  if (order.length <= MAX_ACTIVE_PROJECTILES) {
    return order
      .map((m, i) => makeProjectile(i, [m.fragment]))
      .sort((a, b) => a.memberIds[0]! - b.memberIds[0]!)
      .map((p, i) => ({ ...p, id: i }));
  }

  // Spatial hash over the *unclaimed* fragments: a seed pulls candidates from
  // its own cell and the 26 around it instead of rescanning the whole blast.
  const byCell = new Map<number, Mover[]>();
  for (const m of order) {
    const key = cellKeyOf(m.fragment.position.x, m.fragment.position.y, m.fragment.position.z);
    const cell = byCell.get(key);
    if (cell) cell.push(m);
    else byCell.set(key, [m]);
  }

  const perGroup = Math.ceil(order.length / MAX_ACTIVE_PROJECTILES);
  const taken = new Set<number>();
  const groups: ThrowableFragment[][] = [];
  const r = PROJECTILE_GROUP_RADIUS;

  for (const seed of order) {
    if (taken.has(seed.fragment.id)) continue;
    if (groups.length >= MAX_ACTIVE_PROJECTILES) break;

    taken.add(seed.fragment.id);
    const group = [seed.fragment];
    const p = seed.fragment.position;

    // Candidates in deterministic cell order; within a cell they keep the
    // fastest-first order they were inserted in.
    outer:
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const cell = byCell.get(cellKeyOf(p.x + dx * r, p.y + dy * r, p.z + dz * r));
          if (!cell) continue;
          for (const candidate of cell) {
            if (group.length >= perGroup) break outer;
            if (taken.has(candidate.fragment.id)) continue;
            if (!isNear(seed.fragment, candidate.fragment)) continue;
            if (!isSimilarMotion(seed.fragment.initialVelocity, seed.speed, candidate.fragment.initialVelocity, candidate.speed)) continue;
            taken.add(candidate.fragment.id);
            group.push(candidate.fragment);
          }
        }
      }
    }

    groups.push(group);
  }

  // The cap is hard: whatever is still loose joins the group it is nearest to,
  // similar heading or not. Group heads are few (≤ the cap), so scanning them
  // directly is already cheap.
  for (const leftover of order) {
    if (taken.has(leftover.fragment.id)) continue;
    let best = 0;
    let bestDist = Infinity;
    for (let g = 0; g < groups.length; g++) {
      const head = groups[g]![0]!;
      const d = distanceSq(head.position, leftover.fragment.position);
      if (d < bestDist) { bestDist = d; best = g; }
    }
    groups[best]!.push(leftover.fragment);
    taken.add(leftover.fragment.id);
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

function isSimilarMotion(seedVelocity: Vec3, seedSpeed: number, other: Vec3, otherSpeed: number): boolean {
  const faster = Math.max(seedSpeed, otherSpeed);
  if (faster <= 0) return true; // both at rest: indistinguishable
  if (Math.abs(seedSpeed - otherSpeed) / faster > PROJECTILE_GROUP_SPEED_TOL) return false;
  if (seedSpeed <= 0 || otherSpeed <= 0) return false;

  const dot = (seedVelocity.x * other.x + seedVelocity.y * other.y + seedVelocity.z * other.z)
    / (seedSpeed * otherSpeed);
  return dot >= PROJECTILE_GROUP_DIR_COS;
}
