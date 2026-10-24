// BlastSimulator2026 — Crater access planning (#2082, #2095)
// Pure planner: finds floors stranded below the existing ramp network and proposes a ramp down to them.
// Reads terrain only through the narrow AccessSurface seam; no GameState. Nothing in the tick calls it:
// opening a crater is the player's job, and the progression probe plays that player with it.

import {
  CRATER_ACCESS_CLUSTER_GAP_CELLS, CRATER_ACCESS_FLOOR_LEVEL_M, CRATER_ACCESS_MAX_GRADE_MARGIN, CRATER_ACCESS_SPIRAL_START_ATTEMPTS, MAX_RAMP_LENGTH,
  RAMP_CRATER_MIN_DROP_M, RAMP_SPIRAL_MAX_PIT_SPAN_M, RAMP_SPIRAL_RIM_GAP_WIDTHS, type RampWidth,
} from '../config/balance.js';
import { slopeDegreesForRatio } from '../nav/ClimbLimit.js';
import {
  computeRampCost, landRampOnEndFloor, rampDefFromLegs, rampEndRowGround, rampLengthForGrade, validateRampOrder, type RampDef,
} from './Ramp.js';
import {
  RAMP_DIR_OFFSETS, findRampPathFault, rampPathOf, rampTotalLength, rampWaypoints, type RampDirection, type RampFootprint, type RampLeg,
} from './RampPath.js';
import { rampFootprint } from './RampWidening.js';
import { isPitRim, proposeRampSpiral, type SpiralDir, type SpiralSurface } from './RampSpiral.js';

/** A cluster of unreachable order targets sharing one deepened floor. */
export interface StrandedFloor {
  x: number;
  z: number;
  floorY: number;
  orderCount: number;
}

/** Terrain seam: spiral surface plus a reachability query against the current vehicle network. */
export interface AccessSurface extends SpiralSurface {
  reachableFrom(x: number, z: number): boolean;
}

type CraterAccessPlan =
  | { ok: true; def: RampDef; cost: number; gradeDegrees: number }
  | { ok: false; reasonKey: string };

const KEY = 'mining.crater_access.';
const DIRECTIONS: readonly RampDirection[] = ['south', 'north', 'east', 'west'];

/** Groups stranded cells whose spacing is within `gapCells` (Chebyshev) into floors. */
export function clusterStrandedFloors(
  cells: ReadonlyArray<{ x: number; z: number; y: number }>,
  gapCells: number,
): StrandedFloor[] {
  const gap = Math.max(0, Math.floor(gapCells));
  const byColumn = new Map<string, number[]>();
  cells.forEach((c, i) => {
    const key = `${Math.round(c.x)},${Math.round(c.z)}`;
    const list = byColumn.get(key);
    if (list === undefined) byColumn.set(key, [i]);
    else list.push(i);
  });
  const seen = new Set<number>();
  const floors: StrandedFloor[] = [];
  for (let start = 0; start < cells.length; start++) {
    if (seen.has(start)) continue;
    seen.add(start);
    const members: number[] = [];
    const stack = [start];
    while (stack.length > 0) {
      const i = stack.pop()!;
      members.push(i);
      const cx = Math.round(cells[i]!.x);
      const cz = Math.round(cells[i]!.z);
      for (let dx = -gap; dx <= gap; dx++) {
        for (let dz = -gap; dz <= gap; dz++) {
          for (const j of byColumn.get(`${cx + dx},${cz + dz}`) ?? []) {
            if (seen.has(j)) continue;
            seen.add(j);
            stack.push(j);
          }
        }
      }
    }
    floors.push(floorOf(cells, members));
  }
  return floors;
}

