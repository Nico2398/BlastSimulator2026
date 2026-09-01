// BlastSimulator2026 — Natural structures: rivers, villages, forests, landmarks (#458 T1.4/A13-A15)
// WorldGen's height sampler must stay a pure function of (seed, x, z) — so
// structures are computed once per world build into a StructureSet, then
// applied as bounded height overlays layered on top of the base sampler.
// Build order is fixed (rivers -> landmarks -> village pads) so later
// overlays see earlier ones' effects only through explicit apply() chaining,
// which keeps the whole thing deterministic. Villages and rivers are
// landscape-only: both are hard-excluded from ever touching the playable
// rect, by construction, so this module has no effect on `generateTerrain`'s
// voxel fill — it feeds the landscape sampler that T2.1's LandscapeMap will
// consume.

import { cellRand } from '../math/Hash.js';
import { smoothstep } from '../math/Smoothstep.js';
import type { WorldNoiseFields } from './NoiseFields.js';
import { sampleBaseHeight, type Rect, type ShapingAtFn } from './WorldGen.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HeightOverlay {
  bounds: Rect;
  /** Pure: returns the modified height for (x, z) given the height so far. */
  apply(x: number, z: number, h: number): number;
}

export interface RiverPath {
  points: Array<{ x: number; z: number }>;
  /** Channel half-width at each point, metres. The final entry is the lake radius if this river ends in one. */
  widths: number[];
  /** Water surface height at each point, metres, monotonically non-increasing downstream. */
  waterLevels: number[];
}

export interface House {
  x: number;
  z: number;
  rotation: number;
  w: number;
  d: number;
  h: number;
  hasChimney: boolean;
}

export interface Village {
  x: number;
  z: number;
  radius: number;
  houses: House[];
}

export interface TreePoint {
  x: number;
  z: number;
  h: number;
  scale: number;
  variant: number;
}

export interface Landmark {
  kind: 'mesa' | 'crater_lake';
  x: number;
  z: number;
  radius: number;
  /** crater_lake only: water disc height. */
  waterLevel?: number;
}

/**
 * The structures a site may never claim (#473 D6): rivers, villages and
 * landmarks. Deliberately excludes trees — a forest is scenery a mine can
 * clear, and the forest pass is by far the most expensive part of
 * `buildStructureSet`, which the claim check must not pay for.
 */
export interface ProtectedStructures {
  rivers: RiverPath[];
  villages: Village[];
  landmarks: Landmark[];
}

