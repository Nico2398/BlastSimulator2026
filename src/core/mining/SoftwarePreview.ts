// BlastSimulator2026 — shared per-voxel/per-hole prediction shape used by
// every Software.ts preview tier (energy, fragmentation, projection, per-hole
// detail). Extracted so the tier-gated preview functions in Software.ts each
// call one shared computation instead of repeating it.

import { type BlastPlan, hasChargedHole } from './BlastPlan.js';
import type { DrillHole } from './DrillPlan.js';
import type { VoxelGrid, VoxelData } from '../world/VoxelGrid.js';
import { getDominantRockId, firstEmptyLayerAboveGround, clampToGridColumn } from '../world/VoxelGrid.js';
import { getRock, type RockType } from '../world/RockCatalog.js';
import {
  SEEDS_BASE, SEEDS_PER_INTENSITY, MAX_SEEDS_PER_VOXEL, FRAGMENTATION_MULTIPLIER,
  RECOMMENDED_GOOD_SHARE_MIN, RECOMMENDED_SWEEP_STEPS,
} from '../config/balance.js';
import { getExplosive } from '../world/ExplosiveCatalog.js';
import { type HoleCharge, holeSpacingM, holePowderFactors, maxFittingChargeKg } from './ChargePlan.js';
import { type EnergyField, effectiveAt, thresholdAt, intensityAt } from './EnergyPropagation.js';
import { type FragmentationBand, FRAGMENTATION_BANDS, classifyFragmentationBand } from './FragmentationBand.js';
import { buildPlanEnergyField } from './BlastExecution.js';

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

/** Compute surface Y for each hole — first empty layer above ground (#1184). */
export function getHoleSurfaceYs(plan: BlastPlan, grid: VoxelGrid): Record<string, number> {
  const result: Record<string, number> = {};
  for (const hole of plan.holes) {
    const { cx, cz } = clampToGridColumn(grid, hole.x, hole.z);
    result[hole.id] = firstEmptyLayerAboveGround(grid, cx, cz);
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
  let maxSurfaceY = -Infinity;
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
    minY: Math.floor(maxSurfaceY - maxDepth - PREVIEW_RADIUS),
    maxY: Math.ceil(maxSurfaceY + PREVIEW_RADIUS),
    minZ: Math.floor(minZ - PREVIEW_RADIUS),
    maxZ: Math.ceil(maxZ + PREVIEW_RADIUS),
  };
}

/** One filled voxel of the plan's blast box with the intensity the blast would give it and its band (#2200). */
export interface PlanBandCell {
  x: number;
  y: number;
  z: number;
  intensity: number;
  band: FragmentationBand;
}

/** Every filled voxel of the plan's blast box, keyed `x,y,z`. Empty when nothing is charged. */
export interface PlanBandMap {
  bbox: BlastBBox;
  cells: ReadonlyMap<string, PlanBandCell>;
}

/**
 * The fragmentation bands the plan would produce, read from the blast's own energy field.
 * Needs no software tier (#2200).
 */
export function previewPlanBands(plan: BlastPlan, grid: VoxelGrid, wetHoleIds: ReadonlySet<string> = new Set()): PlanBandMap {
  const cells = new Map<string, PlanBandCell>();
  const ctx = computeHoleContext(plan, grid);
  const bbox = getBlastBBox(plan, ctx);
  const field = hasChargedHole(plan) ? buildPlanEnergyField(plan, grid, wetHoleIds) : null;
  if (!field) return { bbox, cells };
  forEachBBoxVoxel(grid, bbox, (x, y, z) => {
    const intensity = intensityAt(field, x, y, z);
    cells.set(`${x},${y},${z}`, { x, y, z, intensity, band: classifyFragmentationBand(intensity) });
  });
  return { bbox, cells };
}

/** Share of a rock cell in each fragmentation band; sums to 1 (#2203). */
export type BandShares = Record<FragmentationBand, number>;

/** Band shares of each hole's rock cell, keyed by hole id. Holes with no rock in their cell are omitted (#2203). */
export function holeBandMixes(map: PlanBandMap, holes: readonly DrillHole[]): Record<string, BandShares> {
  const out: Record<string, BandShares> = {};
  for (const [id, { counts, total }] of holeCellCounts(map, holes)) if (total > 0) out[id] = toShares(counts, total);
  return out;
}

type BandCounts = Record<FragmentationBand, number>;

function emptyCounts(): BandCounts {
  return { intact: 0, cracked: 0, good: 0, fines: 0, dust: 0 };
}

function toShares(counts: BandCounts, total: number): BandShares {
  const out = emptyCounts();
  for (const b of FRAGMENTATION_BANDS) out[b] = counts[b] / total;
  return out;
}

/** A hole's footprint: its column and half its spacing. */
interface HoleCell { cx: number; cz: number; half: number }

/** Nearest hole (Chebyshev distance in columns) whose half-spacing reaches column (x, z); null when none does. */
export function ownerHoleOf<T extends HoleCell>(x: number, z: number, cells: readonly T[]): T | null {
  let owner: T | null = null;
  let best = Infinity;
  for (const c of cells) {
    const d = Math.max(Math.abs(x - c.cx), Math.abs(z - c.cz));
    if (d < best && d <= c.half) { best = d; owner = c; }
  }
  return owner;
}

