// BlastSimulator2026 — Unit tests: VoronoiFrag module
// Task 5.8: computeFragmentationScore, computeFragmentCount, sampleVoronoiSeeds
// All tests should FAIL (Red phase) — stubs currently return 0 / 1 / [].

import { describe, it, expect } from 'vitest';
import {
  computeFragmentationScore,
  computeFragmentCount,
  sampleVoronoiSeeds,
  computeBoundingBox,
  cullLowestScoreVoxels,
  computeCircumcenter,
  bowyerWatsonDelaunay,
  computeVoronoiCells,
  clipVoronoiCell,
  generateFragments,
  buildAdjacencyMap,
  convexHull3D,
  mergeTwoCells,
  mergeVoronoiCells,
  type Tetrahedron,
  type VoronoiCell,
  type BoundingBox,
} from '../../../src/physics/VoronoiFrag.js';
import { VoxelGrid, type VoxelData } from '../../../src/core/world/VoxelGrid.js';
import {
  FRAGMENTATION_SCORE_SCALE,
  MAX_VORONOI_POINTS,
  MAX_FRAGMENTS_PER_VOXEL,
  MERGE_PROBABILITY,
} from '../../../src/core/config/balance.js';
import { Random } from '../../../src/core/math/Random.js';
import { vec3, clamp, equals, distance, add, sub, scale, dot, cross } from '../../../src/core/math/Vec3.js';
import { getRock } from '../../../src/core/world/RockCatalog.js';
import { computeThreshold, parseKey } from '../../../src/core/mining/BlastCalc.js';

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

// ═══════════════════════════════════════════════════════════════════════════════
// Group 4: computeBoundingBox
// Stub always returns { minX:0, minY:0, minZ:0, maxX:0, maxY:0, maxZ:0 }
// ═══════════════════════════════════════════════════════════════════════════════

