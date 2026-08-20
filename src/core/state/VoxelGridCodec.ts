// BlastSimulator2026 — Voxel grid save serialization (#458 T0.3, #473 P3)
// Encodes a VoxelGrid's chunked storage into a compact, JSON-embeddable
// payload (byte-level RLE + base64) and decodes it back. This is what lets a
// save preserve actual terrain mutations (blast craters, ramps) instead of
// discarding them and regenerating pristine terrain from the seed on load.
//
// v7 stores only the chunks play actually changed (#473 D4). Every other
// owned chunk is recorded as a claim — cx/cz plus its owned sub-rect — and
// regenerated from the seed on load, which is byte-identical because
// generation is a pure function of position and seed (#473 D3). A site can
// therefore grow without the save growing with it: save size tracks play, not
// level size.

import { VoxelGrid, CHUNK_SIZE, clampChunkRectToTile, type VoxelRockComposition } from '../world/VoxelGrid.js';
import { buildTerrainContext, generateTerrainRegion, type TerrainConfig } from '../world/TerrainGen.js';
import { bytesToBase64, base64ToBytes } from './Base64.js';

/** A chunk stored voxel-by-voxel because play changed it. */
export interface SerializedChunk {
  cx: number;
  cz: number;
  /** Owned sub-rect as [minX, minZ, maxX, maxZ], max exclusive. */
  r: [number, number, number, number];
  /** base64(rle(raw Float64 bytes)) */
  density: string;
  /** base64(rle(raw Uint16 bytes, little-endian)) */
  compId: string;
  /** base64(rle(raw Float64 bytes)) */
  fracture: string;
  /** Sparse: only voxels carrying at least one ore, keyed by chunk-local index. */
  ores: Array<[index: number, densities: Record<string, number>]>;
}

/**
 * The generation datum a pristine chunk is regenerated from.
 *
 * `sizeX`/`sizeZ` are the level's ORIGINAL dimensions, not the site's current
 * bounding box: they fix the pit mask's rect and the vertical datum, so a
 * chunk claimed after ten hours of play generates against the same world the
 * first chunk did.
 */
export interface SerializedTerrainGen {
  seed: number;
  climateBias: [number, number];
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  mixedRockHardness?: boolean;
}

export interface SerializedVoxels {
  v: 7;
  sizeY: number;
  /** Index-aligned with VoxelGrid's internal palette; index 0 is always air. */
  palette: VoxelRockComposition[];
  /** Claimed chunks equal to their generated state, as [cx, cz, minX, minZ, maxX, maxZ]. */
  pristine: Array<[number, number, number, number, number, number]>;
  /** Claimed chunks play has changed. */
  chunks: SerializedChunk[];
  /** Absent only on a grid saved without a generation datum — then every chunk is stored dirty. */
  gen?: SerializedTerrainGen;
}

/** The pre-#473 dense payload. Read-only: decoded into a chunked grid, never written again. */
export interface SerializedVoxelsV6 {
  v: 6;
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  palette: VoxelRockComposition[];
  density: string;
  compId: string;
  fracture: string;
  ores: Array<[index: number, densities: Record<string, number>]>;
}

/** Any payload a save may carry. `decodeVoxelGrid` upgrades v6 in place. */
export type AnySerializedVoxels = SerializedVoxels | SerializedVoxelsV6;

/** Run-length encode a byte stream as (count, value) pairs. Runs longer than 255 split into multiple pairs. */
export function rleEncode(src: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < src.length) {
    let run = 1;
    while (i + run < src.length && src[i + run] === src[i] && run < 255) run++;
    out.push(run, src[i]!);
    i += run;
  }
  return new Uint8Array(out);
}

/** Inverse of rleEncode. Throws if the decoded length doesn't match expectedLength (corrupt save). */
export function rleDecode(src: Uint8Array, expectedLength: number): Uint8Array {
  const out = new Uint8Array(expectedLength);
  let outIdx = 0;
  for (let i = 0; i < src.length; i += 2) {
    const run = src[i]!;
    const value = src[i + 1]!;
    for (let k = 0; k < run; k++) {
      if (outIdx >= expectedLength) {
        throw new Error('VoxelGridCodec: RLE stream longer than expected voxel count (corrupt save).');
      }
      out[outIdx++] = value;
    }
  }
  if (outIdx !== expectedLength) {
    throw new Error(`VoxelGridCodec: RLE stream decoded to ${outIdx} bytes, expected ${expectedLength} (corrupt save).`);
  }
  return out;
}

