// BlastSimulator2026 — Procedural terrain generation
// Populates a VoxelGrid from the unified world height sampler (WorldGen.ts),
// a depth-stratified rock profile (Strata.ts) and per-ore anisotropic vein
// noise (OreVeins.ts).

import { VoxelGrid } from './VoxelGrid.js';
import type { BiomeDef } from './BiomeCatalog.js';
import { selectBiomeWeights, dominantBiome, biomeShaping } from './BiomeCatalog.js';
import { createWorldGenContext, sampleSurfaceHeightY, type WorldGenContext } from './WorldGen.js';
import { buildStrataProfile, buildMixedHardnessStrata, StrataSampler } from './Strata.js';
import { OreVeinSampler } from './OreVeins.js';

export interface TerrainConfig {
  sizeX: number;
  sizeY: number;
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
  const { sizeX, sizeY, sizeZ, seed, climateBias, mixedRockHardness } = config;

  const worldGen = createWorldGenContext(seed, sizeX, sizeY, sizeZ, (fields) => (x, z) => {
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
 */
/**
 * Half-width, in voxels, of the band over which density falls from solid to
 * air across the surface.
 *
 * One full voxel either side. A narrower band would need a density below zero
 * on the air side to keep the crossing linear, and densities are clamped to
 * [0, 1] — the crossing would then bend and the surface would drift off the
 * height it is supposed to sit on.
 */
const SURFACE_BAND_HALF = 1;

/**
 * Density for voxel `y` in a column whose surface sits at continuous height
 * `surfaceH`, chosen so marching cubes puts its iso-surface exactly there.
 *
 * Marching cubes finds the 0.5 crossing by interpolating linearly between two
 * corner densities, so a field that is linear in y with value 0.5 at surfaceH
 * reproduces surfaceH exactly, fractional part and all. Filling voxels solid
 * up to a rounded surface instead is what terraced the whole site into 1 m
 * steps while the landscape beside it stayed smooth (#458).
 */
export function surfaceDensityAt(y: number, surfaceH: number): number {
  const d = 0.5 + (surfaceH - y) / (2 * SURFACE_BAND_HALF);
  return Math.max(0, Math.min(1, d));
}

/** Fill one column (x, z) of `grid` from the sampling context. Pure in (config, x, z) — see #473 D3. */
function generateColumn(
  grid: VoxelGrid,
  terrain: TerrainContext,
  config: TerrainConfig,
  x: number,
  z: number,
): void {
  const { worldGen, biome, strata, oreVeins } = terrain;
  const { sizeX, sizeY, sizeZ } = config;

  const surfaceH = sampleSurfaceHeightY(worldGen, x, z);
  const surfaceY = Math.round(surfaceH);
  const boundaries = strata.boundariesAt(x, z);
  const inBorder = isInBorderZone(x, z, sizeX, sizeZ, biome.borderWidth);

  // Every voxel the surface band reaches, which is one higher than the
  // last fully solid one — that voxel carries the fractional density
  // marching cubes interpolates against.
  const topY = Math.min(sizeY - 1, Math.ceil(surfaceH + SURFACE_BAND_HALF) - 1);
  for (let y = 0; y <= topY; y++) {
    const density = surfaceDensityAt(y, surfaceH);
    if (density <= 0) continue;

    // Depth is still measured from the rounded surface, so which stratum a
    // voxel belongs to is unchanged by the sub-voxel surface placement.
    const depth = Math.max(0, surfaceY - y);
    const composition = strata.compositionAt(x, y, z, depth, boundaries);
    const compId = grid.palette.intern(composition);
    const oreDensities = inBorder ? {} : oreVeins.densitiesAt(x, y, z, depth, composition, biome.oreRichness);

    grid.fillVoxel(x, y, z, compId, oreDensities, density);
  }
}

/**
 * Fill every column of `rect` (max exclusive) into an already-owned region of
 * `grid` (#473 D3). `config` must be the level's ORIGINAL config — its
 * sizeX/sizeZ fix the pit mask's rect and the vertical datum, so a chunk
 * claimed hours into a game generates against the same world the level
 * started from. `terrain` must be `buildTerrainContext(config)`.
 *
 * Callers are responsible for `markChunkPristine` afterwards: the fill writes
 * through the ordinary mutators, which mark the chunk dirty.
 */
export function generateTerrainRegion(
  grid: VoxelGrid,
  terrain: TerrainContext,
  config: TerrainConfig,
  rect: { minX: number; minZ: number; maxX: number; maxZ: number },
): void {
  for (let z = rect.minZ; z < rect.maxZ; z++) {
    for (let x = rect.minX; x < rect.maxX; x++) {
      generateColumn(grid, terrain, config, x, z);
    }
  }
}

export function generateTerrain(config: TerrainConfig): VoxelGrid {
  const { sizeX, sizeY, sizeZ } = config;
  const grid = new VoxelGrid(sizeX, sizeY, sizeZ);
  const terrain = buildTerrainContext(config);

  generateTerrainRegion(grid, terrain, config, { minX: 0, minZ: 0, maxX: sizeX, maxZ: sizeZ });
  for (const { cx, cz } of grid.ownedChunks()) grid.markChunkPristine(cx, cz);

  return grid;
}

/** Check if a position is in the neutral border zone. */
function isInBorderZone(
  x: number, z: number,
  sizeX: number, sizeZ: number,
  borderWidth: number,
): boolean {
  return x < borderWidth || x >= sizeX - borderWidth
    || z < borderWidth || z >= sizeZ - borderWidth;
}
