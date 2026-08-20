import { describe, it, expect } from 'vitest';
import {
  VoxelGrid,
  getDominantRockId,
  CompositionPalette,
  computeVoxelColumnSurfaceY,
  computeVoxelColumnSurfaceHeight,
  setVoxelBoundsReporter,
  chunkIndexOf,
  clampChunkRectToTile,
  CHUNK_SIZE,
} from '../../../src/core/world/VoxelGrid.js';

describe('VoxelGrid', () => {
  describe('CELL_SIZE', () => {
    it('is exactly 1 metre', () => {
      expect(VoxelGrid.CELL_SIZE).toBe(1);
    });

    it('is a finite number', () => {
      expect(Number.isFinite(VoxelGrid.CELL_SIZE)).toBe(true);
    });

    it('is positive', () => {
      expect(VoxelGrid.CELL_SIZE).toBeGreaterThan(0);
    });
  });

  it('set and get a voxel at specific coordinates', () => {
    const grid = new VoxelGrid(10, 10, 10);
    grid.setVoxel(3, 4, 5, {
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      density: 0.9,
      oreDensities: { dirtite: 0.3 },
      fractureModifier: 1.0,
    });
    const v = grid.getVoxel(3, 4, 5);
    expect(v).toBeDefined();
    expect(v!.composition.rocks[0]!.rockId).toBe('cruite');
    expect(v!.composition.rocks[0]!.coefficient).toBe(1.0);
    expect(v!.density).toBe(0.9);
    expect(v!.oreDensities['dirtite']).toBe(0.3);
  });

  it('clearVoxel sets density to 0 and composition to empty', () => {
    const grid = new VoxelGrid(10, 10, 10);
    grid.setVoxel(1, 1, 1, {
      composition: { rocks: [{ rockId: 'grumpite', coefficient: 1.0 }] },
      density: 0.8,
      oreDensities: {},
      fractureModifier: 1.0,
    });
    grid.clearVoxel(1, 1, 1);
    const v = grid.getVoxel(1, 1, 1);
    expect(v!.density).toBe(0);
    expect(v!.composition.rocks.length).toBe(0);
  });

  it('getRegion returns all voxels in a bounding box', () => {
    const grid = new VoxelGrid(10, 10, 10);
    grid.setVoxel(2, 2, 2, { composition: { rocks: [{ rockId: 'a', coefficient: 1.0 }] }, density: 1, oreDensities: {}, fractureModifier: 1 });
    grid.setVoxel(3, 3, 3, { composition: { rocks: [{ rockId: 'b', coefficient: 1.0 }] }, density: 1, oreDensities: {}, fractureModifier: 1 });
    grid.setVoxel(5, 5, 5, { composition: { rocks: [{ rockId: 'c', coefficient: 1.0 }] }, density: 1, oreDensities: {}, fractureModifier: 1 });

    const region = grid.getRegion({ x: 2, y: 2, z: 2 }, { x: 3, y: 3, z: 3 });
    const nonEmpty = region.filter(v => v.data.density > 0);
    expect(nonEmpty.length).toBe(2);
  });

  it('isInBounds correctly rejects out-of-range coordinates', () => {
    const grid = new VoxelGrid(10, 10, 10);
    expect(grid.isInBounds(0, 0, 0)).toBe(true);
    expect(grid.isInBounds(9, 9, 9)).toBe(true);
    expect(grid.isInBounds(10, 0, 0)).toBe(false);
    expect(grid.isInBounds(-1, 0, 0)).toBe(false);
    expect(grid.isInBounds(0, -1, 0)).toBe(false);
    expect(grid.isInBounds(0, 0, 10)).toBe(false);
  });

  it('grid correctly stores ore density per voxel', () => {
    const grid = new VoxelGrid(5, 5, 5);
    grid.setVoxel(1, 1, 1, {
      composition: { rocks: [{ rockId: 'stubite', coefficient: 1.0 }] },
      density: 0.7,
      oreDensities: { sparkium: 0.5, blingite: 0.2 },
      fractureModifier: 0.9,
    });
    const v = grid.getVoxel(1, 1, 1);
    expect(v!.oreDensities['sparkium']).toBe(0.5);
    expect(v!.oreDensities['blingite']).toBe(0.2);
  });

  it('unset voxels return empty default', () => {
    const grid = new VoxelGrid(5, 5, 5);
    const v = grid.getVoxel(0, 0, 0);
    expect(v!.density).toBe(0);
    expect(v!.composition.rocks.length).toBe(0);
  });

  it('getDominantRockId returns correct rock for single-rock composition', () => {
    const comp = { rocks: [{ rockId: 'titanite', coefficient: 1.0 }] };
    expect(getDominantRockId(comp)).toBe('titanite');
  });

  it('getDominantRockId returns highest coefficient rock for multi-rock composition', () => {
    const comp = {
      rocks: [
        { rockId: 'sandite', coefficient: 0.2 },
        { rockId: 'molite', coefficient: 0.5 },
        { rockId: 'cruite', coefficient: 0.3 },
      ],
    };
    expect(getDominantRockId(comp)).toBe('molite');
  });

  it('getDominantRockId returns empty string for empty composition', () => {
    expect(getDominantRockId({ rocks: [] })).toBe('');
  });
});

