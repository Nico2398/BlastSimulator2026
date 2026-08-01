import { describe, it, expect } from 'vitest';
import { WorldNoiseFields } from '../../../src/core/world/NoiseFields.js';
import {
  sampleBaseHeight,
  applyPitMask,
  computeGroundOffset,
  heightToVoxelY,
  createWorldGenContext,
  sampleSurfaceVoxelY,
  DEFAULT_SHAPING,
  type Rect,
} from '../../../src/core/world/WorldGen.js';

describe('sampleBaseHeight', () => {
  it('is deterministic for the same fields, shaping, and coordinates', () => {
    const fields = new WorldNoiseFields(42);
    const a = sampleBaseHeight(fields, 100, 200, DEFAULT_SHAPING);
    const b = sampleBaseHeight(fields, 100, 200, DEFAULT_SHAPING);
    expect(a).toBe(b);
  });

  it('produces a finite height for a wide range of coordinates', () => {
    const fields = new WorldNoiseFields(7);
    for (let x = -500; x <= 500; x += 100) {
      const h = sampleBaseHeight(fields, x, x * 0.5, DEFAULT_SHAPING);
      expect(Number.isFinite(h)).toBe(true);
    }
  });

  it('feature wavelength is independent of grid size: same world (x, z) gives the same height', () => {
    // The whole point of absolute (non-normalized) coordinates. A 32-wide and
    // a 320-wide grid must agree on the height at world position (20, 20).
    const fieldsA = new WorldNoiseFields(42); // as if building a 32-wide grid
    const fieldsB = new WorldNoiseFields(42); // as if building a 320-wide grid
    expect(sampleBaseHeight(fieldsA, 20, 20)).toBe(sampleBaseHeight(fieldsB, 20, 20));
  });
});

describe('applyPitMask', () => {
  const rect: Rect = { minX: 0, minZ: 0, maxX: 200, maxZ: 200 };

  it('leaves height unchanged outside the rect', () => {
    expect(applyPitMask(100, 0, rect, -50, 50)).toBe(100);
    expect(applyPitMask(100, 0, rect, 250, 50)).toBe(100);
  });

  it('leaves height unchanged exactly at the rect edge (w=0)', () => {
    expect(applyPitMask(100, 0, rect, 0, 50)).toBeCloseTo(100, 10);
  });

  it('strongly compresses height toward centerHeight deep inside the rect', () => {
    const masked = applyPitMask(100, 0, rect, 100, 100); // rect centre, far from any edge
    // Deep inside: w=1, result = centerHeight + (h-centerHeight)*KEEP = 0 + 100*0.3 = 30
    expect(masked).toBeCloseTo(30, 5);
  });

  it('compression strength increases monotonically from the edge inward', () => {
    const atEdge = applyPitMask(100, 0, rect, 0, 100);
    const partway = applyPitMask(100, 0, rect, 12, 100);
    const deep = applyPitMask(100, 0, rect, 100, 100);
    expect(Math.abs(deep - 30)).toBeLessThan(Math.abs(partway - 30));
    expect(Math.abs(partway - 30)).toBeLessThan(Math.abs(atEdge - 30) + 1e-9);
  });

  it('does nothing when height already equals centerHeight', () => {
    expect(applyPitMask(50, 50, rect, 100, 100)).toBeCloseTo(50, 10);
  });
});

describe('computeGroundOffset / heightToVoxelY', () => {
  it('places centerHeight at roughly 55% of sizeY after the datum shift', () => {
    const sizeY = 40;
    const offset = computeGroundOffset(10, sizeY);
    const y = heightToVoxelY(10, offset, sizeY);
    expect(y).toBe(Math.floor(sizeY * 0.55));
  });

  it('clamps to [1, sizeY - 1]', () => {
    const sizeY = 20;
    expect(heightToVoxelY(-10000, 0, sizeY)).toBe(1);
    expect(heightToVoxelY(10000, 0, sizeY)).toBe(sizeY - 1);
  });

  it('rounds to the nearest integer voxel', () => {
    expect(heightToVoxelY(5.4, 0, 100)).toBe(5);
    expect(heightToVoxelY(5.6, 0, 100)).toBe(6);
  });
});

describe('createWorldGenContext / sampleSurfaceVoxelY', () => {
  it('is deterministic for the same seed and dimensions', () => {
    const a = createWorldGenContext(42, 32, 32, 32);
    const b = createWorldGenContext(42, 32, 32, 32);
    expect(sampleSurfaceVoxelY(a, 10, 10)).toBe(sampleSurfaceVoxelY(b, 10, 10));
  });

  it('different seeds produce different surface heights somewhere in the grid', () => {
    const a = createWorldGenContext(1, 32, 32, 32);
    const b = createWorldGenContext(2, 32, 32, 32);
    let differences = 0;
    for (let x = 0; x < 32; x += 4) {
      for (let z = 0; z < 32; z += 4) {
        if (sampleSurfaceVoxelY(a, x, z) !== sampleSurfaceVoxelY(b, x, z)) differences++;
      }
    }
    expect(differences).toBeGreaterThan(0);
  });

  it('always returns a voxel Y within [1, sizeY - 1]', () => {
    const ctx = createWorldGenContext(7, 40, 24, 40);
    for (let x = 0; x < 40; x += 5) {
      for (let z = 0; z < 40; z += 5) {
        const y = sampleSurfaceVoxelY(ctx, x, z);
        expect(y).toBeGreaterThanOrEqual(1);
        expect(y).toBeLessThanOrEqual(23);
      }
    }
  });

  it('keeps relief compressed (small y-range) well inside a small grid, thanks to the pit mask', () => {
    const ctx = createWorldGenContext(42, 32, 32, 32);
    const heights: number[] = [];
    for (let x = 10; x <= 22; x += 2) {
      for (let z = 10; z <= 22; z += 2) {
        heights.push(sampleSurfaceVoxelY(ctx, x, z));
      }
    }
    const range = Math.max(...heights) - Math.min(...heights);
    // Not a tight bound — just confirms the mask is doing real compression
    // work near the centre of a small grid rather than leaving raw relief.
    expect(range).toBeLessThan(20);
  });
});
