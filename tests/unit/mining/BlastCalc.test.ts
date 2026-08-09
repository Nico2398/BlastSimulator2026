import { describe, it, expect, beforeEach } from 'vitest';
import {
  calculateHoleEnergy,
  stemmingFactor,
  stemmingEfficiency,
  waterEffect,
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

describe('BlastCalc — charge energy', () => {
  it('a bigger charge of the same explosive carries more energy', () => {
    const small = calculateHoleEnergy({ explosiveId: 'boomite', amountKg: 2, stemmingM: 2 });
    const big = calculateHoleEnergy({ explosiveId: 'boomite', amountKg: 8, stemmingM: 2 });
    expect(big).toBeGreaterThan(small);
    expect(big / small).toBeCloseTo(4, 6);
  });

  it('a stronger explosive carries more energy per kilogram', () => {
    const weak = calculateHoleEnergy({ explosiveId: 'pop_rock', amountKg: 4, stemmingM: 2 });
    const strong = calculateHoleEnergy({ explosiveId: 'dynatomics', amountKg: 4, stemmingM: 2 });
    expect(strong).toBeGreaterThan(weak);
  });

  it('an unknown explosive carries none', () => {
    expect(calculateHoleEnergy({ explosiveId: 'not_a_thing', amountKg: 5, stemmingM: 2 })).toBe(0);
  });
});
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

  it('defaults isFlooded to false, matching a dry hole', () => {
    const charge = makeCharge('boomite', 5, 2.4);
    expect(computeInitialEnergy(charge, 8)).toBe(computeInitialEnergy(charge, 8, false));
  });

  it('flooded + water-sensitive explosive drops to 10% energy (waterEffect)', () => {
    // boomite is waterSensitive:true. 340 * 5 * 1.0 * 0.1 = 170
    const charge = makeCharge('boomite', 5, 2.4);
    expect(computeInitialEnergy(charge, 8, true)).toBe(170);
  });

  it('flooded + water-resistant explosive is unaffected', () => {
    // krackle is waterSensitive:false. 400 * 5 * 1.0 = 2000, same flooded or dry.
    const charge = makeCharge('krackle', 5, 2.4);
    expect(computeInitialEnergy(charge, 8, true)).toBe(computeInitialEnergy(charge, 8, false));
  });
});


// -- identifyFragmentedVoxels --

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