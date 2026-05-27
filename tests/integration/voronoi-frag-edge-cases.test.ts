// Integration tests: Voronoi seed cloud — edge cases not covered elsewhere
// Task 5.8 — computeFragmentationScore + Voronoi seed sampling
//
// These tests exercise the REAL blast pipeline with edge cases from the
// acceptance criteria: zero-coefficient rock, missing energy map entries,
// out-of-bounds keys, negative coordinates, density=0 with rock composition,
// non-adjacent scattered voxels, boundary injection, converging energy paths,
// and score rounding boundaries.
//
// Each test: propagateEnergy -> identifyFragmentedVoxels -> generateSeedPointCloud

import { describe, it, expect, beforeEach } from 'vitest';
import { VoxelGrid, type VoxelData } from '../../src/core/world/VoxelGrid.js';
import { propagateEnergy, identifyFragmentedVoxels } from '../../src/core/mining/BlastCalc.js';
import { generateSeedPointCloud } from '../../src/physics/VoronoiFrag.js';
import { Random } from '../../src/core/math/Random.js';
import { getRock } from '../../src/core/world/RockCatalog.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CRUITE: VoxelData = {
  composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
  density: 1.0, oreDensities: {}, fractureModifier: 1.0,
};

const AIR: VoxelData = {
  composition: { rocks: [] },
  density: 0, oreDensities: {}, fractureModifier: 1.0,
};

/** Zero-coefficient rock — computeThreshold returns 0. */
const ZERO_COEFF_ROCK: VoxelData = {
  composition: { rocks: [{ rockId: 'cruite', coefficient: 0 }] },
  density: 1.0, oreDensities: {}, fractureModifier: 1.0,
};

/** Mixed composition where one rock has zero coefficient. */
const MIXED_ZERO_COEFF: VoxelData = {
  composition: {
    rocks: [
      { rockId: 'cruite', coefficient: 0.0 },
      { rockId: 'sandite', coefficient: 1.0 },
    ],
  },
  density: 1.0, oreDensities: {}, fractureModifier: 1.0,
};

/** Density=0 but with rock composition — effectively air. */
const DENSE_AIR: VoxelData = {
  composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
  density: 0, oreDensities: {}, fractureModifier: 1.0,
};

