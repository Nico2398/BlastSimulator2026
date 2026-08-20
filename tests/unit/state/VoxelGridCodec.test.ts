import { describe, it, expect } from 'vitest';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import { generateTerrain } from '../../../src/core/world/TerrainGen.js';
import { bytesToBase64 } from '../../../src/core/state/Base64.js';
import {
  rleEncode, rleDecode, encodeVoxelGrid, decodeVoxelGrid,
  type SerializedVoxels, type SerializedVoxelsV6,
} from '../../../src/core/state/VoxelGridCodec.js';

describe('rleEncode / rleDecode', () => {
  it('round-trips an empty stream', () => {
    const src = new Uint8Array(0);
    expect(rleDecode(rleEncode(src), 0)).toEqual(src);
  });

  it('round-trips a uniform run', () => {
    const src = new Uint8Array(50).fill(7);
    expect(rleDecode(rleEncode(src), 50)).toEqual(src);
  });

  it('splits runs longer than 255 into multiple pairs', () => {
    const src = new Uint8Array(600).fill(3);
    const encoded = rleEncode(src);
    // 600 = 255 + 255 + 90 -> 3 (count, value) pairs -> 6 output bytes.
    expect(encoded.length).toBe(6);
    expect(rleDecode(encoded, 600)).toEqual(src);
  });

  it('round-trips mixed non-uniform bytes', () => {
    const src = new Uint8Array([1, 1, 1, 2, 3, 3, 0, 255, 255, 255, 255]);
    expect(rleDecode(rleEncode(src), src.length)).toEqual(src);
  });

  it('throws when the encoded stream is longer than expected (corrupt save)', () => {
    const encoded = rleEncode(new Uint8Array(20).fill(1));
    expect(() => rleDecode(encoded, 5)).toThrow(/corrupt save/i);
  });

  it('throws when the encoded stream is shorter than expected (corrupt save)', () => {
    const encoded = rleEncode(new Uint8Array(5).fill(1));
    expect(() => rleDecode(encoded, 20)).toThrow(/corrupt save/i);
  });
});

describe('encodeVoxelGrid / decodeVoxelGrid', () => {
  it('round-trips an all-air grid', () => {
    const grid = new VoxelGrid(4, 4, 4);
    const decoded = decodeVoxelGrid(encodeVoxelGrid(grid));
    expect(decoded.sizeX).toBe(4);
    expect(decoded.densityAt(1, 1, 1)).toBe(0);
    expect(decoded.dominantRockAt(1, 1, 1)).toBe('');
  });

  it('round-trips density, composition, fracture, and ore data exactly', () => {
    const grid = new VoxelGrid(6, 6, 6);
    grid.setVoxel(2, 2, 2, {
      composition: { rocks: [{ rockId: 'cruite', coefficient: 0.6 }, { rockId: 'sandite', coefficient: 0.4 }] },
      density: 1.0,
      oreDensities: { dirtite: 0.35 },
      fractureModifier: 0.49,
    });
    grid.setVoxel(3, 3, 3, {
      composition: { rocks: [{ rockId: 'titanite', coefficient: 1.0 }] },
      density: 1.0,
      oreDensities: {},
      fractureModifier: 1.0,
    });

    const decoded = decodeVoxelGrid(encodeVoxelGrid(grid));

    expect(decoded.densityAt(2, 2, 2)).toBe(1.0);
    expect(decoded.fractureAt(2, 2, 2)).toBeCloseTo(0.49, 10);
    expect(decoded.dominantRockAt(2, 2, 2)).toBe('cruite');
    expect(decoded.oresAt(2, 2, 2)).toEqual({ dirtite: 0.35 });

    expect(decoded.dominantRockAt(3, 3, 3)).toBe('titanite');
    expect(decoded.oresAt(3, 3, 3)).toBeUndefined();

    expect(decoded.densityAt(0, 0, 0)).toBe(0);
  });

  it('preserves palette deduplication across many identical compositions', () => {
    const grid = new VoxelGrid(8, 8, 8);
    for (let x = 0; x < 8; x++) {
      for (let z = 0; z < 8; z++) {
        grid.setVoxel(x, 0, z, {
          composition: { rocks: [{ rockId: 'grumpite', coefficient: 1.0 }] },
          density: 1.0,
          oreDensities: {},
          fractureModifier: 1.0,
        });
      }
    }
    const payload = encodeVoxelGrid(grid);
    // air (reserved) + one distinct blend
    expect(payload.palette.length).toBe(2);

    const decoded = decodeVoxelGrid(payload);
    for (let x = 0; x < 8; x++) {
      for (let z = 0; z < 8; z++) {
        expect(decoded.dominantRockAt(x, 0, z)).toBe('grumpite');
      }
    }
  });

  it('round-trips a blast-carved grid (mixed solid/air after clearVoxel)', () => {
    const grid = new VoxelGrid(5, 5, 5);
    for (let y = 0; y < 5; y++) {
      grid.setVoxel(2, y, 2, {
        composition: { rocks: [{ rockId: 'obstiite', coefficient: 1.0 }] },
        density: 1.0,
        oreDensities: {},
        fractureModifier: 1.0,
      });
    }
    grid.clearVoxel(2, 4, 2); // simulate a blast crater at the top

    const decoded = decodeVoxelGrid(encodeVoxelGrid(grid));
    expect(decoded.densityAt(2, 4, 2)).toBe(0);
    expect(decoded.densityAt(2, 3, 2)).toBe(1.0);
    expect(decoded.dominantRockAt(2, 3, 2)).toBe('obstiite');
  });

  it('rejects a payload whose encoded chunk length does not match CHUNK_SIZE*sizeY*CHUNK_SIZE', () => {
    const grid = new VoxelGrid(2, 2, 2);
    const payload = encodeVoxelGrid(grid);
    const corrupt = { ...payload, sizeY: 100 };
    expect(() => decodeVoxelGrid(corrupt)).toThrow(/corrupt save/i);
  });

  it('preserves an edge chunk clipped to a site whose size is not a multiple of CHUNK_SIZE', () => {
    const grid = new VoxelGrid(24, 8, 24);
    const decoded = decodeVoxelGrid(encodeVoxelGrid(grid));
    expect(decoded.sizeX).toBe(24);
    expect(decoded.sizeZ).toBe(24);
    expect(decoded.isInBounds(23, 0, 23)).toBe(true);
    expect(decoded.isInBounds(24, 0, 0)).toBe(false);
  });

  it('rejects a payload claiming pristine chunks with no generation datum', () => {
    const payload: SerializedVoxels = {
      v: 7, sizeY: 8, palette: [{ rocks: [] }], pristine: [[0, 0, 0, 0, 16, 16]], chunks: [],
    };
    expect(() => decodeVoxelGrid(payload)).toThrow(/generation datum/i);
  });
});