function typedArrayBytes(view: Float64Array | Uint16Array): Uint8Array {
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

/** Voxels in one chunk's storage. */
function chunkVoxelCount(sizeY: number): number {
  return CHUNK_SIZE * sizeY * CHUNK_SIZE;
}

/**
 * Encode a grid. Passing `gen` — the config the grid was generated from —
 * keeps pristine chunks out of the payload entirely; omitting it stores
 * every chunk voxel-by-voxel, which is correct but large.
 */
export function encodeVoxelGrid(grid: VoxelGrid, gen?: SerializedTerrainGen): SerializedVoxels {
  const pristine: SerializedVoxels['pristine'] = [];
  const chunks: SerializedChunk[] = [];

  for (const { cx, cz } of grid.ownedChunks()) {
    const raw = grid.rawChunk(cx, cz)!;
    const { minX, minZ, maxX, maxZ } = raw.rect;

    if (gen && !grid.isChunkDirty(cx, cz)) {
      pristine.push([cx, cz, minX, minZ, maxX, maxZ]);
      continue;
    }

    chunks.push({
      cx, cz,
      r: [minX, minZ, maxX, maxZ],
      density: bytesToBase64(rleEncode(typedArrayBytes(raw.density))),
      compId: bytesToBase64(rleEncode(typedArrayBytes(raw.compId))),
      fracture: bytesToBase64(rleEncode(typedArrayBytes(raw.fracture))),
      ores: raw.oreEntries,
    });
  }

  return {
    v: 7,
    sizeY: grid.sizeY,
    palette: grid.palette.toArray(),
    pristine,
    chunks,
    ...(gen ? { gen } : {}),
  };
}

function decodeChunkInto(grid: VoxelGrid, sizeY: number, chunk: SerializedChunk): void {
  const n = chunkVoxelCount(sizeY);
  const densityBytes = rleDecode(base64ToBytes(chunk.density), n * 8);
  const compIdBytes = rleDecode(base64ToBytes(chunk.compId), n * 2);
  const fractureBytes = rleDecode(base64ToBytes(chunk.fracture), n * 8);

  grid.restoreChunkRaw(
    chunk.cx, chunk.cz,
    { minX: chunk.r[0], minZ: chunk.r[1], maxX: chunk.r[2], maxZ: chunk.r[3] },
    new Float64Array(densityBytes.buffer, densityBytes.byteOffset, n),
    new Uint16Array(compIdBytes.buffer, compIdBytes.byteOffset, n),
    new Float64Array(fractureBytes.buffer, fractureBytes.byteOffset, n),
    new Map(chunk.ores),
  );
  grid.markChunkDirty(chunk.cx, chunk.cz);
}

/**
 * Decode a v6 dense payload into a chunked grid.
 *
 * The dense layout indexed from the origin with `x + y*sizeX + z*sizeX*sizeY`,
 * so a straight per-voxel copy through the public mutators is the honest
 * upgrade: it reproduces exactly the site a v6 save described, at the same
 * coordinates, with every edge chunk clipped to the old rect.
 */
function decodeV6(payload: SerializedVoxelsV6): VoxelGrid {
  const { sizeX, sizeY, sizeZ } = payload;
  const grid = new VoxelGrid(sizeX, sizeY, sizeZ);
  for (const comp of payload.palette) grid.palette.intern(comp);

  const n = sizeX * sizeY * sizeZ;
  const densityBytes = rleDecode(base64ToBytes(payload.density), n * 8);
  const compIdBytes = rleDecode(base64ToBytes(payload.compId), n * 2);
  const fractureBytes = rleDecode(base64ToBytes(payload.fracture), n * 8);

  const density = new Float64Array(densityBytes.buffer, densityBytes.byteOffset, n);
  const compId = new Uint16Array(compIdBytes.buffer, compIdBytes.byteOffset, n);
  const fracture = new Float64Array(fractureBytes.buffer, fractureBytes.byteOffset, n);
  const ores = new Map(payload.ores);

  for (let z = 0; z < sizeZ; z++) {
    for (let y = 0; y < sizeY; y++) {
      for (let x = 0; x < sizeX; x++) {
        const i = x + y * sizeX + z * sizeX * sizeY;
        const d = density[i]!;
        const f = fracture[i]!;
        const c = compId[i]!;
        const ore = ores.get(i);
        if (d === 0 && f === 1 && c === 0 && !ore) continue;
        grid.fillVoxel(x, y, z, c, ore, d);
        if (f !== 1) grid.setFractureAt(x, y, z, f);
      }
    }
  }
  return grid;
}

export function decodeVoxelGrid(payload: AnySerializedVoxels): VoxelGrid {
  if (payload.v === 6) return decodeV6(payload);

  // Empty shell: chunks arrive one at a time below, each carrying its own rect.
  const grid = new VoxelGrid(0, payload.sizeY, 0);
  // Palette first, so a regenerated pristine chunk's interns land on the ids
  // the stored dirty chunks' compIds already reference.
  for (const comp of payload.palette) grid.palette.intern(comp);

  for (const chunk of payload.chunks) decodeChunkInto(grid, payload.sizeY, chunk);

  if (payload.pristine.length > 0) {
    if (!payload.gen) {
      throw new Error('VoxelGridCodec: payload claims pristine chunks but carries no generation datum (corrupt save).');
    }
    const config: TerrainConfig = {
      seed: payload.gen.seed,
      climateBias: payload.gen.climateBias,
      sizeX: payload.gen.sizeX,
      sizeY: payload.gen.sizeY,
      sizeZ: payload.gen.sizeZ,
      ...(payload.gen.mixedRockHardness !== undefined ? { mixedRockHardness: payload.gen.mixedRockHardness } : {}),
    };
    const terrain = buildTerrainContext(config);
    for (const [cx, cz, minX, minZ, maxX, maxZ] of payload.pristine) {
      // The tuple comes straight from untrusted save JSON — clamp it once,
      // here, and hand the SAME clamped rect to both consumers below.
      // addChunkWithRect also clamps internally, but returns void, so its
      // clamped rect never reaches this caller; without this, an extreme
      // raw value (e.g. 1e12) would reach generateTerrainRegion's column
      // loop directly and hang it (#609).
      const clamped = clampChunkRectToTile(cx, cz, { minX, minZ, maxX, maxZ });
      grid.addChunkWithRect(cx, cz, clamped);
      generateTerrainRegion(grid, terrain, config, clamped);
      grid.markChunkPristine(cx, cz);
    }
  }

  return grid;
}
