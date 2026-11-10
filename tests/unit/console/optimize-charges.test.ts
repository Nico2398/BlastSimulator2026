// BlastSimulator2026 — `optimize_charges` console command: the tier-4 charge proposal (#2204)
import { describe, it, expect } from 'vitest';
import { createRunner } from '../../../src/console/createRunner.js';
import { createGridPlan } from '../../../src/core/mining/DrillPlan.js';
import { createGradeState } from '../../../src/core/economy/MineGrade.js';
import { permitLimitsFor } from '../../../src/core/economy/PermitLimits.js';
import { explosiveHoleLimits, chargeFitsHole } from '../../../src/core/mining/ChargePlan.js';
import { getExplosive } from '../../../src/core/world/ExplosiveCatalog.js';
import { MIN_STEMMING_M } from '../../../src/core/config/balance.js';
import { wetAllHoles } from '../../helpers/holeWater.js';
import { mixedRockGrid, gridFingerprint } from '../../helpers/optimizerFixtures.js';

function setup(opts: { tier?: number; rows?: number; cols?: number; depth?: number } = {}) {
  const { runner, ctx } = createRunner();
  expect(runner.run('new_game seed:42 size:32')).toMatchObject({ success: true });
  const state = ctx.state!;
  ctx.grid = mixedRockGrid();
  state.softwareTier = opts.tier ?? 4;
  const rows = opts.rows ?? 2;
  const cols = opts.cols ?? 2;
  if (rows > 0) state.drillHoles.push(...createGridPlan(state, { x: 8, z: 8 }, rows, cols, 3, opts.depth ?? 8, 0.089));
  return { runner, ctx, state };
}

const chargeActions = (state: ReturnType<typeof setup>['state']) => state.pendingActions.filter(a => a.type === 'charge_hole');

describe('optimize_charges — tier gate', () => {
  it('fails without a game loaded', () => {
    const { runner } = createRunner();
    expect(runner.run('optimize_charges').success).toBe(false);
  });

  it.each([0, 1, 2, 3])('fails at software tier %i, naming the Charge Optimizer and tier 4', (tier) => {
    const { runner, state } = setup({ tier });
    const res = runner.run('optimize_charges');
    expect(res.success).toBe(false);
    expect(res.output).toContain('Charge Optimizer');
    expect(res.output).toMatch(/4/);
    expect(Object.keys(state.plannedChargesByHole)).toEqual([]);
    expect(chargeActions(state)).toHaveLength(0);
  });

  it('does not order anything below tier 4 even with apply:true', () => {
    const { runner, state } = setup({ tier: 3 });
    expect(runner.run('optimize_charges apply:true').success).toBe(false);
    expect(Object.keys(state.plannedChargesByHole)).toEqual([]);
    expect(chargeActions(state)).toHaveLength(0);
  });

  it('fails at tier 4 without drilled holes', () => {
    const { runner, state } = setup({ tier: 4, rows: 0 });
    const res = runner.run('optimize_charges');
    expect(res.success).toBe(false);
    expect(res.output.length).toBeGreaterThan(0);
    expect(chargeActions(state)).toHaveLength(0);
  });

  it('fails with apply:true and no drilled holes', () => {
    const { runner, state } = setup({ tier: 4, rows: 0 });
    expect(runner.run('optimize_charges apply:true').success).toBe(false);
    expect(Object.keys(state.plannedChargesByHole)).toEqual([]);
  });
});

