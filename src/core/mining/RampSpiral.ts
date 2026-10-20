// BlastSimulator2026 — Spiral ramp proposal (#1940)
// Pure planner: proposes a stack of straight legs that spirals down a pit wall.
// Reads terrain only through the narrow SpiralSurface seam; no GameState.

import {
  MAX_RAMP_LENGTH, RAMP_CRATER_MIN_DROP_M, RAMP_SPIRAL_LAP_GAP_WIDTHS, RAMP_SPIRAL_MAX_PIT_SPAN_M,
  RAMP_SPIRAL_RIM_GAP_WIDTHS, type RampWidth,
} from '../config/balance.js';
import { computeRampCost, rampGradeBoundsDegrees } from './Ramp.js';
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
  laps: number;
  gradeDegrees: number;
  depth: number;
}

export type RampSpiralResult =
  | { success: true; proposal: RampSpiralProposal }
  | { success: false; reasonKey: string; params?: Record<string, string | number> };

const RAD_TO_DEG = 180 / Math.PI;
const KEY = 'mining.ramp_spiral.';

type Fail = Extract<RampSpiralResult, { success: false }>;
const fail = (reasonKey: string, params?: Record<string, string | number>): Fail =>
  params ? { success: false, reasonKey, params } : { success: false, reasonKey };

interface Tile { x: number; z: number }
interface PitBounds { minX: number; maxX: number; minZ: number; maxZ: number }

const NEIGHBOURS_4: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const NEIGHBOURS_8: readonly (readonly [number, number])[] = [
  ...NEIGHBOURS_4, [1, 1], [1, -1], [-1, 1], [-1, -1],
];

/** True when `(x, z)` is claimed and at least the crater drop below `ground`. */
function isVoid(surface: SpiralSurface, x: number, z: number, ground: number): boolean {
  return surface.contains(x, z) && surface.heightAt(x, z) <= ground - RAMP_CRATER_MIN_DROP_M;
}

/** The start sits at the bottom of a hollow: every cardinal ray meets ground a crater drop higher. */
function startInHollow(surface: SpiralSurface, start: Tile, ground: number): boolean {
  return NEIGHBOURS_4.every(([dx, dz]) => {
    for (let k = 1; k <= RAMP_SPIRAL_MAX_PIT_SPAN_M; k++) {
      const x = start.x + dx * k;
      const z = start.z + dz * k;
      if (!surface.contains(x, z)) return false;
      if (surface.heightAt(x, z) >= ground + RAMP_CRATER_MIN_DROP_M) return true;
    }
    return false;
  });
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
    for (const [dx, dz] of NEIGHBOURS_4) {
      const n = { x: x + dx, z: z + dz };
      const key = `${n.x},${n.z}`;
      if (seen.has(key) || !isVoid(surface, n.x, n.z, ground)) continue;
      seen.add(key);
      queue.push(n);
    }
  }
  return b;
}

/** One side of the rectangular ring, in travel order: the line it lies on and where it runs. */
interface RingEdge {
  /** Runs along x (a top or bottom side). */
  horizontal: boolean;
  /** Line coordinate at lap 0 (z for horizontal, x for vertical). */
  line: number;
  /** +1 / -1: which way successive laps move the line. */
  outward: 1 | -1;
  from: Tile;
  to: Tile;
  direction: RampDirection;
}

/** The four sides of ring 0 (centreline rectangle) in the travel order of `dir`. */
function ringEdges(L: number, R: number, T: number, B: number, dir: SpiralDir): RingEdge[] {
  const nw = { x: L, z: T }; const ne = { x: R, z: T };
  const se = { x: R, z: B }; const sw = { x: L, z: B };
  const top = (from: Tile, to: Tile, direction: RampDirection): RingEdge => ({ horizontal: true, line: T, outward: -1, from, to, direction });
  const bottom = (from: Tile, to: Tile, direction: RampDirection): RingEdge => ({ horizontal: true, line: B, outward: 1, from, to, direction });
  const right = (from: Tile, to: Tile, direction: RampDirection): RingEdge => ({ horizontal: false, line: R, outward: 1, from, to, direction });
  const left = (from: Tile, to: Tile, direction: RampDirection): RingEdge => ({ horizontal: false, line: L, outward: -1, from, to, direction });
  return dir === 'cw'
    ? [top(nw, ne, 'east'), right(ne, se, 'south'), bottom(se, sw, 'west'), left(sw, nw, 'north')]
    : [top(ne, nw, 'west'), left(nw, sw, 'south'), bottom(sw, se, 'east'), right(se, ne, 'north')];
}

const lineAt = (e: RingEdge, lap: number, spacing: number): number => e.line + e.outward * lap * spacing;

/** Corner of two consecutive sides, each at its own lap. */
function cornerOf(a: RingEdge, lapA: number, b: RingEdge, lapB: number, spacing: number): Tile {
  const la = lineAt(a, lapA, spacing);
  const lb = lineAt(b, lapB, spacing);
  return a.horizontal ? { x: lb, z: la } : { x: la, z: lb };
}

/** Index of the side of ring 0 nearest `start`, and the point on it to begin from (clear of the previous side and of the next corner). */
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
 * the road runs as concentric rectangular rings around its bounding box, each lap one ring further out.
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
  if (startInHollow(surface, start, ground)) return fail(`${KEY}start_in_void`);
  const seeds = NEIGHBOURS_8.map(([dx, dz]) => ({ x: start.x + dx, z: start.z + dz }))
    .filter(t => isVoid(surface, t.x, t.z, ground));
  if (seeds.length === 0) return fail(voidNearby(surface, start, ground) ? `${KEY}not_on_rim` : `${KEY}no_pit`);
  const pit = floodPit(surface, seeds, ground);
  if (pit === null) return fail(`${KEY}no_pit`);

  const needed = Math.ceil(depth / Math.tan(gradeDegrees / RAD_TO_DEG));
  if (needed > MAX_RAMP_LENGTH) return fail(`${KEY}too_short`, { needed, offered: MAX_RAMP_LENGTH });

  const half = Math.floor(width / 2);
  const inset = RAMP_SPIRAL_RIM_GAP_WIDTHS * width + half;
  const spacing = width + RAMP_SPIRAL_LAP_GAP_WIDTHS * width;
  const edges = ringEdges(pit.minX - inset, pit.maxX + inset, pit.minZ - inset, pit.maxZ + inset, dir);
  const first = startOnRing(edges, start, width);

  const legs: RampLeg[] = [];
  let total = 0;
  let here = first.point;
  for (let i = 0; ; i++) {
    const a = edges[(first.index + i) % 4]!;
    const b = edges[(first.index + i + 1) % 4]!;
    const next = cornerOf(a, Math.floor(i / 4), b, Math.floor((i + 1) / 4), spacing);
    const length = Math.abs(next.x - here.x) + Math.abs(next.z - here.z);
    const take = Math.min(length, Math.max(width, needed - total));
    const ok = containedSteps(surface, here, a.direction, take, width, i > 0);
    if (ok < take) return fail(`${KEY}too_short`, { needed, offered: total + ok });
    legs.push({ direction: a.direction, length: take });
    total += take;
    if (total >= needed) break;
    here = next;
  }

  const origin = first.point;
  const fault = findRampPathFault({ originX: origin.x, originZ: origin.z, legs }, width);
  if (fault) return fail(fault.key, fault.params);
  return {
    success: true,
    proposal: {
      originX: origin.x, originZ: origin.z, legs, totalLength: total,
      cost: computeRampCost(total, width), laps: Math.ceil(legs.length / 4), gradeDegrees, depth,
    },
  };
}