/** Rock with ore but no rock composition. */
const ORE_ONLY: VoxelData = {
  composition: { rocks: [] },
  density: 1.0, oreDensities: { blingite: 0.5 }, fractureModifier: 1.0,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function k(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

function fillKeys(grid: VoxelGrid, data: VoxelData, keys: string[]): void {
  for (const key of keys) {
    const [x, y, z] = key.split(',').map(Number);
    grid.setVoxel(x, y, z, data);
  }
}

function fillRegion(
  grid: VoxelGrid, data: VoxelData,
  x0: number, x1: number, y0: number, y1: number, z0: number, z1: number,
): void {
  for (let z = z0; z <= z1; z++)
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++)
        grid.setVoxel(x, y, z, data);
}

const CRUITE_T = getRock('cruite')!.energyAbsorption;   // 200
const SANDITE_T = getRock('sandite')!.energyAbsorption;  // 250

// ===========================================================================
// § 1 — Zero rock coefficients (threshold = 0)
// ===========================================================================

describe('Seed cloud — zero rock coefficients', () => {
  it('zero-coefficient rock with energy -> no fragmentation (threshold=0)', () => {
    // computeThreshold returns 0 (all coefficients 0).
    // propagateEnergy: threshold=0 means absorbed=0, all energy overflows.
    // The voxel is NOT fragmented by energy (threshold=0, FRAGMENTATION_MULTIPLIER * 0 = 0,
    //   effectiveEnergy=0, 0 >= 0 → yes, voxel IS fragmented by energy.
    // BUT: the voxel is surrounded by air, so it's an island.
    // generateSeedPointCloud: score = 3 * 0 / 0. But threshold=0 causes computeThreshold to return 0,
    //   BUT note in computeFragmentationScore, if threshold <= 0, returns 0.
    //   So score=0, fragmentCount=1.
    // This tests threshold=0 guard in computeFragmentationScore.
    const grid = new VoxelGrid(3, 3, 3);
    grid.setVoxel(1, 1, 1, ZERO_COEFF_ROCK);

    const prop = propagateEnergy(grid, new Map([[k(1, 1, 1), 500]]));
    const fragmented = identifyFragmentedVoxels(grid, prop);

    // threshold=0, so effectiveEnergy is 0 (all absorbed=0, all overflowed to air neighbors which are ignored)
    // The voxel is still solid and surrounded by air → island detected
    expect(fragmented.has(k(1, 1, 1))).toBe(true);

    const cloud = generateSeedPointCloud(fragmented, prop.effectiveEnergy, grid, new Random(42));
    // score=0, fragmentCount=0 → max(1,0) = 1
    expect(cloud).toHaveLength(1);
    expect(cloud[0]!.x).toBeGreaterThanOrEqual(1);
    expect(cloud[0]!.x).toBeLessThan(2);
  });

  it('mixed rock with zero-coefficient entry -> threshold uses non-zero coefficients only', () => {
    // MIXED_ZERO_COEFF: cruite(0.0) + sandite(1.0) → T = 0*200 + 1*250 = 250
    const grid = new VoxelGrid(3, 3, 3);
    grid.setVoxel(1, 1, 1, MIXED_ZERO_COEFF);

    const prop = propagateEnergy(grid, new Map([[k(1, 1, 1), 500]]));
    const fragmented = identifyFragmentedVoxels(grid, prop);

    expect(fragmented.has(k(1, 1, 1))).toBe(true);

    const cloud = generateSeedPointCloud(fragmented, prop.effectiveEnergy, grid, new Random(42));
    // effectiveEnergy=250, T=250, score=3*250/250=3, count=3
    expect(cloud).toHaveLength(3);
  });

  it('all-zero-coefficient rock with very large energy -> still 1 seed (threshold = 0)', () => {
    const grid = new VoxelGrid(3, 3, 3);
    grid.setVoxel(1, 1, 1, ZERO_COEFF_ROCK);

    const prop = propagateEnergy(grid, new Map([[k(1, 1, 1), 1e9]]));
    const fragmented = identifyFragmentedVoxels(grid, prop);

    expect(fragmented.has(k(1, 1, 1))).toBe(true);

    const cloud = generateSeedPointCloud(fragmented, prop.effectiveEnergy, grid, new Random(42));
    // score=0 (threshold=0), fragmentCount = 1
    expect(cloud).toHaveLength(1);
  });
});

// ===========================================================================
// § 2 — Missing effectiveEnergy map entries
// ===========================================================================

describe('Seed cloud — missing effectiveEnergy entries', () => {
  it('fragmented voxel with no effectiveEnergy entry -> 1 seed (treated as 0 energy)', () => {
    // 3 cruite voxels. Inject energy at centre only. Island detection adds
    // all 3 (interior). But only the injection voxel gets an effectiveEnergy entry.
    // The other two are missing from the map → treated as 0 energy → 1 seed each.
    const grid = new VoxelGrid(3, 3, 3);
    // Place cruite at (0,0,0), (1,0,0), (2,0,0) — all interior, no boundary contact
    fillKeys(grid, CRUITE, ['0,0,0', '1,0,0', '2,0,0']);
    // Cruite at (0,1,0) to bridge (0,0,0) to boundary? No, this is interior still.
    // Let's use a 5x5x5 grid and place 3 isolated cruite voxels
    const grid2 = new VoxelGrid(5, 5, 5);
    grid2.setVoxel(1, 1, 1, CRUITE);
    grid2.setVoxel(3, 1, 1, CRUITE);  // separated by air at x=2

    // Inject energy at (1,1,1) only
    const prop = propagateEnergy(grid2, new Map([[k(1, 1, 1), CRUITE_T]]));
    const fragmented = identifyFragmentedVoxels(grid2, prop);

    // (1,1,1): energy-fragmented (has effectiveEnergy entry)
    expect(fragmented.has(k(1, 1, 1))).toBe(true);
    // (3,1,1): island-detected (no energy path) — no effectiveEnergy entry
    expect(fragmented.has(k(3, 1, 1))).toBe(true);

    // (1,1,1): effectiveEnergy=200 → score=3 → 3 seeds
    // (3,1,1): missing from effectiveEnergy → treated as 0 → 1 seed
    const cloud = generateSeedPointCloud(fragmented, prop.effectiveEnergy, grid2, new Random(42));
    expect(cloud).toHaveLength(4);

    // Verify (3,1,1) contributes exactly 1 seed
    const voxel2Seeds = cloud.filter(p =>
      Math.floor(p.x) === 3 && Math.floor(p.y) === 1 && Math.floor(p.z) === 1,
    );
    expect(voxel2Seeds).toHaveLength(1);
  });

  it('all fragmented voxels missing from effectiveEnergy -> 1 seed each', () => {
    const grid = new VoxelGrid(5, 5, 5);
    // 3 isolated cruite voxels
    grid.setVoxel(1, 1, 1, CRUITE);
    grid.setVoxel(1, 2, 1, CRUITE);
    grid.setVoxel(1, 3, 1, CRUITE);

    // No energy injected — all are island-detected
    const prop = propagateEnergy(grid, new Map());
    const fragmented = identifyFragmentedVoxels(grid, prop);

    expect(fragmented.size).toBe(3);

    const cloud = generateSeedPointCloud(fragmented, prop.effectiveEnergy, grid, new Random(42));
    // All 3 voxels: missing effectiveEnergy → 0 energy → fragmentCount(0)=1
    expect(cloud).toHaveLength(3);
  });
});

// ===========================================================================
// § 3 — Out-of-bounds and malformed keys
// ===========================================================================

describe('Seed cloud — out-of-bounds and malformed keys', () => {
  it('fragmented key out of grid bounds -> silently skipped', () => {
    // VoxelGrid size=5, but fragmented set contains key "99,99,99"
    // getVoxel returns undefined → skipped
    const grid = new VoxelGrid(5, 5, 5);
    grid.setVoxel(2, 2, 2, CRUITE);

    const prop = propagateEnergy(grid, new Map([[k(2, 2, 2), CRUITE_T]]));
    const fragmented = identifyFragmentedVoxels(grid, prop);

    // Add an OOB key manually
    const modifiedFrag = new Set(fragmented);
    modifiedFrag.add('99,99,99');

    const cloud = generateSeedPointCloud(modifiedFrag, prop.effectiveEnergy, grid, new Random(42));
    // The OOB key is skipped. Only the real fragmented voxels contribute.
    expect(cloud.length).toBeGreaterThanOrEqual(3);
  });

  it('malformed key (missing coords) -> silently skipped', () => {
    const grid = new VoxelGrid(3, 3, 3);
    grid.setVoxel(1, 1, 1, CRUITE);
    const prop = propagateEnergy(grid, new Map([[k(1, 1, 1), CRUITE_T]]));
    const fragmented = identifyFragmentedVoxels(grid, prop);

    const modifiedFrag = new Set(fragmented);
    modifiedFrag.add('bad-key');         // no commas
    modifiedFrag.add('1,2');             // only 2 parts
    modifiedFrag.add('');                // empty string
    modifiedFrag.add('1.5,2.5,3.5');     // non-integer (floats as key)

    const cloud = generateSeedPointCloud(modifiedFrag, prop.effectiveEnergy, grid, new Random(42));
    // Only valid fragmented voxels contribute
    expect(cloud.length).toBeGreaterThanOrEqual(3);
    expect(cloud.length).toBeLessThanOrEqual(10);
  });

  it('fragmented key with non-finite numbers -> silently skipped', () => {
    const grid = new VoxelGrid(3, 3, 3);
    grid.setVoxel(1, 1, 1, CRUITE);
    const prop = propagateEnergy(grid, new Map([[k(1, 1, 1), CRUITE_T]]));
    const fragmented = identifyFragmentedVoxels(grid, prop);

    const modifiedFrag = new Set(fragmented);
    modifiedFrag.add('NaN,0,0');
    modifiedFrag.add('Infinity,0,0');
    modifiedFrag.add('-Infinity,0,0');

    const cloud = generateSeedPointCloud(modifiedFrag, prop.effectiveEnergy, grid, new Random(42));
    expect(cloud.length).toBeGreaterThanOrEqual(3);
  });
});

// ===========================================================================
// § 4 — Negative coordinates
// ===========================================================================

describe('Seed cloud — negative coordinates', () => {
  it('negative voxel coordinates produce seeds in negative range', () => {
    // VoxelGrid with negative coords: place cruite at (-2,-1,-3)
    const grid = new VoxelGrid(3, 3, 3);
    // Use offset mapping — VoxelGrid uses 0-based indices; we need to
    // check that the seed points have correct negative coordinates
    // when the fragmented set contains negative keys.
    // This test verifies generateSeedPointCloud handles negative coords
    // by manually injecting the fragmented key.
    const gridMock = {
      getVoxel(x: number, y: number, z: number): VoxelData | undefined {
        // Return CRUITE for the negative-coordinate position we care about
        if (x === -2 && y === -1 && z === -3) return CRUITE;
        return undefined;
      },
    };

    const fragmented = new Set<string>(['-2,-1,-3']);
    const energy = new Map<string, number>([['-2,-1,-3', CRUITE_T]]);
    const cloud = generateSeedPointCloud(fragmented, energy, gridMock, new Random(42));

    // T(cruite)=200, energy=200 → score=3 → 3 seeds
    expect(cloud).toHaveLength(3);
    for (const p of cloud) {
      expect(p.x).toBeGreaterThanOrEqual(-2);
      expect(p.x).toBeLessThan(-1);
      expect(p.y).toBeGreaterThanOrEqual(-1);
      expect(p.y).toBeLessThan(0);
      expect(p.z).toBeGreaterThanOrEqual(-3);
      expect(p.z).toBeLessThan(-2);
    }
  });

  it('mixed negative and positive coordinates produce correct ranges', () => {
    // Two voxels: (-1,-1,-1) and (2,2,2)
    const gridMock = {
      getVoxel(x: number, y: number, z: number): VoxelData | undefined {
        if ((x === -1 && y === -1 && z === -1) || (x === 2 && y === 2 && z === 2)) return CRUITE;
        return undefined;
      },
    };

    const fragmented = new Set<string>(['-1,-1,-1', '2,2,2']);
    const energy = new Map<string, number>([
      ['-1,-1,-1', CRUITE_T],
      ['2,2,2', CRUITE_T],
    ]);
    const cloud = generateSeedPointCloud(fragmented, energy, gridMock, new Random(42));

    expect(cloud).toHaveLength(6); // 3 + 3

    const negPoints = cloud.filter(p => p.x < 0);
    const posPoints = cloud.filter(p => p.x >= 0);
    expect(negPoints).toHaveLength(3);
    expect(posPoints).toHaveLength(3);

    for (const p of negPoints) {
      expect(p.x).toBeGreaterThanOrEqual(-1);
      expect(p.x).toBeLessThan(0);
      expect(p.y).toBeGreaterThanOrEqual(-1);
      expect(p.y).toBeLessThan(0);
      expect(p.z).toBeGreaterThanOrEqual(-1);
      expect(p.z).toBeLessThan(0);
    }
  });
});

// ===========================================================================
// § 5 — Density = 0 with rock composition (effectively air)
// ===========================================================================

describe('Seed cloud — density=0 with rock composition', () => {
  it('voxel with density=0 but rock composition -> treated as air (0 seeds)', () => {
    // DENSE_AIR: density=0, composition has cruite.
    // computeFragmentationScore returns 0 because density <= 0.
    // identifyFragmentedVoxels: isAirVoxel checks density <= 0 → treats as air → not fragmented.
    const grid = new VoxelGrid(3, 3, 3);
    grid.setVoxel(1, 1, 1, DENSE_AIR);

    const prop = propagateEnergy(grid, new Map([[k(1, 1, 1), CRUITE_T]]));
    const fragmented = identifyFragmentedVoxels(grid, prop);

    // Density=0 → treated as air → NOT fragmented
    expect(fragmented.has(k(1, 1, 1))).toBe(false);
    expect(fragmented.size).toBe(0);

    const cloud = generateSeedPointCloud(fragmented, prop.effectiveEnergy, grid, new Random(42));
    expect(cloud).toHaveLength(0);
  });

  it('ore-only voxel (no rock composition) with density=1 -> treated as air (0 seeds)', () => {
    // ORE_ONLY: empty rock composition, density=1, has ore.
    // computeFragmentationScore: rocks.length === 0 → returns 0.
    // identifyFragmentedVoxels: isAirVoxel checks density <= 0 → false (density=1)
    //   AND composition.rocks.length === 0 → true → treated as air.
    const grid = new VoxelGrid(3, 3, 3);
    grid.setVoxel(1, 1, 1, ORE_ONLY);

    const prop = propagateEnergy(grid, new Map([[k(1, 1, 1), CRUITE_T]]));
    const fragmented = identifyFragmentedVoxels(grid, prop);

    // Empty rock composition → treated as air → NOT fragmented
    expect(fragmented.has(k(1, 1, 1))).toBe(false);
    expect(fragmented.size).toBe(0);

    const cloud = generateSeedPointCloud(fragmented, prop.effectiveEnergy, grid, new Random(42));
    expect(cloud).toHaveLength(0);
  });
});

// ===========================================================================
// § 6 — Non-adjacent scattered voxels
// ===========================================================================

describe('Seed cloud — non-adjacent scattered voxels', () => {
  it('three isolated voxels with no adjacency -> all island-detected, 1 seed each', () => {
    // 7x7x7 grid with cruite at (1,1,1), (5,1,1), (1,5,1) — all interior,
    // separated by air, no path to boundary.
    const grid = new VoxelGrid(7, 7, 7);
    grid.setVoxel(1, 1, 1, CRUITE);
    grid.setVoxel(5, 1, 1, CRUITE);
    grid.setVoxel(1, 5, 1, CRUITE);

    // No energy
    const prop = propagateEnergy(grid, new Map());
    const fragmented = identifyFragmentedVoxels(grid, prop);

    expect(fragmented.size).toBe(3);
    expect(fragmented.has(k(1, 1, 1))).toBe(true);
    expect(fragmented.has(k(5, 1, 1))).toBe(true);
    expect(fragmented.has(k(1, 5, 1))).toBe(true);

    const cloud = generateSeedPointCloud(fragmented, prop.effectiveEnergy, grid, new Random(42));
    // 3 voxels, each missing effectiveEnergy → 1 seed each
    expect(cloud).toHaveLength(3);

    // Each voxel has exactly 1 seed in its unit cube
    const s1 = cloud.filter(p => Math.floor(p.x) === 1 && Math.floor(p.y) === 1 && Math.floor(p.z) === 1);
    const s2 = cloud.filter(p => Math.floor(p.x) === 5 && Math.floor(p.y) === 1 && Math.floor(p.z) === 1);
    const s3 = cloud.filter(p => Math.floor(p.x) === 1 && Math.floor(p.y) === 5 && Math.floor(p.z) === 1);
    expect(s1).toHaveLength(1);
    expect(s2).toHaveLength(1);
    expect(s3).toHaveLength(1);
  });

  it('scattered voxels some with energy some without -> correct seed count per voxel', () => {
    const grid = new VoxelGrid(7, 7, 7);
    grid.setVoxel(2, 2, 2, CRUITE);    // will have energy
    grid.setVoxel(5, 2, 2, CRUITE);    // no energy path → island
    grid.setVoxel(2, 5, 2, CRUITE);    // no energy path → island

    const prop = propagateEnergy(grid, new Map([[k(2, 2, 2), CRUITE_T * 2]]));
    const fragmented = identifyFragmentedVoxels(grid, prop);

    expect(fragmented.size).toBe(3);

    const cloud = generateSeedPointCloud(fragmented, prop.effectiveEnergy, grid, new Random(42));
    // (2,2,2): effectiveEnergy=200, score=3, count=3
    // (5,2,2): no effectiveEnergy → 1 seed
    // (2,5,2): no effectiveEnergy → 1 seed
    // Total: 5
    expect(cloud).toHaveLength(5);

    const e1 = cloud.filter(p => Math.floor(p.x) === 2 && Math.floor(p.y) === 2 && Math.floor(p.z) === 2);
    const e2 = cloud.filter(p => Math.floor(p.x) === 5 && Math.floor(p.y) === 2 && Math.floor(p.z) === 2);
    const e3 = cloud.filter(p => Math.floor(p.x) === 2 && Math.floor(p.y) === 5 && Math.floor(p.z) === 2);
    expect(e1).toHaveLength(3);
    expect(e2).toHaveLength(1);
    expect(e3).toHaveLength(1);
  });
});

// ===========================================================================
// § 7 — Boundary voxels and converging energy paths
// ===========================================================================

describe('Seed cloud — boundary and converging paths', () => {
  it('energy injection at grid boundary voxel -> voxel fragments', () => {
    // 3x3x3 grid. Cruite at (0,0,0) — on the x=0 boundary.
    // The voxel IS boundary-connected, but also energy-fragmented.
    const grid = new VoxelGrid(3, 3, 3);
    grid.setVoxel(0, 0, 0, CRUITE);

    const prop = propagateEnergy(grid, new Map([[k(0, 0, 0), CRUITE_T]]));
    const fragmented = identifyFragmentedVoxels(grid, prop);

    // (0,0,0) is on the x=0 boundary, so it's reachable by BFS.
    // It IS fragmented by energy (energy >= threshold).
    expect(fragmented.has(k(0, 0, 0))).toBe(true);

    const cloud = generateSeedPointCloud(fragmented, prop.effectiveEnergy, grid, new Random(42));
    // effectiveEnergy=200, score=3, count=3
    expect(cloud).toHaveLength(3);
    for (const p of cloud) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThan(1);
    }
  });

  it('energy converges from two sources into the same voxel', () => {
    // Two separate energy sources whose overflow converges on a shared middle voxel.
    // Layout (top-down view, y=0):
    //   (0,0,0) = cruite (source 1)
    //   (1,0,0) = cruite (shared middle)
    //   (2,0,0) = cruite (source 2)
    // Inject at (0,0,0) and (2,0,0). Both propagate to (1,0,0).
    const grid = new VoxelGrid(3, 1, 1);
    fillKeys(grid, CRUITE, ['0,0,0', '1,0,0', '2,0,0']);

    // Inject massive energy at both ends. The middle voxel gets energy from
    // both sides (converging overflow). But effectiveEnergy is capped at T(v)=200
    // per voxel; overflow passes through.
    const initial = new Map([
      [k(0, 0, 0), CRUITE_T * 3],
      [k(2, 0, 0), CRUITE_T * 3],
    ]);
    const prop = propagateEnergy(grid, initial);
    const fragmented = identifyFragmentedVoxels(grid, prop);

    // All 3 voxels fragmented
    expect(fragmented.size).toBe(3);

    const cloud = generateSeedPointCloud(fragmented, prop.effectiveEnergy, grid, new Random(42));
    // Each voxel: effectiveEnergy = T = 200, score = 3, count = 3
    // Total = 9
    expect(cloud).toHaveLength(9);

    // 3 seeds per voxel
    const x0 = cloud.filter(p => Math.floor(p.x) === 0);
    const x1 = cloud.filter(p => Math.floor(p.x) === 1);
    const x2 = cloud.filter(p => Math.floor(p.x) === 2);
    expect(x0).toHaveLength(3);
    expect(x1).toHaveLength(3);
    expect(x2).toHaveLength(3);
  });

  it('three-way energy convergence at central voxel', () => {
    // Cross formation: centre (0,0,0) with arms in ±x and ±z.
    // Inject at three arm endpoints, converge at centre.
    // Grid: 3x1x3, fill all with cruite.
    const grid = new VoxelGrid(3, 1, 3);
    fillRegion(grid, CRUITE, 0, 2, 0, 0, 0, 2);

    // Inject at (0,0,0), (2,0,0), (1,0,2) — three of the four arms
    const initial = new Map([
      [k(0, 0, 0), CRUITE_T * 3],
      [k(2, 0, 0), CRUITE_T * 3],
      [k(1, 0, 2), CRUITE_T * 3],
    ]);
    const prop = propagateEnergy(grid, initial);
    const fragmented = identifyFragmentedVoxels(grid, prop);

    // At minimum centre (1,0,1) is fragmented
    expect(fragmented.has(k(1, 0, 1))).toBe(true);

    const cloud = generateSeedPointCloud(fragmented, prop.effectiveEnergy, grid, new Random(42));
    // All fragmented voxels have their seeds
    expect(cloud.length).toBeGreaterThanOrEqual(fragmented.size);

    // Centre has at least 1 seed
    const centre = cloud.filter(p => Math.floor(p.x) === 1 && Math.floor(p.y) === 0 && Math.floor(p.z) === 1);
    expect(centre.length).toBeGreaterThanOrEqual(1);

    // All points are valid
    for (const p of cloud) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
      expect(Number.isFinite(p.z)).toBe(true);
    }
  });
});

