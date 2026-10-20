import { describe, it, expect } from 'vitest';
import { VoxelGrid, CHUNK_SIZE, type VoxelChunkSource } from '../../../src/core/world/VoxelGrid.js';
import { forkVoxelGrid } from '../../../src/core/world/VoxelGridFork.js';
import { buildWallGrid } from '../../helpers/wallWarningFixture.js';

class FlatSource implements VoxelChunkSource {
  constructor(private readonly compId: number, private readonly surfaceY: number) {}
  surfaceHeightAt(): number { return this.surfaceY; }
  materializeSlab(grid: VoxelGrid, x0: number, x1: number, z0: number, z1: number, cy: number): void {
    for (let z = z0; z < z1; z++)
      for (let x = x0; x < x1; x++)
        for (let y = cy * CHUNK_SIZE; y < (cy + 1) * CHUNK_SIZE; y++)
          if (y <= this.surfaceY) grid.writeGeneratedVoxel(x, y, z, this.compId, undefined, 1);
  }
}

function sourcedGrid(): VoxelGrid {
  const grid = new VoxelGrid(24, 24);
  const compId = grid.palette.intern({ rocks: [{ rockId: 'cruite', coefficient: 1 }] });
  grid.attachChunkSource(new FlatSource(compId, 6));
  return grid;
}

function snapshot(grid: VoxelGrid, size: number, height: number): string {
  const out: unknown[] = [];
  for (let z = 0; z < size; z++)
    for (let x = 0; x < size; x++)
      for (let y = 0; y < height; y++) out.push(grid.getVoxel(x, y, z) ?? null);
  return JSON.stringify(out);
}

const editLog = (g: VoxelGrid): string => JSON.stringify({ c: g.edits.columns(), f: g.edits.fractureEntries() });

describe.each([
  ['fixture grid', () => buildWallGrid({ plateauTop: 24 }), 40, 28],
  ['sourced grid', sourcedGrid, 24, 10],
])('forkVoxelGrid — %s', (_name, make, size, height) => {
  it('reads identically to the original', () => {
    const grid = make();
    const fork = forkVoxelGrid(grid);
    expect(fork).not.toBe(grid);
    expect(snapshot(fork, size, height)).toBe(snapshot(grid, size, height));
  });

  it('writes on the fork leave the original voxels and edit log unchanged', () => {
    const grid = make();
    const before = snapshot(grid, size, height);
    const logBefore = editLog(grid);
    const fork = forkVoxelGrid(grid);
    fork.clearVoxel(5, 3, 5);
    fork.clearVoxel(6, 4, 5);
    expect(fork.getVoxel(5, 3, 5)?.density).toBe(0);
    expect(grid.getVoxel(5, 3, 5)?.density).toBeGreaterThan(0);
    expect(snapshot(grid, size, height)).toBe(before);
    expect(editLog(grid)).toBe(logBefore);
    expect(editLog(fork)).not.toBe(logBefore);
  });

  it('writes on the original after forking do not reach the fork', () => {
    const grid = make();
    const fork = forkVoxelGrid(grid);
    const before = snapshot(fork, size, height);
    grid.clearVoxel(5, 3, 5);
    expect(snapshot(fork, size, height)).toBe(before);
  });
});

describe('forkVoxelGrid — chunk source', () => {
  it('keeps the chunk source so unread chunks still materialize on the fork', () => {
    const grid = sourcedGrid();
    const fork = forkVoxelGrid(grid);
    expect(fork.getChunkSource()).not.toBeNull();
    expect(fork.getVoxel(20, 2, 20)).toBeDefined();
  });
});
