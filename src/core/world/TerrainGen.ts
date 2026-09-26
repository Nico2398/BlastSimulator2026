// BlastSimulator2026 — Procedural terrain generation
// Populates a VoxelGrid from the unified world height sampler (WorldGen.ts),
// a depth-stratified rock profile (Strata.ts) and per-ore anisotropic vein
// noise (OreVeins.ts).

import { VoxelGrid, surfaceDensityAt, MAX_TERRAIN_GEN_DIMENSION, type VoxelChunkSource } from './VoxelGrid.js';
import type { BiomeDef } from './BiomeCatalog.js';
import { selectBiomeWeights, dominantBiome, biomeShaping } from './BiomeCatalog.js';
import { createWorldGenContext, sampleSurfaceHeightY, type WorldGenContext } from './WorldGen.js';
import { buildStrataProfile, buildMixedHardnessStrata, StrataSampler } from './Strata.js';
import { OreVeinSampler } from './OreVeins.js';

/**
 * Version of the terrain generator's algorithm — stamped into every save's
 * embedded terrain identity (`SerializedTerrainGen.version`) and checked on
 * load. The game is unreleased: this stays 1 and is never incremented for a
 * pre-release generator change (project owner policy, #1181). A save whose
 * terrain generator version does not match this constant is refused, never
 * migrated.
 */
export const TERRAIN_GENERATOR_VERSION = 1;

/**
 * Re-exported from `VoxelGrid.ts` (a lower-level module this file already
 * depends on) rather than declared here, so this ceiling stays the single
 * constant `VoxelGrid`'s `isInBounds`/`forEachSolid`/etc. actually bound `y`
 * against, instead of a second hardcoded literal here (#1190 review).
 */
export { MAX_TERRAIN_GEN_DIMENSION };

/**
 * A `sizeX`/`sizeZ`/`datum` read from untrusted save JSON must describe a
 * grid the rest of generation can actually build: an unvalidated, enormous
 * value (e.g. `1e9`) turns a downstream `yLo..yHi` replay loop unbounded, or
 * crashes `VoxelGrid`'s `allocateChunk` with a raw `RangeError: Invalid
 * typed array length` before any check runs at all (#1181 review, both
 * reproduced live). Shared by every caller that decodes a size field off a
 * save — `VoxelGridCodec.decodeVoxelGrid`'s embedded generator identity and
 * `world.ts`'s no-voxels regenerate fallback (#1218) — so the formula and the
 * message live in one place rather than two independently-written copies.
 * Rejects outright rather than clamping: silently shrinking a save's
 * declared world size would regenerate a different terrain than the one
 * that was actually saved.
 */
export function requireValidGenDimension(value: number, label: string): number {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0 || value > MAX_TERRAIN_GEN_DIMENSION) {
    throw new Error(`corrupt save: ${label} (${value}) is not a valid terrain dimension`);
  }
  return value;
}

export interface TerrainConfig {
  sizeX: number;
  /** The voxel Y the site centre's surface lands on. */
  datum: number;
  sizeZ: number;
  seed: number;
  /**
   * Bias added to the raw climate fields so this grid's own terrain lands
   * near a specific biome's climate centre (#458 T1.2/A6) — [0, 0] samples
   * the world's natural, unbiased climate. A level authors this to land its
   * intended biome; a standalone `new_game biome:X` resolves X's own
   * climateCenter and passes that directly.
   */
  climateBias: readonly [number, number];
  /**
   * Interleaves hard/soft rock layers when true: swaps the biome's normal
   * soft-to-hard strata gradient for alternating ~5 m bands of its softest
   * and hardest dominant rock (#458 D4/T1.3/A11).
   */
  mixedRockHardness?: boolean;
}

export interface TerrainContext {
  worldGen: WorldGenContext;
  biome: BiomeDef;
  strata: StrataSampler;
  oreVeins: OreVeinSampler;
}

/**
 * Builds everything generateTerrain needs from one config: the world height
 * sampler, the grid's single dominant biome, and its strata/ore samplers.
 * Exported (not just internal to generateTerrain) so a caller building the
 * landscape map alongside the playable grid (#458 T2.1) can reconstruct an
 * equivalent context from the same config — determinism guarantees it
 * produces byte-identical sampling to what generateTerrain used internally,
 * without the two needing to share object references (unlike the palette,
 * which genuinely must be the same instance — see LandscapeMap.ts).
 */
export function buildTerrainContext(config: TerrainConfig): TerrainContext {
  const { sizeX, datum, sizeZ, seed, climateBias, mixedRockHardness } = config;

  const worldGen = createWorldGenContext(seed, sizeX, datum, sizeZ, (fields) => (x, z) => {
    const weights = selectBiomeWeights(fields.temperature(x, z), fields.humidity(x, z), climateBias, 1.0);
    return weights.map(w => ({ shaping: biomeShaping(w.biome), weight: w.weight }));
  });

  const centerBiomeWeights = selectBiomeWeights(
    worldGen.fields.temperature(sizeX / 2, sizeZ / 2),
    worldGen.fields.humidity(sizeX / 2, sizeZ / 2),
    climateBias,
    1.0,
  );
  const biome = dominantBiome(centerBiomeWeights);

  const profile = mixedRockHardness
    ? buildMixedHardnessStrata(biome.dominantRocks)
    : buildStrataProfile(biome.dominantRocks);
  const strata = new StrataSampler(seed, profile);
  const oreVeins = new OreVeinSampler(seed);

  return { worldGen, biome, strata, oreVeins };
}

