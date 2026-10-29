// BlastSimulator2026 — Sandbox starter deposit (#2116)
// Every sandbox site (ore deposits on) gets one shallow, close, breakable, sellable deposit placed by
// world-gen, so no seed or biome opens without something to blast and sell. It is terrain, not a
// scripted bonus: a soft weathered-rock pocket carrying real voxel ore, found by a survey like any other.

import {
  STARTER_DEPOSIT_MAX_DISTANCE_M, STARTER_DEPOSIT_MIN_DISTANCE_M, STARTER_DEPOSIT_ORE_CORE_RADIUS_M,
  STARTER_DEPOSIT_ORE_DEPTH_M, STARTER_DEPOSIT_ORE_DENSITY, STARTER_DEPOSIT_POCKET_DEPTH_M,
  STARTER_DEPOSIT_POCKET_RADIUS_M, SANDBOX_FLAT_PAD_SIZE, ORE_GRADE_SCALE_DEFAULT,
} from '../config/balance.js';
import { subSeed } from '../math/Hash.js';
import { getAllRocks } from './RockCatalog.js';
import { buildTerrainContext, isInBorderZone, type TerrainConfig } from './TerrainGen.js';
import { sampleSurfaceHeightY, type WorldGenContext } from './WorldGen.js';
import type { VoxelRockComposition } from './VoxelGrid.js';

/** Where the starter deposit sits and what it holds; x/z are the centre cell, radius the pocket radius in metres. */
export interface StarterDeposit {
  readonly x: number;
  readonly z: number;
  readonly oreId: string;
  readonly radius: number;
}

/** Cell step of the candidate scan and of the footprint height sampling, in metres. */
const SCAN_STEP_M = 2;
const STARTER_ORES = ['dirtite', 'rustite'] as const;

/** The softest rock of the catalog: the pocket's weathered host. */
function softestRockId(): string {
  let best = getAllRocks()[0]!;
  for (const r of getAllRocks()) if (r.energyAbsorption < best.energyAbsorption) best = r;
  return best.id;
}

/** Hash of a cell to [0, 1), seeded per site. */
function cellJitter(seed: number, x: number, z: number): number {
  return (subSeed(seed, `starter:${x}:${z}`) % 10_000) / 10_000;
}

/** Surface height spread (voxels) of the shot footprint centred on (cx, cz). */
function footprintSpread(worldGen: WorldGenContext, cx: number, cz: number): number {
  const half = (SANDBOX_FLAT_PAD_SIZE - 1) / 2;
  let lo = Infinity, hi = -Infinity;
  for (let dx = -half; dx <= half; dx += SCAN_STEP_M) {
    for (let dz = -half; dz <= half; dz += SCAN_STEP_M) {
      const y = Math.round(sampleSurfaceHeightY(worldGen, cx + dx, cz + dz));
      lo = Math.min(lo, y); hi = Math.max(hi, y);
    }
  }
  return hi - lo;
}

/**
 * Pick the deposit for a built site: the flattest footprint on the ring
 * STARTER_DEPOSIT_MIN..MAX_DISTANCE_M from the site centre, seeded tie-break.
 * The starting buildings are placed after generation near the same centre, so the ring anchors there.
 */
export function pickStarterDeposit(
  config: TerrainConfig, worldGen: WorldGenContext, borderWidth: number,
): StarterDeposit | null {
  if (config.oreDeposits !== true) return null;
  const cx = Math.floor(config.sizeX / 2), cz = Math.floor(config.sizeZ / 2);
  const reach = STARTER_DEPOSIT_POCKET_RADIUS_M + 1;
  let best: { x: number; z: number; score: number } | null = null;
  const span = STARTER_DEPOSIT_MAX_DISTANCE_M;
  for (let dx = -span; dx <= span; dx += SCAN_STEP_M) {
    for (let dz = -span; dz <= span; dz += SCAN_STEP_M) {
      const dist = Math.hypot(dx, dz);
      if (dist < STARTER_DEPOSIT_MIN_DISTANCE_M || dist > STARTER_DEPOSIT_MAX_DISTANCE_M) continue;
      const x = cx + dx, z = cz + dz;
      if (isInBorderZone(x - reach, z - reach, config.sizeX, config.sizeZ, borderWidth)
        || isInBorderZone(x + reach, z + reach, config.sizeX, config.sizeZ, borderWidth)) continue;
      const score = footprintSpread(worldGen, x, z) + cellJitter(config.seed, x, z);
      if (!best || score < best.score) best = { x, z, score };
    }
  }
  if (!best) return null;
  const oreId = STARTER_ORES[subSeed(config.seed, 'starter:ore') % STARTER_ORES.length]!;
  return { x: best.x, z: best.z, oreId, radius: STARTER_DEPOSIT_POCKET_RADIUS_M };
}

/** The starter deposit of a site, or null when the site has ore deposits off (campaign levels). */
export function resolveStarterDeposit(config: TerrainConfig): StarterDeposit | null {
  return config.oreDeposits === true ? buildTerrainContext(config).starterDeposit : null;
}

/** What the pocket writes at one voxel: its weathered host rock and its fixed ore density. */
interface StarterPocketVoxel {
  readonly composition: VoxelRockComposition;
  readonly oreDensities: Record<string, number>;
}

let weatheredRockId: string | undefined;

/**
 * The pocket's content at a voxel `depth` metres below the surface of column (x, z), or null
 * outside the pocket. Ore density is the fixed profile scaled by the site's ore grade scale.
 */
export function starterPocketAt(
  deposit: StarterDeposit, x: number, z: number, depth: number, gradeScale: number = ORE_GRADE_SCALE_DEFAULT,
): StarterPocketVoxel | null {
  const d = Math.hypot(x - deposit.x, z - deposit.z);
  if (d > deposit.radius || depth > STARTER_DEPOSIT_POCKET_DEPTH_M) return null;
  weatheredRockId ??= softestRockId();
  const composition = { rocks: [{ rockId: weatheredRockId, coefficient: 1 }] };
  const hasOre = d <= STARTER_DEPOSIT_ORE_CORE_RADIUS_M && depth <= STARTER_DEPOSIT_ORE_DEPTH_M;
  return { composition, oreDensities: hasOre ? { [deposit.oreId]: STARTER_DEPOSIT_ORE_DENSITY * gradeScale } : {} };
}