/** One floor: the member nearest the centroid stands for its x,z; the deepest member sets floorY. */
function floorOf(cells: ReadonlyArray<{ x: number; z: number; y: number }>, members: readonly number[]): StrandedFloor {
  let sx = 0;
  let sz = 0;
  let floorY = Infinity;
  for (const i of members) {
    sx += cells[i]!.x;
    sz += cells[i]!.z;
    floorY = Math.min(floorY, cells[i]!.y);
  }
  const mx = sx / members.length;
  const mz = sz / members.length;
  let best = cells[members[0]!]!;
  for (const i of members) {
    const c = cells[i]!;
    if (Math.hypot(c.x - mx, c.z - mz) < Math.hypot(best.x - mx, best.z - mz)) best = c;
  }
  return { x: best.x, z: best.z, floorY, orderCount: members.length };
}

/** A ramp already dug, as the planner compares it. */
type DugRamp = { def: RampDef; width: RampWidth };

const rampKey = (def: RampDef, width: RampWidth): string =>
  `${JSON.stringify(rampPathOf(def))}|${def.targetDepth}|${width}`;

/** True when the ramp's footprint shares a tile with any stuck ramp's footprint (inclusive rectangles). */
function overlapsAny(def: RampDef, width: RampWidth, avoid: readonly RampFootprint[]): boolean {
  if (avoid.length === 0) return false;
  const f = rampFootprint(def, width);
  return avoid.some(a => f.minX <= a.maxX && f.maxX >= a.minX && f.minZ <= a.maxZ && f.maxZ >= a.minZ);
}

type Excluded = (def: RampDef) => boolean;

/**
 * Straight ramp ending on the floor tile, starting on the nearest reachable cell along one of four axes
 * whose grade stays within `limitRatio`. Shorter first, so a built ramp's foot beats the rim.
 */
function planStraight(
  floor: StrandedFloor, surface: AccessSurface, limitRatio: number, width: RampWidth, excluded: Excluded,
  foot: { x: number; z: number } = { x: Math.round(floor.x), z: Math.round(floor.z) },
): { plan: CraterAccessPlan | null; sawShallow: boolean } {
  const fx = foot.x;
  const fz = foot.z;
  let sawShallow = false;
  for (let length = Math.max(1, width); length <= MAX_RAMP_LENGTH; length++) {
    for (const direction of DIRECTIONS) {
      const o = RAMP_DIR_OFFSETS[direction];
      const sx = fx - o.dx * length;
      const sz = fz - o.dz * length;
      if (!surface.contains(sx, sz) || !surface.reachableFrom(sx, sz)) continue;
      const startGround = surface.heightAt(sx, sz);
      const drop = startGround - landingGround(surface, { originX: sx, originZ: sz, direction, length, width });
      if (!Number.isFinite(drop)) continue;
      if (drop < RAMP_CRATER_MIN_DROP_M) { sawShallow = true; continue; }
      if (drop / length > limitRatio) continue;
      const def: RampDef = { originX: sx, originZ: sz, direction, length, targetDepth: drop, width };
      if (findRampPathFault(rampPathOf(def), width) !== null) continue;
      if (excluded(def)) continue;
      const check = validateRampOrder(def, Infinity);
      if (!check.success) continue;
      return {
        plan: { ok: true, def, cost: check.cost, gradeDegrees: slopeDegreesForRatio(drop / length) },
        sawShallow,
      };
    }
  }
  return { plan: null, sawShallow };
}

/** Cells on the Chebyshev ring perimeters round the floor's rounded cell, ring 1 to `maxRing`, nearest ring first. */
function* chebyshevRings(floor: StrandedFloor, maxRing: number): Generator<{ x: number; z: number }> {
  const fx = Math.round(floor.x);
  const fz = Math.round(floor.z);
  for (let r = 1; r <= maxRing; r++) {
    for (let dx = -r; dx <= r; dx++) {
      // Edge columns hold the whole side; inner columns only their two ring cells.
      const edge = Math.abs(dx) === r;
      for (let dz = -r; dz <= r; dz += edge ? 1 : 2 * r) yield { x: fx + dx, z: fz + dz };
    }
  }
}

