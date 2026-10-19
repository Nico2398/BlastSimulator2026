// BlastSimulator2026 — Ramp path geometry (#1939)
// Pure geometry leaf for multi-leg ramps: a path of straight legs from an origin.
// Imports types only; no state, no voxel access.

import type { RampWidth } from '../config/balance.js';

export type RampDirection = 'north' | 'south' | 'east' | 'west';

/** Unit tile step of each direction. */
export const RAMP_DIR_OFFSETS: Record<RampDirection, { dx: number; dz: number }> = {
  north: { dx: 0, dz: -1 },
  south: { dx: 0, dz: 1 },
  east: { dx: 1, dz: 0 },
  west: { dx: -1, dz: 0 },
};

/** Inclusive tile rectangle a ramp's corridor covers. */
export interface RampFootprint {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** One straight run of a ramp path. */
export interface RampLeg {
  direction: RampDirection;
  length: number;
}

/** Where a ramp path starts and the legs it follows. */
export interface RampPathSpec {
  originX: number;
  originZ: number;
  legs: readonly RampLeg[];
}

/** One tile of a ramp corridor. */
export interface RampPathCell {
  x: number;
  z: number;
  /** Index along the centreline this cell belongs to. */
  step: number;
  /** Signed offset from the centreline across the corridor width. */
  lateral: number;
  legIndex: number;
}

export type LegsFromWaypointsResult =
  | { success: true; originX: number; originZ: number; legs: RampLeg[] }
  | { success: false; reasonKey: string; params?: Record<string, string | number> };

export interface RampPathFault {
  key: 'mining.build_ramp.leg_too_short' | 'mining.build_ramp.legs_cross';
  params: Record<string, string | number>;
}

const NOT_CARDINAL = 'mining.build_ramp.leg_not_cardinal';

/** Convert clicked waypoints into an origin and axis-aligned legs. */
export function legsFromWaypoints(
  waypoints: readonly { x: number; z: number }[],
): LegsFromWaypointsResult {
  if (waypoints.length < 2) return { success: false, reasonKey: 'mining.build_ramp.path_too_few' };
  if (waypoints.some(w => !Number.isFinite(w.x) || !Number.isFinite(w.z))) {
    return { success: false, reasonKey: 'mining.build_ramp.path_usage' };
  }
  const pts = waypoints.map(w => ({ x: Math.floor(w.x), z: Math.floor(w.z) }));
  const legs: RampLeg[] = [];
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i]!.x - pts[i - 1]!.x;
    const dz = pts[i]!.z - pts[i - 1]!.z;
    if ((dx === 0) === (dz === 0)) {
      return { success: false, reasonKey: NOT_CARDINAL, params: { n: i } };
    }
    const direction: RampDirection = dx === 0 ? (dz > 0 ? 'south' : 'north') : (dx > 0 ? 'east' : 'west');
    const length = Math.abs(dx + dz);
    const last = legs[legs.length - 1];
    if (last && last.direction === direction) last.length += length;
    else legs.push({ direction, length });
  }
  return { success: true, originX: pts[0]!.x, originZ: pts[0]!.z, legs };
}

/** Legs of `def`: its own `legs`, else one leg from direction/length. */
export function rampLegsOf(
  def: { direction: RampDirection; length: number; legs?: readonly RampLeg[] },
): RampLeg[] {
  return def.legs ? def.legs.map(l => ({ ...l })) : [{ direction: def.direction, length: def.length }];
}

export function rampTotalLength(legs: readonly RampLeg[]): number {
  return legs.reduce((sum, l) => sum + l.length, 0);
}

/** Origin plus one waypoint per leg end. */
export function rampWaypoints(path: RampPathSpec): { x: number; z: number }[] {
  let x = Math.floor(path.originX);
  let z = Math.floor(path.originZ);
  const out = [{ x, z }];
  for (const leg of path.legs) {
    const o = RAMP_DIR_OFFSETS[leg.direction];
    x += o.dx * leg.length;
    z += o.dz * leg.length;
    out.push({ x, z });
  }
  return out;
}

/** Centreline tiles of the path, in order. */
export function rampCenterline(path: RampPathSpec): { x: number; z: number; legIndex: number }[] {
  const wps = rampWaypoints(path);
  const out: { x: number; z: number; legIndex: number }[] = [];
  path.legs.forEach((leg, legIndex) => {
    const o = RAMP_DIR_OFFSETS[leg.direction];
    const start = wps[legIndex]!;
    for (let s = 0; s < leg.length; s++) out.push({ x: start.x + o.dx * s, z: start.z + o.dz * s, legIndex });
  });
  return out;
}

/** Unit step across a leg's width. */
function perpOf(direction: RampDirection): { px: number; pz: number } {
  return direction === 'north' || direction === 'south' ? { px: 1, pz: 0 } : { px: 0, pz: 1 };
}

/** The width x width corner landing centred on the waypoint where leg `k` starts, as cells of leg `k`. */
function landingCells(path: RampPathSpec, wp: { x: number; z: number }, k: number, step: number, half: number): RampPathCell[] {
  const { px } = perpOf(path.legs[k]!.direction);
  const cells: RampPathCell[] = [];
  for (let dz = -half; dz <= half; dz++) {
    for (let dx = -half; dx <= half; dx++) {
      cells.push({ x: wp.x + dx, z: wp.z + dz, step, lateral: px === 1 ? dx : dz, legIndex: k });
    }
  }
  return cells;
}