// ===========================================================================
// § 8 — Score rounding boundary
// ===========================================================================

describe('Seed cloud — score rounding boundary', () => {
  it('score = 1.499 (rounds to 1) vs score = 1.5 (rounds to 2) through pipeline', () => {
    // For cruite (T=200):
    //   energy = 100 → F = 3*100/200 = 1.5 → round(1.5) = 2
    //   But effectiveEnergy capped at 100 for 100 initial energy
    // Actually we need a different approach to get exact F values:
    //   F = 3 * E / 200
    //   F = 1.499 → E = 1.499 * 200 / 3 = 99.9333...
    //   F = 1.5   → E = 1.5 * 200 / 3 = 100
    //
    // With initial energy 99.933, propagateEnergy absorbs min(99.933, 200-0) = 99.933
    // effectiveEnergy = 99.933
    // F = 3 * 99.933 / 200 = 1.499
    // round(1.499) = 1 → max(1, 1) = 1
    //
    // With initial energy 100, effectiveEnergy = 100
    // F = 3 * 100 / 200 = 1.5
    // round(1.5) = 2 → max(1, 2) = 2
    const gridLow = new VoxelGrid(3, 3, 3);
    gridLow.setVoxel(1, 1, 1, CRUITE);
    const energyLow = (1.499 * CRUITE_T) / 3; // ≈ 99.933
    const propLow = propagateEnergy(gridLow, new Map([[k(1, 1, 1), energyLow]]));
    const fragLow = identifyFragmentedVoxels(gridLow, propLow);
    expect(fragLow.has(k(1, 1, 1))).toBe(true);

    const cloudLow = generateSeedPointCloud(fragLow, propLow.effectiveEnergy, gridLow, new Random(42));
    // round(1.499) = 1 → 1 seed
    expect(cloudLow).toHaveLength(1);

    // Now the higher energy case
    const gridHigh = new VoxelGrid(3, 3, 3);
    gridHigh.setVoxel(1, 1, 1, CRUITE);
    const energyHigh = CRUITE_T; // exactly 200 → F=3.0 → round(3)=3
    // That gives F=3 not F=1.5. Let's use energy = 100 → F=1.5
    // Actually 3*100/200 = 1.5, round(1.5)=2
    const propHigh = propagateEnergy(gridHigh, new Map([[k(1, 1, 1), 100]]));
    const fragHigh = identifyFragmentedVoxels(gridHigh, propHigh);
    // 100 < 200 → not energy-fragmented! It's island-detected instead.
    // effectiveEnergy = 100 but threshold=200, so not energy-fragmented.
    // However it's an interior island → still fragmented.
    // And score = 3*100/200 = 1.5 → round(1.5)=2 → 2 seeds
    expect(fragHigh.has(k(1, 1, 1))).toBe(true);

    const cloudHigh = generateSeedPointCloud(fragHigh, propHigh.effectiveEnergy, gridHigh, new Random(42));
    // effectiveEnergy=100, F=1.5, round(1.5)=2
    expect(cloudHigh).toHaveLength(2);
  });

  it('score = 0.49 (rounds to 0, clamped to 1) vs score = 0.5 (rounds to 1)', () => {
    // F = 3 * E / 200
    // F = 0.49 → E = 0.49 * 200 / 3 = 32.666...
    // F = 0.5  → E = 0.5 * 200 / 3 = 33.333...
    //
    // But 32.666 and 33.333 are both < 200, so both are island-detected.
    const gridLow = new VoxelGrid(3, 3, 3);
    const gridHigh = new VoxelGrid(3, 3, 3);

    const energyLow2 = (0.49 * CRUITE_T) / 3;  // ≈ 32.667
    const energyHigh2 = (0.5 * CRUITE_T) / 3;   // ≈ 33.333

    gridLow.setVoxel(1, 1, 1, CRUITE);
    const propL = propagateEnergy(gridLow, new Map([[k(1, 1, 1), energyLow2]]));
    const fragL = identifyFragmentedVoxels(gridLow, propL);
    expect(fragL.has(k(1, 1, 1))).toBe(true);
    const cloudL = generateSeedPointCloud(fragL, propL.effectiveEnergy, gridLow, new Random(42));
    // F=0.49, round(0.49)=0, max(1,0)=1
    expect(cloudL).toHaveLength(1);

    gridHigh.setVoxel(1, 1, 1, CRUITE);
    const propH = propagateEnergy(gridHigh, new Map([[k(1, 1, 1), energyHigh2]]));
    const fragH = identifyFragmentedVoxels(gridHigh, propH);
    expect(fragH.has(k(1, 1, 1))).toBe(true);
    const cloudH = generateSeedPointCloud(fragH, propH.effectiveEnergy, gridHigh, new Random(42));
    // F=0.5, round(0.5)=1, max(1,1)=1
    expect(cloudH).toHaveLength(1);
  });
});

