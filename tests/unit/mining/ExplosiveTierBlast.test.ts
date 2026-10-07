// BlastSimulator2026 — explosive tier gating in the blast energy field (#1358)
// A hole's explosive scales the breaking threshold of the columns nearest to it
// by TIER_SHORTFALL_THRESHOLD_FACTOR ** (rock tier - explosive minRockTier).
// The catalog is wrapped so a test can pin an explosive's minRockTier without
// touching its energy: that isolates the gating from raw explosive strength.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const tierOverrides = vi.hoisted(() => ({ map: {} as Record<string, number> }));

vi.mock('../../../src/core/world/ExplosiveCatalog.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/core/world/ExplosiveCatalog.js')>();
  return {
    ...actual,
    getExplosive: (id: string) => {
      const base = actual.getExplosive(id);
      if (!base) return base;
      const override = tierOverrides.map[id];
      return override === undefined ? base : { ...base, minRockTier: override };
    },
  };
});

import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import { createGridPlan } from '../../../src/core/mining/DrillPlan.js';
import { batchCharge, type HoleCharge } from '../../../src/core/mining/ChargePlan.js';
import { assembleBlastPlan } from '../../../src/core/mining/BlastPlan.js';
import { executeBlast, buildPlanEnergyField } from '../../../src/core/mining/BlastExecution.js';
import { identifyFragmentedVoxels } from '../../../src/core/mining/VoxelFragmentation.js';
import { thresholdAt } from '../../../src/core/mining/EnergyPropagation.js';
import { TIER_SHORTFALL_THRESHOLD_FACTOR } from '../../../src/core/config/balance.js';

const holeCounter = { nextHoleId: 1 };
beforeEach(() => { holeCounter.nextHoleId = 1; tierOverrides.map = {}; });

function hardGrid(rockId = 'obstiite'): VoxelGrid { // obstiite: tier 4
  const grid = new VoxelGrid(40, 40);
  for (let z = 0; z < 40; z++) for (let y = 0; y <= 10; y++) for (let x = 0; x < 40; x++) {
    grid.setVoxel(x, y, z, {
      composition: { rocks: [{ rockId, coefficient: 1 }] },
      density: 1.0, oreDensities: {}, fractureModifier: 1.0,
    });
  }
  return grid;
}

function chargeOf(explosiveId: string, depth: number, kg: number): HoleCharge {
  const { charges } = batchCharge(['h'], { h: depth }, explosiveId, kg, 2);
  return charges['h']!;
}

/** Two holes mirrored about the grid centre (x = 9 and x = 30), one explosive each. */
function twoHolePlan(explosiveA: string, explosiveB: string) {
  const holes = createGridPlan(holeCounter, { x: 9, z: 20 }, 1, 2, 21, 8, 0.15);
  const charges: Record<string, HoleCharge> = {
    [holes[0]!.id]: chargeOf(explosiveA, 8, explosiveA === 'pop_rock' ? 3 : 4),
    [holes[1]!.id]: chargeOf(explosiveB, 8, explosiveB === 'pop_rock' ? 3 : 4),
  };
  return assembleBlastPlan(holes, charges);
}

function singleExplosivePlan(explosiveId: string, kg: number) {
  const holes = createGridPlan(holeCounter, { x: 12, z: 12 }, 2, 3, 4, 8, 0.15);
  const depths: Record<string, number> = {};
  for (const h of holes) depths[h.id] = h.depth;
  const { charges } = batchCharge(holes.map(h => h.id), depths, explosiveId, kg, 2);
  return assembleBlastPlan(holes, charges);
}

