// Integration tests: Voronoi seed cloud pipeline — extended edge cases
// Task 5.8 — computeFragmentationScore + Voronoi seed sampling
//
// These tests exercise the REAL blast pipeline data flow with scenarios not
// covered by the basic integration test suite:
//   propagateEnergy → identifyFragmentedVoxels → generateSeedPointCloud
//
// Unlike unit tests (which test isolated VoronoiFrag functions in a pure
// environment), integration tests verify the complete chain with real
// rock definitions, real energy propagation, and real island flood-fill.

import { describe, it, expect } from 'vitest';
import { VoxelGrid, type VoxelData } from '../../src/core/world/VoxelGrid.js';
import {
  propagateEnergy,
  identifyFragmentedVoxels,
  computeThreshold,
} from '../../src/core/mining/BlastCalc.js';
import { generateSeedPointCloud } from '../../src/physics/VoronoiFrag.js';
import { FRAGMENTATION_MULTIPLIER } from '../../src/core/config/balance.js';
import { Random } from '../../src/core/math/Random.js';
import { getRock } from '../../src/core/world/RockCatalog.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CRUITE: VoxelData = {
  composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
  density: 1.0, oreDensities: {}, fractureModifier: 1.0,
};

const SANDITE: VoxelData = {
  composition: { rocks: [{ rockId: 'sandite', coefficient: 1.0 }] },
  density: 1.0, oreDensities: {}, fractureModifier: 1.0,
};

const TITANITE: VoxelData = {
  composition: { rocks: [{ rockId: 'titanite', coefficient: 1.0 }] },
  density: 1.0, oreDensities: {}, fractureModifier: 1.0,
};

const MOLITE: VoxelData = {
  composition: { rocks: [{ rockId: 'molite', coefficient: 1.0 }] },
  density: 1.0, oreDensities: {}, fractureModifier: 1.0,
};

const AIR: VoxelData = {
  composition: { rocks: [] },
  density: 0, oreDensities: {}, fractureModifier: 1.0,
};

/** Cruite + titanite mixed (weighted threshold). */
const MIXED_CT: VoxelData = {
  composition: {
    rocks: [
      { rockId: 'cruite', coefficient: 0.7 },
      { rockId: 'titanite', coefficient: 0.3 },
    ],
  },
  density: 1.0, oreDensities: {}, fractureModifier: 1.0,
};

/** Three-rock composition. */
const MIXED_3: VoxelData = {
  composition: {
    rocks: [
      { rockId: 'cruite', coefficient: 0.5 },
      { rockId: 'sandite', coefficient: 0.3 },
      { rockId: 'molite', coefficient: 0.2 },
    ],
  },
  density: 1.0, oreDensities: {}, fractureModifier: 1.0,
};

/** Porous rock: density between 0 and 1. */
const POROUS_CRUITE: VoxelData = {
  composition: { rocks: [{ rockId: 'cruite', coefficient: 0.6 }] },
  density: 0.6, oreDensities: {}, fractureModifier: 1.0,
};