describe('chunkIndexOf', () => {
  it('floors toward negative infinity, so a west-of-origin coordinate lands in the chunk before 0', () => {
    expect(chunkIndexOf(0)).toBe(0);
    expect(chunkIndexOf(CHUNK_SIZE - 1)).toBe(0);
    expect(chunkIndexOf(CHUNK_SIZE)).toBe(1);
    expect(chunkIndexOf(-1)).toBe(-1);
    expect(chunkIndexOf(-CHUNK_SIZE)).toBe(-1);
    expect(chunkIndexOf(-CHUNK_SIZE - 1)).toBe(-2);
  });

  it('ignores the fractional part of a continuous coordinate', () => {
    expect(chunkIndexOf(17.9)).toBe(1);
    expect(chunkIndexOf(-0.5)).toBe(-1);
  });
});

// #609: VoxelGridCodec.decodeChunkInto forwards `chunk.r` from parsed save
// JSON straight into VoxelGrid with no validation against the grid's real
// dimensions. clampChunkRectToTile is the one shared function that validates
// a chunk's owned sub-rect against its own tile before VoxelGrid accepts it
// from untrusted save data (restoreChunkRaw / addChunkWithRect below).
describe('clampChunkRectToTile', () => {
  it('leaves a well-formed rect already inside the chunk\'s own tile unchanged', () => {
    const rect = { minX: 0, minZ: 0, maxX: CHUNK_SIZE, maxZ: CHUNK_SIZE };
    expect(clampChunkRectToTile(0, 0, rect)).toEqual({ minX: 0, minZ: 0, maxX: CHUNK_SIZE, maxZ: CHUNK_SIZE });
  });

  it('leaves a legitimately partial edge-chunk rect unchanged', () => {
    const rect = { minX: 0, minZ: 0, maxX: 9, maxZ: CHUNK_SIZE };
    expect(clampChunkRectToTile(0, 0, rect)).toEqual({ minX: 0, minZ: 0, maxX: 9, maxZ: CHUNK_SIZE });
  });

  it('#609: clamps the issue\'s literal repro (maxX/maxZ ~1e12) down to the chunk\'s own tile', () => {
    const rect = { minX: 0, minZ: 0, maxX: 1e12, maxZ: 1e12 };
    expect(clampChunkRectToTile(0, 0, rect)).toEqual({ minX: 0, minZ: 0, maxX: CHUNK_SIZE, maxZ: CHUNK_SIZE });
  });

  it('clamps a bound far below the tile up to the tile\'s own low edge, not to 0', () => {
    const rect = { minX: -1e12, minZ: 0, maxX: CHUNK_SIZE, maxZ: CHUNK_SIZE };
    expect(clampChunkRectToTile(0, 0, rect).minX).toBe(0);
  });

  it('a chunk far from the origin clamps a below-range minX up to THAT chunk\'s own tile edge, not to 0', () => {
    const rect = { minX: -1e12, minZ: 32, maxX: 48, maxZ: 48 };
    const result = clampChunkRectToTile(2, 2, rect); // chunk (2,2)'s tile is x/z in [32, 48)
    expect(result.minX).toBe(32);
  });

  it('forces maxX to equal minX (never inverted) when independent clamping leaves maxX < minX', () => {
    const rect = { minX: 20, minZ: 0, maxX: 5, maxZ: CHUNK_SIZE };
    const result = clampChunkRectToTile(0, 0, rect);
    // minX: round(20) clamped into [0,16] -> 16. maxX: round(5) clamped into [0,16] -> 5.
    // 5 < 16, so maxX is forced up to minX rather than staying inverted.
    expect(result.minX).toBe(16);
    expect(result.maxX).toBe(16);
  });

  it('forces maxZ to equal minZ symmetrically', () => {
    const rect = { minX: 0, minZ: 20, maxX: CHUNK_SIZE, maxZ: 5 };
    const result = clampChunkRectToTile(0, 0, rect);
    expect(result.minZ).toBe(16);
    expect(result.maxZ).toBe(16);
  });

  describe('non-finite bounds fall back to their own tile edge, independently, per axis', () => {
    it('NaN minX falls back to the tile\'s low X edge', () => {
      const rect = { minX: NaN, minZ: 0, maxX: CHUNK_SIZE, maxZ: CHUNK_SIZE };
      expect(clampChunkRectToTile(0, 0, rect).minX).toBe(0);
    });
    it('NaN maxX falls back to the tile\'s high X edge', () => {
      const rect = { minX: 0, minZ: 0, maxX: NaN, maxZ: CHUNK_SIZE };
      expect(clampChunkRectToTile(0, 0, rect).maxX).toBe(CHUNK_SIZE);
    });
    it('NaN minZ falls back to the tile\'s low Z edge', () => {
      const rect = { minX: 0, minZ: NaN, maxX: CHUNK_SIZE, maxZ: CHUNK_SIZE };
      expect(clampChunkRectToTile(0, 0, rect).minZ).toBe(0);
    });
    it('NaN maxZ falls back to the tile\'s high Z edge', () => {
      const rect = { minX: 0, minZ: 0, maxX: CHUNK_SIZE, maxZ: NaN };
      expect(clampChunkRectToTile(0, 0, rect).maxZ).toBe(CHUNK_SIZE);
    });
    it('NaN in all four positions falls back to the full tile, never propagating NaN into the result', () => {
      const rect = { minX: NaN, minZ: NaN, maxX: NaN, maxZ: NaN };
      const result = clampChunkRectToTile(0, 0, rect);
      expect(Number.isNaN(result.minX)).toBe(false);
      expect(Number.isNaN(result.minZ)).toBe(false);
      expect(Number.isNaN(result.maxX)).toBe(false);
      expect(Number.isNaN(result.maxZ)).toBe(false);
      expect(result).toEqual({ minX: 0, minZ: 0, maxX: CHUNK_SIZE, maxZ: CHUNK_SIZE });
    });
  });

  describe('Infinity / -Infinity bounds fall back exactly like NaN', () => {
    it('+Infinity minX falls back to the tile\'s low X edge', () => {
      const rect = { minX: Infinity, minZ: 0, maxX: CHUNK_SIZE, maxZ: CHUNK_SIZE };
      expect(clampChunkRectToTile(0, 0, rect).minX).toBe(0);
    });
    it('-Infinity minX also falls back to the tile\'s low X edge (not to -Infinity clamped)', () => {
      const rect = { minX: -Infinity, minZ: 0, maxX: CHUNK_SIZE, maxZ: CHUNK_SIZE };
      expect(clampChunkRectToTile(0, 0, rect).minX).toBe(0);
    });
    it('+Infinity maxX falls back to the tile\'s high X edge', () => {
      const rect = { minX: 0, minZ: 0, maxX: Infinity, maxZ: CHUNK_SIZE };
      expect(clampChunkRectToTile(0, 0, rect).maxX).toBe(CHUNK_SIZE);
    });
    it('-Infinity maxX also falls back to the tile\'s high X edge (not to the low edge)', () => {
      const rect = { minX: 0, minZ: 0, maxX: -Infinity, maxZ: CHUNK_SIZE };
      expect(clampChunkRectToTile(0, 0, rect).maxX).toBe(CHUNK_SIZE);
    });
    it('+Infinity minZ falls back to the tile\'s low Z edge', () => {
      const rect = { minX: 0, minZ: Infinity, maxX: CHUNK_SIZE, maxZ: CHUNK_SIZE };
      expect(clampChunkRectToTile(0, 0, rect).minZ).toBe(0);
    });
    it('-Infinity maxZ falls back to the tile\'s high Z edge', () => {
      const rect = { minX: 0, minZ: 0, maxX: CHUNK_SIZE, maxZ: -Infinity };
      expect(clampChunkRectToTile(0, 0, rect).maxZ).toBe(CHUNK_SIZE);
    });
  });

  it('rounds a non-integer minX via Math.round before clamping (round vs. truncate diverge here)', () => {
    // round(15.6) = 16 (stays 16 after clamping to [0,16]); Math.trunc(15.6)
    // would give 15 instead -- a different final value, so this assertion is
    // only meaningful under Math.round.
    const rect = { minX: 15.6, minZ: 0, maxX: CHUNK_SIZE, maxZ: CHUNK_SIZE };
    expect(clampChunkRectToTile(0, 0, rect).minX).toBe(16);
  });

  it('rounds a non-integer maxX via Math.round before clamping, independently of minX', () => {
    // round(7.6) = 8; Math.trunc(7.6) would give 7 instead -- both values sit
    // within [0,16], so the final clamped result differs by which is used.
    const rect = { minX: 0, minZ: 0, maxX: 7.6, maxZ: CHUNK_SIZE };
    expect(clampChunkRectToTile(0, 0, rect).maxX).toBe(8);
  });

  it('clamps a rect that is a valid finite rect for a DIFFERENT chunk\'s tile into this chunk\'s own tile, rather than accepting it as-is', () => {
    // {minX:16,...,maxX:32,...} is exactly chunk (1,1)'s own tile, not (0,0)'s.
    const rect = { minX: 16, minZ: 16, maxX: 32, maxZ: 32 };
    const result = clampChunkRectToTile(0, 0, rect);
    expect(result).toEqual({ minX: 16, minZ: 16, maxX: 16, maxZ: 16 }); // collapsed onto (0,0)'s own high edge
  });

  it('treats a non-number value at runtime (corrupted JSON bypassing TS types) as non-finite and falls back to the tile edge', () => {
    const rect = {
      minX: ('16' as unknown as number),
      minZ: 0,
      maxX: CHUNK_SIZE,
      maxZ: CHUNK_SIZE,
    };
    expect(clampChunkRectToTile(0, 0, rect).minX).toBe(0);
  });
});

