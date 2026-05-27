// Integration tests: Voronoi fragmentation seed pipeline
// Task 5.8 — computeFragmentationScore + Voronoi seed sampling
// Step 3 of the blast pipeline: compute scores over fragmented voxels,
// then generate a seed point cloud for Bowyer-Watson Delaunay (Task 5.9).
//
// All tests expected to FAIL in Red phase (VoronoiFrag.ts exports stubs).

import { describe, it, expect } from 'vitest';
import {
  computeFragmentationScore,
  fragmentCount,
  voronoiSeedSamples,
  generateSeedPointCloud,
} from '../../src/physics/VoronoiFrag.js';
import { FRAGMENTATION_SCORE_SCALE } from '../../src/core/config/balance.js';
import { VoxelGrid, type VoxelData } from '../../src/core/world/VoxelGrid.js';
import { Random } from '../../src/core/math/Random.js';
import type { Vec3 } from '../../src/core/math/Vec3.js';

// ---------------------------------------------------------------------------
// Deterministic fixtures
// ---------------------------------------------------------------------------

// cruite: hardnessTier 1 → energyAbsorption = 200
// sandite: hardnessTier 1 → energyAbsorption = 250
// titanite: hardnessTier 5 → energyAbsorption = 4000

const CRUITE_VOXEL: VoxelData = {
  composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
  density: 1.0,
  oreDensities: {},
  fractureModifier: 1.0,
};

const AIR_VOXEL: VoxelData = {
  composition: { rocks: [] },
  density: 0,
  oreDensities: {},
  fractureModifier: 1.0,
};

const ZERO_THRESHOLD_VOXEL: VoxelData = {
  composition: { rocks: [{ rockId: 'cruite', coefficient: 0 }] },
  density: 1.0,
  oreDensities: {},
  fractureModifier: 1.0,
};

const MIXED_VOXEL: VoxelData = {
  composition: {
    rocks: [
      { rockId: 'cruite', coefficient: 0.6 },
      { rockId: 'titanite', coefficient: 0.4 },
    ],
  },
  density: 1.0,
  oreDensities: { blingite: 0.5 },
  fractureModifier: 1.0,
};

// ---------------------------------------------------------------------------
// § 3.1: Fragmentation Score — computeFragmentationScore
// ---------------------------------------------------------------------------

describe('VoronoiFrag — computeFragmentationScore', () => {
  it('returns FRAGMENTATION_SCORE_SCALE * (effectiveEnergy / threshold) for a solid rock voxel', () => {
    // cruite threshold = 200. effectiveEnergy = 500.
    // F(v) = 3.0 * (500 / 200) = 7.5
    const score = computeFragmentationScore(CRUITE_VOXEL, 500);
    expect(score).toBeCloseTo(7.5, 10);
  });

  it('returns 0 when effectiveEnergy is 0', () => {
    const score = computeFragmentationScore(CRUITE_VOXEL, 0);
    expect(score).toBe(0);
  });

  it('returns 0 for an air voxel (empty composition)', () => {
    const score = computeFragmentationScore(AIR_VOXEL, 500);
    expect(score).toBe(0);
  });

  it('returns 0 for a voxel with density ≤ 0', () => {
    const airDensity: VoxelData = {
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      density: 0,
      oreDensities: {},
      fractureModifier: 1.0,
    };
    expect(computeFragmentationScore(airDensity, 500)).toBe(0);
  });

  it('returns 0 when threshold ≤ 0 (division-by-zero guard)', () => {
    // Zero-threshold voxel: coefficient = 0
    const score = computeFragmentationScore(ZERO_THRESHOLD_VOXEL, 500);
    expect(score).toBe(0);
  });

  it('correctly computes score for a mixed-rock composition', () => {
    // 0.6 × cruite (200) + 0.4 × titanite (4000) = 120 + 1600 = 1720
    // F(v) = 3.0 * (5000 / 1720) ≈ 8.72093...
    const score = computeFragmentationScore(MIXED_VOXEL, 5000);
    expect(score).toBeCloseTo(FRAGMENTATION_SCORE_SCALE * (5000 / 1720), 10);
  });

  it('uses FRAGMENTATION_SCORE_SCALE from balance constants', () => {
    expect(FRAGMENTATION_SCORE_SCALE).toBe(3.0);
  });

  it('does not mutate the input voxel object', () => {
    const voxel: VoxelData = {
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      density: 1.0,
      oreDensities: {},
      fractureModifier: 1.0,
    };
    const snapshot = JSON.parse(JSON.stringify(voxel));
    computeFragmentationScore(voxel, 500);
    expect(voxel).toEqual(snapshot);
  });
});