/** Reachable cells in rings round the floor, nearest first, that sit on a pit rim. */
function* reachableRimStarts(floor: StrandedFloor, surface: AccessSurface): Generator<{ x: number; z: number }> {
  const reach = Math.floor(RAMP_SPIRAL_MAX_PIT_SPAN_M / 2) + 1;
  for (const { x, z } of chebyshevRings(floor, reach)) {
    if (!surface.contains(x, z) || !surface.reachableFrom(x, z)) continue;
    if (isPitRim(surface, { x, z }, true)) yield { x, z };
  }
}

/**
 * True when floor-level ground lies within the ramp corridor's half-width plus one tile of its last tile (#2085). A spiral rings the
 * whole void its start sees; round a pit nested in a wider one that ring hugs the outer pit, and its foot ends at the
 * right depth beside nothing, so digging it never frees the floor and the same floor is re-planned forever.
 * A foot that misses is extended to the floor by `spiralToFloor`.
 */
function footMeetsFloor(def: RampDef, floor: StrandedFloor, surface: AccessSurface, width: RampWidth): boolean {
  const foot = rampWaypoints(rampPathOf(def)).at(-1)!;
  const reach = Math.floor(width / 2) + 1;
  for (let dz = -reach; dz <= reach; dz++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const x = foot.x + dx;
      const z = foot.z + dz;
      if (atFloorLevel(surface, floor, x, z)) return true;
    }
  }
  return false;
}

/** Floor-level ground: within one voxel layer of the floor's depth (#2045). */
const atFloorLevel = (surface: AccessSurface, floor: StrandedFloor, x: number, z: number): boolean =>
  surface.contains(x, z) && Math.abs(surface.heightAt(x, z) - floor.floorY) <= CRATER_ACCESS_FLOOR_LEVEL_M;

/** The ground a ramp lands on, as the order will land it: the lowest of its end row (`rampEndRowGround`). */
const landingGround = (surface: AccessSurface, def: Parameters<typeof rampEndRowGround>[0]): number =>
  rampEndRowGround(def, (x, z) => (surface.contains(x, z) ? surface.heightAt(x, z) : NaN));

/** True when `def` lands on `floor`: its end row's lowest ground is floor-level, so the landed foot is flush with it. */
const landsOnFloor = (surface: AccessSurface, floor: StrandedFloor, def: RampDef): boolean =>
  Math.abs(landingGround(surface, def) - floor.floorY) <= CRATER_ACCESS_FLOOR_LEVEL_M;

/** True when the corridor of a leg of `length` tiles from `from` along `direction` lies wholly inside the claimed area. */
function legContained(surface: AccessSurface, from: { x: number; z: number }, direction: RampDirection, length: number, width: number): boolean {
  const o = RAMP_DIR_OFFSETS[direction];
  const half = Math.floor(width / 2);
  for (let s = 0; s <= length; s++) {
    for (let k = -half; k <= half; k++) {
      if (!surface.contains(from.x + o.dx * s + Math.abs(o.dz) * k, from.z + o.dz * s + Math.abs(o.dx) * k)) return false;
    }
  }
  return true;
}

/**
 * A spiral rings the rim, so its foot stands a rim gap and the pit wall away from the floor and frees nothing (#2086).
 * Ends the ring at some tile within `reach` of its end and cuts a straight leg from there across the wall to the first
 * floor-level ground, long enough that the road still reaches the full depth (a grade-set ramp runs level past it).
 */