// ===========================================================================
// § 9 — VoxelGrid getVoxel returns undefined for keys not in bounds
// ===========================================================================

describe('Seed cloud — undefined grid lookups', () => {
  it('fragmented key where grid.getVoxel returns undefined -> skipped silently', () => {
    // Use a 3x3x3 grid but put an OOB coordinate in the fragmented set.
    // The real fragmented set won't have OOB, but we can add one.
    const grid = new VoxelGrid(3, 3, 3);
    grid.setVoxel(1, 1, 1, CRUITE);
    const prop = propagateEnergy(grid, new Map([[k(1, 1, 1), CRUITE_T]]));
    const fragmented = identifyFragmentedVoxels(grid, prop);

    // Add an OOB key where getVoxel returns undefined
    const modifiedFrag = new Set(fragmented);
    modifiedFrag.add('-1,-1,-1');   // negative, outside bounds
    modifiedFrag.add('10,10,10');   // outside bounds

    const cloud = generateSeedPointCloud(modifiedFrag, prop.effectiveEnergy, grid, new Random(42));
    // Only (1,1,1) contributes: 3 seeds
    expect(cloud).toHaveLength(3);
    for (const p of cloud) {
      expect(Math.floor(p.x)).toBe(1);
      expect(Math.floor(p.y)).toBe(1);
      expect(Math.floor(p.z)).toBe(1);
    }
  });
});

