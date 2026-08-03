import { describe, it, expect } from 'vitest';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import { rleEncode, rleDecode, encodeVoxelGrid, decodeVoxelGrid } from '../../../src/core/state/VoxelGridCodec.js';

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

  it('rejects a payload whose encoded length does not match sizeX*sizeY*sizeZ', () => {
    const grid = new VoxelGrid(2, 2, 2);
    const payload = encodeVoxelGrid(grid);
    const corrupt = { ...payload, sizeX: 100 };
    expect(() => decodeVoxelGrid(corrupt)).toThrow(/corrupt save/i);
  });
});
