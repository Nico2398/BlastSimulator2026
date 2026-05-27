// Integration tests: Voronoi fragmentation seed pipeline
// Task 5.8 — computeFragmentationScore + Voronoi seed sampling
//
// These tests exercise the REAL blast pipeline data flow:
//   propagateEnergy -> identifyFragmentedVoxels -> generateSeedPointCloud
//
// Unlike unit tests (which test isolated VoronoiFrag functions in a pure
// environment), integration tests verify the complete chain with real
// rock definitions, real energy propagation, and real island flood-fill.
//
// Test methodology: set up a VoxelGrid with known rock, inject energy with
// propagateEnergy, fragment with identifyFragmentedVoxels, then verify the
// seed cloud from generateSeedPointCloud matches expectations.

import { describe, it, expect, beforeEach } from 'vitest';
import { VoxelGrid, type VoxelData } from '../../src/core/world/VoxelGrid.js';
import { propagateEnergy, identifyFragmentedVoxels, computeThreshold } from '../../src/core/mining/BlastCalc.js';
import { generateSeedPointCloud } from '../../src/physics/VoronoiFrag.js';
import { Random } from '../../src/core/math/Random.js';

// ---------------------------------------------------------------------------
// Fixtures — reference rock properties (from RockCatalog):
//   cruite:   energyAbsorption=200, hardnessTier=1 (softest)
//   sandite:  energyAbsorption=250, hardnessTier=1
//   titanite: energyAbsorption=4000, hardnessTier=5 (hardest)
// ---------------------------------------------------------------------------

const CRUITE: VoxelData = {
  composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
  density: 1.0,
  oreDensities: {},
  fractureModifier: 1.0,
};

const SANDITE: VoxelData = {
  composition: { rocks: [{ rockId: 'sandite', coefficient: 1.0 }] },
  density: 1.0,
  oreDensities: {},
  fractureModifier: 1.0,
};

const TITANITE: VoxelData = {
  composition: { rocks: [{ rockId: 'titanite', coefficient: 1.0 }] },
  density: 1.0,
  oreDensities: {},
  fractureModifier: 1.0,
};

const MIXED_CS: VoxelData = {
  composition: {
    rocks: [
      { rockId: 'cruite', coefficient: 0.7 },
      { rockId: 'sandite', coefficient: 0.3 },
    ],
  },
  density: 1.0,
  oreDensities: { blingite: 0.3 },
  fractureModifier: 1.0,
};