describe('blast energy field — explosive tier gating (#1358)', () => {
  it('a weak explosive raises thresholds by TIER_SHORTFALL_THRESHOLD_FACTOR ** shortfall over an adequate one', () => {
    tierOverrides.map = { boomite: 4 };
    const adequate = buildPlanEnergyField(singleExplosivePlan('boomite', 4), hardGrid())!;
    holeCounter.nextHoleId = 1;
    tierOverrides.map = { boomite: 1 };
    const weak = buildPlanEnergyField(singleExplosivePlan('boomite', 4), hardGrid())!;

    const base = thresholdAt(adequate, 14, 5, 14);
    expect(base).toBeGreaterThan(0);
    expect(thresholdAt(weak, 14, 5, 14) / base).toBeCloseTo(TIER_SHORTFALL_THRESHOLD_FACTOR ** 3, 3);
  });

  it('an explosive that meets the rock tier leaves thresholds as before', () => {
    tierOverrides.map = { boomite: 4 };
    const matching = buildPlanEnergyField(singleExplosivePlan('boomite', 4), hardGrid())!;
    holeCounter.nextHoleId = 1;
    tierOverrides.map = { boomite: 5 };
    const higher = buildPlanEnergyField(singleExplosivePlan('boomite', 4), hardGrid())!;
    expect(Array.from(higher.threshold)).toEqual(Array.from(matching.threshold));
  });

  it('a weak-explosive plan breaks fewer voxels than the same charge with an adequate tier', () => {
    tierOverrides.map = { boomite: 4 };
    const adequate = executeBlast(singleExplosivePlan('boomite', 8), hardGrid(), [])!;
    holeCounter.nextHoleId = 1;
    tierOverrides.map = { boomite: 1 };
    const weak = executeBlast(singleExplosivePlan('boomite', 8), hardGrid(), [])!;

    expect(adequate.clearedVoxels).toBeGreaterThan(0);
    expect(weak.clearedVoxels).toBeLessThan(adequate.clearedVoxels);
  });

  it('the real blast clears exactly the voxels the preview field predicts (weak plan)', () => {
    tierOverrides.map = { boomite: 1 }; // molite is tier 2: one tier short, still breaks some rock
    const plan = singleExplosivePlan('boomite', 8);
    const preview = buildPlanEnergyField(plan, hardGrid('molite'))!;
    const predicted = identifyFragmentedVoxels(preview, hardGrid('molite')).fragmented.length;

    const blastGrid = hardGrid('molite');
    const result = executeBlast(plan, blastGrid, [])!;
    expect(result.clearedVoxels).toBeGreaterThan(0);
    expect(result.clearedVoxels).toBe(predicted);
  });

  it('ignores holes with an unknown explosive id instead of penalising them', () => {
    tierOverrides.map = { boomite: 4 };
    const holes = createGridPlan(holeCounter, { x: 9, z: 20 }, 1, 2, 21, 8, 0.15);
    const good = chargeOf('boomite', 8, 4);
    const bogus: HoleCharge = { ...good, explosiveId: 'no_such_explosive' };
    const build = (second: HoleCharge) => buildPlanEnergyField(assembleBlastPlan(
      holes, { [holes[0]!.id]: good, [holes[1]!.id]: second }), hardGrid())!;
    const withBogus = build(bogus);
    const withGood = build(good);
    // Bogus hole at x=30 contributes no gating: its column uses the adequate boomite hole's tier.
    expect(thresholdAt(withBogus, 30, 5, 20)).toBeCloseTo(thresholdAt(withGood, 30, 5, 20), 4);
  });

  it('does no tier gating when no hole is charged', () => {
    tierOverrides.map = { boomite: 1 };
    const holes = createGridPlan(holeCounter, { x: 12, z: 12 }, 2, 3, 4, 8, 0.15);
    const uncharged = buildPlanEnergyField(assembleBlastPlan(holes, {}), hardGrid())!;
    holeCounter.nextHoleId = 1;
    tierOverrides.map = { boomite: 4 };
    const holes2 = createGridPlan(holeCounter, { x: 12, z: 12 }, 2, 3, 4, 8, 0.15);
    const reference = buildPlanEnergyField(assembleBlastPlan(holes2, {}), hardGrid())!;
    expect(Array.from(uncharged.threshold)).toEqual(Array.from(reference.threshold));
  });

  it('ignores uncharged holes even when they are nearer than charged ones', () => {
    tierOverrides.map = { pop_rock: 1 };
    const holes = createGridPlan(holeCounter, { x: 9, z: 20 }, 1, 2, 21, 8, 0.15);
    // Only the far hole (x=30) is charged; every column, including those beside the uncharged hole, takes its tier.
    const plan = assembleBlastPlan(holes, { [holes[1]!.id]: chargeOf('pop_rock', 8, 3) });
    const field = buildPlanEnergyField(plan, hardGrid())!;
    holeCounter.nextHoleId = 1;
    tierOverrides.map = { pop_rock: 4 };
    const holes2 = createGridPlan(holeCounter, { x: 9, z: 20 }, 1, 2, 21, 8, 0.15);
    const plan2 = assembleBlastPlan(holes2, { [holes2[1]!.id]: chargeOf('pop_rock', 8, 3) });
    const adequate = buildPlanEnergyField(plan2, hardGrid())!;
    expect(thresholdAt(field, 9, 5, 20) / thresholdAt(adequate, 9, 5, 20))
      .toBeCloseTo(TIER_SHORTFALL_THRESHOLD_FACTOR ** 3, 3);
  });

  it('uses the nearest charged hole explosive per column when plans mix explosives', () => {
    tierOverrides.map = { pop_rock: 1, obliviax: 4 };
    const mixed = buildPlanEnergyField(twoHolePlan('pop_rock', 'obliviax'), hardGrid())!;
    holeCounter.nextHoleId = 1;
    const uniform = buildPlanEnergyField(twoHolePlan('obliviax', 'obliviax'), hardGrid())!;

    // Column of hole A (x=9, weak pop_rock): scaled. Mirrored column of hole B: not.
    const weakSide = thresholdAt(mixed, 9, 5, 20) / thresholdAt(uniform, 9, 5, 20);
    const strongSide = thresholdAt(mixed, 30, 5, 20) / thresholdAt(uniform, 30, 5, 20);
    expect(weakSide).toBeCloseTo(TIER_SHORTFALL_THRESHOLD_FACTOR ** 3, 3);
    expect(strongSide).toBeCloseTo(1, 4);
  });
});
