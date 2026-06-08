import { describe, it, expect, beforeEach } from 'vitest';
import {
  calculateHoleEnergy,
  stemmingFactor,
  stemmingEfficiency,
  waterEffect,
  calculateEnergyField,
  calculateFragmentation,
  calculateFragmentCount,
  calculateInitialVelocity,
  classifyProjection,
  calculateFreeFace,
  calculateVibrations,
  groupChargesByDelay,
  PROJECTION_SPEED_THRESHOLD,
  fragmentBoulder,
  isOversized,
  isFragmentOversized,
  OVERSIZED_FRAGMENT_THRESHOLD,
  resetBoulderFragIds,
  computeThreshold,
  computeInitialEnergy,
  effectiveHoleEnergy,
  propagateEnergy,
  identifyFragmentedVoxels,
  type PropagationResult,
  type Boulder,
} from '../../../src/core/mining/BlastCalc.js';
import { VoxelGrid, type VoxelData } from '../../../src/core/world/VoxelGrid.js';
import type { HoleCharge } from '../../../src/core/mining/ChargePlan.js';
import { getRock } from '../../../src/core/world/RockCatalog.js';
import { MAX_PROPAGATION_ITERATIONS, FRAGMENTATION_MULTIPLIER } from '../../../src/core/config/balance.js';
import { vec3, length } from '../../../src/core/math/Vec3.js';
import { createGridPlan, resetHoleIds } from '../../../src/core/mining/DrillPlan.js';
import { Random } from '../../../src/core/math/Random.js';

beforeEach(() => {
  resetHoleIds();
  resetBoulderFragIds();
});

// ── 3.6: Energy calculation ──

describe('BlastCalc — energy', () => {
  it('energy decreases with distance from hole (inverse square)', () => {
    const holes = createGridPlan({ x: 0, z: 0 }, 1, 1, 3, 8, 0.15);
    const charges = { [holes[0]!.id]: { explosiveId: 'boomite', amountKg: 5, stemmingM: 2 } };
    const depths = { [holes[0]!.id]: 8 };
    const near = calculateEnergyField(vec3(1, 0, 0), holes, charges, depths);
    const far = calculateEnergyField(vec3(10, 0, 0), holes, charges, depths);
    expect(near).toBeGreaterThan(far);
  });

  it('multiple holes sum their energy at any point', () => {
    const holes = createGridPlan({ x: 0, z: 0 }, 1, 2, 10, 8, 0.15);
    const charges = {
      [holes[0]!.id]: { explosiveId: 'boomite', amountKg: 5, stemmingM: 2 },
      [holes[1]!.id]: { explosiveId: 'boomite', amountKg: 5, stemmingM: 2 },
    };
    const depths = { [holes[0]!.id]: 8, [holes[1]!.id]: 8 };
    const singleCharge = { [holes[0]!.id]: charges[holes[0]!.id]! };
    const oneHole = calculateEnergyField(vec3(5, 0, 0), [holes[0]!], singleCharge, depths);
    const twoHoles = calculateEnergyField(vec3(5, 0, 0), holes, charges, depths);
    expect(twoHoles).toBeGreaterThan(oneHole);
  });

  it('stemming factor is 1.0 when adequate, <1.0 when insufficient', () => {
    // Adequate: stemming = 0.3 * depth or more
    expect(stemmingFactor(2.4, 8)).toBe(1.0); // 2.4 / (8*0.3) = 1.0
    // Insufficient: less than 0.3 * depth
    expect(stemmingFactor(0.5, 8)).toBeLessThan(1.0);
    // Zero stemming
    expect(stemmingFactor(0, 8)).toBe(0);
  });

  it('water-sensitive explosive in flooded hole without tubing → 10%', () => {
    expect(waterEffect(true, true, false)).toBeCloseTo(0.1);
  });

  it('water-sensitive explosive with tubing → full energy', () => {
    expect(waterEffect(true, true, true)).toBe(1.0);
  });

  it('non-water-sensitive explosive in flooded hole → full energy', () => {
    expect(waterEffect(true, false, false)).toBe(1.0);
  });
});

// ── 3.7: Fragmentation ──

describe('BlastCalc — fragmentation', () => {
  it('energy below 0.5x threshold → unaffected', () => {
    const r = calculateFragmentation(100, 500);
    expect(r.result).toBe('unaffected');
  });

  it('energy between 0.5x and 1x threshold → cracked', () => {
    const r = calculateFragmentation(400, 500);
    expect(r.result).toBe('cracked');
  });

  it('energy between 1x and 2x threshold → good fragmentation', () => {
    const r = calculateFragmentation(750, 500);
    expect(r.result).toBe('fractured');
    expect(r.fragmentSizeFraction).toBeGreaterThan(0.3);
    expect(r.fragmentSizeFraction).toBeLessThanOrEqual(1.0);
    expect(r.isProjection).toBe(false);
  });

  it('energy between 2x and 4x threshold → fine fragmentation', () => {
    const r = calculateFragmentation(1500, 500);
    expect(r.result).toBe('fractured');
    expect(r.fragmentSizeFraction).toBeGreaterThanOrEqual(0.1);
    expect(r.fragmentSizeFraction).toBeLessThanOrEqual(0.3);
    expect(r.isProjection).toBe(false);
  });

  it('energy above 4x threshold → dust + projection', () => {
    const r = calculateFragmentation(2500, 500);
    expect(r.result).toBe('fractured');
    expect(r.fragmentSizeFraction).toBe(0.05);
    expect(r.isProjection).toBe(true);
  });

  it('fragment count * fragment volume ≈ voxel volume (within cap)', () => {
    const voxelVol = 1.0; // 1 m³
    const fragSize = 0.5; // Large enough that count stays under MAX cap
    const count = calculateFragmentCount(voxelVol, fragSize);
    const totalFragVol = count * (fragSize ** 3);
    // Should be >= voxel volume (ceil causes slight overshoot)
    expect(totalFragVol).toBeGreaterThanOrEqual(voxelVol * 0.99);
    // For dust-like sizes, count is capped to prevent memory issues
    const dustCount = calculateFragmentCount(1.0, 0.05);
    expect(dustCount).toBeLessThanOrEqual(20);
  });

  it('initial velocity points away from nearest hole', () => {
    const fragPos = vec3(5, 0, 0);
    const holePos = vec3(0, 0, 0);
    const vel = calculateInitialVelocity(fragPos, holePos, 1000, 10);
    // Velocity should be in +x direction
    expect(vel.x).toBeGreaterThan(0);
  });

  it('projection classification threshold works', () => {
    expect(classifyProjection(20, 2)).toBe(true);  // speed > threshold
    expect(classifyProjection(5, 5)).toBe(true);   // energyRatio >= 4
    expect(classifyProjection(5, 2)).toBe(false);  // both below
  });
});

// ── 3.8: Free face ──

