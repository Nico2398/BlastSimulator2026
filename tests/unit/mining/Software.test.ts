import { describe, it, expect, beforeEach } from 'vitest';
import {
  purchaseSoftware,
  previewEnergy,
  previewFragments,
  previewProjections,
  previewBlastOutcome,
  previewVibrations,
  previewHoleDetails,
  previewFragmentDistribution,
  fragmentDistributionFrom,
  MAX_SOFTWARE_TIER,
  SOFTWARE_TIER_COSTS,
} from '../../../src/core/mining/Software.js';
import { dryRunBlast } from '../../../src/core/mining/BlastDryRun.js';
import {
  MAX_PROJECTION_VELOCITY,
  SOFTWARE_TIER_FRAGMENTS,
  SOFTWARE_TIER_PROJECTIONS,
  SOFTWARE_TIER_VIBRATIONS,
  SOFTWARE_TIER_OPTIMIZER,
  BLAST_PREVIEW_SHAPE,
} from '../../../src/core/config/balance.js';
import { createGridPlan } from '../../../src/core/mining/DrillPlan.js';
import { batchCharge } from '../../../src/core/mining/ChargePlan.js';
import { assembleBlastPlan } from '../../../src/core/mining/BlastPlan.js';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import { vec3 } from '../../../src/core/math/Vec3.js';
import { executeBlast, buildBlastReport } from '../../../src/core/mining/BlastExecution.js';
import { makeTestPlan } from './softwareTestFixtures.js';
import { buildWallGrid, standardShot } from '../../helpers/wallWarningFixture.js';
import { readFileSync } from 'node:fs';

const holeCounter = { nextHoleId: 1 };

beforeEach(() => { holeCounter.nextHoleId = 1; });

describe('Software — purchase', () => {
  it('purchase tier 1 succeeds with enough cash', () => {
    const result = purchaseSoftware(0, 10000);
    expect('newTier' in result && result.newTier).toBe(1);
  });

  it('purchase fails with insufficient funds', () => {
    const result = purchaseSoftware(0, 100);
    expect('error' in result).toBe(true);
  });

  it('purchase fails at max tier', () => {
    const result = purchaseSoftware(MAX_SOFTWARE_TIER, 100000);
    expect('error' in result).toBe(true);
  });
});

describe('Software — tier line-up (#2201)', () => {
  it('names the tier each preview unlocks: fragments 1, projections 2, vibrations 3, optimizer 4', () => {
    expect(SOFTWARE_TIER_FRAGMENTS).toBe(1);
    expect(SOFTWARE_TIER_PROJECTIONS).toBe(2);
    expect(SOFTWARE_TIER_VIBRATIONS).toBe(3);
    expect(SOFTWARE_TIER_OPTIMIZER).toBe(4);
  });

  it('keeps four tiers and their prices', () => {
    expect(MAX_SOFTWARE_TIER).toBe(4);
    expect(SOFTWARE_TIER_COSTS).toEqual([0, 500, 2000, 5000, 12000]);
    expect(MAX_SOFTWARE_TIER).toBe(SOFTWARE_TIER_OPTIMIZER);
  });

  it('versions the persisted preview shape at 2', () => {
    expect(BLAST_PREVIEW_SHAPE).toBe(2);
  });

  it('purchasing walks the tiers one at a time at the unchanged prices', () => {
    for (let tier = 0; tier < MAX_SOFTWARE_TIER; tier++) {
      const result = purchaseSoftware(tier, 1_000_000);
      expect(result).toEqual({ newTier: tier + 1, cost: SOFTWARE_TIER_COSTS[tier + 1] });
    }
  });
});