// #609: restoreChunkRaw and addChunkWithRect are the two entry points
// untrusted save data reaches VoxelGrid through -- both must route their
// `rect` argument through clampChunkRectToTile before assigning it onto the
// chunk, so a corrupted save rect can never leave chunk.x0/z0/x1/z1 wider
// than the chunk's own CHUNK_SIZE tile.
describe('VoxelGrid — clamps untrusted rects reaching restoreChunkRaw / addChunkWithRect (#609)', () => {
  it('restoreChunkRaw clamps a corrupted rect (matching the issue\'s repro) into the chunk\'s own tile', () => {
    const grid = new VoxelGrid(16, 4, 16);
    const n = CHUNK_SIZE * grid.sizeY * CHUNK_SIZE;
    const density = new Float64Array(n);
    const compId = new Uint16Array(n);
    const fracture = new Float64Array(n).fill(1.0);

    grid.restoreChunkRaw(0, 0, { minX: 0, minZ: 0, maxX: 1e12, maxZ: 1e12 }, density, compId, fracture, new Map());

    expect(grid.chunkRect(0, 0)).toEqual({ minX: 0, minZ: 0, maxX: CHUNK_SIZE, maxZ: CHUNK_SIZE });
  });

  it('addChunkWithRect clamps a corrupted rect into the chunk\'s own tile', () => {
    const grid = new VoxelGrid(0, 4, 0); // empty shell, same starting point decodeVoxelGrid builds
    grid.addChunkWithRect(0, 0, { minX: 0, minZ: 0, maxX: 1e12, maxZ: 1e12 });

    expect(grid.chunkRect(0, 0)).toEqual({ minX: 0, minZ: 0, maxX: CHUNK_SIZE, maxZ: CHUNK_SIZE });
  });

  it('addChunkWithRect on an already-owned chunk also clamps, not just on first allocation', () => {
    const grid = new VoxelGrid(16, 4, 16); // owns chunk (0,0) already, full tile
    grid.addChunkWithRect(0, 0, { minX: -1e12, minZ: 0, maxX: CHUNK_SIZE, maxZ: CHUNK_SIZE });

    expect(grid.chunkRect(0, 0)).toEqual({ minX: 0, minZ: 0, maxX: CHUNK_SIZE, maxZ: CHUNK_SIZE });
  });
});