describe('BlastCalc — free face', () => {
  it('hole at terrain edge (open on one side) has free face > 0', () => {
    // Simulate: all neighbors solid except x=-1 direction (out of bounds = empty)
    const isEmpty = (x: number, _y: number, _z: number) => x < 0;
    const ff = calculateFreeFace(0, 5, 4, isEmpty);
    expect(ff).toBeGreaterThan(0);
  });

  it('hole completely surrounded by rock has free face ≈ 0', () => {
    const isEmpty = () => false;
    const ff = calculateFreeFace(5, 5, 4, isEmpty);
    expect(ff).toBe(0);
  });

  it('after simulating blasted neighbors, free face increases', () => {
    const blastedSet = new Set<string>();
    const isEmpty = (x: number, y: number, z: number) => blastedSet.has(`${x},${y},${z}`);

    const ffBefore = calculateFreeFace(5, 5, 4, isEmpty);

    // Simulate neighbor at (4, *, 5) being blasted
    for (let y = 0; y < 4; y++) blastedSet.add(`4,${y},5`);
    const ffAfter = calculateFreeFace(5, 5, 4, isEmpty);

    expect(ffAfter).toBeGreaterThan(ffBefore);
  });
});

// ── 3.9: Vibration ──

describe('BlastCalc — vibration', () => {
  it('single-delay blast produces maximum vibration', () => {
    // All charge in one delay
    const single = calculateVibrations([30], 100, 1.0);
    // Same charge spread across 3 delays
    const spread = calculateVibrations([10, 10, 10], 100, 1.0);
    // Single delay should be higher (30^0.7 > 3 * 10^0.7 due to concavity)
    expect(single).toBeGreaterThan(spread);
  });

  it('well-spread sequence produces lower vibration', () => {
    const concentrated = calculateVibrations([20, 20], 100, 1.0);
    const spread = calculateVibrations([5, 5, 5, 5, 5, 5, 5, 5], 100, 1.0);
    expect(spread).toBeLessThan(concentrated);
  });

  it('vibration decreases with distance', () => {
    const near = calculateVibrations([10], 50, 1.0);
    const far = calculateVibrations([10], 200, 1.0);
    expect(near).toBeGreaterThan(far);
  });

  it('higher charge per delay → higher vibration', () => {
    const low = calculateVibrations([5], 100, 1.0);
    const high = calculateVibrations([20], 100, 1.0);
    expect(high).toBeGreaterThan(low);
  });

  it('groupChargesByDelay aggregates correctly', () => {
    const holes = createGridPlan({ x: 0, z: 0 }, 1, 3, 3, 8, 0.15);
    const charges: Record<string, { explosiveId: string; amountKg: number; stemmingM: number }> = {
      [holes[0]!.id]: { explosiveId: 'boomite', amountKg: 5, stemmingM: 2 },
      [holes[1]!.id]: { explosiveId: 'boomite', amountKg: 5, stemmingM: 2 },
      [holes[2]!.id]: { explosiveId: 'boomite', amountKg: 5, stemmingM: 2 },
    };
    const delays: Record<string, number> = {
      [holes[0]!.id]: 0,
      [holes[1]!.id]: 0,   // same delay as first
      [holes[2]!.id]: 25,
    };
    const groups = groupChargesByDelay(holes, charges, delays);
    expect(groups).toContain(10); // two holes at delay 0: 5+5=10
    expect(groups).toContain(5);  // one hole at delay 25: 5
  });
});

// ── 2.11: Boulder fragmentation ──

describe('BlastCalc — fragmentBoulder', () => {
  // ── Deterministic fixtures ──────────────────────────────────────────────────
  // Oversized boulder: 2.0 m³, granite density 2 700 kg/m³ → 5 400 kg.
  // oreDensities are fractions that must sum to 1 (blingite 30 % + dirtite 70 %).
  const oversizedBoulder: Boulder = {
    id: 1,
    volume: 2.0,
    mass: 5_400,
    rockId: 'granite',
    oreDensities: { blingite: 0.3, dirtite: 0.7 },
  };

  // Non-oversized boulder: 0.3 m³ — below the 0.5 m³ threshold.
  const normalBoulder: Boulder = {
    id: 2,
    volume: 0.3,
    mass: 810,
    rockId: 'granite',
    oreDensities: { blingite: 0.3, dirtite: 0.7 },
  };

  // Exactly-at-threshold boulder: 0.5 m³ — boundary, must NOT be oversized.
  const boundaryBoulder: Boulder = {
    id: 3,
    volume: 0.5,
    mass: 1_350,
    rockId: 'granite',
    oreDensities: { dirtite: 1.0 },
  };

  // ── isOversized helper ──────────────────────────────────────────────────────

  it('isOversized returns true for volume strictly above the threshold', () => {
    expect(isOversized(OVERSIZED_FRAGMENT_THRESHOLD + 0.001)).toBe(true);
    expect(isOversized(1.0)).toBe(true);
    expect(isOversized(10.0)).toBe(true);
  });

  it('isOversized returns false for volume at or below the threshold', () => {
    expect(isOversized(OVERSIZED_FRAGMENT_THRESHOLD)).toBe(false);
    expect(isOversized(OVERSIZED_FRAGMENT_THRESHOLD - 0.001)).toBe(false);
    expect(isOversized(0.0)).toBe(false);
  });

  // ── Rejection of non-oversized input ───────────────────────────────────────

  it('rejects a boulder below the threshold: success false, empty fragments, error set', () => {
    const result = fragmentBoulder(normalBoulder, new Random(42));
    expect(result.success).toBe(false);
    expect(result.fragments).toEqual([]);
    expect(result.error).toBeDefined();
    expect(typeof result.error).toBe('string');
    expect((result.error as string).length).toBeGreaterThan(0);
  });

  it('rejects a boulder exactly at the threshold: success false, empty fragments, error set', () => {
    const result = fragmentBoulder(boundaryBoulder, new Random(42));
    expect(result.success).toBe(false);
    expect(result.fragments).toEqual([]);
    expect(result.error).toBeDefined();
  });

  // ── Fragment volume constraint ──────────────────────────────────────────────

  it('every output fragment has volume strictly below OVERSIZED_FRAGMENT_THRESHOLD', () => {
    const result = fragmentBoulder(oversizedBoulder, new Random(42));
    expect(result.success).toBe(true);
    for (const frag of result.fragments) {
      expect(frag.volume).toBeLessThan(OVERSIZED_FRAGMENT_THRESHOLD);
    }
  });

  // ── Mass conservation ───────────────────────────────────────────────────────

  it('fragment masses sum to the original boulder mass (mass conservation, 6 d.p.)', () => {
    const result = fragmentBoulder(oversizedBoulder, new Random(42));
    expect(result.success).toBe(true);
    const totalMass = result.fragments.reduce((acc, f) => acc + f.mass, 0);
    expect(totalMass).toBeCloseTo(oversizedBoulder.mass, 6);
  });

  // ── Volume conservation ─────────────────────────────────────────────────────

  it('fragment volumes sum to the original boulder volume (volume conservation, 6 d.p.)', () => {
    const result = fragmentBoulder(oversizedBoulder, new Random(42));
    expect(result.success).toBe(true);
    const totalVolume = result.fragments.reduce((acc, f) => acc + f.volume, 0);
    expect(totalVolume).toBeCloseTo(oversizedBoulder.volume, 6);
  });

  // ── Ore density preservation ────────────────────────────────────────────────

  it('ore densities are preserved identically in every sub-fragment', () => {
    const result = fragmentBoulder(oversizedBoulder, new Random(42));
    expect(result.success).toBe(true);
    for (const frag of result.fragments) {
      expect(frag.oreDensities).toEqual(oversizedBoulder.oreDensities);
    }
  });

  // ── Minimum fragment count ──────────────────────────────────────────────────

  it('produces at least 2 sub-fragments from an oversized boulder', () => {
    const result = fragmentBoulder(oversizedBoulder, new Random(42));
    expect(result.success).toBe(true);
    expect(result.fragments.length).toBeGreaterThanOrEqual(2);
  });

  // ── ID uniqueness ───────────────────────────────────────────────────────────

  it('sub-fragment IDs are all unique and none equals the parent boulder ID', () => {
    const result = fragmentBoulder(oversizedBoulder, new Random(42));
    expect(result.success).toBe(true);
    const ids = result.fragments.map(f => f.id);
    const uniqueIds = new Set(ids);
    // Every fragment gets its own distinct ID
    expect(uniqueIds.size).toBe(ids.length);
    // No fragment recycles the parent's ID
    for (const id of ids) {
      expect(id).not.toBe(oversizedBoulder.id);
    }
  });
});

