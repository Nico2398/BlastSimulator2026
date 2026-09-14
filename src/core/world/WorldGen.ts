// BlastSimulator2026 — Unified world height sampler (#458 T1.1)
// Single source of truth for terrain height: TerrainGen's voxel fill and
// (from T2.1 onward) the landscape heightmap both read the same function,
// so the two representations cannot disagree at their shared boundary.
//
// Height composition follows a Minecraft-style layered model: continentalness
// picks macro elevation, erosion scales how much relief survives, peaksValleys
// adds local ridges, and a pit-suitability mask compresses relief inside the
// playable area so a level stays diggable regardless of how dramatic the
// surrounding terrain is (#458 A4/A5). Biome-specific shaping (splines
// selected by climate) arrives in T1.2 — this module takes shaping as a
// parameter and ships one neutral default until then.

import { WorldNoiseFields } from './NoiseFields.js';
import {
  evalSpline,
  DEFAULT_BASE_SPLINE,
  DEFAULT_RELIEF_SPLINE,
  DEFAULT_PV_AMPLITUDE,
  type Spline,
} from './HeightSpline.js';
import { smoothstep } from '../math/Smoothstep.js';

export interface HeightShapingParams {
  baseSpline: Spline;
  reliefSpline: Spline;
  pvAmplitude: number;
}

/**
 * One shaping profile, or several blended by weight (BiomeCatalog's climate
 * blend, #458 T1.2/A6). The array variant is deliberately a mutable Array,
 * not ReadonlyArray — Array.isArray's type predicate is `arg is any[]`, and
 * TypeScript can't narrow a ReadonlyArray branch away from that cleanly.
 */
export type ShapingInput = HeightShapingParams | Array<{ shaping: HeightShapingParams; weight: number }>;

/** Neutral shaping used by callers with no biome concept (kept for T1.1's existing callers/tests). */
export const DEFAULT_SHAPING: HeightShapingParams = {
  baseSpline: DEFAULT_BASE_SPLINE,
  reliefSpline: DEFAULT_RELIEF_SPLINE,
  pvAmplitude: DEFAULT_PV_AMPLITUDE,
};

function normalizeShaping(input: ShapingInput): Array<{ shaping: HeightShapingParams; weight: number }> {
  return Array.isArray(input) ? input : [{ shaping: input, weight: 1 }];
}

/**
 * Raw world height in metres (sea level = 0) at absolute world (x, z),
 * before the pit-suitability mask. Deterministic and independent of any
 * grid's size — the same (x, z) always yields the same height for a given
 * seed and shaping, regardless of what grid a caller is generating (#458 A4).
 *
 * A weighted array of shaping profiles blends the *evaluated* base/relief
 * spline outputs (not the control points) by weight — this is what makes a
 * climate transition between two biomes a smooth height gradient rather than
 * a seam (#458 A6).
 */
export function sampleBaseHeight(
  fields: WorldNoiseFields,
  x: number,
  z: number,
  shaping: ShapingInput = DEFAULT_SHAPING,
): number {
  const c = fields.continentalness(x, z);
  const e = fields.erosion(x, z);
  const pv = fields.peaksValleys(x, z);

  const weighted = normalizeShaping(shaping);
  let base = 0, relief = 0, pvAmplitude = 0;
  for (const { shaping: s, weight } of weighted) {
    base += weight * evalSpline(s.baseSpline, c);
    relief += weight * evalSpline(s.reliefSpline, e);
    pvAmplitude += weight * s.pvAmplitude;
  }

  return base + relief * pvAmplitude * (pv - 0.35) + 1.2 * fields.detail(x, z);
}