export interface StructureSet {
  overlays: HeightOverlay[];
  /** Coarse 128m-cell spatial index (packed key) -> overlay indices, in build order. */
  spatialIndex: Map<number, number[]>;
  rivers: RiverPath[];
  villages: Village[];
  trees: TreePoint[];
  landmarks: Landmark[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Half-extent (metres) of the landscape search/build area around the playable rect's centre (A16). */
const DEFAULT_LANDSCAPE_EXTENT_HALF = 1600;

export const PLAYABLE_RIVER_MARGIN = 32;
export const PLAYABLE_VILLAGE_MARGIN = 100;
const PLAYABLE_FOREST_MARGIN = 8;
export const LANDMARK_MIN_DIST_FROM_PLAYABLE = 400;
const LANDMARK_MIN_SEPARATION = 500;

const SPRING_CELL = 400;
const MAX_SPRINGS = 6;
const RIVER_STEP = 8;
const RIVER_MAX_STEPS = 2000;
const CHAIKIN_ITERATIONS = 2;

const VILLAGE_CELL = 600;
const MAX_VILLAGES = 5;
const VILLAGE_PAD_RADIUS = 40;
const VILLAGE_PAD_INNER = 15;
const HOUSES_MIN = 5;
const HOUSES_MAX = 12;
const HOUSE_RING_MIN = 10;
const HOUSE_RING_MAX = 30;
const HOUSE_SITE_SLOPE_MAX = 0.1;
const HOUSE_SITE_SLOPE_WINDOW = 4;

const LANDMARK_CELL = 300;
const LANDMARK_COUNT = 2;
const LANDMARK_KINDS: ReadonlyArray<'mesa' | 'crater_lake'> = ['mesa', 'crater_lake'];

const FOREST_CELL = 6;
const FOREST_SLOPE_MAX = 0.55;
const FOREST_SLOPE_WINDOW = 4;

const SPATIAL_CELL = 128;

// Discrete cellRand salts — distinct per draw so adding/removing one call never re-rolls another.
const SPRING_JITTER_X_SALT = 1;
const SPRING_JITTER_Z_SALT = 2;
const LAKE_RADIUS_SALT = 3;
const VILLAGE_JITTER_X_SALT = 4;
const VILLAGE_JITTER_Z_SALT = 5;
const VILLAGE_HOUSE_COUNT_SALT = 6;
const HOUSE_ANGLE_SALT = 7;
const HOUSE_RADIUS_SALT = 8;
const HOUSE_ROTATION_SALT = 9;
const HOUSE_W_SALT = 10;
const HOUSE_D_SALT = 11;
const HOUSE_H_SALT = 12;
const HOUSE_CHIMNEY_SALT = 13;
const LANDMARK_JITTER_X_SALT = 14;
const LANDMARK_JITTER_Z_SALT = 15;
const LANDMARK_KIND_SALT = 16;
const LANDMARK_RADIUS_SALT = 17;
const FOREST_JITTER_X_SALT = 18;
const FOREST_JITTER_Z_SALT = 19;
const FOREST_DENSITY_SALT = 20;
const FOREST_SCALE_SALT = 21;
const FOREST_VARIANT_SALT = 22;

// ---------------------------------------------------------------------------
// Small geometry helpers
// ---------------------------------------------------------------------------

function expandRect(rect: Rect, margin: number): Rect {
  return { minX: rect.minX - margin, maxX: rect.maxX + margin, minZ: rect.minZ - margin, maxZ: rect.maxZ + margin };
}

function insideRect(rect: Rect, x: number, z: number): boolean {
  return x >= rect.minX && x <= rect.maxX && z >= rect.minZ && z <= rect.maxZ;
}

function landscapeExtent(playableRect: Rect, extentHalf: number): Rect {
  const cx = (playableRect.minX + playableRect.maxX) / 2;
  const cz = (playableRect.minZ + playableRect.maxZ) / 2;
  return { minX: cx - extentHalf, maxX: cx + extentHalf, minZ: cz - extentHalf, maxZ: cz + extentHalf };
}

/** Gradient magnitude via central differences, in rise/run (~radians for small slopes). */
function estimateSlopeOf(heightAt: (x: number, z: number) => number, x: number, z: number, window: number): number {
  const half = window / 2;
  const dhdx = (heightAt(x + half, z) - heightAt(x - half, z)) / window;
  const dhdz = (heightAt(x, z + half) - heightAt(x, z - half)) / window;
  return Math.hypot(dhdx, dhdz);
}

/** Closest point on a polyline to (x, z): distance, and the interpolated width at that point. */
function nearestSegmentInfo(
  path: readonly { x: number; z: number }[],
  widths: readonly number[],
  x: number,
  z: number,
): { dist: number; width: number } {
  if (path.length < 2) return { dist: Infinity, width: 0 };
  let bestDistSq = Infinity;
  let bestWidth = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const p0 = path[i]!, p1 = path[i + 1]!;
    const dx = p1.x - p0.x, dz = p1.z - p0.z;
    const lenSq = dx * dx + dz * dz;
    let t = lenSq > 0 ? ((x - p0.x) * dx + (z - p0.z) * dz) / lenSq : 0;
    t = Math.max(0, Math.min(1, t));
    const px = p0.x + t * dx, pz = p0.z + t * dz;
    const ddx = x - px, ddz = z - pz;
    const distSq = ddx * ddx + ddz * ddz;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestWidth = widths[i]! + t * (widths[i + 1]! - widths[i]!);
    }
  }
  return { dist: Math.sqrt(bestDistSq), width: bestWidth };
}

// ---------------------------------------------------------------------------
// Spatial index + overlay application
// ---------------------------------------------------------------------------

function cellKey(cx: number, cz: number): number {
  return (cx + 32768) * 65536 + (cz + 32768);
}

