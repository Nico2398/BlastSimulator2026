// BlastSimulator2026 — Spiral ramp proposal (#1940)
// Pure planner: proposes a ring of straight legs that winds once down a pit wall.
// Reads terrain only through the narrow SpiralSurface seam; no GameState.

import {
  MAX_RAMP_LENGTH, RAMP_CRATER_MIN_DROP_M, RAMP_SPIRAL_CLOSING_RUN_WIDTHS, RAMP_SPIRAL_MAX_PIT_SPAN_M, RAMP_SPIRAL_RIM_GAP_WIDTHS, type RampWidth,
} from '../config/balance.js';
import { NEIGHBOUR_OFFSETS_4, NEIGHBOUR_OFFSETS_8 } from '../nav/NeighbourOffsets.js';
import { computeRampCost, rampGradeBoundsDegrees, rampLengthForGrade } from './Ramp.js';
import { computeVoxelColumnSurfaceHeight, type VoxelGrid } from '../world/VoxelGrid.js';
import { RAMP_DIR_OFFSETS, findRampPathFault, type RampDirection, type RampLeg } from './RampPath.js';

export type SpiralDir = 'cw' | 'ccw';

export interface SpiralRequest {
  fromX: number;
  fromZ: number;
  /** Total vertical drop to reach, in meters. */
  depth: number;
  gradeDegrees: number;
  width: RampWidth;
  dir: SpiralDir;
  /**
   * The start is ground the vehicle network already reaches (a ledge, a built ramp's foot). Standing in a wider hollow
   * is then no bar: a start with a deeper void beside it is the rim of that void (#2086).
   */
  fromReachable?: boolean;
}

/** Terrain seam: surface height and pit-membership queries. */
export interface SpiralSurface {
  heightAt(x: number, z: number): number;
  contains(x: number, z: number): boolean;
}

export interface RampSpiralProposal {
  originX: number;
  originZ: number;
  legs: RampLeg[];
  totalLength: number;
  cost: number;
  /** Always 1: the road is a single ring round the pit. */
  laps: number;
  gradeDegrees: number;
  depth: number;
}

export type RampSpiralResult =
  | { success: true; proposal: RampSpiralProposal }
  | { success: false; reasonKey: string; params?: Record<string, string | number> };

const KEY = 'mining.ramp_spiral.';

type Fail = Extract<RampSpiralResult, { success: false }>;
const fail = (reasonKey: string, params?: Record<string, string | number>): Fail =>
  params ? { success: false, reasonKey, params } : { success: false, reasonKey };

interface Tile { x: number; z: number }
interface PitBounds { minX: number; maxX: number; minZ: number; maxZ: number }

/**
 * `tile` sits in a closed depression: every cardinal ray meets ground a crater drop above `height`
 * within the pit span, before leaving the claimed area.
 */
function enclosedByHigherGround(surface: SpiralSurface, tile: Tile, height: number): boolean {
  return NEIGHBOUR_OFFSETS_4.every(([dx, dz]) => {
    for (let k = 1; k <= RAMP_SPIRAL_MAX_PIT_SPAN_M; k++) {
      const x = tile.x + dx * k;
      const z = tile.z + dz * k;
      if (!surface.contains(x, z)) return false;
      if (surface.heightAt(x, z) >= height + RAMP_CRATER_MIN_DROP_M) return true;
    }
    return false;
  });
}

/**
 * True when `(x, z)` is claimed, at least the crater drop below `ground`, and in a closed
 * depression. The enclosure test keeps downhill ground on a slope from reading as pit.
 */
function isVoid(surface: SpiralSurface, x: number, z: number, ground: number): boolean {
  if (!surface.contains(x, z)) return false;
  const height = surface.heightAt(x, z);
  return height <= ground - RAMP_CRATER_MIN_DROP_M && enclosedByHigherGround(surface, { x, z }, height);
}

/** The start sits at the bottom of a hollow: every cardinal ray meets ground a crater drop higher. */
function startInHollow(surface: SpiralSurface, start: Tile, ground: number): boolean {
  return enclosedByHigherGround(surface, start, ground);
}

/** Any void tile within the pit span of `start`. */
function voidNearby(surface: SpiralSurface, start: Tile, ground: number): boolean {
  const r = Math.floor(RAMP_SPIRAL_MAX_PIT_SPAN_M / 2);
  for (let dz = -r; dz <= r; dz++) {
    for (let dx = -r; dx <= r; dx++) if (isVoid(surface, start.x + dx, start.z + dz, ground)) return true;
  }
  return false;
}