export { surfaceDensityAt };

/**
 * Fill one column (x, z) of `grid` within `[yLo, yHi]` (inclusive) from the
 * sampling context, via `VoxelGrid.writeGeneratedVoxel` — this is generator
 * output, not a gameplay edit (#1183). Pure in (config, x, z, yLo, yHi) —
 * see #473 D3. Depth-unbounded: `strata.compositionAt`/`oreVeins.densitiesAt`
 * are well-defined for any `y`, including deeply negative, so this never
 * needs a "top of the world" bound the way the pre-#1183 whole-column fill
 * did.
 */
function generateColumnRange(
  grid: VoxelGrid,
  terrain: TerrainContext,
  config: TerrainConfig,
  x: number,
  z: number,
  yLo: number,
  yHi: number,
): void {
  const { worldGen, biome, strata, oreVeins } = terrain;
  const { sizeX, sizeZ } = config;

  const surfaceH = sampleSurfaceHeightY(worldGen, x, z);
  const surfaceY = Math.round(surfaceH);
  const boundaries = strata.boundariesAt(x, z);
  const inBorder = isInBorderZone(x, z, sizeX, sizeZ, biome.borderWidth);

  for (let y = yLo; y <= yHi; y++) {
    const density = surfaceDensityAt(y, surfaceH);
    if (density <= 0) continue;

    // Depth is still measured from the rounded surface, so which stratum a
    // voxel belongs to is unchanged by the sub-voxel surface placement.
    const depth = Math.max(0, surfaceY - y);
    const composition = strata.compositionAt(x, y, z, depth, boundaries);
    const compId = grid.palette.intern(composition);
    const oreDensities = inBorder ? {} : oreVeins.densitiesAt(x, y, z, depth, composition, biome.oreRichness);

    grid.writeGeneratedVoxel(x, y, z, compId, oreDensities, density);
  }
}

/**
 * Generate terrain into a new VoxelGrid.
 * Algorithm:
 *   1. Sample surface height per (x, z) from the unified world generator (WorldGen.ts, #458 T1.1),
 *      climate-blended across biomes (BiomeCatalog.ts, #458 T1.2) — the same sampler the landscape
 *      heightmap reads from (LandscapeMap.ts, #458 T2.1), so the two representations cannot disagree
 *      at their shared boundary.
 *   2. Fill voxels below surface from a depth-stratified rock profile (Strata.ts, #458 T1.3/A11)
 *   3. Distribute ore veins using per-ore anisotropic noise (OreVeins.ts, #458 T1.3/A12)
 *   4. Clear border zone of ores (neutral zone)
 *
 * Height blends every biome's shaping by climate weight, evaluated per
 * column — a real gradient at a climate transition, not a seam. Rock/ore
 * generation (steps 2-4) still uses ONE dominant biome for the whole grid
 * (the highest-weighted biome at the grid's own centre) rather than
 * blending per column — full per-column biome-blended strata is out of
 * scope for T1.3 (no accept criterion calls for it) and would belong to a
 * future landscape-blending task if ever needed.
 *
 * Registers ownership of `[0, sizeX) × [0, sizeZ)` and attaches this config's
 * `VoxelChunkSource`, but does NOT fill any voxel content up front (#1183) —
 * only chunks a caller actually reads get materialized, lazily, from the
 * attached source.
 */
export function generateTerrain(config: TerrainConfig): VoxelGrid {
  const { sizeX, sizeZ } = config;
  const grid = new VoxelGrid(sizeX, sizeZ);
  const terrain = buildTerrainContext(config);
  grid.attachChunkSource(createChunkSource(terrain, config));
  return grid;
}

/**
 * Build a `VoxelChunkSource` that materializes chunk slabs from `terrain`
 * (the same sampling context `generateColumnRange` uses) via
 * `VoxelGrid.writeGeneratedVoxel`, rather than filling a whole grid up front
 * (#1183). `config` must be the level's original config — its sizeX/sizeZ fix
 * the pit mask's rect and the vertical datum, so a chunk claimed hours into a
 * game generates against the same world the level started from.
 */
export function createChunkSource(terrain: TerrainContext, config: TerrainConfig): VoxelChunkSource {
  return {
    surfaceHeightAt(x: number, z: number): number {
      return sampleSurfaceHeightY(terrain.worldGen, x, z);
    },
    materializeSlab(grid: VoxelGrid, x0: number, x1: number, z0: number, z1: number, cy: number): void {
      const yLo = cy * VoxelGrid.CHUNK_SIZE;
      const yHi = yLo + VoxelGrid.CHUNK_SIZE - 1;
      for (let z = z0; z < z1; z++) {
        for (let x = x0; x < x1; x++) {
          generateColumnRange(grid, terrain, config, x, z, yLo, yHi);
        }
      }
    },
  };
}

/**
 * Check if a position is in the neutral border zone. Exported so
 * `tests/helpers/terrainFingerprint.ts`'s fingerprint can classify a sampled
 * column the same way generation itself does, rather than reimplementing
 * this predicate a second time (#1190 review).
 */
export function isInBorderZone(
  x: number, z: number,
  sizeX: number, sizeZ: number,
  borderWidth: number,
): boolean {
  return x < borderWidth || x >= sizeX - borderWidth
    || z < borderWidth || z >= sizeZ - borderWidth;
}