export interface Rect {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/** Metres of blend measured inward from a playable rect's edge (#458 A5). */
const PIT_MASK_MARGIN = 24;
/** Fraction of relief that survives at full compression, deep inside the rect. */
const PIT_RELIEF_KEEP = 0.3;

/** Metres outside the playable rect over which the site's vertical band stops
 *  applying and the world's own relief comes back (#1077). Matches
 *  PIT_MASK_MARGIN's scale: the same length the mask uses on its way in. */
const SITE_BAND_MARGIN = 24;
/** Metres outside the rect over which the band still applies in full: the one
 *  cell of sealing halo the playable mesh marches past its own rect
 *  (`PlayableCoverage.meshedCellRect`) is ground that mesh draws, so the world
 *  has to follow the band exactly there, not 96% of it. */
const SITE_BAND_HOLD = 1;

/** Distance from (x, z) to the nearest edge of rect, measured inward — negative outside. */
function distanceInsideRect(rect: Rect, x: number, z: number): number {
  const dx = Math.min(x - rect.minX, rect.maxX - x);
  const dz = Math.min(z - rect.minZ, rect.maxZ - z);
  return Math.min(dx, dz);
}

/**
 * Compress relief toward centerHeight within PIT_MASK_MARGIN metres inside
 * rect's edge, blending back to the untouched height outside it (negative
 * distanceInsideRect drives the smoothstep to 0 automatically — no separate
 * outside-the-rect branch needed).
 */
export function applyPitMask(
  height: number,
  centerHeight: number,
  rect: Rect,
  x: number,
  z: number,
): number {
  const dIn = distanceInsideRect(rect, x, z);
  const w = smoothstep(0, PIT_MASK_MARGIN, dIn);
  const compressed = centerHeight + (height - centerHeight) * PIT_RELIEF_KEEP;
  return height + w * (compressed - height);
}

/** Vertical datum: how far to shift a world-metre height to land it in voxel-Y space. */
export function computeGroundOffset(centerHeight: number, sizeY: number): number {
  return Math.floor(sizeY * 0.55) - Math.round(centerHeight);
}

/** Convert a world-metre height to a clamped, in-range voxel Y using a precomputed datum. */
export function heightToVoxelY(height: number, groundOffset: number, sizeY: number): number {
  return Math.max(1, Math.min(sizeY - 1, Math.round(height + groundOffset)));
}

/**
 * Same shift, without the rounding: the surface's continuous position in
 * voxel-Y space.
 *
 * This is the height the landscape mesher samples, and now also the height
 * generation asks marching cubes to reproduce. Rounding it first is what put
 * the playable surface on 1 m terraces while the landscape beside it stayed
 * smooth — the two representations were reading the same field and then
 * quantizing it differently (#458).
 */
export function heightToVoxelYContinuous(height: number, groundOffset: number, sizeY: number): number {
  return Math.max(1, Math.min(sizeY - 1, height + groundOffset));
}

/**
 * Pull the world's ground into the vertical band the site's voxel grid can
 * actually represent, easing back to the free height field away from it.
 *
 * A voxel grid holds a surface between y = 1 and y = sizeY - 1, and
 * `heightToVoxelYContinuous` clamps every column TerrainGen fills into that
 * band. The landscape beside it has no such limit and never clamped — so on
 * any level whose ground leaves the band (all four of them: the tutorial's
 * north-east corner dips 1.2 m below the floor, and every later level's peaks
 * run 4-10 m through the ceiling) the site rendered a dead-flat plateau or
 * mesa exactly where the world kept rising or falling, and the step between
 * them fell on the site's own rectangle. That is the square a player sees
 * drawn on untouched ground, corner and all (#1077).
 *
 * The clamp itself is not the bug — a grid cannot hold ground it has no
 * voxels for. Disagreeing about it is. So the world takes the same band the
 * site does wherever the site draws (its rect, plus the halo ring), and the
 * band's pull falls off over SITE_BAND_MARGIN metres of open ground, where
 * nothing but the landscape is drawing and the true relief can return. The
 * smoothstep's zero derivative at both ends keeps that fall-off out of the
 * silhouette: no crease anywhere, rather than a straight one on the boundary.
 *
 * `height` is already in voxel-Y space (world height + groundOffset), which is
 * the datum the clamp is defined in.
 */
export function applyPlayableBand(height: number, sizeY: number, rect: Rect, x: number, z: number): number {
  const metresOutside = -distanceInsideRect(rect, x, z);
  const pull = 1 - smoothstep(SITE_BAND_HOLD, SITE_BAND_HOLD + SITE_BAND_MARGIN, metresOutside);
  if (pull <= 0) return height;
  return height + pull * (heightToVoxelYContinuous(height, 0, sizeY) - height);
}

/** Resolves the shaping input to use at a given column — e.g. BiomeCatalog's climate blend. */
export type ShapingAtFn = (x: number, z: number) => ShapingInput;

/** Everything generateTerrain needs to sample surface voxel-Y for every column of one grid. */
export interface WorldGenContext {
  readonly fields: WorldNoiseFields;
  readonly shapingAt: ShapingAtFn;
  readonly playableRect: Rect;
  readonly centerHeight: number;
  readonly groundOffset: number;
  readonly sizeY: number;
}

/**
 * Build the sampling context for one grid: constructs the noise fields once
 * (not per-column), and derives the vertical datum from the height at the
 * rect's centre so the grid gets a sensible amount of digging headroom
 * regardless of what the underlying world height happens to be there.
 *
 * `makeShapingAt` receives the constructed fields (so a caller's shaping
 * function — e.g. one that samples temperature/humidity for a climate
 * blend — can use the exact same fields the height sampler does) and
 * returns the per-column shaping resolver. Defaults to one neutral profile
 * for every column, for callers with no biome concept.
 */
export function createWorldGenContext(
  seed: number,
  sizeX: number,
  sizeY: number,
  sizeZ: number,
  makeShapingAt: (fields: WorldNoiseFields) => ShapingAtFn = () => () => DEFAULT_SHAPING,
): WorldGenContext {
  const fields = new WorldNoiseFields(seed);
  const shapingAt = makeShapingAt(fields);
  const playableRect: Rect = { minX: 0, minZ: 0, maxX: sizeX, maxZ: sizeZ };
  const centerHeight = sampleBaseHeight(fields, sizeX / 2, sizeZ / 2, shapingAt(sizeX / 2, sizeZ / 2));
  const groundOffset = computeGroundOffset(centerHeight, sizeY);
  return { fields, shapingAt, playableRect, centerHeight, groundOffset, sizeY };
}

/** Surface voxel Y for column (x, z), including the pit mask and vertical datum. */
export function sampleSurfaceVoxelY(ctx: WorldGenContext, x: number, z: number): number {
  const raw = sampleBaseHeight(ctx.fields, x, z, ctx.shapingAt(x, z));
  const masked = applyPitMask(raw, ctx.centerHeight, ctx.playableRect, x, z);
  return heightToVoxelY(masked, ctx.groundOffset, ctx.sizeY);
}

/** Continuous (unrounded) surface Y for column (x, z) — the height the mesh should actually land on. */
export function sampleSurfaceHeightY(ctx: WorldGenContext, x: number, z: number): number {
  const raw = sampleBaseHeight(ctx.fields, x, z, ctx.shapingAt(x, z));
  const masked = applyPitMask(raw, ctx.centerHeight, ctx.playableRect, x, z);
  return heightToVoxelYContinuous(masked, ctx.groundOffset, ctx.sizeY);
}