/** Strip tiles of every leg with no landing substitution, step by step then across the width. */
function stripCells(path: RampPathSpec, half: number, wps: readonly { x: number; z: number }[]): RampPathCell[] {
  const out: RampPathCell[] = [];
  let stepBase = 0;
  path.legs.forEach((leg, k) => {
    const o = RAMP_DIR_OFFSETS[leg.direction];
    const { px, pz } = perpOf(leg.direction);
    for (let s = 0; s < leg.length; s++) {
      for (let w = -half; w <= half; w++) {
        out.push({ x: wps[k]!.x + o.dx * s + px * w, z: wps[k]!.z + o.dz * s + pz * w, step: stepBase + s, lateral: w, legIndex: k });
      }
    }
    stepBase += leg.length;
  });
  return out;
}

/** Landing squares of every interior corner, each as cells of the leg leaving it. */
function allLandings(path: RampPathSpec, half: number, wps: readonly { x: number; z: number }[]): RampPathCell[][] {
  let step = 0;
  return path.legs.map((leg, k) => {
    const cells = k === 0 ? [] : landingCells(path, wps[k]!, k, step, half);
    step += leg.length;
    return cells;
  });
}

/**
 * Every distinct corridor tile at `width`, step by step then across the width. A corner's
 * landing square belongs to the leg leaving the corner and replaces the strip tiles it covers.
 */
export function rampPathCells(path: RampPathSpec, width: RampWidth): RampPathCell[] {
  const half = Math.floor(width / 2);
  const wps = rampWaypoints(path);
  const landings = allLandings(path, half, wps);
  const landed = new Set(landings.flat().map(c => `${c.x},${c.z}`));
  const strips = stripCells(path, half, wps);
  const out: RampPathCell[] = [];
  const seen = new Set<string>();
  const emit = (c: RampPathCell): void => {
    const key = `${c.x},${c.z}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(c);
  };
  path.legs.forEach((_, k) => {
    landings[k]!.forEach(emit);
    for (const c of strips) if (c.legIndex === k && !landed.has(`${c.x},${c.z}`)) emit(c);
  });
  return out;
}

/** Per-leg inclusive rectangles covering the corridor. */
export function rampFootprintRects(path: RampPathSpec, width: RampWidth): RampFootprint[] {
  const half = Math.floor(width / 2);
  const wps = rampWaypoints(path);
  return path.legs.map((leg, k) => {
    const o = RAMP_DIR_OFFSETS[leg.direction];
    const { px, pz } = perpOf(leg.direction);
    const a = wps[k]!;
    const run = leg.length - 1;
    const ex = a.x + o.dx * run;
    const ez = a.z + o.dz * run;
    let minX = Math.min(a.x, ex) - px * half;
    let maxX = Math.max(a.x, ex) + px * half;
    let minZ = Math.min(a.z, ez) - pz * half;
    let maxZ = Math.max(a.z, ez) + pz * half;
    if (k > 0) {
      minX = Math.min(minX, a.x - half); maxX = Math.max(maxX, a.x + half);
      minZ = Math.min(minZ, a.z - half); maxZ = Math.max(maxZ, a.z + half);
    }
    return { minX, maxX, minZ, maxZ };
  });
}

/** Single rectangle bounding the whole corridor. */
export function rampBoundingFootprint(path: RampPathSpec, width: RampWidth): RampFootprint {
  const rects = rampFootprintRects(path, width);
  return {
    minX: Math.min(...rects.map(r => r.minX)), maxX: Math.max(...rects.map(r => r.maxX)),
    minZ: Math.min(...rects.map(r => r.minZ)), maxZ: Math.max(...rects.map(r => r.maxZ)),
  };
}

/** First reason the path is invalid (short leg, self-crossing), or null. */
export function findRampPathFault(path: RampPathSpec, width: RampWidth): RampPathFault | null {
  if (path.legs.length < 2) return null;
  const short = path.legs.findIndex(l => l.length < width);
  if (short !== -1) {
    return {
      key: 'mining.build_ramp.leg_too_short',
      params: { leg: short + 1, length: path.legs[short]!.length, width },
    };
  }
  const half = Math.floor(width / 2);
  const wps = rampWaypoints(path);
  const claims = new Map<string, number[]>();
  const squareOwner = new Map<string, number>();
  const claim = (key: string, leg: number): void => {
    const list = claims.get(key);
    if (!list) claims.set(key, [leg]);
    else if (!list.includes(leg)) list.push(leg);
  };
  for (const c of stripCells(path, half, wps)) claim(`${c.x},${c.z}`, c.legIndex);
  allLandings(path, half, wps).forEach((cells, k) => {
    for (const c of cells) {
      const key = `${c.x},${c.z}`;
      claim(key, k);
      if (!squareOwner.has(key)) squareOwner.set(key, k);
    }
  });
  for (const [key, legs] of claims) {
    if (legs.length < 2) continue;
    const corner = squareOwner.get(key);
    if (corner !== undefined && legs.every(l => l === corner || l === corner - 1)) continue;
    return { key: 'mining.build_ramp.legs_cross', params: { a: legs[0]! + 1, b: legs[1]! + 1 } };
  }
  return null;
}

/** First cell for which `isOccupied(x, z)` holds, or null. */
export function firstOccupiedPathTile(
  cells: readonly RampPathCell[],
  isOccupied: (x: number, z: number) => boolean,
): RampPathCell | null {
  return cells.find(c => isOccupied(c.x, c.z)) ?? null;
}
