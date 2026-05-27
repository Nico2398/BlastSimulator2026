import { describe, it, expect } from 'vitest';
import {
  computeFragmentationScore,
  fragmentCount,
  voronoiSeedSamples,
  generateSeedPointCloud,
} from '../../../src/physics/VoronoiFrag.js';
import { FRAGMENTATION_SCORE_SCALE } from '../../../src/core/config/balance.js';
import type { VoxelData } from '../../../src/core/world/VoxelGrid.js';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import { Random } from '../../../src/core/math/Random.js';
import type { Vec3 } from '../../../src/core/math/Vec3.js';

// ─── Fixtures ──────────────────────────────────────────────────────────────────

/** Cruite-only solid voxel. Threshold T(v) = 200. */
const CRUITE_VOXEL: VoxelData = {
  composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
  density: 1.0,
  oreDensities: {},
  fractureModifier: 1.0,
};

/** Air voxel (empty composition, density 0). */
const AIR_VOXEL: VoxelData = {
  composition: { rocks: [] },
  density: 0,
  oreDensities: {},
  fractureModifier: 1.0,
};

/** Cruite + titanite mixed voxel (weighted average threshold). */
const MIXED_VOXEL: VoxelData = {
  composition: {
    rocks: [
      { rockId: 'cruite', coefficient: 0.75 },
      { rockId: 'titanite', coefficient: 0.25 },
    ],
  },
  density: 1.0,
  oreDensities: {},
  fractureModifier: 1.0,
};

// cruite.energyAbsorption = 200, titanite.energyAbsorption = 4000
// threshold = 0.75 * 200 + 0.25 * 4000 = 150 + 1000 = 1150

// ─── computeFragmentationScore ─────────────────────────────────────────────────

describe('computeFragmentationScore', () => {
  // ── Air / zero-threshold guard ─────────────────────────────────────────────

  it('returns 0 for an air voxel (empty composition)', () => {
    const score = computeFragmentationScore(AIR_VOXEL, 500);
    expect(score).toBe(0);
  });

  it('returns 0 for an air voxel (density ≤ 0)', () => {
    const denseAir: VoxelData = {
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      density: 0,
      oreDensities: {},
      fractureModifier: 1.0,
    };
    const score = computeFragmentationScore(denseAir, 500);
    expect(score).toBe(0);
  });

  it('returns 0 when threshold is 0 (all-zero coefficients)', () => {
    const zeroCoeff: VoxelData = {
      composition: { rocks: [{ rockId: 'cruite', coefficient: 0 }] },
      density: 1.0,
      oreDensities: {},
      fractureModifier: 1.0,
    };
    const score = computeFragmentationScore(zeroCoeff, 9999);
    expect(score).toBe(0);
  });

  it('returns 0 when effectiveEnergy is 0', () => {
    const score = computeFragmentationScore(CRUITE_VOXEL, 0);
    expect(score).toBe(0);
  });

  it('returns 0 for negative effectiveEnergy', () => {
    const score = computeFragmentationScore(CRUITE_VOXEL, -100);
    expect(score).toBe(0);
  });

  it('returns 0 for negative zero effectiveEnergy', () => {
    const score = computeFragmentationScore(CRUITE_VOXEL, -0);
    expect(score).toBe(0);
  });

  it('returns 0 for NaN effectiveEnergy', () => {
    // NaN is not a valid energy value. Function should guard against it
    // and return 0. CURRENTLY UNGUARDED — this test is expected to FAIL
    // until the guard is added.
    const score = computeFragmentationScore(CRUITE_VOXEL, NaN);
    expect(score).toBe(0);
  });

  it('returns 0 for -Infinity effectiveEnergy', () => {
    const score = computeFragmentationScore(CRUITE_VOXEL, -Infinity);
    expect(score).toBe(0);
  });

  // ── Correct formula ────────────────────────────────────────────────────────

  it('computes correct score for a single rock type', () => {
    // F(v) = FRAGMENTATION_SCORE_SCALE * (effectiveEnergy / T(v))
    // T(cruite) = 200, effectiveEnergy = 400
    // F = 3.0 * (400 / 200) = 6.0
    const score = computeFragmentationScore(CRUITE_VOXEL, 400);
    expect(score).toBeCloseTo(6.0, 10);
  });

  it('computes correct score for a mixed rock composition', () => {
    // T(mixed) = 1150, effectiveEnergy = 2300
    // F = 3.0 * (2300 / 1150) = 6.0
    const score = computeFragmentationScore(MIXED_VOXEL, 2300);
    expect(score).toBeCloseTo(6.0, 10);
  });

  it('score scales linearly with effectiveEnergy', () => {
    const scoreLow = computeFragmentationScore(CRUITE_VOXEL, 100);   // 3*100/200 = 1.5
    const scoreMid = computeFragmentationScore(CRUITE_VOXEL, 200);   // 3*200/200 = 3.0
    const scoreHigh = computeFragmentationScore(CRUITE_VOXEL, 400);  // 3*400/200 = 6.0
    expect(scoreLow).toBeCloseTo(1.5, 10);
    expect(scoreMid).toBeCloseTo(3.0, 10);
    expect(scoreHigh).toBeCloseTo(6.0, 10);
    // Ratio check: doubling energy doubles score
    expect(scoreMid / scoreLow).toBeCloseTo(2.0, 10);
    expect(scoreHigh / scoreMid).toBeCloseTo(2.0, 10);
  });

  it('uses FRAGMENTATION_SCORE_SCALE = 3.0', () => {
    expect(FRAGMENTATION_SCORE_SCALE).toBe(3.0);
  });

  it('does not mutate the input voxel object', () => {
    const snapshot = JSON.parse(JSON.stringify(CRUITE_VOXEL));
    computeFragmentationScore(CRUITE_VOXEL, 400);
    expect(CRUITE_VOXEL).toEqual(snapshot);
  });

  it('handles very large effectiveEnergy without overflow issues', () => {
    const score = computeFragmentationScore(CRUITE_VOXEL, 1e12);
    // F = 3.0 * 1e12 / 200 = 1.5e10
    expect(score).toBe(1.5e10);
  });

  it('handles Infinity effectiveEnergy gracefully', () => {
    // Infinity energy should not crash or propagate NaN.
    // Expected to return a finite value or 0.
    const score = computeFragmentationScore(CRUITE_VOXEL, Infinity);
    expect(Number.isFinite(score)).toBe(true);
  });

  it('returns fractional score when effectiveEnergy < threshold', () => {
    const score = computeFragmentationScore(CRUITE_VOXEL, 50);
    // F = 3.0 * 50 / 200 = 0.75
    expect(score).toBeCloseTo(0.75, 10);
  });
});

