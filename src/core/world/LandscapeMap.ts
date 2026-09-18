// BlastSimulator2026 — Landscape zone: tiled heightmaps outside the playable rect (#458 T2.1/D7/A16)
// Purely aesthetic groundwork for the future landscape mesher (T3.2): no
// navmesh, no interaction, never enters GameState simulation fields, never
// serialized (regenerated from seed on load, like the playable grid's
// composition). Every sample reads the SAME height/biome/strata pipeline
// TerrainGen.ts fills the playable grid from, so the two representations
// cannot disagree at their shared boundary — locked by a boundary-agreement
// test rather than by hoping two independent implementations stay in sync.

import { selectBiomeWeights, dominantBiome, biomeShaping, biomeIndexOf } from './BiomeCatalog.js';
import { sampleBaseHeight, applyPitMask, applyPlayableBand, type WorldGenContext } from './WorldGen.js';
import { applyOverlays, type StructureSet } from './Structures.js';
import type { StrataSampler } from './Strata.js';
import type { CompositionPalette } from './VoxelGrid.js';

/** Fence-post: a chunk spanning 32 cells at any ladder step needs 32 + 1 samples per axis. */
export const NODES_PER_CHUNK = 33;

/** Sample-spacing ladder (metres) a chunk is generated at, indexed by `LandscapeChunkId.level` — 0 is finest/nearest, resolution coarsens with distance from camera. */
export const LADDER_STEPS: readonly number[] = [1, 2, 4, 8, 16];

/** One chunk's world-metre span at `level` (33 nodes, 32 cells, at that level's ladder step). */
export function chunkSpanAt(_level: number): number { throw new Error('not implemented'); }

/** Half-extent (metres) of the landscape build area around the playable rect's centre (#458 A16). */
export const EXTENT_HALF = 1600;

/** Addresses one chunk on the resolution ladder — a level (ring/resolution), plus its grid index within that level's lattice. */
export interface LandscapeChunkId {
  readonly level: number;
  readonly cx: number;
  readonly cz: number;
}

/** One lazily-sampled patch of landscape, at its ladder level's resolution. */
export interface LandscapeChunk {
  readonly id: LandscapeChunkId;
  readonly step: number;
  readonly originX: number;
  readonly originZ: number;
  /** NODES_PER_CHUNK x NODES_PER_CHUNK, row-major (index = row * NODES_PER_CHUNK + col), row = z, col = x. */
  readonly heights: Float32Array;
  readonly biomeIds: Uint8Array;
  readonly surfCompIds: Uint16Array;
}

/** Per-chunk lazy replacement for the old eager `LandscapeMap`/`buildLandscapeMap` (#1153) — chunks are sampled and cached on first request rather than the whole extent up front. */
export interface LazyLandscapeMap {
  readonly extentHalf: number;
  readonly centerX: number;
  readonly centerZ: number;
  getChunk(id: LandscapeChunkId): LandscapeChunk;
  hasChunk(id: LandscapeChunkId): boolean;
  readonly cachedChunkIds: readonly LandscapeChunkId[];
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
  // The band the playable grid can hold, applied to the world as well wherever
  // the site draws — the landscape used to be the only sheet that ignored the
  // clamp, which is what put a flat-topped rectangle on the ground (#1077).
  const height = applyPlayableBand(
    overlaid + worldGen.groundOffset, worldGen.sizeY, worldGen.playableRect, x, z,
  );

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
 * Builds a lazy, per-chunk landscape map around worldGen's playable rect,
 * replacing the eager single-resolution `buildLandscapeMap` (#1153). Chunks
 * are sampled on first `getChunk` request and cached, at whichever ladder
 * step their `LandscapeChunkId.level` selects.
 *
 * `palette` must be the SAME CompositionPalette instance the playable grid
 * used (`grid.palette`) — palette ids are assigned by insertion order, so a
 * separately-built palette would intern the same rock blend under a
 * different id and silently break "shader rock indices agree" (#458 A16).
 */
export function createLazyLandscapeMap(
  _worldGen: WorldGenContext,
  _climateBias: readonly [number, number],
  _structureSet: StructureSet,
  _strata: StrataSampler,
  _palette: CompositionPalette,
  _extentHalf: number = EXTENT_HALF,
): LazyLandscapeMap { throw new Error('not implemented'); }

/** World-metre origin of chunk `id`'s (0, 0) sample, given the map's centre. */
export function chunkOrigin(
  _id: LandscapeChunkId, _centerX: number, _centerZ: number,
): { originX: number; originZ: number } { throw new Error('not implemented'); }

/** Which chunks should be resident for a camera at (cameraX, cameraZ) — the resolution ladder's near-to-far selection. */
export function selectLandscapeChunks(
  _cameraX: number, _cameraZ: number, _centerX: number, _centerZ: number, _extentHalf: number = EXTENT_HALF,
): LandscapeChunkId[] { throw new Error('not implemented'); }