describe('CompositionPalette', () => {
  it('interns an empty composition as index 0', () => {
    const palette = new CompositionPalette();
    expect(palette.intern({ rocks: [] })).toBe(0);
    expect(palette.get(0).comp.rocks.length).toBe(0);
    expect(palette.get(0).dominantRockId).toBe('');
  });

  it('interns equivalent compositions to the same index regardless of input order', () => {
    const palette = new CompositionPalette();
    const a = palette.intern({ rocks: [{ rockId: 'cruite', coefficient: 0.6 }, { rockId: 'sandite', coefficient: 0.4 }] });
    const b = palette.intern({ rocks: [{ rockId: 'sandite', coefficient: 0.4 }, { rockId: 'cruite', coefficient: 0.6 }] });
    expect(a).toBe(b);
    expect(palette.size).toBe(2); // air (0) + this one blend
  });

  it('gives distinct compositions distinct indices', () => {
    const palette = new CompositionPalette();
    const a = palette.intern({ rocks: [{ rockId: 'cruite', coefficient: 1.0 }] });
    const b = palette.intern({ rocks: [{ rockId: 'sandite', coefficient: 1.0 }] });
    expect(a).not.toBe(b);
  });

  it('quantizes coefficients to the nearest 0.01 for dedup purposes', () => {
    const palette = new CompositionPalette();
    const a = palette.intern({ rocks: [{ rockId: 'cruite', coefficient: 0.60001 }] });
    const b = palette.intern({ rocks: [{ rockId: 'cruite', coefficient: 0.60004 }] });
    expect(a).toBe(b);
  });

  it('precomputes the dominant rock id at intern time', () => {
    const palette = new CompositionPalette();
    const id = palette.intern({ rocks: [{ rockId: 'cruite', coefficient: 0.3 }, { rockId: 'sandite', coefficient: 0.7 }] });
    expect(palette.get(id).dominantRockId).toBe('sandite');
  });

  it('returns the air entry for an out-of-range index', () => {
    const palette = new CompositionPalette();
    expect(palette.get(9999).comp.rocks.length).toBe(0);
  });

  it('returned composition objects are frozen (immutability contract)', () => {
    const palette = new CompositionPalette();
    const id = palette.intern({ rocks: [{ rockId: 'cruite', coefficient: 1.0 }] });
    const comp = palette.get(id).comp;
    expect(Object.isFrozen(comp)).toBe(true);
    expect(Object.isFrozen(comp.rocks)).toBe(true);
    expect(() => { (comp.rocks as unknown as unknown[]).push({ rockId: 'x', coefficient: 1 }); }).toThrow();
  });
});

describe('VoxelGrid direct accessors', () => {
  it('densityAt / isSolidAt / fractureAt / dominantRockAt / compositionAt / oresAt round-trip through setVoxel', () => {
    const grid = new VoxelGrid(5, 5, 5);
    grid.setVoxel(2, 2, 2, {
      composition: { rocks: [{ rockId: 'molite', coefficient: 1.0 }] },
      density: 0.8,
      oreDensities: { rustite: 0.4 },
      fractureModifier: 0.6,
    });
    expect(grid.densityAt(2, 2, 2)).toBe(0.8);
    expect(grid.isSolidAt(2, 2, 2)).toBe(true);
    expect(grid.fractureAt(2, 2, 2)).toBe(0.6);
    expect(grid.dominantRockAt(2, 2, 2)).toBe('molite');
    expect(grid.compositionAt(2, 2, 2).rocks[0]!.rockId).toBe('molite');
    expect(grid.oresAt(2, 2, 2)).toEqual({ rustite: 0.4 });
  });

  it('isSolidAt is false below the 0.5 density threshold', () => {
    const grid = new VoxelGrid(5, 5, 5);
    grid.setVoxel(1, 1, 1, { composition: { rocks: [{ rockId: 'cruite', coefficient: 1 }] }, density: 0.4, oreDensities: {}, fractureModifier: 1 });
    expect(grid.isSolidAt(1, 1, 1)).toBe(false);
  });

  it('out-of-bounds accessors return safe defaults instead of throwing', () => {
    const grid = new VoxelGrid(5, 5, 5);
    expect(grid.densityAt(-1, 0, 0)).toBe(0);
    expect(grid.isSolidAt(99, 0, 0)).toBe(false);
    expect(grid.fractureAt(0, -1, 0)).toBe(1.0);
    expect(grid.dominantRockAt(0, 0, 99)).toBe('');
    expect(grid.compositionAt(-1, -1, -1).rocks.length).toBe(0);
    expect(grid.oresAt(-1, 0, 0)).toBeUndefined();
  });

  it('unset voxels have no ore entry (oresAt returns undefined, not an empty object)', () => {
    const grid = new VoxelGrid(5, 5, 5);
    expect(grid.oresAt(0, 0, 0)).toBeUndefined();
  });
});

