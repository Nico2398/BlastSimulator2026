// BlastSimulator2026 — shared ore-mass sampler over a sandbox site's interior (#1677, #1682).
//
// Samples ore exactly as the sandbox builds its terrain (64x64 site, datum 17,
// biome-landing climate bias) and reports ore mass per 8x8x8 m block, in total
// and per ore, plus per depth. Used by the depth-progression tests (#1677) and
// the deposit-distribution tests (#1682).

import { expect } from 'vitest';
import { buildTerrainContext, climateBiasLandingOn } from '../../src/core/world/TerrainGen.js';
import { sampleSurfaceHeightY } from '../../src/core/world/WorldGen.js';
import type { BiomeDef } from '../../src/core/world/BiomeCatalog.js';
import { ORE_DENSITY_KG_M3 } from '../../src/core/config/balance.js';

export const SEEDS = [1, 7, 42] as const;
export const SITE = 64;
export const DATUM = 17;
export const INTERIOR_LO = 8;
export const INTERIOR_HI = 56;
export const BLOCK = 8;
export const MAX_DEPTH = 40;
export const BLOCKS_PER_AXIS = (INTERIOR_HI - INTERIOR_LO) / BLOCK;
/** Sample every 2nd voxel on each axis (64 of 512 per block); each sample stands for 8 m3. */
const STRIDE = 2;
const SAMPLE_VOLUME_M3 = STRIDE * STRIDE * STRIDE;

export interface SiteOre {
  /** blockMass[slab][bx * 6 + bz] = total ore kg in that 8x8x8 block. slab = floor(depth / 8). */
  blockMass: number[][];
  /** blockMassByOre[oreId][slab][bx * 6 + bz] = that ore's kg; only ores with nonzero mass appear. */
  blockMassByOre: Record<string, number[][]>;
  /** oreKg[depth][oreId] summed over every sampled interior column. */
  oreKgByDepth: Record<string, number>[];
}

export interface SampleSiteOptions {
  /** Terrain `oreDeposits` switch; undefined = legacy veins. */
  oreDeposits?: boolean;
}

const siteCache = new Map<string, SiteOre>();

/** Samples ore mass by depth over a site's interior, exactly as the sandbox builds its terrain. */
export function sampleSite(biome: BiomeDef, seed: number, options: SampleSiteOptions = {}): SiteOre {
  const key = `${biome.id}:${seed}:${String(options.oreDeposits)}`;
  const cached = siteCache.get(key);
  if (cached) return cached;

  const { worldGen, strata, oreVeins, biome: generated } = buildTerrainContext({
    sizeX: SITE, sizeZ: SITE, datum: DATUM, seed,
    climateBias: climateBiasLandingOn(seed, SITE, SITE, biome),
    ...(options.oreDeposits !== undefined ? { oreDeposits: options.oreDeposits } : {}),
  });
  // The fixture is only meaningful if the site really is the requested biome.
  expect(generated.id).toBe(biome.id);

  const slabs = Math.ceil(MAX_DEPTH / BLOCK);
  const blockCount = BLOCKS_PER_AXIS * BLOCKS_PER_AXIS;
  const blockMass = Array.from({ length: slabs }, () => new Array<number>(blockCount).fill(0));
  const blockMassByOre: Record<string, number[][]> = {};
  const oreKgByDepth: Record<string, number>[] = Array.from({ length: MAX_DEPTH }, () => ({}));

  for (let x = INTERIOR_LO; x < INTERIOR_HI; x += STRIDE) {
    for (let z = INTERIOR_LO; z < INTERIOR_HI; z += STRIDE) {
      const surfaceY = Math.round(sampleSurfaceHeightY(worldGen, x, z));
      const boundaries = strata.boundariesAt(x, z);
      const blockIdx = blockIndexOf(x, z)!;
      for (let depth = 0; depth < MAX_DEPTH; depth += STRIDE) {
        const y = surfaceY - depth;
        const composition = strata.compositionAt(x, y, z, depth, boundaries);
        const ores = oreVeins.densitiesAt(x, y, z, depth, composition, generated.oreRichness);
        const slab = Math.floor(depth / BLOCK);
        for (const [oreId, density] of Object.entries(ores)) {
          const kg = density * SAMPLE_VOLUME_M3 * ORE_DENSITY_KG_M3;
          blockMass[slab]![blockIdx] = (blockMass[slab]![blockIdx] ?? 0) + kg;
          const perOre = (blockMassByOre[oreId] ??= Array.from({ length: slabs }, () => new Array<number>(blockCount).fill(0)));
          perOre[slab]![blockIdx] = (perOre[slab]![blockIdx] ?? 0) + kg;
          oreKgByDepth[depth]![oreId] = (oreKgByDepth[depth]![oreId] ?? 0) + kg;
        }
      }
    }
  }
  const site = { blockMass, blockMassByOre, oreKgByDepth };
  siteCache.set(key, site);
  return site;
}

/** Index into a slab's block array for the block holding world column (x, z); null outside the sampled interior. */
export function blockIndexOf(x: number, z: number): number | null {
  if (x < INTERIOR_LO || x >= INTERIOR_HI || z < INTERIOR_LO || z >= INTERIOR_HI) return null;
  return Math.floor((x - INTERIOR_LO) / BLOCK) * BLOCKS_PER_AXIS + Math.floor((z - INTERIOR_LO) / BLOCK);
}

/** Share (0..1) of blocks holding strictly less than `kg`. */
export function shareBelow(blocks: readonly number[], kg: number): number {
  return blocks.filter(b => b < kg).length / blocks.length;
}

/** Floor under the median so a mostly-barren slab (median ~0) still yields a finite, meaningful ratio: 1 t. */
export const MEDIAN_FLOOR_KG = 1000;

/**
 * Concentration measure: mean mass of the richest ceil(10%) of blocks divided by
 * max(median block mass, MEDIAN_FLOOR_KG). The floor keeps the ratio finite when
 * the median is zero; with it, a slab passes only if its richest decile averages
 * at least 5x the median or at least 5 t.
 */
export function richestDecileOverMedian(blocks: readonly number[]): number {
  const sorted = [...blocks].sort((a, b) => a - b);
  const n = sorted.length;
  const median = n % 2 === 1 ? sorted[(n - 1) / 2]! : (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2;
  const top = sorted.slice(n - Math.ceil(n * 0.1));
  const topMean = top.reduce((s, v) => s + v, 0) / top.length;
  return topMean / Math.max(median, MEDIAN_FLOOR_KG);
}

/** Index of the block with the most mass (first on ties). */
export function argmax(blocks: readonly number[]): number {
  let best = 0;
  for (let i = 1; i < blocks.length; i++) if (blocks[i]! > blocks[best]!) best = i;
  return best;
}

/** For one slab, each ore carrying nonzero mass in it -> the index of that ore's richest block. */
export function peakBlockByOre(site: SiteOre, slab: number): Record<string, number> {
  const peaks: Record<string, number> = {};
  for (const [oreId, bySlab] of Object.entries(site.blockMassByOre)) {
    const blocks = bySlab[slab]!;
    if (blocks.some(kg => kg > 0)) peaks[oreId] = argmax(blocks);
  }
  return peaks;
}
