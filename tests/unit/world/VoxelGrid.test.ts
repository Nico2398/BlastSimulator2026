import { describe, it, expect } from 'vitest';
import {
  VoxelGrid,
  getDominantRockId,
  CompositionPalette,
  computeVoxelColumnSurfaceY,
  computeVoxelColumnSurfaceHeight,
  setVoxelColumnSurfaceHeight,
  renormaliseVoxelColumnAfterCarve,
  captureColumnTopsForCarve,
  renormaliseCarvedColumns,
  setVoxelBoundsReporter,
  chunkIndexOf,
  clampChunkRectToTile,
  CHUNK_SIZE,
} from '../../../src/core/world/VoxelGrid.js';
import { generateTerrain, type TerrainConfig } from '../../../src/core/world/TerrainGen.js';

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

// #609: addChunkWithRect is the one entry point untrusted save data reaches
// VoxelGrid through (decodeVoxelGrid calls it directly, never a raw dense
// restore) -- it must route its `rect` argument through clampChunkRectToTile
// before assigning it onto the chunk, so a corrupted save rect can never
// leave chunk.x0/z0/x1/z1 wider than the chunk's own CHUNK_SIZE tile.
// A third entry point, restoreChunkRaw (the dense v6/v7 chunk-restore path),
// carried the same clamp and its own repro of this invariant, but was
// deleted as dead code once #1181 replaced dense chunk saves with the
// generator-identity + edit-record scheme -- addChunkWithRect's own coverage
// below (both first-allocation and already-owned cases) is the sole
// remaining, and fully equivalent, guard.
describe('VoxelGrid — clamps untrusted rects reaching addChunkWithRect (#609)', () => {
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

  // A prior version of this suite covered "restoreChunkRaw fully rescans the
  // density summary rather than leaving it stale": restoreChunkRaw accepted
  // a whole dense density/compId/fracture array wholesale (the v6/v7 chunk
  // save format), so it had to rebuild slabMinDensity/slabMaxDensity/
  // slabTouchedCount from that array itself rather than trust whatever the
  // chunk's summary already said. #1181 deleted that dense-restore format
  // (and restoreChunkRaw with it) in favour of regenerate-then-replay-edits;
  // decodeVoxelGrid's surviving path (addChunkWithRect, then
  // generateTerrainRegion + replayTerrainEdits) writes every voxel through
  // fillVoxel/setVoxel, and both unconditionally call touchDensity (#560) on
  // every write. There is no entry point left that can populate density data
  // while bypassing touchDensity, so the "stale summary" failure mode this
  // test guarded against is no longer reachable — the invariant is now a
  // structural guarantee of fillVoxel/setVoxel rather than a runtime case to
  // exercise through a since-deleted bulk-restore method.

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

describe('setVoxelColumnSurfaceHeight (#1143)', () => {
  it('rounds a column previously solid well above the target down to a fractional height', () => {
    const grid = new VoxelGrid(16, 16, 16);
    const compId = grid.palette.intern({ rocks: [{ rockId: 'cruite', coefficient: 1 }] });
    for (let y = 0; y <= 10; y++) grid.fillVoxel(3, y, 3, compId, undefined, 1);

    setVoxelColumnSurfaceHeight(grid, 3, 3, 5.3, compId);

    expect(computeVoxelColumnSurfaceHeight(grid, 3, 3)).toBeCloseTo(5.3, 6);
  });

  it('raises a column previously low (mostly air) up to a fractional height', () => {
    const grid = new VoxelGrid(16, 16, 16);
    const compId = grid.palette.intern({ rocks: [{ rockId: 'cruite', coefficient: 1 }] });
    grid.fillVoxel(3, 0, 3, compId, undefined, 1);
    grid.fillVoxel(3, 1, 3, compId, undefined, 1);

    setVoxelColumnSurfaceHeight(grid, 3, 3, 5.3, compId);

    expect(computeVoxelColumnSurfaceHeight(grid, 3, 3)).toBeCloseTo(5.3, 6);
  });

  it('an integer target height round-trips to exactly that integer for a column previously higher', () => {
    // The literal #1143 bug: a boolean-style carve down to an integer height
    // used to leave the readback at 24.5 (or some other stray fraction), not
    // the 24 that was actually written.
    const grid = new VoxelGrid(16, 32, 16);
    const compId = grid.palette.intern({ rocks: [{ rockId: 'cruite', coefficient: 1 }] });
    for (let y = 0; y <= 28; y++) grid.fillVoxel(3, y, 3, compId, undefined, 1);

    setVoxelColumnSurfaceHeight(grid, 3, 3, 24, compId);

    expect(computeVoxelColumnSurfaceHeight(grid, 3, 3)).toBe(24);
  });

  it('an integer target height round-trips to exactly that integer for a column previously lower', () => {
    const grid = new VoxelGrid(16, 32, 16);
    const compId = grid.palette.intern({ rocks: [{ rockId: 'cruite', coefficient: 1 }] });
    grid.fillVoxel(3, 0, 3, compId, undefined, 1);

    setVoxelColumnSurfaceHeight(grid, 3, 3, 24, compId);

    expect(computeVoxelColumnSurfaceHeight(grid, 3, 3)).toBe(24);
  });

  it('leaves zero density above the touched band', () => {
    const grid = new VoxelGrid(16, 20, 16);
    const compId = grid.palette.intern({ rocks: [{ rockId: 'cruite', coefficient: 1 }] });
    for (let y = 0; y <= 15; y++) grid.fillVoxel(3, y, 3, compId, undefined, 1);

    setVoxelColumnSurfaceHeight(grid, 3, 3, 8.4, compId);

    for (let y = Math.ceil(8.4) + 2; y <= grid.sizeY - 1; y++) {
      expect(grid.densityAt(3, y, 3), `density at y=${y} should be exactly 0`).toBe(0);
    }
  });

  it('leaves rock strictly below the touched band fully solid and untouched', () => {
    const grid = new VoxelGrid(16, 20, 16);
    const lowCompId = grid.palette.intern({ rocks: [{ rockId: 'grumpite', coefficient: 1 }] });
    const targetCompId = grid.palette.intern({ rocks: [{ rockId: 'cruite', coefficient: 1 }] });
    grid.fillVoxel(3, 0, 3, lowCompId, undefined, 1);
    grid.fillVoxel(3, 1, 3, lowCompId, undefined, 1);

    setVoxelColumnSurfaceHeight(grid, 3, 3, 12.7, targetCompId);

    // The write itself actually happened...
    expect(computeVoxelColumnSurfaceHeight(grid, 3, 3)).toBeCloseTo(12.7, 6);
    // ...without disturbing the rock well below the touched band.
    expect(grid.densityAt(3, 0, 3)).toBe(1);
    expect(grid.densityAt(3, 1, 3)).toBe(1);
    expect(grid.dominantRockAt(3, 0, 3)).toBe('grumpite');
    expect(grid.dominantRockAt(3, 1, 3)).toBe('grumpite');
  });

  it('two columns started in different states report identical computeVoxelColumnSurfaceHeight once written to the same fractional height', () => {
    const grid = new VoxelGrid(16, 20, 16);
    const compId = grid.palette.intern({ rocks: [{ rockId: 'cruite', coefficient: 1 }] });
    // Column A: previously solid well above the target.
    for (let y = 0; y <= 15; y++) grid.fillVoxel(3, y, 3, compId, undefined, 1);
    // Column B: previously low and uneven (a fractional crossing of its own).
    grid.fillVoxel(5, 0, 5, compId, undefined, 1);
    grid.fillVoxel(5, 3, 5, compId, undefined, 0.4);

    setVoxelColumnSurfaceHeight(grid, 3, 3, 12.7, compId);
    setVoxelColumnSurfaceHeight(grid, 5, 5, 12.7, compId);

    const heightA = computeVoxelColumnSurfaceHeight(grid, 3, 3);
    const heightB = computeVoxelColumnSurfaceHeight(grid, 5, 5);
    expect(heightA).toBeCloseTo(12.7, 6);
    expect(heightB).toBe(heightA);
  });

  it('preserves a buried overhang/cavity below the touched band', () => {
    const grid = new VoxelGrid(16, 16, 16);
    const crustCompId = grid.palette.intern({ rocks: [{ rockId: 'cruite', coefficient: 1 }] });
    const rockCompId = grid.palette.intern({ rocks: [{ rockId: 'grumpite', coefficient: 1 }] });
    // Buried solid rock.
    for (let y = 0; y <= 4; y++) grid.fillVoxel(3, y, 3, rockCompId, undefined, 1);
    // Air gap (cavity) — already air by default, cleared explicitly for clarity.
    for (let y = 5; y <= 7; y++) grid.clearVoxel(3, y, 3);
    // Solid crust at the top.
    for (let y = 8; y <= 10; y++) grid.fillVoxel(3, y, 3, crustCompId, undefined, 1);

    // Target stays within/near the existing crust — never reaches the gap or the rock below it.
    setVoxelColumnSurfaceHeight(grid, 3, 3, 9.5, crustCompId);

    // The write itself actually happened (crust surface moved down from 10.5 to 9.5)...
    expect(computeVoxelColumnSurfaceHeight(grid, 3, 3)).toBeCloseTo(9.5, 6);
    // ...without flattening the cavity or the rock buried beneath it.
    for (let y = 5; y <= 7; y++) {
      expect(grid.densityAt(3, y, 3), `cavity at y=${y} should still be air`).toBe(0);
    }
    for (let y = 0; y <= 4; y++) {
      expect(grid.densityAt(3, y, 3), `buried rock at y=${y} should still be solid`).toBe(1);
      expect(grid.dominantRockAt(3, y, 3)).toBe('grumpite');
    }
  });

  it('a column outside the grid bounds is a silent no-op', () => {
    const grid = new VoxelGrid(16, 16, 16);
    const compId = grid.palette.intern({ rocks: [{ rockId: 'cruite', coefficient: 1 }] });
    expect(grid.containsColumn(99, 99)).toBe(false);

    expect(() => setVoxelColumnSurfaceHeight(grid, 99, 99, 5, compId)).not.toThrow();

    expect(grid.containsColumn(99, 99)).toBe(false);
  });
});

// ── Post-carve renormalisation primitives (#1148) ───────────────────────────
//
// Mirrored home for renormaliseVoxelColumnAfterCarve, captureColumnTopsForCarve
// and renormaliseCarvedColumns, per core-purity's "exported function here means
// its unit test in the mirrored tests/unit/ path" rule. renormaliseVoxelColumnAfterCarve
// also gets end-to-end coverage through executeBlast in
// tests/unit/mining/VoxelFragmentation.test.ts and BlastExecution.test.ts — the
// tests below are the direct, standalone coverage this file itself owns.

describe('renormaliseVoxelColumnAfterCarve (#1148)', () => {
  it('returns null and touches nothing when the column\'s exposed top never moved', () => {
    const grid = new VoxelGrid(16, 16, 16);
    const compId = grid.palette.intern({ rocks: [{ rockId: 'cruite', coefficient: 1 }] });
    setVoxelColumnSurfaceHeight(grid, 3, 3, 5.5, compId);
    const oldTopY = computeVoxelColumnSurfaceY(grid, 3, 3);

    const before: number[] = [];
    for (let y = 0; y < grid.sizeY; y++) before.push(grid.densityAt(3, y, 3));

    const touched = renormaliseVoxelColumnAfterCarve(grid, 3, 3, oldTopY);

    expect(touched).toBeNull();
    for (let y = 0; y < grid.sizeY; y++) {
      expect(grid.densityAt(3, y, 3), `density at y=${y} should be unchanged`).toBe(before[y]!);
    }
  });

  it('SKIP branch: a plain fully solid new top is left as a hard step, no band manufactured', () => {
    const grid = new VoxelGrid(16, 16, 16);
    const compId = grid.palette.intern({ rocks: [{ rockId: 'cruite', coefficient: 1 }] });
    for (let y = 0; y <= 6; y++) grid.fillVoxel(3, y, 3, compId, undefined, 1);
    const oldTopY = computeVoxelColumnSurfaceY(grid, 3, 3);
    expect(oldTopY).toBe(6);

    grid.clearVoxel(3, 6, 3); // mirrors a fragmented-voxel carve clearing the old top

    const touched = renormaliseVoxelColumnAfterCarve(grid, 3, 3, oldTopY);

    const newTopY = computeVoxelColumnSurfaceY(grid, 3, 3);
    expect(newTopY).toBe(5);
    expect(grid.densityAt(3, newTopY, 3)).toBe(1);
    // No residue existed above the old top and the new top is plain solid rock,
    // so nothing needed clearing or regrading.
    expect(touched).toBeNull();
  });

  it('REGRADE branch: reconstructs a genuine mid-band crossing exposed by the carve', () => {
    const grid = new VoxelGrid(16, 16, 16);
    const compId = grid.palette.intern({ rocks: [{ rockId: 'cruite', coefficient: 1 }] });
    const X = 3, Z = 3;

    // Author a genuine fractional crossing at height 4.3...
    setVoxelColumnSurfaceHeight(grid, X, Z, 4.3, compId);
    // ...then stack a plain solid voxel above it — what the carve below removes,
    // exposing the already-graded crossing underneath as the new top.
    grid.fillVoxel(X, 6, Z, compId, undefined, 1);
    const oldTopY = computeVoxelColumnSurfaceY(grid, X, Z);
    expect(oldTopY).toBe(6);

    grid.clearVoxel(X, 6, Z); // mirrors the carve's clear loop

    const touched = renormaliseVoxelColumnAfterCarve(grid, X, Z, oldTopY);

    const newTopY = computeVoxelColumnSurfaceY(grid, X, Z);
    expect(newTopY).toBe(4);
    // The newly exposed top is itself mid-band (a genuine crossing), not plain rock.
    const newTopDensity = grid.densityAt(X, newTopY, Z);
    expect(newTopDensity).toBeGreaterThanOrEqual(0.5);
    expect(newTopDensity).toBeLessThan(1);

    const height = computeVoxelColumnSurfaceHeight(grid, X, Z);
    expect(Number.isFinite(height)).toBe(true);

    // A fresh, equivalent column written directly via setVoxelColumnSurfaceHeight
    // at the same height must read back identically, voxel by voxel.
    const control = new VoxelGrid(16, 16, 16);
    setVoxelColumnSurfaceHeight(control, X, Z, height, compId);
    for (let y = 0; y < grid.sizeY; y++) {
      expect(grid.densityAt(X, y, Z), `density at y=${y} should match a fresh write`)
        .toBeCloseTo(control.densityAt(X, y, Z), 6);
    }
    expect(touched).not.toBeNull();
  });

  it('a column outside the grid bounds is a silent no-op', () => {
    const grid = new VoxelGrid(16, 16, 16);
    expect(grid.containsColumn(99, 99)).toBe(false);
    expect(() => renormaliseVoxelColumnAfterCarve(grid, 99, 99, 5)).not.toThrow();
    expect(renormaliseVoxelColumnAfterCarve(grid, 99, 99, 5)).toBeNull();
  });
});

describe('captureColumnTopsForCarve (#1148)', () => {
  it('captures one entry per distinct column, keyed by its pre-carve top', () => {
    const grid = new VoxelGrid(16, 16, 16);
    const compId = grid.palette.intern({ rocks: [{ rockId: 'cruite', coefficient: 1 }] });
    for (let y = 0; y <= 6; y++) grid.fillVoxel(3, y, 3, compId, undefined, 1);
    const expectedOldTopY = computeVoxelColumnSurfaceY(grid, 3, 3);
    expect(expectedOldTopY).toBe(6);

    // Several cells in the same column, at different y.
    const cells = [
      { x: 3, y: 6, z: 3 },
      { x: 3, y: 5, z: 3 },
      { x: 3, y: 4, z: 3 },
    ];

    const columns = captureColumnTopsForCarve(grid, cells);

    expect(columns.size).toBe(1);
    expect(columns.get('3,3')).toEqual({ x: 3, z: 3, oldTopY: expectedOldTopY });
  });

  it('captures the PRE-carve top, not a re-read after an earlier cell\'s clear already moved it', () => {
    const grid = new VoxelGrid(16, 16, 16);
    const compId = grid.palette.intern({ rocks: [{ rockId: 'cruite', coefficient: 1 }] });
    for (let y = 0; y <= 6; y++) grid.fillVoxel(3, y, 3, compId, undefined, 1);
    const expectedOldTopY = computeVoxelColumnSurfaceY(grid, 3, 3);
    expect(expectedOldTopY).toBe(6);

    const cells = [
      { x: 3, y: 6, z: 3 },
      { x: 3, y: 5, z: 3 },
    ];

    // Capture runs before any clearing happens, mirroring the real call order
    // (capture -> clear loop -> renormaliseCarvedColumns).
    const columns = captureColumnTopsForCarve(grid, cells);
    // Now clear the top cell, as the carve's own clear loop would.
    grid.clearVoxel(3, 6, 3);

    // The captured top must still be the PRE-carve value, not a stale re-read
    // of the grid after the first cell's clear already dropped the top to 5.
    expect(columns.get('3,3')!.oldTopY).toBe(expectedOldTopY);
  });

  it('captures a distinct entry per column when cells span more than one column', () => {
    const grid = new VoxelGrid(16, 16, 16);
    const compId = grid.palette.intern({ rocks: [{ rockId: 'cruite', coefficient: 1 }] });
    grid.fillVoxel(3, 4, 3, compId, undefined, 1);
    grid.fillVoxel(5, 2, 5, compId, undefined, 1);

    const cells = [{ x: 3, y: 4, z: 3 }, { x: 5, y: 2, z: 5 }];
    const columns = captureColumnTopsForCarve(grid, cells);

    expect(columns.size).toBe(2);
    expect(columns.get('3,3')).toEqual({ x: 3, z: 3, oldTopY: 4 });
    expect(columns.get('5,5')).toEqual({ x: 5, z: 5, oldTopY: 2 });
  });

  it('returns an empty map for an empty cells array', () => {
    const grid = new VoxelGrid(16, 16, 16);
    const columns = captureColumnTopsForCarve(grid, []);
    expect(columns.size).toBe(0);
  });
});

describe('renormaliseCarvedColumns (#1148)', () => {
  it('renormalises every captured column and returns the highest touched Y across all of them', () => {
    const grid = new VoxelGrid(16, 16, 16);
    const compId = grid.palette.intern({ rocks: [{ rockId: 'cruite', coefficient: 1 }] });

    // Column A: plain solid top at y=6, plus stray residue stranded at y=7
    // (above the old top, inside the sweep band) that the carve below exposes.
    for (let y = 0; y <= 6; y++) grid.fillVoxel(3, y, 3, compId, undefined, 1);
    grid.fillVoxel(3, 7, 3, compId, undefined, 0.3);
    const oldTopA = computeVoxelColumnSurfaceY(grid, 3, 3);
    expect(oldTopA).toBe(6);

    // Column B: separate column, no carve happens to it at all.
    grid.fillVoxel(9, 0, 9, compId, undefined, 1);
    grid.fillVoxel(9, 3, 9, compId, undefined, 1);
    const oldTopB = computeVoxelColumnSurfaceY(grid, 9, 9);
    expect(oldTopB).toBe(3);

    // Carve only touches column A.
    grid.clearVoxel(3, 6, 3);

    const columns = new Map([
      ['3,3', { x: 3, z: 3, oldTopY: oldTopA }],
      ['9,9', { x: 9, z: 9, oldTopY: oldTopB }],
    ]);

    const maxY = renormaliseCarvedColumns(grid, columns);

    // Column A's new top (y=5) is plain solid, so nothing to regrade, but the
    // sweep still clears the stranded residue at y=7.
    expect(grid.densityAt(3, 7, 3)).toBe(0);
    expect(maxY).toBe(7);
    // Column B never moved, so it contributes nothing to the aggregate.
    expect(computeVoxelColumnSurfaceY(grid, 9, 9)).toBe(oldTopB);
  });

  it('returns null when none of the captured columns moved', () => {
    const grid = new VoxelGrid(16, 16, 16);
    const compId = grid.palette.intern({ rocks: [{ rockId: 'cruite', coefficient: 1 }] });
    grid.fillVoxel(3, 4, 3, compId, undefined, 1);
    const oldTopY = computeVoxelColumnSurfaceY(grid, 3, 3);

    const columns = new Map([['3,3', { x: 3, z: 3, oldTopY }]]);

    const maxY = renormaliseCarvedColumns(grid, columns);

    expect(maxY).toBeNull();
  });

  it('returns null for an empty columns map', () => {
    const grid = new VoxelGrid(16, 16, 16);
    expect(renormaliseCarvedColumns(grid, new Map())).toBeNull();
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

// ── Edit recording (#1180) ───────────────────────────────────────────────
//
// `grid.edits` (TerrainEdits) is a compact, replayable log of gameplay
// dig/add/fracture writes recorded next to the dense grid — see
// tests/unit/world/TerrainEdits.test.ts for TerrainEdits' own exhaustive
// unit coverage. The tests below cover the OTHER side of the contract:
// that VoxelGrid's mutators actually feed it, and that generation does not.
// TerrainEdits' instance methods are still `throw new Error('not
// implemented')` stubs, so every test that reaches into `grid.edits` is
// expected to FAIL in this RED phase.

function smallTerrainConfig(seed: number): TerrainConfig {
  return { sizeX: 16, sizeY: 16, sizeZ: 16, seed, climateBias: [0, 0] };
}

function totalRecordedSegments(grid: VoxelGrid): number {
  return grid.edits.columns().reduce((n, c) => n + c.segments.length, 0);
}

describe('VoxelGrid — edit recording (#1180)', () => {
  it('clearVoxel on generated terrain records a dug segment covering the cleared voxel', () => {
    const grid = generateTerrain(smallTerrainConfig(7));

    let sx = -1, sy = -1, sz = -1;
    outer:
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        for (let y = 15; y >= 0; y--) {
          if (grid.isSolidAt(x, y, z)) { sx = x; sy = y; sz = z; break outer; }
        }
      }
    }
    expect(sx, 'expected at least one solid voxel in the generated grid').toBeGreaterThanOrEqual(0);

    grid.clearVoxel(sx, sy, sz);

    const segs = grid.edits.segmentsAt(sx, sz);
    expect(segs.some(s => s.kind === 'dug' && sy >= s.yLo && sy <= s.yHi)).toBe(true);
  });

  it('fillVoxel with a solid density and compId records an added segment carrying that composition', () => {
    const grid = new VoxelGrid(8, 8, 8);
    const compId = grid.palette.intern({ rocks: [{ rockId: 'cruite', coefficient: 1 }] });

    grid.fillVoxel(3, 3, 3, compId, undefined, 1.0);

    const segs = grid.edits.segmentsAt(3, 3);
    const match = segs.find(s => s.kind === 'added' && 3 >= s.yLo && 3 <= s.yHi);
    expect(match, 'expected an added segment covering y=3').toBeDefined();
    expect(match!.composition).toEqual(grid.palette.get(compId).comp);
  });

  it('setFractureAt updates grid.edits.fractureAt to the new modifier', () => {
    const grid = new VoxelGrid(8, 8, 8);
    grid.setFractureAt(1, 1, 1, 0.42);
    expect(grid.edits.fractureAt(1, 1, 1)).toBe(0.42);
  });

  it('scaleFractureAt updates grid.edits.fractureAt to the scaled modifier', () => {
    const grid = new VoxelGrid(8, 8, 8);
    grid.setFractureAt(1, 1, 1, 1.0);
    grid.scaleFractureAt(1, 1, 1, 0.5);
    expect(grid.edits.fractureAt(1, 1, 1)).toBeCloseTo(0.5, 10);
  });

  it('a no-op rewrite of the same fillVoxel value does not grow the edit record', () => {
    const grid = new VoxelGrid(8, 8, 8);
    const compId = grid.palette.intern({ rocks: [{ rockId: 'cruite', coefficient: 1 }] });
    grid.fillVoxel(2, 2, 2, compId, undefined, 1.0);
    const before = totalRecordedSegments(grid);

    grid.fillVoxel(2, 2, 2, compId, undefined, 1.0);

    expect(totalRecordedSegments(grid)).toBe(before);
  });

  it('a no-op rewrite of the same clearVoxel value does not grow the edit record', () => {
    const grid = new VoxelGrid(8, 8, 8);
    const compId = grid.palette.intern({ rocks: [{ rockId: 'cruite', coefficient: 1 }] });
    grid.fillVoxel(2, 2, 2, compId, undefined, 1.0);
    grid.clearVoxel(2, 2, 2);
    const before = totalRecordedSegments(grid);

    grid.clearVoxel(2, 2, 2);

    expect(totalRecordedSegments(grid)).toBe(before);
  });

  it('generation leaves grid.edits empty — generateTerrain records nothing of its own writes', () => {
    const grid = generateTerrain(smallTerrainConfig(11));
    expect(grid.edits.isEmpty()).toBe(true);
  });

  it('fillVoxel\'s fracture-reset-to-1 side effect purges the stale grid.edits fracture entry, not just the live field', () => {
    const grid = new VoxelGrid(8, 8, 8);
    const compId = grid.palette.intern({ rocks: [{ rockId: 'cruite', coefficient: 1 }] });
    grid.fillVoxel(4, 4, 4, compId, undefined, 1.0);
    grid.scaleFractureAt(4, 4, 4, 0.5);
    expect(grid.edits.fractureAt(4, 4, 4)).toBeCloseTo(0.5, 10);

    grid.fillVoxel(4, 4, 4, compId, undefined, 1.0); // fillVoxel resets the live fracture field to 1.0

    expect(grid.fractureAt(4, 4, 4)).toBe(1.0);
    expect(grid.edits.fractureAt(4, 4, 4)).toBeUndefined();
  });

  it('withoutEditRecording suspends edit recording for mutators called inside the callback, but the writes themselves still happen', () => {
    const grid = new VoxelGrid(8, 8, 8);
    const compId = grid.palette.intern({ rocks: [{ rockId: 'cruite', coefficient: 1 }] });

    grid.withoutEditRecording(() => {
      grid.fillVoxel(2, 2, 2, compId, undefined, 1.0);
      grid.setFractureAt(2, 2, 2, 0.3);
    });

    expect(grid.densityAt(2, 2, 2)).toBe(1.0);
    expect(grid.fractureAt(2, 2, 2)).toBe(0.3);
    expect(grid.edits.isEmpty()).toBe(true);
  });

  it('withoutEditRecording returns the callback\'s own return value', () => {
    const grid = new VoxelGrid(8, 8, 8);
    const result = grid.withoutEditRecording(() => 42);
    expect(result).toBe(42);
  });

  it('edit recording resumes normally once withoutEditRecording returns', () => {
    const grid = new VoxelGrid(8, 8, 8);
    const compId = grid.palette.intern({ rocks: [{ rockId: 'cruite', coefficient: 1 }] });

    grid.withoutEditRecording(() => { grid.fillVoxel(2, 2, 2, compId, undefined, 1.0); });
    grid.fillVoxel(5, 5, 5, compId, undefined, 1.0);

    expect(grid.edits.segmentsAt(2, 2)).toEqual([]);
    expect(grid.edits.segmentsAt(5, 5).length).toBeGreaterThan(0);
  });
});