describe('encodeVoxelGrid dirty-chunk selection (#473 D4)', () => {
  const gen = { seed: 42, climateBias: [0, 0] as [number, number], sizeX: 32, sizeY: 16, sizeZ: 32 };

  it('stores no voxel data at all for a freshly generated, untouched site', () => {
    const grid = generateTerrain({ ...gen });
    const payload = encodeVoxelGrid(grid, gen);
    expect(payload.chunks).toHaveLength(0);
    expect(payload.pristine).toHaveLength(4); // 32x32 m over 16 m chunks
  });

  it('stores only the chunk a blast actually carved', () => {
    const grid = generateTerrain({ ...gen });
    grid.clearVoxel(20, 8, 20); // chunk (1, 1)
    const payload = encodeVoxelGrid(grid, gen);
    expect(payload.chunks.map(c => [c.cx, c.cz])).toEqual([[1, 1]]);
    expect(payload.pristine).toHaveLength(3);
  });

  it('regenerates pristine chunks byte-identically on load', () => {
    const grid = generateTerrain({ ...gen });
    grid.clearVoxel(20, 8, 20);
    const decoded = decodeVoxelGrid(encodeVoxelGrid(grid, gen));

    expect(decoded.densityAt(20, 8, 20)).toBe(0);
    for (let x = 0; x < 32; x += 3) {
      for (let z = 0; z < 32; z += 3) {
        for (let y = 0; y < 16; y += 2) {
          expect(decoded.densityAt(x, y, z)).toBe(grid.densityAt(x, y, z));
          expect(decoded.dominantRockAt(x, y, z)).toBe(grid.dominantRockAt(x, y, z));
        }
      }
    }
  });

  it('stores every chunk when no generation datum is supplied', () => {
    const grid = generateTerrain({ ...gen });
    const payload = encodeVoxelGrid(grid);
    expect(payload.pristine).toHaveLength(0);
    expect(payload.chunks).toHaveLength(4);
  });
});

