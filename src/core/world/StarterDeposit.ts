// BlastSimulator2026 — Sandbox starter deposit (#2116)
// Every sandbox site (ore deposits on) gets one shallow, close, breakable, sellable deposit placed by
// world-gen, so no seed or biome opens without something to blast and sell. It is terrain, not a
// scripted bonus: a soft weathered-rock pocket carrying real voxel ore, found by a survey like any other.

import {
  STARTER_DEPOSIT_ANCHOR_X, STARTER_DEPOSIT_ANCHOR_Z, STARTER_DEPOSIT_CREW_DISTANCE_M, STARTER_DEPOSIT_CREW_STARTS, STARTER_DEPOSIT_MAX_DISTANCE_M, STARTER_DEPOSIT_MIN_DISTANCE_M, STARTER_DEPOSIT_ORE_CORE_RADIUS_M,
  STARTER_DEPOSIT_ORE_DEPTH_M, STARTER_DEPOSIT_ORE_DENSITY, STARTER_DEPOSIT_POCKET_DEPTH_M,
  STARTER_DEPOSIT_POCKET_RADIUS_M, STARTER_DEPOSIT_EDGE_MARGIN_M, SANDBOX_FLAT_PAD_SIZE, SANDBOX_FLAT_PAD_MAX_SPREAD, ORE_GRADE_SCALE_DEFAULT, VEHICLE_MAX_SLOPE_RATIO,
} from '../config/balance.js';
import { subSeed } from '../math/Hash.js';
import { isStepClimbable, stepClimbRun } from '../nav/NavGrid.js';
import { getAllRocks } from './RockCatalog.js';
import { buildTerrainContext, type TerrainConfig } from './TerrainGen.js';
import { sampleSurfaceHeightY, type WorldGenContext } from './WorldGen.js';
import type { VoxelRockComposition } from './VoxelGrid.js';

/** Where the starter deposit sits and what it holds; x/z are the centre cell, radius the pocket radius in metres. */
export interface StarterDeposit {
  readonly x: number;
  readonly z: number;
  readonly oreId: string;
  readonly radius: number;
}

/** Hole offsets (m) of the 3x3 reference shot around its centre. */
const HOLE_OFFSETS = [-4, 0, 4] as const;
const NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
/**
 * The pocket's ore. It was dirtite or rustite by seed; a dirtite pocket sold for 55% of a rustite one, and the dirtite
 * sites held the sandbox sales/costs low tail (#2126).
 */
const STARTER_ORE = 'rustite';

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

/** Surface voxel Y of a cell, memoised: neighbouring footprints share most of their cells. */
function surfaceYMemo(worldGen: WorldGenContext): (x: number, z: number) => number {
  const memo = new Map<number, number>();
  return (x, z) => {
    const key = x * 65_536 + z;
    let y = memo.get(key);
    if (y === undefined) { y = Math.floor(sampleSurfaceHeightY(worldGen, x, z)); memo.set(key, y); }
    return y;
  };
}

/** Surface height spread (voxels) of the shot footprint centred on (cx, cz). */
function footprintSpread(surfaceY: (x: number, z: number) => number, cx: number, cz: number): number {
  const half = (SANDBOX_FLAT_PAD_SIZE - 1) / 2;
  let lo = Infinity, hi = -Infinity;
  for (let dx = -half; dx <= half; dx++) {
    for (let dz = -half; dz <= half; dz++) {
      const y = surfaceY(cx + dx, cz + dz);
      lo = Math.min(lo, y); hi = Math.max(hi, y);
    }
  }
  return hi - lo;
}

/**
 * Cells a vehicle climbing at its slope limit reaches from the crew corner over the grid, flood-filled on the
 * continuous surface height; keyed like `surfaceYMemo`. Mirrors the nav grid's climb gate without building one.
 */
function reachableFromCrew(worldGen: WorldGenContext, sizeX: number, sizeZ: number, startX: number, startZ: number): Set<number> {
  const height = (x: number, z: number) => sampleSurfaceHeightY(worldGen, x, z);
  const seen = new Set<number>();
  const stack: Array<[number, number]> = [[startX, startZ]];
  seen.add(startX * 65_536 + startZ);
  while (stack.length > 0) {
    const [x, z] = stack.pop()!;
    const h = height(x, z);
    for (const [dx, dz] of NEIGHBOURS) {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= sizeX || nz >= sizeZ || seen.has(nx * 65_536 + nz)) continue;
      if (!isStepClimbable(h, height(nx, nz), stepClimbRun(dx, dz, VEHICLE_MAX_SLOPE_RATIO), VEHICLE_MAX_SLOPE_RATIO)) continue;
      seen.add(nx * 65_536 + nz);
      stack.push([nx, nz]);
    }
  }
  return seen;
}