// ---------------------------------------------------------------------------
// § 3.2: fragmentCount helper
// ---------------------------------------------------------------------------

describe('VoronoiFrag — fragmentCount', () => {
  it('returns max(1, round(score)) for a positive score', () => {
    // score = 7.5 → round = 8
    expect(fragmentCount(7.5)).toBe(8);
  });

  it('returns at least 1 for any positive score (< 0.5 rounds to 0, but max 1)', () => {
    // score = 0.4 → round = 0 → max(1, 0) = 1
    expect(fragmentCount(0.4)).toBe(1);
  });

  it('returns 1 for score = 0.5 (exact rounding boundary → 1)', () => {
    expect(fragmentCount(0.5)).toBe(1);
  });

  it('returns 1 for score = 1.0', () => {
    expect(fragmentCount(1.0)).toBe(1);
  });

  it('returns 2 for score = 1.5', () => {
    expect(fragmentCount(1.5)).toBe(2);
  });

  it('returns 1 for score = 0 (edge: max(1, 0) = 1)', () => {
    expect(fragmentCount(0)).toBe(1);
  });

  it('returns 1 for negative score (max(1, negative) = 1)', () => {
    expect(fragmentCount(-10)).toBe(1);
  });

  it('handles large scores without overflow', () => {
    expect(fragmentCount(1000)).toBe(1000);
    expect(fragmentCount(1000.4)).toBe(1000);
    expect(fragmentCount(1000.9)).toBe(1001);
  });
});

// ---------------------------------------------------------------------------
// § 3.3: Seed Sampling — voronoiSeedSamples
// ---------------------------------------------------------------------------

describe('VoronoiFrag — voronoiSeedSamples', () => {
  it('returns correct number of samples based on fragmentCount', () => {
    // cruite threshold = 200, effectiveEnergy = 500
    // F(v) = 3.0 * (500 / 200) = 7.5 → fragmentCount = 8
    const samples = voronoiSeedSamples(CRUITE_VOXEL, 500, 10, 5, 10, new Random(42));
    expect(samples).toHaveLength(8);
  });

  it('returns empty array for an air voxel (empty composition)', () => {
    const samples = voronoiSeedSamples(AIR_VOXEL, 500, 0, 0, 0, new Random(42));
    expect(samples).toHaveLength(0);
  });

  it('returns empty array when effectiveEnergy is 0', () => {
    const samples = voronoiSeedSamples(CRUITE_VOXEL, 0, 0, 0, 0, new Random(42));
    expect(samples).toHaveLength(0);
  });

  it('all sample points lie within the voxel unit cube [x, x+1) × [y, y+1) × [z, z+1)', () => {
    const x = 10, y = 5, z = 15;
    const samples = voronoiSeedSamples(CRUITE_VOXEL, 500, x, y, z, new Random(42));
    for (const p of samples) {
      expect(p.x).toBeGreaterThanOrEqual(x);
      expect(p.x).toBeLessThan(x + 1);
      expect(p.y).toBeGreaterThanOrEqual(y);
      expect(p.y).toBeLessThan(y + 1);
      expect(p.z).toBeGreaterThanOrEqual(z);
      expect(p.z).toBeLessThan(z + 1);
    }
  });

  it('is deterministic with the same seed', () => {
    const a = voronoiSeedSamples(CRUITE_VOXEL, 500, 0, 0, 0, new Random(42));
    const b = voronoiSeedSamples(CRUITE_VOXEL, 500, 0, 0, 0, new Random(42));
    expect(a).toHaveLength(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(a[i]!.x).toBeCloseTo(b[i]!.x, 12);
      expect(a[i]!.y).toBeCloseTo(b[i]!.y, 12);
      expect(a[i]!.z).toBeCloseTo(b[i]!.z, 12);
    }
  });

  it('different seeds produce different samples', () => {
    const a = voronoiSeedSamples(CRUITE_VOXEL, 500, 0, 0, 0, new Random(42));
    const b = voronoiSeedSamples(CRUITE_VOXEL, 500, 0, 0, 0, new Random(99));
    expect(a).toHaveLength(b.length);
    // At least one point should differ
    const allSame = a.every((p, i) => p.x === b[i]!.x && p.y === b[i]!.y && p.z === b[i]!.z);
    expect(allSame).toBe(false);
  });

  it('returns 1 sample for a score just above 0 (fragmentCount = 1)', () => {
    // effectiveEnergy = 1, cruite threshold = 200
    // F(v) = 3.0 * (1/200) = 0.015 → fragmentCount = max(1, round(0.015)) = 1
    const samples = voronoiSeedSamples(CRUITE_VOXEL, 1, 5, 5, 5, new Random(42));
    expect(samples).toHaveLength(1);
    expect(samples[0]!.x).toBeGreaterThanOrEqual(5);
    expect(samples[0]!.x).toBeLessThan(6);
  });

  it('returned points have Vec3 type with x, y, z fields', () => {
    const samples = voronoiSeedSamples(CRUITE_VOXEL, 500, 0, 0, 0, new Random(42));
    for (const p of samples) {
      expect(p).toHaveProperty('x');
      expect(p).toHaveProperty('y');
      expect(p).toHaveProperty('z');
      expect(typeof p.x).toBe('number');
      expect(typeof p.y).toBe('number');
      expect(typeof p.z).toBe('number');
    }
  });

  it('does not mutate the input voxel object', () => {
    const voxel: VoxelData = {
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      density: 1.0,
      oreDensities: {},
      fractureModifier: 1.0,
    };
    const snapshot = JSON.parse(JSON.stringify(voxel));
    voronoiSeedSamples(voxel, 500, 0, 0, 0, new Random(42));
    expect(voxel).toEqual(snapshot);
  });
});

