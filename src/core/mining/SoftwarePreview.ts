// BlastSimulator2026 — shared per-voxel/per-hole prediction shape used by
// every Software.ts preview tier (energy, fragmentation, projection, per-hole
// detail). Extracted so the tier-gated preview functions in Software.ts each
// call one shared computation instead of repeating it.

import type { BlastPlan } from './BlastPlan.js';
import type { VoxelGrid, VoxelData } from '../world/VoxelGrid.js';
import { getDominantRockId } from '../world/VoxelGrid.js';
import { getRock, type RockType } from '../world/RockCatalog.js';
import { SOLID_VOXEL_DENSITY_THRESHOLD, SEEDS_BASE, SEEDS_PER_INTENSITY, MAX_SEEDS_PER_VOXEL, FRAGMENTATION_MULTIPLIER } from '../config/balance.js';
import { type EnergyField, effectiveAt, thresholdAt, intensityAt } from './EnergyPropagation.js';

export const PREVIEW_RADIUS = 5;

export interface HoleContext {
  holeDepths: Record<string, number>;
  holeSurfaceYs: Record<string, number>;
}

/** Precompute per-hole depth and surface Y lookups shared by every preview pass. */
export function computeHoleContext(plan: BlastPlan, grid: VoxelGrid): HoleContext {
  const holeDepths: Record<string, number> = {};
  for (const hole of plan.holes) holeDepths[hole.id] = hole.depth;
  return { holeDepths, holeSurfaceYs: getHoleSurfaceYs(plan, grid) };
}

export interface VoxelEnergyThreshold {
  rock: RockType;
  /** Energy the voxel retained — what breaks it. */
  energy: number;
  /** What its rock can absorb before giving way. */
  threshold: number;
  /** Total energy through the voxel over its threshold; 1.0 is a clean break. */
  intensity: number;
}

/**
 * Read one voxel's prediction out of the propagated field.
 *
 * The field is the same one the blast itself runs on, so a prediction can only
 * disagree with the result if the player changes the plan — never because the
 * tools model the rock differently from the game.
 *
 * Returns null for voxels with no resolvable rock.
 */
export function readVoxelPrediction(
  field: EnergyField,
  voxel: VoxelData,
  x: number,
  y: number,
  z: number,
): VoxelEnergyThreshold | null {
  const rock = getRock(getDominantRockId(voxel.composition));
  if (!rock) return null;
  return {
    rock,
    energy: effectiveAt(field, x, y, z),
    threshold: thresholdAt(field, x, y, z),
    intensity: intensityAt(field, x, y, z),
  };
}

/**
 * Predicted number of pieces a voxel breaks into, and how big each is.
 *
 * Mirrors the seeding rule fragment generation uses, minus its randomness, so
 * the number shown is the average of what the blast will actually produce.
 */
export function predictFragmentation(intensity: number): { pieces: number; sizeM3: number } {
  if (intensity < FRAGMENTATION_MULTIPLIER) return { pieces: 0, sizeM3: 1 };
  const seeds = Math.min(
    MAX_SEEDS_PER_VOXEL,
    SEEDS_BASE + SEEDS_PER_INTENSITY * (intensity - FRAGMENTATION_MULTIPLIER),
  );
  // Below one seed per voxel the rock joins a neighbouring fragment, so the
  // piece coming out is larger than the voxel it was measured in.
  const pieces = Math.max(seeds, 0.01);
  return { pieces, sizeM3: 1 / pieces };
}

/** Compute surface Y for each hole by scanning the column from top to bottom. */
export function getHoleSurfaceYs(plan: BlastPlan, grid: VoxelGrid): Record<string, number> {
  const result: Record<string, number> = {};
  for (const hole of plan.holes) {
    const gx = Math.max(0, Math.min(grid.sizeX - 1, Math.floor(hole.x)));
    const gz = Math.max(0, Math.min(grid.sizeZ - 1, Math.floor(hole.z)));
    let surfaceY = 0;
    for (let y = grid.sizeY - 1; y >= 0; y--) {
      const v = grid.getVoxel(gx, y, gz);
      if (v && v.density >= SOLID_VOXEL_DENSITY_THRESHOLD) { surfaceY = y + 1; break; }
    }
    result[hole.id] = surfaceY;
  }
  return result;
}

export interface BlastBBox {
  minX: number; maxX: number;
  minY: number; maxY: number;
  minZ: number; maxZ: number;
}

/**
 * Walk every voxel inside `bbox`, skipping empty ones, calling `fn` once per
 * filled voxel. Shared by every preview pass that scans the blast zone
 * (previewEnergy, previewFragments, previewProjections) so the tier-gating
 * functions in Software.ts differ only in what they do per voxel, not in
 * how they iterate.
 */
export function forEachBBoxVoxel(
  grid: VoxelGrid,
  bbox: BlastBBox,
  fn: (x: number, y: number, z: number, voxel: VoxelData) => void,
): void {
  for (let z = bbox.minZ; z <= bbox.maxZ; z++) {
    for (let y = bbox.minY; y <= bbox.maxY; y++) {
      for (let x = bbox.minX; x <= bbox.maxX; x++) {
        const voxel = grid.getVoxel(x, y, z);
        if (!voxel || voxel.density <= 0) continue;
        fn(x, y, z, voxel);
      }
    }
  }
}

/**
 * Bounds the blast zone in voxel space. Reuses `ctx.holeSurfaceYs` (already
 * computed by {@link computeHoleContext}, which every caller invokes right
 * before this) instead of rescanning each hole's column a second time.
 */
export function getBlastBBox(plan: BlastPlan, ctx: HoleContext): BlastBBox {
  let minX = Infinity, maxX = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  let maxSurfaceY = 0;
  let maxDepth = 0;
  for (const h of plan.holes) {
    minX = Math.min(minX, h.x);
    maxX = Math.max(maxX, h.x);
    minZ = Math.min(minZ, h.z);
    maxZ = Math.max(maxZ, h.z);
    maxDepth = Math.max(maxDepth, h.depth);
    maxSurfaceY = Math.max(maxSurfaceY, ctx.holeSurfaceYs[h.id] ?? 0);
  }
  return {
    minX: Math.floor(minX - PREVIEW_RADIUS),
    maxX: Math.ceil(maxX + PREVIEW_RADIUS),
    minY: Math.max(0, Math.floor(maxSurfaceY - maxDepth - PREVIEW_RADIUS)),
    maxY: Math.ceil(maxSurfaceY + PREVIEW_RADIUS),
    minZ: Math.floor(minZ - PREVIEW_RADIUS),
    maxZ: Math.ceil(maxZ + PREVIEW_RADIUS),
  };
}
