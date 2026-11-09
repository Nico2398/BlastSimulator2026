// BlastSimulator2026 — Procedural terrain generation
// Populates a VoxelGrid from the unified world height sampler (WorldGen.ts),
// a depth-stratified rock profile (Strata.ts) and per-ore anisotropic vein
// noise (OreVeins.ts).

import { VoxelGrid, surfaceDensityAt, MAX_TERRAIN_GEN_DIMENSION, isValidVoxelY, type VoxelChunkSource } from './VoxelGrid.js';
import type { BiomeDef } from './BiomeCatalog.js';
import { selectBiomeWeights, dominantBiome, biomeShaping } from './BiomeCatalog.js';
import type { PitMaskShape } from '../config/balance.js';
import { isValidOreGradeScale } from '../economy/OreGrade.js';
import { createWorldGenContext, sampleSurfaceHeightY, type WorldGenContext } from './WorldGen.js';
import { WorldNoiseFields } from './NoiseFields.js';
import { buildStrataProfile, buildMixedHardnessStrata, StrataSampler } from './Strata.js';
import { OreVeinSampler } from './OreVeins.js';
import { pickStarterDeposit, starterPocketAt, type StarterDeposit } from './StarterDeposit.js';

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
 * depends on) rather than declared here, so the horizontal size ceiling stays
 * one constant instead of a second hardcoded literal here (#1190 review).
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

/**
 * The pit mask read from untrusted save JSON (#1680): margin finite and
 * positive, reliefKeep finite in [0, 1]; optional envelopeSlope in (0, 1], outlineWobble and
 * cornerRadius >= 0 (#1734). Callers skip it when the mask is absent (default mask).
 */
export function requireValidPitMask(value: PitMaskShape, label: string): PitMaskShape {
  const { margin, reliefKeep, envelopeSlope, outlineWobble, cornerRadius } = value ?? ({} as Partial<PitMaskShape>);
  const badOptional = (v: number | undefined, ok: (n: number) => boolean) =>
    v !== undefined && !(Number.isFinite(v) && ok(v));
  if (
    !Number.isFinite(margin) || margin <= 0 || !Number.isFinite(reliefKeep) || reliefKeep < 0 || reliefKeep > 1 ||
    badOptional(envelopeSlope, (n) => n > 0 && n <= 1) ||
    badOptional(outlineWobble, (n) => n >= 0) ||
    badOptional(cornerRadius, (n) => n >= 0)
  ) {
    throw new Error(`corrupt save: ${label} is not a valid pit mask`);
  }
  return {
    margin,
    reliefKeep,
    ...(envelopeSlope !== undefined ? { envelopeSlope } : {}),
    ...(outlineWobble !== undefined ? { outlineWobble } : {}),
    ...(cornerRadius !== undefined ? { cornerRadius } : {}),
  };
}

/**
 * The datum read from untrusted save JSON. Unlike a size, a datum is a voxel
 * row, so zero and negative values are legitimate (`new_game size:1` yields
 * datum 0) — it only has to be an integer inside the grid's vertical range.
 */
export function requireValidGenDatum(value: number, label: string): number {
  if (!isValidVoxelY(value)) {
    throw new Error(`corrupt save: ${label} (${value}) is not a valid terrain datum`);
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
  /** Gate ore veins to discrete rarity-sized deposits when true; off = legacy veins (#1682). */
  oreDeposits?: boolean;
  /** Pit mask shape; defaults to DEFAULT_PIT_MASK (#1680). */
  pitMask?: PitMaskShape;
  /** Ore grade scale lever (#1932); absent = default. */
  oreGradeScale?: number;
}

/** Shared between every grid built from one config (`buildTerrainContext` memoises it): read-only, frozen. */
export interface TerrainContext {
  readonly worldGen: WorldGenContext;
  readonly biome: BiomeDef;
  readonly strata: StrataSampler;
  readonly oreVeins: OreVeinSampler;
  /** The sandbox starter deposit (#2116); null when ore deposits are off. */
  readonly starterDeposit: StarterDeposit | null;
}

/** Dominant climate-weighted biome at the playable centre — what terrain generation lands on. */
function centerBiome(
  fields: WorldNoiseFields, sizeX: number, sizeZ: number, climateBias: readonly [number, number],
): BiomeDef {
  return dominantBiome(
    selectBiomeWeights(fields.temperature(sizeX / 2, sizeZ / 2), fields.humidity(sizeX / 2, sizeZ / 2), climateBias, 1.0),
  );
}

/**
 * The biome terrain generation actually lands on for these params. It can
 * differ from a level's declared biome, so anything asking "which rocks does
 * this site contain" (contract ores, #1364) must ask here rather than the
 * declared one. Shares centerBiome with buildTerrainContext. Cheap (two noise
 * samples), so deliberately uncached.
 */
export function resolveGeneratedBiome(
  seed: number, sizeX: number, sizeZ: number, climateBias: readonly [number, number],
): BiomeDef {
  return centerBiome(new WorldNoiseFields(seed), sizeX, sizeZ, climateBias);
}

/**
 * Every `TerrainConfig` field, in key order. `satisfies` makes this exhaustive:
 * a field added to `TerrainConfig` fails the typecheck here until the memo key
 * below covers it, so a new generation lever can never be silently left out of
 * the key and hand one config's terrain to another.
 */
const TERRAIN_CONFIG_FIELDS = {
  sizeX: true, datum: true, sizeZ: true, seed: true, climateBias: true,
  mixedRockHardness: true, oreDeposits: true, pitMask: true, oreGradeScale: true,
} as const satisfies Record<keyof TerrainConfig, true>;

/**
 * How many distinct configs `buildTerrainContext` keeps built. One game holds
 * one terrain config; a few entries cover a save/reload or a test alternating
 * between two sites while bounding the memory (a context is a few hundred KB of
 * noise tables at most).
 */
export const TERRAIN_CONTEXT_MEMO_ENTRIES = 4;

/** Built contexts by config key, oldest first (re-inserted on a hit, so eviction is least-recently-used). */
const terrainContextMemo = new Map<string, TerrainContext>();

/** A config value as a stable key part: content, not identity; object keys sorted; undefined distinct from any value. */
function keyPart(value: unknown): string {
  if (value === undefined) return '~';
  if (typeof value === 'number') return Object.is(value, -0) ? '-0' : String(value);
  if (typeof value !== 'object' || value === null) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(keyPart).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${k}:${keyPart(v)}`).join(',')}}`;
}

/** The memo key of a config: every `TerrainConfig` field by content; any extra field a caller's object carries is ignored. */
function terrainConfigKey(config: TerrainConfig): string {
  return (Object.keys(TERRAIN_CONFIG_FIELDS) as Array<keyof TerrainConfig>).map(f => keyPart(config[f])).join('|');
}

/**
 * Builds everything generateTerrain needs from one config: the world height
 * sampler, the grid's single dominant biome, its strata/ore samplers and the
 * sandbox starter deposit. Exported (not just internal to generateTerrain) so
 * a caller building the landscape map alongside the playable grid (#458 T2.1),
 * the starter-deposit lookups and a save decode can reach the same context
 * from the same config.
 *
 * Memoised on the config's content, a few entries deep: one `sandbox start`
 * built the same context three times (generateTerrain, the starting-building
 * keep-clear square, the #2148 starter survey; five on the #2044 retry path),
 * ~0.1 s each, and the starter pick inside it was the largest single cost of
 * the slowest test files — the waits behind the agent-step timeouts of #2142,
 * #2143, #2148, #2154 and #2199.
 *
 * Core stays side-effect free: the memo is unobservable, like the WeakMap
 * caches elsewhere in core. The context is a pure function of the config's
 * fields (all keyed, by value); it is built from a private copy of the config,
 * so no caller-owned array or object is aliased; and no consumer writes to it
 * (audited: TerrainGen, PlayableArea, VoxelGridCodec, world.ts's
 * ensureLandscape, LandscapeMap and Structures only read it). It is frozen so
 * a future write fails loudly instead of corrupting a context other grids
 * share; the samplers inside are immutable after construction. The palette,
 * which genuinely must be per grid, is not part of it (see LandscapeMap.ts).
 */
export function buildTerrainContext(config: TerrainConfig): TerrainContext {
  const key = terrainConfigKey(config);
  const hit = terrainContextMemo.get(key);
  if (hit) {
    terrainContextMemo.delete(key);
    terrainContextMemo.set(key, hit);
    return hit;
  }
  const built = computeTerrainContext(ownedConfig(config));
  terrainContextMemo.set(key, built);
  if (terrainContextMemo.size > TERRAIN_CONTEXT_MEMO_ENTRIES) {
    terrainContextMemo.delete(terrainContextMemo.keys().next().value!);
  }
  return built;
}

/**
 * Drops every memoised context, so the next `buildTerrainContext` builds from
 * scratch. The game never needs it (a context is a pure function of its
 * config); a test proving that two independent builds of one config generate
 * identical terrain calls it between them, so the memo cannot hand the second
 * build the first one's samplers.
 */
export function clearTerrainContextMemo(): void {
  terrainContextMemo.clear();
}

/** The config's `TerrainConfig` fields only, with its array and object values copied and frozen. */
function ownedConfig(config: TerrainConfig): TerrainConfig {
  const { sizeX, datum, sizeZ, seed, climateBias, mixedRockHardness, oreDeposits, pitMask, oreGradeScale } = config;
  return {
    sizeX, datum, sizeZ, seed,
    climateBias: Object.freeze([climateBias[0], climateBias[1]] as const),
    ...(mixedRockHardness !== undefined ? { mixedRockHardness } : {}),
    ...(oreDeposits !== undefined ? { oreDeposits } : {}),
    ...(pitMask !== undefined ? { pitMask: Object.freeze({ ...pitMask }) } : {}),
    ...(oreGradeScale !== undefined ? { oreGradeScale } : {}),
  };
}

/** The unmemoised build behind `buildTerrainContext`; the result is frozen because the memo shares it. */
function computeTerrainContext(config: TerrainConfig): TerrainContext {
  const { sizeX, datum, sizeZ, seed, climateBias, mixedRockHardness, oreDeposits, pitMask, oreGradeScale } = config;

  const worldGen = createWorldGenContext(seed, sizeX, datum, sizeZ, (fields) => (x, z) => {
    const weights = selectBiomeWeights(fields.temperature(x, z), fields.humidity(x, z), climateBias, 1.0);
    return weights.map(w => ({ shaping: biomeShaping(w.biome), weight: w.weight }));
  }, pitMask);

  const biome = centerBiome(worldGen.fields, sizeX, sizeZ, climateBias);

  const profile = mixedRockHardness
    ? buildMixedHardnessStrata(biome.dominantRocks)
    : buildStrataProfile(biome.dominantRocks);
  const strata = new StrataSampler(seed, profile);
  const oreVeins = new OreVeinSampler(seed, { deposits: oreDeposits === true, ...(oreGradeScale !== undefined ? { gradeScale: oreGradeScale } : {}) });

  const starterDeposit = pickStarterDeposit(config, worldGen);
  Object.freeze(worldGen.playableRect);
  return Object.freeze({
    worldGen: Object.freeze(worldGen),
    biome,
    strata,
    oreVeins,
    starterDeposit: starterDeposit ? Object.freeze(starterDeposit) : null,
  });
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
  const { worldGen, biome, strata, oreVeins, starterDeposit: starter } = terrain;

  const surfaceH = sampleSurfaceHeightY(worldGen, x, z);
  const surfaceY = Math.round(surfaceH);
  const boundaries = strata.boundariesAt(x, z);

  for (let y = yLo; y <= yHi; y++) {
    const density = surfaceDensityAt(y, surfaceH);
    if (density <= 0) continue;

    // Depth is still measured from the rounded surface, so which stratum a
    // voxel belongs to is unchanged by the sub-voxel surface placement.
    const depth = Math.max(0, surfaceY - y);
    const pocket = starter ? starterPocketAt(starter, x, z, depth, config.oreGradeScale) : null;
    const composition = pocket ? pocket.composition : strata.compositionAt(x, y, z, depth, boundaries);
    const compId = grid.palette.intern(composition);
    const oreDensities = pocket ? pocket.oreDensities : oreVeins.densitiesAt(x, y, z, depth, composition, biome.oreRichness);

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
 *   3. Distribute ore veins using per-ore anisotropic noise (OreVeins.ts, #458 T1.3/A12),
 *      by the same rules everywhere: the starting rectangle has no ore-free edge ring, because
 *      every site can grow past that edge and a ring would be left as a barren seam mid-site
 *
 * Height blends every biome's shaping by climate weight, evaluated per
 * column — a real gradient at a climate transition, not a seam. Rock/ore
 * generation (steps 2-3) still uses ONE dominant biome for the whole grid
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
 * Climate bias that makes the centre of a (seed, size) site generate `target`'s
 * biome. Returns `target.climateCenter` when the seed already lands there.
 */
export function climateBiasLandingOn(
  seed: number,
  sizeX: number,
  sizeZ: number,
  target: BiomeDef,
): readonly [number, number] {
  const fields = new WorldNoiseFields(seed);
  if (centerBiome(fields, sizeX, sizeZ, target.climateCenter).id === target.id) return target.climateCenter;
  // Bias is added to the raw centre climate, so cancel it to land on the biome's centre.
  return [
    target.climateCenter[0] - fields.temperature(sizeX / 2, sizeZ / 2),
    target.climateCenter[1] - fields.humidity(sizeX / 2, sizeZ / 2),
  ];
}

/** Validates an ore grade scale (#1932). */
export function requireValidOreGradeScale(value: number, label: string): number {
  if (!isValidOreGradeScale(value)) {
    throw new Error(`corrupt save: ${label} is not a valid ore grade scale`);
  }
  return value;
}