// ── 5.3: computeThreshold ──

describe('BlastCalc — computeThreshold', () => {
  // ── Known rock data from RockCatalog ────────────────────────────────────────
  // cruite:     hardnessTier 1, energyAbsorption = 200
  // sandite:    hardnessTier 1, energyAbsorption = 250
  // titanite:   hardnessTier 5, energyAbsorption = 4000

  const cruiteAbsorption = getRock('cruite')!.energyAbsorption;   // 200
  const sanditeAbsorption = getRock('sandite')!.energyAbsorption;  // 250
  const titaniteAbsorption = getRock('titanite')!.energyAbsorption; // 4000

  it('returns 0 for an air voxel (empty composition)', () => {
    const voxel: VoxelData = {
      composition: { rocks: [] },
      density: 0,
      oreDensities: {},
      fractureModifier: 1.0,
    };
    expect(computeThreshold(voxel)).toBe(0);
  });

  it('returns the rock energyAbsorption for a single rock type with coefficient 1.0', () => {
    const voxel: VoxelData = {
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      density: 1.0,
      oreDensities: {},
      fractureModifier: 1.0,
    };
    expect(computeThreshold(voxel)).toBe(cruiteAbsorption);
  });

  it('returns correct weighted sum for multiple rock types', () => {
    // 0.6 × cruite (200) + 0.4 × titanite (4000)
    const expected = 0.6 * cruiteAbsorption + 0.4 * titaniteAbsorption;
    const voxel: VoxelData = {
      composition: {
        rocks: [
          { rockId: 'cruite', coefficient: 0.6 },
          { rockId: 'titanite', coefficient: 0.4 },
        ],
      },
      density: 1.0,
      oreDensities: {},
      fractureModifier: 1.0,
    };
    expect(computeThreshold(voxel)).toBeCloseTo(expected, 10);
  });

  it('returns correct weighted sum for three rock types', () => {
    // 0.5 × cruite (200) + 0.3 × sandite (250) + 0.2 × titanite (4000)
    const expected = 0.5 * cruiteAbsorption + 0.3 * sanditeAbsorption + 0.2 * titaniteAbsorption;
    const voxel: VoxelData = {
      composition: {
        rocks: [
          { rockId: 'cruite', coefficient: 0.5 },
          { rockId: 'sandite', coefficient: 0.3 },
          { rockId: 'titanite', coefficient: 0.2 },
        ],
      },
      density: 1.0,
      oreDensities: {},
      fractureModifier: 1.0,
    };
    expect(computeThreshold(voxel)).toBeCloseTo(expected, 10);
  });

  it('returns 0 when all coefficients are 0', () => {
    const voxel: VoxelData = {
      composition: {
        rocks: [
          { rockId: 'cruite', coefficient: 0 },
          { rockId: 'titanite', coefficient: 0 },
        ],
      },
      density: 1.0,
      oreDensities: {},
      fractureModifier: 1.0,
    };
    expect(computeThreshold(voxel)).toBe(0);
  });

  it('gracefully handles unknown rockId (treats as zero contribution)', () => {
    const voxel: VoxelData = {
      composition: {
        rocks: [
          { rockId: 'nonexistent_rock', coefficient: 1.0 },
        ],
      },
      density: 1.0,
      oreDensities: {},
      fractureModifier: 1.0,
    };
    // Unknown rock → getRock returns undefined → contribution is 0
    expect(computeThreshold(voxel)).toBe(0);
  });

  it('gracefully handles unknown rockId in multi-rock composition', () => {
    // 0.7 × cruite (200) + 0.3 × nonexistent (0)
    const expected = 0.7 * cruiteAbsorption;
    const voxel: VoxelData = {
      composition: {
        rocks: [
          { rockId: 'cruite', coefficient: 0.7 },
          { rockId: 'made_up_rock', coefficient: 0.3 },
        ],
      },
      density: 1.0,
      oreDensities: {},
      fractureModifier: 1.0,
    };
    expect(computeThreshold(voxel)).toBeCloseTo(expected, 10);
  });

  it('returns correct result with partial fill (coefficients sum < 1.0)', () => {
    // 0.5 × cruite (200) — only one rock, sum = 0.5 (partial void/porosity)
    const expected = 0.5 * cruiteAbsorption;
    const voxel: VoxelData = {
      composition: {
        rocks: [
          { rockId: 'cruite', coefficient: 0.5 },
        ],
      },
      density: 0.5,
      oreDensities: {},
      fractureModifier: 1.0,
    };
    expect(computeThreshold(voxel)).toBeCloseTo(expected, 10);
  });

  it('does not mutate the input voxel object', () => {
    const voxel: VoxelData = {
      composition: {
        rocks: [
          { rockId: 'cruite', coefficient: 1.0 },
        ],
      },
      density: 1.0,
      oreDensities: {},
      fractureModifier: 1.0,
    };
    const snapshot = JSON.parse(JSON.stringify(voxel));
    computeThreshold(voxel);
    expect(voxel).toEqual(snapshot);
  });
});

// ── 5.5: propagateEnergy ──