// ===========================================================================
// § 10 — Empty fragmented set invariants
// ===========================================================================

describe('Seed cloud — empty fragmented set', () => {
  it('empty fragmentedVoxels set with non-empty effectiveEnergy -> empty cloud', () => {
    const grid = new VoxelGrid(3, 3, 3);
    // Inject energy but no rock → nothing fragmented
    const prop = propagateEnergy(grid, new Map([[k(1, 1, 1), CRUITE_T * 5]]));
    const fragmented = identifyFragmentedVoxels(grid, prop);
    expect(fragmented.size).toBe(0);

    const cloud = generateSeedPointCloud(fragmented, prop.effectiveEnergy, grid, new Random(42));
    expect(cloud).toHaveLength(0);
  });

  it('non-empty effectiveEnergy but no fragmented voxels -> empty cloud', () => {
    // This can happen if energy was applied but threshold never reached.
    // Example: Titanite with insufficient energy, boundary-connected.
    const grid = new VoxelGrid(3, 3, 3);
    const titanite: VoxelData = {
      composition: { rocks: [{ rockId: 'titanite', coefficient: 1.0 }] },
      density: 1.0, oreDensities: {}, fractureModifier: 1.0,
    };
    // (0,0,0) is on x=0 boundary → boundary-connected → NOT island.
    // Inject 100 energy, T(titanite)=4000, 100 < 4000 → NOT energy-fragmented.
    grid.setVoxel(0, 0, 0, titanite);

    const prop = propagateEnergy(grid, new Map([[k(0, 0, 0), 100]]));
    const fragmented = identifyFragmentedVoxels(grid, prop);
    expect(fragmented.size).toBe(0);

    const cloud = generateSeedPointCloud(fragmented, prop.effectiveEnergy, grid, new Random(42));
    expect(cloud).toHaveLength(0);
  });
});
