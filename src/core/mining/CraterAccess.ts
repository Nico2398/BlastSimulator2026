// BlastSimulator2026 — Crater access planning (#2082)
// Pure planner: finds floors stranded below the existing ramp network and proposes a ramp down to them.
// Reads terrain only through the narrow AccessSurface seam; no GameState.

import {
  CRATER_ACCESS_MAX_GRADE_MARGIN, CRATER_ACCESS_SPIRAL_START_ATTEMPTS, MAX_RAMP_LENGTH, RAMP_CRATER_MIN_DROP_M,
  RAMP_FLOOR_SNAP_REACH_M, RAMP_SPIRAL_MAX_PIT_SPAN_M, type RampWidth,
} from '../config/balance.js';
import { slopeDegreesForRatio } from '../nav/ClimbLimit.js';
import { computeRampCost, rampDefFromLegs, rampFootOffset, validateRampOrder, type RampDef } from './Ramp.js';
import { RAMP_DIR_OFFSETS, findRampPathFault, rampPathOf, type RampDirection } from './RampPath.js';
import { isPitRim, proposeRampSpiral, type SpiralSurface } from './RampSpiral.js';

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

export type CraterAccessPlan =
  | { ok: true; def: RampDef; cost: number; gradeDegrees: number }
  | { ok: false; reasonKey: string };

const KEY = 'mining.crater_access.';
const DIRECTIONS: readonly RampDirection[] = ['south', 'north', 'east', 'west'];
const RAD_TO_DEG = 180 / Math.PI;

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

/**
 * Straight ramp ending on the floor tile, starting on the nearest reachable cell along one of four axes
 * whose grade stays within `limitRatio`. Shorter first, so a built ramp's foot beats the rim.
 */
function planStraight(
  floor: StrandedFloor, surface: AccessSurface, limitRatio: number, width: RampWidth,
): { plan: CraterAccessPlan | null; sawShallow: boolean } {
  const fx = Math.round(floor.x);
  const fz = Math.round(floor.z);
  let sawShallow = false;
  for (let length = Math.max(1, width); length <= MAX_RAMP_LENGTH; length++) {
    for (const direction of DIRECTIONS) {
      const o = RAMP_DIR_OFFSETS[direction];
      const sx = fx - o.dx * length;
      const sz = fz - o.dz * length;
      if (!surface.contains(sx, sz) || !surface.reachableFrom(sx, sz)) continue;
      const startGround = surface.heightAt(sx, sz);
      const drop = startGround - floor.floorY;
      if (!Number.isFinite(drop)) continue;
      if (drop < RAMP_CRATER_MIN_DROP_M) { sawShallow = true; continue; }
      if (drop / length > limitRatio) continue;
      if (Math.abs(rampFootOffset(startGround, floor.floorY, drop, length)) > RAMP_FLOOR_SNAP_REACH_M) continue;
      const def: RampDef = { originX: sx, originZ: sz, direction, length, targetDepth: drop, width };
      if (findRampPathFault(rampPathOf(def), width) !== null) continue;
      const check = validateRampOrder(def, Infinity);
      if (!check.success) continue;
      return {
        plan: { ok: true, def, cost: check.cost, gradeDegrees: Math.atan(drop / length) * RAD_TO_DEG },
        sawShallow,
      };
    }
  }
  return { plan: null, sawShallow };
}

/** Reachable cells in rings round the floor, nearest first, that sit on a pit rim. */
function* reachableRimStarts(floor: StrandedFloor, surface: AccessSurface): Generator<{ x: number; z: number }> {
  const fx = Math.round(floor.x);
  const fz = Math.round(floor.z);
  const reach = Math.floor(RAMP_SPIRAL_MAX_PIT_SPAN_M / 2) + 1;
  for (let r = 1; r <= reach; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = fx + dx;
        const z = fz + dz;
        if (!surface.contains(x, z) || !surface.reachableFrom(x, z)) continue;
        if (isPitRim(surface, { x, z })) yield { x, z };
      }
    }
  }
}

/** Spiral road down a pit wall from the nearest reachable rim tile, when no straight start exists. */
function planSpiral(floor: StrandedFloor, surface: AccessSurface, limitRatio: number, width: RampWidth): CraterAccessPlan | null {
  const gradeDegrees = Math.max(0.1, Math.floor(slopeDegreesForRatio(limitRatio) * 10) / 10);
  let attempts = 0;
  for (const start of reachableRimStarts(floor, surface)) {
    if (attempts++ >= CRATER_ACCESS_SPIRAL_START_ATTEMPTS) break;
    const depth = surface.heightAt(start.x, start.z) - floor.floorY;
    if (depth < RAMP_CRATER_MIN_DROP_M) continue;
    const result = proposeRampSpiral(
      { fromX: start.x, fromZ: start.z, depth, gradeDegrees, width, dir: 'cw' }, surface,
    );
    if (!result.success) continue;
    const p = result.proposal;
    const def = rampDefFromLegs({ x: p.originX, z: p.originZ }, p.legs, p.depth, width);
    def.gradeDegrees = p.gradeDegrees;
    const check = validateRampOrder(def, Infinity);
    if (!check.success) continue;
    return { ok: true, def, cost: computeRampCost(p.totalLength, width), gradeDegrees: p.gradeDegrees };
  }
  return null;
}

/** Plans a ramp from the reachable network down to `floor`, within `maxClimbRatio`. Never throws. */
export function planCraterAccess(
  floor: StrandedFloor,
  surface: AccessSurface,
  maxClimbRatio: number,
  width: RampWidth,
): CraterAccessPlan {
  const limitRatio = maxClimbRatio * CRATER_ACCESS_MAX_GRADE_MARGIN;
  if (!(limitRatio > 0) || !Number.isFinite(floor.floorY)) return { ok: false, reasonKey: `${KEY}no_start` };
  try {
    const straight = planStraight(floor, surface, limitRatio, width);
    if (straight.plan !== null) return straight.plan;
    const spiral = planSpiral(floor, surface, limitRatio, width);
    if (spiral !== null) return spiral;
    return { ok: false, reasonKey: `${KEY}${straight.sawShallow ? 'too_shallow' : 'no_start'}` };
  } catch {
    return { ok: false, reasonKey: `${KEY}no_start` };
  }
}
