// BlastSimulator2026 — Blast step 4c: where the rock actually ends up
//
// Every fragment's landing place is worked out here, in closed form, at the
// moment of the blast. Thrown rock follows its arc until it meets the ground;
// everything else drops where it stands. Rock lands on rock, so the pile grows
// as it fills.
//
// Resolving this up front rather than watching a physics simulation is what lets
// the same blast play out identically with or without a renderer: the console
// and the scenario runner get the final state directly, and the renderer's job
// is only to show the journey to a destination already decided.
//
// Refactor plan: docs/plans/rock-fragmentation-refactor.md §6/A6.

import { vec3, type Vec3 } from '../math/Vec3.js';
import { computeVoxelColumnSurfaceY, type VoxelGrid } from '../world/VoxelGrid.js';
import {
  GRAVITY,
  BALLISTIC_SAMPLE_DT,
  BALLISTIC_MAX_T,
  SPLIT_SCATTER_RADIUS,
  COLLAPSE_STAGGER_PER_METRE,
  PROJECTION_SPEED_THRESHOLD,
} from '../config/balance.js';
import type { Projectile } from './ProjectileGrouping.js';

/** What resolution needs from a fragment, and writes back to it. */
export interface LandableFragment {
  id: number;
  position: Vec3;
  volume: number;
  mass: number;
  initialVelocity: Vec3;
  isProjection: boolean;
}

/** One fragment's journey, for the renderer to play back. */
export interface FragmentFlight {
  fragmentId: number;
  /** Where it started, before anything moved. */
  from: Vec3;
  /** Where it came to rest. */
  to: Vec3;
  /** Seconds after detonation before it starts moving. */
  delayS: number;
  /** Seconds it spends in the air. */
  durationS: number;
  /** Speed at impact, for dust and damage. */
  impactSpeed: number;
  /** True when it flew an arc rather than dropping in place. */
  thrown: boolean;
}

export interface ResolveResult {
  flights: FragmentFlight[];
  /** Greatest horizontal distance any fragment travelled, in metres. */
  maxThrowDistance: number;
}

/**
 * Where a fragment is, `t` seconds after the blast.
 *
 * The horizontal path runs straight from where the rock broke to where it
 * settled, and the vertical one is the parabola that connects the same two
 * points in the same time under gravity. Solving for the launch speed rather
 * than replaying the original one guarantees the animation ends exactly on the
 * resting place already decided for it — the picture can never drift from the
 * game state, however the arc was worked out.
 *
 * Before the fragment's delay it sits still; after it lands it stays put.
 */
export function flightPositionAt(flight: FragmentFlight, t: number): Vec3 {
  const local = t - flight.delayS;
  if (local <= 0) return flight.from;
  if (local >= flight.durationS || flight.durationS <= 0) return flight.to;

  const T = flight.durationS;
  const progress = local / T;
  // Vertical launch speed that lands on `to.y` at exactly t = T.
  const vy = (flight.to.y - flight.from.y - 0.5 * GRAVITY * T * T) / T;

  return vec3(
    flight.from.x + (flight.to.x - flight.from.x) * progress,
    flight.from.y + vy * local + 0.5 * GRAVITY * local * local,
    flight.from.z + (flight.to.z - flight.from.z) * progress,
  );
}

/** How long a blast takes to finish settling, in seconds. */
export function totalFlightDuration(flights: readonly FragmentFlight[]): number {
  let end = 0;
  for (const f of flights) end = Math.max(end, f.delayS + f.durationS);
  return end;
}

/**
 * A pile of rock, tracked per ground column while a blast settles.
 *
 * Fragments land on whatever is already in their column, so the order they are
 * resolved in decides how the muck stacks. Heights are kept here rather than in
 * game state because the fragments' own positions are the durable record — the
 * pile is just how they got there.
 */
class PileHeights {
  private readonly heights = new Map<number, number>();

  constructor(private readonly grid: VoxelGrid) {}

  /** Ground height in a column, including anything already piled on it. */
  surfaceAt(x: number, z: number): number {
    const key = this.key(x, z);
    const piled = this.heights.get(key);
    if (piled !== undefined) return piled;
    // computeVoxelColumnSurfaceY returns the topmost solid voxel; rock rests on
    // top of it.
    return computeVoxelColumnSurfaceY(this.grid, x, z) + 1;
  }

  /** Place a fragment of this size on the column and return the height it rests at. */
  place(x: number, z: number, volume: number): number {
    const base = this.surfaceAt(x, z);
    // Rubble does not stack as a solid block — a cubic metre of rock spread over
    // a square metre of ground settles to roughly its own height, and loosely.
    const rise = Math.max(0.1, Math.cbrt(Math.max(volume, 1e-6)));
    this.heights.set(this.key(x, z), base + rise);
    return base + rise / 2;
  }

  private key(x: number, z: number): number {
    return (Math.floor(x) + 4096) * 16384 + (Math.floor(z) + 4096);
  }
}

/**
 * Follow a projectile's arc until it meets the ground.
 *
 * Marching in fixed steps and refining the crossing once is accurate to a few
 * centimetres at these speeds, and unlike solving the quadratic it copes with
 * ground that rises and falls under the arc.
 */