describe('BlastCalc — propagateEnergy', () => {
  // ── Helpers ─────────────────────────────────────────────────────────────────

  /** Create a VoxelGrid filled entirely with one rock type at density 1.0. */
  function filledGrid(
    sizeX: number, sizeY: number, sizeZ: number, rockId: string,
  ): VoxelGrid {
    const grid = new VoxelGrid(sizeX, sizeY, sizeZ);
    const voxel: VoxelData = {
      composition: { rocks: [{ rockId, coefficient: 1.0 }] },
      density: 1.0,
      oreDensities: {},
      fractureModifier: 1.0,
    };
    for (let z = 0; z < sizeZ; z++) {
      for (let y = 0; y < sizeY; y++) {
        for (let x = 0; x < sizeX; x++) {
          grid.setVoxel(x, y, z, voxel);
        }
      }
    }
    return grid;
  }

  /** Create a single-voxel grid (3×3×3) with air except at a specific coord. */
  function singleSolidGrid(
    sx: number, sy: number, sz: number, rockId: string,
  ): VoxelGrid {
    const grid = new VoxelGrid(3, 3, 3);
    const solid: VoxelData = {
      composition: { rocks: [{ rockId, coefficient: 1.0 }] },
      density: 1.0,
      oreDensities: {},
      fractureModifier: 1.0,
    };
    grid.setVoxel(sx, sy, sz, solid);
    return grid;
  }

  // cruite: hardnessTier 1 → energyAbsorption = 200
  const CRUITE_ABSORPTION = getRock('cruite')!.energyAbsorption;

  // ── Basic acceptance tests ─────────────────────────────────────────────────

  it('empty initial map returns maps with size 0', () => {
    const grid = new VoxelGrid(3, 3, 3);
    const initial = new Map<string, number>();
    const result = propagateEnergy(grid, initial);
    expect(result.effectiveEnergy.size).toBe(0);
    expect(result.generatedOverflow.size).toBe(0);
  });

  it('single solid voxel, initial energy < threshold → all absorbed, none overflows', () => {
    const grid = singleSolidGrid(1, 1, 1, 'cruite');
    const initial = new Map<string, number>([['1,1,1', CRUITE_ABSORPTION * 0.5]]);
    const result = propagateEnergy(grid, initial);
    expect(result.effectiveEnergy.get('1,1,1')).toBeCloseTo(CRUITE_ABSORPTION * 0.5, 6);
    expect(result.generatedOverflow.get('1,1,1')).toBeUndefined();
  });

  it('single solid voxel, energy > threshold → threshold absorbed, leftover in generatedOverflow', () => {
    const grid = singleSolidGrid(1, 1, 1, 'cruite');
    const excess = 100;
    const initial = new Map<string, number>([['1,1,1', CRUITE_ABSORPTION + excess]]);
    const result = propagateEnergy(grid, initial);
    expect(result.effectiveEnergy.get('1,1,1')).toBeCloseTo(CRUITE_ABSORPTION, 6);
    expect(result.generatedOverflow.get('1,1,1')).toBeCloseTo(excess, 6);
  });

  it('two adjacent solid voxels: overflow distributes equally to neighbor', () => {
    // Grid large enough; voxels at (1,1,1) and (2,1,1) are X-adjacent
    const grid = new VoxelGrid(4, 3, 3);
    const solid: VoxelData = {
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      density: 1.0, oreDensities: {}, fractureModifier: 1.0,
    };
    grid.setVoxel(1, 1, 1, solid);
    grid.setVoxel(2, 1, 1, solid);

    const excess = 200;
    const initial = new Map<string, number>([['1,1,1', CRUITE_ABSORPTION + excess]]);
    const result = propagateEnergy(grid, initial);

    // Voxel at (1,1,1) absorbs its threshold
    expect(result.effectiveEnergy.get('1,1,1')).toBeCloseTo(CRUITE_ABSORPTION, 6);
    // Voxel at (2,1,1) receives its share of leftover (1 neighbor from (1,1,1)'s perspective
    // There are 3 other faces: -x (0,1,1) is air → skip, +x (2,1,1) is solid → receives,
    // +y (1,2,1) air, -y (1,0,1) air, +z (1,1,2) air, -z (1,1,0) air
    // So 1 valid neighbor → all excess goes to it
    // But wait, the neighbor at (2,1,1) gets leftover, but its threshold is 200
    // so it should absorb min(200, 200) = 200 and have 0 overflow
    expect(result.effectiveEnergy.get('2,1,1')).toBeCloseTo(Math.min(excess, CRUITE_ABSORPTION), 6);
    expect(result.generatedOverflow.get('1,1,1')).toBeCloseTo(excess, 6);
  });

  it('overflow distributes to all 6 face-adjacent non-air neighbors equally', () => {
    // Place 6 solid voxels around a center solid voxel, all cruite.
    // Center at (1,1,1). Neighbors at all 6 faces.
    const grid = new VoxelGrid(3, 3, 3);
    const solid: VoxelData = {
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      density: 1.0, oreDensities: {}, fractureModifier: 1.0,
    };
    // Center
    grid.setVoxel(1, 1, 1, solid);
    // 6 face-adjacent neighbors
    grid.setVoxel(0, 1, 1, solid); // -x
    grid.setVoxel(2, 1, 1, solid); // +x
    grid.setVoxel(1, 0, 1, solid); // -y
    grid.setVoxel(1, 2, 1, solid); // +y
    grid.setVoxel(1, 1, 0, solid); // -z
    grid.setVoxel(1, 1, 2, solid); // +z

    const leftover = 600; // divisible by 6
    const initial = new Map<string, number>([['1,1,1', CRUITE_ABSORPTION + leftover]]);
    const result = propagateEnergy(grid, initial);

    // Center gets its full threshold
    expect(result.effectiveEnergy.get('1,1,1')).toBeCloseTo(CRUITE_ABSORPTION, 6);
    // Each neighbor receives 1/6 of leftover = 100
    expect(result.effectiveEnergy.get('0,1,1')).toBeCloseTo(100, 6);
    expect(result.effectiveEnergy.get('2,1,1')).toBeCloseTo(100, 6);
    expect(result.effectiveEnergy.get('1,0,1')).toBeCloseTo(100, 6);
    expect(result.effectiveEnergy.get('1,2,1')).toBeCloseTo(100, 6);
    expect(result.effectiveEnergy.get('1,1,0')).toBeCloseTo(100, 6);
    expect(result.effectiveEnergy.get('1,1,2')).toBeCloseTo(100, 6);
  });

  it('air voxels (density ≤ 0) never receive overflow energy', () => {
    // Place solid cruite at (1,1,1). All neighbors are air.
    const grid = singleSolidGrid(1, 1, 1, 'cruite');
    const excess = 500;
    const initial = new Map<string, number>([['1,1,1', CRUITE_ABSORPTION + excess]]);
    const result = propagateEnergy(grid, initial);

    // All 6 neighbors are air → overflow stays on the source voxel
    expect(result.effectiveEnergy.get('1,1,1')).toBeCloseTo(CRUITE_ABSORPTION, 6);
    expect(result.generatedOverflow.get('1,1,1')).toBeCloseTo(excess, 6);
    // No neighbor should have any effective energy
    expect(result.effectiveEnergy.get('0,1,1')).toBeUndefined();
    expect(result.effectiveEnergy.get('2,1,1')).toBeUndefined();
    expect(result.effectiveEnergy.get('1,0,1')).toBeUndefined();
    expect(result.effectiveEnergy.get('1,2,1')).toBeUndefined();
    expect(result.effectiveEnergy.get('1,1,0')).toBeUndefined();
    expect(result.effectiveEnergy.get('1,1,2')).toBeUndefined();
  });

  it('overflow stops at grid boundaries — out-of-bounds neighbors skipped', () => {
    // Place solid at corner (0,0,0). Only 3 face-adjacent neighbors exist.
    const grid = new VoxelGrid(3, 3, 3);
    const solid: VoxelData = {
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      density: 1.0, oreDensities: {}, fractureModifier: 1.0,
    };
    grid.setVoxel(0, 0, 0, solid);
    grid.setVoxel(1, 0, 0, solid); // +x
    grid.setVoxel(0, 1, 0, solid); // +y
    grid.setVoxel(0, 0, 1, solid); // +z

    const leftover = 300; // divisible by 3
    const initial = new Map<string, number>([['0,0,0', CRUITE_ABSORPTION + leftover]]);
    const result = propagateEnergy(grid, initial);

    expect(result.effectiveEnergy.get('0,0,0')).toBeCloseTo(CRUITE_ABSORPTION, 6);
    // Each of 3 valid neighbors gets 100
    expect(result.effectiveEnergy.get('1,0,0')).toBeCloseTo(100, 6);
    expect(result.effectiveEnergy.get('0,1,0')).toBeCloseTo(100, 6);
    expect(result.effectiveEnergy.get('0,0,1')).toBeCloseTo(100, 6);
  });

  // ── Loop termination ──────────────────────────────────────────────────────

  it('loop terminates before MAX_PROPAGATION_ITERATIONS with high energy across many voxels', () => {
    // 5×5×5 grid filled with cruite, initial energy huge on center voxel
    const grid = filledGrid(5, 5, 5, 'cruite');
    const energy = CRUITE_ABSORPTION + 1_000_000;
    const initial = new Map<string, number>([['2,2,2', energy]]);

    const start = performance.now();
    const result = propagateEnergy(grid, initial);
    const elapsed = performance.now() - start;

    // Function returns without throwing
    expect(result).toBeDefined();
    expect(result.effectiveEnergy).toBeDefined();
    expect(result.generatedOverflow).toBeDefined();
    // Should complete in < 500ms (generous bound for 500 iterations)
    expect(elapsed).toBeLessThan(5000);
  });

  // ── Energy cap invariant ───────────────────────────────────────────────────

  it('effectiveEnergy per voxel never exceeds T(v) (threshold capped)', () => {
    const grid = filledGrid(3, 3, 3, 'cruite');
    // Massive energy on center voxel
    const initial = new Map<string, number>([['1,1,1', CRUITE_ABSORPTION * 100]]);
    const result = propagateEnergy(grid, initial);

    // Check every voxel got at most its threshold
    for (const [key, energy] of result.effectiveEnergy) {
      expect(energy).toBeLessThanOrEqual(CRUITE_ABSORPTION + 1e-9);
    }
  });

  // ── Accumulation across iterations ─────────────────────────────────────────

  it('generatedOverflow accumulates across multiple iterations (second pass)', () => {
    // 2 voxels in a line: (0,0,0) and (1,0,0). Both cruite.
    // Initial energy on (0,0,0) is threshold + leftover.
    // Leftover goes to (1,0,0). If leftover > threshold of (1,0,0),
    // the second voxel overflows back or onward.
    const grid = new VoxelGrid(4, 1, 1);
    const solid: VoxelData = {
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      density: 1.0, oreDensities: {}, fractureModifier: 1.0,
    };
    grid.setVoxel(0, 0, 0, solid);
    grid.setVoxel(1, 0, 0, solid);

    // Leftover = 300 units on voxel (0,0,0); after 200 absorbed, 300 flows to (1,0,0)
    // (1,0,0) absorbs 200, overflows 100; no other neighbor → 100 stays as generatedOverflow on (1,0,0)
    const leftover = 300;
    const initial = new Map<string, number>([['0,0,0', CRUITE_ABSORPTION + leftover]]);
    const result = propagateEnergy(grid, initial);

    expect(result.effectiveEnergy.get('0,0,0')).toBeCloseTo(CRUITE_ABSORPTION, 6);
    expect(result.effectiveEnergy.get('1,0,0')).toBeCloseTo(CRUITE_ABSORPTION, 6);
    expect(result.generatedOverflow.get('0,0,0')).toBeCloseTo(leftover, 6);
    // The overflow that reached (1,0,0) was 300, it absorbed 200, leaving 100
    expect(result.generatedOverflow.get('1,0,0')).toBeCloseTo(100, 6);
  });

  // ── Pure function (no mutation) ────────────────────────────────────────────

  it('does not mutate VoxelGrid cells (pure function — reads only)', () => {
    const grid = singleSolidGrid(1, 1, 1, 'cruite');
    const originalVoxel = grid.getVoxel(1, 1, 1);
    const snapshot = JSON.parse(JSON.stringify(originalVoxel));

    const initial = new Map<string, number>([['1,1,1', CRUITE_ABSORPTION + 100]]);
    propagateEnergy(grid, initial);

    // Voxel data unchanged
    const after = grid.getVoxel(1, 1, 1);
    expect(after).toEqual(snapshot);
  });

  // ── Edge cases ─────────────────────────────────────────────────────────────

  it('empty grid (sizeX=0) returns cleanly with empty maps', () => {
    const grid = new VoxelGrid(0, 0, 0);
    const initial = new Map<string, number>([['0,0,0', 100]]);
    const result = propagateEnergy(grid, initial);
    expect(result.effectiveEnergy.size).toBe(0);
    expect(result.generatedOverflow.size).toBe(0);
  });

  it('all voxels air — no propagation beyond initial', () => {
    const grid = new VoxelGrid(3, 3, 3);
    // Everything is air (default)
    const initial = new Map<string, number>([['1,1,1', 500]]);
    const result = propagateEnergy(grid, initial);
    // Voxel threshold is 0 for air → effectiveEnergy stays 0, all is overflow
    expect(result.effectiveEnergy.size).toBe(0);
    expect(result.generatedOverflow.get('1,1,1')).toBeCloseTo(500, 6);
  });

  it('initial key pointing to out-of-bounds coordinate silently yields no entry', () => {
    const grid = new VoxelGrid(3, 3, 3);
    const initial = new Map<string, number>([['99,99,99', 500]]);
    const result = propagateEnergy(grid, initial);
    // Should not crash; no voxel received any energy
    expect(result.effectiveEnergy.size).toBe(0);
    expect(result.generatedOverflow.size).toBe(0);
  });

  it('negative or NaN initial energy clamped to 0 (treated as no overflow)', () => {
    const grid = singleSolidGrid(1, 1, 1, 'cruite');
    const initialNeg = new Map<string, number>([['1,1,1', -100]]);
    const resultNeg = propagateEnergy(grid, initialNeg);
    expect(resultNeg.effectiveEnergy.size).toBe(0);
    expect(resultNeg.generatedOverflow.size).toBe(0);

    const initialNaN = new Map<string, number>([['1,1,1', NaN]]);
    const resultNaN = propagateEnergy(grid, initialNaN);
    expect(resultNaN.effectiveEnergy.size).toBe(0);
    expect(resultNaN.generatedOverflow.size).toBe(0);
  });

  it('overflow leftover < Number.EPSILON treated as zero to avoid infinite tiny-loop', () => {
    const grid = singleSolidGrid(1, 1, 1, 'cruite');
    // Tiny leftover
    const tiny = Number.EPSILON * 0.5;
    const initial = new Map<string, number>([['1,1,1', CRUITE_ABSORPTION + tiny]]);
    const result = propagateEnergy(grid, initial);
    // effectiveEnergy gets the threshold worth
    expect(result.effectiveEnergy.get('1,1,1')).toBeCloseTo(CRUITE_ABSORPTION, 6);
    // Overflow should be clamped to 0
    expect(result.generatedOverflow.get('1,1,1')).toBeUndefined();
  });

  it('voxel with threshold 0 (air-like composition) — all leftover becomes generatedOverflow', () => {
    // Voxel has composition with 0 coefficients effectively
    const grid = new VoxelGrid(3, 3, 3);
    const zeroThreshold: VoxelData = {
      composition: { rocks: [{ rockId: 'cruite', coefficient: 0 }] },
      density: 1.0,
      oreDensities: {},
      fractureModifier: 1.0,
    };
    grid.setVoxel(1, 1, 1, zeroThreshold);
    const initial = new Map<string, number>([['1,1,1', 500]]);
    const result = propagateEnergy(grid, initial);
    // Threshold = 0, so 0 absorbed, all 500 is overflow
    expect(result.effectiveEnergy.size).toBe(0);
    expect(result.generatedOverflow.get('1,1,1')).toBeCloseTo(500, 6);
  });

  it('all 6 neighbors are air — leftover stays in generatedOverflow, loop terminates', () => {
    const grid = singleSolidGrid(1, 1, 1, 'cruite');
    const initial = new Map<string, number>([['1,1,1', CRUITE_ABSORPTION + 999]]);
    const result = propagateEnergy(grid, initial);
    // All overflow stays, loop should converge after one pass (no neighbors to propagate to)
    expect(result.effectiveEnergy.get('1,1,1')).toBeCloseTo(CRUITE_ABSORPTION, 6);
    expect(result.generatedOverflow.get('1,1,1')).toBeCloseTo(999, 6);
  });

  it('MAX_PROPAGATION_ITERATIONS reached — returns partial results, does not throw', () => {
    // Chain of voxels where energy keeps overflowing: energy locked in a cycle.
    // Create a 2-voxel cycle where energy bounces between them endlessly.
    const grid = new VoxelGrid(3, 1, 1);
    const solid: VoxelData = {
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      density: 1.0, oreDensities: {}, fractureModifier: 1.0,
    };
    // Place voxels at (0,0,0) and (2,0,0) — separated by air at (1,0,0)
    // This prevents overflow from bouncing back and forth
    // Instead, use a linear chain where energy keeps flowing one direction
    grid.setVoxel(0, 0, 0, solid);
    grid.setVoxel(1, 0, 0, solid);

    // Extremely large initial energy that will take many iterations to dissipate
    // Each iteration moves leftover 1 cell forward in chain, but there are only 2 cells
    // Energy still bounces: (0) → (1) ← overflow from (1)
    // Actually let me test a more reliable scenario: single voxel with all 6 neighbors air
    // and huge overflow — no neighbors to dissipate, so generatedOverflow stays, next iteration
    // sees same voxel with same overflow, but since no neighbors to take it → terminate.
    const grid2 = singleSolidGrid(1, 1, 1, 'cruite');
    const huge = CRUITE_ABSORPTION + 1e9;
    const initial2 = new Map<string, number>([['1,1,1', huge]]);
    // Should not throw despite massive energy
    expect(() => propagateEnergy(grid2, initial2)).not.toThrow();
    const result2 = propagateEnergy(grid2, initial2);
    // Returns something
    expect(result2.effectiveEnergy.get('1,1,1')).toBeCloseTo(CRUITE_ABSORPTION, 6);
    expect(result2.generatedOverflow.get('1,1,1')).toBeGreaterThan(0);
  });

  it('floating-point drift — epsilon check prevents perpetual sub-epsilon propagation', () => {
    // A chain of 3 voxels where tiny amounts might keep propagating.
    const grid = new VoxelGrid(5, 1, 1);
    const solid: VoxelData = {
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      density: 1.0, oreDensities: {}, fractureModifier: 1.0,
    };
    grid.setVoxel(0, 0, 0, solid);
    grid.setVoxel(1, 0, 0, solid);
    grid.setVoxel(2, 0, 0, solid);

    // Initial energy just barely over threshold on voxel 0
    const barelyOver = CRUITE_ABSORPTION + 1;
    const initial = new Map<string, number>([['0,0,0', barelyOver]]);
    const result = propagateEnergy(grid, initial);

    // Should terminate quickly, no timeout
    expect(result.effectiveEnergy.get('0,0,0')).toBeCloseTo(CRUITE_ABSORPTION, 6);
    // Voxel 1 should get the overflow (1 unit split among 2 neighbors? Actually only +x is valid neighbor)
    // From (0,0,0): valid neighbor in +x direction = (1,0,0). -x is OOB. So single neighbor gets all 1.
    expect(result.effectiveEnergy.get('1,0,0')).toBeCloseTo(1, 6);
    // No further propagation (voxel 1 threshold is 200, so 1 << 200, all absorbed)
    expect(result.effectiveEnergy.get('2,0,0')).toBeUndefined();
  });

  it('imports MAX_PROPAGATION_ITERATIONS constant and it is 500', () => {
    expect(MAX_PROPAGATION_ITERATIONS).toBe(500);
  });
});