/** How many sets of `reach` miss a hole cell of the 3x3 reference shot centred on (x, z). */
function unreachableStarts(reach: readonly Set<number>[], x: number, z: number): number {
  let missed = 0;
  for (const r of reach) {
    if (HOLE_OFFSETS.some(dx => HOLE_OFFSETS.some(dz => !r.has((x + dx) * 65_536 + z + dz)))) missed++;
  }
  return missed;
}

/**
 * True when (x, z) lies inside the starting rectangle `[0, sizeX) x [0, sizeZ)` within
 * STARTER_DEPOSIT_EDGE_MARGIN_M of its edge; a cell outside the rectangle is not in the margin.
 * Keeps the pocket off the opening site's edge. Placement only: ore generates there like anywhere else.
 */
export function isInStartingEdgeMargin(x: number, z: number, sizeX: number, sizeZ: number): boolean {
  if (x < 0 || x >= sizeX || z < 0 || z >= sizeZ) return false;
  const m = STARTER_DEPOSIT_EDGE_MARGIN_M;
  return x < m || x >= sizeX - m || z < m || z >= sizeZ - m;
}

/**
 * Pick the deposit for a built site, on the ring STARTER_DEPOSIT_MIN..MAX_DISTANCE_M from the site centre.
 * The starting crew spawns in the corner by the grid origin and the buildings are placed beside its rally
 * flag after generation, so among footprints flat enough to shoot from and climbable from that corner at the vehicle slope limit, the candidate
 * nearest STARTER_DEPOSIT_CREW_DISTANCE_M from that corner wins (seeded tie-break); a site with no flat footprint on the ring takes the flattest one.
 */
export function pickStarterDeposit(config: TerrainConfig, worldGen: WorldGenContext): StarterDeposit | null {
  if (config.oreDeposits !== true) return null;
  const cx = Math.floor(config.sizeX / 2), cz = Math.floor(config.sizeZ / 2);
  const reach = STARTER_DEPOSIT_POCKET_RADIUS_M + 1;
  const surfaceY = surfaceYMemo(worldGen);
  const climbable = STARTER_DEPOSIT_CREW_STARTS.map(([sx, sz]) => reachableFromCrew(worldGen, config.sizeX, config.sizeZ, sx, sz));
  let best: { x: number; z: number; score: number } | null = null;
  const span = STARTER_DEPOSIT_MAX_DISTANCE_M;
  for (let dx = -span; dx <= span; dx++) {
    for (let dz = -span; dz <= span; dz++) {
      const dist = Math.hypot(dx, dz);
      if (dist < STARTER_DEPOSIT_MIN_DISTANCE_M || dist > STARTER_DEPOSIT_MAX_DISTANCE_M) continue;
      const x = cx + dx, z = cz + dz;
      if (isInStartingEdgeMargin(x - reach, z - reach, config.sizeX, config.sizeZ)
        || isInStartingEdgeMargin(x + reach, z + reach, config.sizeX, config.sizeZ)) continue;
      const spread = footprintSpread(surfaceY, x, z);
      const toCrew = Math.hypot(x - STARTER_DEPOSIT_ANCHOR_X, z - STARTER_DEPOSIT_ANCHOR_Z);
      // Flat footprints rank by distance to the crew corner; any unflat one ranks behind every flat one.
      const score = (spread <= SANDBOX_FLAT_PAD_MAX_SPREAD ? 0 : 1e6 * spread) + 1e4 * unreachableStarts(climbable, x, z)
        + Math.abs(toCrew - STARTER_DEPOSIT_CREW_DISTANCE_M) + cellJitter(config.seed, x, z);
      if (!best || score < best.score) best = { x, z, score };
    }
  }
  if (!best) return null;
  return { x: best.x, z: best.z, oreId: STARTER_ORE, radius: STARTER_DEPOSIT_POCKET_RADIUS_M };
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
