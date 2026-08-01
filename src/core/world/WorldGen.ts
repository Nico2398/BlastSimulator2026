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

/** Neutral shaping used everywhere until BiomeCatalog supplies per-biome splines (#458 T1.2). */
export const DEFAULT_SHAPING: HeightShapingParams = {
  baseSpline: DEFAULT_BASE_SPLINE,
  reliefSpline: DEFAULT_RELIEF_SPLINE,
  pvAmplitude: DEFAULT_PV_AMPLITUDE,
};

/**
 * Raw world height in metres (sea level = 0) at absolute world (x, z),
 * before the pit-suitability mask. Deterministic and independent of any
 * grid's size — the same (x, z) always yields the same height for a given
 * seed and shaping, regardless of what grid a caller is generating (#458 A4).
 */
export function sampleBaseHeight(
  fields: WorldNoiseFields,
  x: number,
  z: number,
  shaping: HeightShapingParams = DEFAULT_SHAPING,
): number {
  const c = fields.continentalness(x, z);
  const e = fields.erosion(x, z);
  const pv = fields.peaksValleys(x, z);
  const base = evalSpline(shaping.baseSpline, c);
  const relief = evalSpline(shaping.reliefSpline, e);
  return base + relief * shaping.pvAmplitude * (pv - 0.35) + 1.2 * fields.detail(x, z);
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

/** Everything generateTerrain needs to sample surface voxel-Y for every column of one grid. */
export interface WorldGenContext {
  readonly fields: WorldNoiseFields;
  readonly shaping: HeightShapingParams;
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
 */
export function createWorldGenContext(
  seed: number,
  sizeX: number,
  sizeY: number,
  sizeZ: number,
  shaping: HeightShapingParams = DEFAULT_SHAPING,
): WorldGenContext {
  const fields = new WorldNoiseFields(seed);
  const playableRect: Rect = { minX: 0, minZ: 0, maxX: sizeX, maxZ: sizeZ };
  const centerHeight = sampleBaseHeight(fields, sizeX / 2, sizeZ / 2, shaping);
  const groundOffset = computeGroundOffset(centerHeight, sizeY);
  return { fields, shaping, playableRect, centerHeight, groundOffset, sizeY };
}

/** Surface voxel Y for column (x, z), including the pit mask and vertical datum. */
export function sampleSurfaceVoxelY(ctx: WorldGenContext, x: number, z: number): number {
  const raw = sampleBaseHeight(ctx.fields, x, z, ctx.shaping);
  const masked = applyPitMask(raw, ctx.centerHeight, ctx.playableRect, x, z);
  return heightToVoxelY(masked, ctx.groundOffset, ctx.sizeY);
}