// ─── fragmentCount ─────────────────────────────────────────────────────────────

describe('fragmentCount', () => {
  it('returns 1 for score = 0', () => {
    expect(fragmentCount(0)).toBe(1);
  });

  it('returns 1 for score < 0.5 (rounds down to 0, clamped to 1)', () => {
    expect(fragmentCount(0.49)).toBe(1);
    expect(fragmentCount(0.1)).toBe(1);
  });

  it('returns 1 for score = 0.5 (rounds to 1)', () => {
    expect(fragmentCount(0.5)).toBe(1);
  });

  it('returns 2 for score = 1.5 (rounds to 2)', () => {
    expect(fragmentCount(1.5)).toBe(2);
  });

  it('returns round(score) for score > 1.0', () => {
    expect(fragmentCount(3.4)).toBe(3);  // round(3.4) = 3
    expect(fragmentCount(3.7)).toBe(4);  // round(3.7) = 4
    expect(fragmentCount(10.0)).toBe(10);
    expect(fragmentCount(999.9)).toBe(1000);
  });

  it('returns integer for boundary rounding', () => {
    // round(1.499) = 1, max(1, 1) = 1
    expect(fragmentCount(1.499)).toBe(1);
    // round(1.5) = 2, max(1, 2) = 2
    expect(fragmentCount(1.5)).toBe(2);
  });

  it('returns 1 for NaN score', () => {
    // NaN is not a valid score. Function should guard against it.
    // CURRENTLY UNGUARDED — this test is expected to FAIL until the guard is added.
    expect(fragmentCount(NaN)).toBe(1);
  });

  it('returns 1 for Infinity score', () => {
    // Infinity is not a valid score. Function should guard against it.
    // CURRENTLY UNGUARDED — this test is expected to FAIL until the guard is added.
    expect(fragmentCount(Infinity)).toBe(1);
  });

  it('returns 1 for negative score', () => {
    expect(fragmentCount(-5)).toBe(1);
    expect(fragmentCount(-100)).toBe(1);
    expect(fragmentCount(-0.5)).toBe(1);
  });
});

