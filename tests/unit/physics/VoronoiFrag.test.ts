// BlastSimulator2026 — Unit tests: VoronoiFrag module
// Task 5.8: computeFragmentationScore, computeFragmentCount, sampleVoronoiSeeds
// All tests should FAIL (Red phase) — stubs currently return 0 / 1 / [].

import { describe, it, expect } from 'vitest';
import {
  computeFragmentationScore,
  computeFragmentCount,
  sampleVoronoiSeeds,
} from '../../../src/physics/VoronoiFrag.js';
import { VoxelGrid, type VoxelData } from '../../../src/core/world/VoxelGrid.js';
import { FRAGMENTATION_SCORE_SCALE } from '../../../src/core/config/balance.js';
import { Random } from '../../../src/core/math/Random.js';
import { vec3 } from '../../../src/core/math/Vec3.js';
import { getRock } from '../../../src/core/world/RockCatalog.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Group 1: computeFragmentationScore
// Formula: FRAGMENTATION_SCORE_SCALE * (effectiveEnergy / threshold)
// FRAGMENTATION_SCORE_SCALE = 3.0
// ═══════════════════════════════════════════════════════════════════════════════

describe('VoronoiFrag — computeFragmentationScore', () => {
  it('returns 0 when effectiveEnergy is 0', () => {
    expect(computeFragmentationScore(0, 100)).toBe(0);
  });

  it('returns 0 when threshold is 0', () => {
    expect(computeFragmentationScore(100, 0)).toBe(0);
  });

  it('returns 0 when threshold is negative', () => {
    expect(computeFragmentationScore(100, -10)).toBe(0);
  });

  it('returns 0 when effectiveEnergy is negative', () => {
    expect(computeFragmentationScore(-100, 100)).toBe(0);
  });

  it('returns correct positive value for equal energy and threshold', () => {
    // FRAGMENTATION_SCORE_SCALE * (100 / 100) = 3.0
    const result = computeFragmentationScore(100, 100);
    expect(result).toBe(FRAGMENTATION_SCORE_SCALE * 1.0);
    expect(result).toBe(3.0);
  });

  it('returns scaled value when energy exceeds threshold', () => {
    // FRAGMENTATION_SCORE_SCALE * (200 / 50) = 3.0 * 4 = 12.0
    const result = computeFragmentationScore(200, 50);
    expect(result).toBe(12.0);
  });

  it('returns fractional value when energy is below threshold', () => {
    // FRAGMENTATION_SCORE_SCALE * (50 / 100) = 3.0 * 0.5 = 1.5
    const result = computeFragmentationScore(50, 100);
    expect(result).toBe(1.5);
  });

  it('handles NaN effectiveEnergy by returning 0', () => {
    expect(computeFragmentationScore(NaN, 100)).toBe(0);
  });

  it('handles Infinity threshold by returning 0', () => {
    expect(computeFragmentationScore(100, Infinity)).toBe(0);
  });

  it('handles Infinity effectiveEnergy by returning 0', () => {
    expect(computeFragmentationScore(Infinity, 100)).toBe(0);
  });

  it('handles -Infinity effectiveEnergy by returning 0', () => {
    expect(computeFragmentationScore(-Infinity, 100)).toBe(0);
  });

  it('handles threshold of NaN by returning 0', () => {
    expect(computeFragmentationScore(100, NaN)).toBe(0);
  });

  it('returns 0 when effectiveEnergy is 0 and threshold is normal', () => {
    expect(computeFragmentationScore(0, 50)).toBe(0);
  });

  it('preserves FRAGMENTATION_SCORE_SCALE constant at 3.0', () => {
    expect(FRAGMENTATION_SCORE_SCALE).toBe(3.0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 2: computeFragmentCount
// Formula: Math.max(1, Math.round(score))
// ═══════════════════════════════════════════════════════════════════════════════

describe('VoronoiFrag — computeFragmentCount', () => {
  it('returns 1 for score of 0', () => {
    expect(computeFragmentCount(0)).toBe(1);
  });

  it('returns 1 for negative score', () => {
    expect(computeFragmentCount(-5)).toBe(1);
  });

  it('returns 1 for very negative score', () => {
    expect(computeFragmentCount(-1000)).toBe(1);
  });

  it('rounds integer score to same integer >= 1', () => {
    expect(computeFragmentCount(3.0)).toBe(3);
  });

  it('rounds score of 3.49 down to 3', () => {
    expect(computeFragmentCount(3.49)).toBe(3);
  });

  it('rounds score of 3.5 up to 4', () => {
    expect(computeFragmentCount(3.5)).toBe(4);
  });

  it('rounds score of 1.49 down to 1', () => {
    expect(computeFragmentCount(1.49)).toBe(1);
  });

  it('rounds score of 1.5 up to 2', () => {
    expect(computeFragmentCount(1.5)).toBe(2);
  });

  it('returns 1 for NaN', () => {
    expect(computeFragmentCount(NaN)).toBe(1);
  });

  it('returns 1 for Infinity', () => {
    expect(computeFragmentCount(Infinity)).toBe(1);
  });

  it('returns 1 for -Infinity', () => {
    expect(computeFragmentCount(-Infinity)).toBe(1);
  });

  it('returns correct value for score equal to FRAGMENTATION_SCORE_SCALE', () => {
    // FRAGMENTATION_SCORE_SCALE = 3.0
    expect(computeFragmentCount(FRAGMENTATION_SCORE_SCALE)).toBe(3);
  });

  it('caps fragment count at MAX_FRAGMENTS_PER_VOXEL for large scores', () => {
    expect(computeFragmentCount(50.2)).toBe(20);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 3: sampleVoronoiSeeds
// For each "x,y,z" key in fragmentedVoxels:
//   1. Parse coordinates
//   2. Look up effectiveEnergy (default 0 if missing)
//   3. Get VoxelData from grid
//   4. Compute threshold via computeThreshold(voxel)
//   5. Call computeFragmentationScore → score
//   6. Call computeFragmentCount → count
//   7. Sample count random 3D points inside voxel's unit cube
// ═══════════════════════════════════════════════════════════════════════════════

describe('VoronoiFrag — sampleVoronoiSeeds', () => {
  // ── Known rock data ─────────────────────────────────────────────────────────
  // cruite:  energyAbsorption = 200
  // sandite: energyAbsorption = 250

  it('returns empty array for empty fragmented voxels set', () => {
    const grid = new VoxelGrid(10, 10, 10);
    const rng = new Random(42);
    const seeds = sampleVoronoiSeeds(new Set(), new Map(), grid, rng);
    expect(seeds).toEqual([]);
  });

  it('produces correct fragment count from a single fragmented voxel', () => {
    // voxel(0,0,0) with pure cruite: threshold = 200
    // effectiveEnergy = 200 → score = 3.0 * (200/200) = 3.0 → count = 3
    const grid = new VoxelGrid(10, 10, 10);
    grid.setVoxel(0, 0, 0, {
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      density: 1.0,
      oreDensities: {},
      fractureModifier: 1.0,
    });

    const fragmented = new Set<string>(['0,0,0']);
    const energy = new Map<string, number>([['0,0,0', 200]]);
    const rng = new Random(42);

    const seeds = sampleVoronoiSeeds(fragmented, energy, grid, rng);

    // Expect 3 seed points (one per fragment)
    expect(seeds).toHaveLength(3);
  });

  it('produces correct count with energy above threshold', () => {
    // voxel(0,0,0) with pure cruite: threshold = 200
    // effectiveEnergy = 600 → score = 3.0 * (600/200) = 9.0 → count = 9
    const grid = new VoxelGrid(10, 10, 10);
    grid.setVoxel(0, 0, 0, {
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      density: 1.0,
      oreDensities: {},
      fractureModifier: 1.0,
    });

    const fragmented = new Set<string>(['0,0,0']);
    const energy = new Map<string, number>([['0,0,0', 600]]);
    const rng = new Random(42);

    const seeds = sampleVoronoiSeeds(fragmented, energy, grid, rng);

    expect(seeds).toHaveLength(9);
  });

  it('produces exactly 1 seed when effectiveEnergy is 0', () => {
    // threshold for cruite = 200, effectiveEnergy = 0
    // score = 3.0 * (0/200) = 0 → count = 1
    const grid = new VoxelGrid(10, 10, 10);
    grid.setVoxel(0, 0, 0, {
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      density: 1.0,
      oreDensities: {},
      fractureModifier: 1.0,
    });

    const fragmented = new Set<string>(['0,0,0']);
    const energy = new Map<string, number>([['0,0,0', 0]]);
    const rng = new Random(42);

    const seeds = sampleVoronoiSeeds(fragmented, energy, grid, rng);
    expect(seeds).toHaveLength(1);
  });

  it('produces each point within the source voxel unit cube', () => {
    // voxel(5, 10, 20) with pure cruite
    // effectiveEnergy = 200, threshold = 200 → score = 3.0 → count = 3
    const grid = new VoxelGrid(30, 30, 30);
    grid.setVoxel(5, 10, 20, {
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      density: 1.0,
      oreDensities: {},
      fractureModifier: 1.0,
    });

    const fragmented = new Set<string>(['5,10,20']);
    const energy = new Map<string, number>([['5,10,20', 200]]);
    const rng = new Random(42);

    const seeds = sampleVoronoiSeeds(fragmented, energy, grid, rng);

    expect(seeds).toHaveLength(3);
    for (const p of seeds) {
      expect(p.x).toBeGreaterThanOrEqual(5);
      expect(p.x).toBeLessThan(6);
      expect(p.y).toBeGreaterThanOrEqual(10);
      expect(p.y).toBeLessThan(11);
      expect(p.z).toBeGreaterThanOrEqual(20);
      expect(p.z).toBeLessThan(21);
    }
  });

  it('produces deterministic results with the same seed', () => {
    const grid = new VoxelGrid(10, 10, 10);
    grid.setVoxel(0, 0, 0, {
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      density: 1.0,
      oreDensities: {},
      fractureModifier: 1.0,
    });

    const fragmented = new Set<string>(['0,0,0']);
    const energy = new Map<string, number>([['0,0,0', 200]]);

    const seeds1 = sampleVoronoiSeeds(fragmented, energy, grid, new Random(42));
    const seeds2 = sampleVoronoiSeeds(fragmented, energy, grid, new Random(42));

    expect(seeds1).toEqual(seeds2);
  });

  it('produces different results with different seeds', () => {
    const grid = new VoxelGrid(10, 10, 10);
    grid.setVoxel(0, 0, 0, {
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      density: 1.0,
      oreDensities: {},
      fractureModifier: 1.0,
    });

    const fragmented = new Set<string>(['0,0,0']);
    const energy = new Map<string, number>([['0,0,0', 200]]);

    const seeds1 = sampleVoronoiSeeds(fragmented, energy, grid, new Random(42));
    const seeds2 = sampleVoronoiSeeds(fragmented, energy, grid, new Random(123));

    // Different seeds should produce different points
    // (Collision probability is negligible for 3 points with 32-bit floats)
    const allEqual = seeds1.length === seeds2.length &&
      seeds1.every((p, i) => p.x === seeds2[i]!.x && p.y === seeds2[i]!.y && p.z === seeds2[i]!.z);
    expect(allEqual).toBe(false);
  });

  it('handles voxel key absent from effectiveEnergy Map (defaults to 0 energy)', () => {
    // key in fragmentedVoxels, but NOT in effectiveEnergy → energy defaults to 0
    // threshold for cruite = 200 → score = 0 → count = 1
    const grid = new VoxelGrid(10, 10, 10);
    grid.setVoxel(2, 3, 4, {
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      density: 1.0,
      oreDensities: {},
      fractureModifier: 1.0,
    });

    const fragmented = new Set<string>(['2,3,4']);
    // Intentionally empty energy map
    const energy = new Map<string, number>();
    const rng = new Random(42);

    const seeds = sampleVoronoiSeeds(fragmented, energy, grid, rng);

    // With 0 energy, score = 0 → count = 1
    expect(seeds).toHaveLength(1);
    expect(seeds[0]!.x).toBeGreaterThanOrEqual(2);
    expect(seeds[0]!.x).toBeLessThan(3);
  });

  it('handles multiple fragmented voxels and sums their seed points', () => {
    // 3 voxels, each with score = 3.0 → count = 3 → total = 9
    const grid = new VoxelGrid(10, 10, 10);
    grid.setVoxel(0, 0, 0, {
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      density: 1.0,
      oreDensities: {},
      fractureModifier: 1.0,
    });
    grid.setVoxel(1, 0, 0, {
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      density: 1.0,
      oreDensities: {},
      fractureModifier: 1.0,
    });
    grid.setVoxel(2, 0, 0, {
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      density: 1.0,
      oreDensities: {},
      fractureModifier: 1.0,
    });

    const fragmented = new Set<string>(['0,0,0', '1,0,0', '2,0,0']);
    const energy = new Map<string, number>([
      ['0,0,0', 200],
      ['1,0,0', 200],
      ['2,0,0', 200],
    ]);
    const rng = new Random(42);

    const seeds = sampleVoronoiSeeds(fragmented, energy, grid, rng);

    // 3 voxels × 3 seeds each = 9 total
    expect(seeds).toHaveLength(9);
  });

  it('silently skips out-of-bounds voxels without crashing', () => {
    // One valid voxel at (0,0,0) and one out-of-bounds at (999,999,999)
    const grid = new VoxelGrid(10, 10, 10);
    grid.setVoxel(0, 0, 0, {
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      density: 1.0,
      oreDensities: {},
      fractureModifier: 1.0,
    });

    const fragmented = new Set<string>(['0,0,0', '999,999,999']);
    const energy = new Map<string, number>([
      ['0,0,0', 200],
      ['999,999,999', 9999],
    ]);
    const rng = new Random(42);

    const seeds = sampleVoronoiSeeds(fragmented, energy, grid, rng);

    // Should only produce seeds from the valid voxel (3 seeds)
    expect(seeds).toHaveLength(3);
    for (const p of seeds) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThan(10);
    }
  });

  it('works with out-of-bounds voxel that has no matching grid entry', () => {
    // Only invalid voxel — should return empty
    const grid = new VoxelGrid(10, 10, 10);
    const fragmented = new Set<string>(['999,999,999']);
    const energy = new Map<string, number>([['999,999,999', 200]]);
    const rng = new Random(42);

    const seeds = sampleVoronoiSeeds(fragmented, energy, grid, rng);
    expect(seeds).toEqual([]);
  });

  it('works with voxel having mixed rock composition', () => {
    // 0.5 × cruite (200) + 0.5 × sandite (250) = 225
    // effectiveEnergy = 225 → score = 3.0 * (225/225) = 3.0 → count = 3
    const grid = new VoxelGrid(10, 10, 10);
    grid.setVoxel(3, 5, 7, {
      composition: {
        rocks: [
          { rockId: 'cruite', coefficient: 0.5 },
          { rockId: 'sandite', coefficient: 0.5 },
        ],
      },
      density: 1.0,
      oreDensities: {},
      fractureModifier: 1.0,
    });

    const fragmented = new Set<string>(['3,5,7']);
    const energy = new Map<string, number>([['3,5,7', 225]]);
    const rng = new Random(42);

    const seeds = sampleVoronoiSeeds(fragmented, energy, grid, rng);

    // Expect 3 seed points all within the voxel unit cube at (3,5,7)
    expect(seeds).toHaveLength(3);
    for (const p of seeds) {
      expect(p.x).toBeGreaterThanOrEqual(3);
      expect(p.x).toBeLessThan(4);
      expect(p.y).toBeGreaterThanOrEqual(5);
      expect(p.y).toBeLessThan(6);
      expect(p.z).toBeGreaterThanOrEqual(7);
      expect(p.z).toBeLessThan(8);
    }
  });

  it('returns Vec3 objects for each seed point', () => {
    const grid = new VoxelGrid(10, 10, 10);
    grid.setVoxel(0, 0, 0, {
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      density: 1.0,
      oreDensities: {},
      fractureModifier: 1.0,
    });

    const fragmented = new Set<string>(['0,0,0']);
    const energy = new Map<string, number>([['0,0,0', 200]]);
    const rng = new Random(42);

    const seeds = sampleVoronoiSeeds(fragmented, energy, grid, rng);

    expect(seeds).toHaveLength(3);
    for (const p of seeds) {
      // Verify each has x, y, z numeric fields
      expect(typeof p.x).toBe('number');
      expect(typeof p.y).toBe('number');
      expect(typeof p.z).toBe('number');
    }
  });

  it('points from two adjacent voxels stay within their respective cubes', () => {
    // Two adjacent voxels: (0,0,0) and (1,0,0)
    // Each produces 3 seeds, all within their own unit cube
    const grid = new VoxelGrid(10, 10, 10);
    grid.setVoxel(0, 0, 0, {
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      density: 1.0,
      oreDensities: {},
      fractureModifier: 1.0,
    });
    grid.setVoxel(1, 0, 0, {
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      density: 1.0,
      oreDensities: {},
      fractureModifier: 1.0,
    });

    const fragmented = new Set<string>(['0,0,0', '1,0,0']);
    const energy = new Map<string, number>([
      ['0,0,0', 200],
      ['1,0,0', 200],
    ]);
    const rng = new Random(42);

    const seeds = sampleVoronoiSeeds(fragmented, energy, grid, rng);

    expect(seeds).toHaveLength(6);

    // Seeds are in voxel order, first 3 from (0,0,0), next 3 from (1,0,0)
    for (let i = 0; i < 3; i++) {
      expect(seeds[i]!.x).toBeGreaterThanOrEqual(0);
      expect(seeds[i]!.x).toBeLessThan(1);
    }
    for (let i = 3; i < 6; i++) {
      expect(seeds[i]!.x).toBeGreaterThanOrEqual(1);
      expect(seeds[i]!.x).toBeLessThan(2);
    }
  });
});
