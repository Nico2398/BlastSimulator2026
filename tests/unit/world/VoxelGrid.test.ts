import { describe, it, expect } from 'vitest';
import { VoxelGrid, getDominantRockId, CompositionPalette } from '../../../src/core/world/VoxelGrid.js';

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
