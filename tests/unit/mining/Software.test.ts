import { describe, it, expect, beforeEach } from 'vitest';
import {
  purchaseSoftware,
  previewEnergy,
  previewFragments,
  previewProjections,
  previewVibrations,
  previewHoleDetails,
  MAX_SOFTWARE_TIER,
} from '../../../src/core/mining/Software.js';
import { MAX_PROJECTION_VELOCITY } from '../../../src/core/config/balance.js';
import { createGridPlan } from '../../../src/core/mining/DrillPlan.js';
import { batchCharge } from '../../../src/core/mining/ChargePlan.js';
import { autoVPattern } from '../../../src/core/mining/Sequence.js';
import { assembleBlastPlan } from '../../../src/core/mining/BlastPlan.js';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import { vec3 } from '../../../src/core/math/Vec3.js';
import { executeBlast } from '../../../src/core/mining/BlastExecution.js';
import { makeTestPlan } from './softwareTestFixtures.js';

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

describe('Software — preview tiers', () => {
  it('previewEnergy with tier 0 returns null', () => {
    const { grid, plan } = makeTestPlan();
    expect(previewEnergy(plan, grid, 0)).toBeNull();
  });

  it('previewEnergy with tier >= 1 returns energy field data', () => {
    const { grid, plan } = makeTestPlan();
    const result = previewEnergy(plan, grid, 1);
    expect(result).not.toBeNull();
    expect(result!.energyMap.size).toBeGreaterThan(0);
    expect(result!.maxEnergy).toBeGreaterThan(0);
  });

  it('previewFragments requires tier >= 2', () => {
    const { grid, plan } = makeTestPlan();
    expect(previewFragments(plan, grid, 1)).toBeNull();
    const result = previewFragments(plan, grid, 2);
    expect(result).not.toBeNull();
    expect(result!.fracturedCount + result!.crackedCount + result!.unaffectedCount).toBeGreaterThan(0);
  });

  it('previewProjections requires tier >= 3', () => {
    const { grid, plan } = makeTestPlan();
    expect(previewProjections(plan, grid, 2)).toBeNull();
    const result = previewProjections(plan, grid, 3);
    expect(result).not.toBeNull();
    expect(typeof result!.projectionZoneCount).toBe('number');
  });

  it('previewVibrations requires tier >= 4', () => {
    const { plan } = makeTestPlan();
    const villages = [{ id: 'v1', position: vec3(100, 0, 100) }];
    expect(previewVibrations(plan, villages, 3)).toBeNull();
    const result = previewVibrations(plan, villages, 4);
    expect(result).not.toBeNull();
    expect(result!.villages.length).toBe(1);
    expect(result!.maxVibration).toBeGreaterThan(0);
  });
});