function buildSpatialIndex(overlays: readonly HeightOverlay[]): Map<number, number[]> {
  const index = new Map<number, number[]>();
  overlays.forEach((overlay, i) => {
    const minCx = Math.floor(overlay.bounds.minX / SPATIAL_CELL);
    const maxCx = Math.floor(overlay.bounds.maxX / SPATIAL_CELL);
    const minCz = Math.floor(overlay.bounds.minZ / SPATIAL_CELL);
    const maxCz = Math.floor(overlay.bounds.maxZ / SPATIAL_CELL);
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const key = cellKey(cx, cz);
        const list = index.get(key);
        if (list) list.push(i); else index.set(key, [i]);
      }
    }
  });
  return index;
}

/** h = baseHeight -> for each overlay whose bounds contain (x, z), h = overlay.apply(x, z, h) (#458 A13). */
export function applyOverlays(structureSet: StructureSet, x: number, z: number, baseHeight: number): number {
  const indices = structureSet.spatialIndex.get(cellKey(Math.floor(x / SPATIAL_CELL), Math.floor(z / SPATIAL_CELL)));
  if (!indices) return baseHeight;
  let h = baseHeight;
  for (const i of indices) {
    const overlay = structureSet.overlays[i]!;
    if (insideRect(overlay.bounds, x, z)) h = overlay.apply(x, z, h);
  }
  return h;
}

// ---------------------------------------------------------------------------
// Rivers (A14)
// ---------------------------------------------------------------------------

interface TraceResult {
  points: Array<{ x: number; z: number }>;
  endedInLake: boolean;
  lakeRadius: number;
  lakeMinHeight: number;
}

const NEIGHBOR_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
];

function traceOneRiver(
  seed: number,
  spring: { x: number; z: number; h: number },
  heightAt: (x: number, z: number) => number,
  extent: Rect,
): TraceResult {
  const points: Array<{ x: number; z: number }> = [{ x: spring.x, z: spring.z }];
  let cur = spring;

  for (let step = 0; step < RIVER_MAX_STEPS; step++) {
    if (cur.h < 0.5 || !insideRect(extent, cur.x, cur.z)) {
      return { points, endedInLake: false, lakeRadius: 0, lakeMinHeight: cur.h };
    }

    let best = cur;
    for (const [dx, dz] of NEIGHBOR_OFFSETS) {
      const nx = cur.x + dx * RIVER_STEP, nz = cur.z + dz * RIVER_STEP;
      const nh = heightAt(nx, nz);
      if (nh < best.h) best = { x: nx, z: nz, h: nh };
    }

    if (best === cur) {
      const r = 20 + 20 * cellRand(seed, Math.round(cur.x), Math.round(cur.z), LAKE_RADIUS_SALT);
      return { points, endedInLake: true, lakeRadius: r, lakeMinHeight: cur.h };
    }
    cur = best;
    points.push({ x: cur.x, z: cur.z });
  }
  return { points, endedInLake: false, lakeRadius: 0, lakeMinHeight: cur.h };
}

function chaikinSmooth(points: ReadonlyArray<{ x: number; z: number }>): Array<{ x: number; z: number }> {
  let pts: ReadonlyArray<{ x: number; z: number }> = points;
  for (let iter = 0; iter < CHAIKIN_ITERATIONS; iter++) {
    if (pts.length < 3) break;
    const next: Array<{ x: number; z: number }> = [pts[0]!];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i]!, p1 = pts[i + 1]!;
      next.push({ x: 0.75 * p0.x + 0.25 * p1.x, z: 0.75 * p0.z + 0.25 * p1.z });
      next.push({ x: 0.25 * p0.x + 0.75 * p1.x, z: 0.25 * p0.z + 0.75 * p1.z });
    }
    next.push(pts[pts.length - 1]!);
    pts = next;
  }
  return pts as Array<{ x: number; z: number }>;
}

/** Normalized cumulative arc length per point, 0 at the first point, 1 at the last. */
function arcPositions(points: ReadonlyArray<{ x: number; z: number }>): number[] {
  const cum: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    const dx = points[i]!.x - points[i - 1]!.x, dz = points[i]!.z - points[i - 1]!.z;
    cum.push(cum[i - 1]! + Math.hypot(dx, dz));
  }
  const total = cum[cum.length - 1]!;
  return total > 0 ? cum.map(c => c / total) : cum.map(() => 0);
}