describe('Software — preview tiers', () => {
  it('previewEnergy with tier 0 returns the energy preview too (#2200: the heatmap needs no software tier)', () => {
    const { grid, plan } = makeTestPlan();
    const result = previewEnergy(plan, grid, 0);
    expect(result).not.toBeNull();
    expect(result!.energyMap.size).toBeGreaterThan(0);
    expect(result!.maxEnergy).toBeGreaterThan(0);
  });

  it.each([0, 1, 2, 3, 4])('previewEnergy at tier %i returns the same energy data', (tier) => {
    const { grid, plan } = makeTestPlan();
    expect(previewEnergy(plan, grid, tier)).toEqual(previewEnergy(plan, grid, 0));
  });

  it('previewEnergy at tier 0 with nothing charged returns an empty preview, not null', () => {
    const { grid, plan } = makeTestPlan();
    const result = previewEnergy({ holes: plan.holes, charges: {} }, grid, 0);
    expect(result).not.toBeNull();
    expect(result!.energyMap.size).toBe(0);
    expect(result!.maxEnergy).toBe(0);
  });

  it('the fragment, projection and vibration previews are all locked at tier 0', () => {
    const { grid, plan } = makeTestPlan();
    const villages = [{ id: 'v1', position: vec3(100, 0, 100) }];
    expect(previewFragments(plan, grid, 0)).toBeNull();
    expect(previewProjections(plan, grid, 0)).toBeNull();
    expect(previewVibrations(plan, villages, 0)).toBeNull();
  });

  it('previewFragments requires tier >= 1', () => {
    const { grid, plan } = makeTestPlan();
    expect(previewFragments(plan, grid, 0)).toBeNull();
    for (const tier of [1, 2, 3, 4]) {
      const result = previewFragments(plan, grid, tier);
      expect(result, `tier ${tier}`).not.toBeNull();
      expect(result!.fracturedCount + result!.crackedCount + result!.unaffectedCount).toBeGreaterThan(0);
    }
  });

  it('previewProjections requires tier >= 2', () => {
    const { grid, plan } = makeTestPlan();
    expect(previewProjections(plan, grid, 0)).toBeNull();
    expect(previewProjections(plan, grid, 1)).toBeNull();
    for (const tier of [2, 3, 4]) {
      const result = previewProjections(plan, grid, tier);
      expect(result, `tier ${tier}`).not.toBeNull();
      expect(typeof result!.projectionZoneCount).toBe('number');
    }
  });

  it('previewVibrations requires tier >= 3', () => {
    const { plan } = makeTestPlan();
    const villages = [{ id: 'v1', position: vec3(100, 0, 100) }];
    expect(previewVibrations(plan, villages, 0)).toBeNull();
    expect(previewVibrations(plan, villages, 1)).toBeNull();
    expect(previewVibrations(plan, villages, 2)).toBeNull();
    for (const tier of [3, 4]) {
      const result = previewVibrations(plan, villages, tier);
      expect(result, `tier ${tier}`).not.toBeNull();
      expect(result!.villages.length).toBe(1);
      expect(result!.maxVibration).toBeGreaterThan(0);
    }
  });
});