// ─── voronoiSeedSamples ────────────────────────────────────────────────────────

describe('voronoiSeedSamples', () => {
  /** Assert every point in an array lies within [min, max) for all 3 coords. */
  function assertPointsInCube(points: Vec3[], minX: number, minY: number, minZ: number): void {
    for (const p of points) {
      expect(p.x).toBeGreaterThanOrEqual(minX);
      expect(p.x).toBeLessThan(minX + 1);
      expect(p.y).toBeGreaterThanOrEqual(minY);
      expect(p.y).toBeLessThan(minY + 1);
      expect(p.z).toBeGreaterThanOrEqual(minZ);
      expect(p.z).toBeLessThan(minZ + 1);
    }
  }

  it('returns empty array for air voxel (score = 0)', () => {
    const points = voronoiSeedSamples(AIR_VOXEL, 500, 2, 3, 4, new Random(42));
    expect(points).toEqual([]);
  });

  it('returns empty array for valid voxel with 0 effectiveEnergy', () => {
    const points = voronoiSeedSamples(CRUITE_VOXEL, 0, 2, 3, 4, new Random(42));
    expect(points).toEqual([]);
  });

  it('returns empty array for valid voxel with negative effectiveEnergy', () => {
    const points = voronoiSeedSamples(CRUITE_VOXEL, -100, 2, 3, 4, new Random(42));
    expect(points).toEqual([]);
  });

  it('returns correct number of samples for cruite with effectiveEnergy = threshold', () => {
    // T(cruite) = 200, energy = 200 → F = 3.0 * 200/200 = 3.0 → count = round(3.0) = 3
    const points = voronoiSeedSamples(CRUITE_VOXEL, 200, 5, 5, 5, new Random(42));
    expect(points).toHaveLength(3);
  });

  it('returns correct number of samples for high energy (more fragments)', () => {
    // T(cruite) = 200, energy = 600 → F = 3.0 * 600/200 = 9.0 → count = 9
    const points = voronoiSeedSamples(CRUITE_VOXEL, 600, 0, 0, 0, new Random(42));
    expect(points).toHaveLength(9);
  });

  it('returns correct number of samples for low energy (min 1)', () => {
    // F = 3.0 * 10/200 = 0.15 → round(0.15) = 0 → max(1, 0) = 1
    const points = voronoiSeedSamples(CRUITE_VOXEL, 10, 0, 0, 0, new Random(42));
    expect(points).toHaveLength(1);
  });

  it('all points lie within [x, x+1) × [y, y+1) × [z, z+1)', () => {
    const points = voronoiSeedSamples(CRUITE_VOXEL, 400, 10, 20, 30, new Random(99));
    // F = 6.0 → count = 6
    assertPointsInCube(points, 10, 20, 30);
  });

  it('all points have Vec3 type (x, y, z as numbers)', () => {
    const points = voronoiSeedSamples(CRUITE_VOXEL, 400, 1, 2, 3, new Random(42));
    for (const p of points) {
      expect(typeof p.x).toBe('number');
      expect(typeof p.y).toBe('number');
      expect(typeof p.z).toBe('number');
    }
  });

  it('each point is unique (no duplicate coordinates)', () => {
    const points = voronoiSeedSamples(CRUITE_VOXEL, 600, 0, 0, 0, new Random(42));
    const seen = new Set<string>();
    for (const p of points) {
      const key = `${p.x},${p.y},${p.z}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('deterministic with same seed', () => {
    const seed = 12345;
    const a = voronoiSeedSamples(CRUITE_VOXEL, 400, 7, 8, 9, new Random(seed));
    const b = voronoiSeedSamples(CRUITE_VOXEL, 400, 7, 8, 9, new Random(seed));
    expect(a).toHaveLength(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(a[i].x).toBe(b[i].x);
      expect(a[i].y).toBe(b[i].y);
      expect(a[i].z).toBe(b[i].z);
    }
  });

  it('different seeds produce different point sets', () => {
    const a = voronoiSeedSamples(CRUITE_VOXEL, 400, 0, 0, 0, new Random(42));
    const b = voronoiSeedSamples(CRUITE_VOXEL, 400, 0, 0, 0, new Random(9999));
    // With 6 points and different seeds, extremely unlikely all coords match
    const allMatch = a.length === b.length && a.every((p, i) => p.x === b[i].x && p.y === b[i].y && p.z === b[i].z);
    expect(allMatch).toBe(false);
  });

  it('handles negative voxel coordinates correctly', () => {
    // Voxel at negative coordinates should produce points in that range
    const points = voronoiSeedSamples(CRUITE_VOXEL, 400, -5, -3, -1, new Random(42));
    assertPointsInCube(points, -5, -3, -1);
  });

  it('does not mutate the input voxel', () => {
    const snapshot = JSON.parse(JSON.stringify(CRUITE_VOXEL));
    voronoiSeedSamples(CRUITE_VOXEL, 400, 0, 0, 0, new Random(42));
    expect(CRUITE_VOXEL).toEqual(snapshot);
  });
});

// ─── generateSeedPointCloud ────────────────────────────────────────────────────

describe('generateSeedPointCloud', () => {
  /** Build a minimal mock grid where some cells are solid, others are air. */
  function makeMockGrid(solidKeys: string[]): { getVoxel: (x: number, y: number, z: number) => VoxelData | undefined } {
    const solidSet = new Set(solidKeys);
    return {
      getVoxel(x: number, y: number, z: number): VoxelData | undefined {
        const key = `${x},${y},${z}`;
        if (solidSet.has(key)) {
          return CRUITE_VOXEL;
        }
        return { ...AIR_VOXEL, composition: { rocks: [] }, density: 0 };
      },
    };
  }

  it('returns empty array for empty fragmented set', () => {
    const grid = makeMockGrid([]);
    const points = generateSeedPointCloud(
      new Set(),
      new Map(),
      grid,
      new Random(42),
    );
    expect(points).toEqual([]);
  });

  it('returns correct total points for a single fragmented voxel', () => {
    // Voxel (5,5,5), cruite, energy=200 → F=3.0 → count=3
    const grid = makeMockGrid(['5,5,5']);
    const fragmented = new Set<string>(['5,5,5']);
    const energy = new Map<string, number>([['5,5,5', 200]]);
    const points = generateSeedPointCloud(fragmented, energy, grid, new Random(42));
    expect(points).toHaveLength(3);
    for (const p of points) {
      expect(p.x).toBeGreaterThanOrEqual(5);
      expect(p.x).toBeLessThan(6);
      expect(p.y).toBeGreaterThanOrEqual(5);
      expect(p.y).toBeLessThan(6);
      expect(p.z).toBeGreaterThanOrEqual(5);
      expect(p.z).toBeLessThan(6);
    }
  });

  it('aggregates points from multiple fragmented voxels', () => {
    // (0,0,0) cruite energy=200 → F=3.0 → 3 points
    // (1,0,0) cruite energy=200 → F=3.0 → 3 points
    // Total: 6 points
    const grid = makeMockGrid(['0,0,0', '1,0,0']);
    const fragmented = new Set<string>(['0,0,0', '1,0,0']);
    const energy = new Map<string, number>([
      ['0,0,0', 200],
      ['1,0,0', 200],
    ]);
    const points = generateSeedPointCloud(fragmented, energy, grid, new Random(42));
    expect(points).toHaveLength(6);
  });

  it('total point count equals sum of fragmentCount across all voxels', () => {
    // (0,0,0): energy=200 → F=3.0 → 3 points
    // (5,5,5): energy=400 → F=6.0 → 6 points
    // (1,2,3): energy=0 → F=0 → fragmentCount(0) = 1 point
    const grid = makeMockGrid(['0,0,0', '5,5,5', '1,2,3']);
    const fragmented = new Set<string>(['0,0,0', '5,5,5', '1,2,3']);
    const energy = new Map<string, number>([
      ['0,0,0', 200],
      ['5,5,5', 400],
      ['1,2,3', 0],
    ]);
    const points = generateSeedPointCloud(fragmented, energy, grid, new Random(42));
    // 3 + 6 + 1 = 10
    expect(points).toHaveLength(10);
  });

  it('skips fragmented keys missing from effectiveEnergy map (treats energy as 0)', () => {
    // (0,0,0): has energy → 3 points
    // (1,0,0): missing from energy map → score 0 → fragmentCount(0) = 1 point
    const grid = makeMockGrid(['0,0,0', '1,0,0']);
    const fragmented = new Set<string>(['0,0,0', '1,0,0']);
    const energy = new Map<string, number>([['0,0,0', 200]]);
    const points = generateSeedPointCloud(fragmented, energy, grid, new Random(42));
    // 3 + 1 = 4
    expect(points).toHaveLength(4);
  });

  it('ignores effectiveEnergy entries whose key is NOT in fragmented set', () => {
    // Energy map has extra entries that don't correspond to any fragmented voxel.
    // Only the fragmented keys should be processed.
    const grid = makeMockGrid(['0,0,0', '1,0,0']);
    const fragmented = new Set<string>(['0,0,0']);
    const energy = new Map<string, number>([
      ['0,0,0', 200],
      ['1,0,0', 400],   // not in fragmented set → should be ignored
      ['99,99,99', 999], // not in fragmented set → should be ignored
    ]);
    const points = generateSeedPointCloud(fragmented, energy, grid, new Random(42));
    // Only (0,0,0) contributes: 3 points
    expect(points).toHaveLength(3);
    for (const p of points) {
      expect(Math.floor(p.x)).toBe(0);
    }
  });

  it('skips fragmented voxel where grid returns air (empty rocks)', () => {
    // Grid returns air for a fragmented key → should be skipped
    const grid = makeMockGrid([]);
    const fragmented = new Set<string>(['5,5,5']);
    const energy = new Map<string, number>([['5,5,5', 200]]);
    const points = generateSeedPointCloud(fragmented, energy, grid, new Random(42));
    expect(points).toEqual([]);
  });

  it('skips fragmented key where getVoxel returns undefined (OOB)', () => {
    const grid = {
      getVoxel(_x: number, _y: number, _z: number): VoxelData | undefined {
        return undefined;
      },
    };
    const fragmented = new Set<string>(['99,99,99']);
    const energy = new Map<string, number>([['99,99,99', 200]]);
    const points = generateSeedPointCloud(fragmented, energy, grid, new Random(42));
    expect(points).toEqual([]);
  });

  it('deterministic with same seed', () => {
    const grid = makeMockGrid(['0,0,0', '1,1,1']);
    const fragmented = new Set<string>(['0,0,0', '1,1,1']);
    const energy = new Map<string, number>([
      ['0,0,0', 200],
      ['1,1,1', 400],
    ]);
    const a = generateSeedPointCloud(fragmented, energy, grid, new Random(77));
    const b = generateSeedPointCloud(fragmented, energy, grid, new Random(77));
    expect(a).toHaveLength(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(a[i].x).toBe(b[i].x);
      expect(a[i].y).toBe(b[i].y);
      expect(a[i].z).toBe(b[i].z);
    }
  });

  it('each output point has distinct coordinates (no duplicates across voxels)', () => {
    const grid = makeMockGrid(['0,0,0', '2,2,2']);
    const fragmented = new Set<string>(['0,0,0', '2,2,2']);
    const energy = new Map<string, number>([
      ['0,0,0', 200],
      ['2,2,2', 200],
    ]);
    const points = generateSeedPointCloud(fragmented, energy, grid, new Random(42));
    const seen = new Set<string>();
    for (const p of points) {
      const key = `${p.x},${p.y},${p.z}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('handles large fragmented set without crashing', () => {
    // 100 voxels each with 3 points = 300 total points
    const voxelKeys: string[] = [];
    const fragmented = new Set<string>();
    const energy = new Map<string, number>();
    for (let i = 0; i < 100; i++) {
      const key = `${i},0,0`;
      voxelKeys.push(key);
      fragmented.add(key);
      energy.set(key, 200); // each produces 3 points
    }
    const grid = makeMockGrid(voxelKeys);
    const points = generateSeedPointCloud(fragmented, energy, grid, new Random(42));
    expect(points).toHaveLength(300);
  });

  it('does not mutate input fragmentedVoxels set', () => {
    const grid = makeMockGrid(['0,0,0']);
    const fragmented = new Set<string>(['0,0,0']);
    const snapshot = new Set(fragmented);
    generateSeedPointCloud(fragmented, new Map([['0,0,0', 200]]), grid, new Random(42));
    expect(fragmented).toEqual(snapshot);
  });

  it('does not mutate input effectiveEnergy map', () => {
    const grid = makeMockGrid(['0,0,0']);
    const energy = new Map<string, number>([['0,0,0', 200]]);
    const snapshot = new Map(energy);
    generateSeedPointCloud(new Set(['0,0,0']), energy, grid, new Random(42));
    expect(energy).toEqual(snapshot);
  });
});
