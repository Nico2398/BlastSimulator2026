import { describe, it, expect } from 'vitest';
import { VoxelGrid, getDominantRockId, VOXEL_CELL_SIZE } from '../../../src/core/world/VoxelGrid.js';

describe('VoxelGrid', () => {
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

  it('VOXEL_CELL_SIZE is exported and equals 1 (one meter per cell)', () => {
    expect(VOXEL_CELL_SIZE).toBeDefined();
    expect(VOXEL_CELL_SIZE).toBe(1);
  });
});