describe('Software — previewHoleDetails', () => {
  it('returns empty record below tier 1', () => {
    const { grid, plan } = makeTestPlan();
    expect(previewHoleDetails(plan, grid, 0)).toEqual({});
  });

  it('at tier >= 1, gives every charged hole a predicted fragment size in cm', () => {
    const { grid, plan } = makeTestPlan();
    const details = previewHoleDetails(plan, grid, 1);
    const holeIds = plan.holes.map(h => h.id);
    expect(holeIds.length).toBeGreaterThan(0);
    for (const id of holeIds) {
      expect(details[id]).toBeDefined();
      expect(details[id]!.fragSizeCm).toBeGreaterThan(0);
      // Tier 1 only — no projection speed yet.
      expect(details[id]!.projectionSpeedMs).toBeUndefined();
    }
  });

  it('fragSizeCm is the same at every tier that has it', () => {
    const { grid, plan } = makeTestPlan();
    const base = previewHoleDetails(plan, grid, 1);
    for (const tier of [2, 3, 4]) {
      for (const hole of plan.holes) {
        expect(previewHoleDetails(plan, grid, tier)[hole.id]!.fragSizeCm).toBe(base[hole.id]!.fragSizeCm);
      }
    }
  });

  it('at tier >= 2, adds projectionSpeedMs only for holes predicted to project', () => {
    const { grid, plan } = makeTestPlan();
    const details = previewHoleDetails(plan, grid, 2);
    for (const hole of plan.holes) {
      const detail = details[hole.id];
      expect(detail).toBeDefined();
      if (detail!.projectionSpeedMs !== undefined) {
        expect(detail!.projectionSpeedMs).toBeGreaterThan(0);
        expect(detail!.projectionSpeedMs).toBeLessThanOrEqual(MAX_PROJECTION_VELOCITY);
      }
    }
  });

  it('skips holes with no charge', () => {
    const { grid, plan } = makeTestPlan();
    const uncharged = { ...plan, charges: {} };
    expect(previewHoleDetails(uncharged, grid, 2)).toEqual({});
  });

  it('#1186: still returns a detail entry when the hole surface sits below y=0', () => {
    // Same 2x2 hole pattern/plan as makeTestPlan, just shifted 15 voxels down
    // so the surface (and every charge column) resolves to negative Y.
    const grid = new VoxelGrid(30, 30);
    for (let z = 5; z <= 20; z++)
      for (let y = -15; y <= -7; y++)
        for (let x = 5; x <= 20; x++)
          grid.setVoxel(x, y, z, { composition: { rocks: [{ rockId: 'molite', coefficient: 1.0 }] }, density: 1.0, oreDensities: {}, fractureModifier: 1.0 });

    const holes = createGridPlan(holeCounter, { x: 10, z: 10 }, 2, 2, 3, 6, 0.089);
    const holeIds = holes.map(h => h.id);
    const holeDepths: Record<string, number> = {};
    for (const h of holes) holeDepths[h.id] = h.depth;
    const { charges } = batchCharge(holeIds, holeDepths, 'boomite', 5, 2);
    const plan = assembleBlastPlan(holes, charges);

    const details = previewHoleDetails(plan, grid, 1);
    expect(holeIds.length).toBeGreaterThan(0);
    for (const id of holeIds) {
      expect(details[id]).toBeDefined();
      expect(details[id]!.fragSizeCm).toBeGreaterThan(0);
    }
  });
});

