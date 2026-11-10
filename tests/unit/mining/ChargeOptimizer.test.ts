// BlastSimulator2026 — charge optimizer: per-hole explosive and stemming proposal, each hole filled (#2204)
import { describe, it, expect, beforeAll } from 'vitest';
import { optimizeCharges, optimizerOptionsFor, type ChargeProposal } from '../../../src/core/mining/ChargeOptimizer.js';
import {
  previewPlanBands, planBandShares, holeBandMixes, stemmingSweepRangeM, type BandShares,
} from '../../../src/core/mining/SoftwarePreview.js';
import { chargeFitsHole, chargeOrderCost, fillChargeKg, type HoleCharge } from '../../../src/core/mining/ChargePlan.js';
import { getExplosive, getAllExplosives } from '../../../src/core/world/ExplosiveCatalog.js';
import { FRAGMENTATION_BANDS } from '../../../src/core/mining/FragmentationBand.js';
import { CHARGE_DEFAULT_STEMMING_M } from '../../../src/core/config/balance.js';
import type { DrillHole } from '../../../src/core/mining/DrillPlan.js';
import type { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import { createGame } from '../../../src/core/state/GameState.js';
import { createGradeState } from '../../../src/core/economy/MineGrade.js';
import { permitLimitsFor } from '../../../src/core/economy/PermitLimits.js';
import { resolveAvailableExplosives } from '../../../src/core/campaign/Level.js';
import { mixedRockGrid, mixedRockHoles, gridFingerprint } from '../../helpers/optimizerFixtures.js';
import { setHoleWater } from '../../helpers/holeWater.js';

const ALL_IDS = getAllExplosives().map(e => e.id);
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

function goodShareOf(holes: readonly DrillHole[], grid: VoxelGrid, charges: Record<string, HoleCharge>, wet: ReadonlySet<string> = new Set()): number {
  const shares = planBandShares(previewPlanBands({ holes: [...holes], charges }, grid, wet), holes);
  return shares?.good ?? 0;
}

/** Every hole filled with the explosive up to `stemmingM`, the way Charge All charges a pattern. */
function fillAll(holes: readonly DrillHole[], explosiveId: string, stemmingM: number): Record<string, HoleCharge> {
  const charges: Record<string, HoleCharge> = {};
  for (const h of holes) {
    const amountKg = fillChargeKg(h.depth, stemmingM, h.diameter, explosiveId);
    if (amountKg > 0) charges[h.id] = { explosiveId, amountKg, stemmingM };
  }
  return charges;
}

/**
 * Hand plans: every hole filled with one explosive up to one stemming, the stemmings spread across the range
 * that throws no rock (`stemmingSweepRangeM`, the range the optimizer itself is held to), at the panel's 0.1 m.
 */
function handPlans(holes: readonly DrillHole[], explosiveIds: readonly string[], steps = 4): Record<string, HoleCharge>[] {
  const range = stemmingSweepRangeM(holes[0]!.depth)!;
  const plans: Record<string, HoleCharge>[] = [];
  for (const id of explosiveIds) {
    for (let i = 0; i <= steps; i++) {
      const stemmingM = Math.round((range.lo + ((range.hi - range.lo) * i) / steps) * 10) / 10;
      plans.push(fillAll(holes, id, stemmingM));
    }
  }
  return plans;
}

/** The lightest charge the optimizer can propose for a hole: the offered explosive filled under the most stemming it sweeps. */
function lightestKg(h: DrillHole, ids: readonly string[]): number {
  const range = stemmingSweepRangeM(h.depth)!;
  const stemmingM = Math.round(range.hi * 10) / 10;
  return Math.min(...ids.map(id => fillChargeKg(h.depth, stemmingM, h.diameter, id)));
}

const totalOf = (charges: Record<string, HoleCharge>): number => sum(Object.values(charges).map(c => c.amountKg));

/** Every proposed charge is an offered explosive filling its hole up to a stemming that throws no rock. */
function expectFilledWithinRange(holes: readonly DrillHole[], proposal: ChargeProposal, offered: readonly string[]): void {
  for (const h of holes) {
    const c = proposal.charges[h.id];
    if (!c) continue;
    const range = stemmingSweepRangeM(h.depth)!;
    expect(offered, h.id).toContain(c.explosiveId);
    // Swept stemmings are rounded to the 0.1 m the panel steps in.
    expect(c.stemmingM, `${h.id} stemming`).toBeGreaterThanOrEqual(range.lo - 0.05);
    expect(c.stemmingM, `${h.id} stemming`).toBeLessThanOrEqual(range.hi + 0.05);
    expect(c.amountKg, `${h.id} fill`).toBe(fillChargeKg(h.depth, c.stemmingM, h.diameter, c.explosiveId));
    expect(c.amountKg, `${h.id} kg`).toBeGreaterThan(0);
    expect(chargeFitsHole(c.amountKg, c.stemmingM, h.depth, h.diameter, c.explosiveId), `${h.id} fits`).toBe(true);
  }
}

describe('optimizeCharges — proposal shape (C1)', () => {
  const grid = mixedRockGrid();
  const holes = mixedRockHoles();
  let proposal: ChargeProposal;
  beforeAll(() => { proposal = optimizeCharges(holes, grid, { explosiveIds: ALL_IDS }); });

  it('proposes an explosive and a stemming for every drilled hole, the hole filled up to it', () => {
    expect(Object.keys(proposal.charges).sort()).toEqual(holes.map(h => h.id).sort());
    for (const h of holes) {
      const c = proposal.charges[h.id]!;
      expect(getExplosive(c.explosiveId), h.id).toBeDefined();
      expect(c.amountKg, h.id).toBeGreaterThan(0);
      expect(c.amountKg, h.id).toBe(fillChargeKg(h.depth, c.stemmingM, h.diameter, c.explosiveId));
    }
    expectFilledWithinRange(holes, proposal, ALL_IDS);
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
    const limited = optimizeCharges(holes, grid, { explosiveIds: ALL_IDS, maxTotalKg: 200 });
    expect(limited.permitKgLimit).toBe(200);
    expect(limited.totalKg).toBeLessThanOrEqual(200);
    expect(limited.withinPermit).toBe(true);
  });

  it('is deterministic', () => {
    expect(optimizeCharges(holes, grid, { explosiveIds: ALL_IDS })).toEqual(proposal);
  });
});

describe('optimizeCharges — beats the hand plans (C2)', () => {
  const grid = mixedRockGrid();
  const holes = mixedRockHoles();

  it('pooled good share is at least that of every one-explosive one-stemming plan on the same pattern', () => {
    const proposal = optimizeCharges(holes, grid, { explosiveIds: ALL_IDS });
    const best = proposal.bandShares!.good;
    for (const charges of handPlans(holes, ALL_IDS)) {
      const c = Object.values(charges)[0]!;
      expect(best, `${c.explosiveId} filled to ${c.stemmingM}m`).toBeGreaterThanOrEqual(goodShareOf(holes, grid, charges) - 1e-9);
    }
  });

  it('beats or equals the default hand plan on the mixed-rock pattern', () => {
    // What the Charge step opens at: boomite, every hole filled up to the default stemming.
    const proposal = optimizeCharges(holes, grid, { explosiveIds: ALL_IDS });
    const dflt = fillAll(holes, 'boomite', CHARGE_DEFAULT_STEMMING_M);
    expect(Object.keys(dflt)).toHaveLength(holes.length);
    expect(proposal.bandShares!.good).toBeGreaterThanOrEqual(goodShareOf(holes, grid, dflt) - 1e-9);
  });

  it('holds against hand plans drawn from a restricted explosive list', () => {
    const offered = ['boomite', 'krackle'];
    const proposal = optimizeCharges(holes, grid, { explosiveIds: offered });
    for (const charges of handPlans(holes, offered)) {
      expect(proposal.bandShares!.good).toBeGreaterThanOrEqual(goodShareOf(holes, grid, charges) - 1e-9);
    }
  });

  it('holds against the hand plans that fit under the permit limit', () => {
    const maxTotalKg = 16;
    const proposal = optimizeCharges(holes, grid, { explosiveIds: ALL_IDS, maxTotalKg });
    expect(proposal.totalKg).toBeLessThanOrEqual(maxTotalKg + 1e-9);
    const underLimit = handPlans(holes, ALL_IDS, 8).filter(c => totalOf(c) <= maxTotalKg);
    expect(underLimit.length).toBeGreaterThan(0);
    for (const charges of underLimit) {
      const c = Object.values(charges)[0]!;
      expect(proposal.bandShares!.good, `${c.explosiveId} filled to ${c.stemmingM}m`).toBeGreaterThanOrEqual(goodShareOf(holes, grid, charges) - 1e-9);
    }
  });
});

describe('optimizeCharges — limits and offered explosives (C3)', () => {
  const grid = mixedRockGrid();

  it('every charge fills its hole up to a stemming that throws no rock, and fits', () => {
    const holes = mixedRockHoles();
    expectFilledWithinRange(holes, optimizeCharges(holes, grid, { explosiveIds: ALL_IDS }), ALL_IDS);
  });

  it('fills a wider hole to its own bore', () => {
    const holes = mixedRockHoles(8, 0.127);
    const proposal = optimizeCharges(holes, grid, { explosiveIds: ALL_IDS });
    expect(Object.keys(proposal.charges)).toHaveLength(holes.length);
    expectFilledWithinRange(holes, proposal, ALL_IDS);
  });

  it('respects a shallow hole: its stemming stays within the shallow hole\'s own range', () => {
    const holes = mixedRockHoles(4);
    const proposal = optimizeCharges(holes, grid, { explosiveIds: ALL_IDS });
    expect(Object.keys(proposal.charges)).toHaveLength(holes.length);
    expectFilledWithinRange(holes, proposal, ALL_IDS);
  });

  it('uses only the explosives offered', () => {
    const holes = mixedRockHoles();
    for (const offered of [['pop_rock'], ['boomite', 'shatternite'], ['dynatomics']]) {
      const proposal = optimizeCharges(holes, grid, { explosiveIds: offered });
      expectFilledWithinRange(holes, proposal, offered);
      for (const c of Object.values(proposal.charges)) expect(offered).toContain(c.explosiveId);
    }
  });

  it('ignores an unknown explosive id in the offer', () => {
    const holes = mixedRockHoles();
    const proposal = optimizeCharges(holes, grid, { explosiveIds: ['nonexistent', 'boomite'] });
    expect(Object.keys(proposal.charges)).toHaveLength(holes.length);
    for (const c of Object.values(proposal.charges)) expect(c.explosiveId).toBe('boomite');
  });

  it('puts a hole too shallow for any charge under stemming in skippedHoleIds and out of charges', () => {
    // Under 1 m there is no room for the minimum stemming over the shortest charge column.
    const shallow = mixedRockHoles(0.8, 0.089).slice(0, 1).map(h => ({ ...h, id: 'HX', x: 16, z: 10 }));
    expect(stemmingSweepRangeM(0.8)).toBeNull();
    const holes = [...mixedRockHoles(), ...shallow];
    const proposal = optimizeCharges(holes, grid, { explosiveIds: ALL_IDS });
    expect(proposal.skippedHoleIds).toEqual(['HX']);
    expect(proposal.charges['HX']).toBeUndefined();
    expect(Object.keys(proposal.charges).length).toBe(holes.length - 1);
  });

  it('skips every hole when no explosive is offered', () => {
    const holes = mixedRockHoles();
    const proposal = optimizeCharges(holes, grid, { explosiveIds: [] });
    expect(proposal.charges).toEqual({});
    expect([...proposal.skippedHoleIds].sort()).toEqual(holes.map(h => h.id).sort());
    expect(proposal.totalKg).toBe(0);
    expect(proposal.cost).toBe(0);
  });

  it('proposes nothing for an empty pattern', () => {
    const proposal = optimizeCharges([], grid, { explosiveIds: ALL_IDS });
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
    const proposal = optimizeCharges(holes, grid, { explosiveIds: ALL_IDS, wetHoleIds: wet });
    for (const id of wet) {
      const c = proposal.charges[id];
      expect(c, id).toBeDefined();
      expect(getExplosive(c!.explosiveId)!.waterSensitive, id).toBe(false);
    }
  });

  it('never proposes one for any hole when every hole is wet', () => {
    const wet = new Set(holes.map(h => h.id));
    const proposal = optimizeCharges(holes, grid, { explosiveIds: ALL_IDS, wetHoleIds: wet });
    for (const c of Object.values(proposal.charges)) expect(sensitive).not.toContain(c.explosiveId);
  });

  it('skips a wet hole when only water-sensitive explosives are offered, and charges the dry ones', () => {
    const wetId = holes[1]!.id;
    const proposal = optimizeCharges(holes, grid, { explosiveIds: sensitive, wetHoleIds: new Set([wetId]) });
    expect(proposal.skippedHoleIds).toEqual([wetId]);
    expect(proposal.charges[wetId]).toBeUndefined();
    for (const h of holes.filter(x => x.id !== wetId)) expect(proposal.charges[h.id], h.id).toBeDefined();
  });

  it('still proposes a water-sensitive explosive where holes are dry and the offer is only such', () => {
    const proposal = optimizeCharges(holes, grid, { explosiveIds: sensitive, wetHoleIds: new Set() });
    expect(proposal.skippedHoleIds).toEqual([]);
  });
});

describe('optimizeCharges — permit kg limit (C5)', () => {
  const grid = mixedRockGrid();
  const holes = mixedRockHoles();
  const minKgOf = lightestKg;

  it('echoes maxTotalKg as permitKgLimit', () => {
    const p = optimizeCharges(holes, grid, { explosiveIds: ALL_IDS, maxTotalKg: 77 });
    expect(p.permitKgLimit).toBe(77);
  });

  it('has an infinite limit and stays within it when maxTotalKg is omitted', () => {
    const p = optimizeCharges(holes, grid, { explosiveIds: ALL_IDS });
    expect(p.permitKgLimit).toBe(Infinity);
    expect(p.withinPermit).toBe(true);
  });

  it('keeps the total at or under a limit that can be met', () => {
    const offered = ['boomite', 'krackle'];
    const minSum = sum(holes.map(h => minKgOf(h, offered)));
    for (const limit of [minSum, minSum * 1.25, minSum * 2]) {
      const p = optimizeCharges(holes, grid, { explosiveIds: offered, maxTotalKg: limit });
      expect(p.totalKg, `limit ${limit}`).toBeLessThanOrEqual(limit + 1e-9);
      expect(p.withinPermit, `limit ${limit}`).toBe(true);
      expect(p.totalKg).toBeCloseTo(totalOf(p.charges), 6);
      expect(Object.keys(p.charges).length).toBe(holes.length);
    }
  });

  it('a tight limit holds the total below what the unlimited proposal spends', () => {
    const offered = ['boomite', 'krackle'];
    const free = optimizeCharges(holes, grid, { explosiveIds: offered });
    const minSum = sum(holes.map(h => minKgOf(h, offered)));
    const limit = minSum * 1.1;
    const tight = optimizeCharges(holes, grid, { explosiveIds: offered, maxTotalKg: limit });
    expect(tight.totalKg).toBeLessThanOrEqual(limit + 1e-9);
    if (free.totalKg > limit) expect(tight.totalKg).toBeLessThan(free.totalKg);
  });

  it('reports withinPermit=false when even the minimum charges exceed the limit', () => {
    const minSum = sum(holes.map(h => minKgOf(h, ALL_IDS)));
    const p = optimizeCharges(holes, grid, { explosiveIds: ALL_IDS, maxTotalKg: minSum / 2 });
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
    optimizeCharges(holes, grid, { explosiveIds: ALL_IDS, wetHoleIds: new Set([holes[0]!.id]), maxTotalKg: 30 });
    expect(JSON.parse(JSON.stringify(holes))).toEqual(holesBefore);
    expect(gridFingerprint(grid)).toBe(gridBefore);
  });
});

describe('optimizerOptionsFor', () => {
  function stateWithHoles() {
    const state = createGame({ seed: 7, mineType: 'desert' });
    state.drillHoles.push(...mixedRockHoles());
    return state;
  }

  it('offers the active level\'s explosives, and no stemming: the optimizer sweeps it per hole', () => {
    const state = stateWithHoles();
    const options = optimizerOptionsFor(state);
    expect(options.explosiveIds).toEqual(resolveAvailableExplosives(state.campaign.activeLevelId));
    expect(options).not.toHaveProperty('stemmingM');
  });

  it('follows a level that offers fewer explosives', () => {
    const state = stateWithHoles();
    state.campaign.activeLevelId = 'tutorial_pit';
    expect(optimizerOptionsFor(state).explosiveIds).toEqual(resolveAvailableExplosives('tutorial_pit'));
    expect(optimizerOptionsFor(state).explosiveIds.length).toBeLessThan(ALL_IDS.length);
  });

  it('carries the wet holes', () => {
    const state = stateWithHoles();
    expect([...optimizerOptionsFor(state).wetHoleIds!]).toEqual([]);
    setHoleWater(state, [state.drillHoles[0]!.id]);
    expect([...optimizerOptionsFor(state).wetHoleIds!]).toEqual([state.drillHoles[0]!.id]);
  });

  it('caps the plan at the permit grade\'s kg limit', () => {
    const state = stateWithHoles();
    state.grade = createGradeState();
    expect(optimizerOptionsFor(state).maxTotalKg).toBe(permitLimitsFor(state.grade.grade).maxChargeKg);
  });

  it('is unlimited without a permit grade', () => {
    const state = stateWithHoles();
    expect(state.grade).toBeUndefined();
    expect(optimizerOptionsFor(state)).not.toHaveProperty('maxTotalKg');
  });
});
