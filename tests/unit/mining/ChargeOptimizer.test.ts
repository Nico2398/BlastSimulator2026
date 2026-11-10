// BlastSimulator2026 — charge optimizer: per-hole explosive and kg proposal (#2204)
import { describe, it, expect, beforeAll } from 'vitest';
import { optimizeCharges, type ChargeProposal } from '../../../src/core/mining/ChargeOptimizer.js';
import { previewPlanBands, planBandShares, holeBandMixes, type BandShares } from '../../../src/core/mining/SoftwarePreview.js';
import {
  explosiveHoleLimits, chargeFitsHole, chargeOrderCost, maxFittingChargeKg, type HoleCharge,
} from '../../../src/core/mining/ChargePlan.js';
import { getExplosive, getAllExplosives } from '../../../src/core/world/ExplosiveCatalog.js';
import { FRAGMENTATION_BANDS } from '../../../src/core/mining/FragmentationBand.js';
import { CHARGE_DEFAULT_AMOUNT_KG, CHARGE_DEFAULT_STEMMING_M } from '../../../src/core/config/balance.js';
import type { DrillHole } from '../../../src/core/mining/DrillPlan.js';
import type { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import { mixedRockGrid, mixedRockHoles, gridFingerprint } from '../../helpers/optimizerFixtures.js';

const STEMMING = CHARGE_DEFAULT_STEMMING_M;
const ALL_IDS = getAllExplosives().map(e => e.id);
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

function goodShareOf(holes: readonly DrillHole[], grid: VoxelGrid, charges: Record<string, HoleCharge>, wet: ReadonlySet<string> = new Set()): number {
  const shares = planBandShares(previewPlanBands({ holes: [...holes], charges }, grid, wet), holes);
  return shares?.good ?? 0;
}

/** Hand plans: every hole charged with one explosive at one amount, spread across the explosive's range. */
function handPlans(holes: readonly DrillHole[], explosiveIds: readonly string[], steps = 4): Record<string, HoleCharge>[] {
  const plans: Record<string, HoleCharge>[] = [];
  for (const id of explosiveIds) {
    const e = getExplosive(id)!;
    const d = holes[0]!.diameter;
    const { minKg, maxKg } = explosiveHoleLimits(e, d);
    const hi = Math.min(maxKg, maxFittingChargeKg(holes[0]!.depth, STEMMING, d));
    if (hi < minKg) continue;
    for (let i = 0; i <= steps; i++) {
      const amountKg = Math.min(hi, Math.max(minKg, Math.round((minKg + ((hi - minKg) * i) / steps) * 100) / 100));
      const charges: Record<string, HoleCharge> = {};
      for (const h of holes) charges[h.id] = { explosiveId: id, amountKg, stemmingM: STEMMING };
      plans.push(charges);
    }
  }
  return plans;
}

const totalOf = (charges: Record<string, HoleCharge>): number => sum(Object.values(charges).map(c => c.amountKg));

describe('optimizeCharges — proposal shape (C1)', () => {
  const grid = mixedRockGrid();
  const holes = mixedRockHoles();
  let proposal: ChargeProposal;
  beforeAll(() => { proposal = optimizeCharges(holes, grid, { explosiveIds: ALL_IDS, stemmingM: STEMMING }); });

  it('proposes an explosive and a kg amount for every drilled hole', () => {
    expect(Object.keys(proposal.charges).sort()).toEqual(holes.map(h => h.id).sort());
    for (const h of holes) {
      const c = proposal.charges[h.id]!;
      expect(getExplosive(c.explosiveId), h.id).toBeDefined();
      expect(c.amountKg, h.id).toBeGreaterThan(0);
      expect(c.stemmingM, h.id).toBe(STEMMING);
    }
    expect(proposal.skippedHoleIds).toEqual([]);
  });

  it('reports the cost as the sum of costPerKg times kg over the proposed charges', () => {
    const expected = sum(Object.values(proposal.charges).map(c => getExplosive(c.explosiveId)!.costPerKg * c.amountKg));
    expect(proposal.cost).toBeCloseTo(expected, 6);
    expect(proposal.cost).toBeCloseTo(sum(Object.values(proposal.charges).map(c => chargeOrderCost(c.explosiveId, c.amountKg))), 6);
    expect(proposal.cost).toBeGreaterThan(0);
  });

  it('reports the total kg of the proposed charges', () => {
    expect(proposal.totalKg).toBeCloseTo(totalOf(proposal.charges), 6);
  });

  it('reports a pooled band mix that sums to one', () => {
    expect(proposal.bandShares).not.toBeNull();
    const total = sum(FRAGMENTATION_BANDS.map(b => proposal.bandShares![b]));
    expect(total).toBeCloseTo(1, 6);
  });

  it('reports the band mix the blast model gives the proposed plan', () => {
    const plan = { holes: [...holes], charges: proposal.charges };
    const map = previewPlanBands(plan, grid);
    const pooled = planBandShares(map, holes) as BandShares;
    for (const b of FRAGMENTATION_BANDS) expect(proposal.bandShares![b], b).toBeCloseTo(pooled[b], 6);
    const mixes = holeBandMixes(map, holes);
    for (const h of holes) {
      expect(proposal.holeMixes[h.id], h.id).toBeDefined();
      expect(proposal.holeMixes[h.id]!.good, h.id).toBeCloseTo(mixes[h.id]!.good, 6);
    }
  });

  it('reports the permit kg used against the limit', () => {
    const limited = optimizeCharges(holes, grid, { explosiveIds: ALL_IDS, stemmingM: STEMMING, maxTotalKg: 200 });
    expect(limited.permitKgLimit).toBe(200);
    expect(limited.totalKg).toBeLessThanOrEqual(200);
    expect(limited.withinPermit).toBe(true);
  });

  it('is deterministic', () => {
    expect(optimizeCharges(holes, grid, { explosiveIds: ALL_IDS, stemmingM: STEMMING })).toEqual(proposal);
  });
});

describe('optimizeCharges — beats the hand plans (C2)', () => {
  const grid = mixedRockGrid();
  const holes = mixedRockHoles();

  it('pooled good share is at least that of every one-explosive one-amount plan on the same pattern', () => {
    const proposal = optimizeCharges(holes, grid, { explosiveIds: ALL_IDS, stemmingM: STEMMING });
    const best = proposal.bandShares!.good;
    for (const charges of handPlans(holes, ALL_IDS)) {
      const c = Object.values(charges)[0]!;
      expect(best, `${c.explosiveId} ${c.amountKg}kg`).toBeGreaterThanOrEqual(goodShareOf(holes, grid, charges) - 1e-9);
    }
  });

  it('beats or equals the default hand plan on the mixed-rock pattern', () => {
    const proposal = optimizeCharges(holes, grid, { explosiveIds: ALL_IDS, stemmingM: STEMMING });
    const fit = maxFittingChargeKg(holes[0]!.depth, STEMMING, holes[0]!.diameter);
    const dflt: Record<string, HoleCharge> = {};
    for (const h of holes) dflt[h.id] = { explosiveId: 'boomite', amountKg: Math.min(CHARGE_DEFAULT_AMOUNT_KG, fit), stemmingM: STEMMING };
    expect(proposal.bandShares!.good).toBeGreaterThanOrEqual(goodShareOf(holes, grid, dflt) - 1e-9);
  });

  it('holds against hand plans drawn from a restricted explosive list', () => {
    const offered = ['boomite', 'krackle'];
    const proposal = optimizeCharges(holes, grid, { explosiveIds: offered, stemmingM: STEMMING });
    for (const charges of handPlans(holes, offered)) {
      expect(proposal.bandShares!.good).toBeGreaterThanOrEqual(goodShareOf(holes, grid, charges) - 1e-9);
    }
  });

  it('holds against the hand plans that fit under the permit limit', () => {
    const maxTotalKg = 16;
    const proposal = optimizeCharges(holes, grid, { explosiveIds: ALL_IDS, stemmingM: STEMMING, maxTotalKg });
    expect(proposal.totalKg).toBeLessThanOrEqual(maxTotalKg + 1e-9);
    for (const charges of handPlans(holes, ALL_IDS, 8).filter(c => totalOf(c) <= maxTotalKg)) {
      expect(proposal.bandShares!.good).toBeGreaterThanOrEqual(goodShareOf(holes, grid, charges) - 1e-9);
    }
  });
});

describe('optimizeCharges — limits and offered explosives (C3)', () => {
  const grid = mixedRockGrid();

  function expectAllWithinLimits(holes: readonly DrillHole[], proposal: ChargeProposal, offered: readonly string[]): void {
    for (const h of holes) {
      const c = proposal.charges[h.id];
      if (!c) continue;
      const e = getExplosive(c.explosiveId)!;
      const { minKg, maxKg } = explosiveHoleLimits(e, h.diameter);
      expect(offered, h.id).toContain(c.explosiveId);
      expect(c.amountKg, `${h.id} min`).toBeGreaterThanOrEqual(minKg - 1e-9);
      expect(c.amountKg, `${h.id} max`).toBeLessThanOrEqual(maxKg + 1e-9);
      expect(chargeFitsHole(c.amountKg, c.stemmingM, h.depth, h.diameter), `${h.id} fits`).toBe(true);
    }
  }

  it('every charge is within the explosive per-hole range for the hole diameter and fits under the stemming', () => {
    const holes = mixedRockHoles();
    expectAllWithinLimits(holes, optimizeCharges(holes, grid, { explosiveIds: ALL_IDS, stemmingM: STEMMING }), ALL_IDS);
  });

  it('respects the range of a wider hole', () => {
    const holes = mixedRockHoles(8, 0.127);
    expectAllWithinLimits(holes, optimizeCharges(holes, grid, { explosiveIds: ALL_IDS, stemmingM: STEMMING }), ALL_IDS);
  });

  it('respects a shallow hole whose column barely fits', () => {
    const holes = mixedRockHoles(4);
    const proposal = optimizeCharges(holes, grid, { explosiveIds: ALL_IDS, stemmingM: STEMMING });
    expectAllWithinLimits(holes, proposal, ALL_IDS);
    for (const h of holes) {
      const c = proposal.charges[h.id];
      if (c) expect(c.amountKg).toBeLessThanOrEqual(maxFittingChargeKg(h.depth, STEMMING, h.diameter) + 1e-9);
    }
  });

  it('uses only the explosives offered', () => {
    const holes = mixedRockHoles();
    for (const offered of [['pop_rock'], ['boomite', 'shatternite'], ['dynatomics']]) {
      const proposal = optimizeCharges(holes, grid, { explosiveIds: offered, stemmingM: STEMMING });
      expectAllWithinLimits(holes, proposal, offered);
      for (const c of Object.values(proposal.charges)) expect(offered).toContain(c.explosiveId);
    }
  });

  it('puts a hole nothing can be proposed for in skippedHoleIds and out of charges', () => {
    const holes = [...mixedRockHoles(), ...mixedRockHoles(2, 0.089).slice(0, 1).map(h => ({ ...h, id: 'HX', x: 16, z: 10 }))];
    const proposal = optimizeCharges(holes, grid, { explosiveIds: ALL_IDS, stemmingM: STEMMING });
    expect(proposal.skippedHoleIds).toEqual(['HX']);
    expect(proposal.charges['HX']).toBeUndefined();
    expect(Object.keys(proposal.charges).length).toBe(holes.length - 1);
  });

  it('skips every hole when no explosive is offered', () => {
    const holes = mixedRockHoles();
    const proposal = optimizeCharges(holes, grid, { explosiveIds: [], stemmingM: STEMMING });
    expect(proposal.charges).toEqual({});
    expect([...proposal.skippedHoleIds].sort()).toEqual(holes.map(h => h.id).sort());
    expect(proposal.totalKg).toBe(0);
    expect(proposal.cost).toBe(0);
  });

  it('proposes nothing for an empty pattern', () => {
    const proposal = optimizeCharges([], grid, { explosiveIds: ALL_IDS, stemmingM: STEMMING });
    expect(proposal.charges).toEqual({});
    expect(proposal.holeMixes).toEqual({});
    expect(proposal.bandShares).toBeNull();
    expect(proposal.skippedHoleIds).toEqual([]);
    expect(proposal.cost).toBe(0);
    expect(proposal.totalKg).toBe(0);
    expect(proposal.withinPermit).toBe(true);
  });
});

describe('optimizeCharges — wet holes (C4)', () => {
  const grid = mixedRockGrid();
  const holes = mixedRockHoles();
  const sensitive = ALL_IDS.filter(id => getExplosive(id)!.waterSensitive);
  const resistant = ALL_IDS.filter(id => !getExplosive(id)!.waterSensitive);

  it('the catalog has both kinds, so the cases below bite', () => {
    expect(sensitive.length).toBeGreaterThan(0);
    expect(resistant.length).toBeGreaterThan(0);
  });

  it('never proposes a water-sensitive explosive for a wet hole', () => {
    const wet = new Set([holes[0]!.id, holes[3]!.id]);
    const proposal = optimizeCharges(holes, grid, { explosiveIds: ALL_IDS, stemmingM: STEMMING, wetHoleIds: wet });
    for (const id of wet) {
      const c = proposal.charges[id];
      expect(c, id).toBeDefined();
      expect(getExplosive(c!.explosiveId)!.waterSensitive, id).toBe(false);
    }
  });

  it('never proposes one for any hole when every hole is wet', () => {
    const wet = new Set(holes.map(h => h.id));
    const proposal = optimizeCharges(holes, grid, { explosiveIds: ALL_IDS, stemmingM: STEMMING, wetHoleIds: wet });
    for (const c of Object.values(proposal.charges)) expect(sensitive).not.toContain(c.explosiveId);
  });

  it('skips a wet hole when only water-sensitive explosives are offered, and charges the dry ones', () => {
    const wetId = holes[1]!.id;
    const proposal = optimizeCharges(holes, grid, { explosiveIds: sensitive, stemmingM: STEMMING, wetHoleIds: new Set([wetId]) });
    expect(proposal.skippedHoleIds).toEqual([wetId]);
    expect(proposal.charges[wetId]).toBeUndefined();
    for (const h of holes.filter(x => x.id !== wetId)) expect(proposal.charges[h.id], h.id).toBeDefined();
  });

  it('still proposes a water-sensitive explosive where holes are dry and the offer is only such', () => {
    const proposal = optimizeCharges(holes, grid, { explosiveIds: sensitive, stemmingM: STEMMING, wetHoleIds: new Set() });
    expect(proposal.skippedHoleIds).toEqual([]);
  });
});

describe('optimizeCharges — permit kg limit (C5)', () => {
  const grid = mixedRockGrid();
  const holes = mixedRockHoles();
  const minKgOf = (h: DrillHole, ids: readonly string[]): number =>
    Math.min(...ids.map(id => explosiveHoleLimits(getExplosive(id)!, h.diameter).minKg));

  it('echoes maxTotalKg as permitKgLimit', () => {
    const p = optimizeCharges(holes, grid, { explosiveIds: ALL_IDS, stemmingM: STEMMING, maxTotalKg: 77 });
    expect(p.permitKgLimit).toBe(77);
  });

  it('has an infinite limit and stays within it when maxTotalKg is omitted', () => {
    const p = optimizeCharges(holes, grid, { explosiveIds: ALL_IDS, stemmingM: STEMMING });
    expect(p.permitKgLimit).toBe(Infinity);
    expect(p.withinPermit).toBe(true);
  });

  it('keeps the total at or under a limit that can be met', () => {
    const offered = ['boomite', 'krackle'];
    const minSum = sum(holes.map(h => minKgOf(h, offered)));
    for (const limit of [minSum, minSum * 1.25, minSum * 2]) {
      const p = optimizeCharges(holes, grid, { explosiveIds: offered, stemmingM: STEMMING, maxTotalKg: limit });
      expect(p.totalKg, `limit ${limit}`).toBeLessThanOrEqual(limit + 1e-9);
      expect(p.withinPermit, `limit ${limit}`).toBe(true);
      expect(p.totalKg).toBeCloseTo(totalOf(p.charges), 6);
      expect(Object.keys(p.charges).length).toBe(holes.length);
    }
  });

  it('a tight limit holds the total below what the unlimited proposal spends', () => {
    const offered = ['boomite', 'krackle'];
    const free = optimizeCharges(holes, grid, { explosiveIds: offered, stemmingM: STEMMING });
    const minSum = sum(holes.map(h => minKgOf(h, offered)));
    const limit = minSum * 1.1;
    const tight = optimizeCharges(holes, grid, { explosiveIds: offered, stemmingM: STEMMING, maxTotalKg: limit });
    expect(tight.totalKg).toBeLessThanOrEqual(limit + 1e-9);
    if (free.totalKg > limit) expect(tight.totalKg).toBeLessThan(free.totalKg);
  });

  it('reports withinPermit=false when even the minimum charges exceed the limit', () => {
    const minSum = sum(holes.map(h => minKgOf(h, ALL_IDS)));
    const p = optimizeCharges(holes, grid, { explosiveIds: ALL_IDS, stemmingM: STEMMING, maxTotalKg: minSum / 2 });
    expect(p.withinPermit).toBe(false);
    expect(p.permitKgLimit).toBe(minSum / 2);
  });
});

describe('optimizeCharges — changes nothing (C6)', () => {
  it('leaves holes and grid untouched', () => {
    const grid = mixedRockGrid();
    const holes = mixedRockHoles();
    const holesBefore = JSON.parse(JSON.stringify(holes));
    const gridBefore = gridFingerprint(grid);
    optimizeCharges(holes, grid, { explosiveIds: ALL_IDS, stemmingM: STEMMING, wetHoleIds: new Set([holes[0]!.id]), maxTotalKg: 30 });
    expect(JSON.parse(JSON.stringify(holes))).toEqual(holesBefore);
    expect(gridFingerprint(grid)).toBe(gridBefore);
  });
});