describe('Software — previewHoleDetails', () => {
  it('returns empty record below tier 2', () => {
    const { grid, plan } = makeTestPlan();
    expect(previewHoleDetails(plan, grid, 0)).toEqual({});
    expect(previewHoleDetails(plan, grid, 1)).toEqual({});
  });

  it('at tier >= 2, gives every charged hole a predicted fragment size in cm', () => {
    const { grid, plan } = makeTestPlan();
    const details = previewHoleDetails(plan, grid, 2);
    const holeIds = plan.holes.map(h => h.id);
    expect(holeIds.length).toBeGreaterThan(0);
    for (const id of holeIds) {
      expect(details[id]).toBeDefined();
      expect(details[id]!.fragSizeCm).toBeGreaterThan(0);
      // Tier 2 only — no projection speed yet.
      expect(details[id]!.projectionSpeedMs).toBeUndefined();
    }
  });

  it('at tier >= 3, adds projectionSpeedMs only for holes predicted to project', () => {
    const { grid, plan } = makeTestPlan();
    const details = previewHoleDetails(plan, grid, 3);
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
    expect(previewHoleDetails(uncharged, grid, 3)).toEqual({});
  });

  it('#1186: still returns a detail entry when the hole surface sits below y=0', () => {
    // Same 2x2 hole pattern/plan as makeTestPlan, just shifted 15 voxels down
    // so the surface (and every charge column) resolves to negative Y.
    const grid = new VoxelGrid(30, 30);
    for (let z = 5; z <= 20; z++)
      for (let y = -15; y <= -7; y++)
        for (let x = 5; x <= 20; x++)
          grid.setVoxel(x, y, z, { composition: { rocks: [{ rockId: 'molite', coefficient: 1.0 }] }, density: 1.0, oreDensities: {}, fractureModifier: 1.0 });

    const holes = createGridPlan(holeCounter, { x: 10, z: 10 }, 2, 2, 3, 6, 0.15);
    const holeIds = holes.map(h => h.id);
    const holeDepths: Record<string, number> = {};
    for (const h of holes) holeDepths[h.id] = h.depth;
    const { charges } = batchCharge(holeIds, holeDepths, 'boomite', 5, 2);
    const plan = assembleBlastPlan(holes, charges, autoVPattern(holes, 25));

    const details = previewHoleDetails(plan, grid, 2);
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
    const holes = createGridPlan(holeCounter, { x: 10, z: 10 }, 2, 2, 3, 6, 0.15);
    const depths: Record<string, number> = {};
    for (const h of holes) depths[h.id] = h.depth;
    const { charges } = batchCharge(holes.map(h => h.id), depths, explosiveId, amountKg, stemmingM);
    return { grid, plan: assembleBlastPlan(holes, charges, autoVPattern(holes, 25)) };
  }

  it('previewEnergy retains less total energy over a smaller footprint when holes are wet (water-sensitive explosive)', () => {
    // Per-voxel energy saturates at the rock's absorption threshold, so max/min can
    // coincide; the total retained and the number of energised voxels do not.
    const { grid, plan } = planWith('boomite');
    const dry = previewEnergy(plan, grid, 1)!;
    const wet = previewEnergy(plan, grid, 1, allWet(plan))!;
    const total = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
    expect(wet.energyMap.size).toBeLessThan(dry.energyMap.size);
    expect(total(wet.energyMap)).toBeLessThan(total(dry.energyMap));
    expect(wet.maxEnergy).toBeLessThanOrEqual(dry.maxEnergy);
  });

  it('previewFragments reports fewer fractured voxels wet than dry', () => {
    const { grid, plan } = planWith('boomite');
    const dry = previewFragments(plan, grid, 2)!;
    const wet = previewFragments(plan, grid, 2, allWet(plan))!;
    expect(wet.fracturedCount).toBeLessThan(dry.fracturedCount);
  });

  it('previewFragments wet cracked count matches executeBlast with the same wet set, and both drop vs dry', () => {
    const { grid, plan } = planWith('boomite');
    const wetIds = allWet(plan);
    const dry = previewFragments(plan, grid, 2)!;
    const preview = previewFragments(plan, grid, 2, wetIds)!;
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
    const { grid, plan } = planWith('boomite');
    const dry = previewProjections(plan, grid, 3)!;
    const wet = previewProjections(plan, grid, 3, allWet(plan))!;
    expect(wet.projectionZoneCount).not.toBe(dry.projectionZoneCount);
  });

  it('previewHoleDetails reflects wet holes: coarser fragments or no projection', () => {
    const { grid, plan } = planWith('big_bada_boom', 12, 1.8); // heavy charge: collar voxel is energised, so wet is measurable
    const dry = previewHoleDetails(plan, grid, 3);
    const wet = previewHoleDetails(plan, grid, 3, allWet(plan));
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
    const { grid, plan } = planWith('big_bada_boom', 12, 1.8); // heavy charge: collar voxel is energised, so wet is measurable
    const dry = previewHoleDetails(plan, grid, 2);
    const first = plan.holes[0]!.id;
    const wet = previewHoleDetails(plan, grid, 2, new Set([first]));
    expect(wet[first]!.fragSizeCm).toBeGreaterThan(dry[first]!.fragSizeCm!);
    const other = plan.holes[plan.holes.length - 1]!.id;
    expect(wet[other]!.fragSizeCm).toBeCloseTo(dry[other]!.fragSizeCm!, 6);
  });

  describe('water-resistant explosive', () => {
    it('wet set gives identical previews to the dry results', () => {
      const { grid, plan } = planWith('krackle');
      const wetIds = allWet(plan);
      expect(previewEnergy(plan, grid, 1, wetIds)!.maxEnergy).toBe(previewEnergy(plan, grid, 1)!.maxEnergy);
      expect(previewFragments(plan, grid, 2, wetIds)).toEqual(previewFragments(plan, grid, 2));
      expect(previewProjections(plan, grid, 3, wetIds)).toEqual(previewProjections(plan, grid, 3));
      expect(previewHoleDetails(plan, grid, 3, wetIds)).toEqual(previewHoleDetails(plan, grid, 3));
    });
  });

  describe('omitted wetHoleIds', () => {
    it('equals an explicit empty set, and differs from an all-wet set', () => {
      const { grid, plan } = planWith('boomite');
      const empty = new Set<string>();
      expect(previewEnergy(plan, grid, 1)).toEqual(previewEnergy(plan, grid, 1, empty));
      expect(previewFragments(plan, grid, 2)).toEqual(previewFragments(plan, grid, 2, empty));
      expect(previewProjections(plan, grid, 3)).toEqual(previewProjections(plan, grid, 3, empty));
      expect(previewHoleDetails(plan, grid, 3)).toEqual(previewHoleDetails(plan, grid, 3, empty));
      expect(previewFragments(plan, grid, 2)!.fracturedCount)
        .not.toBe(previewFragments(plan, grid, 2, allWet(plan))!.fracturedCount);
    });
  });

  it('an id that is not in the plan changes nothing', () => {
    const { grid, plan } = planWith('boomite');
    expect(previewFragments(plan, grid, 2, new Set(['no-such-hole'])))
      .toEqual(previewFragments(plan, grid, 2));
  });
});