describe('VoxelGrid direct mutators', () => {
  it('fillVoxel sets density to 1.0 with the given palette index and ores', () => {
    const grid = new VoxelGrid(5, 5, 5);
    const compId = grid.palette.intern({ rocks: [{ rockId: 'stubite', coefficient: 1.0 }] });
    grid.fillVoxel(1, 1, 1, compId, { blingite: 0.3 });
    expect(grid.densityAt(1, 1, 1)).toBe(1.0);
    expect(grid.dominantRockAt(1, 1, 1)).toBe('stubite');
    expect(grid.oresAt(1, 1, 1)).toEqual({ blingite: 0.3 });
  });

  it('fillVoxel with no ores leaves oresAt undefined', () => {
    const grid = new VoxelGrid(5, 5, 5);
    const compId = grid.palette.intern({ rocks: [{ rockId: 'stubite', coefficient: 1.0 }] });
    grid.fillVoxel(1, 1, 1, compId);
    expect(grid.oresAt(1, 1, 1)).toBeUndefined();
  });

  it('fillVoxel out of bounds is a silent no-op', () => {
    const grid = new VoxelGrid(5, 5, 5);
    expect(() => grid.fillVoxel(99, 0, 0, 0)).not.toThrow();
  });

  it('setFractureAt overwrites the fracture modifier', () => {
    const grid = new VoxelGrid(5, 5, 5);
    grid.setFractureAt(1, 1, 1, 0.42);
    expect(grid.fractureAt(1, 1, 1)).toBe(0.42);
  });

  it('scaleFractureAt multiplies the existing fracture modifier in place', () => {
    const grid = new VoxelGrid(5, 5, 5);
    grid.setFractureAt(1, 1, 1, 1.0);
    grid.scaleFractureAt(1, 1, 1, 0.7);
    expect(grid.fractureAt(1, 1, 1)).toBeCloseTo(0.7, 10);
    grid.scaleFractureAt(1, 1, 1, 0.7);
    expect(grid.fractureAt(1, 1, 1)).toBeCloseTo(0.49, 10);
  });

  it('clearVoxel resets fractureAt to 1.0 and removes ores', () => {
    const grid = new VoxelGrid(5, 5, 5);
    grid.setVoxel(1, 1, 1, { composition: { rocks: [{ rockId: 'cruite', coefficient: 1 }] }, density: 1, oreDensities: { dirtite: 0.5 }, fractureModifier: 0.3 });
    grid.clearVoxel(1, 1, 1);
    expect(grid.fractureAt(1, 1, 1)).toBe(1.0);
    expect(grid.oresAt(1, 1, 1)).toBeUndefined();
  });
});

describe('VoxelGrid — chunked storage and signed coordinates (#473 P0)', () => {
  it('reports the constructor size as the bounding box, even when it does not divide by CHUNK_SIZE', () => {
    const grid = new VoxelGrid(24, 8, 24);
    expect(grid.sizeX).toBe(24);
    expect(grid.sizeZ).toBe(24);
    expect(grid.minX).toBe(0);
    expect(grid.minZ).toBe(0);
    expect(grid.maxX).toBe(24);
    expect(grid.isInBounds(23, 0, 23)).toBe(true);
    expect(grid.isInBounds(24, 0, 0)).toBe(false);
  });

  it('allocates one chunk per CHUNK_SIZE square of the starting site', () => {
    expect(new VoxelGrid(32, 8, 32).chunkCount).toBe(4);
    expect(new VoxelGrid(24, 8, 24).chunkCount).toBe(4);
    expect(new VoxelGrid(16, 8, 16).chunkCount).toBe(1);
  });

  it('addChunk extends the bounding box westward with negative coordinates', () => {
    const grid = new VoxelGrid(16, 8, 16);
    const rect = grid.addChunk(-1, 0);
    expect(rect).toEqual({ minX: -16, minZ: 0, maxX: 0, maxZ: 16 });
    expect(grid.minX).toBe(-16);
    expect(grid.sizeX).toBe(32);
  });

  it('stores and reads a voxel at a negative coordinate', () => {
    const grid = new VoxelGrid(16, 8, 16);
    grid.addChunk(-1, -1);
    grid.setVoxel(-5, 3, -5, {
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1 }] },
      density: 0.75,
      oreDensities: {},
      fractureModifier: 1,
    });
    expect(grid.densityAt(-5, 3, -5)).toBe(0.75);
    expect(grid.dominantRockAt(-5, 3, -5)).toBe('cruite');
  });

  it('addChunk on a partially owned edge chunk promotes it to its full span', () => {
    const grid = new VoxelGrid(24, 8, 24);
    expect(grid.isChunkPartial(1, 1)).toBe(true);
    expect(grid.isInBounds(28, 0, 28)).toBe(false);

    const rect = grid.addChunk(1, 1);
    expect(rect).toEqual({ minX: 16, minZ: 16, maxX: 32, maxZ: 32 });
    expect(grid.isChunkPartial(1, 1)).toBe(false);
    expect(grid.isInBounds(28, 0, 28)).toBe(true);
  });

  it('addChunk on an already-full chunk reports nothing changed', () => {
    const grid = new VoxelGrid(32, 8, 32);
    expect(grid.addChunk(0, 0)).toBeNull();
  });

  it('a bounding-box column the site does not own reads as air, not as a bounds error', () => {
    const grid = new VoxelGrid(16, 8, 16);
    grid.addChunk(1, 1); // an L: (0,0) and (1,1), so (1,0) sits in the box unowned
    expect(grid.sizeX).toBe(32);
    expect(grid.containsColumn(20, 4)).toBe(false);
    expect(grid.densityAt(20, 4, 4)).toBe(0);
  });

  it('reports out-of-bounds reads to an installed reporter, and nothing else', () => {
    const grid = new VoxelGrid(16, 8, 16);
    const misses: Array<[number, number, number]> = [];
    const previous = setVoxelBoundsReporter((x, y, z) => { misses.push([x, y, z]); });
    try {
      grid.densityAt(4, 4, 4);
      grid.densityAt(-1, 4, 4);
      grid.densityAt(4, 99, 4);
    } finally {
      setVoxelBoundsReporter(previous);
    }
    expect(misses).toEqual([[-1, 4, 4], [4, 99, 4]]);
  });
});

