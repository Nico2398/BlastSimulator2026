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

/** Fence-post: a chunk spanning 32 cells at any ladder step needs 32 + 1 samples per axis. */
export const NODES_PER_CHUNK = 33;

/** Sample-spacing ladder (metres) a chunk is generated at, indexed by `LandscapeChunkId.level` — 0 is finest/nearest, resolution coarsens with distance from camera. */
export const LADDER_STEPS: readonly number[] = [1, 2, 4, 8, 16];

/** One chunk's world-metre span at `level` (33 nodes, 32 cells, at that level's ladder step). */
export function chunkSpanAt(level: number): number {
  const step = LADDER_STEPS[level];
  if (step === undefined) throw new Error(`chunkSpanAt: level ${level} out of range [0, ${LADDER_STEPS.length})`);
  return step * (NODES_PER_CHUNK - 1);
}

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
  // Same offset the playable grid's own columns land at — site and landscape
  // read the same unclamped height directly, so the two agree with no band
  // trick needed (#1189).
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

/** Stable string key for a chunk id, for Map lookups. */
export function chunkKey(id: LandscapeChunkId): string {
  return `${id.level}:${id.cx}:${id.cz}`;
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
  worldGen: WorldGenContext,
  climateBias: readonly [number, number],
  structureSet: StructureSet,
  strata: StrataSampler,
  palette: CompositionPalette,
  extentHalf: number = EXTENT_HALF,
): LazyLandscapeMap {
  const rect = worldGen.playableRect;
  const centerX = (rect.minX + rect.maxX) / 2;
  const centerZ = (rect.minZ + rect.maxZ) / 2;

  const cache = new Map<string, LandscapeChunk>();

  return {
    extentHalf,
    centerX,
    centerZ,
    getChunk(id: LandscapeChunkId): LandscapeChunk {
      const key = chunkKey(id);
      const cached = cache.get(key);
      if (cached) return cached;

      const step = LADDER_STEPS[id.level];
      if (step === undefined) throw new Error(`getChunk: level ${id.level} out of range [0, ${LADDER_STEPS.length})`);
      const { originX, originZ } = chunkOrigin(id, centerX, centerZ);

      const n = NODES_PER_CHUNK;
      const heights = new Float32Array(n * n);
      const biomeIds = new Uint8Array(n * n);
      const surfCompIds = new Uint16Array(n * n);

      for (let row = 0; row < n; row++) {
        const z = originZ + row * step;
        for (let col = 0; col < n; col++) {
          const x = originX + col * step;
          const sample = sampleLandscapeColumn(worldGen, climateBias, structureSet, strata, palette, x, z);
          const idx = row * n + col;
          heights[idx] = sample.height;
          biomeIds[idx] = sample.biomeId;
          surfCompIds[idx] = sample.surfCompId;
        }
      }

      const chunk: LandscapeChunk = { id, step, originX, originZ, heights, biomeIds, surfCompIds };
      cache.set(key, chunk);
      return chunk;
    },
    hasChunk(id: LandscapeChunkId): boolean {
      return cache.has(chunkKey(id));
    },
    get cachedChunkIds(): readonly LandscapeChunkId[] {
      return Array.from(cache.values(), chunk => chunk.id);
    },
  };
}

/** World-metre origin of chunk `id`'s (0, 0) sample, given the map's centre. */
export function chunkOrigin(
  id: LandscapeChunkId, centerX: number, centerZ: number,
): { originX: number; originZ: number } {
  const span = chunkSpanAt(id.level);
  return { originX: centerX + id.cx * span, originZ: centerZ + id.cz * span };
}

/**
 * Which chunks should be resident for a camera at (cameraX, cameraZ) — the
 * resolution ladder's near-to-far selection (#1153).
 *
 * Starts from the coarsest level's grid tiling the full extent (rounded up
 * to a whole number of coarsest chunks, so the covered square may run
 * slightly past `extentHalf` — see the module doc), then recursively
 * quarters any chunk whose centre falls within `1.5 * chunkSpanAt(level)` of
 * the camera into its 4 same-footprint children one level finer. Since
 * `chunkSpanAt(level) = 2 * chunkSpanAt(level - 1)`, the 4 children exactly
 * tile the parent's footprint with no gap and no overlap.
 */
export function selectLandscapeChunks(
  cameraX: number, cameraZ: number, centerX: number, centerZ: number, extentHalf: number = EXTENT_HALF,
): LandscapeChunkId[] {
  const coarsestLevel = LADDER_STEPS.length - 1;
  const coarsestSpan = chunkSpanAt(coarsestLevel);
  const halfCount = Math.max(1, Math.ceil(extentHalf / coarsestSpan));

  const result: LandscapeChunkId[] = [];

  const refine = (id: LandscapeChunkId): void => {
    const span = chunkSpanAt(id.level);
    const { originX, originZ } = chunkOrigin(id, centerX, centerZ);
    const chunkCenterX = originX + span / 2;
    const chunkCenterZ = originZ + span / 2;
    const dist = Math.hypot(cameraX - chunkCenterX, cameraZ - chunkCenterZ);

    if (id.level > 0 && dist < 1.5 * span) {
      const childLevel = id.level - 1;
      for (const dcx of [0, 1]) {
        for (const dcz of [0, 1]) {
          refine({ level: childLevel, cx: id.cx * 2 + dcx, cz: id.cz * 2 + dcz });
        }
      }
      return;
    }

    result.push(id);
  };

  for (let cx = -halfCount; cx < halfCount; cx++) {
    for (let cz = -halfCount; cz < halfCount; cz++) {
      refine({ level: coarsestLevel, cx, cz });
    }
  }

  return result;
}