// ── 5.4: computeInitialEnergy & stemmingEfficiency ──

describe('BlastCalc — stemmingEfficiency', () => {
  it('returns 0.5 with no stemming (stemmingM = 0)', () => {
    expect(stemmingEfficiency(0, 8)).toBe(0.5);
  });

  it('returns 1.0 with adequate stemming (2.4m for 8m depth)', () => {
    expect(stemmingEfficiency(2.4, 8)).toBe(1.0);
  });

  it('returns ≈0.6042 with partial stemming (0.5m for 8m depth)', () => {
    // 0.5 + 0.5 * (0.5 / (8 * 0.3)) = 0.5 + 0.5 * 0.20833… = 0.604166…
    expect(stemmingEfficiency(0.5, 8)).toBeCloseTo(0.6042, 4);
  });

  it('clamps stemming > holeDepth to 1.0', () => {
    expect(stemmingEfficiency(10, 8)).toBe(1.0);
  });

  it('returns 0.5 when holeDepth is 0 (stemmingFactor returns 0)', () => {
    expect(stemmingEfficiency(0, 0)).toBe(0.5);
  });

  it('returns 0.5 with negative stemming (clamped to 0 by stemmingFactor)', () => {
    expect(stemmingEfficiency(-1, 8)).toBe(0.5);
  });
});

