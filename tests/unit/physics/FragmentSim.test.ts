// BlastSimulator2026 — Unit tests: FragmentSim module
// Task 5.11: Generate RockFragment objects: graphic mesh, deflated collision mesh,
// overflowEnergy from source voxels
// All tests should FAIL (Red phase) — all functions throw 'Not implemented'.

import { describe, it, expect } from 'vitest';
import {
  sampleSeedsWithMapping,
  computeCentroid,
  deflateVertices,
  flattenVec3Array,
  convertOreDensities,
  computeAverageRockComposition,
  computeAverageOreComposition,
  mergeVoronoiCellsWithGrouping,
  computeVolumeM3,
  generateRockFragments,
  type VoxelOreComposition,
  type RockFragment,
  type SeedVoxelInfo,
  simulateProjectedFragments,
  simulateCollapseFragments,
} from '../../../src/physics/FragmentSim.js';
import { type VoronoiCell, type Tetrahedron } from '../../../src/physics/VoronoiFrag.js';
import { vec3, ZERO } from '../../../src/core/math/Vec3.js';
import { Random } from '../../../src/core/math/Random.js';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import { getRock } from '../../../src/core/world/RockCatalog.js';
import { COLLISION_DEFLATE_AMOUNT } from '../../../src/core/config/balance.js';
import {
  computeEnergyGradientDirection,
  distanceToNearestAirVoxel,
  computeSurfaceProximityFactor,
  computeVelocityMagnitude,
  classifySimulationTier,
  assignFragmentVelocity,
} from '../../../src/physics/FragmentSimVelocity.js';
import { length } from '../../../src/core/math/Vec3.js';
import { MAX_PROJECTION_VELOCITY, PHYSICS_FRAGMENT_CAP, PHYSICS_TERRAIN_CLEARANCE } from '../../../src/core/config/balance.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