describe('Software — wet-hole modelling (#1347)', () => {
  const allWet = (plan: { holes: Array<{ id: string }> }) => new Set(plan.holes.map(h => h.id));

  /** Same grid/pattern as makeTestPlan, but charged with the given explosive. */
  function planWith(explosiveId: string, amountKg = 8, stemmingM = 0.5) {
    const { grid } = makeTestPlan();
    const holes = createGridPlan(holeCounter, { x: 10, z: 10 }, 2, 2, 3, 6, 0.089);
    const depths: Record<string, number> = {};
    for (const h of holes) depths[h.id] = h.depth;
    const { charges } = batchCharge(holes.map(h => h.id), depths, explosiveId, amountKg, stemmingM);
    return { grid, plan: assembleBlastPlan(holes, charges) };
  }

  it('previewEnergy retains less total energy over a smaller footprint when holes are wet (water-sensitive explosive)', () => {
    // Per-voxel energy saturates at the rock's absorption threshold, so max/min can
    // coincide; the total retained and the number of energised voxels do not.
    const { grid, plan } = planWith('big_bada_boom');
    const dry = previewEnergy(plan, grid, 0)!;
    const wet = previewEnergy(plan, grid, 0, allWet(plan))!;
    const total = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
    expect(wet.energyMap.size).toBeLessThan(dry.energyMap.size);
    expect(total(wet.energyMap)).toBeLessThan(total(dry.energyMap));
    expect(wet.maxEnergy).toBeLessThanOrEqual(dry.maxEnergy);
  });

  it('previewFragments reports fewer fractured voxels wet than dry', () => {
    const { grid, plan } = planWith('big_bada_boom');
    const dry = previewFragments(plan, grid, 1)!;
    const wet = previewFragments(plan, grid, 1, allWet(plan))!;
    expect(wet.fracturedCount).toBeLessThan(dry.fracturedCount);
  });

  it('previewFragments wet cracked count matches executeBlast with the same wet set, and both drop vs dry', () => {
    const { grid, plan } = planWith('big_bada_boom');
    const wetIds = allWet(plan);
    const dry = previewFragments(plan, grid, 1)!;
    const preview = previewFragments(plan, grid, 1, wetIds)!;
    const result = executeBlast(plan, makeTestPlan().grid, [], undefined, undefined, undefined, wetIds)!;
    const dryResult = executeBlast(plan, makeTestPlan().grid, [])!;
    // Guard: wet must differ from dry, else the checks below prove nothing.
    expect(preview.fracturedCount).not.toBe(dry.fracturedCount);
    expect(preview.crackedCount).not.toBe(dry.crackedCount);
    // clearedVoxels also counts voxels cleared beyond the fractured set, so only the
    // direction is comparable; the cracked count is the exact cross-check.
    expect(result.clearedVoxels).toBeLessThan(dryResult.clearedVoxels);
    expect(preview.crackedCount).toBe(result.crackedVoxels);
  });

  it('previewProjections differs wet vs dry for a water-sensitive explosive', () => {
    const { grid, plan } = planWith('big_bada_boom');
    const dry = previewProjections(plan, grid, 2)!;
    const wet = previewProjections(plan, grid, 2, allWet(plan))!;
    expect(wet.projectionZoneCount).not.toBe(dry.projectionZoneCount);
  });

  it('previewHoleDetails reflects wet holes: coarser fragments or no projection', () => {
    const { grid, plan } = planWith('big_bada_boom', 8, 1.8); // heavy charge: collar voxel is energised, so wet is measurable
    const dry = previewHoleDetails(plan, grid, 2);
    const wet = previewHoleDetails(plan, grid, 2, allWet(plan));
    const changed = plan.holes.some(h => {
      const d = dry[h.id], w = wet[h.id];
      if (!d || !w) return false;
      const coarser = (w.fragSizeCm ?? 0) > (d.fragSizeCm ?? 0);
      const lostProjection = d.projectionSpeedMs !== undefined && w.projectionSpeedMs === undefined;
      const slower = d.projectionSpeedMs !== undefined && w.projectionSpeedMs !== undefined
        && w.projectionSpeedMs < d.projectionSpeedMs;
      return coarser || lostProjection || slower;
    });
    expect(changed).toBe(true);
  });

  it('only the wet holes are weakened in previewHoleDetails', () => {
    const { grid, plan } = planWith('big_bada_boom', 8, 1.8); // heavy charge: collar voxel is energised, so wet is measurable
    const dry = previewHoleDetails(plan, grid, 1);
    const first = plan.holes[0]!.id;
    const wet = previewHoleDetails(plan, grid, 1, new Set([first]));
    expect(wet[first]!.fragSizeCm).toBeGreaterThan(dry[first]!.fragSizeCm!);
    const other = plan.holes[plan.holes.length - 1]!.id;
    expect(wet[other]!.fragSizeCm).toBeCloseTo(dry[other]!.fragSizeCm!, 6);
  });

  describe('water-resistant explosive', () => {
    it('wet set gives identical previews to the dry results', () => {
      const { grid, plan } = planWith('krackle');
      const wetIds = allWet(plan);
      expect(previewEnergy(plan, grid, 0, wetIds)!.maxEnergy).toBe(previewEnergy(plan, grid, 0)!.maxEnergy);
      expect(previewFragments(plan, grid, 1, wetIds)).toEqual(previewFragments(plan, grid, 1));
      expect(previewProjections(plan, grid, 2, wetIds)).toEqual(previewProjections(plan, grid, 2));
      expect(previewHoleDetails(plan, grid, 2, wetIds)).toEqual(previewHoleDetails(plan, grid, 2));
    });
  });

  describe('omitted wetHoleIds', () => {
    it('equals an explicit empty set, and differs from an all-wet set', () => {
      const { grid, plan } = planWith('big_bada_boom');
      const empty = new Set<string>();
      expect(previewEnergy(plan, grid, 0)).toEqual(previewEnergy(plan, grid, 0, empty));
      expect(previewFragments(plan, grid, 1)).toEqual(previewFragments(plan, grid, 1, empty));
      expect(previewProjections(plan, grid, 2)).toEqual(previewProjections(plan, grid, 2, empty));
      expect(previewHoleDetails(plan, grid, 2)).toEqual(previewHoleDetails(plan, grid, 2, empty));
      expect(previewFragments(plan, grid, 1)!.fracturedCount)
        .not.toBe(previewFragments(plan, grid, 1, allWet(plan))!.fracturedCount);
    });
  });

  it('an id that is not in the plan changes nothing', () => {
    const { grid, plan } = planWith('big_bada_boom');
    expect(previewFragments(plan, grid, 1, new Set(['no-such-hole'])))
      .toEqual(previewFragments(plan, grid, 1));
  });
});