/** Pre-cracked rock: fractureModifier reduces effective threshold. */
const PRECRACKED_CRUITE: VoxelData = {
  composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
  density: 1.0, oreDensities: {}, fractureModifier: 0.5,
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

/** Reference rock thresholds */
const CRUITE_T = getRock('cruite')!.energyAbsorption;   // 200
const SANDITE_T = getRock('sandite')!.energyAbsorption;  // 250
const TITANITE_T = getRock('titanite')!.energyAbsorption; // 4000
const MOLITE_T = getRock('molite')!.energyAbsorption;     // 500

// ===========================================================================
// § 1 — Energy gradient across layered rock types
// ===========================================================================

describe('Seed cloud — layered rock energy gradient', () => {
  it('soft cruite layer with hard titanite island — different seed densities', () => {
    // 7×7×7 grid. Cruite fills bottom 3 layers (y=0..2), touching y=0 boundary.
    // Titanite island sits at y=4 (interior, NOT a boundary face: y=0 and y=6 are boundaries).
    // Air gap at y=3 separates them.
    // Inject energy at cruite centre → cruite fragments, titanite is island-detected.
    const grid = new VoxelGrid(7, 7, 7);
    fillRegion(grid, CRUITE, 0, 6, 0, 2, 0, 6);   // y=0..2 cruite (touches y=0 boundary)
    fillRegion(grid, TITANITE, 2, 4, 4, 4, 2, 4);  // y=4, x=2..4, z=2..4 (interior island)
    // y=3, y=5, y=6 are all air (default)

    // Inject massive energy at cruite centre
    const initial = new Map<string, number>([[k(3, 0, 3), CRUITE_T * 20]]);
    const prop = propagateEnergy(grid, initial);
    const fragmented = identifyFragmentedVoxels(grid, prop);

    // Cruite layer: energy-fragmented near injection point
    expect(fragmented.has(k(3, 0, 3))).toBe(true);

    // Far cruite corner (0,0,0) — boundary reachable but not energy-fragmented
    // y=0 is boundary → reachable by BFS → not an island
    expect(fragmented.has(k(0, 0, 0))).toBe(false);

    // Titanite island at y=4: no energy (separated by air at y=3), no boundary path
    // In a 7-height grid, y=4 is NOT a boundary (y=0 and y=6 are).
    // From y=4, trying to reach boundary: neighbor -y is y=3 (air), +y is y=5 (air).
    // No solid boundary seeds that connect to titanite → IS an island.
    expect(fragmented.has(k(3, 4, 3))).toBe(true);

    const cloud = generateSeedPointCloud(fragmented, prop.effectiveEnergy, grid, new Random(42));

    // Every point's source voxel is in the fragmented set
    for (const p of cloud) {
      const vx = Math.floor(p.x);
      const vy = Math.floor(p.y);
      const vz = Math.floor(p.z);
      expect(fragmented.has(k(vx, vy, vz))).toBe(true);
    }

    // Titanite island voxels have no effectiveEnergy → 1 seed each
    const titaniteKeys = ['2,4,2', '2,4,3', '2,4,4', '3,4,2', '3,4,3', '3,4,4', '4,4,2', '4,4,3', '4,4,4'];
    for (const tk of titaniteKeys) {
      const [tx, ty, tz] = tk.split(',').map(Number);
      const inVoxel = cloud.filter(p =>
        Math.floor(p.x) === tx && Math.floor(p.y) === ty && Math.floor(p.z) === tz,
      );
      expect(inVoxel).toHaveLength(1);
    }
  });

  it('energy propagation cascade through layered soft→medium→hard rock', () => {
    // 1×5×1 column: y0=cruite, y1=cruite, y2=sandite, y3=molite, y4=titanite
    // Inject at (0,0,0). Energy flows upward.
    const grid = new VoxelGrid(1, 5, 1);
    grid.setVoxel(0, 0, 0, CRUITE);
    grid.setVoxel(0, 1, 0, CRUITE);
    grid.setVoxel(0, 2, 0, SANDITE);
    grid.setVoxel(0, 3, 0, MOLITE);
    grid.setVoxel(0, 4, 0, TITANITE);

    // Inject 2000 at (0,0,0) → cascade upward, each voxel absorbs threshold
    // T(cruite)=200, T(sandite)=250, T(molite)=500, T(titanite)=4000
    const initial = new Map<string, number>([[k(0, 0, 0), 2000]]);
    const prop = propagateEnergy(grid, initial);
    const fragmented = identifyFragmentedVoxels(grid, prop);

    // Cruite (y=0,1): energy-fragmented
    expect(fragmented.has(k(0, 0, 0))).toBe(true);
    expect(fragmented.has(k(0, 1, 0))).toBe(true);

    // Sandite (y=2): energy-fragmented
    expect(fragmented.has(k(0, 2, 0))).toBe(true);

    // Molite (y=3): absorbs 500, threshold=500 → at boundary → fragmented
    expect(fragmented.has(k(0, 3, 0))).toBe(true);

    // Titanite (y=4): absorbs 850, threshold=4000, not enough energy
    // But y=4 is NOT a boundary face (boundaries are y=0 and y=4 in 5-height grid)
    // Wait — sizeY=5, so y=4 IS a boundary! (y=0 and y=4)
    // Titanite at y=4 is on the boundary → reachable by BFS → not island
    // Not energy-fragmented, not island → not fragmented
    expect(fragmented.has(k(0, 4, 0))).toBe(false);

    const cloud = generateSeedPointCloud(fragmented, prop.effectiveEnergy, grid, new Random(42));

    // 4 voxels fragmented, each: energy=threshold, score=3, count=3
    // Total = 12
    expect(cloud).toHaveLength(12);

    // Points are in correct voxel columns
    const yPoints = cloud.map(p => Math.floor(p.y));
    expect(yPoints.filter(y => y === 0)).toHaveLength(3);
    expect(yPoints.filter(y => y === 1)).toHaveLength(3);
    expect(yPoints.filter(y => y === 2)).toHaveLength(3);
    expect(yPoints.filter(y => y === 3)).toHaveLength(3);
  });
});

// ===========================================================================
// § 2 — Boundary conditions: energy at exact threshold
// ===========================================================================

describe('Seed cloud — energy boundary conditions', () => {
  it('energy exactly equal to FRAGMENTATION_MULTIPLIER * T(v) → fragmented, score = 3', () => {
    // cruite T=200, FM=1.0 → threshold = 200
    const grid = new VoxelGrid(3, 3, 3);
    grid.setVoxel(1, 1, 1, CRUITE);

    const initial = new Map<string, number>([[k(1, 1, 1), CRUITE_T]]);
    const prop = propagateEnergy(grid, initial);
    const fragmented = identifyFragmentedVoxels(grid, prop);

    // Should be fragmented: energy >= FM * T(v) → 200 >= 200 → true
    expect(fragmented.has(k(1, 1, 1))).toBe(true);

    const cloud = generateSeedPointCloud(fragmented, prop.effectiveEnergy, grid, new Random(42));
    // effectiveEnergy = 200 (all absorbed)
    // score = 3 * 200 / 200 = 3.0, count = round(3) = 3
    expect(cloud).toHaveLength(3);
  });

  it('energy just below threshold → not energy-fragmented, still island-detected', () => {
    // cruite T=200, inject 199.999 — just below FM*T(v) = 200
    // This single interior voxel surrounded by air → island-detected
    const grid = new VoxelGrid(3, 3, 3);
    grid.setVoxel(1, 1, 1, CRUITE);

    const initial = new Map<string, number>([[k(1, 1, 1), CRUITE_T - 0.001]]);
    const prop = propagateEnergy(grid, initial);
    const fragmented = identifyFragmentedVoxels(grid, prop);

    // Interior voxel surrounded by air → island detection catches it
    expect(fragmented.has(k(1, 1, 1))).toBe(true);

    const cloud = generateSeedPointCloud(fragmented, prop.effectiveEnergy, grid, new Random(42));
    // effectiveEnergy[1,1,1] = CRUITE_T - 0.001 ≈ 199.999
    // score = 3 * 199.999 / 200 = 2.999985
    // round(2.999985) = 3
    // Still 3 seeds from effectiveEnergy value
    expect(cloud).toHaveLength(3);
  });

  it('energy above threshold capped at T(v) — 3 seeds max per voxel', () => {
    // cruite T=200, inject 2000 → absorbed=200, overflow=1800
    const grid = new VoxelGrid(3, 3, 3);
    grid.setVoxel(1, 1, 1, CRUITE);

    const initial = new Map<string, number>([[k(1, 1, 1), CRUITE_T * 10]]);
    const prop = propagateEnergy(grid, initial);
    const fragmented = identifyFragmentedVoxels(grid, prop);

    expect(fragmented.has(k(1, 1, 1))).toBe(true);

    const cloud = generateSeedPointCloud(fragmented, prop.effectiveEnergy, grid, new Random(42));
    // effectiveEnergy is capped at T(v) = 200
    // score = 3 * 200 / 200 = 3, count = 3
    expect(cloud).toHaveLength(3);
  });

  it('energy overflow to neighbors multiplies total seeds across voxels', () => {
    // 3 cruite voxels in a line: (0,0,0) (1,0,0) (2,0,0)
    // Inject massive energy at (0,0,0). Energy overflows to (1,0,0) then (2,0,0).
    const grid = new VoxelGrid(3, 1, 1);
    fillKeys(grid, CRUITE, ['0,0,0', '1,0,0', '2,0,0']);

    const initial = new Map<string, number>([[k(0, 0, 0), CRUITE_T * 10]]);
    const prop = propagateEnergy(grid, initial);
    const fragmented = identifyFragmentedVoxels(grid, prop);

    // All 3 voxels fragmented (each absorbed T, overflow cascaded)
    expect(fragmented.size).toBe(3);

    const cloud = generateSeedPointCloud(fragmented, prop.effectiveEnergy, grid, new Random(42));
    // Each voxel: effectiveEnergy = T = 200, score = 3, count = 3
    // Total = 9
    expect(cloud).toHaveLength(9);

    // Points distributed across the 3 voxels
    const xPoints = cloud.map(p => Math.floor(p.x));
    expect(xPoints.filter(x => x === 0)).toHaveLength(3);
    expect(xPoints.filter(x => x === 1)).toHaveLength(3);
    expect(xPoints.filter(x => x === 2)).toHaveLength(3);
  });
});

// ===========================================================================
// § 3 — Mixed fragmentation sources
// ===========================================================================

describe('Seed cloud — mixed fragmentation sources', () => {
  it('some voxels energy-fragmented, others island-detected in same blast', () => {
    // 4×4×4 grid. Fill central 2×2×2 core with cruite at (1..2, 1..2, 1..2).
    // This core is interior — no solid path to boundary → island if not energy-fragmented.
    // Also place cruite at (0,0,0) boundary-connected.
    // Inject energy at (0,0,0) only → it fragments by energy.
    // The inner core (1..2, 1..2, 1..2) has no energy → island-detected → 1 seed each.
    const grid = new VoxelGrid(4, 4, 4);
    // Boundary-connected
    grid.setVoxel(0, 0, 0, CRUITE);
    // Inner core (8 voxels)
    fillRegion(grid, CRUITE, 1, 2, 1, 2, 1, 2);

    const initial = new Map<string, number>([[k(0, 0, 0), CRUITE_T * 5]]);
    const prop = propagateEnergy(grid, initial);
    const fragmented = identifyFragmentedVoxels(grid, prop);

    // (0,0,0) fragmented by energy
    expect(fragmented.has(k(0, 0, 0))).toBe(true);

    // Inner core voxels are islands (no solid path to boundary)
    const innerKeys = ['1,1,1', '1,1,2', '1,2,1', '1,2,2', '2,1,1', '2,1,2', '2,2,1', '2,2,2'];
    for (const key of innerKeys) {
      expect(fragmented.has(key)).toBe(true);
    }

    // Total fragmented = 1 (energy) + 8 (island) = 9
    expect(fragmented.size).toBe(9);

    const cloud = generateSeedPointCloud(fragmented, prop.effectiveEnergy, grid, new Random(42));

    // (0,0,0): effectiveEnergy = 200, score = 3, count = 3
    // Each inner core voxel: no effectiveEnergy → score = 0 → count = 1 each (8 total)
    // Total = 3 + 8 = 11
    expect(cloud).toHaveLength(11);

    // Verify inner core voxels have exactly 1 seed each
    for (const key of innerKeys) {
      const [x, y, z] = key.split(',').map(Number);
      const inVoxel = cloud.filter(p =>
        Math.floor(p.x) === x && Math.floor(p.y) === y && Math.floor(p.z) === z,
      );
      expect(inVoxel).toHaveLength(1);
    }
  });
});

// ===========================================================================
// § 4 — Three-rock composition and porous rock
// ===========================================================================

describe('Seed cloud — complex rock compositions', () => {
  it('three-rock composition produces correct seed count', () => {
    // MIXED_3: 0.5 cruite + 0.3 sandite + 0.2 molite
    // T = 0.5*200 + 0.3*250 + 0.2*500 = 100 + 75 + 100 = 275
    const expectedThreshold = 0.5 * CRUITE_T + 0.3 * SANDITE_T + 0.2 * MOLITE_T;
    expect(expectedThreshold).toBe(275);

    const grid = new VoxelGrid(3, 3, 3);
    grid.setVoxel(1, 1, 1, MIXED_3);

    const initial = new Map<string, number>([[k(1, 1, 1), expectedThreshold]]);
    const prop = propagateEnergy(grid, initial);
    const fragmented = identifyFragmentedVoxels(grid, prop);

    expect(fragmented.has(k(1, 1, 1))).toBe(true);

    const cloud = generateSeedPointCloud(fragmented, prop.effectiveEnergy, grid, new Random(42));
    // effectiveEnergy = 275, score = 3 * 275 / 275 = 3, count = 3
    expect(cloud).toHaveLength(3);
  });

  it('porous rock (density 0.6) still fragments with energy above threshold', () => {
    // Porous cruite: coefficient 0.6, density 0.6
    // T = 0.6 * 200 = 120
    const grid = new VoxelGrid(3, 3, 3);
    grid.setVoxel(1, 1, 1, POROUS_CRUITE);

    const initial = new Map<string, number>([[k(1, 1, 1), 120]]);
    const prop = propagateEnergy(grid, initial);
    const fragmented = identifyFragmentedVoxels(grid, prop);

    // Interior voxel surrounded by air → island if not energy-fragmented
    // energy=120 == T(v)=120 → energy-fragmented
    expect(fragmented.has(k(1, 1, 1))).toBe(true);

    const cloud = generateSeedPointCloud(fragmented, prop.effectiveEnergy, grid, new Random(42));
    // effectiveEnergy = 120, score = 3 * 120 / 120 = 3, count = 3
    expect(cloud).toHaveLength(3);
  });

  it('pre-cracked rock (fractureModifier=0.5) — computeThreshold ignores modifier', () => {
    // computeThreshold does NOT use fractureModifier — it's a separate mechanic
    // in BlastExecution.calculateFragmentation. The VoronoiFrag pipeline only
    // uses computeThreshold which ignores fractureModifier.
    // So this should behave identically to normal cruite.
    const grid = new VoxelGrid(3, 3, 3);
    grid.setVoxel(1, 1, 1, PRECRACKED_CRUITE);

    const initial = new Map<string, number>([[k(1, 1, 1), CRUITE_T]]);
    const prop = propagateEnergy(grid, initial);
    const fragmented = identifyFragmentedVoxels(grid, prop);

    expect(fragmented.has(k(1, 1, 1))).toBe(true);

    const cloud = generateSeedPointCloud(fragmented, prop.effectiveEnergy, grid, new Random(42));
    expect(cloud).toHaveLength(3);
  });
});

// ===========================================================================
// § 5 — No mutation of input structures
// ===========================================================================

describe('Seed cloud — no mutation invariants', () => {
  it('generateSeedPointCloud does not mutate fragmentedVoxels set', () => {
    const grid = new VoxelGrid(5, 5, 5);
    fillKeys(grid, CRUITE, ['1,1,1', '2,1,1']);
    const initial = new Map([
      [k(1, 1, 1), CRUITE_T],
      [k(2, 1, 1), CRUITE_T],
    ]);
    const prop = propagateEnergy(grid, initial);
    const fragmented = identifyFragmentedVoxels(grid, prop);

    const fragmentedSnapshot = new Set(fragmented);
    generateSeedPointCloud(fragmented, prop.effectiveEnergy, grid, new Random(42));
    expect(fragmented).toEqual(fragmentedSnapshot);
  });

  it('generateSeedPointCloud does not mutate effectiveEnergy map', () => {
    const grid = new VoxelGrid(5, 5, 5);
    fillKeys(grid, CRUITE, ['1,1,1']);
    const initial = new Map([[k(1, 1, 1), CRUITE_T]]);
    const prop = propagateEnergy(grid, initial);
    const fragmented = identifyFragmentedVoxels(grid, prop);

    const energySnapshot = new Map(prop.effectiveEnergy);
    generateSeedPointCloud(fragmented, prop.effectiveEnergy, grid, new Random(42));
    expect(prop.effectiveEnergy).toEqual(energySnapshot);
  });

  it('propagateEnergy does not mutate VoxelGrid cells', () => {
    const grid = new VoxelGrid(3, 3, 3);
    grid.setVoxel(1, 1, 1, CRUITE);
    const snapshot = JSON.parse(JSON.stringify(grid.getVoxel(1, 1, 1)));

    propagateEnergy(grid, new Map([[k(1, 1, 1), CRUITE_T * 5]]));

    const after = grid.getVoxel(1, 1, 1);
    expect(after).toEqual(snapshot);
  });
});

// ===========================================================================
// § 6 — Determinism and consistency
// ===========================================================================

describe('Seed cloud — determinism', () => {
  it('same configuration always produces same seed count', () => {
    const run = (): number => {
      const grid = new VoxelGrid(4, 4, 4);
      fillRegion(grid, CRUITE, 0, 3, 0, 3, 0, 3);
      const initial = new Map([
        [k(1, 0, 1), CRUITE_T * 3],
        [k(2, 0, 2), CRUITE_T * 3],
      ]);
      const prop = propagateEnergy(grid, initial);
      const frag = identifyFragmentedVoxels(grid, prop);
      return generateSeedPointCloud(frag, prop.effectiveEnergy, grid, new Random(42)).length;
    };

    // 3 runs → same count
    const a = run();
    const b = run();
    const c = run();
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('different PRNG seeds produce different point coordinates', () => {
    const run = (seed: number): string[] => {
      const grid = new VoxelGrid(3, 3, 3);
      grid.setVoxel(1, 1, 1, CRUITE);
      const prop = propagateEnergy(grid, new Map([[k(1, 1, 1), CRUITE_T]]));
      const frag = identifyFragmentedVoxels(grid, prop);
      return generateSeedPointCloud(frag, prop.effectiveEnergy, grid, new Random(seed))
        .map(p => `${p.x.toFixed(6)},${p.y.toFixed(6)},${p.z.toFixed(6)}`);
    };

    const a = run(42);
    const b = run(9999);
    expect(a).toHaveLength(b.length);
    const allSame = a.every((s, i) => s === b[i]);
    expect(allSame).toBe(false);
  });

  it('predictable seed counts for known energy inputs', () => {
    // Single cruite voxel with energy = 200 → score = 3, count = 3
    const grid = new VoxelGrid(3, 3, 3);
    grid.setVoxel(1, 1, 1, CRUITE);
    const prop = propagateEnergy(grid, new Map([[k(1, 1, 1), CRUITE_T]]));
    const frag = identifyFragmentedVoxels(grid, prop);
    const cloud = generateSeedPointCloud(frag, prop.effectiveEnergy, grid, new Random(42));

    expect(cloud).toHaveLength(3);

    // Each point has unique coords
    const seen = new Set<string>();
    for (const p of cloud) {
      const s = `${p.x.toFixed(12)},${p.y.toFixed(12)},${p.z.toFixed(12)}`;
      expect(seen.has(s)).toBe(false);
      seen.add(s);
    }
  });
});

// ===========================================================================
// § 7 — Pre-existing air pockets (caves) affecting seed distribution
// ===========================================================================

describe('Seed cloud — air pocket effects', () => {
  it('air gap blocks energy propagation, creating island on far side', () => {
    // 5×3×5 grid (y=0,2 are boundaries; y=1 is interior).
    // Pillar A: x=0..0, y=1..1, z=1..3 — touches x=0 boundary ✓
    // Pillar B: x=2..2, y=1..1, z=1..3 — interior, NO boundary contact
    // Pillar C: x=4..4, y=1..1, z=1..3 — touches x=4 boundary ✓
    // Inject at pillar A. Pillar B is isolated by air gaps → island.
    // Pillar C is on x=4 boundary → reachable by BFS → not island.
    const grid = new VoxelGrid(5, 3, 5);
    for (let z = 1; z <= 3; z++) {
      grid.setVoxel(0, 1, z, CRUITE);  // pillar A: x=0 boundary
      // x=1,3 are air (gaps)
      grid.setVoxel(2, 1, z, CRUITE);  // pillar B: interior
      grid.setVoxel(4, 1, z, CRUITE);  // pillar C: x=4 boundary
    }

    // Inject at pillar A centre
    const initial = new Map([[k(0, 1, 2), CRUITE_T * 3]]);
    const prop = propagateEnergy(grid, initial);
    const fragmented = identifyFragmentedVoxels(grid, prop);

    // Pillar A: boundary-connected at x=0, energy-fragmented
    expect(fragmented.has(k(0, 1, 2))).toBe(true);

    // Pillar B: interior (x=2, y=1), NOT touching any boundary
    // No solid path to boundary → IS an island
    expect(fragmented.has(k(2, 1, 2))).toBe(true);

    // Pillar C: x=4 IS a boundary → reachable by BFS → NOT island (no energy)
    // But wait — does pillar C at (4,1,z) have energy? No, energy only injected at pillar A.
    // And it's NOT fragmented by energy. BUT it's reachable via BFS from x=4 boundary seed.
    // seed(4, 1, z) is called by the x-boundary loop → pillar C is boundary-connected.
    // Since it has no energy → not fragmented.
    expect(fragmented.has(k(4, 1, 2))).toBe(false);

    const cloud = generateSeedPointCloud(fragmented, prop.effectiveEnergy, grid, new Random(42));

    // Pillar A: some voxels energy-fragmented
    // Pillar B: 3 voxels island-detected → 1 seed each = 3 seeds
    // Total seeds depends on how many of pillar A got energy
    expect(cloud.length).toBeGreaterThanOrEqual(3);

    // All points belong to fragmented voxels
    for (const p of cloud) {
      const vx = Math.floor(p.x);
      const vy = Math.floor(p.y);
      const vz = Math.floor(p.z);
      expect(fragmented.has(k(vx, vy, vz))).toBe(true);
    }

    // Pillar B voxels each have exactly 1 seed (island, no effectiveEnergy)
    for (let z = 1; z <= 3; z++) {
      const inVoxel = cloud.filter(p =>
        Math.floor(p.x) === 2 && Math.floor(p.y) === 1 && Math.floor(p.z) === z,
      );
      expect(inVoxel).toHaveLength(1);
    }
  });

  it('hollow shell (all faces solid, interior air) — zero seeds without energy', () => {
    // 5×5×5 grid. Fill the outer shell with cruite → hollow cube.
    // The interior (1..3, 1..3, 1..3) is all air (cavity).
    // Shell is boundary-connected → not islands.
    // No energy injected → no fragmentation → no seeds.
    const grid = new VoxelGrid(5, 5, 5);
    for (let z = 0; z < 5; z++) {
      for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 5; x++) {
          const isShell = x === 0 || x === 4 || y === 0 || y === 4 || z === 0 || z === 4;
          if (isShell) grid.setVoxel(x, y, z, CRUITE);
        }
      }
    }

    const prop = propagateEnergy(grid, new Map());
    const fragmented = identifyFragmentedVoxels(grid, prop);

    // Shell is boundary-connected → not islands; no energy → no fragmentation
    expect(fragmented.size).toBe(0);

    const cloud = generateSeedPointCloud(fragmented, prop.effectiveEnergy, grid, new Random(42));
    expect(cloud).toHaveLength(0);
  });
});

// ===========================================================================
// § 8 — Large-scale propagation and seed counts
// ===========================================================================

describe('Seed cloud — large-scale propagation', () => {
  it('energy propagates through large cruite block, creating many seeds', () => {
    const grid = new VoxelGrid(8, 8, 8);
    fillRegion(grid, CRUITE, 1, 6, 1, 6, 1, 6);

    const initial = new Map([[k(3, 3, 3), CRUITE_T * 100]]);
    const prop = propagateEnergy(grid, initial);
    const fragmented = identifyFragmentedVoxels(grid, prop);

    expect(fragmented.size).toBeGreaterThan(10);

    const cloud = generateSeedPointCloud(fragmented, prop.effectiveEnergy, grid, new Random(42));

    // Each fragmented voxel contributes at least 1 seed
    expect(cloud.length).toBeGreaterThanOrEqual(fragmented.size);

    // All points are finite numbers
    for (const p of cloud) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
      expect(Number.isFinite(p.z)).toBe(true);
    }

    // No duplicates
    const seen = new Set<string>();
    for (const p of cloud) {
      const s = `${p.x.toFixed(12)},${p.y.toFixed(12)},${p.z.toFixed(12)}`;
      expect(seen.has(s)).toBe(false);
      seen.add(s);
    }
  });

  it('two separate charge points produce overlapping seed clouds', () => {
    const grid = new VoxelGrid(10, 5, 10);
    fillRegion(grid, CRUITE, 1, 8, 0, 3, 1, 8);

    const initial = new Map([
      [k(2, 0, 2), CRUITE_T * 5],
      [k(7, 0, 7), CRUITE_T * 5],
    ]);
    const prop = propagateEnergy(grid, initial);
    const fragmented = identifyFragmentedVoxels(grid, prop);

    expect(fragmented.size).toBeGreaterThan(0);

    const cloud = generateSeedPointCloud(fragmented, prop.effectiveEnergy, grid, new Random(42));

    expect(cloud.length).toBeGreaterThanOrEqual(fragmented.size);

    // All points in valid source voxels
    for (const p of cloud) {
      const vx = Math.floor(p.x);
      const vy = Math.floor(p.y);
      const vz = Math.floor(p.z);
      expect(fragmented.has(k(vx, vy, vz))).toBe(true);
    }
  });

  it('very large energy value does not cause infinite loop or crash', () => {
    const grid = new VoxelGrid(5, 5, 5);
    fillRegion(grid, CRUITE, 0, 4, 0, 4, 0, 4);

    const initial = new Map([[k(2, 2, 2), 1e12]]);
    const prop = propagateEnergy(grid, initial);
    const fragmented = identifyFragmentedVoxels(grid, prop);

    expect(fragmented.size).toBeGreaterThan(0);

    const cloud = generateSeedPointCloud(fragmented, prop.effectiveEnergy, grid, new Random(42));
    expect(cloud.length).toBeGreaterThan(0);
    expect(cloud.length).toBeLessThanOrEqual(1e6);

    for (const p of cloud) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
      expect(Number.isFinite(p.z)).toBe(true);
    }
  });
});