describe('VoxelGrid — dirty-chunk tracking (#473 D4)', () => {
  it('marks a chunk dirty on any write', () => {
    const grid = new VoxelGrid(32, 8, 32);
    grid.markChunkPristine(0, 0);
    grid.markChunkPristine(1, 0);
    grid.clearVoxel(20, 1, 1);
    expect(grid.isChunkDirty(1, 0)).toBe(true);
    expect(grid.isChunkDirty(0, 0)).toBe(false);
  });

  it('markChunkPristine takes a chunk back out of the dirty set', () => {
    const grid = new VoxelGrid(16, 8, 16);
    grid.setFractureAt(1, 1, 1, 0.5);
    expect(grid.isChunkDirty(0, 0)).toBe(true);
    grid.markChunkPristine(0, 0);
    expect(grid.dirtyChunks()).toEqual([]);
  });

  it('markChunkDirty is a no-op for a chunk the site does not own', () => {
    const grid = new VoxelGrid(16, 8, 16);
    grid.markChunkPristine(0, 0);
    grid.markChunkDirty(5, 5);
    expect(grid.dirtyChunks()).toEqual([]);
  });
});

describe('VoxelGrid.chunkDensityRange — per-chunk per-slab density summary (#560)', () => {
  it('returns {min:0, max:0} for a freshly claimed, ungenerated chunk', () => {
    const grid = new VoxelGrid(32, 8, 32); // 2x2 chunks, sizeY=8 -> nSlabs=1
    expect(grid.chunkDensityRange(0, 0, 0)).toEqual({ min: 0, max: 0 });
    expect(grid.chunkDensityRange(1, 1, 0)).toEqual({ min: 0, max: 0 });
  });

  it('widens min/max to include fillVoxel, setVoxel, and clearVoxel writes into a given y-slab', () => {
    const grid = new VoxelGrid(16, 8, 16); // 1 chunk, nSlabs=1
    expect(grid.chunkDensityRange(0, 0, 0)).toEqual({ min: 0, max: 0 });

    const compId = grid.palette.intern({ rocks: [{ rockId: 'cruite', coefficient: 1 }] });
    grid.fillVoxel(1, 1, 1, compId); // density defaults to 1.0
    expect(grid.chunkDensityRange(0, 0, 0)).toEqual({ min: 0, max: 1 });

    grid.setVoxel(2, 2, 2, {
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1 }] },
      density: 0.4,
      oreDensities: {},
      fractureModifier: 1,
    });
    expect(grid.chunkDensityRange(0, 0, 0)).toEqual({ min: 0, max: 1 }); // 0.4 is within the already-observed [0,1] range

    grid.clearVoxel(1, 1, 1); // density -> 0, but the summary never narrows back down
    expect(grid.chunkDensityRange(0, 0, 0)).toEqual({ min: 0, max: 1 });
  });

  it('once a slab is observed mixed (min=0, max=1), a later write that would locally narrow it leaves the summary widened', () => {
    const grid = new VoxelGrid(16, 8, 16);
    const compId = grid.palette.intern({ rocks: [{ rockId: 'cruite', coefficient: 1 }] });
    grid.fillVoxel(5, 5, 5, compId); // density 1.0 -> widens the slab to {min:0, max:1}
    expect(grid.chunkDensityRange(0, 0, 0)).toEqual({ min: 0, max: 1 });

    // A write of a mid-range density, taken in isolation, would suggest a
    // narrower [0.3, 0.3] range for this one voxel -- but the slab's own
    // summary must stay at its already-widened [0, 1], not shrink to match
    // the most recent write.
    grid.setVoxel(6, 5, 5, {
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1 }] },
      density: 0.3,
      oreDensities: {},
      fractureModifier: 1,
    });
    expect(grid.chunkDensityRange(0, 0, 0)).toEqual({ min: 0, max: 1 });
  });

  it('restoreChunkRaw fully rescans the density summary rather than leaving it stale', () => {
    const grid = new VoxelGrid(16, 8, 16); // 1 chunk, nSlabs=1
    const n = CHUNK_SIZE * grid.sizeY * CHUNK_SIZE;
    // Every restored voxel counts toward the rescan (even the ones left at
    // their default), so the array must be filled throughout: a mostly-zero
    // array's true minimum really is 0, not whatever floor value a couple of
    // cells happen to poke — that would be asserting a bound the input data
    // doesn't actually have.
    const density = new Float64Array(n).fill(0.15);
    const compId = new Uint16Array(n);
    const fracture = new Float64Array(n).fill(1.0);
    // Local index formula mirrors VoxelGrid's own: lx + y*CHUNK_SIZE + lz*CHUNK_SIZE*sizeY.
    const idx = (lx: number, y: number, lz: number): number => lx + y * CHUNK_SIZE + lz * CHUNK_SIZE * grid.sizeY;
    density[idx(1, 1, 1)] = 0.85;

    grid.restoreChunkRaw(0, 0, { minX: 0, minZ: 0, maxX: CHUNK_SIZE, maxZ: CHUNK_SIZE }, density, compId, fracture, new Map());

    expect(grid.chunkDensityRange(0, 0, 0)).toEqual({ min: 0.15, max: 0.85 });
  });

  it("returns null for an unowned chunk, and for a slab index past the grid's height", () => {
    const grid = new VoxelGrid(16, 8, 16); // nSlabs = ceil(8/16) = 1 -> only slab 0 exists
    expect(grid.chunkDensityRange(5, 5, 0)).toBeNull(); // chunk (5,5) was never claimed
    expect(grid.chunkDensityRange(0, 0, 1)).toBeNull(); // slab 1 doesn't exist for an 8-tall grid
  });
});