/** Bounded flood fill of the void from the start's neighbours; null when it outgrows the pit span. */
function floodPit(surface: SpiralSurface, seeds: Tile[], ground: number): PitBounds | null {
  const seen = new Set(seeds.map(t => `${t.x},${t.z}`));
  const queue = [...seeds];
  const b: PitBounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (let head = 0; head < queue.length; head++) {
    const { x, z } = queue[head]!;
    b.minX = Math.min(b.minX, x); b.maxX = Math.max(b.maxX, x);
    b.minZ = Math.min(b.minZ, z); b.maxZ = Math.max(b.maxZ, z);
    if (b.maxX - b.minX + 1 > RAMP_SPIRAL_MAX_PIT_SPAN_M || b.maxZ - b.minZ + 1 > RAMP_SPIRAL_MAX_PIT_SPAN_M) return null;
    for (const [dx, dz] of NEIGHBOUR_OFFSETS_4) {
      const n = { x: x + dx, z: z + dz };
      const key = `${n.x},${n.z}`;
      if (seen.has(key) || !isVoid(surface, n.x, n.z, ground)) continue;
      seen.add(key);
      queue.push(n);
    }
  }
  return b;
}

/** One side of the rectangular ring, in travel order: its two corners and the way it runs. */
interface RingEdge {
  from: Tile;
  to: Tile;
  direction: RampDirection;
}

/** The four sides of the centreline rectangle in the travel order of `dir`. */
function ringEdges(L: number, R: number, T: number, B: number, dir: SpiralDir): RingEdge[] {
  const nw = { x: L, z: T }; const ne = { x: R, z: T };
  const se = { x: R, z: B }; const sw = { x: L, z: B };
  return dir === 'cw'
    ? [{ from: nw, to: ne, direction: 'east' }, { from: ne, to: se, direction: 'south' },
       { from: se, to: sw, direction: 'west' }, { from: sw, to: nw, direction: 'north' }]
    : [{ from: ne, to: nw, direction: 'west' }, { from: nw, to: sw, direction: 'south' },
       { from: sw, to: se, direction: 'east' }, { from: se, to: ne, direction: 'north' }];
}

/** Index of the side of the ring nearest `start`, and the point on it to begin from (clear of the previous side and of the next corner). */
function startOnRing(edges: RingEdge[], start: Tile, width: number): { index: number; point: Tile } {
  let best = { index: 0, point: edges[0]!.from, dist: Infinity };
  edges.forEach((e, index) => {
    const lenX = Math.abs(e.to.x - e.from.x);
    const lenZ = Math.abs(e.to.z - e.from.z);
    const len = lenX + lenZ;
    const sx = Math.sign(e.to.x - e.from.x);
    const sz = Math.sign(e.to.z - e.from.z);
    const along = (start.x - e.from.x) * sx + (start.z - e.from.z) * sz;
    const t = Math.min(len - width, Math.max(width, along));
    const point = { x: e.from.x + sx * t, z: e.from.z + sz * t };
    const dist = Math.hypot(point.x - start.x, point.z - start.z);
    if (dist < best.dist) best = { index, point, dist };
  });
  return { index: best.index, point: best.point };
}

/** Leading steps of a leg whose full corridor lies in the claimed area (landing at a corner included). */
function containedSteps(surface: SpiralSurface, at: Tile, direction: RampDirection, length: number, width: number, corner: boolean): number {
  const half = Math.floor(width / 2);
  if (corner) {
    for (let dz = -half; dz <= half; dz++) {
      for (let dx = -half; dx <= half; dx++) if (!surface.contains(at.x + dx, at.z + dz)) return 0;
    }
  }
  const o = RAMP_DIR_OFFSETS[direction];
  const acrossX = o.dx === 0 ? 1 : 0;
  const acrossZ = 1 - acrossX;
  for (let s = 0; s < length; s++) {
    for (let k = -half; k <= half; k++) {
      if (!surface.contains(at.x + o.dx * s + acrossX * k, at.z + o.dz * s + acrossZ * k)) return s;
    }
  }
  return length;
}

/**
 * Proposes a spiral haul road down the inside of a pit's rim.
 * The pit is the flood-filled region at least `RAMP_CRATER_MIN_DROP_M` below the start's ground;
 * the road runs once round the rectangular ring circling its bounding box, and refuses when that lap
 * cannot fit the length the grade needs.
 */