describe('Software — previewBlastOutcome (#1968)', () => {
  it.each([0, 1])('is null at tier %i', (tier) => {
    const { grid, plan } = makeTestPlan();
    expect(previewBlastOutcome(plan, grid, tier, [], 1, new Set())).toBeNull();
  });

  it.each([2, 3, 4])('forecasts rating and counts at tier %i', (tier) => {
    const { grid, plan } = makeTestPlan();
    const forecast = previewBlastOutcome(plan, grid, tier, [], 1, new Set());
    expect(forecast).not.toBeNull();
    expect(['perfect', 'good', 'mediocre', 'bad', 'catastrophic']).toContain(forecast!.rating);
    expect(forecast!.fragmentCount).toBeGreaterThan(0);
    expect(forecast!.thrownShare).toBeGreaterThanOrEqual(0);
    expect(forecast!.thrownShare).toBeLessThanOrEqual(1);
  });

  it('does not mutate the grid it previews', () => {
    const { grid, plan } = makeTestPlan();
    const before = JSON.stringify(grid.edits.columns());
    previewBlastOutcome(plan, grid, 2, [], 1, new Set());
    expect(JSON.stringify(grid.edits.columns())).toBe(before);
    expect(grid.getVoxel(10, 8, 10)).toBeDefined();
  });

  it('matches the real blast rating', () => {
    const a = makeTestPlan();
    const b = makeTestPlan();
    const forecast = previewBlastOutcome(a.plan, a.grid, 2, [], 1, new Set())!;
    expect(forecast.rating).toBe(buildBlastReport(executeBlast(b.plan, b.grid, [], 1)!, 0, 0).rating);
  });
});

describe('Software — previewFragments vs the real blast (#1968)', () => {
  it('fracturedCount equals executeBlast clearedVoxels', () => {
    const a = makeTestPlan();
    const b = makeTestPlan();
    const preview = previewFragments(a.plan, a.grid, 1)!;
    expect(preview.fracturedCount).toBe(executeBlast(b.plan, b.grid, [], 1)!.clearedVoxels);
  });

  it('fracturedCount equals clearedVoxels on the wall/crater fixture', () => {
    const plan = standardShot().plan;
    const preview = previewFragments(plan, buildWallGrid({ plateauTop: 20 }), 1)!;
    const real = executeBlast(plan, buildWallGrid({ plateauTop: 20 }), [], 1)!;
    expect(real.clearedVoxels).toBeGreaterThan(0);
    expect(preview.fracturedCount).toBe(real.clearedVoxels);
  });
});