function finalizeRiver(traced: TraceResult, heightAt: (x: number, z: number) => number): RiverPath {
  const points = chaikinSmooth(traced.points);
  const s = arcPositions(points);
  const widths = s.map(si => 3 + 5 * si);
  // D(s) = 1.5 + 1.5*s, derived here for the water-bed calc only; the carve
  // overlay re-derives it from width (D = 1.5 + 0.3*(W-3)) so widths[] stays
  // the single source of truth once a lake overrides the final entry.
  const depths = s.map(si => 1.5 + 1.5 * si);

  const waterLevels = points.map((p, i) => heightAt(p.x, p.z) - depths[i]! + 1.0);
  for (let i = 1; i < waterLevels.length; i++) {
    waterLevels[i] = Math.min(waterLevels[i]!, waterLevels[i - 1]!);
  }

  if (traced.endedInLake && widths.length > 0) {
    const last = widths.length - 1;
    widths[last] = traced.lakeRadius;
    waterLevels[last] = Math.min(waterLevels[last]!, traced.lakeMinHeight + 0.5);
  }

  return { points, widths, waterLevels };
}

export function buildRiverOverlay(river: RiverPath): HeightOverlay {
  const maxWidth = river.widths.length > 0 ? Math.max(...river.widths) : 8;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of river.points) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  const bounds: Rect = river.points.length > 0
    ? { minX: minX - maxWidth, maxX: maxX + maxWidth, minZ: minZ - maxWidth, maxZ: maxZ + maxWidth }
    : { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };

  return {
    bounds,
    apply(x, z, h) {
      const { dist, width } = nearestSegmentInfo(river.points, river.widths, x, z);
      if (width <= 0 || dist >= width) return h;
      const depth = 1.5 + 0.3 * (width - 3);
      return h - depth * (1 - (dist / width) ** 2);
    },
  };
}

/**
 * Traces up to MAX_SPRINGS rivers on the base (pre-overlay) height field.
 * A river that ever enters the playable rect (+32m) is discarded whole —
 * rivers are landscape-only, like villages, with no deflection logic.
 */
export function traceRivers(
  seed: number,
  fields: WorldNoiseFields,
  shapingAt: ShapingAtFn,
  playableRect: Rect,
  extentHalf: number = DEFAULT_LANDSCAPE_EXTENT_HALF,
): RiverPath[] {
  const extent = landscapeExtent(playableRect, extentHalf);
  const heightAt = (x: number, z: number) => sampleBaseHeight(fields, x, z, shapingAt(x, z));

  const candidates: Array<{ x: number; z: number; h: number }> = [];
  const cellsX = Math.ceil((extent.maxX - extent.minX) / SPRING_CELL);
  const cellsZ = Math.ceil((extent.maxZ - extent.minZ) / SPRING_CELL);
  for (let cz = 0; cz < cellsZ; cz++) {
    for (let cx = 0; cx < cellsX; cx++) {
      const x = extent.minX + cx * SPRING_CELL + cellRand(seed, cx, cz, SPRING_JITTER_X_SALT) * SPRING_CELL;
      const z = extent.minZ + cz * SPRING_CELL + cellRand(seed, cx, cz, SPRING_JITTER_Z_SALT) * SPRING_CELL;
      const h = heightAt(x, z);
      if (h > 35 && fields.riverSpring(x, z) > 0.3) candidates.push({ x, z, h });
    }
  }
  candidates.sort((a, b) => b.h - a.h);

  const rivers: RiverPath[] = [];
  for (const spring of candidates.slice(0, MAX_SPRINGS)) {
    const traced = traceOneRiver(seed, spring, heightAt, extent);
    const river = finalizeRiver(traced, heightAt);
    if (riverChannelNearRect(river, playableRect, PLAYABLE_RIVER_MARGIN)) continue;
    rivers.push(river);
  }
  return rivers;
}

// ---------------------------------------------------------------------------
// Landmarks (A15)
// ---------------------------------------------------------------------------

export function buildLandmarkOverlay(landmark: Landmark, hBase: number): HeightOverlay {
  const { x: cx, z: cz, radius: R } = landmark;
  const bounds: Rect = { minX: cx - R, maxX: cx + R, minZ: cz - R, maxZ: cz + R };

  if (landmark.kind === 'mesa') {
    const plateau = hBase + 25;
    return {
      bounds,
      apply(x, z, h) {
        const r = Math.hypot(x - cx, z - cz);
        return h + smoothstep(R, R * 0.7, r) * (plateau - h);
      },
    };
  }

  return {
    bounds,
    apply(x, z, h) {
      const r = Math.hypot(x - cx, z - cz);
      const rimRaise = 8 * smoothstep(R, R * 0.75, r) * smoothstep(R * 0.45, R * 0.6, r);
      const bowlDrop = -10 * smoothstep(R * 0.6, 0, r);
      return h + rimRaise + bowlDrop;
    },
  };
}