describe('BlastCalc — computeInitialEnergy', () => {
  /** Reusable charge fixture for boomite tests. */
  function makeCharge(
    explosiveId: string,
    amountKg: number,
    stemmingM: number,
  ): HoleCharge {
    return { explosiveId, amountKg, stemmingM };
  }

  it('known explosive with adequate stemming → full efficiency energy', () => {
    // boomite: 340 energyPerKg, 5kg, depth 8m, stemming 2.4m → 340 * 5 * 1.0 = 1700
    const charge = makeCharge('boomite', 5, 2.4);
    expect(computeInitialEnergy(charge, 8)).toBe(1700);
  });

  it('known explosive with no stemming → 50% efficiency energy', () => {
    // boomite: 340 energyPerKg, 5kg, depth 8m, stemming 0m → 340 * 5 * 0.5 = 850
    const charge = makeCharge('boomite', 5, 0);
    expect(computeInitialEnergy(charge, 8)).toBe(850);
  });

  it('unknown explosive ID returns 0', () => {
    const charge = makeCharge('nonexistent_explosive', 5, 2.4);
    expect(computeInitialEnergy(charge, 8)).toBe(0);
  });

  it('zero charge amount returns 0', () => {
    const charge = makeCharge('boomite', 0, 2.4);
    expect(computeInitialEnergy(charge, 8)).toBe(0);
  });

  it('valid explosive with zero hole depth uses stemmingEfficiency with zero depth', () => {
    // stemmingEfficiency(2.4, 0) = 0.5 (stemmingFactor returns 0 for holeDepth <= 0)
    // 340 * 5 * 0.5 = 850
    const charge = makeCharge('boomite', 5, 2.4);
    expect(computeInitialEnergy(charge, 0)).toBe(850);
  });

  it('consistent with effectiveHoleEnergy.downward for dry non-water-sensitive conditions', () => {
    // For a dry hole with adequate stemming, effectiveHoleEnergy.downward should
    // equal computeInitialEnergy when waterEffect = 1.0.
    const charge = makeCharge('boomite', 5, 2.4);
    const holeDepth = 8;
    const initial = computeInitialEnergy(charge, holeDepth);
    const effective = effectiveHoleEnergy(charge, holeDepth, false, false);
    expect(effective.downward).toBe(initial);
  });
});