function spiralToFloor(
  legs: readonly RampLeg[], origin: { x: number; z: number }, needed: number,
  floor: StrandedFloor, surface: AccessSurface, width: RampWidth,
): RampLeg[] | null {
  const total = rampTotalLength(legs);
  const reach = (RAMP_SPIRAL_RIM_GAP_WIDTHS + 1) * width + CRATER_ACCESS_CLUSTER_GAP_CELLS;
  const starts: { x: number; z: number }[] = [origin];
  for (const leg of legs) {
    const o = RAMP_DIR_OFFSETS[leg.direction];
    const last = starts.at(-1)!;
    starts.push({ x: last.x + o.dx * leg.length, z: last.z + o.dz * leg.length });
  }
  // Try the longest ring prefix first (t descends) so the cut leg stays as short as possible. A leg that leaves the
  // claimed area ends that direction's search (`break`): a longer leg the same way would leave it too.
  for (let t = total; t >= Math.max(width, needed - reach); t--) {
    const kept: RampLeg[] = [];
    let used = 0;
    for (const leg of legs) {
      if (used >= t) break;
      kept.push({ direction: leg.direction, length: Math.min(leg.length, t - used) });
      used += kept.at(-1)!.length;
    }
    const last = kept.at(-1)!;
    if (kept.length > 1 && last.length < width) continue;
    const o = RAMP_DIR_OFFSETS[last.direction];
    const base = starts[kept.length - 1]!;
    const end = { x: base.x + o.dx * last.length, z: base.z + o.dz * last.length };
    for (const direction of DIRECTIONS) {
      const d = RAMP_DIR_OFFSETS[direction];
      if (d.dx === -o.dx && d.dz === -o.dz) continue;
      for (let k = Math.max(width, needed - t); k <= reach; k++) {
        if (!atFloorLevel(surface, floor, end.x + d.dx * k, end.z + d.dz * k)) continue;
        if (!legContained(surface, end, direction, k, width)) break;
        return direction === last.direction
          ? [...kept.slice(0, -1), { direction, length: last.length + k }]
          : [...kept, { direction, length: k }];
      }
    }
  }
  return null;
}

/** Spiral road down a pit wall from a reachable rim tile, when no straight start exists. */
function planSpiral(
  floor: StrandedFloor, surface: AccessSurface, limitRatio: number, width: RampWidth, excluded: Excluded,
): CraterAccessPlan | null {
  const gradeDegrees = Math.max(0.1, Math.floor(slopeDegreesForRatio(limitRatio) * 10) / 10);
  // Attempts are budgeted per start height: a wall of same-height rim cells must not use up the tries before a lower
  // start (a ledge, a built ramp's foot), which leaves a shorter drop, is reached (#2086).
  const attempts = new Map<number, number>();
  for (const start of reachableRimStarts(floor, surface)) {
    const level = Math.round(surface.heightAt(start.x, start.z));
    const tried = attempts.get(level) ?? 0;
    if (tried >= CRATER_ACCESS_SPIRAL_START_ATTEMPTS) continue;
    attempts.set(level, tried + 1);
    const depth = surface.heightAt(start.x, start.z) - floor.floorY;
    if (depth < RAMP_CRATER_MIN_DROP_M) continue;
    for (const dir of ['cw', 'ccw'] as const) {
      const plan = spiralPlanFrom(start, depth, gradeDegrees, dir, floor, surface, width, excluded);
      if (plan !== null) return plan;
    }
  }
  return null;
}