describe('optimize_charges — proposal without apply', () => {
  it('succeeds printing a summary and orders no charge', () => {
    const { runner, state } = setup();
    const holesBefore = JSON.stringify(state.drillHoles);
    const res = runner.run('optimize_charges');
    expect(res.success).toBe(true);
    expect(res.output.trim().length).toBeGreaterThan(0);
    expect(Object.keys(state.plannedChargesByHole)).toEqual([]);
    expect(Object.keys(state.chargesByHole)).toEqual([]);
    expect(chargeActions(state)).toHaveLength(0);
    expect(JSON.stringify(state.drillHoles)).toBe(holesBefore);
  });

  it('leaves the grid untouched', () => {
    const { runner, ctx } = setup();
    const before = gridFingerprint(ctx.grid!);
    runner.run('optimize_charges');
    expect(gridFingerprint(ctx.grid!)).toBe(before);
  });

  it('apply:false orders nothing either', () => {
    const { runner, state } = setup();
    expect(runner.run('optimize_charges apply:false').success).toBe(true);
    expect(chargeActions(state)).toHaveLength(0);
    expect(Object.keys(state.plannedChargesByHole)).toEqual([]);
  });
});

describe('optimize_charges apply:true', () => {
  it('orders a charge for every drilled hole the way the charge command does', () => {
    const { runner, state } = setup();
    const res = runner.run('optimize_charges apply:true');
    expect(res.success).toBe(true);
    const ids = state.drillHoles.map(h => h.id).sort();
    expect(Object.keys(state.plannedChargesByHole).sort()).toEqual(ids);
    expect(chargeActions(state).map(a => a.payload['holeId'] as string).sort()).toEqual(ids);
  });

  it('each ordered charge respects the explosive range and the hole under the stemming', () => {
    const { runner, state } = setup();
    runner.run('optimize_charges apply:true');
    for (const h of state.drillHoles) {
      const c = state.plannedChargesByHole[h.id]!;
      const e = getExplosive(c.explosiveId)!;
      const { minKg, maxKg } = explosiveHoleLimits(e, h.diameter);
      expect(c.amountKg, h.id).toBeGreaterThanOrEqual(minKg - 1e-9);
      expect(c.amountKg, h.id).toBeLessThanOrEqual(maxKg + 1e-9);
      expect(chargeFitsHole(c.amountKg, c.stemmingM, h.depth, h.diameter), h.id).toBe(true);
    }
  });

  it('the queued actions carry the same explosive, amount and stemming as the planned charges', () => {
    const { runner, state } = setup();
    runner.run('optimize_charges apply:true');
    for (const a of chargeActions(state)) {
      const planned = state.plannedChargesByHole[a.payload['holeId'] as string]!;
      expect(a.payload['explosiveId']).toBe(planned.explosiveId);
      expect(a.payload['amountKg']).toBe(planned.amountKg);
      expect(a.payload['stemmingM']).toBe(planned.stemmingM);
    }
  });

  it('stemming:<m>m sets the stemming of every proposed charge', () => {
    const { runner, state } = setup();
    expect(runner.run('optimize_charges stemming:3m apply:true').success).toBe(true);
    for (const c of Object.values(state.plannedChargesByHole)) expect(c.stemmingM).toBe(3);
  });

  it('uses a default stemming when none is given', () => {
    const { runner, state } = setup();
    runner.run('optimize_charges apply:true');
    for (const c of Object.values(state.plannedChargesByHole)) {
      expect(c.stemmingM).toBeGreaterThanOrEqual(MIN_STEMMING_M);
    }
  });

  it('never orders a water-sensitive explosive for a wet hole', () => {
    const { runner, state } = setup();
    wetAllHoles(state);
    expect(runner.run('optimize_charges apply:true').success).toBe(true);
    for (const c of Object.values(state.plannedChargesByHole)) expect(getExplosive(c.explosiveId)!.waterSensitive).toBe(false);
  });

  it('keeps the total within the permit kg limit of the mine grade', () => {
    const { runner, state } = setup({ rows: 3, cols: 4 });
    state.grade = createGradeState();
    const limit = permitLimitsFor(state.grade.grade).maxChargeKg;
    expect(runner.run('optimize_charges apply:true').success).toBe(true);
    const total = Object.values(state.plannedChargesByHole).reduce((s, c) => s + c.amountKg, 0);
    expect(Object.keys(state.plannedChargesByHole)).toHaveLength(12);
    expect(total).toBeLessThanOrEqual(limit + 1e-9);
  });
});