describe('VoronoiFrag — computeBoundingBox', () => {
  it('empty set returns all zeros', () => {
    const result = computeBoundingBox(new Set());

    expect(result.minX).toBe(0);
    expect(result.minY).toBe(0);
    expect(result.minZ).toBe(0);
    expect(result.maxX).toBe(0);
    expect(result.maxY).toBe(0);
    expect(result.maxZ).toBe(0);
  });

  it('single voxel returns correct bounds', () => {
    const result = computeBoundingBox(new Set(['5,10,20']));

    expect(result.minX).toBe(5);
    expect(result.maxX).toBe(5);
    expect(result.minY).toBe(10);
    expect(result.maxY).toBe(10);
    expect(result.minZ).toBe(20);
    expect(result.maxZ).toBe(20);
  });

  it('multiple voxels returns correct bounds', () => {
    const result = computeBoundingBox(new Set(['0,0,0', '10,20,30']));

    expect(result.minX).toBe(0);
    expect(result.minY).toBe(0);
    expect(result.minZ).toBe(0);
    expect(result.maxX).toBe(10);
    expect(result.maxY).toBe(20);
    expect(result.maxZ).toBe(30);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 5: cullLowestScoreVoxels
// Stub returns empty set — tests should FAIL for non-empty inputs
// Each voxel uses pure cruite (threshold = 200)
//   score = 3.0 * (energy / 200)
//   count = max(1, round(score))
// ═══════════════════════════════════════════════════════════════════════════════

describe('VoronoiFrag — cullLowestScoreVoxels', () => {
  it('under limit returns original set', () => {
    // 3 voxels × 3 points each (energy=200) = 9 total, maxPoints = 2000 → no culling
    const grid = new VoxelGrid(5, 5, 5);
    for (let x = 0; x < 3; x++) {
      grid.setVoxel(x, 0, 0, {
        composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
        density: 1.0,
        oreDensities: {},
        fractureModifier: 1.0,
      });
    }

    const fragmented = new Set<string>(['0,0,0', '1,0,0', '2,0,0']);
    const energy = new Map<string, number>([
      ['0,0,0', 200],
      ['1,0,0', 200],
      ['2,0,0', 200],
    ]);

    const result = cullLowestScoreVoxels(fragmented, energy, grid, MAX_VORONOI_POINTS);

    // Should keep all 3 voxels since 9 points ≤ 2000
    expect(result).toEqual(fragmented);
  });

  it('over limit culls lowest score voxels', () => {
    // 5 voxels with increasing energy:
    //   (0,0,0): energy=200 → score=3.0 → count=3
    //   (1,0,0): energy=400 → score=6.0 → count=6
    //   (2,0,0): energy=600 → score=9.0 → count=9
    //   (3,0,0): energy=800 → score=12.0 → count=12
    //   (4,0,0): energy=1000 → score=15.0 → count=15
    // Total = 45, maxPoints = 20 → cull lowest until ≤ 20
    //   Remove (0,0,0) -3pt → 42 > 20
    //   Remove (1,0,0) -6pt → 36 > 20
    //   Remove (2,0,0) -9pt → 27 > 20
    //   Remove (3,0,0) -12pt → 15 ≤ 20 ✓
    // Expected: only (4,0,0) with 15 points remains
    const grid = new VoxelGrid(5, 5, 5);
    for (let x = 0; x < 5; x++) {
      grid.setVoxel(x, 0, 0, {
        composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
        density: 1.0,
        oreDensities: {},
        fractureModifier: 1.0,
      });
    }

    const fragmented = new Set<string>(['0,0,0', '1,0,0', '2,0,0', '3,0,0', '4,0,0']);
    const energy = new Map<string, number>([
      ['0,0,0', 200],
      ['1,0,0', 400],
      ['2,0,0', 600],
      ['3,0,0', 800],
      ['4,0,0', 1000],
    ]);

    const result = cullLowestScoreVoxels(fragmented, energy, grid, 20);

    // Only the highest-scoring voxel (4,0,0) should remain
    expect(result).toEqual(new Set(['4,0,0']));
  });

  it('empty set returns empty', () => {
    const grid = new VoxelGrid(5, 5, 5);
    const result = cullLowestScoreVoxels(new Set(), new Map(), grid, 100);
    expect(result).toEqual(new Set());
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 6: computeCircumcenter
// Stub returns vec3(0, 0, 0) — tests should FAIL
// ═══════════════════════════════════════════════════════════════════════════════

describe('VoronoiFrag — computeCircumcenter', () => {
  it('regular tetrahedron (unit)', () => {
    // Unit tetrahedron: A(0,0,0), B(1,0,0), C(0,1,0), D(0,0,1)
    // Circumcenter should be at (0.5, 0.5, 0.5)
    const a = vec3(0, 0, 0);
    const b = vec3(1, 0, 0);
    const c = vec3(0, 1, 0);
    const d = vec3(0, 0, 1);

    const result = computeCircumcenter(a, b, c, d);

    expect(result.x).toBe(0.5);
    expect(result.y).toBe(0.5);
    expect(result.z).toBe(0.5);
  });

  it('regular tetrahedron (scaled)', () => {
    // Scaled tetrahedron: A(0,0,0), B(2,0,0), C(0,2,0), D(0,0,2)
    // Circumcenter should be at (1, 1, 1)
    const a = vec3(0, 0, 0);
    const b = vec3(2, 0, 0);
    const c = vec3(0, 2, 0);
    const d = vec3(0, 0, 2);

    const result = computeCircumcenter(a, b, c, d);

    expect(result.x).toBe(1);
    expect(result.y).toBe(1);
    expect(result.z).toBe(1);
  });

  it('degenerate/coplanar points returns fallback centroid', () => {
    // Four points on the z=0 plane → degenerate (coplanar)
    // Fallback should return the centroid: (0.5, 0.5, 0)
    const a = vec3(0, 0, 0);
    const b = vec3(1, 0, 0);
    const c = vec3(0, 1, 0);
    const d = vec3(1, 1, 0);

    const result = computeCircumcenter(a, b, c, d);

    expect(result.x).toBe(0.5);
    expect(result.y).toBe(0.5);
    expect(result.z).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 7: bowyerWatsonDelaunay
// Stub returns [] — tests should FAIL
// ═══════════════════════════════════════════════════════════════════════════════

describe('VoronoiFrag — bowyerWatsonDelaunay', () => {
  it('less than 4 points returns empty array', () => {
    const threePoints = [vec3(0, 0, 0), vec3(1, 0, 0), vec3(0, 1, 0)];
    const result = bowyerWatsonDelaunay(threePoints);

    expect(result).toEqual([]);
  });

  it('exactly 4 non-degenerate points returns 1 tetrahedron', () => {
    const points = [
      vec3(0, 0, 0),
      vec3(1, 0, 0),
      vec3(0, 1, 0),
      vec3(0, 0, 1),
    ];

    const result = bowyerWatsonDelaunay(points);

    expect(result).toHaveLength(1);
  });

  it('vertex indices reference original array order', () => {
    const points = [
      vec3(0, 0, 0),
      vec3(1, 0, 0),
      vec3(0, 1, 0),
      vec3(0, 0, 1),
    ];

    const result = bowyerWatsonDelaunay(points);

    expect(result).toHaveLength(1);
    const tet = result[0]!;
    // The four vertex indices of the single tetrahedron should be 0, 1, 2, 3
    const indices = [tet.a, tet.b, tet.c, tet.d].sort();
    expect(indices).toEqual([0, 1, 2, 3]);
  });

  it('each tetrahedron has a valid circumcenter Vec3', () => {
    const points = [
      vec3(0, 0, 0),
      vec3(1, 0, 0),
      vec3(0, 1, 0),
      vec3(0, 0, 1),
    ];

    const result = bowyerWatsonDelaunay(points);

    expect(result).toHaveLength(1);
    const tet = result[0]!;
    // circumcenter should be a valid Vec3 with numeric components
    expect(typeof tet.circumcenter.x).toBe('number');
    expect(typeof tet.circumcenter.y).toBe('number');
    expect(typeof tet.circumcenter.z).toBe('number');
    // For this regular tetrahedron, circumcenter = (0.5, 0.5, 0.5)
    expect(tet.circumcenter.x).toBe(0.5);
    expect(tet.circumcenter.y).toBe(0.5);
    expect(tet.circumcenter.z).toBe(0.5);
  });

  it('returns empty for 0, 1, 2, and 3 points', () => {
    expect(bowyerWatsonDelaunay([])).toEqual([]);
    expect(bowyerWatsonDelaunay([vec3(0, 0, 0)])).toEqual([]);
    expect(bowyerWatsonDelaunay([vec3(0, 0, 0), vec3(1, 0, 0)])).toEqual([]);
    expect(bowyerWatsonDelaunay([vec3(0, 0, 0), vec3(1, 0, 0), vec3(0, 1, 0)])).toEqual([]);
  });

  it('no vertex index is >= original point count', () => {
    const points = [
      vec3(0, 0, 0),
      vec3(1, 0, 0),
      vec3(0, 1, 0),
      vec3(0, 0, 1),
    ];

    const result = bowyerWatsonDelaunay(points);

    for (const tet of result) {
      expect(tet.a).toBeLessThan(points.length);
      expect(tet.b).toBeLessThan(points.length);
      expect(tet.c).toBeLessThan(points.length);
      expect(tet.d).toBeLessThan(points.length);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 8: computeVoronoiCells
// Stub returns [] — tests should FAIL
// ═══════════════════════════════════════════════════════════════════════════════

describe('VoronoiFrag — computeVoronoiCells', () => {
  const singleTet: Tetrahedron = {
    a: 0, b: 1, c: 2, d: 3,
    circumcenter: vec3(0.5, 0.5, 0.5),
  };

  it('correct number of cells from single tetrahedron', () => {
    const result = computeVoronoiCells([singleTet], 4);

    // 4 points → 4 Voronoi cells (one per seed)
    expect(result).toHaveLength(4);
  });

  it('each cell has a valid seedIndex in range 0..pointCount-1', () => {
    const result = computeVoronoiCells([singleTet], 4);

    expect(result).toHaveLength(4);
    const indices = result.map(c => c.seedIndex).sort();
    expect(indices).toEqual([0, 1, 2, 3]);
  });

  it('cells from single tetrahedron have exactly 1 vertex each', () => {
    const result = computeVoronoiCells([singleTet], 4);

    // Each Voronoi cell from a single tet gets the tet's circumcenter as its sole vertex
    for (const cell of result) {
      expect(cell.vertices).toHaveLength(1);
    }
  });

  it('handles empty tetrahedra array', () => {
    const result = computeVoronoiCells([], 4);

    // With no tetrahedra, all cells should be invalid with empty vertices
    expect(result).toHaveLength(4);
    for (const cell of result) {
      expect(cell.vertices).toEqual([]);
      expect(cell.isValid).toBe(false);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 9: clipVoronoiCell
// Stub returns { seedIndex:0, vertices:[], isValid:false } — tests should FAIL
// ═══════════════════════════════════════════════════════════════════════════════

describe('VoronoiFrag — clipVoronoiCell', () => {
  const bounds: BoundingBox = { minX: 0, minY: 0, minZ: 0, maxX: 10, maxY: 10, maxZ: 10 };

  it('vertices inside bounds remain unchanged', () => {
    const cell: VoronoiCell = {
      seedIndex: 0,
      vertices: [vec3(2, 3, 4), vec3(5, 6, 7)],
      isValid: true,
    };

    const result = clipVoronoiCell(cell, bounds);

    // Both vertices are inside bounds → should pass through unchanged
    expect(result.vertices).toHaveLength(2);
    expect(result.vertices[0]!.x).toBe(2);
    expect(result.vertices[0]!.y).toBe(3);
    expect(result.vertices[0]!.z).toBe(4);
    expect(result.vertices[1]!.x).toBe(5);
    expect(result.vertices[1]!.y).toBe(6);
    expect(result.vertices[1]!.z).toBe(7);
  });

  it('vertices outside bounds get clamped', () => {
    const cell: VoronoiCell = {
      seedIndex: 0,
      vertices: [vec3(15, 20, 25)],
      isValid: true,
    };

    const result = clipVoronoiCell(cell, bounds);

    // Vertex at (15,20,25) should be clamped to (10,10,10)
    expect(result.vertices).toHaveLength(1);
    expect(result.vertices[0]!.x).toBe(10);
    expect(result.vertices[0]!.y).toBe(10);
    expect(result.vertices[0]!.z).toBe(10);
  });

  it('empty vertices stays empty and invalid', () => {
    const cell: VoronoiCell = {
      seedIndex: 0,
      vertices: [],
      isValid: false,
    };

    const result = clipVoronoiCell(cell, bounds);

    expect(result.vertices).toEqual([]);
    expect(result.isValid).toBe(false);
  });

  it('keeps isValid=true when 4 or more vertices remain after clipping', () => {
    // 4 vertices all inside bounds → all pass through → isValid stays true
    const cell: VoronoiCell = {
      seedIndex: 0,
      vertices: [
        vec3(1, 1, 1),
        vec3(1, 1, 9),
        vec3(1, 9, 1),
        vec3(1, 9, 9),
      ],
      isValid: true,
    };

    const result = clipVoronoiCell(cell, bounds);

    expect(result.vertices).toHaveLength(4);
    expect(result.isValid).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 10: generateFragments (end-to-end)
// Stub returns [] — tests should FAIL
// ═══════════════════════════════════════════════════════════════════════════════

describe('VoronoiFrag — generateFragments', () => {
  const points = [
    vec3(0, 0, 0),
    vec3(1, 0, 0),
    vec3(0, 1, 0),
    vec3(0, 0, 1),
  ];

  const tetrahedra: Tetrahedron[] = [{
    a: 0, b: 1, c: 2, d: 3,
    circumcenter: vec3(0.5, 0.5, 0.5),
  }];

  const bounds: BoundingBox = { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 };

  it('returns array of VoronoiCell matching point count', () => {
    const result = generateFragments(points, tetrahedra, bounds);

    // 4 seed points → 4 Voronoi cells
    expect(result).toHaveLength(4);
  });

  it('marks cells with fewer than 4 vertices as invalid', () => {
    // With only 1 tetrahedron, each seed has exactly 1 incident circumcenter.
    // Since isValid requires ≥4 vertices, all 4 cells should be isValid=false.
    const result = generateFragments(points, tetrahedra, bounds);
    expect(result).toHaveLength(4);
    for (const cell of result) {
      expect(cell.vertices.length).toBe(1);
      expect(cell.isValid).toBe(false);
    }
  });

  it('all vertices are within the bounding box', () => {
    const result = generateFragments(points, tetrahedra, bounds);

    expect(result).toHaveLength(4);
    for (const cell of result) {
      for (const v of cell.vertices) {
        expect(v.x).toBeGreaterThanOrEqual(0);
        expect(v.x).toBeLessThanOrEqual(1);
        expect(v.y).toBeGreaterThanOrEqual(0);
        expect(v.y).toBeLessThanOrEqual(1);
        expect(v.z).toBeGreaterThanOrEqual(0);
        expect(v.z).toBeLessThanOrEqual(1);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 11: buildAdjacencyMap (Task 5.10 — Voronoi merging pass)
// Stub returns empty Map — tests should FAIL
// ═══════════════════════════════════════════════════════════════════════════════

describe('VoronoiFrag — buildAdjacencyMap', () => {
  it('returns map with all empty sets for empty tetrahedra array', () => {
    const result = buildAdjacencyMap([], 4);

    // Stub returns empty Map — will fail
    expect(result.size).toBe(4);
    for (let i = 0; i < 4; i++) {
      expect(result.has(i)).toBe(true);
      expect(result.get(i)).toEqual(new Set());
    }
  });

  it('builds adjacency from single tetrahedron', () => {
    const tet: Tetrahedron = { a: 0, b: 1, c: 2, d: 3, circumcenter: vec3(0.5, 0.5, 0.5) };
    const result = buildAdjacencyMap([tet], 4);

    // Stub returns empty Map — will fail
    expect(result.size).toBe(4);
    expect(result.get(0)).toEqual(new Set([1, 2, 3]));
    expect(result.get(1)).toEqual(new Set([0, 2, 3]));
    expect(result.get(2)).toEqual(new Set([0, 1, 3]));
    expect(result.get(3)).toEqual(new Set([0, 1, 2]));
  });

  it('builds adjacency from two disconnected tetrahedra', () => {
    const tet0: Tetrahedron = { a: 0, b: 1, c: 2, d: 3, circumcenter: vec3(0.5, 0.5, 0.5) };
    const tet1: Tetrahedron = { a: 4, b: 5, c: 6, d: 7, circumcenter: vec3(0.5, 0.5, 0.5) };
    const result = buildAdjacencyMap([tet0, tet1], 8);

    // Stub returns empty Map — will fail
    expect(result.size).toBe(8);
    expect(result.get(0)).toEqual(new Set([1, 2, 3]));
    expect(result.get(4)).toEqual(new Set([5, 6, 7]));
    // No cross-edges between groups 0-3 and 4-7
    for (let i = 0; i < 4; i++) {
      for (let j = 4; j < 8; j++) {
        expect(result.get(i)!.has(j)).toBe(false);
      }
    }
  });

  it('builds adjacency from two connected tetrahedra', () => {
    const tet0: Tetrahedron = { a: 0, b: 1, c: 2, d: 3, circumcenter: vec3(0.5, 0.5, 0.5) };
    const tet1: Tetrahedron = { a: 0, b: 1, c: 4, d: 5, circumcenter: vec3(0.5, 0.5, 0.5) };
    const result = buildAdjacencyMap([tet0, tet1], 6);

    // Stub returns empty Map — will fail
    expect(result.size).toBe(6);
    expect(result.get(0)!.has(4)).toBe(true);
    expect(result.get(0)!.has(5)).toBe(true);
  });

  it('handles repeated edges without duplicates', () => {
    const tet0: Tetrahedron = { a: 0, b: 1, c: 2, d: 3, circumcenter: vec3(0.5, 0.5, 0.5) };
    const tet1: Tetrahedron = { a: 0, b: 1, c: 2, d: 4, circumcenter: vec3(0.5, 0.5, 0.5) };
    const result = buildAdjacencyMap([tet0, tet1], 5);

    // Stub returns empty Map — will fail
    expect(result.size).toBe(5);

    // Edge (0,1) appears in both tetrahedra but should only appear once in the set
    const adj0 = result.get(0)!;
    let count = 0;
    for (const v of adj0) {
      if (v === 1) count++;
    }
    expect(count).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 12: convexHull3D (Task 5.10 — Voronoi merging pass)
// Stub returns [] — tests should FAIL for non-empty inputs
// ═══════════════════════════════════════════════════════════════════════════════

describe('VoronoiFrag — convexHull3D', () => {
  it('returns empty array for empty input', () => {
    const result = convexHull3D([]);
    expect(result).toEqual([]);
  });

  it('returns single point unchanged', () => {
    const pt = vec3(1, 2, 3);
    const result = convexHull3D([pt]);

    // Stub returns [] — will fail
    expect(result).toHaveLength(1);
    expect(result[0]!.x).toBe(1);
    expect(result[0]!.y).toBe(2);
    expect(result[0]!.z).toBe(3);
  });

  it('returns both points for 2 points', () => {
    const a = vec3(0, 0, 0);
    const b = vec3(1, 0, 0);
    const result = convexHull3D([a, b]);

    // Stub returns [] — will fail
    expect(result).toHaveLength(2);
    // Both original points should be in the hull (order not important)
    expect(result).toContainEqual(a);
    expect(result).toContainEqual(b);
  });

  it('returns all 3 non-collinear points', () => {
    const a = vec3(0, 0, 0);
    const b = vec3(1, 0, 0);
    const c = vec3(0, 1, 0);
    const result = convexHull3D([a, b, c]);

    // Stub returns [] — will fail
    expect(result).toHaveLength(3);
    expect(result).toContainEqual(a);
    expect(result).toContainEqual(b);
    expect(result).toContainEqual(c);
  });

  it('returns hull of regular tetrahedron', () => {
    const a = vec3(0, 0, 0);
    const b = vec3(1, 0, 0);
    const c = vec3(0, 1, 0);
    const d = vec3(0, 0, 1);
    const result = convexHull3D([a, b, c, d]);

    // Stub returns [] — will fail
    expect(result).toHaveLength(4);
    expect(result).toContainEqual(a);
    expect(result).toContainEqual(b);
    expect(result).toContainEqual(c);
    expect(result).toContainEqual(d);
  });

  it('returns hull of octahedron', () => {
    // Regular octahedron: (±1,0,0), (0,±1,0), (0,0,±1)
    const vertices = [
      vec3(1, 0, 0),
      vec3(-1, 0, 0),
      vec3(0, 1, 0),
      vec3(0, -1, 0),
      vec3(0, 0, 1),
      vec3(0, 0, -1),
    ];
    const result = convexHull3D(vertices);

    // Stub returns [] — will fail
    expect(result).toHaveLength(6);
    for (const v of vertices) {
      expect(result).toContainEqual(v);
    }
  });

  it('excludes interior points from hull', () => {
    // Box corners: all (±1, ±1, ±1) — 8 points
    // Center: (0,0,0) — interior, should not be in hull
    const corners = [
      vec3(-1, -1, -1), vec3(-1, -1, 1), vec3(-1, 1, -1), vec3(-1, 1, 1),
      vec3(1, -1, -1), vec3(1, -1, 1), vec3(1, 1, -1), vec3(1, 1, 1),
    ];
    const center = vec3(0, 0, 0);
    const points = [...corners, center];
    const result = convexHull3D(points);

    // Stub returns [] — will fail
    expect(result).toHaveLength(8);
    // Center should NOT be in hull
    expect(result).not.toContainEqual(center);
    // All 8 corners should be in hull
    for (const c of corners) {
      expect(result).toContainEqual(c);
    }
  });

  it('handles collinear points by returning endpoints', () => {
    const a = vec3(0, 0, 0);
    const b = vec3(1, 1, 1);
    const c = vec3(2, 2, 2);
    const result = convexHull3D([a, b, c]);

    // Stub returns [] — will fail
    // Hull should only contain the two endpoints
    expect(result).toHaveLength(2);
    expect(result).toContainEqual(a);
    expect(result).toContainEqual(c);
    // The midpoint should be excluded
    expect(result).not.toContainEqual(b);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 13: mergeTwoCells (Task 5.10 — Voronoi merging pass)
// Stub returns { vertices: [], isValid: false } — tests should FAIL
// ═══════════════════════════════════════════════════════════════════════════════

describe('VoronoiFrag — mergeTwoCells', () => {
  it('merges two adjacent cells by convex hull', () => {
    // Two adjacent tetrahedra sharing the face (1,0,0)-(0,1,0)-(0,0,1)
    const cellA: VoronoiCell = {
      seedIndex: 0,
      vertices: [vec3(0, 0, 0), vec3(1, 0, 0), vec3(0, 1, 0), vec3(0, 0, 1)],
      isValid: true,
    };
    const cellB: VoronoiCell = {
      seedIndex: 1,
      vertices: [vec3(1, 0, 0), vec3(0, 1, 0), vec3(0, 0, 1), vec3(1, 1, 1)],
      isValid: true,
    };
    const result = mergeTwoCells(cellA, cellB);

    // Stub returns { vertices: [], isValid: false } — will fail
    expect(result.vertices.length).toBeGreaterThanOrEqual(4);
    // All unique corners from both cells should be present
    expect(result.vertices).toContainEqual(vec3(0, 0, 0));
    expect(result.vertices).toContainEqual(vec3(1, 1, 1));
  });

  it('preserves seedIndex from cellA', () => {
    const cellA: VoronoiCell = {
      seedIndex: 5,
      vertices: [vec3(0, 0, 0)],
      isValid: true,
    };
    const cellB: VoronoiCell = {
      seedIndex: 99,
      vertices: [vec3(1, 0, 0)],
      isValid: true,
    };
    const result = mergeTwoCells(cellA, cellB);

    expect(result.seedIndex).toBe(5);
    // Also verify hull produced at least 2 distinct points
    // Stub returns vertices: [] — will fail
    expect(result.vertices.length).toBeGreaterThanOrEqual(2);
  });

  it('returns isValid true when merged hull has >= 4 vertices', () => {
    const cellA: VoronoiCell = {
      seedIndex: 0,
      vertices: [vec3(0, 0, 0), vec3(1, 0, 0), vec3(0, 1, 0), vec3(0, 0, 1)],
      isValid: true,
    };
    const cellB: VoronoiCell = {
      seedIndex: 1,
      vertices: [vec3(1, 0, 0), vec3(0, 1, 0), vec3(0, 0, 1), vec3(1, 1, 1)],
      isValid: true,
    };
    const result = mergeTwoCells(cellA, cellB);

    // Stub returns isValid: false — will fail
    expect(result.isValid).toBe(true);
    expect(result.vertices.length).toBeGreaterThanOrEqual(4);
  });

  it('returns isValid false when merged hull has < 4 vertices', () => {
    const cellA: VoronoiCell = {
      seedIndex: 0,
      vertices: [vec3(0, 0, 0)],
      isValid: true,
    };
    const cellB: VoronoiCell = {
      seedIndex: 1,
      vertices: [vec3(0.1, 0, 0)],
      isValid: true,
    };
    const result = mergeTwoCells(cellA, cellB);

    // Stub returns vertices: [] — will fail (expects length 2)
    expect(result.vertices.length).toBe(2);
    expect(result.isValid).toBe(false);
  });

  it('handles invalid cells gracefully', () => {
    // cellA has isValid=false with only 2 vertices
    const cellA: VoronoiCell = {
      seedIndex: 0,
      vertices: [vec3(0, 0, 0), vec3(1, 0, 0)],
      isValid: false,
    };
    const cellB: VoronoiCell = {
      seedIndex: 1,
      vertices: [vec3(0, 0, 0), vec3(1, 0, 0), vec3(0, 1, 0), vec3(0, 0, 1)],
      isValid: true,
    };
    const result = mergeTwoCells(cellA, cellB);

    // Stub returns vertices: [] — will fail
    // Combined hull should have 4+ vertices despite cellA being invalid
    expect(result.vertices.length).toBeGreaterThanOrEqual(4);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 14: mergeVoronoiCells (Task 5.10 — Voronoi merging pass)
// Stub returns [...cells] unchanged — merging tests should FAIL
// ═══════════════════════════════════════════════════════════════════════════════

describe('VoronoiFrag — mergeVoronoiCells', () => {
  it('returns same cells when adjacency is empty', () => {
    const cells: VoronoiCell[] = [
      { seedIndex: 0, vertices: [vec3(0, 0, 0)], isValid: false },
      { seedIndex: 1, vertices: [vec3(1, 0, 0)], isValid: false },
    ];
    const result = mergeVoronoiCells(cells, [], new Random(42));

    expect(result).toHaveLength(2);
    expect(result[0].seedIndex).toBe(0);
    expect(result[1].seedIndex).toBe(1);
  });

  it('merges at least one pair when cells are adjacent and rng is favorable', () => {
    // Single tetrahedron connecting seeds 0 and 1 (plus 2,3 as filler)
    // With 2 adjacent cells, seed 42 should trigger chance(0.35)
    const tet: Tetrahedron = {
      a: 0, b: 1, c: 2, d: 3,
      circumcenter: vec3(0.5, 0.5, 0.5),
    };
    const cells: VoronoiCell[] = [
      {
        seedIndex: 0,
        vertices: [vec3(0, 0, 0), vec3(1, 0, 0), vec3(0, 1, 0), vec3(0, 0, 1)],
        isValid: true,
      },
      {
        seedIndex: 1,
        vertices: [vec3(1, 0, 0), vec3(0, 1, 0), vec3(0, 0, 1), vec3(1, 1, 1)],
        isValid: true,
      },
      {
        seedIndex: 2,
        vertices: [vec3(0, 0, 0)],
        isValid: false,
      },
      {
        seedIndex: 3,
        vertices: [vec3(0, 0, 0)],
        isValid: false,
      },
    ];
    const rng = new Random(42);
    const result = mergeVoronoiCells(cells, [tet], rng);

    // Stub returns [...cells] (4 cells) — will fail
    // With adjacency and favorable rng, at least one merge should happen
    // reducing the total cell count below 4
    expect(result.length).toBeLessThan(4);
  });

  it('does not merge non-adjacent cells', () => {
    // Two disconnected tetrahedra — seeds 0,1,2,3 in one; 4,5,6,7 in another
    // Cells at indices 0 and 4 share no Delaunay edge
    const tet0: Tetrahedron = {
      a: 0, b: 1, c: 2, d: 3,
      circumcenter: vec3(0.5, 0.5, 0.5),
    };
    const tet1: Tetrahedron = {
      a: 4, b: 5, c: 6, d: 7,
      circumcenter: vec3(1.5, 0.5, 0.5),
    };
    const cells: VoronoiCell[] = [
      { seedIndex: 0, vertices: [vec3(0, 0, 0)], isValid: false },
      { seedIndex: 4, vertices: [vec3(1, 0, 0)], isValid: false },
    ];
    const rng = new Random(42);
    const result = mergeVoronoiCells(cells, [tet0, tet1], rng);

    // Non-adjacent cells should remain separate
    expect(result).toHaveLength(2);
    // Each seedIndex should appear exactly once
    const seen = new Set<number>();
    for (const cell of result) {
      expect(seen.has(cell.seedIndex)).toBe(false);
      seen.add(cell.seedIndex);
    }
  });

  it('produces deterministic results with same seed', () => {
    const tet: Tetrahedron = {
      a: 0, b: 1, c: 2, d: 3,
      circumcenter: vec3(0.5, 0.5, 0.5),
    };
    const cells: VoronoiCell[] = [
      {
        seedIndex: 0,
        vertices: [vec3(0, 0, 0), vec3(1, 0, 0), vec3(0, 1, 0), vec3(0, 0, 1)],
        isValid: true,
      },
      {
        seedIndex: 1,
        vertices: [vec3(1, 0, 0), vec3(0, 1, 0), vec3(0, 0, 1), vec3(1, 1, 1)],
        isValid: true,
      },
    ];

    const resultA = mergeVoronoiCells(cells, [tet], new Random(42));
    const resultB = mergeVoronoiCells(cells, [tet], new Random(42));

    // Same seed → same result
    expect(resultA).toEqual(resultB);
  });

  it('handles single cell gracefully', () => {
    const cells: VoronoiCell[] = [
      {
        seedIndex: 0,
        vertices: [vec3(0, 0, 0), vec3(1, 0, 0), vec3(0, 1, 0), vec3(0, 0, 1)],
        isValid: true,
      },
    ];
    const result = mergeVoronoiCells(cells, [], new Random(42));

    expect(result).toHaveLength(1);
    expect(result[0].seedIndex).toBe(0);
  });

  it('reduces cell count when merges happen', () => {
    // 4 cells all connected via one tetrahedron
    const tet: Tetrahedron = {
      a: 0, b: 1, c: 2, d: 3,
      circumcenter: vec3(0.5, 0.5, 0.5),
    };
    const cells: VoronoiCell[] = [
      {
        seedIndex: 0,
        vertices: [vec3(0, 0, 0), vec3(1, 0, 0), vec3(0, 1, 0), vec3(0, 0, 1)],
        isValid: true,
      },
      {
        seedIndex: 1,
        vertices: [vec3(1, 0, 0), vec3(0, 1, 0), vec3(0, 0, 1), vec3(1, 1, 1)],
        isValid: true,
      },
      {
        seedIndex: 2,
        vertices: [vec3(0, 0, 0), vec3(2, 0, 0), vec3(0, 2, 0), vec3(0, 0, 2)],
        isValid: true,
      },
      {
        seedIndex: 3,
        vertices: [vec3(2, 0, 0), vec3(0, 2, 0), vec3(0, 0, 2), vec3(2, 2, 2)],
        isValid: true,
      },
    ];
    const rng = new Random(42);
    const result = mergeVoronoiCells(cells, [tet], rng);

    // Stub returns all 4 cells — will fail
    expect(result.length).toBeLessThan(cells.length);
  });

  it('does not double-merge a cell', () => {
    // 3 cells where seed 0 is adjacent to both 1 and 2
    // A cell that gets merged into another should not appear again
    const tet: Tetrahedron = {
      a: 0, b: 1, c: 2, d: 3,
      circumcenter: vec3(0.5, 0.5, 0.5),
    };
    const cells: VoronoiCell[] = [
      {
        seedIndex: 0,
        vertices: [vec3(0, 0, 0), vec3(1, 0, 0), vec3(0, 1, 0), vec3(0, 0, 1)],
        isValid: true,
      },
      {
        seedIndex: 1,
        vertices: [vec3(1, 0, 0), vec3(0, 1, 0), vec3(0, 0, 1), vec3(1, 1, 1)],
        isValid: true,
      },
      {
        seedIndex: 2,
        vertices: [vec3(0, 0, 0), vec3(2, 0, 0), vec3(0, 2, 0), vec3(0, 0, 2)],
        isValid: true,
      },
    ];
    const rng = new Random(42);
    const result = mergeVoronoiCells(cells, [tet], rng);

    // Stub returns 3 cells — will fail
    // Merges should reduce count below 3
    expect(result.length).toBeLessThan(3);

    // Each seedIndex should appear at most once (no double-merged cell)
    const seen = new Set<number>();
    for (const cell of result) {
      expect(seen.has(cell.seedIndex)).toBe(false);
      seen.add(cell.seedIndex);
    }
  });
});