describe('computeVoxelColumnSurfaceY', () => {
  it('finds the highest solid voxel in a column', () => {
    const grid = new VoxelGrid(16, 8, 16);
    grid.fillVoxel(3, 0, 3, 0, undefined, 1);
    grid.fillVoxel(3, 4, 3, 0, undefined, 1);
    expect(computeVoxelColumnSurfaceY(grid, 3, 3)).toBe(4);
  });

  it('returns -1 for a column with nothing solid in it', () => {
    expect(computeVoxelColumnSurfaceY(new VoxelGrid(16, 8, 16), 3, 3)).toBe(-1);
  });

  it('clamps to the site edge rather than the origin once the site has grown west', () => {
    const grid = new VoxelGrid(16, 8, 16);
    grid.addChunk(-1, 0);
    grid.fillVoxel(-16, 2, 0, 0, undefined, 1);
    expect(computeVoxelColumnSurfaceY(grid, -99, 0)).toBe(2);
  });
});

describe('computeVoxelColumnSurfaceHeight (#491)', () => {
  it('matches computeVoxelColumnSurfaceY\'s column, at the half-voxel crossing for a clean solid-to-air boundary', () => {
    const grid = new VoxelGrid(16, 8, 16);
    grid.fillVoxel(3, 0, 3, 0, undefined, 1);
    grid.fillVoxel(3, 4, 3, 0, undefined, 1); // topmost solid at y=4; y=5 stays air (density 0)
    expect(computeVoxelColumnSurfaceY(grid, 3, 3)).toBe(4);
    // t = (0.5 - 1.0) / (0.0 - 1.0) = 0.5 -> crossing at y=4.5, exactly the
    // same half-voxel offset TerrainMesh's marching cubes places there.
    expect(computeVoxelColumnSurfaceHeight(grid, 3, 3)).toBeCloseTo(4.5, 6);
  });

  it('interpolates a fractional (non-half) crossing height when the voxel above the topmost solid one is partially filled', () => {
    const grid = new VoxelGrid(16, 8, 16);
    const compId = grid.palette.intern({ rocks: [{ rockId: 'cruite', coefficient: 1 }] });
    grid.fillVoxel(3, 4, 3, compId, undefined, 1.0);
    grid.fillVoxel(3, 5, 3, compId, undefined, 0.3);
    // t = (0.5 - 1.0) / (0.3 - 1.0) = 5/7 -> crossing at y = 4 + 5/7.
    expect(computeVoxelColumnSurfaceHeight(grid, 3, 3)).toBeCloseTo(4 + 5 / 7, 6);
  });

  // #559: an out-of-grid column used to clamp to the nearest edge column,
  // which handed LandscapeMesh a plausible-looking but wrong height for a
  // column the site doesn't actually own — the false "answers honestly"
  // requirement in #559's root cause 3. NaN is the honest answer: "this
  // column has no data", distinguishable from a real (possibly zero) height.
  it('#559: answers NaN for a column outside every owned chunk, rather than clamping to the site edge', () => {
    const grid = new VoxelGrid(16, 8, 16);
    grid.addChunk(-1, 0);
    grid.fillVoxel(-16, 2, 0, 0, undefined, 1);
    expect(Number.isNaN(computeVoxelColumnSurfaceHeight(grid, -99, 0))).toBe(true);
  });

  it('#559: still answers NaN for an out-of-grid column even when sizeX/sizeZ are non-empty (not just the empty-grid early return)', () => {
    const grid = new VoxelGrid(16, 8, 16);
    grid.fillVoxel(3, 4, 3, 0, undefined, 1);
    expect(Number.isNaN(computeVoxelColumnSurfaceHeight(grid, 99, 3))).toBe(true);
    expect(Number.isNaN(computeVoxelColumnSurfaceHeight(grid, 3, -99))).toBe(true);
  });

  it('#559: an in-bounds column right at the site edge still answers a real (non-NaN) height', () => {
    const grid = new VoxelGrid(16, 8, 16);
    grid.fillVoxel(15, 4, 15, 0, undefined, 1);
    expect(computeVoxelColumnSurfaceHeight(grid, 15, 15)).toBeCloseTo(4.5, 6);
  });

  it('returns 0 for a column with no solid voxel at all', () => {
    expect(computeVoxelColumnSurfaceHeight(new VoxelGrid(16, 8, 16), 3, 3)).toBe(0);
  });
});