function vec3Eq(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, tol = 1e-10): boolean {
  return Math.abs(a.x - b.x) < tol && Math.abs(a.y - b.y) < tol && Math.abs(a.z - b.z) < tol;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Group 1: convertOreDensities
// Converts a Record<string, number> (oreId → density) into a VoxelOreComposition.
// ═══════════════════════════════════════════════════════════════════════════════

describe('FragmentSim — convertOreDensities', () => {
  it('returns empty ores array for empty record', () => {
    const result = convertOreDensities({});
    expect(result).toEqual({ ores: [] });
  });

  it('converts single ore entry correctly', () => {
    const result = convertOreDensities({ dirtite: 0.5 });
    expect(result).toEqual({ ores: [{ oreId: 'dirtite', density: 0.5 }] });
  });

  it('converts multiple ore entries correctly', () => {
    const result = convertOreDensities({ dirtite: 0.4, rustite: 0.3, blingite: 0.1 });
    expect(result.ores).toHaveLength(3);
    expect(result.ores).toContainEqual({ oreId: 'dirtite', density: 0.4 });
    expect(result.ores).toContainEqual({ oreId: 'rustite', density: 0.3 });
    expect(result.ores).toContainEqual({ oreId: 'blingite', density: 0.1 });
  });

  it('filters out zero-density entries', () => {
    const result = convertOreDensities({ dirtite: 0.5, rustite: 0, blingite: 0.2 });
    expect(result.ores).toHaveLength(2);
    expect(result.ores).toContainEqual({ oreId: 'dirtite', density: 0.5 });
    expect(result.ores).toContainEqual({ oreId: 'blingite', density: 0.2 });
    expect(result.ores.find(o => o.oreId === 'rustite')).toBeUndefined();
  });

  it('filters out entries with density exactly 0', () => {
    const result = convertOreDensities({ dirtite: 0, rustite: 0 });
    expect(result.ores).toEqual([]);
  });

  it('preserves all density values exactly', () => {
    const result = convertOreDensities({ dirtite: 0.12345, rustite: 0.98765, blingite: 0.5 });
    expect(result.ores.find(o => o.oreId === 'dirtite')!.density).toBe(0.12345);
    expect(result.ores.find(o => o.oreId === 'rustite')!.density).toBe(0.98765);
    expect(result.ores.find(o => o.oreId === 'blingite')!.density).toBe(0.5);
  });

  it('handles density of 1.0 correctly', () => {
    const result = convertOreDensities({ dirtite: 1.0 });
    expect(result.ores).toHaveLength(1);
    expect(result.ores[0]!.density).toBe(1.0);
  });

  it('handles very small positive density values', () => {
    const result = convertOreDensities({ dirtite: 1e-8 });
    expect(result.ores).toHaveLength(1);
    expect(result.ores[0]!.density).toBe(1e-8);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 2: computeCentroid
// Computes the average position of an array of Vec3 points.
// ═══════════════════════════════════════════════════════════════════════════════

describe('FragmentSim — computeCentroid', () => {
  it('returns the same point for a single vertex', () => {
    const v = vec3(3, 4, 5);
    const result = computeCentroid([v]);
    expect(result.x).toBe(3);
    expect(result.y).toBe(4);
    expect(result.z).toBe(5);
  });

  it('returns midpoint for two vertices', () => {
    const a = vec3(0, 0, 0);
    const b = vec3(2, 4, 6);
    const result = computeCentroid([a, b]);
    expect(result.x).toBe(1);
    expect(result.y).toBe(2);
    expect(result.z).toBe(3);
  });

  it('returns correct centroid for four vertices forming a tetrahedron', () => {
    const a = vec3(0, 0, 0);
    const b = vec3(1, 0, 0);
    const c = vec3(0, 1, 0);
    const d = vec3(0, 0, 1);
    const result = computeCentroid([a, b, c, d]);
    expect(result.x).toBeCloseTo(0.25);
    expect(result.y).toBeCloseTo(0.25);
    expect(result.z).toBeCloseTo(0.25);
  });

  it('returns ZERO for empty array', () => {
    const result = computeCentroid([]);
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
    expect(result.z).toBe(0);
  });

  it('returns that same point when all vertices are identical', () => {
    const v = vec3(7, 8, 9);
    const result = computeCentroid([v, v, v, v]);
    expect(result.x).toBe(7);
    expect(result.y).toBe(8);
    expect(result.z).toBe(9);
  });

  it('handles negative coordinates correctly', () => {
    const a = vec3(-10, -10, -10);
    const b = vec3(0, 0, 0);
    const c = vec3(10, 10, 10);
    const result = computeCentroid([a, b, c]);
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
    expect(result.z).toBe(0);
  });

  it('handles mixed positive and negative coordinates', () => {
    const a = vec3(-5, 10, -3);
    const b = vec3(5, -10, 3);
    const result = computeCentroid([a, b]);
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
    expect(result.z).toBe(0);
  });

  it('handles large coordinate values', () => {
    const a = vec3(1000000, 2000000, 3000000);
    const b = vec3(2000000, 3000000, 4000000);
    const result = computeCentroid([a, b]);
    expect(result.x).toBe(1500000);
    expect(result.y).toBe(2500000);
    expect(result.z).toBe(3500000);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 3: deflateVertices
// Moves vertices inward toward centroid by a given amount.
// ═══════════════════════════════════════════════════════════════════════════════

describe('FragmentSim — deflateVertices', () => {
  it('moves a single vertex toward centroid by the given amount', () => {
    const centroid = vec3(0, 0, 0);
    const vertices = [vec3(10, 0, 0)];
    const result = deflateVertices(vertices, centroid, 3);
    // Expected: move from (10,0,0) toward (0,0,0) by 3 units
    expect(result).toHaveLength(1);
    expect(result[0]!.x).toBeCloseTo(7, 10);
    expect(result[0]!.y).toBe(0);
    expect(result[0]!.z).toBe(0);
  });

  it('moves each vertex independently toward centroid', () => {
    const centroid = vec3(0, 0, 0);
    const vertices = [vec3(10, 0, 0), vec3(0, 10, 0), vec3(0, 0, 10)];
    const result = deflateVertices(vertices, centroid, 2);
    expect(result).toHaveLength(3);
    expect(result[0]!.x).toBeCloseTo(8, 10);
    expect(result[1]!.y).toBeCloseTo(8, 10);
    expect(result[2]!.z).toBeCloseTo(8, 10);
  });

  it('clamps amount larger than distance so vertex never passes through centroid', () => {
    const centroid = vec3(0, 0, 0);
    const vertices = [vec3(1, 0, 0)];
    const result = deflateVertices(vertices, centroid, 10);
    // Clamped to 1 unit (distance to centroid), so result should be (0,0,0)
    expect(result).toHaveLength(1);
    expect(result[0]!.x).toBeCloseTo(0, 10);
    expect(result[0]!.y).toBe(0);
    expect(result[0]!.z).toBe(0);
  });

  it('returns empty array for empty vertices', () => {
    const centroid = vec3(0, 0, 0);
    const result = deflateVertices([], centroid, 1);
    expect(result).toEqual([]);
  });

  it('leaves vertex at centroid unchanged (distance = 0)', () => {
    const centroid = vec3(5, 5, 5);
    const vertices = [centroid];
    const result = deflateVertices(vertices, centroid, 1);
    expect(result).toHaveLength(1);
    expect(result[0]!.x).toBe(5);
    expect(result[0]!.y).toBe(5);
    expect(result[0]!.z).toBe(5);
  });

  it('leaves all vertices unchanged when amount is 0', () => {
    const centroid = vec3(2, 3, 4);
    const vertices = [vec3(10, 0, 0), vec3(0, 10, 0), vec3(0, 0, 10)];
    const result = deflateVertices(vertices, centroid, 0);
    expect(result).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      expect(result[i]!.x).toBe(vertices[i]!.x);
      expect(result[i]!.y).toBe(vertices[i]!.y);
      expect(result[i]!.z).toBe(vertices[i]!.z);
    }
  });

  it('moves vertices in the correct direction for non-origin centroid', () => {
    const centroid = vec3(5, 5, 5);
    const vertices = [vec3(10, 10, 10)];
    const result = deflateVertices(vertices, centroid, 2);
    // Direction from centroid to vertex: (5,5,5), normalized
    // Moving 2 units toward centroid from (10,10,10)
    const expectedX = 10 - 2 * (5 / Math.sqrt(75));
    expect(result[0]!.x).toBeCloseTo(expectedX, 10);
  });

  it('deflected vertices form a smaller mesh (centroid stays the same)', () => {
    const centroid = vec3(0.5, 0.5, 0.5);
    const vertices = [vec3(0, 0, 0), vec3(1, 0, 0), vec3(0, 1, 0), vec3(0, 0, 1)];
    const result = deflateVertices(vertices, centroid, 0.1);
    // Each vertex should be closer to centroid than the original
    for (let i = 0; i < vertices.length; i++) {
      const origDist = Math.sqrt(
        (vertices[i]!.x - centroid.x) ** 2 +
        (vertices[i]!.y - centroid.y) ** 2 +
        (vertices[i]!.z - centroid.z) ** 2,
      );
      const newDist = Math.sqrt(
        (result[i]!.x - centroid.x) ** 2 +
        (result[i]!.y - centroid.y) ** 2 +
        (result[i]!.z - centroid.z) ** 2,
      );
      expect(newDist).toBeLessThan(origDist);
    }
  });

  it('uses a non-zero deflate amount matching COLLISION_DEFLATE_AMOUNT convention', () => {
    const centroid = vec3(0, 0, 0);
    const vertices = [vec3(10, 0, 0)];
    const result = deflateVertices(vertices, centroid, COLLISION_DEFLATE_AMOUNT);
    // COLLISION_DEFLATE_AMOUNT = 0.05
    const expectedX = 10 - COLLISION_DEFLATE_AMOUNT;
    expect(result[0]!.x).toBeCloseTo(expectedX, 10);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 4: flattenVec3Array
// Converts Vec3[] to interleaved Float32Array (x,y,z,x,y,z,…).
// ═══════════════════════════════════════════════════════════════════════════════

describe('FragmentSim — flattenVec3Array', () => {
  it('returns empty Float32Array for empty array', () => {
    const result = flattenVec3Array([]);
    expect(result).toBeInstanceOf(Float32Array);
    expect(result.length).toBe(0);
  });

  it('converts single Vec3 to Float32Array with 3 components', () => {
    const result = flattenVec3Array([vec3(1.5, 2.5, 3.5)]);
    expect(result).toBeInstanceOf(Float32Array);
    expect(result).toHaveLength(3);
    expect(result[0]).toBeCloseTo(1.5);
    expect(result[1]).toBeCloseTo(2.5);
    expect(result[2]).toBeCloseTo(3.5);
  });

  it('converts multiple Vec3s to correct interleaved array', () => {
    const result = flattenVec3Array([
      vec3(1, 2, 3),
      vec3(4, 5, 6),
      vec3(7, 8, 9),
    ]);
    expect(result).toBeInstanceOf(Float32Array);
    expect(result).toHaveLength(9);
    expect(result[0]).toBeCloseTo(1);
    expect(result[1]).toBeCloseTo(2);
    expect(result[2]).toBeCloseTo(3);
    expect(result[3]).toBeCloseTo(4);
    expect(result[4]).toBeCloseTo(5);
    expect(result[5]).toBeCloseTo(6);
    expect(result[6]).toBeCloseTo(7);
    expect(result[7]).toBeCloseTo(8);
    expect(result[8]).toBeCloseTo(9);
  });

  it('returns a Float32Array (not a regular array)', () => {
    const result = flattenVec3Array([vec3(0, 0, 0)]);
    expect(result).toBeInstanceOf(Float32Array);
    expect(Array.isArray(result)).toBe(false);
  });

  it('preserves floating point precision', () => {
    const result = flattenVec3Array([vec3(0.1, 0.2, 0.3)]);
    expect(result[0]).toBeCloseTo(0.1, 6);
    expect(result[1]).toBeCloseTo(0.2, 6);
    expect(result[2]).toBeCloseTo(0.3, 6);
  });

  it('handles negative coordinates', () => {
    const result = flattenVec3Array([vec3(-1, -2, -3)]);
    expect(result[0]).toBeCloseTo(-1);
    expect(result[1]).toBeCloseTo(-2);
    expect(result[2]).toBeCloseTo(-3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 5: sampleSeedsWithMapping
// Samples seed points within fragmented voxels and builds mapping back to voxels.
// ═══════════════════════════════════════════════════════════════════════════════

describe('FragmentSim — sampleSeedsWithMapping', () => {
  it('returns empty seeds and empty map for empty fragmented voxels', () => {
    const grid = new VoxelGrid(10, 10, 10);
    const rng = new Random(42);
    const result = sampleSeedsWithMapping(new Set(), new Map(), new Map(), grid, rng);
    expect(result.seeds).toEqual([]);
    expect(result.seedToVoxelMap.size).toBe(0);
  });

  it('produces correct seed count and mapping for a single voxel with fragmentCount=3', () => {
    const grid = new VoxelGrid(10, 10, 10);
    grid.setVoxel(0, 0, 0, {
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      density: 1.0,
      oreDensities: {},
      fractureModifier: 1.0,
    });

    const fragmented = new Set<string>(['0,0,0']);
    const effectiveEnergy = new Map<string, number>([['0,0,0', 200]]);
    const generatedOverflow = new Map<string, number>([['0,0,0', 50]]);
    const rng = new Random(42);

    const result = sampleSeedsWithMapping(fragmented, effectiveEnergy, generatedOverflow, grid, rng);

    // Expect 3 seeds from a single voxel with energy=200, threshold=200 → score=3.0 → count=3
    expect(result.seeds).toHaveLength(3);
    expect(result.seedToVoxelMap.size).toBe(3);

    // All seeds should map to voxel (0,0,0) with fragmentCount=3
    for (let i = 0; i < 3; i++) {
      const info = result.seedToVoxelMap.get(i);
      expect(info).toBeDefined();
      expect(info!.x).toBe(0);
      expect(info!.y).toBe(0);
      expect(info!.z).toBe(0);
      expect(info!.fragmentCount).toBe(3);
      expect(info!.effectiveEnergy).toBe(200);
      expect(info!.generatedOverflow).toBe(50);
    }
  });

  it('generates seeds within the voxel unit cube', () => {
    const grid = new VoxelGrid(10, 20, 20);
    grid.setVoxel(5, 10, 15, {
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      density: 1.0,
      oreDensities: {},
      fractureModifier: 1.0,
    });

    const fragmented = new Set<string>(['5,10,15']);
    const effectiveEnergy = new Map<string, number>([['5,10,15', 200]]);
    const generatedOverflow = new Map<string, number>();
    const rng = new Random(42);

    const result = sampleSeedsWithMapping(fragmented, effectiveEnergy, generatedOverflow, grid, rng);

    expect(result.seeds).toHaveLength(3);
    for (const seed of result.seeds) {
      expect(seed.x).toBeGreaterThanOrEqual(5);
      expect(seed.x).toBeLessThan(6);
      expect(seed.y).toBeGreaterThanOrEqual(10);
      expect(seed.y).toBeLessThan(11);
      expect(seed.z).toBeGreaterThanOrEqual(15);
      expect(seed.z).toBeLessThan(16);
    }
  });

  it('preserves seed order and mapping for multiple voxels', () => {
    const grid = new VoxelGrid(10, 10, 10);
    // Voxel (0,0,0) with energy=200 → 3 seeds
    grid.setVoxel(0, 0, 0, {
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      density: 1.0,
      oreDensities: {},
      fractureModifier: 1.0,
    });
    // Voxel (1,0,0) with energy=400 → score=6.0 → 6 seeds
    grid.setVoxel(1, 0, 0, {
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      density: 1.0,
      oreDensities: {},
      fractureModifier: 1.0,
    });

    const fragmented = new Set<string>(['0,0,0', '1,0,0']);
    const effectiveEnergy = new Map<string, number>([
      ['0,0,0', 200],
      ['1,0,0', 400],
    ]);
    const generatedOverflow = new Map<string, number>();
    const rng = new Random(42);

    const result = sampleSeedsWithMapping(fragmented, effectiveEnergy, generatedOverflow, grid, rng);

    // 3 + 6 = 9 seeds total
    expect(result.seeds).toHaveLength(9);
    expect(result.seedToVoxelMap.size).toBe(9);

    // First 3 seeds from voxel (0,0,0)
    for (let i = 0; i < 3; i++) {
      const info = result.seedToVoxelMap.get(i);
      expect(info).toBeDefined();
      expect(info!.x).toBe(0);
      expect(info!.y).toBe(0);
      expect(info!.z).toBe(0);
      expect(info!.fragmentCount).toBe(3);
    }

    // Next 6 seeds from voxel (1,0,0)
    for (let i = 3; i < 9; i++) {
      const info = result.seedToVoxelMap.get(i);
      expect(info).toBeDefined();
      expect(info!.x).toBe(1);
      expect(info!.y).toBe(0);
      expect(info!.z).toBe(0);
      expect(info!.fragmentCount).toBe(6);
    }
  });

  it('produces deterministic results with same rng seed', () => {
    const grid = new VoxelGrid(10, 10, 10);
    grid.setVoxel(0, 0, 0, {
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      density: 1.0,
      oreDensities: {},
      fractureModifier: 1.0,
    });

    const fragmented = new Set<string>(['0,0,0']);
    const effectiveEnergy = new Map<string, number>([['0,0,0', 200]]);
    const generatedOverflow = new Map<string, number>([['0,0,0', 50]]);

    const result1 = sampleSeedsWithMapping(fragmented, effectiveEnergy, generatedOverflow, grid, new Random(42));
    const result2 = sampleSeedsWithMapping(fragmented, effectiveEnergy, generatedOverflow, grid, new Random(42));

    expect(result1.seeds).toEqual(result2.seeds);
    // Compare maps
    for (const [key, value] of result1.seedToVoxelMap) {
      expect(result2.seedToVoxelMap.get(key)).toEqual(value);
    }
  });

  it('defaults generatedOverflow to 0 when voxel is missing from overflow map', () => {
    const grid = new VoxelGrid(10, 10, 10);
    grid.setVoxel(2, 3, 4, {
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      density: 1.0,
      oreDensities: {},
      fractureModifier: 1.0,
    });

    const fragmented = new Set<string>(['2,3,4']);
    const effectiveEnergy = new Map<string, number>([['2,3,4', 200]]);
    // generatedOverflow intentionally missing this voxel key
    const generatedOverflow = new Map<string, number>();
    const rng = new Random(42);

    const result = sampleSeedsWithMapping(fragmented, effectiveEnergy, generatedOverflow, grid, rng);

    expect(result.seeds).toHaveLength(3);
    expect(result.seedToVoxelMap.get(0)!.generatedOverflow).toBe(0);
    expect(result.seedToVoxelMap.get(1)!.generatedOverflow).toBe(0);
    expect(result.seedToVoxelMap.get(2)!.generatedOverflow).toBe(0);
  });

  it('silently skips out-of-bounds voxels', () => {
    const grid = new VoxelGrid(10, 10, 10);
    grid.setVoxel(0, 0, 0, {
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      density: 1.0,
      oreDensities: {},
      fractureModifier: 1.0,
    });

    const fragmented = new Set<string>(['0,0,0', '999,999,999']);
    const effectiveEnergy = new Map<string, number>([
      ['0,0,0', 200],
      ['999,999,999', 9999],
    ]);
    const generatedOverflow = new Map<string, number>();
    const rng = new Random(42);

    const result = sampleSeedsWithMapping(fragmented, effectiveEnergy, generatedOverflow, grid, rng);

    // Only seeds from the valid voxel
    expect(result.seeds).toHaveLength(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 6: computeAverageRockComposition
// Averages rock composition across seeds mapped to voxels.
// ═══════════════════════════════════════════════════════════════════════════════

describe('FragmentSim — computeAverageRockComposition', () => {
  it('returns matching composition for single seed from single voxel', () => {
    const grid = new VoxelGrid(10, 10, 10);
    grid.setVoxel(0, 0, 0, {
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      density: 1.0,
      oreDensities: {},
      fractureModifier: 1.0,
    });

    const seedToVoxelMap = new Map<number, SeedVoxelInfo>([
      [0, { x: 0, y: 0, z: 0, fragmentCount: 3, effectiveEnergy: 200, generatedOverflow: 50 }],
    ]);

    const result = computeAverageRockComposition([0], seedToVoxelMap, grid);
    expect(result.rocks).toHaveLength(1);
    expect(result.rocks[0]!.rockId).toBe('cruite');
    expect(result.rocks[0]!.coefficient).toBeCloseTo(1.0);
  });

  it('returns same composition for two seeds from same voxel', () => {
    const grid = new VoxelGrid(10, 10, 10);
    grid.setVoxel(0, 0, 0, {
      composition: { rocks: [{ rockId: 'sandite', coefficient: 1.0 }] },
      density: 1.0,
      oreDensities: {},
      fractureModifier: 1.0,
    });

    const seedToVoxelMap = new Map<number, SeedVoxelInfo>([
      [0, { x: 0, y: 0, z: 0, fragmentCount: 2, effectiveEnergy: 200, generatedOverflow: 0 }],
      [1, { x: 0, y: 0, z: 0, fragmentCount: 2, effectiveEnergy: 200, generatedOverflow: 0 }],
    ]);

    const result = computeAverageRockComposition([0, 1], seedToVoxelMap, grid);
    expect(result.rocks).toHaveLength(1);
    expect(result.rocks[0]!.rockId).toBe('sandite');
    expect(result.rocks[0]!.coefficient).toBeCloseTo(1.0);
  });

  it('computes weighted average for seeds from two different voxels', () => {
    const grid = new VoxelGrid(10, 10, 10);
    // Voxel (0,0,0): 50% cruite, 50% sandite
    grid.setVoxel(0, 0, 0, {
      composition: { rocks: [{ rockId: 'cruite', coefficient: 0.7 }, { rockId: 'sandite', coefficient: 0.3 }] },
      density: 1.0,
      oreDensities: {},
      fractureModifier: 1.0,
    });
    // Voxel (1,0,0): 60% molite, 40% grumpite
    grid.setVoxel(1, 0, 0, {
      composition: { rocks: [{ rockId: 'molite', coefficient: 0.6 }, { rockId: 'grumpite', coefficient: 0.4 }] },
      density: 1.0,
      oreDensities: {},
      fractureModifier: 1.0,
    });

    // Two seeds from (0,0,0) with fragmentCount=3 and one seed from (1,0,0) with fragmentCount=4
    // Weighted: (2/3 * 0.7, 2/3 * 0.3) for cruite/sandite, (1/4 * 0.6, 1/4 * 0.4) for molite/grumpite
    const seedToVoxelMap = new Map<number, SeedVoxelInfo>([
      [0, { x: 0, y: 0, z: 0, fragmentCount: 3, effectiveEnergy: 200, generatedOverflow: 0 }],
      [1, { x: 0, y: 0, z: 0, fragmentCount: 3, effectiveEnergy: 200, generatedOverflow: 0 }],
      [2, { x: 1, y: 0, z: 0, fragmentCount: 4, effectiveEnergy: 200, generatedOverflow: 0 }],
    ]);

    const result = computeAverageRockComposition([0, 1, 2], seedToVoxelMap, grid);

    // Each seed contributes: (1/fragmentCount) * coefficient
    // Seed 0: 1/3 * 0.7 cruite + 1/3 * 0.3 sandite
    // Seed 1: 1/3 * 0.7 cruite + 1/3 * 0.3 sandite
    // Seed 2: 1/4 * 0.6 molite + 1/4 * 0.4 grumpite
    // Sum: cruite = 2/3 * 0.7 = 0.4666...
    //      sandite = 2/3 * 0.3 = 0.2
    //      molite = 1/4 * 0.6 = 0.15
    //      grumpite = 1/4 * 0.4 = 0.1
    // Total weight = 2/3 + 1/4 = 0.666... + 0.25 = 0.9166...
    expect(result.rocks.length).toBe(4);
    expect(result.rocks.find(r => r.rockId === 'cruite')!.coefficient).toBeCloseTo(0.7, 5);
    expect(result.rocks.find(r => r.rockId === 'sandite')!.coefficient).toBeCloseTo(0.3, 5);
    expect(result.rocks.find(r => r.rockId === 'molite')!.coefficient).toBeCloseTo(0.6, 5);
    expect(result.rocks.find(r => r.rockId === 'grumpite')!.coefficient).toBeCloseTo(0.4, 5);
  });

  it('returns empty composition for empty seedIndices', () => {
    const grid = new VoxelGrid(10, 10, 10);
    const seedToVoxelMap = new Map<number, SeedVoxelInfo>();
    const result = computeAverageRockComposition([], seedToVoxelMap, grid);
    expect(result).toEqual({ rocks: [] });
  });

  it('silently skips seed indices not found in map and returns empty composition', () => {
    const grid = new VoxelGrid(10, 10, 10);
    const seedToVoxelMap = new Map<number, SeedVoxelInfo>();
    const result = computeAverageRockComposition([99], seedToVoxelMap, grid);
    expect(result).toEqual({ rocks: [] });
  });

  it('skips missing seed indices but averages remaining valid ones', () => {
    const grid = new VoxelGrid(10, 10, 10);
    grid.setVoxel(0, 0, 0, {
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      density: 1.0,
      oreDensities: {},
      fractureModifier: 1.0,
    });

    const seedToVoxelMap = new Map<number, SeedVoxelInfo>([
      [0, { x: 0, y: 0, z: 0, fragmentCount: 2, effectiveEnergy: 200, generatedOverflow: 0 }],
    ]);

    // Seed 0 is valid, seed 5 is not in map — should still compute from seed 0
    const result = computeAverageRockComposition([0, 5], seedToVoxelMap, grid);
    // Should produce cruite composition from seed 0
    expect(result.rocks).toHaveLength(1);
    expect(result.rocks[0]!.rockId).toBe('cruite');
  });

  it('handles voxel with multiple rock types', () => {
    const grid = new VoxelGrid(10, 10, 10);
    grid.setVoxel(0, 0, 0, {
      composition: {
        rocks: [
          { rockId: 'cruite', coefficient: 0.5 },
          { rockId: 'sandite', coefficient: 0.3 },
          { rockId: 'molite', coefficient: 0.2 },
        ],
      },
      density: 1.0,
      oreDensities: {},
      fractureModifier: 1.0,
    });

    const seedToVoxelMap = new Map<number, SeedVoxelInfo>([
      [0, { x: 0, y: 0, z: 0, fragmentCount: 3, effectiveEnergy: 200, generatedOverflow: 0 }],
    ]);

    const result = computeAverageRockComposition([0], seedToVoxelMap, grid);
    expect(result.rocks).toHaveLength(3);
    expect(result.rocks.find(r => r.rockId === 'cruite')!.coefficient).toBeCloseTo(0.5);
    expect(result.rocks.find(r => r.rockId === 'sandite')!.coefficient).toBeCloseTo(0.3);
    expect(result.rocks.find(r => r.rockId === 'molite')!.coefficient).toBeCloseTo(0.2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 7: computeAverageOreComposition
// Averages ore densities across seeds mapped to voxels.
// ═══════════════════════════════════════════════════════════════════════════════

describe('FragmentSim — computeAverageOreComposition', () => {
  it('returns matching ore densities for single voxel', () => {
    const grid = new VoxelGrid(10, 10, 10);
    grid.setVoxel(0, 0, 0, {
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      density: 1.0,
      oreDensities: { dirtite: 0.5, rustite: 0.3 },
      fractureModifier: 1.0,
    });

    const seedToVoxelMap = new Map<number, SeedVoxelInfo>([
      [0, { x: 0, y: 0, z: 0, fragmentCount: 3, effectiveEnergy: 200, generatedOverflow: 0 }],
    ]);

    const result = computeAverageOreComposition([0], seedToVoxelMap, grid);
    expect(result.ores).toHaveLength(2);
    expect(result.ores.find(o => o.oreId === 'dirtite')!.density).toBeCloseTo(0.5);
    expect(result.ores.find(o => o.oreId === 'rustite')!.density).toBeCloseTo(0.3);
  });

  it('computes weighted average across multiple voxels', () => {
    const grid = new VoxelGrid(10, 10, 10);
    // Voxel (0,0,0): dirtite=0.5
    grid.setVoxel(0, 0, 0, {
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      density: 1.0,
      oreDensities: { dirtite: 0.5 },
      fractureModifier: 1.0,
    });
    // Voxel (1,0,0): rustite=0.8
    grid.setVoxel(1, 0, 0, {
      composition: { rocks: [{ rockId: 'sandite', coefficient: 1.0 }] },
      density: 1.0,
      oreDensities: { rustite: 0.8 },
      fractureModifier: 1.0,
    });

    // One seed from each voxel, each with fragmentCount=2
    const seedToVoxelMap = new Map<number, SeedVoxelInfo>([
      [0, { x: 0, y: 0, z: 0, fragmentCount: 2, effectiveEnergy: 200, generatedOverflow: 0 }],
      [1, { x: 1, y: 0, z: 0, fragmentCount: 2, effectiveEnergy: 200, generatedOverflow: 0 }],
    ]);

    const result = computeAverageOreComposition([0, 1], seedToVoxelMap, grid);

    // Seed 0 contributes 0.5 for dirtite, seed 1 contributes 0.8 for rustite
    // Each seed weight = 1/fragmentCount = 1/2
    // dirtite = (1/2)*0.5 / (1/2) = 0.5
    // rustite = (1/2)*0.8 / (1/2) = 0.8
    expect(result.ores).toHaveLength(2);
    expect(result.ores.find(o => o.oreId === 'dirtite')!.density).toBeCloseTo(0.5);
    expect(result.ores.find(o => o.oreId === 'rustite')!.density).toBeCloseTo(0.8);
  });

  it('returns empty ores for empty seedIndices', () => {
    const grid = new VoxelGrid(10, 10, 10);
    const seedToVoxelMap = new Map<number, SeedVoxelInfo>();
    const result = computeAverageOreComposition([], seedToVoxelMap, grid);
    expect(result).toEqual({ ores: [] });
  });

  it('averages ore present in one voxel but absent in another correctly', () => {
    const grid = new VoxelGrid(10, 10, 10);
    // Voxel (0,0,0): dirtite=0.6
    grid.setVoxel(0, 0, 0, {
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      density: 1.0,
      oreDensities: { dirtite: 0.6 },
      fractureModifier: 1.0,
    });
    // Voxel (1,0,0): no ores
    grid.setVoxel(1, 0, 0, {
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      density: 1.0,
      oreDensities: {},
      fractureModifier: 1.0,
    });

    const seedToVoxelMap = new Map<number, SeedVoxelInfo>([
      [0, { x: 0, y: 0, z: 0, fragmentCount: 2, effectiveEnergy: 200, generatedOverflow: 0 }],
      [1, { x: 1, y: 0, z: 0, fragmentCount: 2, effectiveEnergy: 200, generatedOverflow: 0 }],
    ]);

    const result = computeAverageOreComposition([0, 1], seedToVoxelMap, grid);

    // dirtite only from seed 0, weight 1/2
    // dirtite = (1/2)*0.6 / (1/2) = 0.6
    expect(result.ores).toHaveLength(1);
    expect(result.ores[0]!.oreId).toBe('dirtite');
    expect(result.ores[0]!.density).toBeCloseTo(0.6);
  });

  it('handles ore present in multiple voxels with different densities', () => {
    const grid = new VoxelGrid(10, 10, 10);
    grid.setVoxel(0, 0, 0, {
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      density: 1.0,
      oreDensities: { dirtite: 0.4, rustite: 0.2 },
      fractureModifier: 1.0,
    });
    grid.setVoxel(1, 0, 0, {
      composition: { rocks: [{ rockId: 'sandite', coefficient: 1.0 }] },
      density: 1.0,
      oreDensities: { dirtite: 0.6, rustite: 0.1 },
      fractureModifier: 1.0,
    });

    // One seed from each voxel, fragmentCount=3 each
    const seedToVoxelMap = new Map<number, SeedVoxelInfo>([
      [0, { x: 0, y: 0, z: 0, fragmentCount: 3, effectiveEnergy: 200, generatedOverflow: 0 }],
      [1, { x: 1, y: 0, z: 0, fragmentCount: 3, effectiveEnergy: 200, generatedOverflow: 0 }],
    ]);

    const result = computeAverageOreComposition([0, 1], seedToVoxelMap, grid);

    // Each seed weight = 1/3
    // dirtite = (1/3*0.4 + 1/3*0.6) / (2/3) = (0.333...) = 0.5
    // rustite = (1/3*0.2 + 1/3*0.1) / (2/3) = 0.15
    expect(result.ores.find(o => o.oreId === 'dirtite')!.density).toBeCloseTo(0.5);
    expect(result.ores.find(o => o.oreId === 'rustite')!.density).toBeCloseTo(0.15);
  });

  it('silently skips seed indices not found in map and returns empty ores', () => {
    const grid = new VoxelGrid(10, 10, 10);
    const seedToVoxelMap = new Map<number, SeedVoxelInfo>();
    const result = computeAverageOreComposition([99], seedToVoxelMap, grid);
    expect(result).toEqual({ ores: [] });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 8: computeVolumeM3
// Computes total volume as sum over seeds of (1 / fragmentCount).
// ═══════════════════════════════════════════════════════════════════════════════

describe('FragmentSim — computeVolumeM3', () => {
  it('returns 1/3 for single seed from voxel with fragmentCount=3', () => {
    const seedToVoxelMap = new Map<number, SeedVoxelInfo>([
      [0, { x: 0, y: 0, z: 0, fragmentCount: 3, effectiveEnergy: 200, generatedOverflow: 0 }],
    ]);
    const result = computeVolumeM3([0], seedToVoxelMap);
    expect(result).toBeCloseTo(1 / 3, 10);
  });

  it('returns 0.5 for two seeds from same voxel with fragmentCount=4', () => {
    const seedToVoxelMap = new Map<number, SeedVoxelInfo>([
      [0, { x: 0, y: 0, z: 0, fragmentCount: 4, effectiveEnergy: 200, generatedOverflow: 0 }],
      [1, { x: 0, y: 0, z: 0, fragmentCount: 4, effectiveEnergy: 200, generatedOverflow: 0 }],
    ]);
    const result = computeVolumeM3([0, 1], seedToVoxelMap);
    // 2/4 = 0.5
    expect(result).toBeCloseTo(0.5, 10);
  });

  it('computes sum of 1/fragmentCount for seeds from two voxels', () => {
    const seedToVoxelMap = new Map<number, SeedVoxelInfo>([
      [0, { x: 0, y: 0, z: 0, fragmentCount: 3, effectiveEnergy: 200, generatedOverflow: 0 }],
      [1, { x: 1, y: 0, z: 0, fragmentCount: 4, effectiveEnergy: 200, generatedOverflow: 0 }],
    ]);
    const result = computeVolumeM3([0, 1], seedToVoxelMap);
    // 1/3 + 1/4 = 0.333... + 0.25 = 0.5833...
    expect(result).toBeCloseTo(1 / 3 + 1 / 4, 10);
  });

  it('returns 0 for empty seedIndices', () => {
    const seedToVoxelMap = new Map<number, SeedVoxelInfo>();
    const result = computeVolumeM3([], seedToVoxelMap);
    expect(result).toBe(0);
  });

  it('handles all seeds from same voxel with varying fragment counts', () => {
    const seedToVoxelMap = new Map<number, SeedVoxelInfo>([
      [0, { x: 0, y: 0, z: 0, fragmentCount: 3, effectiveEnergy: 200, generatedOverflow: 0 }],
      [1, { x: 0, y: 0, z: 0, fragmentCount: 3, effectiveEnergy: 200, generatedOverflow: 0 }],
      [2, { x: 0, y: 0, z: 0, fragmentCount: 3, effectiveEnergy: 200, generatedOverflow: 0 }],
    ]);
    const result = computeVolumeM3([0, 1, 2], seedToVoxelMap);
    // 3/3 = 1.0 — entire voxel volume
    expect(result).toBeCloseTo(1.0, 10);
  });

  it('silently skips seed indices not found in map', () => {
    const seedToVoxelMap = new Map<number, SeedVoxelInfo>([
      [0, { x: 0, y: 0, z: 0, fragmentCount: 2, effectiveEnergy: 200, generatedOverflow: 0 }],
    ]);
    const result = computeVolumeM3([0, 99], seedToVoxelMap);
    // Should only count seed 0: 1/2
    expect(result).toBeCloseTo(0.5, 10);
  });

  it('handles large fragment counts correctly', () => {
    const seedToVoxelMap = new Map<number, SeedVoxelInfo>([
      [0, { x: 0, y: 0, z: 0, fragmentCount: 20, effectiveEnergy: 200, generatedOverflow: 0 }],
    ]);
    const result = computeVolumeM3([0], seedToVoxelMap);
    expect(result).toBeCloseTo(1 / 20, 10);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 9: mergeVoronoiCellsWithGrouping
// Wraps mergeVoronoiCells with additional seed grouping tracking.
// ═══════════════════════════════════════════════════════════════════════════════

describe('FragmentSim — mergeVoronoiCellsWithGrouping', () => {
  it('returns empty results for empty cells array', () => {
    const rng = new Random(42);
    const result = mergeVoronoiCellsWithGrouping([], [], rng);
    expect(result.mergedCells).toEqual([]);
    expect(result.seedGroupings).toEqual([]);
  });

  it('returns single group for single cell', () => {
    const cells: VoronoiCell[] = [
      { seedIndex: 0, vertices: [vec3(0, 0, 0)], isValid: false },
    ];
    const rng = new Random(42);
    const result = mergeVoronoiCellsWithGrouping(cells, [], rng);

    // Should produce 1 merged cell and 1 grouping
    expect(result.mergedCells).toHaveLength(1);
    expect(result.seedGroupings).toHaveLength(1);
    expect(result.seedGroupings[0]).toEqual([0]);
  });

  it('returns two separate groupings for two non-adjacent cells', () => {
    // Two disconnected tetrahedra — seeds 0 and 1 share no edge
    const tet0: Tetrahedron = { a: 0, b: 10, c: 11, d: 12, circumcenter: vec3(0.5, 0.5, 0.5) };
    const tet1: Tetrahedron = { a: 1, b: 20, c: 21, d: 22, circumcenter: vec3(1.5, 0.5, 0.5) };
    const cells: VoronoiCell[] = [
      { seedIndex: 0, vertices: [vec3(0, 0, 0)], isValid: false },
      { seedIndex: 1, vertices: [vec3(1, 0, 0)], isValid: false },
    ];
    const rng = new Random(42);
    const result = mergeVoronoiCellsWithGrouping(cells, [tet0, tet1], rng);

    // Non-adjacent — no merging
    expect(result.mergedCells).toHaveLength(2);
    expect(result.seedGroupings).toHaveLength(2);
    // Each grouping should have exactly one element
    const flat = result.seedGroupings.flat();
    expect(flat).toContain(0);
    expect(flat).toContain(1);
    expect(flat).toHaveLength(2);
  });

  it('merges adjacent cells into a single group when rng is favorable', () => {
    // Single tetrahedron connects seeds 0 and 1
    const tet: Tetrahedron = { a: 0, b: 1, c: 2, d: 3, circumcenter: vec3(0.5, 0.5, 0.5) };
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

    // Use rng seed 1 which should trigger chance(0.35) for cell 0
    const rng = new Random(1);
    const result = mergeVoronoiCellsWithGrouping(cells, [tet], rng);

    // With adjacency and favorable rng, some merges happen
    expect(result.mergedCells.length).toBeLessThan(cells.length);
    expect(result.seedGroupings.length).toBeLessThan(cells.length);

    // All original seed indices should be covered by groupings
    const flat = result.seedGroupings.flat();
    for (let i = 0; i < cells.length; i++) {
      expect(flat).toContain(i);
    }
  });

  it('produces deterministic results with same rng seed', () => {
    const tet: Tetrahedron = { a: 0, b: 1, c: 2, d: 3, circumcenter: vec3(0.5, 0.5, 0.5) };
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

    const rngA = new Random(42);
    const rngB = new Random(42);
    const resultA = mergeVoronoiCellsWithGrouping(cells, [tet], rngA);
    const resultB = mergeVoronoiCellsWithGrouping(cells, [tet], rngB);

    expect(resultA.mergedCells).toEqual(resultB.mergedCells);
    expect(resultA.seedGroupings).toEqual(resultB.seedGroupings);
  });

  it('ensures union of groupings covers all original seed indices', () => {
    // 4 cells all connected via one tetrahedron
    const tet: Tetrahedron = { a: 0, b: 1, c: 2, d: 3, circumcenter: vec3(0.5, 0.5, 0.5) };
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

    const rng = new Random(1);
    const result = mergeVoronoiCellsWithGrouping(cells, [tet], rng);

    // Union of all groupings should contain all original seed indices
    const covered = new Set<number>(result.seedGroupings.flat());
    for (let i = 0; i < cells.length; i++) {
      expect(covered.has(i)).toBe(true);
    }
    // No extra indices
    expect(covered.size).toBe(cells.length);
  });

  it('ensures no seed index appears in more than one grouping (disjoint)', () => {
    const tet: Tetrahedron = { a: 0, b: 1, c: 2, d: 3, circumcenter: vec3(0.5, 0.5, 0.5) };
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

    const rng = new Random(1);
    const result = mergeVoronoiCellsWithGrouping(cells, [tet], rng);

    // Count occurrences of each seed index
    const occurrenceCount = new Map<number, number>();
    for (const group of result.seedGroupings) {
      for (const idx of group) {
        occurrenceCount.set(idx, (occurrenceCount.get(idx) ?? 0) + 1);
      }
    }
    // Each seed should appear exactly once
    for (const count of occurrenceCount.values()) {
      expect(count).toBe(1);
    }
  });

  it('preserves ordering: mergedCells[i] corresponds to seedGroupings[i]', () => {
    const cells: VoronoiCell[] = [
      { seedIndex: 0, vertices: [vec3(0, 0, 0)], isValid: false },
      { seedIndex: 1, vertices: [vec3(1, 0, 0)], isValid: false },
    ];
    const rng = new Random(42);
    const result = mergeVoronoiCellsWithGrouping(cells, [], rng);

    // Each merged cell's seedIndex should match its grouping
    expect(result.mergedCells).toHaveLength(2);
    expect(result.seedGroupings).toHaveLength(2);
    for (let i = 0; i < result.mergedCells.length; i++) {
      expect(result.seedGroupings[i]).toContain(result.mergedCells[i]!.seedIndex);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 10: generateRockFragments (end-to-end)
// Main entry point that produces RockFragment objects from merged Voronoi cells.
// ═══════════════════════════════════════════════════════════════════════════════

describe('FragmentSim — generateRockFragments', () => {
  // A tetrahedral Voronoi cell — 4 vertices forming a convex hull
  const cellVertices1 = [
    vec3(0, 0, 0),
    vec3(1, 0, 0),
    vec3(0, 1, 0),
    vec3(0, 0, 1),
  ];

  const cellVertices2 = [
    vec3(1, 0, 0),
    vec3(0, 1, 0),
    vec3(0, 0, 1),
    vec3(1, 1, 1),
  ];

  const baseGrid = (): VoxelGrid => {
    const grid = new VoxelGrid(10, 10, 10);
    grid.setVoxel(0, 0, 0, {
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      density: 1.0,
      oreDensities: { dirtite: 0.4 },
      fractureModifier: 1.0,
    });
    return grid;
  };

  it('returns empty array for empty cells input', () => {
    const seedToVoxelMap = new Map<number, SeedVoxelInfo>();
    const generatedOverflow = new Map<string, number>();
    const rng = new Random(42);
    const result = generateRockFragments([], seedToVoxelMap, [], baseGrid(), new Map<string, number>(), generatedOverflow, rng);
    expect(result).toEqual([]);
  });

  it('produces one fragment with correct default ID (starting at 1)', () => {
    const grid = baseGrid();
    const cells: VoronoiCell[] = [
      { seedIndex: 0, vertices: cellVertices1, isValid: true },
    ];
    const seedToVoxelMap = new Map<number, SeedVoxelInfo>([
      [0, { x: 0, y: 0, z: 0, fragmentCount: 3, effectiveEnergy: 200, generatedOverflow: 50 }],
    ]);
    const seedGroupings = [[0]];
    const generatedOverflow = new Map<string, number>([['0,0,0', 50]]);
    const rng = new Random(42);

    const result = generateRockFragments(cells, seedToVoxelMap, seedGroupings, grid, new Map<string, number>(), generatedOverflow, rng);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe(1);
  });

  it('starts IDs from custom nextId when provided', () => {
    const grid = baseGrid();
    const cells: VoronoiCell[] = [
      { seedIndex: 0, vertices: cellVertices1, isValid: true },
    ];
    const seedToVoxelMap = new Map<number, SeedVoxelInfo>([
      [0, { x: 0, y: 0, z: 0, fragmentCount: 3, effectiveEnergy: 200, generatedOverflow: 0 }],
    ]);
    const seedGroupings = [[0]];
    const generatedOverflow = new Map<string, number>();
    const rng = new Random(42);

    const result = generateRockFragments(cells, seedToVoxelMap, seedGroupings, grid, new Map<string, number>(), generatedOverflow, rng, 100);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe(100);
  });

  it('computes centroid that matches average of hull vertices', () => {
    const grid = baseGrid();
    const cells: VoronoiCell[] = [
      { seedIndex: 0, vertices: cellVertices1, isValid: true },
    ];
    const seedToVoxelMap = new Map<number, SeedVoxelInfo>([
      [0, { x: 0, y: 0, z: 0, fragmentCount: 3, effectiveEnergy: 200, generatedOverflow: 0 }],
    ]);
    const seedGroupings = [[0]];
    const generatedOverflow = new Map<string, number>();
    const rng = new Random(42);

    const result = generateRockFragments(cells, seedToVoxelMap, seedGroupings, grid, new Map<string, number>(), generatedOverflow, rng);

    expect(result).toHaveLength(1);
    const frag = result[0]!;
    // Centroid of the tetrahedron (0,0,0), (1,0,0), (0,1,0), (0,0,1) is (0.25, 0.25, 0.25)
    expect(frag.cx).toBeCloseTo(0.25);
    expect(frag.cy).toBeCloseTo(0.25);
    expect(frag.cz).toBeCloseTo(0.25);
  });

  it('graphicVertices has correct length as Float32Array', () => {
    const grid = baseGrid();
    const cells: VoronoiCell[] = [
      { seedIndex: 0, vertices: cellVertices1, isValid: true },
    ];
    const seedToVoxelMap = new Map<number, SeedVoxelInfo>([
      [0, { x: 0, y: 0, z: 0, fragmentCount: 3, effectiveEnergy: 200, generatedOverflow: 0 }],
    ]);
    const seedGroupings = [[0]];
    const generatedOverflow = new Map<string, number>();
    const rng = new Random(42);

    const result = generateRockFragments(cells, seedToVoxelMap, seedGroupings, grid, new Map<string, number>(), generatedOverflow, rng);

    expect(result).toHaveLength(1);
    const frag = result[0]!;
    // The convex hull of 4 non-coplanar points should have 4 hull vertices
    // graphicVertices = flattenVec3Array(hull) = 4 * 3 = 12 floats
    expect(frag.graphicVertices).toBeInstanceOf(Float32Array);
    expect(frag.graphicVertices.length).toBeGreaterThanOrEqual(12);
    // Length should be a multiple of 3
    expect(frag.graphicVertices.length % 3).toBe(0);
  });

  it('collisionVertices has same length as graphicVertices but shifted inward', () => {
    const grid = baseGrid();
    const cells: VoronoiCell[] = [
      { seedIndex: 0, vertices: cellVertices1, isValid: true },
    ];
    const seedToVoxelMap = new Map<number, SeedVoxelInfo>([
      [0, { x: 0, y: 0, z: 0, fragmentCount: 3, effectiveEnergy: 200, generatedOverflow: 0 }],
    ]);
    const seedGroupings = [[0]];
    const generatedOverflow = new Map<string, number>();
    const rng = new Random(42);

    const result = generateRockFragments(cells, seedToVoxelMap, seedGroupings, grid, new Map<string, number>(), generatedOverflow, rng);

    expect(result).toHaveLength(1);
    const frag = result[0]!;
    // Same length as graphic
    expect(frag.collisionVertices.length).toBe(frag.graphicVertices.length);
    // Each collision vertex should be closer to centroid (inward deflation)
    const cx = frag.cx, cy = frag.cy, cz = frag.cz;
    for (let i = 0; i < frag.graphicVertices.length; i += 3) {
      const gx = frag.graphicVertices[i]!;
      const gy = frag.graphicVertices[i + 1]!;
      const gz = frag.graphicVertices[i + 2]!;
      const cx2 = frag.collisionVertices[i]!;
      const cy2 = frag.collisionVertices[i + 1]!;
      const cz2 = frag.collisionVertices[i + 2]!;
      const distGraphic = Math.sqrt((gx - cx) ** 2 + (gy - cy) ** 2 + (gz - cz) ** 2);
      const distCollision = Math.sqrt((cx2 - cx) ** 2 + (cy2 - cy) ** 2 + (cz2 - cz) ** 2);
      expect(distCollision).toBeLessThanOrEqual(distGraphic);
    }
  });

  it('skips invalid cells (isValid=false) — produces no fragment', () => {
    const grid = baseGrid();
    const cells: VoronoiCell[] = [
      { seedIndex: 0, vertices: cellVertices1, isValid: false },
    ];
    const seedToVoxelMap = new Map<number, SeedVoxelInfo>([
      [0, { x: 0, y: 0, z: 0, fragmentCount: 3, effectiveEnergy: 200, generatedOverflow: 0 }],
    ]);
    const seedGroupings = [[0]];
    const generatedOverflow = new Map<string, number>();
    const rng = new Random(42);

    const result = generateRockFragments(cells, seedToVoxelMap, seedGroupings, grid, new Map<string, number>(), generatedOverflow, rng);
    expect(result).toEqual([]);
  });

  it('skips cells with fewer than 4 hull vertices — produces no fragment', () => {
    const grid = baseGrid();
    // Cell with only 3 vertices — convex hull would have < 4 points after hull calc
    const twoVertexCell: VoronoiCell = {
      seedIndex: 0,
      vertices: [vec3(0, 0, 0), vec3(1, 0, 0), vec3(0, 1, 0)],
      isValid: true,
    };
    const cells: VoronoiCell[] = [twoVertexCell];
    const seedToVoxelMap = new Map<number, SeedVoxelInfo>([
      [0, { x: 0, y: 0, z: 0, fragmentCount: 3, effectiveEnergy: 200, generatedOverflow: 0 }],
    ]);
    const seedGroupings = [[0]];
    const generatedOverflow = new Map<string, number>();
    const rng = new Random(42);

    const result = generateRockFragments(cells, seedToVoxelMap, seedGroupings, grid, new Map<string, number>(), generatedOverflow, rng);
    expect(result).toEqual([]);
  });

  it('computes volume > 0 for valid fragment with seed data', () => {
    const grid = baseGrid();
    const cells: VoronoiCell[] = [
      { seedIndex: 0, vertices: cellVertices1, isValid: true },
    ];
    const seedToVoxelMap = new Map<number, SeedVoxelInfo>([
      [0, { x: 0, y: 0, z: 0, fragmentCount: 3, effectiveEnergy: 200, generatedOverflow: 0 }],
    ]);
    const seedGroupings = [[0]];
    const generatedOverflow = new Map<string, number>();
    const rng = new Random(42);

    const result = generateRockFragments(cells, seedToVoxelMap, seedGroupings, grid, new Map<string, number>(), generatedOverflow, rng);

    expect(result).toHaveLength(1);
    expect(result[0]!.volumeM3).toBeGreaterThan(0);
  });

  it('computes mass = volume * rock density for known rock type', () => {
    const grid = baseGrid();
    // Cruite has density 2100 kg/m³
    const cells: VoronoiCell[] = [
      { seedIndex: 0, vertices: cellVertices1, isValid: true },
    ];
    const seedToVoxelMap = new Map<number, SeedVoxelInfo>([
      [0, { x: 0, y: 0, z: 0, fragmentCount: 3, effectiveEnergy: 200, generatedOverflow: 0 }],
    ]);
    const seedGroupings = [[0]];
    const generatedOverflow = new Map<string, number>();
    const rng = new Random(42);

    const result = generateRockFragments(cells, seedToVoxelMap, seedGroupings, grid, new Map<string, number>(), generatedOverflow, rng);

    expect(result).toHaveLength(1);
    const frag = result[0]!;
    const cruite = getRock('cruite');
    expect(cruite).toBeDefined();
    // mass = volume * density
    const expectedMass = frag.volumeM3 * cruite!.density;
    expect(frag.massKg).toBeCloseTo(expectedMass, 5);
  });

  it('sets overflowEnergy > 0 when source voxels have generatedOverflow', () => {
    const grid = baseGrid();
    const cells: VoronoiCell[] = [
      { seedIndex: 0, vertices: cellVertices1, isValid: true },
    ];
    const seedToVoxelMap = new Map<number, SeedVoxelInfo>([
      [0, { x: 0, y: 0, z: 0, fragmentCount: 3, effectiveEnergy: 200, generatedOverflow: 75 }],
    ]);
    const seedGroupings = [[0]];
    const generatedOverflow = new Map<string, number>([['0,0,0', 75]]);
    const rng = new Random(42);

    const result = generateRockFragments(cells, seedToVoxelMap, seedGroupings, grid, new Map<string, number>(), generatedOverflow, rng);

    expect(result).toHaveLength(1);
    expect(result[0]!.overflowEnergy).toBeGreaterThan(0);
  });

  it('sets overflowEnergy = 0 when no overflow is present', () => {
    const grid = baseGrid();
    const cells: VoronoiCell[] = [
      { seedIndex: 0, vertices: cellVertices1, isValid: true },
    ];
    const seedToVoxelMap = new Map<number, SeedVoxelInfo>([
      [0, { x: 0, y: 0, z: 0, fragmentCount: 3, effectiveEnergy: 200, generatedOverflow: 0 }],
    ]);
    const seedGroupings = [[0]];
    const generatedOverflow = new Map<string, number>();
    const rng = new Random(42);

    const result = generateRockFragments(cells, seedToVoxelMap, seedGroupings, grid, new Map<string, number>(), generatedOverflow, rng);

    expect(result).toHaveLength(1);
    expect(result[0]!.overflowEnergy).toBe(0);
  });

  it('computes velocity from effectiveEnergy and overflowEnergy — non-zero when gradient exists', () => {
    const grid = baseGrid();
    const cells: VoronoiCell[] = [
      { seedIndex: 0, vertices: cellVertices1, isValid: true },
    ];
    const seedToVoxelMap = new Map<number, SeedVoxelInfo>([
      [0, { x: 0, y: 0, z: 0, fragmentCount: 3, effectiveEnergy: 10000, generatedOverflow: 10000 }],
    ]);
    const seedGroupings = [[0]];
    // Centroid of tetrahedron is (0.25, 0.25, 0.25). Finite diff with δ=1 samples at
    // x+1=1.25→key "1,0,0" and x-1=-0.75→key "-1,0,0". Use "1,0,0" so gradient is non-zero.
    const effectiveEnergy = new Map<string, number>([['1,0,0', 1000]]);
    const generatedOverflow = new Map<string, number>([['0,0,0', 10000]]);
    const rng = new Random(42);

    const result = generateRockFragments(cells, seedToVoxelMap, seedGroupings, grid, effectiveEnergy, generatedOverflow, rng);

    expect(result).toHaveLength(1);
    const frag = result[0]!;
    // With high energy and shallow depth (grid is small, so surface is near), velocity should be non-zero
    expect(length(frag.velocity)).toBeGreaterThan(0);
    expect(frag.simulationTier).toBe('projected');
    expect(frag.state).toBe('settling');
  });

  it('correctly inherits composition from source voxels', () => {
    const grid = baseGrid();
    const cells: VoronoiCell[] = [
      { seedIndex: 0, vertices: cellVertices1, isValid: true },
    ];
    const seedToVoxelMap = new Map<number, SeedVoxelInfo>([
      [0, { x: 0, y: 0, z: 0, fragmentCount: 3, effectiveEnergy: 200, generatedOverflow: 0 }],
    ]);
    const seedGroupings = [[0]];
    const generatedOverflow = new Map<string, number>();
    const rng = new Random(42);

    const result = generateRockFragments(cells, seedToVoxelMap, seedGroupings, grid, new Map<string, number>(), generatedOverflow, rng);

    expect(result).toHaveLength(1);
    const frag = result[0]!;
    expect(frag.composition.rocks).toHaveLength(1);
    expect(frag.composition.rocks[0]!.rockId).toBe('cruite');
    expect(frag.composition.rocks[0]!.coefficient).toBeCloseTo(1.0);
  });

  it('correctly inherits ore composition from source voxels', () => {
    const grid = baseGrid();
    const cells: VoronoiCell[] = [
      { seedIndex: 0, vertices: cellVertices1, isValid: true },
    ];
    const seedToVoxelMap = new Map<number, SeedVoxelInfo>([
      [0, { x: 0, y: 0, z: 0, fragmentCount: 3, effectiveEnergy: 200, generatedOverflow: 0 }],
    ]);
    const seedGroupings = [[0]];
    const generatedOverflow = new Map<string, number>();
    const rng = new Random(42);

    const result = generateRockFragments(cells, seedToVoxelMap, seedGroupings, grid, new Map<string, number>(), generatedOverflow, rng);

    expect(result).toHaveLength(1);
    const frag = result[0]!;
    expect(frag.oreComposition.ores).toHaveLength(1);
    expect(frag.oreComposition.ores[0]!.oreId).toBe('dirtite');
    expect(frag.oreComposition.ores[0]!.density).toBeCloseTo(0.4);
  });

  it('produces deterministic results with same inputs', () => {
    const grid = baseGrid();
    const cells: VoronoiCell[] = [
      { seedIndex: 0, vertices: cellVertices1, isValid: true },
    ];
    const seedToVoxelMap = new Map<number, SeedVoxelInfo>([
      [0, { x: 0, y: 0, z: 0, fragmentCount: 3, effectiveEnergy: 200, generatedOverflow: 0 }],
    ]);
    const seedGroupings = [[0]];
    const generatedOverflow = new Map<string, number>();

    const resultA = generateRockFragments(cells, seedToVoxelMap, seedGroupings, grid, new Map<string, number>(), generatedOverflow, new Random(42));
    const resultB = generateRockFragments(cells, seedToVoxelMap, seedGroupings, grid, new Map<string, number>(), generatedOverflow, new Random(42));

    expect(resultA).toHaveLength(1);
    expect(resultB).toHaveLength(1);
    const a = resultA[0]!;
    const b = resultB[0]!;
    expect(a.id).toBe(b.id);
    expect(a.cx).toBe(b.cx);
    expect(a.cy).toBe(b.cy);
    expect(a.cz).toBe(b.cz);
    expect(a.volumeM3).toBe(b.volumeM3);
    expect(a.massKg).toBe(b.massKg);
    expect(a.overflowEnergy).toBe(b.overflowEnergy);
    expect(a.composition).toEqual(b.composition);
    expect(a.oreComposition).toEqual(b.oreComposition);
  });

  it('assigns incrementing IDs for multiple cells', () => {
    const grid = baseGrid();
    // Set up second voxel too
    grid.setVoxel(1, 0, 0, {
      composition: { rocks: [{ rockId: 'sandite', coefficient: 1.0 }] },
      density: 1.0,
      oreDensities: {},
      fractureModifier: 1.0,
    });

    const cells: VoronoiCell[] = [
      { seedIndex: 0, vertices: cellVertices1, isValid: true },
      { seedIndex: 1, vertices: cellVertices2, isValid: true },
    ];
    const seedToVoxelMap = new Map<number, SeedVoxelInfo>([
      [0, { x: 0, y: 0, z: 0, fragmentCount: 3, effectiveEnergy: 200, generatedOverflow: 0 }],
      [1, { x: 1, y: 0, z: 0, fragmentCount: 4, effectiveEnergy: 200, generatedOverflow: 0 }],
    ]);
    const seedGroupings = [[0], [1]];
    const generatedOverflow = new Map<string, number>();
    const rng = new Random(42);

    const result = generateRockFragments(cells, seedToVoxelMap, seedGroupings, grid, new Map<string, number>(), generatedOverflow, rng, 10);

    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe(10);
    expect(result[1]!.id).toBe(11);
  });

  it('handles multiple seeds per grouping correctly', () => {
    const grid = new VoxelGrid(10, 10, 10);
    // Both seeds from the same voxel
    grid.setVoxel(0, 0, 0, {
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      density: 1.0,
      oreDensities: { dirtite: 0.5, rustite: 0.3 },
      fractureModifier: 1.0,
    });

    const cells: VoronoiCell[] = [
      { seedIndex: 0, vertices: cellVertices1, isValid: true },
    ];
    const seedToVoxelMap = new Map<number, SeedVoxelInfo>([
      [0, { x: 0, y: 0, z: 0, fragmentCount: 2, effectiveEnergy: 200, generatedOverflow: 30 }],
      [1, { x: 0, y: 0, z: 0, fragmentCount: 2, effectiveEnergy: 200, generatedOverflow: 30 }],
    ]);
    // Both seeds in the same group
    const seedGroupings = [[0, 1]];
    // 2 seeds from fragmentCount=2 = 1 full voxel volume
    const generatedOverflow = new Map<string, number>([['0,0,0', 30]]);
    const rng = new Random(42);

    const result = generateRockFragments(cells, seedToVoxelMap, seedGroupings, grid, new Map<string, number>(), generatedOverflow, rng);

    expect(result).toHaveLength(1);
    const frag = result[0]!;
    // Volume should be 2/2 = 1.0 (full voxel)
    expect(frag.volumeM3).toBeCloseTo(1.0, 5);
    // overflowEnergy should reflect all seeds contributing
    expect(frag.overflowEnergy).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 11: FragmentSimVelocity — computeEnergyGradientDirection
// Computes gradient of effective energy field around a point.
// ═══════════════════════════════════════════════════════════════════════════════

describe('FragmentSimVelocity — computeEnergyGradientDirection', () => {
  it('returns ZERO for empty effectiveEnergy map', () => {
    const grid = new VoxelGrid(10, 10, 10);
    const result = computeEnergyGradientDirection(new Map(), vec3(0, 0, 0), grid);
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
    expect(result.z).toBe(0);
  });

  it('returns direction away from single high-energy voxel at (1,0,0)', () => {
    const grid = new VoxelGrid(10, 10, 10);
    const energy = new Map<string, number>([['1,0,0', 100]]);
    // Point at origin — finite diff samples at x+1=1→"1,0,0" and x-1=-1→"-1,0,0"
    // E(1,0,0)=100, E(-1,0,0)=0 → dE/dx=50 → gradient=(50,0,0) → negated=(-1,0,0)
    const result = computeEnergyGradientDirection(energy, vec3(0, 0, 0), grid);
    // Direction away from high energy (negative gradient) should point negative x
    expect(result.x).toBeLessThan(0);
    expect(result.y).toBeCloseTo(0, 10);
    expect(result.z).toBeCloseTo(0, 10);
  });

  it('returns ZERO for uniform energy field', () => {
    const grid = new VoxelGrid(10, 10, 10);
    const energy = new Map<string, number>([
      ['0,0,0', 100],
      ['2,0,0', 100],
    ]);
    const result = computeEnergyGradientDirection(energy, vec3(1, 0, 0), grid);
    // Uniform energy → no gradient → ZERO
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
    expect(result.z).toBe(0);
  });

  it('computes gradient pointing away from higher energy region', () => {
    const grid = new VoxelGrid(10, 10, 10);
    // Higher energy at x=2 than at x=0
    const energy = new Map<string, number>([
      ['0,0,0', 50],
      ['2,0,0', 150],
    ]);
    const result = computeEnergyGradientDirection(energy, vec3(1, 0, 0), grid);
    // dE/dx ≈ (150-50)/2 = 50, so gradient points +x, negated gradient = -x direction
    expect(result.x).toBeLessThan(0);
    expect(result.y).toBeCloseTo(0, 10);
    expect(result.z).toBeCloseTo(0, 10);
  });

  it('handles out-of-bounds point gracefully', () => {
    const grid = new VoxelGrid(10, 10, 10);
    const energy = new Map<string, number>();
    // Point outside grid should not crash
    const result = computeEnergyGradientDirection(energy, vec3(-5, -5, -5), grid);
    expect(result).toBeDefined();
  });

  it('returns unit-length direction for non-zero gradient', () => {
    const grid = new VoxelGrid(10, 10, 10);
    const energy = new Map<string, number>([['5,0,0', 200]]);
    const result = computeEnergyGradientDirection(energy, vec3(3, 0, 0), grid);
    // Direction should be normalized
    const mag = Math.sqrt(result.x * result.x + result.y * result.y + result.z * result.z);
    if (mag > 0) {
      expect(mag).toBeCloseTo(1.0, 5);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 12: FragmentSimVelocity — distanceToNearestAirVoxel
// Finds the distance from a point to the nearest air voxel.
// ═══════════════════════════════════════════════════════════════════════════════

describe('FragmentSimVelocity — distanceToNearestAirVoxel', () => {
  it('returns 0 when point is inside an air voxel', () => {
    // Default grid has no voxels set → all are air
    const grid = new VoxelGrid(10, 10, 10);
    const result = distanceToNearestAirVoxel(vec3(0.5, 0.5, 0.5), grid);
    expect(result).toBe(0);
  });

  it('returns positive distance when surrounded by solid rock', () => {
    const grid = new VoxelGrid(10, 10, 10);
    // Fill the area with solid rock
    for (let x = 3; x <= 7; x++) {
      for (let y = 3; y <= 7; y++) {
        for (let z = 3; z <= 7; z++) {
          grid.setVoxel(x, y, z, {
            composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
            density: 1.0,
            oreDensities: {},
            fractureModifier: 1.0,
          });
        }
      }
    }
    // Point at center of solid block (5.5, 5.5, 5.5) — nearest air is at boundary of the filled area
    const result = distanceToNearestAirVoxel(vec3(5.5, 5.5, 5.5), grid, 10);
    // Should be > 0 (distance to first air voxel outside the block)
    expect(result).toBeGreaterThan(0);
  });

  it('returns sentinel when no air found within maxRadius', () => {
    const grid = new VoxelGrid(30, 30, 30);
    // Fill a central region with rock so air is far away
    for (let x = 10; x < 20; x++) {
      for (let y = 10; y < 20; y++) {
        for (let z = 10; z < 20; z++) {
          grid.setVoxel(x, y, z, {
            composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
            density: 1.0,
            oreDensities: {},
            fractureModifier: 1.0,
          });
        }
      }
    }
    const result = distanceToNearestAirVoxel(vec3(15, 15, 15), grid, 4);
    // Nearest air is at the boundary of the rock block (x=9 or x=20), distance > 8, so sentinel = 4*2
    expect(result).toBe(8);
  });

  it('treats out-of-bounds voxels as air', () => {
    const grid = new VoxelGrid(3, 3, 3);
    // Fill grid with rock
    for (let x = 0; x < 3; x++) {
      for (let y = 0; y < 3; y++) {
        for (let z = 0; z < 3; z++) {
          grid.setVoxel(x, y, z, {
            composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
            density: 1.0,
            oreDensities: {},
            fractureModifier: 1.0,
          });
        }
      }
    }
    // Point near boundary — out-of-bounds should count as air
    const result = distanceToNearestAirVoxel(vec3(2.9, 1.5, 1.5), grid, 5);
    expect(result).toBeGreaterThan(0);
  });

  it('detects adjacent air voxel with correct distance', () => {
    const grid = new VoxelGrid(10, 10, 10);
    // Solid rock at (5,5,5), all other voxels are air
    grid.setVoxel(5, 5, 5, {
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      density: 1.0,
      oreDensities: {},
      fractureModifier: 1.0,
    });
    // Point inside the solid voxel — BFS iteration order finds (4,4,4) first at r=1
    const result = distanceToNearestAirVoxel(vec3(5.5, 5.5, 5.5), grid, 5);
    // Distance from (5.5,5.5,5.5) to center of (4,4,4) = (4.5,4.5,4.5) = sqrt(3)
    const expected = Math.sqrt(3);
    expect(result).toBeCloseTo(expected, 5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 13: FragmentSimVelocity — computeSurfaceProximityFactor
// Surface proximity factor based on distance to air: exp(-d / SURFACE_PROXIMITY_DECAY).
// ═══════════════════════════════════════════════════════════════════════════════

describe('FragmentSimVelocity — computeSurfaceProximityFactor', () => {
  it('returns 1.0 for distToAir = 0', () => {
    expect(computeSurfaceProximityFactor(0)).toBe(1.0);
  });

  it('returns exp(-0.5) ≈ 0.6065 for distToAir = 1.0', () => {
    expect(computeSurfaceProximityFactor(1.0)).toBeCloseTo(Math.exp(-0.5), 10);
  });

  it('returns exp(-1.0) ≈ 0.3679 for distToAir = 2.0', () => {
    expect(computeSurfaceProximityFactor(2.0)).toBeCloseTo(Math.exp(-1.0), 10);
  });

  it('returns very small value for distToAir = 10', () => {
    expect(computeSurfaceProximityFactor(10)).toBeCloseTo(Math.exp(-5), 10);
  });

  it('returns correct value for distToAir = 0.5', () => {
    expect(computeSurfaceProximityFactor(0.5)).toBeCloseTo(Math.exp(-0.25), 10);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 14: FragmentSimVelocity — computeVelocityMagnitude
// Velocity magnitude from overflow energy, mass, and surface proximity factor.
// ═══════════════════════════════════════════════════════════════════════════════

describe('FragmentSimVelocity — computeVelocityMagnitude', () => {
  it('computes correct magnitude for overflowEnergy=10000, mass=100, factor=1.0', () => {
    const result = computeVelocityMagnitude(10000, 100, 1.0);
    // sqrt(2 * 10000 / 100) = sqrt(200) ≈ 14.142
    expect(result).toBeCloseTo(Math.sqrt(200), 10);
  });

  it('scales by surfaceProximityFactor', () => {
    const result = computeVelocityMagnitude(10000, 100, 0.5);
    // sqrt(200) * 0.5 ≈ 7.071
    expect(result).toBeCloseTo(Math.sqrt(200) * 0.5, 10);
  });

  it('returns 0 when overflowEnergy is 0', () => {
    expect(computeVelocityMagnitude(0, 100, 1.0)).toBe(0);
  });

  it('returns 0 when massKg is 0 (guard against division by zero)', () => {
    expect(computeVelocityMagnitude(10000, 0, 1.0)).toBe(0);
  });

  it('clamps to MAX_PROJECTION_VELOCITY (80) when very high energy', () => {
    // sqrt(2 * 1000000 / 1) = sqrt(2000000) ≈ 1414, clamped to 80
    const result = computeVelocityMagnitude(1000000, 1, 1.0);
    expect(result).toBe(MAX_PROJECTION_VELOCITY);
  });

  it('clamps very high energy/mass ratio to MAX_PROJECTION_VELOCITY', () => {
    const result = computeVelocityMagnitude(100, 0.001, 1.0);
    expect(result).toBe(MAX_PROJECTION_VELOCITY);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 15: FragmentSimVelocity — classifySimulationTier
// Classifies fragment into 'collapse' or 'projected' based on velocity threshold.
// ═══════════════════════════════════════════════════════════════════════════════

describe('FragmentSimVelocity — classifySimulationTier', () => {
  it('returns projected for vMag=5.0 (> threshold)', () => {
    expect(classifySimulationTier(5.0)).toBe('projected');
  });

  it('returns collapse for vMag=1.0 (< threshold)', () => {
    expect(classifySimulationTier(1.0)).toBe('collapse');
  });

  it('returns collapse for vMag=2.0 (exactly threshold, strict >)', () => {
    expect(classifySimulationTier(2.0)).toBe('collapse');
  });

  it('returns collapse for vMag=0', () => {
    expect(classifySimulationTier(0)).toBe('collapse');
  });

  it('returns projected for very high vMag=200', () => {
    expect(classifySimulationTier(200)).toBe('projected');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 16: FragmentSimVelocity — assignFragmentVelocity
// End-to-end velocity assignment: combines gradient, distance, proximity, and tier.
// ═══════════════════════════════════════════════════════════════════════════════

describe('FragmentSimVelocity — assignFragmentVelocity', () => {
  it('assigns non-zero velocity and projected tier when fragment has high overflow and near surface', () => {
    const grid = new VoxelGrid(10, 10, 10);
    // Set rock at (5,5,5) with air all around
    grid.setVoxel(5, 5, 5, {
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      density: 1.0,
      oreDensities: {},
      fractureModifier: 1.0,
    });

    const fragment: RockFragment = {
      id: 1, cx: 5.5, cy: 5.5, cz: 5.5,
      graphicVertices: new Float32Array(),
      collisionVertices: new Float32Array(),
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      oreComposition: { ores: [] },
      volumeM3: 1.0,
      massKg: 100,
      overflowEnergy: 100000,
      velocity: ZERO,
      simulationTier: 'collapse',
      state: 'settling',
    };

    // Centroid at (5.5, 5.5, 5.5). Finite diff with δ=1 samples at x+1=6.5→"6,5,5" and
    // x-1=4.5→"4,5,5". Use "4,5,5" in the map so gradient is non-zero (points +x).
    const effectiveEnergy = new Map<string, number>([['4,5,5', 1000]]);

    assignFragmentVelocity(fragment, effectiveEnergy, grid);

    // Should have non-zero velocity and projected tier
    const vMag = length(fragment.velocity);
    expect(vMag).toBeGreaterThan(0);
    expect(fragment.simulationTier).toBe('projected');
    expect(fragment.state).toBe('settling'); // unchanged
  });

  it('assigns zero velocity and collapse tier when overflowEnergy is 0', () => {
    const grid = new VoxelGrid(10, 10, 10);
    grid.setVoxel(5, 5, 5, {
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      density: 1.0,
      oreDensities: {},
      fractureModifier: 1.0,
    });

    const fragment: RockFragment = {
      id: 1, cx: 5.5, cy: 5.5, cz: 5.5,
      graphicVertices: new Float32Array(),
      collisionVertices: new Float32Array(),
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      oreComposition: { ores: [] },
      volumeM3: 1.0,
      massKg: 100,
      overflowEnergy: 0,
      velocity: ZERO,
      simulationTier: 'projected',
      state: 'settling',
    };

    assignFragmentVelocity(fragment, new Map<string, number>(), grid);

    expect(fragment.velocity.x).toBe(0);
    expect(fragment.velocity.y).toBe(0);
    expect(fragment.velocity.z).toBe(0);
    expect(fragment.simulationTier).toBe('collapse');
  });

  it('assigns collapse tier for deep fragment with no nearby air', () => {
    const grid = new VoxelGrid(10, 10, 10);
    // Fill entire grid with rock → no air
    for (let x = 0; x < 10; x++) {
      for (let y = 0; y < 10; y++) {
        for (let z = 0; z < 10; z++) {
          grid.setVoxel(x, y, z, {
            composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
            density: 1.0,
            oreDensities: {},
            fractureModifier: 1.0,
          });
        }
      }
    }

    const fragment: RockFragment = {
      id: 1, cx: 5.5, cy: 5.5, cz: 5.5,
      graphicVertices: new Float32Array(),
      collisionVertices: new Float32Array(),
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      oreComposition: { ores: [] },
      volumeM3: 1.0,
      massKg: 100,
      overflowEnergy: 5000,
      velocity: ZERO,
      simulationTier: 'projected',
      state: 'settling',
    };

    assignFragmentVelocity(fragment, new Map<string, number>(), grid);

    // Deep fragment → surfaceProximityFactor ≈ 0 → velocity ≈ 0
    expect(fragment.simulationTier).toBe('collapse');
  });

  it('assigns upward velocity when energy gradient points upward', () => {
    const grid = new VoxelGrid(10, 10, 10);
    // Rock at (5,5,5) with air above
    grid.setVoxel(5, 5, 5, {
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      density: 1.0,
      oreDensities: {},
      fractureModifier: 1.0,
    });

    const fragment: RockFragment = {
      id: 1, cx: 5.5, cy: 5.5, cz: 5.5,
      graphicVertices: new Float32Array(),
      collisionVertices: new Float32Array(),
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      oreComposition: { ores: [] },
      volumeM3: 1.0,
      massKg: 100,
      overflowEnergy: 50000,
      velocity: ZERO,
      simulationTier: 'collapse',
      state: 'settling',
    };

    // Centroid at (5.5, 5.5, 5.5). Finite diff with δ=1 samples at y+1=6.5→"5,6,5" and
    // y-1=4.5→"5,4,5". Higher energy at "5,4,5" (below) than "5,6,5" (above) → gradient upward.
    const effectiveEnergy = new Map<string, number>([
      ['5,4,5', 100000],
      ['5,6,5', 10000],
    ]);

    assignFragmentVelocity(fragment, effectiveEnergy, grid);

    // Energy is higher at lower y → gradient direction = away from high energy = upward (positive y)
    expect(fragment.velocity.y).toBeGreaterThan(0);
    expect(fragment.simulationTier).toBe('projected');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 17: FragmentSimPhysics — simulateProjectedFragments
// Tier A physics simulation: rigid-body (first N) + parabolic fallback (rest)
// All projected fragments end with state='static' after simulation.
// ═══════════════════════════════════════════════════════════════════════════════

describe('FragmentSimPhysics — simulateProjectedFragments', () => {
  it('returns empty array for empty input', () => {
    const grid = new VoxelGrid(10, 10, 10);
    const result = simulateProjectedFragments([], grid);
    expect(result).toEqual([]);
  });

  it('returns collapse fragments unchanged (state and tier preserved)', () => {
    const grid = new VoxelGrid(10, 10, 10);
    const frag: RockFragment = {
      id: 1, cx: 0, cy: 0, cz: 0,
      graphicVertices: new Float32Array(),
      collisionVertices: new Float32Array(),
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      oreComposition: { ores: [] },
      volumeM3: 1.0, massKg: 100,
      overflowEnergy: 0,
      velocity: ZERO,
      simulationTier: 'collapse',
      state: 'settling',
    };
    const result = simulateProjectedFragments([frag], grid);
    expect(result).toHaveLength(1);
    expect(result[0]!.state).toBe('settling');
    expect(result[0]!.simulationTier).toBe('collapse');
  });

  it('sets projected fragment state to static with terrain present', () => {
    const grid = new VoxelGrid(10, 10, 10);
    // Flat terrain at y=0 so fragments land on something
    for (let x = 0; x < 10; x++) {
      for (let z = 0; z < 10; z++) {
        grid.setVoxel(x, 0, z, {
          composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
          density: 1.0, oreDensities: {}, fractureModifier: 1.0,
        });
      }
    }
    const frag: RockFragment = {
      id: 1, cx: 5, cy: 5, cz: 5,
      graphicVertices: new Float32Array(),
      collisionVertices: new Float32Array(),
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      oreComposition: { ores: [] },
      volumeM3: 1.0, massKg: 100,
      overflowEnergy: 0,
      velocity: ZERO,
      simulationTier: 'projected',
      state: 'flying',
    };
    const result = simulateProjectedFragments([frag], grid);
    expect(result).toHaveLength(1);
    expect(result[0]!.state).toBe('static');
  });

  it('handles zero-mass projected fragment gracefully (state=static, position unchanged)', () => {
    const grid = new VoxelGrid(10, 10, 10);
    const frag: RockFragment = {
      id: 1, cx: 5, cy: 5, cz: 5,
      graphicVertices: new Float32Array(),
      collisionVertices: new Float32Array(),
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      oreComposition: { ores: [] },
      volumeM3: 1.0, massKg: 0,
      overflowEnergy: 0,
      velocity: ZERO,
      simulationTier: 'projected',
      state: 'flying',
    };
    const result = simulateProjectedFragments([frag], grid);
    expect(result).toHaveLength(1);
    expect(result[0]!.state).toBe('static');
    // Position unchanged because isFragmentValidForPhysics skips massKg=0
    expect(result[0]!.cx).toBe(5);
    expect(result[0]!.cy).toBe(5);
    expect(result[0]!.cz).toBe(5);
  });

  it('handles projected fragments beyond PHYSICS_FRAGMENT_CAP via parabolic fallback without error', () => {
    const grid = new VoxelGrid(2, 2, 2);
    const fragments: RockFragment[] = [];
    for (let i = 0; i < PHYSICS_FRAGMENT_CAP + 1; i++) {
      fragments.push({
        id: i + 1,
        cx: 0, cy: 5, cz: 0,
        graphicVertices: new Float32Array(),
        collisionVertices: new Float32Array(),
        composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
        oreComposition: { ores: [] },
        volumeM3: 1.0, massKg: 100,
        overflowEnergy: 0,
        velocity: ZERO,
        simulationTier: 'projected',
        state: 'flying',
      });
    }
    const result = simulateProjectedFragments(fragments, grid);
    expect(result).toHaveLength(PHYSICS_FRAGMENT_CAP + 1);
    for (const f of result) {
      expect(f.state).toBe('static');
    }
  });

  it('preserves collapse fragment state when mixed with projected fragments', () => {
    const grid = new VoxelGrid(10, 10, 10);
    for (let x = 0; x < 10; x++) {
      for (let z = 0; z < 10; z++) {
        grid.setVoxel(x, 0, z, {
          composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
          density: 1.0, oreDensities: {}, fractureModifier: 1.0,
        });
      }
    }
    const projected: RockFragment = {
      id: 1, cx: 5, cy: 5, cz: 5,
      graphicVertices: new Float32Array(),
      collisionVertices: new Float32Array(),
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      oreComposition: { ores: [] },
      volumeM3: 1.0, massKg: 100,
      overflowEnergy: 0, velocity: ZERO,
      simulationTier: 'projected',
      state: 'flying',
    };
    const collapse: RockFragment = {
      id: 2, cx: 0, cy: 0, cz: 0,
      graphicVertices: new Float32Array(),
      collisionVertices: new Float32Array(),
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      oreComposition: { ores: [] },
      volumeM3: 1.0, massKg: 100,
      overflowEnergy: 0, velocity: ZERO,
      simulationTier: 'collapse',
      state: 'settling',
    };
    const result = simulateProjectedFragments([projected, collapse], grid);
    expect(result).toHaveLength(2);
    const projectedResult = result.find(f => f.id === 1)!;
    expect(projectedResult.state).toBe('static');
    const collapseResult = result.find(f => f.id === 2)!;
    expect(collapseResult.state).toBe('settling');
  });

  it('mutates input array in place (returns same reference)', () => {
    const grid = new VoxelGrid(10, 10, 10);
    const frag: RockFragment = {
      id: 1, cx: 5, cy: 5, cz: 5,
      graphicVertices: new Float32Array(),
      collisionVertices: new Float32Array(),
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      oreComposition: { ores: [] },
      volumeM3: 1.0, massKg: 100,
      overflowEnergy: 0, velocity: ZERO,
      simulationTier: 'projected',
      state: 'flying',
    };
    const input = [frag];
    const result = simulateProjectedFragments(input, grid);
    expect(result).toBe(input);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 18: FragmentSimPhysics — simulateCollapseFragments
// Tier B gravity-drop simulation: straight-down, column stack, immediate static.
// ═══════════════════════════════════════════════════════════════════════════════

describe('FragmentSimPhysics — simulateCollapseFragments', () => {
  it('returns empty array for empty input', () => {
    const grid = new VoxelGrid(10, 10, 10);
    const result = simulateCollapseFragments([], grid);
    expect(result).toEqual([]);
  });

  it('returns projected fragments unchanged (state and tier preserved)', () => {
    const grid = new VoxelGrid(10, 10, 10);
    const frag: RockFragment = {
      id: 1, cx: 0, cy: 0, cz: 0,
      graphicVertices: new Float32Array(),
      collisionVertices: new Float32Array(),
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      oreComposition: { ores: [] },
      volumeM3: 1.0, massKg: 100,
      overflowEnergy: 0,
      velocity: ZERO,
      simulationTier: 'projected',
      state: 'flying',
    };
    const result = simulateCollapseFragments([frag], grid);
    expect(result).toHaveLength(1);
    expect(result[0]!.state).toBe('flying');
    expect(result[0]!.simulationTier).toBe('projected');
  });

  it('sets collapse fragment to static with terrain present', () => {
    const grid = new VoxelGrid(10, 10, 10);
    // Flat terrain at y=0
    for (let x = 0; x < 10; x++) {
      for (let z = 0; z < 10; z++) {
        grid.setVoxel(x, 0, z, {
          composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
          density: 1.0, oreDensities: {}, fractureModifier: 1.0,
        });
      }
    }
    const frag: RockFragment = {
      id: 1, cx: 5, cy: 10, cz: 5,
      graphicVertices: new Float32Array(),
      collisionVertices: new Float32Array(),
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      oreComposition: { ores: [] },
      volumeM3: 1.0, massKg: 100,
      overflowEnergy: 0,
      velocity: ZERO,
      simulationTier: 'collapse',
      state: 'settling',
    };
    const result = simulateCollapseFragments([frag], grid);
    expect(result).toHaveLength(1);
    expect(result[0]!.state).toBe('static');
    // Should land at surface y=0 + clearance = 1.0
    expect(result[0]!.cy).toBeCloseTo(PHYSICS_TERRAIN_CLEARANCE, 5);
  });

  it('drops collapse fragment straight down (no horizontal movement)', () => {
    const grid = new VoxelGrid(10, 10, 10);
    for (let x = 0; x < 10; x++) {
      for (let z = 0; z < 10; z++) {
        grid.setVoxel(x, 0, z, {
          composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
          density: 1.0, oreDensities: {}, fractureModifier: 1.0,
        });
      }
    }
    const frag: RockFragment = {
      id: 1, cx: 3, cy: 20, cz: 7,
      graphicVertices: new Float32Array(),
      collisionVertices: new Float32Array(),
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      oreComposition: { ores: [] },
      volumeM3: 1.0, massKg: 100,
      overflowEnergy: 0,
      velocity: ZERO,
      simulationTier: 'collapse',
      state: 'settling',
    };
    const result = simulateCollapseFragments([frag], grid);
    // cx and cz must remain unchanged
    expect(result[0]!.cx).toBe(3);
    expect(result[0]!.cz).toBe(7);
    // cy should be at surface + clearance
    expect(result[0]!.cy).toBeCloseTo(PHYSICS_TERRAIN_CLEARANCE, 5);
    expect(result[0]!.state).toBe('static');
  });

  it('handles zero-mass collapse fragment (state=static, position unchanged)', () => {
    const grid = new VoxelGrid(10, 10, 10);
    const frag: RockFragment = {
      id: 1, cx: 5, cy: 5, cz: 5,
      graphicVertices: new Float32Array(),
      collisionVertices: new Float32Array(),
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      oreComposition: { ores: [] },
      volumeM3: 1.0, massKg: 0,
      overflowEnergy: 0,
      velocity: ZERO,
      simulationTier: 'collapse',
      state: 'settling',
    };
    const result = simulateCollapseFragments([frag], grid);
    expect(result).toHaveLength(1);
    expect(result[0]!.state).toBe('static');
    expect(result[0]!.cx).toBe(5);
    expect(result[0]!.cy).toBe(5);
    expect(result[0]!.cz).toBe(5);
  });

  it('handles fragment already below terrain surface', () => {
    const grid = new VoxelGrid(10, 10, 10);
    // Terrain at y=5
    for (let x = 0; x < 10; x++) {
      for (let z = 0; z < 10; z++) {
        grid.setVoxel(x, 5, z, {
          composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
          density: 1.0, oreDensities: {}, fractureModifier: 1.0,
        });
      }
    }
    // Fragment at y=2, which is below terrain surface y=5
    const frag: RockFragment = {
      id: 1, cx: 5, cy: 2, cz: 5,
      graphicVertices: new Float32Array(),
      collisionVertices: new Float32Array(),
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      oreComposition: { ores: [] },
      volumeM3: 1.0, massKg: 100,
      overflowEnergy: 0,
      velocity: ZERO,
      simulationTier: 'collapse',
      state: 'settling',
    };
    const result = simulateCollapseFragments([frag], grid);
    expect(result).toHaveLength(1);
    expect(result[0]!.state).toBe('static');
    // Should be placed at surface y=5 + clearance = 6.0
    expect(result[0]!.cy).toBeCloseTo(5 + PHYSICS_TERRAIN_CLEARANCE, 5);
  });

  it('handles fragment over empty column (no terrain — falls through world)', () => {
    const grid = new VoxelGrid(10, 10, 10);
    // No terrain at all — all columns empty
    const frag: RockFragment = {
      id: 1, cx: 5, cy: 100, cz: 5,
      graphicVertices: new Float32Array(),
      collisionVertices: new Float32Array(),
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      oreComposition: { ores: [] },
      volumeM3: 1.0, massKg: 100,
      overflowEnergy: 0,
      velocity: ZERO,
      simulationTier: 'collapse',
      state: 'settling',
    };
    const result = simulateCollapseFragments([frag], grid);
    expect(result).toHaveLength(1);
    expect(result[0]!.state).toBe('static');
    // Should have fallen for MAX_STEPS with gravity but never hit terrain
    expect(result[0]!.cy).toBeLessThan(0); // Fell below world
    expect(Number.isFinite(result[0]!.cy)).toBe(true);
  });

  it('preserves projected fragment state when mixed with collapse', () => {
    const grid = new VoxelGrid(10, 10, 10);
    for (let x = 0; x < 10; x++) {
      for (let z = 0; z < 10; z++) {
        grid.setVoxel(x, 0, z, {
          composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
          density: 1.0, oreDensities: {}, fractureModifier: 1.0,
        });
      }
    }
    const projected: RockFragment = {
      id: 1, cx: 5, cy: 5, cz: 5,
      graphicVertices: new Float32Array(),
      collisionVertices: new Float32Array(),
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      oreComposition: { ores: [] },
      volumeM3: 1.0, massKg: 100,
      overflowEnergy: 0, velocity: ZERO,
      simulationTier: 'projected',
      state: 'flying',
    };
    const collapse: RockFragment = {
      id: 2, cx: 5, cy: 10, cz: 5,
      graphicVertices: new Float32Array(),
      collisionVertices: new Float32Array(),
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      oreComposition: { ores: [] },
      volumeM3: 1.0, massKg: 100,
      overflowEnergy: 0, velocity: ZERO,
      simulationTier: 'collapse',
      state: 'settling',
    };
    const result = simulateCollapseFragments([projected, collapse], grid);
    expect(result).toHaveLength(2);
    const projectedResult = result.find(f => f.id === 1)!;
    expect(projectedResult.state).toBe('flying');
    expect(projectedResult.simulationTier).toBe('projected');
    const collapseResult = result.find(f => f.id === 2)!;
    expect(collapseResult.state).toBe('static');
    expect(collapseResult.simulationTier).toBe('collapse');
  });

  it('mutates input array in place (returns same reference)', () => {
    const grid = new VoxelGrid(10, 10, 10);
    const frag: RockFragment = {
      id: 1, cx: 5, cy: 5, cz: 5,
      graphicVertices: new Float32Array(),
      collisionVertices: new Float32Array(),
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      oreComposition: { ores: [] },
      volumeM3: 1.0, massKg: 100,
      overflowEnergy: 0, velocity: ZERO,
      simulationTier: 'collapse',
      state: 'settling',
    };
    const input = [frag];
    const result = simulateCollapseFragments(input, grid);
    expect(result).toBe(input);
  });
});