/** 2 landmarks per world, >=400m from the playable rect, >=500m apart, biased toward high continentalness ("mountain range alignment"). */
export function placeLandmarks(
  seed: number,
  fields: WorldNoiseFields,
  shapingAt: ShapingAtFn,
  playableRect: Rect,
  extentHalf: number = DEFAULT_LANDSCAPE_EXTENT_HALF,
): Landmark[] {
  const extent = landscapeExtent(playableRect, extentHalf);
  const excludeRect = expandRect(playableRect, LANDMARK_MIN_DIST_FROM_PLAYABLE);

  const candidates: Array<{ x: number; z: number; score: number }> = [];
  const cellsX = Math.ceil((extent.maxX - extent.minX) / LANDMARK_CELL);
  const cellsZ = Math.ceil((extent.maxZ - extent.minZ) / LANDMARK_CELL);
  for (let cz = 0; cz < cellsZ; cz++) {
    for (let cx = 0; cx < cellsX; cx++) {
      const x = extent.minX + cx * LANDMARK_CELL + cellRand(seed, cx, cz, LANDMARK_JITTER_X_SALT) * LANDMARK_CELL;
      const z = extent.minZ + cz * LANDMARK_CELL + cellRand(seed, cx, cz, LANDMARK_JITTER_Z_SALT) * LANDMARK_CELL;
      if (insideRect(excludeRect, x, z)) continue;
      candidates.push({ x, z, score: fields.continentalness(x, z) });
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  const landmarks: Landmark[] = [];
  for (const c of candidates) {
    if (landmarks.length >= LANDMARK_COUNT) break;
    if (landmarks.some(l => Math.hypot(l.x - c.x, l.z - c.z) < LANDMARK_MIN_SEPARATION)) continue;

    const rx = Math.round(c.x), rz = Math.round(c.z);
    const kind = LANDMARK_KINDS[Math.floor(cellRand(seed, rx, rz, LANDMARK_KIND_SALT) * LANDMARK_KINDS.length)]!;
    const radius = kind === 'mesa'
      ? 60 + 40 * cellRand(seed, rx, rz, LANDMARK_RADIUS_SALT)
      : 50 + 30 * cellRand(seed, rx, rz, LANDMARK_RADIUS_SALT);
    // final accept/reject, now that radius is known — the coarse candidate
    // filter above (margin only) is a fast, permissive superset filter.
    if (pointRectDistance(playableRect, c.x, c.z) < LANDMARK_MIN_DIST_FROM_PLAYABLE + radius) continue;
    const hBase = sampleBaseHeight(fields, c.x, c.z, shapingAt(c.x, c.z));

    landmarks.push({
      kind, x: c.x, z: c.z, radius,
      ...(kind === 'crater_lake' ? { waterLevel: hBase - 2 } : {}),
    });
  }
  return landmarks;
}

// ---------------------------------------------------------------------------
// Villages (A15)
// ---------------------------------------------------------------------------

function villagePadHeightAt(
  fields: WorldNoiseFields, shapingAt: ShapingAtFn,
  x: number, z: number, cx: number, cz: number, R: number, hCenter: number,
): number {
  const raw = sampleBaseHeight(fields, x, z, shapingAt(x, z));
  const r = Math.hypot(x - cx, z - cz);
  return raw + smoothstep(R, VILLAGE_PAD_INNER, r) * (hCenter - raw);
}

export function buildVillageOverlay(village: Village, fields: WorldNoiseFields, shapingAt: ShapingAtFn, hCenter: number): HeightOverlay {
  const { x: cx, z: cz, radius: R } = village;
  return {
    bounds: { minX: cx - R, maxX: cx + R, minZ: cz - R, maxZ: cz + R },
    apply(x, z, _h) {
      return villagePadHeightAt(fields, shapingAt, x, z, cx, cz, R, hCenter);
    },
  };
}

function buildVillage(
  seed: number, index: number, x: number, z: number,
  fields: WorldNoiseFields, shapingAt: ShapingAtFn, hCenter: number,
): Village {
  const houseCount = HOUSES_MIN + Math.floor(
    cellRand(seed, index, 0, VILLAGE_HOUSE_COUNT_SALT) * (HOUSES_MAX - HOUSES_MIN + 1),
  );
  const houses: House[] = [];
  for (let i = 0; i < houseCount; i++) {
    const angle = cellRand(seed, index, i, HOUSE_ANGLE_SALT) * Math.PI * 2;
    const r = HOUSE_RING_MIN + cellRand(seed, index, i, HOUSE_RADIUS_SALT) * (HOUSE_RING_MAX - HOUSE_RING_MIN);
    const hx = x + Math.cos(angle) * r;
    const hz = z + Math.sin(angle) * r;

    const paddedHeightAt = (px: number, pz: number) => villagePadHeightAt(fields, shapingAt, px, pz, x, z, VILLAGE_PAD_RADIUS, hCenter);
    const localSlope = estimateSlopeOf(paddedHeightAt, hx, hz, HOUSE_SITE_SLOPE_WINDOW);
    if (localSlope > HOUSE_SITE_SLOPE_MAX) continue;

    houses.push({
      x: hx, z: hz,
      rotation: cellRand(seed, index, i, HOUSE_ROTATION_SALT) * Math.PI * 2,
      w: 4 + cellRand(seed, index, i, HOUSE_W_SALT) * 2,
      d: 5 + cellRand(seed, index, i, HOUSE_D_SALT) * 3,
      h: 3 + cellRand(seed, index, i, HOUSE_H_SALT) * 1,
      hasChimney: cellRand(seed, index, i, HOUSE_CHIMNEY_SALT) < 0.8,
    });
  }
  return { x, z, radius: VILLAGE_PAD_RADIUS, houses };
}

/** Hard-excluded from the playable rect (+100m) — this exclusion is the invariant under test. */
export function placeVillages(
  seed: number,
  fields: WorldNoiseFields,
  shapingAt: ShapingAtFn,
  playableRect: Rect,
  rivers: readonly RiverPath[],
  extentHalf: number = DEFAULT_LANDSCAPE_EXTENT_HALF,
): Village[] {
  const extent = landscapeExtent(playableRect, extentHalf);
  const heightAt = (x: number, z: number) => sampleBaseHeight(fields, x, z, shapingAt(x, z));

  const candidates: Array<{ x: number; z: number; score: number }> = [];
  const cellsX = Math.ceil((extent.maxX - extent.minX) / VILLAGE_CELL);
  const cellsZ = Math.ceil((extent.maxZ - extent.minZ) / VILLAGE_CELL);
  for (let cz = 0; cz < cellsZ; cz++) {
    for (let cx = 0; cx < cellsX; cx++) {
      const x = extent.minX + cx * VILLAGE_CELL + cellRand(seed, cx, cz, VILLAGE_JITTER_X_SALT) * VILLAGE_CELL;
      const z = extent.minZ + cz * VILLAGE_CELL + cellRand(seed, cx, cz, VILLAGE_JITTER_Z_SALT) * VILLAGE_CELL;

      // hard reject — the tested invariant; VILLAGE_PAD_RADIUS is the village's own radius (fixed, undrawn at this stage)
      if (pointRectDistance(playableRect, x, z) < PLAYABLE_VILLAGE_MARGIN + VILLAGE_PAD_RADIUS) continue;

      const h = heightAt(x, z);
      if (!(h > 2 && h < 40)) continue;

      const slope16 = estimateSlopeOf(heightAt, x, z, 16);
      const flatness = 1 - Math.max(0, Math.min(1, slope16 / 0.15));
      const nearRiver = rivers.some(riv => {
        const info = nearestSegmentInfo(riv.points, riv.widths, x, z);
        return info.dist < 120;
      });
      const score = 2 * flatness + (nearRiver ? 1 : 0);
      if (score > 1.2) candidates.push({ x, z, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  return candidates.slice(0, MAX_VILLAGES).map((c, i) => {
    const hCenter = heightAt(c.x, c.z);
    return buildVillage(seed, i, c.x, c.z, fields, shapingAt, hCenter);
  });
}

// ---------------------------------------------------------------------------
// Forests (A15)
// ---------------------------------------------------------------------------

/**
 * Jittered 6m grid outside the playable rect (+8m), rivers/lakes (+3m) and
 * village pads. Takes the already-built overlays (rivers + landmarks +
 * village pads) directly rather than a StructureSet, so it stays
 * independently callable/testable without a circular trees:[] placeholder —
 * the orchestrator passes its own in-progress overlay list.
 */
export function placeForests(
  seed: number,
  fields: WorldNoiseFields,
  shapingAt: ShapingAtFn,
  forestDensity: number,
  playableRect: Rect,
  rivers: readonly RiverPath[],
  villages: readonly Village[],
  overlays: readonly HeightOverlay[],
  extentHalf: number = DEFAULT_LANDSCAPE_EXTENT_HALF,
): TreePoint[] {
  const extent = landscapeExtent(playableRect, extentHalf);
  const excludeRect = expandRect(playableRect, PLAYABLE_FOREST_MARGIN);
  const finalHeightAt = (x: number, z: number) => {
    let h = sampleBaseHeight(fields, x, z, shapingAt(x, z));
    for (const overlay of overlays) {
      if (insideRect(overlay.bounds, x, z)) h = overlay.apply(x, z, h);
    }
    return h;
  };

  const trees: TreePoint[] = [];
  const cellsX = Math.ceil((extent.maxX - extent.minX) / FOREST_CELL);
  const cellsZ = Math.ceil((extent.maxZ - extent.minZ) / FOREST_CELL);
  for (let cz = 0; cz < cellsZ; cz++) {
    for (let cx = 0; cx < cellsX; cx++) {
      const x = extent.minX + cx * FOREST_CELL + cellRand(seed, cx, cz, FOREST_JITTER_X_SALT) * FOREST_CELL;
      const z = extent.minZ + cz * FOREST_CELL + cellRand(seed, cx, cz, FOREST_JITTER_Z_SALT) * FOREST_CELL;

      if (insideRect(excludeRect, x, z)) continue;

      // Density roll first: it's one noise call + one hash, versus the slope
      // check's 4 full height samples through every overlay. Most cells fail
      // density (typical forestDensity is well under 1), so checking it
      // before slope avoids most of the expensive work for free — same
      // accepted trees either way, since neither draw depends on the other.
      const density = forestDensity * Math.max(0, Math.min(1, fields.forest(x, z) * 0.5 + 0.5));
      if (cellRand(seed, cx, cz, FOREST_DENSITY_SALT) >= density) continue;

      if (rivers.some(r => {
        const info = nearestSegmentInfo(r.points, r.widths, x, z);
        return info.width > 0 && info.dist < info.width + 3;
      })) continue;
      if (villages.some(v => Math.hypot(v.x - x, v.z - z) < v.radius)) continue;

      const slope = estimateSlopeOf(finalHeightAt, x, z, FOREST_SLOPE_WINDOW);
      if (slope >= FOREST_SLOPE_MAX) continue;

      trees.push({
        x, z, h: finalHeightAt(x, z),
        scale: 0.7 + 0.6 * cellRand(seed, cx, cz, FOREST_SCALE_SALT),
        variant: Math.floor(3 * cellRand(seed, cx, cz, FOREST_VARIANT_SALT)),
      });
    }
  }
  return trees;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Builds the full StructureSet for one world/level seed: rivers, then
 * landmarks, then village pads (fixed order per A13), then forests sampling
 * the final overlaid heights.
 */
/**
 * Rivers, landmarks and village pads for one world/level seed, in the fixed
 * build order A13 requires — everything `buildStructureSet` produces except
 * the forest pass. Split out so the claim check (#473 D6) can ask what ground
 * is protected without generating tens of thousands of trees to find out.
 */
export function buildProtectedStructures(
  seed: number,
  fields: WorldNoiseFields,
  shapingAt: ShapingAtFn,
  playableRect: Rect,
  extentHalf: number = DEFAULT_LANDSCAPE_EXTENT_HALF,
): ProtectedStructures {
  const rivers = traceRivers(seed, fields, shapingAt, playableRect, extentHalf);
  const landmarks = placeLandmarks(seed, fields, shapingAt, playableRect, extentHalf);
  const villages = placeVillages(seed, fields, shapingAt, playableRect, rivers, extentHalf);
  return { rivers, landmarks, villages };
}

/** Shortest distance from (x, z) to an axis-aligned rect. 0 when inside. */
function pointRectDistance(rect: Rect, x: number, z: number): number {
  const dx = Math.max(rect.minX - x, 0, x - rect.maxX);
  const dz = Math.max(rect.minZ - z, 0, z - rect.maxZ);
  return Math.hypot(dx, dz);
}

/** Shortest distance from a segment to an axis-aligned rect. 0 when they touch or overlap. */
function segmentRectDistance(
  ax: number, az: number, bx: number, bz: number,
  rect: Rect,
): number {
  // Two disjoint convex 2D shapes attain their minimum separation at a vertex
  // of one of them, so checking the segment's endpoints against the rect and
  // the rect's corners against the segment is exact, not an approximation.
  let best = Math.min(pointRectDistance(rect, ax, az), pointRectDistance(rect, bx, bz));
  if (best === 0) return 0;

  const corners: Array<[number, number]> = [
    [rect.minX, rect.minZ], [rect.maxX, rect.minZ], [rect.maxX, rect.maxZ], [rect.minX, rect.maxZ],
  ];
  const dx = bx - ax, dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  for (const [cx, cz] of corners) {
    let t = lenSq > 0 ? ((cx - ax) * dx + (cz - az) * dz) / lenSq : 0;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(cx - (ax + t * dx), cz - (az + t * dz));
    if (d < best) best = d;
  }
  return best;
}

/**
 * True when any segment of `river`'s carved channel — width linearly
 * interpolated per segment, conservatively bounded by the larger of its
 * two endpoint widths — comes within `extra` metres of `rect`. Exact
 * per-segment closest-approach (not a sample-point test), so it cannot
 * miss a channel dipping toward `rect` between two traced points (#913).
 */
export function riverChannelNearRect(
  river: Pick<RiverPath, 'points' | 'widths'>,
  rect: Rect,
  extra: number,
): boolean {
  for (let i = 0; i < river.points.length - 1; i++) {
    const p0 = river.points[i]!, p1 = river.points[i + 1]!;
    const width = Math.max(river.widths[i] ?? 0, river.widths[i + 1] ?? 0);
    if (segmentRectDistance(p0.x, p0.z, p1.x, p1.z, rect) < width + extra) return true;
  }
  return false;
}

/** Extra metres of standoff around a protected footprint, so a claim never abuts a village wall or riverbank. */
const PROTECTED_MARGIN = 4;

/**
 * True when any river channel, village pad or landmark overlaps `rect`
 * (max exclusive) — the veto that stops a site claiming generated
 * structures (#473 D6).
 */
export function rectTouchesProtectedStructure(structures: ProtectedStructures, rect: Rect): boolean {
  for (const village of structures.villages) {
    if (pointRectDistance(rect, village.x, village.z) < village.radius + PROTECTED_MARGIN) return true;
  }
  for (const landmark of structures.landmarks) {
    if (pointRectDistance(rect, landmark.x, landmark.z) < landmark.radius + PROTECTED_MARGIN) return true;
  }
  for (const river of structures.rivers) {
    if (riverChannelNearRect(river, rect, PROTECTED_MARGIN)) return true;
  }
  return false;
}

export function buildStructureSet(
  seed: number,
  fields: WorldNoiseFields,
  shapingAt: ShapingAtFn,
  forestDensity: number,
  playableRect: Rect,
  extentHalf: number = DEFAULT_LANDSCAPE_EXTENT_HALF,
): StructureSet {
  const { rivers, landmarks, villages } = buildProtectedStructures(seed, fields, shapingAt, playableRect, extentHalf);

  const overlays: HeightOverlay[] = [
    ...rivers.map(r => buildRiverOverlay(r)),
    ...landmarks.map(l => buildLandmarkOverlay(l, sampleBaseHeight(fields, l.x, l.z, shapingAt(l.x, l.z)))),
    ...villages.map(v => buildVillageOverlay(v, fields, shapingAt, sampleBaseHeight(fields, v.x, v.z, shapingAt(v.x, v.z)))),
  ];
  const trees = placeForests(seed, fields, shapingAt, forestDensity, playableRect, rivers, villages, overlays, extentHalf);

  return { overlays, spatialIndex: buildSpatialIndex(overlays), rivers, villages, trees, landmarks };
}