/** Band counts of each hole's rock cell: nearest hole by column, within half its spacing, one hole depth below the column's top. */
function holeCellCounts(map: PlanBandMap, holes: readonly DrillHole[]): Map<string, { counts: BandCounts; total: number }> {
  const columnTop = new Map<string, number>();
  for (const c of map.cells.values()) {
    const key = `${c.x},${c.z}`;
    const top = columnTop.get(key);
    if (top === undefined || c.y > top) columnTop.set(key, c.y);
  }
  const info = holes.map(h => {
    const cx = Math.floor(h.x);
    const cz = Math.floor(h.z);
    return { hole: h, cx, cz, half: holeSpacingM(h, holes) / 2, top: columnTop.get(`${cx},${cz}`) };
  }).filter(h => h.top !== undefined);
  const out = new Map<string, { counts: BandCounts; total: number }>();
  for (const c of map.cells.values()) {
    const owner = ownerHoleOf(c.x, c.z, info);
    if (!owner || owner.top === undefined) continue;
    if (c.y > owner.top || c.y <= owner.top - owner.hole.depth) continue;
    let entry = out.get(owner.hole.id);
    if (!entry) out.set(owner.hole.id, entry = { counts: emptyCounts(), total: 0 });
    entry.counts[c.band]++;
    entry.total++;
  }
  return out;
}

/** Band shares of all holes' cells pooled; null when no hole has rock in its cell (#2203). */
export function planBandShares(map: PlanBandMap, holes: readonly DrillHole[]): BandShares | null {
  const pooled = emptyCounts();
  let total = 0;
  for (const entry of holeCellCounts(map, holes).values()) {
    for (const b of FRAGMENTATION_BANDS) pooled[b] += entry.counts[b];
    total += entry.total;
  }
  return total > 0 ? toShares(pooled, total) : null;
}

/** Powder factors (kg/m3) at which a hole's rock is mostly good fragmentation (#2203). */
export interface PowderFactorRange {
  minKgPerM3: number;
  maxKgPerM3: number;
}

/** A plan charging every hole with `amountKg` of the explosive (capped to what fits the hole) under `stemmingM` (#2203). */
export function uniformChargePlan(
  holes: readonly DrillHole[],
  explosiveId: string,
  amountKg: number,
  stemmingM: number,
): BlastPlan {
  const charges: Record<string, HoleCharge> = {};
  for (const h of holes) {
    const fit = maxFittingChargeKg(h.depth, stemmingM, h.diameter);
    charges[h.id] = { explosiveId, amountKg: Math.min(amountKg, fit), stemmingM };
  }
  return { holes: [...holes], charges };
}

/** Pooled band shares the explosive would give the pattern at `amountKg`; null with no holes or no rock (#2203). */
export function previewExplosiveBandShares(
  holes: readonly DrillHole[],
  grid: VoxelGrid,
  explosiveId: string,
  amountKg: number,
  stemmingM: number,
  wetHoleIds: ReadonlySet<string> = new Set(),
): BandShares | null {
  if (holes.length === 0) return null;
  const plan = uniformChargePlan(holes, explosiveId, amountKg, stemmingM);
  return planBandShares(previewPlanBands(plan, grid, wetHoleIds), holes);
}

/** Per hole, the powder-factor range that makes its rock mostly good fragmentation with this explosive; null when none does (#2203). */
export function recommendedPowderFactors(
  holes: readonly DrillHole[],
  grid: VoxelGrid,
  explosiveId: string,
  stemmingM: number,
  wetHoleIds: ReadonlySet<string> = new Set(),
): Record<string, PowderFactorRange | null> {
  const out: Record<string, PowderFactorRange | null> = {};
  // Per hole: powder factor and good share at each swept fraction of the heaviest charge that fits it.
  const samples: Record<string, { pf: number; good: number }[]> = {};
  for (const h of holes) { out[h.id] = null; samples[h.id] = []; }
  if (holes.length === 0 || !getExplosive(explosiveId)) return out;
  for (let i = 1; i <= RECOMMENDED_SWEEP_STEPS; i++) {
    const charges: Record<string, HoleCharge> = {};
    for (const h of holes) {
      const amountKg = maxFittingChargeKg(h.depth, stemmingM, h.diameter) * (i / RECOMMENDED_SWEEP_STEPS);
      charges[h.id] = { explosiveId, amountKg, stemmingM };
    }
    const mixes = holeBandMixes(previewPlanBands({ holes: [...holes], charges }, grid, wetHoleIds), holes);
    const pfs = holePowderFactors(holes, charges);
    for (const h of holes) {
      const mix = mixes[h.id];
      if (mix) samples[h.id]!.push({ pf: pfs[h.id] ?? 0, good: mix.good });
    }
  }
  for (const h of holes) {
    const list = samples[h.id]!;
    let best = -1;
    for (let i = 0; i < list.length; i++) if (best < 0 || list[i]!.good > list[best]!.good) best = i;
    if (best < 0 || list[best]!.good < RECOMMENDED_GOOD_SHARE_MIN) continue;
    let lo = best;
    let hi = best;
    while (lo > 0 && list[lo - 1]!.good >= RECOMMENDED_GOOD_SHARE_MIN) lo--;
    while (hi < list.length - 1 && list[hi + 1]!.good >= RECOMMENDED_GOOD_SHARE_MIN) hi++;
    out[h.id] = { minKgPerM3: list[lo]!.pf, maxKgPerM3: list[hi]!.pf };
  }
  return out;
}
