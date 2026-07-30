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
import { resetHoleIds } from '../../../src/core/mining/DrillPlan.js';
import { vec3 } from '../../../src/core/math/Vec3.js';
import { makeTestPlan } from './softwareTestFixtures.js';

beforeEach(() => resetHoleIds());

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
    const { grid, plan } = makeTestPlan();
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
        expect(detail!.projectionSpeedMs).toBeLessThanOrEqual(80); // MAX_PROJECTION_VELOCITY
      }
    }
  });

  it('skips holes with no charge', () => {
    const { grid, plan } = makeTestPlan();
    const uncharged = { ...plan, charges: {} };
    expect(previewHoleDetails(uncharged, grid, 3)).toEqual({});
  });
});