describe('Software — rating logic is not duplicated (#1968)', () => {
  it.each(['Software.ts', 'SoftwarePreview.ts', 'BlastDryRun.ts'])('%s does not use THROW_DISTANCE_*', (file) => {
    const src = readFileSync(`src/core/mining/${file}`, 'utf8');
    expect(src).not.toMatch(/THROW_DISTANCE_/);
  });

  it('BlastExecution remains the one place the throw thresholds are applied', () => {
    expect(readFileSync('src/core/mining/BlastExecution.ts', 'utf8')).toMatch(/THROW_DISTANCE_BAD/);
  });
});

describe('Software — fragmentDistributionFrom (#2201)', () => {
  const FORECAST = {
    rating: 'good' as const,
    fragmentCount: 120,
    projectionCount: 10,
    thrownShare: 10 / 120,
    furthestThrowM: 7,
    clearedVoxels: 55,
    bandVolumes: { intact: 9, cracked: 8, good: 31, fines: 12, dust: 5 },
    oversizedFragments: 4,
    dustLossMassKg: 1234,
    dustLossValue: 567,
  };

  it('reads the band volumes, counts and dust loss off the forecast', () => {
    const dist = fragmentDistributionFrom(FORECAST);
    expect(dist.bandVolumes).toEqual(FORECAST.bandVolumes);
    expect(dist.fragmentCount).toBe(FORECAST.fragmentCount);
    expect(dist.oversizedFragments).toBe(FORECAST.oversizedFragments);
    expect(dist.dustLossMassKg).toBe(FORECAST.dustLossMassKg);
    expect(dist.dustLossValue).toBe(FORECAST.dustLossValue);
  });

  it('names the good, fines and dust volumes from their bands', () => {
    const dist = fragmentDistributionFrom(FORECAST);
    expect(dist.goodVolumeM3).toBe(FORECAST.bandVolumes.good);
    expect(dist.finesVolumeM3).toBe(FORECAST.bandVolumes.fines);
    expect(dist.dustVolumeM3).toBe(FORECAST.bandVolumes.dust);
  });

  it('a forecast of nothing broken gives a zeroed distribution', () => {
    const empty = {
      ...FORECAST, fragmentCount: 0, projectionCount: 0, thrownShare: 0, furthestThrowM: 0, clearedVoxels: 0,
      bandVolumes: { intact: 0, cracked: 0, good: 0, fines: 0, dust: 0 },
      oversizedFragments: 0, dustLossMassKg: 0, dustLossValue: 0,
    };
    const dist = fragmentDistributionFrom(empty);
    expect(dist.fragmentCount).toBe(0);
    expect(dist.oversizedFragments).toBe(0);
    expect(dist.goodVolumeM3).toBe(0);
    expect(dist.finesVolumeM3).toBe(0);
    expect(dist.dustVolumeM3).toBe(0);
    expect(dist.dustLossMassKg).toBe(0);
    expect(dist.dustLossValue).toBe(0);
  });

  it('does not alias or change the forecast it reads', () => {
    const forecast = { ...FORECAST, bandVolumes: { ...FORECAST.bandVolumes } };
    fragmentDistributionFrom(forecast);
    expect(forecast).toEqual(FORECAST);
  });
});