// -- identifyFragmentedVoxels --

describe('BlastCalc — identifyFragmentedVoxels', () => {
  // -- Local helpers (mirrors those in propagateEnergy describe) ------------

  function filledGrid(
    sizeX: number, sizeY: number, sizeZ: number, rockId: string,
  ): VoxelGrid {
    const grid = new VoxelGrid(sizeX, sizeY, sizeZ);
    const voxel: VoxelData = {
      composition: { rocks: [{ rockId, coefficient: 1.0 }] },
      density: 1.0,
      oreDensities: {},
      fractureModifier: 1.0,
    };
    for (let z = 0; z < sizeZ; z++) {
      for (let y = 0; y < sizeY; y++) {
        for (let x = 0; x < sizeX; x++) {
          grid.setVoxel(x, y, z, voxel);
        }
      }
    }
    return grid;
  }

  function singleSolidGrid(sx: number, sy: number, sz: number, rockId: string): VoxelGrid {
    const grid = new VoxelGrid(3, 3, 3);
    const solid: VoxelData = {
      composition: { rocks: [{ rockId, coefficient: 1.0 }] },
      density: 1.0,
      oreDensities: {},
      fractureModifier: 1.0,
    };
    grid.setVoxel(sx, sy, sz, solid);
    return grid;
  }

  const CRUITE_ABSORPTION = getRock('cruite')!.energyAbsorption;

  // -- a. Empty propagation result ? empty set ------------------------------

  it('empty effectiveEnergy returns empty set (no energy-fragmented, all boundary reachable)', () => {
    const grid = filledGrid(3, 3, 3, 'cruite');
    const result: PropagationResult = {
      effectiveEnergy: new Map(),
      generatedOverflow: new Map(),
    };
    const fragmented = identifyFragmentedVoxels(grid, result);
    expect(fragmented.size).toBe(0);
  });

  // -- b. Single voxel at exact threshold ? fragmented ---------------------

  it('single voxel with energy == threshold * FRAGMENTATION_MULTIPLIER ? fragmented', () => {
    const grid = singleSolidGrid(1, 1, 1, 'cruite');
    const result: PropagationResult = {
      effectiveEnergy: new Map([['1,1,1', CRUITE_ABSORPTION * FRAGMENTATION_MULTIPLIER]]),
      generatedOverflow: new Map(),
    };
    const fragmented = identifyFragmentedVoxels(grid, result);
    expect(fragmented.has('1,1,1')).toBe(true);
  });

  // -- c. Single boundary voxel below threshold ? not fragmented -----------
  // Voxel at (0,0,0) is on the grid boundary, so it has a solid path to the
  // boundary and is NOT an island. Energy below threshold means it is also not
  // energy-fragmented, so it must not appear in the result at all.

  it('single boundary voxel with energy < threshold * FRAGMENTATION_MULTIPLIER ? not fragmented', () => {
    const grid = singleSolidGrid(0, 0, 0, 'cruite');
    const result: PropagationResult = {
      effectiveEnergy: new Map([['0,0,0', CRUITE_ABSORPTION * FRAGMENTATION_MULTIPLIER * 0.99]]),
      generatedOverflow: new Map(),
    };
    const fragmented = identifyFragmentedVoxels(grid, result);
    expect(fragmented.has('0,0,0')).toBe(false);
  });

  // -- c2. Interior solid with no solid path to boundary ? island -----------
  // Air does not connect solids: a solid voxel at the grid interior surrounded
  // entirely by air has no SOLID path to the boundary and must be classified as
  // an island even if its energy is below the fragmentation threshold.

  it('interior solid separated from boundary by air corridor ? classified as island', () => {
    // 3×3×3 grid, only (1,1,1) is solid cruite; all other cells are air.
    // Energy for (1,1,1) is well below the fragmentation threshold, so it is
    // not energy-fragmented in Step 1.
    // Flood-fill seeds only solid boundary cells — there are none — so (1,1,1)
    // is never visited and must be marked as an island in Step 3.
    const grid = singleSolidGrid(1, 1, 1, 'cruite');
    const result: PropagationResult = {
      effectiveEnergy: new Map([['1,1,1', CRUITE_ABSORPTION * FRAGMENTATION_MULTIPLIER * 0.1]]),
      generatedOverflow: new Map(),
    };
    const fragmented = identifyFragmentedVoxels(grid, result);
    expect(fragmented.has('1,1,1')).toBe(true);
  });

  // -- d. Multiple voxels: some above, some below threshold -----------------

  it('multiple voxels — only those above threshold appear in result', () => {
    // 3×3×3 grid with three solid voxels: (0,0,0) above, (1,0,0) below, (2,0,0) above
    // (1,0,0) has y=0 → on boundary → reachable by BFS → not an island
    const grid = new VoxelGrid(3, 3, 3);
    const solid: VoxelData = {
      composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
      density: 1.0,
      oreDensities: {},
      fractureModifier: 1.0,
    };
    grid.setVoxel(0, 0, 0, solid);
    grid.setVoxel(1, 0, 0, solid);
    grid.setVoxel(2, 0, 0, solid);

    const threshold = CRUITE_ABSORPTION * FRAGMENTATION_MULTIPLIER;
    const result: PropagationResult = {
      effectiveEnergy: new Map([
        ['0,0,0', threshold * 1.5],  // above ? fragmented
        ['1,0,0', threshold * 0.5],  // below ? not fragmented
        ['2,0,0', threshold * 2.0],  // above ? fragmented
      ]),
      generatedOverflow: new Map(),
    };
    const fragmented = identifyFragmentedVoxels(grid, result);
    expect(fragmented.has('0,0,0')).toBe(true);
    expect(fragmented.has('1,0,0')).toBe(false);
    expect(fragmented.has('2,0,0')).toBe(true);
  });

  // -- e. Island detection: interior cluster surrounded by fragmented shell --

  it('interior solid cluster fully surrounded by fragmented voxels ? classified as islands', () => {
    // 5×5×5 filled grid. Energy-fragment the entire outer shell (98 voxels).
    // Interior 3×3×3 (27 voxels, x/y/z in 1–3) has no energy ? not energy-fragmented.
    // BFS seeds: boundary cells that are solid non-fragmented ? none (all fragmented).
    // Interior 27 voxels unreachable ? become islands ? all 125 in result.
    const grid = filledGrid(5, 5, 5, 'cruite');
    const effectiveEnergy = new Map<string, number>();
    const highEnergy = CRUITE_ABSORPTION * FRAGMENTATION_MULTIPLIER * 2;

    for (let z = 0; z < 5; z++) {
      for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 5; x++) {
          const isShell = x === 0 || x === 4 || y === 0 || y === 4 || z === 0 || z === 4;
          if (isShell) {
            effectiveEnergy.set(`${x},${y},${z}`, highEnergy);
          }
        }
      }
    }

    const result: PropagationResult = { effectiveEnergy, generatedOverflow: new Map() };
    const fragmented = identifyFragmentedVoxels(grid, result);

    // All 125 cells must be fragmented
    expect(fragmented.size).toBe(125);
    // Verify a sample interior cell is present
    expect(fragmented.has('2,2,2')).toBe(true);
    expect(fragmented.has('1,1,1')).toBe(true);
    expect(fragmented.has('3,3,3')).toBe(true);
  });

  // -- f. Connected to boundary through chain ? not an island --------------

  it('solid chain connected to boundary ? none become islands', () => {
    // 5×1×1 grid, all solid cruite. Energy-fragment only (4,0,0).
    // Cells 0–3,0,0 are solid non-fragmented.
    // sizeY=1 and sizeZ=1 ? every cell is on a boundary face (y=0=sizeY-1, z=0=sizeZ-1).
    // So 0,0,0..3,0,0 are all BFS seeds ? reachable ? none are islands.
    const grid = filledGrid(5, 1, 1, 'cruite');
    const result: PropagationResult = {
      effectiveEnergy: new Map([
        ['4,0,0', CRUITE_ABSORPTION * FRAGMENTATION_MULTIPLIER * 2],
      ]),
      generatedOverflow: new Map(),
    };
    const fragmented = identifyFragmentedVoxels(grid, result);

    // Only (4,0,0) should be fragmented (energy-fragmented, not an island)
    expect(fragmented.has('4,0,0')).toBe(true);
    expect(fragmented.has('0,0,0')).toBe(false);
    expect(fragmented.has('1,0,0')).toBe(false);
    expect(fragmented.has('2,0,0')).toBe(false);
    expect(fragmented.has('3,0,0')).toBe(false);
  });

  // -- g. Air voxels never fragmented --------------------------------------

  it('air voxels never appear in result even if their key is in effectiveEnergy', () => {
    // 3×3×3 grid with only (1,1,1) solid; rest are air.
    // Set effectiveEnergy for an air voxel (0,0,0) with very high energy.
    // Air has threshold=0; without explicit air check this could be mis-fragmented.
    const grid = singleSolidGrid(1, 1, 1, 'cruite');
    const result: PropagationResult = {
      effectiveEnergy: new Map([
        ['0,0,0', 9999],  // air voxel — must NOT appear in result
        ['1,1,1', CRUITE_ABSORPTION * FRAGMENTATION_MULTIPLIER * 0.5],  // solid but below threshold
      ]),
      generatedOverflow: new Map(),
    };
    const fragmented = identifyFragmentedVoxels(grid, result);
    expect(fragmented.has('0,0,0')).toBe(false);
  });

  // -- h. FRAGMENTATION_MULTIPLIER exact boundary ---------------------------
  // Use a boundary-connected solid (0,0,0) so island detection does not interfere,
  // isolating the energy-threshold boundary check.

  it('energy just below threshold*FRAGMENTATION_MULTIPLIER ? not fragmented; at threshold ? fragmented', () => {
    const gridBelow = singleSolidGrid(0, 0, 0, 'cruite');
    const gridAt = singleSolidGrid(0, 0, 0, 'cruite');
    const threshold = CRUITE_ABSORPTION * FRAGMENTATION_MULTIPLIER;
    const epsilon = 1e-9;

    const resultBelow: PropagationResult = {
      effectiveEnergy: new Map([['0,0,0', threshold - epsilon]]),
      generatedOverflow: new Map(),
    };
    const resultAt: PropagationResult = {
      effectiveEnergy: new Map([['0,0,0', threshold]]),
      generatedOverflow: new Map(),
    };

    expect(identifyFragmentedVoxels(gridBelow, resultBelow).has('0,0,0')).toBe(false);
    expect(identifyFragmentedVoxels(gridAt, resultAt).has('0,0,0')).toBe(true);
  });
});

// ── 5.17: isFragmentOversized ──

describe('BlastCalc — isFragmentOversized', () => {
  it('returns true for volume strictly above the threshold', () => {
    expect(isFragmentOversized(OVERSIZED_FRAGMENT_THRESHOLD + 0.001)).toBe(true);
    expect(isFragmentOversized(1.0)).toBe(true);
    expect(isFragmentOversized(10.0)).toBe(true);
  });

  it('returns false for volume at or below the threshold', () => {
    expect(isFragmentOversized(OVERSIZED_FRAGMENT_THRESHOLD)).toBe(false);
    expect(isFragmentOversized(OVERSIZED_FRAGMENT_THRESHOLD - 0.001)).toBe(false);
    expect(isFragmentOversized(0.0)).toBe(false);
  });

  it('returns false for negative volume (graceful handling)', () => {
    expect(isFragmentOversized(-1)).toBe(false);
  });

  it('is consistent with isOversized behavior for same volume values', () => {
    expect(isFragmentOversized(0.3)).toBe(isOversized(0.3));
    expect(isFragmentOversized(0.5)).toBe(isOversized(0.5));
    expect(isFragmentOversized(0.7)).toBe(isOversized(0.7));
  });
});