/** One spiral attempt from `start`: as proposed when its foot meets the floor, else with a leg across the wall to it. */
function spiralPlanFrom(
  start: { x: number; z: number }, depth: number, gradeDegrees: number, dir: SpiralDir,
  floor: StrandedFloor, surface: AccessSurface, width: RampWidth, excluded: Excluded,
): CraterAccessPlan | null {
  const propose = (d: number) =>
    proposeRampSpiral({ fromX: start.x, fromZ: start.z, depth: d, gradeDegrees, width, dir, fromReachable: true }, surface);
  let result = propose(depth);
  if (!result.success) return null;
  // The ring begins on the nearest ring tile, not on `start`; the drop it must cut is measured from that tile's ground.
  const origin = { x: result.proposal.originX, z: result.proposal.originZ };
  const originDepth = surface.heightAt(origin.x, origin.z) - floor.floorY;
  if (originDepth < RAMP_CRATER_MIN_DROP_M) return null;
  if (originDepth !== depth) {
    result = propose(originDepth);
    if (!result.success) return null;
  }
  const p = result.proposal;
  let legs: readonly RampLeg[] | null = p.legs;
  const defOf = (ramp: readonly RampLeg[]): RampDef => {
    const d = rampDefFromLegs({ x: p.originX, z: p.originZ }, ramp, p.depth, width);
    d.gradeDegrees = p.gradeDegrees;
    return d;
  };
  let def = defOf(p.legs);
  if (!footMeetsFloor(def, floor, surface, width)) {
    legs = spiralToFloor(p.legs, { x: p.originX, z: p.originZ }, rampLengthForGrade(p.depth, p.gradeDegrees), floor, surface, width);
    if (legs === null) return null;
    def = defOf(legs);
    if (findRampPathFault(rampPathOf(def), width) !== null) return null;
  }
  if (excluded(def)) return null;
  const check = validateRampOrder(def, Infinity);
  if (!check.success) return null;
  return { ok: true, def, cost: computeRampCost(rampTotalLength(legs), width), gradeDegrees: p.gradeDegrees };
}

/**
 * Straight ramp ending on floor-level ground beside the representative cell (#2086). A start on a ledge or at the foot
 * of a built ramp rarely lies on an axis through that one cell; any cell within the cluster gap whose ground matches
 * the floor serves as the foot instead. Nearest foot first; cost walks the window, not the map.
 */
function planOffsetStraight(
  floor: StrandedFloor, surface: AccessSurface, limitRatio: number, width: RampWidth, excluded: Excluded,
): CraterAccessPlan | null {
  for (const foot of chebyshevRings(floor, CRATER_ACCESS_CLUSTER_GAP_CELLS)) {
    if (!atFloorLevel(surface, floor, foot.x, foot.z)) continue;
    const { plan } = planStraight(floor, surface, limitRatio, width, excluded, foot);
    if (plan !== null) return plan;
  }
  return null;
}

/** Plans a ramp from the reachable network down to `floor`, within `maxClimbRatio`. Failure is a result, not an exception. */
export function planCraterAccess(
  floor: StrandedFloor,
  surface: AccessSurface,
  maxClimbRatio: number,
  width: RampWidth,
  avoid: readonly RampFootprint[] = [],
  built: readonly DugRamp[] = [],
): CraterAccessPlan {
  const limitRatio = maxClimbRatio * CRATER_ACCESS_MAX_GRADE_MARGIN;
  if (!(limitRatio > 0) || !Number.isFinite(floor.floorY)) return { ok: false, reasonKey: `${KEY}no_start` };
  // A plan identical to a dug ramp carves nothing new: re-ordering it would loop forever on a floor it never reached (#2085).
  const builtKeys = new Set(built.map(b => rampKey(b.def, b.width)));
  // A plan counts only when the ramp lands on this floor, flush (#2045), and still validates once landed.
  const landed = (def: RampDef): RampDef => landRampOnEndFloor(def, surface.heightAt(def.originX, def.originZ), landingGround(surface, def));
  const excluded: Excluded = def => builtKeys.has(rampKey(def, width)) || overlapsAny(def, width, avoid)
    || !landsOnFloor(surface, floor, def) || !validateRampOrder(landed(def), Infinity).success;
  const finish = (plan: CraterAccessPlan): CraterAccessPlan => (plan.ok ? { ...plan, def: landed(plan.def) } : plan);
  const straight = planStraight(floor, surface, limitRatio, width, excluded);
  if (straight.plan !== null) return finish(straight.plan);
  const spiral = planSpiral(floor, surface, limitRatio, width, excluded);
  if (spiral !== null) return finish(spiral);
  const offset = planOffsetStraight(floor, surface, limitRatio, width, excluded);
  if (offset !== null) return finish(offset);
  return { ok: false, reasonKey: `${KEY}${straight.sawShallow ? 'too_shallow' : 'no_start'}` };
}