function traceArc(
  origin: Vec3,
  velocity: Vec3,
  piles: PileHeights,
  grid: VoxelGrid,
): { landing: Vec3; timeS: number; impactSpeed: number } {
  const clampX = (v: number): number => Math.min(grid.maxX - 1, Math.max(grid.minX, v));
  const clampZ = (v: number): number => Math.min(grid.maxZ - 1, Math.max(grid.minZ, v));

  const at = (t: number): Vec3 => vec3(
    clampX(origin.x + velocity.x * t),
    origin.y + velocity.y * t + 0.5 * GRAVITY * t * t,
    clampZ(origin.z + velocity.z * t),
  );

  let previous = origin;
  let previousT = 0;

  for (let t = BALLISTIC_SAMPLE_DT; t <= BALLISTIC_MAX_T; t += BALLISTIC_SAMPLE_DT) {
    const point = at(t);
    const ground = piles.surfaceAt(point.x, point.z);
    if (point.y <= ground) {
      // One bisection pass to place the impact between the last two samples.
      const mid = (previousT + t) / 2;
      const midPoint = at(mid);
      const hit = midPoint.y <= piles.surfaceAt(midPoint.x, midPoint.z) ? midPoint : point;
      const hitT = midPoint.y <= piles.surfaceAt(midPoint.x, midPoint.z) ? mid : t;
      return {
        landing: hit,
        timeS: hitT,
        impactSpeed: Math.hypot(velocity.x, velocity.y + GRAVITY * hitT, velocity.z),
      };
    }
    previous = point;
    previousT = t;
  }

  // Still airborne at the time limit — set it down where it got to.
  return {
    landing: previous,
    timeS: previousT,
    impactSpeed: Math.hypot(velocity.x, velocity.y + GRAVITY * previousT, velocity.z),
  };
}

/**
 * Deterministic ring of offsets around a landing point, so a projectile's
 * members scatter instead of stacking on one spot.
 *
 * A sunflower spiral spreads them evenly without needing randomness, which keeps
 * the whole resolution reproducible from the blast alone.
 */
function scatterOffset(index: number, count: number, radius: number): { dx: number; dz: number } {
  if (count <= 1) return { dx: 0, dz: 0 };
  const golden = Math.PI * (3 - Math.sqrt(5));
  const r = radius * Math.sqrt((index + 0.5) / count);
  return { dx: r * Math.cos(index * golden), dz: r * Math.sin(index * golden) };
}

/**
 * Work out where every fragment ends up, and write it into their positions.
 *
 * Thrown rock is resolved first, in order of how long it is airborne, so rock
 * still in flight lands on the pile that earlier rock has already built.
 */
export function resolveFragmentLanding(
  fragments: readonly LandableFragment[],
  projectiles: readonly Projectile[],
  grid: VoxelGrid,
): ResolveResult {
  const byId = new Map<number, LandableFragment>();
  for (const f of fragments) byId.set(f.id, f);

  const piles = new PileHeights(grid);
  const flights: FragmentFlight[] = [];
  let maxThrowDistance = 0;

  // Captured before anything moves: positions are rewritten as rock lands, so
  // the stagger has to be measured against where the blast started.
  let floorY = Infinity;
  for (const f of fragments) if (f.position.y < floorY) floorY = f.position.y;
  if (!Number.isFinite(floorY)) floorY = 0;

  // ── Thrown rock: follow the arc, then scatter the members where it lands ──
  const thrown = projectiles
    .map(p => ({ projectile: p, arc: traceArc(p.origin, p.velocity, piles, grid) }))
    .sort((a, b) => a.arc.timeS - b.arc.timeS || a.projectile.id - b.projectile.id);

  const inFlight = new Set<number>();

  for (const { projectile, arc } of thrown) {
    const members = projectile.memberIds
      .map(id => byId.get(id))
      .filter((f): f is LandableFragment => f !== undefined);

    for (let i = 0; i < members.length; i++) {
      const fragment = members[i]!;
      inFlight.add(fragment.id);

      const spread = SPLIT_SCATTER_RADIUS * Math.cbrt(Math.max(projectile.massKg, 1) / 1000 + 1);
      const { dx, dz } = scatterOffset(i, members.length, spread);
      const x = Math.min(grid.maxX - 1, Math.max(grid.minX, arc.landing.x + dx));
      const z = Math.min(grid.maxZ - 1, Math.max(grid.minZ, arc.landing.z + dz));

      const from = fragment.position;
      const restY = piles.place(x, z, fragment.volume);
      const to = vec3(x, restY, z);

      fragment.position = to;
      fragment.isProjection = arc.impactSpeed > PROJECTION_SPEED_THRESHOLD;

      maxThrowDistance = Math.max(maxThrowDistance, Math.hypot(to.x - from.x, to.z - from.z));

      flights.push({
        fragmentId: fragment.id,
        from,
        to,
        delayS: 0,
        durationS: arc.timeS,
        impactSpeed: arc.impactSpeed,
        thrown: true,
      });
    }
  }

  // ── Everything else simply drops, lowest rock first so the pile builds up ──
  const collapsing = fragments
    .filter(f => !inFlight.has(f.id))
    .sort((a, b) => a.position.y - b.position.y || a.id - b.id);

  for (const fragment of collapsing) {
    const from = fragment.position;
    const restY = piles.place(from.x, from.z, fragment.volume);
    const to = vec3(from.x, restY, from.z);
    const drop = Math.max(0, from.y - to.y);

    fragment.position = to;
    fragment.isProjection = false;

    flights.push({
      fragmentId: fragment.id,
      from,
      to,
      // Rock low in the face gives way first and the burden follows it down,
      // so the collapse ripples upward instead of every piece moving at once.
      delayS: Math.max(0, from.y - floorY) * COLLAPSE_STAGGER_PER_METRE,
      durationS: Math.sqrt((2 * drop) / Math.abs(GRAVITY)),
      impactSpeed: Math.sqrt(2 * Math.abs(GRAVITY) * drop),
      thrown: false,
    });
  }

  flights.sort((a, b) => a.fragmentId - b.fragmentId);
  return { flights, maxThrowDistance };
}
