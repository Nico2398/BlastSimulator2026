// BlastSimulator2026 — Integration: cost previews and the blast report net of warehouse stock (#1685)
//
// #1678 let a charge order draw warehouse stock before cash, but the blast report
// still priced the pattern at list price ("spent $1,080" for a pattern paid from
// stock). The report now splits spent (cash) from spentFromStock (list value of
// the stock kg), and the saved-plan load message prices the cash part only.

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import type { GameState } from '../../src/core/state/GameState.js';
import { placeBuilding, getExplosivesStockByType } from '../../src/core/entities/Building.js';
import { recordedChargesCost } from '../../src/core/mining/ChargePlan.js';
import { tickUntilFresh } from '../helpers/blastFixtures.js';
import { EXPLOSIVE_DELIVERY_TICKS } from '../../src/core/config/balance.js';

type Run = (cmd: string) => { success: boolean; output: string };

function setup(newGame: string): { run: Run; state: GameState } {
  const { runner, ctx } = createRunner();
  const run: Run = cmd => runner.run(cmd) as { success: boolean; output: string };
  expect(run(newGame).success).toBe(true);
  const state = ctx.state!;
  state.cash = 5_000_000;
  state.finances.cash = 5_000_000;
  placeBuilding(state.buildings, 'explosive_warehouse', 5, 5, 32, 32, 1);
  return { run, state };
}

function drillGrid(run: Run, state: GameState, rows: number, cols: number): void {
  expect(run(`drill_plan grid rows:${rows} cols:${cols} spacing:5 depth:8 start:14,14`).success).toBe(true);
  tickUntilFresh(run, state, () => state.plannedDrillHoles.length === 0, 1500);
  expect(state.drillHoles).toHaveLength(rows * cols);
}

function chargeAll(run: Run, state: GameState, explosive: string, kg: number): void {
  const holes = state.drillHoles.length;
  expect(run(`charge hole:* explosive:${explosive} amount:${kg} stemming:2`).success).toBe(true);
  tickUntilFresh(run, state, () => Object.keys(state.plannedChargesByHole).length === 0, EXPLOSIVE_DELIVERY_TICKS + 1500);
  expect(Object.keys(state.chargesByHole)).toHaveLength(holes);
}

function evacuate(state: GameState): void {
  for (const unit of [...state.employees.employees, ...state.vehicles.vehicles]) { unit.x = 2; unit.z = 2; }
  state.cash = 5_000_000;
  state.finances.cash = 5_000_000;
}

describe('blast report nets stock out of the spent figure (#1685)', () => {
  it('a pattern paid entirely from stock reports spent 0 and the list value as spentFromStock', () => {
    const { run, state } = setup('new_game mine_type:desert_badlands seed:42 size:32 staffed:true');
    expect(run('buy explosive:krackle kg:100').success).toBe(true);
    drillGrid(run, state, 3, 3);
    chargeAll(run, state, 'krackle', 6);

    // recorded at order time, carried onto the loaded charges
    for (const c of Object.values(state.chargesByHole)) expect(c.fromStockKg).toBe(6);
    expect(recordedChargesCost(state.chargesByHole).cashCost).toBe(0);
    expect(getExplosivesStockByType(state.buildings)['krackle']).toBeCloseTo(100 - 54, 6);

    evacuate(state);
    expect(run('blast').success).toBe(true);
    const report = state.lastBlastReport!;
    expect(report.spent).toBe(0);
    expect(report.spentFromStock).toBeGreaterThan(0);
  });

  it('a pattern with no stock reports full cash spent and no stock value', () => {
    const { run, state } = setup('new_game mine_type:desert_badlands seed:42 size:32 staffed:true');
    drillGrid(run, state, 2, 2);
    chargeAll(run, state, 'krackle', 6);
    for (const c of Object.values(state.chargesByHole)) expect(c.fromStockKg ?? 0).toBe(0);

    evacuate(state);
    expect(run('blast').success).toBe(true);
    const report = state.lastBlastReport!;
    expect(report.spent).toBeGreaterThan(0);
    expect(report.spentFromStock ?? 0).toBe(0);
  });

  it('a partly stocked pattern splits the report: cash for the shortfall, stock value for the rest', () => {
    const { run, state } = setup('new_game mine_type:desert_badlands seed:42 size:32 staffed:true');
    expect(run('buy explosive:krackle kg:12').success).toBe(true); // covers 2 of 4 holes at 6 kg
    drillGrid(run, state, 2, 2);
    chargeAll(run, state, 'krackle', 6);

    const split = recordedChargesCost(state.chargesByHole);
    expect(split.fromStockKg).toBe(12);
    expect(split.totalKg).toBe(24);

    evacuate(state);
    expect(run('blast').success).toBe(true);
    const report = state.lastBlastReport!;
    expect(report.spent).toBeCloseTo(split.cashCost, 6);
    expect(report.spentFromStock).toBeCloseTo(split.stockValue, 6);
    expect(report.spent).toBeGreaterThan(0);
    expect(report.spentFromStock!).toBeGreaterThan(0);
  });
});

describe('blast_plan load message prices cash net of stock (#1685)', () => {
  function savedPlanWithStock(): { run: Run; state: GameState } {
    const { run, state } = setup('new_game seed:42 size:32 staffed:true');
    expect(run('buy explosive:boomite kg:200').success).toBe(true);
    drillGrid(run, state, 2, 2);
    chargeAll(run, state, 'boomite', 5);
    expect(run('blast_plan save').success).toBe(true);
    // Empty the site without firing (as drill-plan-queueing's clearHolesWithoutBlast does).
    state.drillHoles.length = 0;
    state.patternCharge = null;
    for (const k of Object.keys(state.chargesByHole)) delete state.chargesByHole[k];
    return { run, state };
  }

  it('shows 0 cost when the stock covers the whole saved plan, not the list price', () => {
    const { run } = savedPlanWithStock();
    const r = run('blast_plan load');
    expect(r.success).toBe(true);
    expect(r.output).toContain('queued (0)');
    expect(r.output).not.toContain('240'); // 20 kg x $12 list
  });

  it('shows the list price when no stock is left', () => {
    const { run, state } = savedPlanWithStock();
    for (const b of state.buildings.buildings) b.storedExplosives = {};
    const r = run('blast_plan load');
    expect(r.success).toBe(true);
    expect(r.output).toContain('240');
  });
});