const AIR: VoxelData = {
  composition: { rocks: [] },
  density: 0,
  oreDensities: {},
  fractureModifier: 1.0,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function k(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

/** Fill specified keys with a VoxelData in the grid. */
function fillKeys(grid: VoxelGrid, data: VoxelData, keys: string[]): void {
  for (const key of keys) {
    const [x, y, z] = key.split(',').map(Number);
    grid.setVoxel(x, y, z, data);
  }
}

/** Create a Map of energy for the given keys, each with the same value. */
function uniformEnergy(keys: string[], value: number): Map<string, number> {
  return new Map(keys.map(key => [key, value]));
}

/** Fill a rectangular region of the grid with a given VoxelData. */
function fillRegion(
  grid: VoxelGrid, data: VoxelData,
  x0: number, x1: number, y0: number, y1: number, z0: number, z1: number,
): void {
  for (let z = z0; z <= z1; z++)
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++)
        grid.setVoxel(x, y, z, data);
}

beforeEach(() => {
  // No mutable global state — pure functions only.
});

// ===========================================================================
// § 1 — Pipeline: propagateEnergy -> identifyFragmentedVoxels -> seed cloud
// ===========================================================================

describe('Seed cloud — full pipeline', () => {
  it('single cruite voxel with over-threshold energy -> 3 seed points', () => {
    // T(cruite) = 200. Inject 600. Absorbs 200, overflow 400 to air (no neighbors).
    // F(v) = 3.0 * (200/200) = 3.0  -> fragmentCount = 3
    const grid = new VoxelGrid(5, 5, 5);
    grid.setVoxel(2, 1, 2, CRUITE);

    const prop = propagateEnergy(grid, new Map([[k(2, 1, 2), 600]]));
    const fragmented = identifyFragmentedVoxels(grid, prop);

    expect(fragmented.has(k(2, 1, 2))).toBe(true);
    expect(fragmented.size).toBe(1);

    const cloud = generateSeedPointCloud(fragmented, prop.effectiveEnergy, grid, new Random(42));
    expect(cloud).toHaveLength(3);
    for (const p of cloud) {
      expect(p.x).toBeGreaterThanOrEqual(2);
      expect(p.x).toBeLessThan(3);
      expect(p.y).toBeGreaterThanOrEqual(1);
      expect(p.y).toBeLessThan(2);
      expect(p.z).toBeGreaterThanOrEqual(2);
      expect(p.z).toBeLessThan(3);
    }
  });

  it('three cruite voxels, each at threshold -> 9 points total', () => {
    // 3 voxels: (3,0,3), (4,0,3), (5,0,3). T=200 each, inject 500 each.
    // Each absorbs 200, F=3*200/200=3 -> 3 points each = 9 total
    const grid = new VoxelGrid(10, 5, 10);
    fillKeys(grid, CRUITE, ['3,0,3', '4,0,3', '5,0,3']);

    const prop = propagateEnergy(grid, uniformEnergy(['3,0,3', '4,0,3', '5,0,3'], 500));
    const fragmented = identifyFragmentedVoxels(grid, prop);
    expect(fragmented.size).toBe(3);

    const cloud = generateSeedPointCloud(fragmented, prop.effectiveEnergy, grid, new Random(42));
    expect(cloud).toHaveLength(9);

    // (3,0,3) points in [3,4) x [0,1) x [3,4)
    const g1 = cloud.filter(p => p.x >= 3 && p.x < 4);
    expect(g1).toHaveLength(3);
    for (const p of g1) expect(p.y).toBeGreaterThanOrEqual(0);
    for (const p of g1) expect(p.y).toBeLessThan(1);
  });

  it('hard rock (titanite) below energy threshold -> island-detected + 1 seed from 0-energy', () => {
    // T(titanite) = 4000. Inject 800 (< 4000) -> no fragmentation by energy.
    // The voxel is isolated (surrounded by air in a 5x5x5 grid) ->
    //   flood-fill finds it not connected to boundary -> island-detection
    //   adds it to fragmented set (by design).
    //
    // Since it has NO effectiveEnergy (800 < 4000, nothing absorbed),
    //   fragmentCount = 1 (0 energy -> 1 point).
    // Total: cruite 3 points + titanite 1 point = 4.
    const grid = new VoxelGrid(5, 5, 5);
    grid.setVoxel(2, 0, 2, CRUITE);
    grid.setVoxel(2, 2, 2, TITANITE);
    // (2,1,2) = AIR (default) — no propagation bridge

    const initial = new Map([
      [k(2, 0, 2), 800],
      [k(2, 2, 2), 800],
    ]);
    const prop = propagateEnergy(grid, initial);
    const fragmented = identifyFragmentedVoxels(grid, prop);

    // Cruite fragmented by energy (200 >= 200)
    expect(fragmented.has(k(2, 0, 2))).toBe(true);
    // Titanite NOT fragmented by energy (800 < 4000), but IS fragmented by
    // island detection (isolated solid mass surrounded by air)
    expect(fragmented.has(k(2, 2, 2))).toBe(true);

    // Cruite: energy=200, F=3 -> 3 points
    // Titanite: no effectiveEnergy, fragmentCount(0) -> 1 point
    // Total = 4
    const cloud = generateSeedPointCloud(fragmented, prop.effectiveEnergy, grid, new Random(42));
    expect(cloud).toHaveLength(4);

    // Titanite point in [2,3) x [2,3) x [2,3)
    const tPoints = cloud.filter(p => p.y >= 2);
    expect(tPoints).toHaveLength(1);
    expect(tPoints[0]!.x).toBeGreaterThanOrEqual(2);
    expect(tPoints[0]!.x).toBeLessThan(3);
  });

  it('mixed-rock voxel with threshold=215 produces 3 seeds', () => {
    // T = 0.7*200 + 0.3*250 = 140+75=215
    // Inject 430 -> absorbs 215, F=3*215/215=3 -> 3 points
    const grid = new VoxelGrid(5, 5, 5);
    grid.setVoxel(2, 2, 2, MIXED_CS);

    const prop = propagateEnergy(grid, new Map([[k(2, 2, 2), 430]]));
    const fragmented = identifyFragmentedVoxels(grid, prop);

    expect(fragmented.has(k(2, 2, 2))).toBe(true);
    expect(prop.effectiveEnergy.get(k(2, 2, 2))).toBeCloseTo(215, 8);

    const cloud = generateSeedPointCloud(fragmented, prop.effectiveEnergy, grid, new Random(42));
    expect(cloud).toHaveLength(3);
    for (const p of cloud) {
      expect(p.x).toBeGreaterThanOrEqual(2);
      expect(p.x).toBeLessThan(3);
      expect(p.y).toBeGreaterThanOrEqual(2);
      expect(p.y).toBeLessThan(3);
    }
  });

  it('isolated rock island (no energy, no boundary path) -> 1 seed per voxel', () => {
    // 7x7x7 grid. Fill a 3x3x3 inner cube (1..3, 1..3, 1..3) with CRUITE.
    // Everything else AIR. The inner cube has no path to boundary.
    // No energy injected. identifyFragmentedVoxels island detection finds it.
    // Each voxel: score=0 -> fragmentCount(1) -> 1 point. Total = 27.
    const grid = new VoxelGrid(7, 7, 7);
    fillRegion(grid, CRUITE, 1, 3, 1, 3, 1, 3);

    const prop = propagateEnergy(grid, new Map());
    const fragmented = identifyFragmentedVoxels(grid, prop);

    // All 27 inner voxels fragmented by island detection
    expect(fragmented.size).toBe(27);

    // No energy recorded for any of them
    expect(prop.effectiveEnergy.size).toBe(0);

    const cloud = generateSeedPointCloud(fragmented, prop.effectiveEnergy, grid, new Random(42));
    expect(cloud).toHaveLength(27);

    // All points within the inner cube bounds
    for (const p of cloud) {
      expect(p.x).toBeGreaterThanOrEqual(1);
      expect(p.x).toBeLessThan(4);
      expect(p.y).toBeGreaterThanOrEqual(1);
      expect(p.y).toBeLessThan(4);
      expect(p.z).toBeGreaterThanOrEqual(1);
      expect(p.z).toBeLessThan(4);
    }
  });
});

// ===========================================================================
// § 2 — Edge cases
// ===========================================================================

describe('Seed cloud — edge cases', () => {
  it('all-air grid -> no seeds', () => {
    const grid = new VoxelGrid(10, 10, 10);
    // Inject energy even though grid is all air
    const prop = propagateEnergy(grid, new Map([[k(5, 5, 5), 9999]]));
    const fragmented = identifyFragmentedVoxels(grid, prop);
    expect(fragmented.size).toBe(0);

    const cloud = generateSeedPointCloud(fragmented, prop.effectiveEnergy, grid, new Random(42));
    expect(cloud).toHaveLength(0);
  });

  it('energy below fragmentation threshold -> no seeds', () => {
    // Cruite T=200, inject 199 (< 200) -> not fragmented
    const grid = new VoxelGrid(5, 5, 5);
    grid.setVoxel(2, 0, 2, CRUITE);

    const prop = propagateEnergy(grid, new Map([[k(2, 0, 2), 199]]));
    const fragmented = identifyFragmentedVoxels(grid, prop);
    expect(fragmented.has(k(2, 0, 2))).toBe(false);

    const cloud = generateSeedPointCloud(fragmented, prop.effectiveEnergy, grid, new Random(42));
    expect(cloud).toHaveLength(0);
  });

  it('no initial energy -> empty result', () => {
    const grid = new VoxelGrid(5, 5, 5);
    grid.setVoxel(2, 0, 2, CRUITE);

    const prop = propagateEnergy(grid, new Map());
    const fragmented = identifyFragmentedVoxels(grid, prop);
    expect(fragmented.size).toBe(0);

    const cloud = generateSeedPointCloud(fragmented, prop.effectiveEnergy, grid, new Random(42));
    expect(cloud).toHaveLength(0);
  });

  it('deterministic: same grid + same energy + same seed -> same cloud length', () => {
    const run = (): number => {
      const grid = new VoxelGrid(5, 5, 5);
      grid.setVoxel(2, 0, 2, CRUITE);
      grid.setVoxel(2, 1, 2, CRUITE);
      const prop = propagateEnergy(grid, uniformEnergy(['2,0,2', '2,1,2'], 500));
      const frag = identifyFragmentedVoxels(grid, prop);
      return generateSeedPointCloud(frag, prop.effectiveEnergy, grid, new Random(42)).length;
    };
    expect(run()).toBe(run());
  });

  it('different seeds produce different point coordinates', () => {
    const runSeed = (seed: number): string[] => {
      const grid = new VoxelGrid(5, 5, 5);
      grid.setVoxel(2, 0, 2, CRUITE);
      const prop = propagateEnergy(grid, new Map([[k(2, 0, 2), 500]]));
      const frag = identifyFragmentedVoxels(grid, prop);
      return generateSeedPointCloud(frag, prop.effectiveEnergy, grid, new Random(seed))
        .map(p => `${p.x.toFixed(6)},${p.y.toFixed(6)},${p.z.toFixed(6)}`);
    };

    const a = runSeed(42);
    const b = runSeed(99);
    expect(a).toHaveLength(b.length);
    const allSame = a.every((s, i) => s === b[i]);
    expect(allSame).toBe(false);
  });
});

// ===========================================================================
// § 3 — Invariants
// ===========================================================================

describe('Seed cloud — invariants', () => {
  it('every seed point lies within its source voxel unit cube', () => {
    const grid = new VoxelGrid(8, 8, 8);
    fillKeys(grid, CRUITE, ['2,1,3', '4,2,5', '6,3,1']);

    const prop = propagateEnergy(
      grid,
      uniformEnergy(['2,1,3', '4,2,5', '6,3,1'], 500),
    );
    const frag = identifyFragmentedVoxels(grid, prop);
    const cloud = generateSeedPointCloud(frag, prop.effectiveEnergy, grid, new Random(42));

    for (const p of cloud) {
      const vx = Math.floor(p.x);
      const vy = Math.floor(p.y);
      const vz = Math.floor(p.z);
      expect(frag.has(k(vx, vy, vz))).toBe(true);
      expect(p.x).toBeGreaterThanOrEqual(vx);
      expect(p.x).toBeLessThan(vx + 1);
      expect(p.y).toBeGreaterThanOrEqual(vy);
      expect(p.y).toBeLessThan(vy + 1);
      expect(p.z).toBeGreaterThanOrEqual(vz);
      expect(p.z).toBeLessThan(vz + 1);
    }
  });

  it('no duplicate coordinates in the point cloud', () => {
    const grid = new VoxelGrid(8, 5, 8);
    fillRegion(grid, CRUITE, 2, 5, 0, 0, 2, 5); // 4x4 surface

    const keys: string[] = [];
    for (let x = 2; x <= 5; x++)
      for (let z = 2; z <= 5; z++)
        keys.push(k(x, 0, z));

    const prop = propagateEnergy(grid, uniformEnergy(keys, 500));
    const frag = identifyFragmentedVoxels(grid, prop);
    const cloud = generateSeedPointCloud(frag, prop.effectiveEnergy, grid, new Random(42));

    const seen = new Set<string>();
    for (const p of cloud) {
      const s = `${p.x.toFixed(12)},${p.y.toFixed(12)},${p.z.toFixed(12)}`;
      expect(seen.has(s)).toBe(false);
      seen.add(s);
    }
  });

  it('all coordinates are finite numbers', () => {
    const grid = new VoxelGrid(5, 5, 5);
    grid.setVoxel(2, 0, 2, CRUITE);

    const prop = propagateEnergy(grid, new Map([[k(2, 0, 2), 500]]));
    const frag = identifyFragmentedVoxels(grid, prop);
    const cloud = generateSeedPointCloud(frag, prop.effectiveEnergy, grid, new Random(42));

    for (const p of cloud) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
      expect(Number.isFinite(p.z)).toBe(true);
    }
  });
});
