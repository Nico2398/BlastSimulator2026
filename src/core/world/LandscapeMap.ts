// BlastSimulator2026 — Landscape zone: tiled heightmaps outside the playable rect (#458 T2.1/D7/A16)
// Purely aesthetic groundwork for the future landscape mesher (T3.2): no
// navmesh, no interaction, never enters GameState simulation fields, never
// serialized (regenerated from seed on load, like the playable grid's
// composition). Every sample reads the SAME height/biome/strata pipeline
// TerrainGen.ts fills the playable grid from, so the two representations
// cannot disagree at their shared boundary — locked by a boundary-agreement
// test rather than by hoping two independent implementations stay in sync.

import { selectBiomeWeights, dominantBiome, biomeShaping, biomeIndexOf } from './BiomeCatalog.js';
import { sampleBaseHeight, applyPitMask, type WorldGenContext } from './WorldGen.js';
import { applyOverlays, type StructureSet } from './Structures.js';
import type { StrataSampler } from './Strata.js';
import type { CompositionPalette } from './VoxelGrid.js';

/** Half-extent (metres) of the landscape build area around the playable rect's centre (#458 A16). */
const EXTENT_HALF = 1600;
/** One tile's world-metre span (square). */
const TILE_SPAN = 512;
/** Sample spacing within a tile, metres. */
const COARSE_STEP = 4;
/** Fence-post: a tile spanning TILE_SPAN at COARSE_STEP resolution needs span/step + 1 samples per axis. */
const SAMPLES_PER_TILE = TILE_SPAN / COARSE_STEP + 1;

export interface LandscapeTile {
  /** Tile grid index (not world coordinates) — for addressing/debugging, not sampling. */
  readonly tileX: number;
  readonly tileZ: number;
  /** World-metre position of this tile's (0, 0) sample. */
  readonly originX: number;
  readonly originZ: number;
  /** SAMPLES_PER_TILE x SAMPLES_PER_TILE, row-major (index = row * SAMPLES_PER_TILE + col), row = z, col = x. */
  readonly heights: Float32Array;
  readonly biomeIds: Uint8Array;
  readonly surfCompIds: Uint16Array;
}

export interface LandscapeMap {
  readonly tiles: readonly LandscapeTile[];
  readonly extentHalf: number;
  readonly tileSpan: number;
  readonly coarseStep: number;
  readonly samplesPerTile: number;
}

/**
 * One column's landscape sample: height in the SAME datum as playable voxel
 * Y (world h + groundOffset, but float and unclamped — landscape is not
 * indexed into a fixed-size array), the dominant biome's stable index
 * (#458 A16), and the surface stratum's palette id.
 */
export function sampleLandscapeColumn(
  worldGen: WorldGenContext,
  climateBias: readonly [number, number],
  structureSet: StructureSet,
  strata: StrataSampler,
  palette: CompositionPalette,
  x: number,
  z: number,
): { height: number; biomeId: number; surfCompId: number } {
  const weights = selectBiomeWeights(worldGen.fields.temperature(x, z), worldGen.fields.humidity(x, z), climateBias, 1.0);
  const biome = dominantBiome(weights);
  const biomeId = Math.max(0, biomeIndexOf(biome.id));

  const shapingInput = weights.map(w => ({ shaping: biomeShaping(w.biome), weight: w.weight }));
  const raw = sampleBaseHeight(worldGen.fields, x, z, shapingInput);
  const masked = applyPitMask(raw, worldGen.centerHeight, worldGen.playableRect, x, z);
  const overlaid = applyOverlays(structureSet, x, z, masked);
  const height = overlaid + worldGen.groundOffset;

  // Match the playable grid's own topmost SOLID voxel exactly: TerrainGen's
  // fill loop leaves y >= surfaceY as air, so the surface voxel sits at
  // y = surfaceY - 1, one metre (depth 1) below the surface — not depth 0
  // at surfaceY itself, which would sample the wrong side of a strata
  // boundary whenever the surface falls within the topsoil layer's blend
  // range of its own upper edge (#458 T2.1 boundary-agreement fix).
  const surfaceYEquivalent = Math.round(height);
  const boundaries = strata.boundariesAt(x, z);
  const composition = strata.compositionAt(x, surfaceYEquivalent - 1, z, 1, boundaries);
  const surfCompId = palette.intern(composition);

  return { height, biomeId, surfCompId };
}

/**
 * Builds the full tiled landscape map around worldGen's playable rect.
 * `palette` must be the SAME CompositionPalette instance the playable grid
 * used (`grid.palette`) — palette ids are assigned by insertion order, so a
 * separately-built palette would intern the same rock blend under a
 * different id and silently break "shader rock indices agree" (#458 A16).
 */
export function buildLandscapeMap(
  worldGen: WorldGenContext,
  climateBias: readonly [number, number],
  structureSet: StructureSet,
  strata: StrataSampler,
  palette: CompositionPalette,
  extentHalf: number = EXTENT_HALF,
): LandscapeMap {
  const rect = worldGen.playableRect;
  const centerX = (rect.minX + rect.maxX) / 2;
  const centerZ = (rect.minZ + rect.maxZ) / 2;

  // Odd tile count, symmetric about the playable centre (#458 A16 "aligned to
  // playable centre"). floor (not ceil) matches D7's own "~7x7 tiles" sizing
  // at the default 1600/512 — the last partial tile-span at the true extent
  // edge is dropped rather than padded to a full tile, which costs ~64m of
  // coverage at the far edge (well past typical camera draw distance) for a
  // meaningful chunk of buildLandscapeMap's per-sample cost.
  const halfTiles = Math.floor(extentHalf / TILE_SPAN);
  const tilesPerAxis = halfTiles * 2 + 1;

  const tiles: LandscapeTile[] = [];
  for (let tz = 0; tz < tilesPerAxis; tz++) {
    for (let tx = 0; tx < tilesPerAxis; tx++) {
      const originX = centerX + (tx - halfTiles) * TILE_SPAN;
      const originZ = centerZ + (tz - halfTiles) * TILE_SPAN;

      // Skip any tile whose entire span lies inside the playable rect (#458 A16) — never triggers
      // at today's level sizes (rects are far smaller than one tile) but kept for correctness.
      if (
        originX >= rect.minX && originX + TILE_SPAN <= rect.maxX &&
        originZ >= rect.minZ && originZ + TILE_SPAN <= rect.maxZ
      ) continue;

      const heights = new Float32Array(SAMPLES_PER_TILE * SAMPLES_PER_TILE);
      const biomeIds = new Uint8Array(SAMPLES_PER_TILE * SAMPLES_PER_TILE);
      const surfCompIds = new Uint16Array(SAMPLES_PER_TILE * SAMPLES_PER_TILE);

      for (let row = 0; row < SAMPLES_PER_TILE; row++) {
        const z = originZ + row * COARSE_STEP;
        for (let col = 0; col < SAMPLES_PER_TILE; col++) {
          const x = originX + col * COARSE_STEP;
          const sample = sampleLandscapeColumn(worldGen, climateBias, structureSet, strata, palette, x, z);
          const idx = row * SAMPLES_PER_TILE + col;
          heights[idx] = sample.height;
          biomeIds[idx] = sample.biomeId;
          surfCompIds[idx] = sample.surfCompId;
        }
      }

      tiles.push({ tileX: tx - halfTiles, tileZ: tz - halfTiles, originX, originZ, heights, biomeIds, surfCompIds });
    }
  }

  return { tiles, extentHalf, tileSpan: TILE_SPAN, coarseStep: COARSE_STEP, samplesPerTile: SAMPLES_PER_TILE };
}