// ---------------------------------------------------------------------------
// § 3.4: Point Cloud — generateSeedPointCloud
// ---------------------------------------------------------------------------

describe('VoronoiFrag — generateSeedPointCloud', () => {
  it('returns a flat array of all seed points across all fragmented voxels', () => {
    // 3×3×3 grid, three solid cruite voxels at (0,0,0), (1,0,0), (2,0,0)
    const grid = new VoxelGrid(3, 3, 3);
    const solid = (): VoxelData => ({
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      density: 1.0,
      oreDensities: {},
      fractureModifier: 1.0,
    });
    grid.setVoxel(0, 0, 0, solid());
    grid.setVoxel(1, 0, 0, solid());
    grid.setVoxel(2, 0, 0, solid());

    const fragmented = new Set<string>(['0,0,0', '1,0,0', '2,0,0']);
    const effectiveEnergy = new Map<string, number>([
      ['0,0,0', 500],
      ['1,0,0', 400],
      ['2,0,0', 600],
    ]);
    // cruite threshold = 200
    // F(0,0,0) = 3.0 * (500/200) = 7.5 → 8 points
    // F(1,0,0) = 3.0 * (400/200) = 6.0 → 6 points
    // F(2,0,0) = 3.0 * (600/200) = 9.0 → 9 points
    // Total = 23 points
    const cloud = generateSeedPointCloud(fragmented, effectiveEnergy, grid, new Random(42));
    expect(cloud).toHaveLength(23);
  });

  it('returns empty array when fragmentedVoxels is empty', () => {
    const grid = new VoxelGrid(3, 3, 3);
    const cloud = generateSeedPointCloud(new Set(), new Map(), grid, new Random(42));
    expect(cloud).toHaveLength(0);
  });

  it('skips voxels in the fragmented set that have no effectiveEnergy entry', () => {
    const grid = new VoxelGrid(3, 3, 3);
    const solid = (): VoxelData => ({
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      density: 1.0,
      oreDensities: {},
      fractureModifier: 1.0,
    });
    grid.setVoxel(0, 0, 0, solid());
    grid.setVoxel(1, 0, 0, solid());

    // Fragmented includes (0,0,0) and (1,0,0), but only (0,0,0) has energy
    const fragmented = new Set<string>(['0,0,0', '1,0,0']);
    const effectiveEnergy = new Map<string, number>([['0,0,0', 500]]);
    // F(0,0,0) = 7.5 → 8 points
    const cloud = generateSeedPointCloud(fragmented, effectiveEnergy, grid, new Random(42));
    expect(cloud).toHaveLength(8);
  });

  it('skips voxels that no longer exist in the grid (removed by earlier blast steps)', () => {
    const grid = new VoxelGrid(3, 3, 3);
    // Only (0,0,0) is solid; (1,0,0) is air (already cleared)
    const solid = (): VoxelData => ({
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      density: 1.0,
      oreDensities: {},
      fractureModifier: 1.0,
    });
    grid.setVoxel(0, 0, 0, solid());

    // Fragmented lists both, but (1,0,0) is now air
    const fragmented = new Set<string>(['0,0,0', '1,0,0']);
    const effectiveEnergy = new Map<string, number>([
      ['0,0,0', 500],
      ['1,0,0', 500],
    ]);
    // Only (0,0,0) contributes → 8 points
    const cloud = generateSeedPointCloud(fragmented, effectiveEnergy, grid, new Random(42));
    expect(cloud).toHaveLength(8);
  });

  it('is deterministic with the same seed', () => {
    const grid = new VoxelGrid(3, 3, 3);
    const solid = (): VoxelData => ({
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      density: 1.0,
      oreDensities: {},
      fractureModifier: 1.0,
    });
    grid.setVoxel(0, 0, 0, solid());
    grid.setVoxel(1, 0, 0, solid());

    const fragmented = new Set<string>(['0,0,0', '1,0,0']);
    const effectiveEnergy = new Map<string, number>([
      ['0,0,0', 500],
      ['1,0,0', 400],
    ]);

    const a = generateSeedPointCloud(fragmented, effectiveEnergy, grid, new Random(42));
    const b = generateSeedPointCloud(fragmented, effectiveEnergy, grid, new Random(42));
    expect(a).toHaveLength(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(a[i]!.x).toBeCloseTo(b[i]!.x, 12);
      expect(a[i]!.y).toBeCloseTo(b[i]!.y, 12);
      expect(a[i]!.z).toBeCloseTo(b[i]!.z, 12);
    }
  });

  it('different seeds produce different point clouds', () => {
    const grid = new VoxelGrid(3, 3, 3);
    const solid = (): VoxelData => ({
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      density: 1.0,
      oreDensities: {},
      fractureModifier: 1.0,
    });
    grid.setVoxel(0, 0, 0, solid());

    const fragmented = new Set<string>(['0,0,0']);
    const effectiveEnergy = new Map<string, number>([['0,0,0', 500]]);

    const a = generateSeedPointCloud(fragmented, effectiveEnergy, grid, new Random(42));
    const b = generateSeedPointCloud(fragmented, effectiveEnergy, grid, new Random(99));
    expect(a).toHaveLength(b.length);
    const allSame = a.every((p, i) => p.x === b[i]!.x && p.y === b[i]!.y && p.z === b[i]!.z);
    expect(allSame).toBe(false);
  });

  it('all returned points are proper Vec3 with numeric fields', () => {
    const grid = new VoxelGrid(3, 3, 3);
    const solid = (): VoxelData => ({
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      density: 1.0,
      oreDensities: {},
      fractureModifier: 1.0,
    });
    grid.setVoxel(0, 0, 0, solid());

    const fragmented = new Set<string>(['0,0,0']);
    const effectiveEnergy = new Map<string, number>([['0,0,0', 500]]);

    const cloud = generateSeedPointCloud(fragmented, effectiveEnergy, grid, new Random(42));
    for (const p of cloud) {
      expect(p).toHaveProperty('x');
      expect(p).toHaveProperty('y');
      expect(p).toHaveProperty('z');
      expect(typeof p.x).toBe('number');
      expect(typeof p.y).toBe('number');
      expect(typeof p.z).toBe('number');
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
      expect(Number.isFinite(p.z)).toBe(true);
    }
  });

  it('voxel at grid corner (0,0,0) produces valid seed points in its unit cube', () => {
    // Edge-case: voxel at the origin. Seeds must be in [0, 1) × [0, 1) × [0, 1).
    const grid = new VoxelGrid(3, 3, 3);
    const solid = (): VoxelData => ({
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      density: 1.0,
      oreDensities: {},
      fractureModifier: 1.0,
    });
    grid.setVoxel(0, 0, 0, solid());

    const fragmented = new Set<string>(['0,0,0']);
    const effectiveEnergy = new Map<string, number>([['0,0,0', 500]]);

    const cloud = generateSeedPointCloud(fragmented, effectiveEnergy, grid, new Random(42));
    expect(cloud.length).toBe(8);
    for (const p of cloud) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThan(1);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThan(1);
      expect(p.z).toBeGreaterThanOrEqual(0);
      expect(p.z).toBeLessThan(1);
    }
  });
});
