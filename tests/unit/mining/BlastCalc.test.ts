import { describe, it, expect, beforeEach } from 'vitest';
import {
  calculateHoleEnergy,
  stemmingFactor,
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
  OVERSIZED_FRAGMENT_THRESHOLD,
  resetBoulderFragIds,
  computeThreshold,
  type Boulder,
} from '../../../src/core/mining/BlastCalc.js';
import type { VoxelData } from '../../../src/core/world/VoxelGrid.js';
import { getRock } from '../../../src/core/world/RockCatalog.js';
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