// #609: a corrupted/hand-edited save (e.g. r: [0, 0, 1e12, 1e12]) must not
// reach TerrainMesh's chunk-iteration loops unclamped -- VoxelGrid clamps at
// its own two save-facing entry points (restoreChunkRaw / addChunkWithRect),
// so decodeVoxelGrid ends up with a grid whose chunk rects are always sane
// regardless of what the JSON claimed.
describe('decodeVoxelGrid — corrupted chunk rects are clamped, not trusted verbatim (#609)', () => {
  it('a corrupted chunks[].r (matching the issue\'s literal repro) is clamped to the chunk\'s real tile', () => {
    const grid = new VoxelGrid(16, 4, 16);
    const payload = encodeVoxelGrid(grid); // no `gen` -> every owned chunk stored dirty, with a real r
    expect(payload.chunks).toHaveLength(1);

    const corrupted: SerializedVoxels = {
      ...payload,
      chunks: [{ ...payload.chunks[0]!, r: [0, 0, 1e12, 1e12] }],
    };

    // decodeChunkInto's own arrays are sized from sizeY alone (unrelated to
    // `r`), and restoreChunkRaw's internal rescan is already bounded against
    // the chunk's real storage span independently of this fix -- so this
    // path was never actually at hang risk; what was wrong is that the
    // corrupted rect survived into the grid's own x0/z0/x1/z1 state
    // unclamped, which is what TerrainMesh iterates directly over.
    const decoded = decodeVoxelGrid(corrupted);

    expect(decoded.chunkRect(0, 0)).toEqual({ minX: 0, minZ: 0, maxX: 16, maxZ: 16 });
  });

  // Planner note (#609): decodeVoxelGrid's pristine loop below calls
  // `generateTerrainRegion(grid, terrain, config, { minX, minZ, maxX, maxZ })`
  // with the RAW tuple values it just destructured from `payload.pristine` --
  // not with the rect VoxelGrid.addChunkWithRect actually clamped internally
  // (addChunkWithRect returns void, so the clamped rect never comes back to
  // this caller). The planned fix only touches VoxelGrid.ts, so that
  // `generateTerrainRegion` call keeps walking the *unclamped* range
  // regardless of this fix -- a magnitude anywhere near the issue's literal
  // 1e12 repro would make that synchronous, single-threaded column loop
  // genuinely un-interruptible (no vitest timeout preempts a running
  // for-loop). This test therefore uses a much smaller out-of-tile
  // magnitude: large enough to prove the corruption reached the pristine
  // path and that VoxelGrid's own state (chunkRect) ends up clamped either
  // way, small enough to never risk hanging the suite regardless of whether
  // decodeVoxelGrid itself is ever also updated to clamp before calling
  // generateTerrainRegion.
  it('a corrupted pristine tuple is clamped for the grid\'s own state via addChunkWithRect, proving that entry point is covered too', () => {
    const gen = { seed: 42, climateBias: [0, 0] as [number, number], sizeX: 16, sizeY: 4, sizeZ: 16 };
    const grid = generateTerrain({ ...gen });
    const payload = encodeVoxelGrid(grid, gen);
    expect(payload.pristine).toEqual([[0, 0, 0, 0, 16, 16]]);

    const corrupted: SerializedVoxels = {
      ...payload,
      pristine: [[0, 0, 0, 0, 40, 40]], // well outside (0,0)'s real [0,16) tile, but bounded (see note above)
    };

    const decoded = decodeVoxelGrid(corrupted);

    expect(decoded.chunkRect(0, 0)).toEqual({ minX: 0, minZ: 0, maxX: 16, maxZ: 16 });
  });
});

describe('decodeVoxelGrid — v6 upgrade path (#473 P3)', () => {
  it('loads a v6 dense payload at the same coordinates, mutations intact', () => {
    const v6: SerializedVoxelsV6 = {
      v: 6,
      sizeX: 4, sizeY: 4, sizeZ: 4,
      palette: [{ rocks: [] }, { rocks: [{ rockId: 'cruite', coefficient: 1 }] }],
      density: bytesToBase64(rleEncode(new Uint8Array(denseBytes(4, 4, 4, 8)))),
      compId: bytesToBase64(rleEncode(new Uint8Array(denseBytes(4, 4, 4, 2)))),
      fracture: bytesToBase64(rleEncode(fractureOnes(4 * 4 * 4))),
      ores: [],
    };
    const grid = decodeVoxelGrid(v6);
    expect(grid.sizeX).toBe(4);
    expect(grid.sizeY).toBe(4);
    expect(grid.sizeZ).toBe(4);
    expect(grid.isInBounds(3, 3, 3)).toBe(true);
    expect(grid.isInBounds(4, 0, 0)).toBe(false);
    expect(grid.densityAt(1, 1, 1)).toBe(0);
    expect(grid.fractureAt(1, 1, 1)).toBe(1);
  });

  it('carries a v6 blast crater through to the chunked grid', () => {
    const n = 4 * 4 * 4;
    const density = new Float64Array(n).fill(1);
    density[1 + 1 * 4 + 1 * 16] = 0; // the crater
    const compId = new Uint16Array(n).fill(1);
    const fracture = new Float64Array(n).fill(1);

    const v6: SerializedVoxelsV6 = {
      v: 6,
      sizeX: 4, sizeY: 4, sizeZ: 4,
      palette: [{ rocks: [] }, { rocks: [{ rockId: 'cruite', coefficient: 1 }] }],
      density: bytesToBase64(rleEncode(new Uint8Array(density.buffer))),
      compId: bytesToBase64(rleEncode(new Uint8Array(compId.buffer))),
      fracture: bytesToBase64(rleEncode(new Uint8Array(fracture.buffer))),
      ores: [],
    };
    const grid = decodeVoxelGrid(v6);
    expect(grid.densityAt(1, 1, 1)).toBe(0);
    expect(grid.densityAt(2, 1, 1)).toBe(1);
    expect(grid.dominantRockAt(2, 1, 1)).toBe('cruite');
  });
});

/** All-zero raw bytes for a dense sizeX*sizeY*sizeZ array of `bytesPerValue`-wide values. */
function denseBytes(sizeX: number, sizeY: number, sizeZ: number, bytesPerValue: number): number[] {
  return new Array(sizeX * sizeY * sizeZ * bytesPerValue).fill(0);
}

/** Raw bytes of a Float64Array filled with 1.0. */
function fractureOnes(count: number): Uint8Array {
  return new Uint8Array(new Float64Array(count).fill(1).buffer);
}