export function proposeRampSpiral(req: SpiralRequest, surface: SpiralSurface): RampSpiralResult {
  const { depth, gradeDegrees, width, dir } = req;
  const start = { x: Math.floor(req.fromX), z: Math.floor(req.fromZ) };
  if (!surface.contains(start.x, start.z)) return fail(`${KEY}outside_area`);
  if (!Number.isFinite(depth) || depth <= 0) return fail(`${KEY}bad_depth`);
  if (!Number.isFinite(gradeDegrees) || gradeDegrees <= 0) return fail('mining.build_ramp.grade_invalid');
  const maxGrade = Math.floor(rampGradeBoundsDegrees(1, depth).max * 10) / 10;
  if (gradeDegrees > maxGrade) return fail('mining.build_ramp.grade_too_steep', { grade: gradeDegrees, max: maxGrade });

  const ground = surface.heightAt(start.x, start.z);
  const seeds = NEIGHBOUR_OFFSETS_8.map(([dx, dz]) => ({ x: start.x + dx, z: start.z + dz }))
    .filter(t => isVoid(surface, t.x, t.z, ground));
  if (startInHollow(surface, start, ground) && !(req.fromReachable === true && seeds.length > 0)) return fail(`${KEY}start_in_void`);
  if (seeds.length === 0 && voidNearby(surface, start, ground)) return fail(`${KEY}not_on_rim`);
  const pit = seeds.length === 0 ? null : floodPit(surface, seeds, ground);
  if (pit === null) return fail(`${KEY}no_pit`, { depth: RAMP_CRATER_MIN_DROP_M });

  const needed = rampLengthForGrade(depth, gradeDegrees);
  if (needed > MAX_RAMP_LENGTH) return fail(`${KEY}too_long`, { needed, max: MAX_RAMP_LENGTH });

  const half = Math.floor(width / 2);
  const inset = RAMP_SPIRAL_RIM_GAP_WIDTHS * width + half;
  const edges = ringEdges(pit.minX - inset, pit.maxX + inset, pit.minZ - inset, pit.maxZ + inset, dir);
  const first = startOnRing(edges, start, width);

  const legs: RampLeg[] = [];
  let total = 0;
  let here = first.point;
  // One leg per side of the ring, ending at its corner; the road stops before it would re-cross where it began.
  // The closing side may run on past its corner, clear of the first side, to gain the last few metres.
  const closingRun = RAMP_SPIRAL_CLOSING_RUN_WIDTHS * width;
  for (let i = 0; i < edges.length; i++) {
    const a = edges[(first.index + i) % edges.length]!;
    const runOn = i === edges.length - 1 ? closingRun : 0;
    const length = Math.abs(a.to.x - here.x) + Math.abs(a.to.z - here.z) + runOn;
    const take = Math.min(length, Math.max(width, needed - total));
    const ok = containedSteps(surface, here, a.direction, take, width, i > 0);
    if (ok < take) return fail(`${KEY}too_short`, { needed, offered: total + ok });
    legs.push({ direction: a.direction, length: take });
    total += take;
    if (total >= needed) return finishRoad(first.point, legs, total, req);
    here = a.to;
  }
  return fail(`${KEY}too_short`, { needed, offered: total });
}

/** Validates the finished ring road against self-crossing and wraps it as a proposal. */
function finishRoad(origin: Tile, legs: RampLeg[], total: number, req: SpiralRequest): RampSpiralResult {
  const { width, gradeDegrees, depth } = req;
  const fault = findRampPathFault({ originX: origin.x, originZ: origin.z, legs }, width);
  if (fault) return fail(fault.key, fault.params);
  return {
    success: true,
    proposal: {
      originX: origin.x, originZ: origin.z, legs, totalLength: total,
      cost: computeRampCost(total, width), laps: 1, gradeDegrees, depth,
    },
  };
}

/** Builds the terrain seam from a voxel grid and the optional playable-area membership test. */
export function spiralSurfaceFrom(grid: VoxelGrid, area: { contains(x: number, z: number): boolean } | null): SpiralSurface {
  return {
    heightAt: (x, z) => computeVoxelColumnSurfaceHeight(grid, x, z),
    contains: (x, z) => area?.contains(x, z) ?? grid.containsColumn(x, z),
  };
}

/** Whether `tile` lies on the pit rim: with a void neighbour, and (unless `fromReachable`) not at the bottom of a hollow. */
export function isPitRim(surface: SpiralSurface, tile: { x: number; z: number }, fromReachable = false): boolean {
  const start = { x: Math.floor(tile.x), z: Math.floor(tile.z) };
  if (!surface.contains(start.x, start.z)) return false;
  const ground = surface.heightAt(start.x, start.z);
  if (!fromReachable && startInHollow(surface, start, ground)) return false;
  return NEIGHBOUR_OFFSETS_8.some(([dx, dz]) => isVoid(surface, start.x + dx, start.z + dz, ground));
}
