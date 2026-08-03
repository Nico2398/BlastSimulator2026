// BlastSimulator2026 — Voxel grid save serialization (#458 T0.3)
// Encodes a VoxelGrid's raw typed-array storage into a compact, JSON-embeddable
// payload (byte-level RLE + base64) and decodes it back. This is what lets a
// save preserve actual terrain mutations (blast craters, ramps) instead of
// discarding them and regenerating pristine terrain from the seed on load.

import { VoxelGrid, type VoxelRockComposition } from '../world/VoxelGrid.js';
import { bytesToBase64, base64ToBytes } from './Base64.js';

export interface SerializedVoxels {
  v: 6;
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  /** Index-aligned with VoxelGrid's internal palette; index 0 is always air. */
  palette: VoxelRockComposition[];
  /** base64(rle(raw Float64 bytes)) */
  density: string;
  /** base64(rle(raw Uint16 bytes, little-endian)) */
  compId: string;
  /** base64(rle(raw Float64 bytes)) */
  fracture: string;
  /** Sparse: only voxels carrying at least one ore. */
  ores: Array<[index: number, densities: Record<string, number>]>;
}

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

export function encodeVoxelGrid(grid: VoxelGrid): SerializedVoxels {
  return {
    v: 6,
    sizeX: grid.sizeX,
    sizeY: grid.sizeY,
    sizeZ: grid.sizeZ,
    palette: grid.palette.toArray(),
    density: bytesToBase64(rleEncode(typedArrayBytes(grid.rawDensity))),
    compId: bytesToBase64(rleEncode(typedArrayBytes(grid.rawCompId))),
    fracture: bytesToBase64(rleEncode(typedArrayBytes(grid.rawFracture))),
    ores: grid.rawOreEntries,
  };
}

export function decodeVoxelGrid(payload: SerializedVoxels): VoxelGrid {
  const grid = new VoxelGrid(payload.sizeX, payload.sizeY, payload.sizeZ);
  for (const comp of payload.palette) grid.palette.intern(comp);

  const n = payload.sizeX * payload.sizeY * payload.sizeZ;
  const densityBytes = rleDecode(base64ToBytes(payload.density), n * 8);
  const compIdBytes = rleDecode(base64ToBytes(payload.compId), n * 2);
  const fractureBytes = rleDecode(base64ToBytes(payload.fracture), n * 8);

  grid.restoreRaw(
    new Float64Array(densityBytes.buffer, densityBytes.byteOffset, n),
    new Uint16Array(compIdBytes.buffer, compIdBytes.byteOffset, n),
    new Float64Array(fractureBytes.buffer, fractureBytes.byteOffset, n),
    new Map(payload.ores),
  );
  return grid;
}