describe('VoxelGrid.claimsColumnForMeshing (#559 root cause 4)', () => {
  it('is true for every column the site owns', () => {
    const grid = new VoxelGrid(16, 8, 16);
    expect(grid.claimsColumnForMeshing(0, 0)).toBe(true);
    expect(grid.claimsColumnForMeshing(15, 15)).toBe(true);
    expect(grid.claimsColumnForMeshing(8, 3)).toBe(true);
  });

  it('is true for the single-voxel west halo column TerrainMesh marches into when nothing owns the chunk to the west', () => {
    const grid = new VoxelGrid(16, 8, 16); // one chunk, (0,0); no chunk at (-1,0)
    expect(grid.claimsColumnForMeshing(-1, 5)).toBe(true);
  });

  it('is true for the single-voxel north halo column, symmetrically', () => {
    const grid = new VoxelGrid(16, 8, 16); // no chunk at (0,-1)
    expect(grid.claimsColumnForMeshing(5, -1)).toBe(true);
  });

  it('is false two columns west of the site edge — the halo is exactly one voxel wide', () => {
    const grid = new VoxelGrid(16, 8, 16);
    expect(grid.claimsColumnForMeshing(-2, 5)).toBe(false);
  });

  it('is false diagonally past the corner — the halo never extends diagonally', () => {
    const grid = new VoxelGrid(16, 8, 16);
    expect(grid.claimsColumnForMeshing(-1, -1)).toBe(false);
  });

  it('is false just past the east edge — TerrainMesh seals that side from its own last owned cube, no halo needed', () => {
    const grid = new VoxelGrid(16, 8, 16);
    expect(grid.claimsColumnForMeshing(16, 5)).toBe(false);
  });

  it('is false just past the south edge, symmetrically with east', () => {
    const grid = new VoxelGrid(16, 8, 16);
    expect(grid.claimsColumnForMeshing(5, 16)).toBe(false);
  });

  describe('on an irregular (L-shaped) grid, the halo is per-chunk, not just at the whole grid\'s bounding box', () => {
    // Chunk (0,0) at x:0..15/z:0..15 and chunk (1,1) at x:16..31/z:16..31 are
    // owned; chunk (1,0) (x:16..31/z:0..15) is not — the same L shape the
    // existing "a bounding-box column the site does not own reads as air"
    // VoxelGrid test above builds.
    function lShapedGrid(): VoxelGrid {
      const grid = new VoxelGrid(16, 8, 16);
      grid.addChunk(1, 1);
      return grid;
    }

    it('is true for a column owned by either chunk', () => {
      const grid = lShapedGrid();
      expect(grid.claimsColumnForMeshing(5, 5)).toBe(true); // chunk (0,0)
      expect(grid.claimsColumnForMeshing(20, 20)).toBe(true); // chunk (1,1)
    });

    it('is true for chunk (0,0)\'s own west/north halo', () => {
      const grid = lShapedGrid();
      expect(grid.claimsColumnForMeshing(-1, 5)).toBe(true);
      expect(grid.claimsColumnForMeshing(5, -1)).toBe(true);
    });

    it('is true for chunk (1,1)\'s own west/north halo, one voxel outside its own rect — even though that halo sits inside the grid\'s overall bounding box', () => {
      const grid = lShapedGrid();
      // Chunk (0,1) (the neighbour west of (1,1)) is not owned, so (1,1)
      // marches its own west halo at x=15, within z:16..31 — a column no
      // owned chunk actually covers (chunk (0,0) only owns z:0..15 at x=15).
      expect(grid.claimsColumnForMeshing(15, 20)).toBe(true);
      // Chunk (1,0) (the neighbour north of (1,1)) is not owned, so (1,1)
      // marches its own north halo at z=15, within x:16..31.
      expect(grid.claimsColumnForMeshing(20, 15)).toBe(true);
    });

    it('is false just past the unowned notch\'s own outer edges — no chunk owns them and no halo reaches them', () => {
      const grid = lShapedGrid();
      expect(grid.claimsColumnForMeshing(16, 5)).toBe(false); // east of chunk (0,0), inside the unowned notch
      expect(grid.claimsColumnForMeshing(5, 16)).toBe(false); // south of chunk (0,0), inside the unowned notch
    });

    it('is false past chunk (1,1)\'s own east/south edges — self-sealed, no halo', () => {
      const grid = lShapedGrid();
      expect(grid.claimsColumnForMeshing(32, 20)).toBe(false);
      expect(grid.claimsColumnForMeshing(20, 32)).toBe(false);
    });
  });
});

describe('VoxelGrid.forEachSolid / forEachSolidInRegion', () => {
  it('forEachSolid visits every solid voxel exactly once and skips air', () => {
    const grid = new VoxelGrid(4, 4, 4);
    grid.setVoxel(1, 1, 1, { composition: { rocks: [{ rockId: 'a', coefficient: 1 }] }, density: 1, oreDensities: {}, fractureModifier: 1 });
    grid.setVoxel(2, 2, 2, { composition: { rocks: [{ rockId: 'b', coefficient: 1 }] }, density: 1, oreDensities: {}, fractureModifier: 1 });
    const visited: Array<[number, number, number]> = [];
    grid.forEachSolid((x, y, z) => visited.push([x, y, z]));
    expect(visited.length).toBe(2);
    expect(visited).toContainEqual([1, 1, 1]);
    expect(visited).toContainEqual([2, 2, 2]);
  });

  it('forEachSolidInRegion only visits solid voxels within the given bounding box', () => {
    const grid = new VoxelGrid(6, 6, 6);
    grid.setVoxel(1, 1, 1, { composition: { rocks: [{ rockId: 'a', coefficient: 1 }] }, density: 1, oreDensities: {}, fractureModifier: 1 });
    grid.setVoxel(5, 5, 5, { composition: { rocks: [{ rockId: 'b', coefficient: 1 }] }, density: 1, oreDensities: {}, fractureModifier: 1 });
    const visited: Array<[number, number, number]> = [];
    grid.forEachSolidInRegion({ x: 0, y: 0, z: 0 }, { x: 3, y: 3, z: 3 }, (x, y, z) => visited.push([x, y, z]));
    expect(visited).toEqual([[1, 1, 1]]);
  });

  it('forEachSolidInRegion on an empty box calls the callback zero times', () => {
    const grid = new VoxelGrid(4, 4, 4);
    let calls = 0;
    grid.forEachSolidInRegion({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, () => { calls++; });
    expect(calls).toBe(0);
  });
});
