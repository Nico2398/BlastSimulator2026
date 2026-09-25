// BlastSimulator2026 — Voxel grid save serialization (#458 T0.3, #473 P3, #1180, #1181)
// A save embeds two things, never dense chunk data: the complete generator
// identity terrain was produced from (`SerializedTerrainGen`) and the edit
// record of everything play changed since generation (`VoxelGrid.edits`,
// #1180's `TerrainEdits`). Loading regenerates pristine terrain from the
// generator identity, then replays the edit record on top — reproducing the
// live grid voxel for voxel without saving every voxel's full state (#1181).

import { VoxelGrid } from '../world/VoxelGrid.js';
import type { EditSegment } from '../world/TerrainEdits.js';

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
export function encodeVoxelGrid(_grid: VoxelGrid, _gen: SerializedTerrainGen): SerializedVoxels {
  // TODO: implement
  throw new Error('not implemented');
}

/**
 * Regenerate a grid from `payload.gen`'s generator identity, then replay
 * `payload.editColumns`/`payload.editFractures` onto it. Throws
 * `TerrainGenVersionMismatchError` when `payload.gen.version` doesn't match
 * the running build's generator.
 */
export function decodeVoxelGrid(_payload: SerializedVoxels): VoxelGrid {
  // TODO: implement
  throw new Error('not implemented');
}
