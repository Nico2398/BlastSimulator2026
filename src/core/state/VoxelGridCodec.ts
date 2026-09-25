// BlastSimulator2026 — Voxel grid save serialization (#458 T0.3, #473 P3, #1180, #1181)
// A save embeds two things, never dense chunk data: the complete generator
// identity terrain was produced from (`SerializedTerrainGen`) and the edit
// record of everything play changed since generation (`VoxelGrid.edits`,
// #1180's `TerrainEdits`). Loading regenerates pristine terrain from the
// generator identity, then replays the edit record on top — reproducing the
// live grid voxel for voxel without saving every voxel's full state (#1181).

import { VoxelGrid } from '../world/VoxelGrid.js';
import { replayTerrainEdits, type EditSegment } from '../world/TerrainEdits.js';
import { generateTerrainRegion, buildTerrainContext, TERRAIN_GENERATOR_VERSION, type TerrainConfig } from '../world/TerrainGen.js';

/**
 * The complete generator identity a save's terrain is regenerated from —
 * every field generation reads, plus the version of the generator that
 * produced it. `sizeX`/`sizeZ` are the level's ORIGINAL dimensions, not the
 * site's current bounding box: they fix the pit mask's rect and the
 * vertical datum, so a chunk claimed after ten hours of play generates
 * against the same world the first chunk did.
 */
export interface SerializedTerrainGen {
  version: number;
  seed: number;
  climateBias: [number, number];
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  mixedRockHardness?: boolean;
}

export interface SerializedVoxels {
  v: 8;
  gen: SerializedTerrainGen;
  /** Claimed chunks, as [cx, cz, minX, minZ, maxX, maxZ]. Regenerated from `gen` on load, then the edit record below is replayed on top. */
  claimed: Array<[cx: number, cz: number, minX: number, minZ: number, maxX: number, maxZ: number]>;
  editColumns: Array<{ x: number; z: number; segments: EditSegment[] }>;
  editFractures: Array<{ x: number; y: number; z: number; modifier: number }>;
}

/**
 * Thrown by `decodeVoxelGrid` when a save's embedded generator version
 * doesn't match the running build's `TERRAIN_GENERATOR_VERSION`. The game is
 * unreleased: a mismatched save is refused outright, never migrated
 * (project owner policy, #1181).
 */
export class TerrainGenVersionMismatchError extends Error {
  constructor(public readonly savedVersion: number, public readonly currentVersion: number) {
    super(`Save terrain generator v${savedVersion} does not match current generator v${currentVersion}.`);
  }
}

/**
 * Encode a grid's claimed-chunk set and edit record against the generator
 * identity it was produced from.
 */
export function encodeVoxelGrid(grid: VoxelGrid, gen: SerializedTerrainGen): SerializedVoxels {
  const claimed: SerializedVoxels['claimed'] = [];
  for (const { cx, cz } of grid.ownedChunks()) {
    const rect = grid.chunkRect(cx, cz);
    if (!rect) continue;
    claimed.push([cx, cz, rect.minX, rect.minZ, rect.maxX, rect.maxZ]);
  }

  const editColumns = grid.edits.columns().map(({ x, z, segments }) => ({ x, z, segments: [...segments] }));
  const editFractures = grid.edits.fractureEntries();

  return { v: 8, gen, claimed, editColumns, editFractures };
}

/**
 * Regenerate a grid from `payload.gen`'s generator identity, then replay
 * `payload.editColumns`/`payload.editFractures` onto it. Throws
 * `TerrainGenVersionMismatchError` when `payload.gen.version` doesn't match
 * the running build's generator.
 */
export function decodeVoxelGrid(payload: SerializedVoxels): VoxelGrid {
  if (payload.v !== 8) {
    throw new Error(`unsupported save payload version: ${payload.v}`);
  }
  if (payload.gen.version !== TERRAIN_GENERATOR_VERSION) {
    throw new TerrainGenVersionMismatchError(payload.gen.version, TERRAIN_GENERATOR_VERSION);
  }

  const config: TerrainConfig = {
    sizeX: payload.gen.sizeX,
    sizeY: payload.gen.sizeY,
    sizeZ: payload.gen.sizeZ,
    seed: payload.gen.seed,
    climateBias: payload.gen.climateBias,
    ...(payload.gen.mixedRockHardness !== undefined ? { mixedRockHardness: payload.gen.mixedRockHardness } : {}),
  };

  // Empty at construction — every claimed chunk below is added and
  // generated explicitly, from the claimed rects the save recorded, not
  // from config.sizeX/sizeZ (a site-expanded save owns chunks past them).
  const grid = new VoxelGrid(0, config.sizeY, 0);
  const terrain = buildTerrainContext(config);

  for (const [cx, cz, minX, minZ, maxX, maxZ] of payload.claimed) {
    grid.addChunkWithRect(cx, cz, { minX, minZ, maxX, maxZ });
    const rect = grid.chunkRect(cx, cz);
    if (!rect) continue;
    generateTerrainRegion(grid, terrain, config, rect);
    grid.markChunkPristine(cx, cz);
  }

  for (const { x, z, segments } of payload.editColumns) {
    for (const seg of segments) {
      if (seg.kind === 'added') {
        grid.edits.recordAdd(x, z, seg.yLo, seg.yHi, seg.composition!, seg.ores, seg.bottomBoundary, seg.topBoundary);
      } else {
        grid.edits.recordDig(x, z, seg.yLo, seg.yHi, seg.bottomBoundary, seg.topBoundary);
      }
    }
  }
  for (const { x, y, z, modifier } of payload.editFractures) {
    grid.edits.recordFracture(x, y, z, modifier);
  }

  replayTerrainEdits(grid, grid.edits);

  return grid;
}