describe('Software — previewFragmentDistribution (#2201)', () => {
  const GROUND = 1;
  const NO_WET: ReadonlySet<string> = new Set();

  it.each([0])('is null at tier %i', (tier) => {
    const { grid, plan } = makeTestPlan();
    expect(previewFragmentDistribution(plan, grid, tier, [], GROUND, NO_WET)).toBeNull();
  });

  it.each([1, 2, 3, 4])('returns the distribution at tier %i', (tier) => {
    const { grid, plan } = makeTestPlan();
    const dist = previewFragmentDistribution(plan, grid, tier, [], GROUND, NO_WET);
    expect(dist).not.toBeNull();
    expect(dist!.fragmentCount).toBeGreaterThan(0);
    expect(dist!.goodVolumeM3 + dist!.finesVolumeM3 + dist!.dustVolumeM3).toBeGreaterThan(0);
  });

  it('is null for a plan with no holes, even when the tier is owned', () => {
    const { grid } = makeTestPlan();
    expect(previewFragmentDistribution(assembleBlastPlan([], {}), grid, 4, [], GROUND, NO_WET)).toBeNull();
  });

  it('a plan with holes and no charge is null or zeroed, never a made-up distribution', () => {
    const { grid, plan } = makeTestPlan();
    const dist = previewFragmentDistribution({ holes: plan.holes, charges: {} }, grid, 1, [], GROUND, NO_WET);
    if (dist !== null) {
      expect(dist.fragmentCount).toBe(0);
      expect(dist.oversizedFragments).toBe(0);
      expect(dist.goodVolumeM3 + dist.finesVolumeM3 + dist.dustVolumeM3).toBe(0);
      expect(dist.dustLossMassKg).toBe(0);
      expect(dist.dustLossValue).toBe(0);
    }
  });

  it('equals the distribution of the dry-run forecast', () => {
    const { grid, plan } = makeTestPlan();
    const forecast = dryRunBlast(plan, grid, [], GROUND, NO_WET)!;
    expect(previewFragmentDistribution(plan, grid, 1, [], GROUND, NO_WET)).toEqual(fragmentDistributionFrom(forecast));
  });

  it('matches the real blast: band volumes, oversized count, fragment count and dust loss', () => {
    const plan = standardShot().plan;
    const dist = previewFragmentDistribution(plan, buildWallGrid({ plateauTop: 20 }), 1, [], GROUND, NO_WET)!;
    const real = executeBlast(plan, buildWallGrid({ plateauTop: 20 }), [], GROUND)!;
    expect(dist.bandVolumes).toEqual(real.bandVolumes);
    expect(dist.oversizedFragments).toBe(real.oversizedFragments);
    expect(dist.fragmentCount).toBe(real.fragmentCount);
    expect(dist.dustLossMassKg).toBeCloseTo(real.dustLoss.massKg, 6);
    expect(dist.dustLossValue).toBeCloseTo(real.dustLoss.oreValue, 6);
  });

  it('does not mutate the grid it previews', () => {
    const { grid, plan } = makeTestPlan();
    const before = JSON.stringify(grid.edits.columns());
    previewFragmentDistribution(plan, grid, 1, [], GROUND, NO_WET);
    expect(JSON.stringify(grid.edits.columns())).toBe(before);
  });

  it('is repeatable on the same grid', () => {
    const { grid, plan } = makeTestPlan();
    expect(previewFragmentDistribution(plan, grid, 1, [], GROUND, NO_WET))
      .toEqual(previewFragmentDistribution(plan, grid, 1, [], GROUND, NO_WET));
  });

  it('models wet holes with the set it is given', () => {
    const { grid } = makeTestPlan();
    const holes = createGridPlan(holeCounter, { x: 10, z: 10 }, 2, 2, 3, 6, 0.089);
    const depths: Record<string, number> = {};
    for (const h of holes) depths[h.id] = h.depth;
    const { charges } = batchCharge(holes.map(h => h.id), depths, 'big_bada_boom', 8, 0.5);
    const plan = assembleBlastPlan(holes, charges);
    const wet = new Set(holes.map(h => h.id));
    const dist = previewFragmentDistribution(plan, grid, 1, [], GROUND, wet)!;
    expect(dist).toEqual(fragmentDistributionFrom(dryRunBlast(plan, grid, [], GROUND, wet)!));
    expect(dist).not.toEqual(previewFragmentDistribution(plan, grid, 1, [], GROUND, NO_WET));
  });
});
