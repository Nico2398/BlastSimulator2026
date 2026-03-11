import { describe, it, expect, beforeEach } from 'vitest';
import {
  purchaseSoftware,
  previewEnergy,
  previewFragments,
  previewProjections,
  previewVibrations,
  MAX_SOFTWARE_TIER,
} from '../../../src/core/mining/Software.js';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import { createGridPlan, resetHoleIds } from '../../../src/core/mining/DrillPlan.js';
import { batchCharge } from '../../../src/core/mining/ChargePlan.js';
import { autoVPattern } from '../../../src/core/mining/Sequence.js';
import { assembleBlastPlan } from '../../../src/core/mining/BlastPlan.js';
import { vec3 } from '../../../src/core/math/Vec3.js';

beforeEach(() => resetHoleIds());

function makeTestPlan() {
  const grid = new VoxelGrid(30, 15, 30);
  for (let z = 5; z <= 20; z++)
    for (let y = 0; y <= 8; y++)
      for (let x = 5; x <= 20; x++)
        grid.setVoxel(x, y, z, { rockId: 'molite', density: 1.0, oreDensities: {}, fractureModifier: 1.0 });

  const holes = createGridPlan({ x: 10, z: 10 }, 2, 2, 3, 6, 0.15);
  const holeIds = holes.map(h => h.id);
  const holeDepths: Record<string, number> = {};
  for (const h of holes) holeDepths[h.id] = h.depth;
  const { charges } = batchCharge(holeIds, holeDepths, 'boomite', 5, 2);
  const delays = autoVPattern(holes, 25);
  const plan = assembleBlastPlan(holes, charges, delays);
  return { grid, plan };
}

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
