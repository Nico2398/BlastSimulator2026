// BlastSimulator2026 — Integration tests: charge_hole action queueing (#554)
//
// `charge hole:*` used to write finished HoleCharge records straight into
// state.chargesByHole in one frame — instant, no employee, no time. #554
// changes this, mirroring #553's drill_hole split: `charge hole:<id>` queues
// one `charge_hole` PendingAction per hole instead (requiredSkill:
// 'blasting', requiredVehicleRole: 'charging_truck' since #1649 — worked
// from a truck like drilling's drill_rig gate), validated immediately at order time (createCharge's
// existing refusals are unchanged), and a hole only lands in
// state.chargesByHole once its own action completes. Ordered-but-unloaded
// charges live in state.plannedChargesByHole in the meantime.
//
// Uses the console/createRunner layer (mirrors
// tests/integration/drill-plan-queueing.test.ts) so the full dispatch ->
// claim -> walk -> tick -> land pipeline runs exactly as a real player's
// `tick` commands would drive it.

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import { tickUntil } from './helpers.js';
import type { GameState } from '../../src/core/state/GameState.js';
import { getFinancialReport } from '../../src/core/economy/Finance.js';
import { t } from '../../src/core/i18n/I18n.js';
import { serialize, deserialize } from '../../src/core/state/SaveLoad.js';
import { readFileSync } from 'node:fs';
import { fundForDeliveryWait } from '../helpers/playthrough.js';
import { fillChargeKg } from '../../src/core/mining/ChargePlan.js';
import { chargeKgPerMetre } from '../../src/core/mining/HoleDiameter.js';
import { DRILL_HOLE_DEFAULT_DIAMETER_M } from '../../src/core/config/balance.js';

/** tickUntil with the payroll covered, so a long drill-and-charge run is never derailed by upkeep. */
function tickFunded(run: (cmd: string) => unknown, state: GameState, predicate: () => boolean, maxTicks: number): void {
  tickUntil(run, () => {
    fundForDeliveryWait(state);
    // A random event fired during the long wait halts the clock until resolved.
    if (state.events.pendingEvent) run('event choose 0');
    return predicate();
  }, maxTicks);
}

/** Drills a grid and waits for every hole to land in state.drillHoles. */
function drillAndLand(
  run: (cmd: string) => { success: boolean },
  state: { plannedDrillHoles: unknown[]; drillHoles: unknown[] },
  spec: string,
): void {
  expect(run(`drill_plan grid ${spec}`).success).toBe(true);
  tickUntil(run, () => state.plannedDrillHoles.length === 0, 800);
  expect(state.plannedDrillHoles).toHaveLength(0);
}

describe('charge hole:<id> — queues one charge_hole action instead of writing chargesByHole instantly (#554)', () => {
  it('queues exactly one charge_hole PendingAction and writes the validated charge into plannedChargesByHole; chargesByHole stays untouched until landed', () => {
    const { runner, ctx } = createRunner();
    const run = (cmd: string) => runner.run(cmd);

    expect(run('new_game seed:42 size:32 staffed:true').success).toBe(true);
    const state = ctx.state!;
    drillAndLand(run, state, 'rows:1 cols:1 spacing:5 depth:8 start:14,14');
    const holeId = state.drillHoles[0]!.id;

    const result = run(`charge hole:${holeId} explosive:boomite amount:5 stemming:2`);
    expect(result.success).toBe(true);

    expect(state.plannedChargesByHole[holeId]).toEqual({ explosiveId: 'boomite', amountKg: 5, stemmingM: 2 });
    expect(state.chargesByHole[holeId]).toBeUndefined();

    const chargeActions = state.pendingActions.filter(a => a.type === 'charge_hole');
    expect(chargeActions).toHaveLength(1);
    expect(chargeActions[0]!.requiredSkill).toBe('blasting');
    expect(chargeActions[0]!.requiredVehicleRole).toBe('charging_truck');
    expect(chargeActions[0]!.payload['holeId']).toBe(holeId);
  });

  it('charge hole:* queues one charge_hole action per already-drilled hole now; the undrilled hole is auto-charged once it lands (#1345)', () => {
    const { runner, ctx } = createRunner();
    const run = (cmd: string) => runner.run(cmd);

    expect(run('new_game seed:42 size:32 staffed:true').success).toBe(true);
    const state = ctx.state!;
    // Order a 2-hole grid but only wait for one to actually land, leaving
    // the other still in plannedDrillHoles (undrilled).
    expect(run('drill_plan grid rows:1 cols:2 spacing:5 depth:8 start:14,14').success).toBe(true);
    tickUntil(run, () => state.drillHoles.length >= 1, 800);
    expect(state.drillHoles.length).toBeGreaterThanOrEqual(1);
    const drilledCountBefore = state.drillHoles.length;
    const stillPlannedCountBefore = state.plannedDrillHoles.length;
    expect(stillPlannedCountBefore).toBeGreaterThan(0);

    const result = run('charge hole:* explosive:boomite amount:5 stemming:2');
    expect(result.success).toBe(true);

    const chargeActions = state.pendingActions.filter(a => a.type === 'charge_hole');
    expect(chargeActions).toHaveLength(drilledCountBefore);
    for (const drilled of state.drillHoles) {
      expect(chargeActions.some(a => a.payload['holeId'] === drilled.id)).toBe(true);
    }
    // No charge_hole action targets a hole still sitting in plannedDrillHoles yet.
    for (const stillPlanned of state.plannedDrillHoles) {
      expect(chargeActions.some(a => a.payload['holeId'] === stillPlanned.id)).toBe(false);
    }

    // The late hole is charged by the pattern, with no further charge call.
    tickFunded(run, state, () => state.plannedDrillHoles.length === 0 && Object.keys(state.chargesByHole).length === 2, 1500);
    expect(Object.keys(state.chargesByHole).sort()).toEqual(['H1', 'H2']);
    for (const c of Object.values(state.chargesByHole)) {
      expect(c).toEqual({ explosiveId: 'boomite', amountKg: 5, stemmingM: 2 });
    }
  });

  it('charging an undrilled hole by explicit id is refused with "has not been drilled yet" — no action queued (unchanged from #553)', () => {
    const { runner, ctx } = createRunner();
    const run = (cmd: string) => runner.run(cmd);

    expect(run('new_game seed:42 size:32 staffed:true').success).toBe(true);
    const state = ctx.state!;
    expect(run('drill_plan grid rows:1 cols:1 spacing:5 depth:8 start:14,14').success).toBe(true);
    expect(state.plannedDrillHoles).toHaveLength(1);
    const orderedId = state.plannedDrillHoles[0]!.id;

    const result = run(`charge hole:${orderedId} explosive:boomite amount:5 stemming:2`);

    expect(result.success).toBe(false);
    expect(result.output).toBe(`Hole "${orderedId}" has not been drilled yet.`);
    expect(state.pendingActions.filter(a => a.type === 'charge_hole')).toHaveLength(0);
    expect(state.plannedChargesByHole[orderedId]).toBeUndefined();
  });

  it('ticking until the action completes moves the entry from plannedChargesByHole to chargesByHole, value unchanged', () => {
    const { runner, ctx } = createRunner();
    const run = (cmd: string) => runner.run(cmd);

    expect(run('new_game seed:42 size:32 staffed:true').success).toBe(true);
    const state = ctx.state!;
    drillAndLand(run, state, 'rows:1 cols:1 spacing:5 depth:8 start:14,14');
    const holeId = state.drillHoles[0]!.id;

    expect(run(`charge hole:${holeId} explosive:boomite amount:5 stemming:2`).success).toBe(true);
    const plannedValue = state.plannedChargesByHole[holeId];
    expect(plannedValue).toBeDefined();

    tickFunded(run, state, () => state.chargesByHole[holeId] !== undefined, 400);

    expect(state.chargesByHole[holeId]).toEqual(plannedValue);
    expect(state.plannedChargesByHole[holeId]).toBeUndefined();
    expect(state.pendingActions.filter(a => a.type === 'charge_hole' && a.payload['holeId'] === holeId)).toHaveLength(0);
  });

  it('re-charging a hole with an outstanding (not yet landed) order replaces it — never more than one charge_hole action per hole', () => {
    const { runner, ctx } = createRunner();
    const run = (cmd: string) => runner.run(cmd);

    expect(run('new_game seed:42 size:32 staffed:true').success).toBe(true);
    const state = ctx.state!;
    drillAndLand(run, state, 'rows:1 cols:1 spacing:5 depth:8 start:14,14');
    const holeId = state.drillHoles[0]!.id;

    expect(run(`charge hole:${holeId} explosive:boomite amount:5 stemming:2`).success).toBe(true);
    const actionsAfterFirst = state.pendingActions.filter(a => a.type === 'charge_hole' && a.payload['holeId'] === holeId);
    expect(actionsAfterFirst).toHaveLength(1);

    // Re-order before the first one lands (still no landing wait here).
    expect(state.chargesByHole[holeId]).toBeUndefined();
    expect(run(`charge hole:${holeId} explosive:boomite amount:8 stemming:2`).success).toBe(true);

    const actionsAfterSecond = state.pendingActions.filter(a => a.type === 'charge_hole' && a.payload['holeId'] === holeId);
    expect(actionsAfterSecond.length).toBeLessThanOrEqual(1);
    expect(state.plannedChargesByHole[holeId]).toEqual({ explosiveId: 'boomite', amountKg: 8, stemmingM: 2 });
  });

  it('re-charging an already-loaded hole (no outstanding order) queues a fresh order without altering the existing chargesByHole entry until it lands', () => {
    const { runner, ctx } = createRunner();
    const run = (cmd: string) => runner.run(cmd);

    expect(run('new_game seed:42 size:32 staffed:true').success).toBe(true);
    const state = ctx.state!;
    drillAndLand(run, state, 'rows:1 cols:1 spacing:5 depth:8 start:14,14');
    const holeId = state.drillHoles[0]!.id;

    expect(run(`charge hole:${holeId} explosive:boomite amount:5 stemming:2`).success).toBe(true);
    tickFunded(run, state, () => state.chargesByHole[holeId] !== undefined, 400);
    expect(state.chargesByHole[holeId]).toEqual({ explosiveId: 'boomite', amountKg: 5, stemmingM: 2 });
    expect(state.pendingActions.filter(a => a.type === 'charge_hole' && a.payload['holeId'] === holeId)).toHaveLength(0);

    const result = run(`charge hole:${holeId} explosive:boomite amount:8 stemming:2`);
    expect(result.success).toBe(true);

    // Fresh order queued...
    expect(state.pendingActions.filter(a => a.type === 'charge_hole' && a.payload['holeId'] === holeId)).toHaveLength(1);
    // ...but the existing landed charge is untouched until the new order lands.
    expect(state.chargesByHole[holeId]).toEqual({ explosiveId: 'boomite', amountKg: 5, stemmingM: 2 });
  });

  it('invalid charge (bad explosive id) is refused immediately — no action queued, no plannedChargesByHole entry', () => {
    const { runner, ctx } = createRunner();
    const run = (cmd: string) => runner.run(cmd);

    expect(run('new_game seed:42 size:32 staffed:true').success).toBe(true);
    const state = ctx.state!;
    drillAndLand(run, state, 'rows:1 cols:1 spacing:5 depth:8 start:14,14');
    const holeId = state.drillHoles[0]!.id;

    const result = run(`charge hole:${holeId} explosive:nonexistent amount:5 stemming:2`);

    expect(result.success).toBe(false);
    expect(state.pendingActions.filter(a => a.type === 'charge_hole')).toHaveLength(0);
    expect(state.plannedChargesByHole[holeId]).toBeUndefined();
    expect(state.chargesByHole[holeId]).toBeUndefined();
  });

  it('invalid charge (stemming below the floor) is refused immediately — no action queued', () => {
    const { runner, ctx } = createRunner();
    const run = (cmd: string) => runner.run(cmd);

    expect(run('new_game seed:42 size:32 staffed:true').success).toBe(true);
    const state = ctx.state!;
    drillAndLand(run, state, 'rows:1 cols:1 spacing:5 depth:8 start:14,14');
    const holeId = state.drillHoles[0]!.id;

    const result = run(`charge hole:${holeId} explosive:boomite amount:5 stemming:0.2`);

    expect(result.success).toBe(false);
    expect(state.pendingActions.filter(a => a.type === 'charge_hole')).toHaveLength(0);
    expect(state.plannedChargesByHole[holeId]).toBeUndefined();
  });

  it('invalid charge (amount out of range) is refused immediately, with no cash or state side effect', () => {
    const { runner, ctx } = createRunner();
    const run = (cmd: string) => runner.run(cmd);

    expect(run('new_game seed:42 size:32 staffed:true').success).toBe(true);
    const state = ctx.state!;
    drillAndLand(run, state, 'rows:1 cols:1 spacing:5 depth:8 start:14,14');
    const holeId = state.drillHoles[0]!.id;
    const cashBefore = state.cash;

    // 999 kg of boomite fills far more column than the 8 m hole holds (no per-explosive kg range anymore).
    const result = run(`charge hole:${holeId} explosive:boomite amount:999 stemming:2`);

    expect(result.success).toBe(false);
    expect(result.output).toMatch(/Maximum that fits: 12 kg/);
    expect(state.pendingActions.filter(a => a.type === 'charge_hole')).toHaveLength(0);
    expect(state.plannedChargesByHole[holeId]).toBeUndefined();
    expect(state.cash).toBe(cashBefore);
  });
});

describe('drill_plan clear / remove — cancel outstanding charge_hole actions too (#554)', () => {
  it('drill_plan clear cancels every outstanding charge_hole action and clears plannedChargesByHole', () => {
    const { runner, ctx } = createRunner();
    const run = (cmd: string) => runner.run(cmd);

    expect(run('new_game seed:42 size:32 staffed:true').success).toBe(true);
    const state = ctx.state!;
    drillAndLand(run, state, 'rows:1 cols:2 spacing:5 depth:8 start:14,14');

    expect(run('charge hole:* explosive:boomite amount:5 stemming:2').success).toBe(true);
    expect(state.pendingActions.filter(a => a.type === 'charge_hole').length).toBeGreaterThan(0);
    expect(Object.keys(state.plannedChargesByHole).length).toBeGreaterThan(0);

    const result = run('drill_plan clear');
    expect(result.success).toBe(true);

    expect(state.pendingActions.filter(a => a.type === 'charge_hole')).toHaveLength(0);
    expect(state.plannedChargesByHole).toEqual({});
  });

  it('drill_plan remove hole:<id> cancels that hole\'s outstanding charge_hole action (if any) and clears its plannedChargesByHole entry', () => {
    const { runner, ctx } = createRunner();
    const run = (cmd: string) => runner.run(cmd);

    expect(run('new_game seed:42 size:32 staffed:true').success).toBe(true);
    const state = ctx.state!;
    drillAndLand(run, state, 'rows:1 cols:2 spacing:5 depth:8 start:14,14');
    const [first, second] = state.drillHoles.map(h => h.id);

    expect(run(`charge hole:${first} explosive:boomite amount:5 stemming:2`).success).toBe(true);
    expect(run(`charge hole:${second} explosive:boomite amount:5 stemming:2`).success).toBe(true);
    expect(state.pendingActions.filter(a => a.type === 'charge_hole')).toHaveLength(2);

    const result = run(`drill_plan remove hole:${first}`);
    expect(result.success).toBe(true);

    const remaining = state.pendingActions.filter(a => a.type === 'charge_hole');
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.payload['holeId']).toBe(second);
    expect(state.plannedChargesByHole[first!]).toBeUndefined();
    expect(state.plannedChargesByHole[second!]).toBeDefined();
  });
});

// The player's other cancel path — the Operations panel's Work Queue cancel
// button (OperationsPanel.ts) issues `employee cancel <id>` directly, not
// `drill_plan clear`/`remove`. That command calls the generic `cancelAction`
// (TaskDispatch.ts) alone, which is deliberately ignorant of mining-specific
// state so it can cancel any action type — so without its own cleanup this
// path left a permanent ghost in plannedChargesByHole/plannedDrillHoles even
// though `cancelAction` itself reported success (#554 code review, found by
// @semantic-reviewer, reproduced live before this fix).
describe('employee cancel <id> — the generic cancel path also releases the planned-hole ghost (#554)', () => {
  it('cancelling a charge_hole action via employee cancel clears plannedChargesByHole, not just the PendingAction', () => {
    const { runner, ctx } = createRunner();
    const run = (cmd: string) => runner.run(cmd);

    expect(run('new_game seed:42 size:32 staffed:true').success).toBe(true);
    const state = ctx.state!;
    drillAndLand(run, state, 'rows:1 cols:1 spacing:5 depth:8 start:14,14');
    const holeId = state.drillHoles[0]!.id;

    expect(run(`charge hole:${holeId} explosive:boomite amount:5 stemming:2`).success).toBe(true);
    const action = state.pendingActions.find(a => a.type === 'charge_hole');
    expect(action).toBeDefined();
    expect(state.plannedChargesByHole[holeId]).toBeDefined();

    const result = run(`employee cancel ${action!.id}`);
    expect(result.success).toBe(true);

    expect(state.pendingActions.filter(a => a.type === 'charge_hole')).toHaveLength(0);
    expect(state.plannedChargesByHole[holeId]).toBeUndefined();

    // Self-healing follow-up charge must still work cleanly on the
    // now-properly-released hole.
    expect(run(`charge hole:${holeId} explosive:boomite amount:5 stemming:2`).success).toBe(true);
    expect(state.plannedChargesByHole[holeId]).toBeDefined();
  });

  it('cancelling a drill_hole action via employee cancel clears plannedDrillHoles too (#553 shared the same gap)', () => {
    const { runner, ctx } = createRunner();
    const run = (cmd: string) => runner.run(cmd);

    expect(run('new_game seed:42 size:32 staffed:true').success).toBe(true);
    const state = ctx.state!;

    expect(run('drill_plan grid rows:1 cols:1 spacing:5 depth:8 start:14,14').success).toBe(true);
    expect(state.plannedDrillHoles).toHaveLength(1);
    const action = state.pendingActions.find(a => a.type === 'drill_hole');
    expect(action).toBeDefined();

    const result = run(`employee cancel ${action!.id}`);
    expect(result.success).toBe(true);

    expect(state.pendingActions.filter(a => a.type === 'drill_hole')).toHaveLength(0);
    expect(state.plannedDrillHoles).toHaveLength(0);
    expect(state.drillHoles).toHaveLength(0);
  });
});

// ── #1341: explosives cost money ──
//
// Loading explosives costs costPerKg x kg, booked at ORDER time as an
// 'explosives' expense (like ramps/buildings), refunded in full when the
// order is cancelled (actionOrderCost, TaskCancellation.ts). Landing the
// charge and firing the blast move no cash for explosives.

type Runner = ReturnType<typeof createRunner>;

/** Staffed game with `rows x cols` drilled holes and plenty of cash, so cost assertions are exact. */
function setupDrilled(rows: number, cols: number, cash = 500_000): { run: (c: string) => { success: boolean; output: string }; state: NonNullable<Runner['ctx']['state']> } {
  const { runner, ctx } = createRunner();
  const run = (cmd: string) => runner.run(cmd);
  expect(run('new_game seed:42 size:32 staffed:true').success).toBe(true);
  const state = ctx.state!;
  drillAndLand(run, state, `rows:${rows} cols:${cols} spacing:4 depth:8 start:12,12`);
  state.cash = cash;
  state.finances.cash = cash;
  return { run, state };
}

function explosivesTotal(state: { finances: Parameters<typeof getFinancialReport>[0]; tickCount: number }): number {
  const report = getFinancialReport(state.finances, state.tickCount);
  return report.expensesByCategory.find(c => c.category === 'explosives')?.total ?? 0;
}

describe('charge order cash cost: paid when the hole is loaded, not when ordered (#1341, #2143)', () => {
  it('charge hole:* amount:12kg of a $200/kg explosive on 6 holes books nothing at order time', () => {
    const { run, state } = setupDrilled(2, 3);
    expect(state.drillHoles).toHaveLength(6);
    const cashBefore = state.cash;

    const result = run('charge hole:* explosive:dynatomics amount:12kg stemming:2');

    expect(result.success).toBe(true);
    expect(state.pendingActions.filter(a => a.type === 'charge_hole')).toHaveLength(6);
    expect(state.cash).toBe(cashBefore);
    expect(state.finances.cash).toBe(state.cash);
    expect(explosivesTotal(state)).toBe(0);
  });

  it('a single charge hole:H1 books no cost at order time and exactly one explosives expense when the charge lands', () => {
    const { run, state } = setupDrilled(1, 1);
    const holeId = state.drillHoles[0]!.id;
    const cashBefore = state.cash;

    expect(run(`charge hole:${holeId} explosive:boomite amount:5 stemming:2`).success).toBe(true);
    expect(state.cash).toBe(cashBefore);
    expect(explosivesTotal(state)).toBe(0);

    tickFunded(run, state, () => state.chargesByHole[holeId] !== undefined, 400);
    expect(state.chargesByHole[holeId]).toBeDefined();
    expect(explosivesTotal(state)).toBe(60);
    const explosivesTx = state.finances.transactions.filter(t => t.category === 'explosives');
    expect(explosivesTx).toHaveLength(1);
  });

  it('with an empty warehouse the hole is loaded without a 400-tick delivery wait', () => {
    const { run, state } = setupDrilled(1, 1);
    const holeId = state.drillHoles[0]!.id;
    expect(run(`charge hole:${holeId} explosive:boomite amount:5 stemming:2`).success).toBe(true);
    const start = state.tickCount;

    tickFunded(run, state, () => state.chargesByHole[holeId] !== undefined, 395);

    expect(state.chargesByHole[holeId]).toBeDefined();
    expect(state.tickCount - start).toBeLessThan(395);
  });

  it('firing the blast books no further explosives cost, and the report spent equals the sum of loaded charge costs', () => {
    const { run, state } = setupDrilled(1, 2);
    expect(run('charge hole:* explosive:boomite amount:5 stemming:2').success).toBe(true);
    const holes = state.drillHoles.length;
    tickFunded(run, state, () => Object.keys(state.chargesByHole).length === holes, 600);
    expect(Object.keys(state.chargesByHole)).toHaveLength(holes);
    const expected = holes * 5 * 12;
    expect(explosivesTotal(state)).toBe(expected);

    const explosivesTxBefore = state.finances.transactions.filter(t => t.category === 'explosives').length;
    const blast = run('blast');
    expect(blast.success).toBe(true);

    expect(state.lastBlastReport!.spent).toBe(expected);
    expect(explosivesTotal(state)).toBe(expected);
    expect(state.finances.transactions.filter(t => t.category === 'explosives')).toHaveLength(explosivesTxBefore);
  });

  it('employee cancel <id> on a never-loaded order changes neither cash nor the ledger', () => {
    const { run, state } = setupDrilled(1, 1);
    const holeId = state.drillHoles[0]!.id;
    const cashBefore = state.cash;
    const txBefore = state.finances.transactions.length;
    expect(run(`charge hole:${holeId} explosive:boomite amount:5 stemming:2`).success).toBe(true);
    const action = state.pendingActions.find(a => a.type === 'charge_hole')!;

    expect(run(`employee cancel ${action.id}`).success).toBe(true);

    expect(state.cash).toBe(cashBefore);
    expect(state.finances.cash).toBe(state.cash);
    expect(state.finances.transactions).toHaveLength(txBefore);
    expect(state.finances.transactions.some(t => t.category === 'refund')).toBe(false);
    expect(state.pendingActions.filter(a => a.type === 'charge_hole')).toHaveLength(0);
  });

  it('drill_plan clear leaves cash and ledger alone for outstanding charge orders', () => {
    const { run, state } = setupDrilled(1, 2);
    const cashBefore = state.cash;
    expect(run('charge hole:* explosive:boomite amount:5 stemming:2').success).toBe(true);

    expect(run('drill_plan clear').success).toBe(true);

    expect(state.cash).toBe(cashBefore);
    expect(state.finances.cash).toBe(state.cash);
    expect(explosivesTotal(state)).toBe(0);
    expect(state.pendingActions.filter(a => a.type === 'charge_hole')).toHaveLength(0);
  });

  it('drill_plan remove hole:<id> drops only that hole\'s outstanding order, with no cash movement', () => {
    const { run, state } = setupDrilled(1, 2);
    const [first, second] = state.drillHoles.map(h => h.id);
    expect(run(`charge hole:${first} explosive:boomite amount:5 stemming:2`).success).toBe(true);
    expect(run(`charge hole:${second} explosive:boomite amount:3 stemming:2`).success).toBe(true);
    const cashAfterOrders = state.cash;

    expect(run(`drill_plan remove hole:${first}`).success).toBe(true);

    expect(state.cash).toBe(cashAfterOrders);
    expect(state.pendingActions.filter(a => a.type === 'charge_hole')).toHaveLength(1);
  });

  it('re-charging a hole with an outstanding order keeps one action per hole and moves no cash', () => {
    const { run, state } = setupDrilled(1, 1);
    const holeId = state.drillHoles[0]!.id;
    const cashBefore = state.cash;
    expect(run(`charge hole:${holeId} explosive:boomite amount:5 stemming:2`).success).toBe(true);
    expect(run(`charge hole:${holeId} explosive:boomite amount:8 stemming:2`).success).toBe(true);

    expect(state.cash).toBe(cashBefore);
    expect(state.pendingActions.filter(a => a.type === 'charge_hole' && a.payload['holeId'] === holeId)).toHaveLength(1);
    expect(state.plannedChargesByHole[holeId]!.amountKg).toBe(8);
  });

  it('with too little cash the order is still accepted: queued, flagged explosives_unaffordable, nothing loaded, cash untouched', () => {
    const { run, state } = setupDrilled(1, 1, 59);
    const holeId = state.drillHoles[0]!.id;

    const result = run(`charge hole:${holeId} explosive:boomite amount:5 stemming:2`);

    expect(result.success).toBe(true);
    expect(state.pendingActions.filter(a => a.type === 'charge_hole')).toHaveLength(1);
    expect(state.plannedChargesByHole[holeId]).toBeDefined();
    run('tick 5');
    expect(state.pendingActions.find(a => a.type === 'charge_hole')!.blockedReason).toBe('explosives_unaffordable');
    expect(state.chargesByHole[holeId]).toBeUndefined();
    // Payroll can take the staffed site's cash below zero on its own; what matters is that no explosive was booked.
    expect(explosivesTotal(state)).toBe(0);
  });

  it('an unaffordable order stays unloaded while cash is short, then loads and pays once cash covers it', () => {
    const { run, state } = setupDrilled(1, 1, 59);
    const holeId = state.drillHoles[0]!.id;
    expect(run(`charge hole:${holeId} explosive:boomite amount:5 stemming:2`).success).toBe(true);

    tickUntil(run, () => false, 60);
    expect(state.chargesByHole[holeId]).toBeUndefined();
    expect(explosivesTotal(state)).toBe(0);

    state.cash = 5_000;
    state.finances.cash = 5_000;
    tickFunded(run, state, () => state.chargesByHole[holeId] !== undefined, 600);

    expect(state.chargesByHole[holeId]).toBeDefined();
    expect(explosivesTotal(state)).toBe(60);
    expect(state.pendingActions.some(a => a.type === 'charge_hole')).toBe(false);
  });

  it('cash exactly equal to the cost is accepted at order time (the order books nothing)', () => {
    const { run, state } = setupDrilled(1, 1, 60);
    const holeId = state.drillHoles[0]!.id;

    expect(run(`charge hole:${holeId} explosive:boomite amount:5 stemming:2`).success).toBe(true);
    expect(state.cash).toBe(60);
    expect(state.pendingActions.filter(a => a.type === 'charge_hole')).toHaveLength(1);
  });

  it('hole:* orders every hole whatever the cash: 3 holes on $120 are all ordered and nothing is paid yet (#2143)', () => {
    const { run, state } = setupDrilled(1, 3, 120);
    expect(state.drillHoles).toHaveLength(3);

    const result = run('charge hole:* explosive:boomite amount:5 stemming:2');

    expect(result.success).toBe(true);
    expect(state.cash).toBe(120);
    expect(state.pendingActions.filter(a => a.type === 'charge_hole').map(a => a.payload['holeId'])).toEqual(['H1', 'H2', 'H3']);
    expect(Object.keys(state.plannedChargesByHole)).toEqual(['H1', 'H2', 'H3']);
  });

  it('existing refusals (bad explosive, stemming, amount) stay free of cash and ledger side effects', () => {
    const { run, state } = setupDrilled(1, 1);
    const holeId = state.drillHoles[0]!.id;
    const cashBefore = state.cash;
    const txBefore = state.finances.transactions.length;

    expect(run(`charge hole:${holeId} explosive:nonexistent amount:5 stemming:2`).success).toBe(false);
    expect(run(`charge hole:${holeId} explosive:boomite amount:5 stemming:0.2`).success).toBe(false);
    expect(run(`charge hole:${holeId} explosive:boomite amount:999 stemming:2`).success).toBe(false);

    expect(state.cash).toBe(cashBefore);
    expect(state.finances.transactions).toHaveLength(txBefore);
  });
});

describe('charge ordering has no funds check, whatever the balance (#2143)', () => {
  it('a new order is accepted when cash is negative', () => {
    const { run, state } = setupDrilled(1, 1);
    const holeId = state.drillHoles[0]!.id;
    state.cash = -100;
    state.finances.cash = -100;

    const r = run(`charge hole:${holeId} explosive:boomite amount:5 stemming:2`);

    expect(r.success).toBe(true);
    expect(state.cash).toBe(-100);
    expect(state.pendingActions.filter(a => a.type === 'charge_hole')).toHaveLength(1);
  });

  it('re-ordering the same charge on negative cash is accepted and leaves cash alone', () => {
    const { run, state } = setupDrilled(1, 1);
    const holeId = state.drillHoles[0]!.id;
    expect(run(`charge hole:${holeId} explosive:boomite amount:5 stemming:2`).success).toBe(true);

    state.cash = -8_290;
    state.finances.cash = -8_290;
    const again = run(`charge hole:${holeId} explosive:boomite amount:5 stemming:2`);
    expect(again.success).toBe(true);
    expect(state.cash).toBe(-8_290);
  });
});

// ── charge column must fit the hole (#1361) ──

describe('charge column overflow is refused at order time (#1361)', () => {
  function setupSixMetreHole() {
    const { runner, ctx } = createRunner();
    const run = (cmd: string) => runner.run(cmd);
    expect(run('new_game seed:42 size:32 staffed:true').success).toBe(true);
    const state = ctx.state!;
    drillAndLand(run, state, 'rows:1 cols:2 spacing:5 depth:6 start:14,14');
    expect(state.drillHoles).toHaveLength(2);
    expect(state.drillHoles.every(h => h.depth === 6)).toBe(true);
    return { run, state };
  }

  it('boomite 8 kg + 3 m stemming on a 6 m hole fails, names the 6 kg maximum, spends nothing and orders nothing', () => {
    const { run, state } = setupSixMetreHole();
    const holeId = state.drillHoles[0]!.id;
    const cashBefore = state.cash;

    const result = run(`charge hole:${holeId} explosive:boomite amount:8 stemming:3`);

    expect(result.success).toBe(false);
    expect(result.output).toMatch(/Maximum that fits: 6/); // (6 - 3) * 2 = 6 kg fits
    expect(state.cash).toBe(cashBefore);
    expect(state.plannedChargesByHole[holeId]).toBeUndefined();
    expect(state.pendingActions.filter(a => a.type === 'charge_hole')).toHaveLength(0);
  });

  it('a krackle 12 kg + 2 m stemming order on a 6 m hole is refused with krackle\'s own 11.5 kg maximum in the message and nothing is spent', () => {
    const { run, state } = setupSixMetreHole();
    const holeId = state.drillHoles[0]!.id;
    const cashBefore = state.cash;
    // Krackle is denser than boomite, so the same 4 m of column holds more of it: (6 - 2) * 2.875 = 11.5 kg.
    const krackleMax = (6 - 2) * chargeKgPerMetre(DRILL_HOLE_DEFAULT_DIAMETER_M, 'krackle');
    expect(krackleMax).toBeCloseTo(11.5, 6);
    expect(krackleMax).toBeGreaterThan((6 - 2) * chargeKgPerMetre(DRILL_HOLE_DEFAULT_DIAMETER_M, 'boomite'));

    const result = run(`charge hole:${holeId} explosive:krackle amount:12 stemming:2`);

    expect(result.success).toBe(false);
    expect(result.output).toMatch(/Maximum that fits: 11\.5 kg/);
    expect(state.cash).toBe(cashBefore);
    expect(state.plannedChargesByHole[holeId]).toBeUndefined();
    expect(state.pendingActions.filter(a => a.type === 'charge_hole')).toHaveLength(0);
  });

  it('krackle 10 kg + 2 m stemming, which overflowed the 6 m hole at boomite\'s density, fits krackle\'s denser column', () => {
    const { run, state } = setupSixMetreHole();
    const holeId = state.drillHoles[0]!.id;

    expect(run(`charge hole:${holeId} explosive:krackle amount:10 stemming:2`).success).toBe(true);
    expect(state.plannedChargesByHole[holeId]).toEqual({ explosiveId: 'krackle', amountKg: 10, stemmingM: 2 });
  });

  it('the exact boundary (boomite 8 kg + 2 m stemming on a 6 m hole) is accepted', () => {
    const { run, state } = setupSixMetreHole();
    const holeId = state.drillHoles[0]!.id;

    expect(run(`charge hole:${holeId} explosive:boomite amount:8 stemming:2`).success).toBe(true);
    expect(state.plannedChargesByHole[holeId]).toEqual({ explosiveId: 'boomite', amountKg: 8, stemmingM: 2 });
  });

  it('charge hole:* fails when any hole is too shallow, ordering and spending nothing for the others', () => {
    const { runner, ctx } = createRunner();
    const run = (cmd: string) => runner.run(cmd);
    expect(run('new_game seed:42 size:32 staffed:true').success).toBe(true);
    const state = ctx.state!;
    drillAndLand(run, state, 'rows:1 cols:2 spacing:5 depth:8 start:12,12');
    expect(state.drillHoles).toHaveLength(2);
    state.drillHoles[1]!.depth = 4; // shallow hole: 5 kg (2.5 m) + 2 m stemming overflows it
    expect(state.drillHoles.map(h => h.depth).sort()).toEqual([4, 8]);
    const cashBefore = state.cash;

    const result = run('charge hole:* explosive:boomite amount:5 stemming:2');

    expect(result.success).toBe(false);
    expect(state.cash).toBe(cashBefore);
    expect(Object.keys(state.plannedChargesByHole)).toHaveLength(0);
    expect(state.pendingActions.filter(a => a.type === 'charge_hole')).toHaveLength(0);
  });

  it('blast_plan load refuses a saved charge whose column overflows its hole, queuing and spending nothing', () => {
    const { runner, ctx } = createRunner();
    const run = (cmd: string) => runner.run(cmd);
    expect(run('new_game seed:42 size:32 staffed:true').success).toBe(true);
    const state = ctx.state!;
    drillAndLand(run, state, 'rows:1 cols:1 spacing:5 depth:4 start:14,14');
    expect(run('charge hole:* explosive:boomite amount:3 stemming:2').success).toBe(true);
    tickFunded(run, state, () => Object.keys(state.plannedChargesByHole).length === 0, 800);
    expect(run('blast_plan save').success).toBe(true);

    // Tamper: 5 kg (2.5 m) + 2 m stemming no longer fits the 4 m hole.
    const saved = state.savedPlans['default']!;
    for (const c of Object.values(saved.chargesByHole)) c.amountKg = 5;
    state.drillHoles.length = 0;
    for (const k of Object.keys(state.chargesByHole)) delete state.chargesByHole[k];
    const cashBefore = state.cash;

    const result = run('blast_plan load');

    expect(result.success).toBe(false);
    expect(state.cash).toBe(cashBefore);
    expect(state.plannedDrillHoles).toHaveLength(0);
    expect(state.pendingActions.filter(a => a.type === 'charge_hole' || a.type === 'drill_hole')).toHaveLength(0);
  });
});

// ── #1345: pattern-level charge settings ──

const BOOMITE_5 = { explosiveId: 'boomite', amountKg: 5, stemmingM: 2 };

function newStaffed() {
  const { runner, ctx } = createRunner();
  const run = (cmd: string) => runner.run(cmd);
  expect(run('new_game seed:42 size:32 staffed:true').success).toBe(true);
  const state = ctx.state!;
  state.cash = 500_000;
  state.finances.cash = 500_000;
  return { run, state };
}

const chargeActionsOf = (state: { pendingActions: Array<{ type: string }> }) =>
  state.pendingActions.filter(a => a.type === 'charge_hole');

describe('charge hole:* sets the pattern charge applied to every hole, including later-drilled ones (#1345)', () => {
  it('3x3 grid: one charge hole:* before any hole lands charges all 9 holes without further charge calls', () => {
    const { run, state } = newStaffed();
    expect(run('drill_plan grid rows:3 cols:3 spacing:4 depth:8 start:12,12').success).toBe(true);

    const result = run('charge hole:* explosive:boomite amount:5 stemming:2');
    expect(result.success).toBe(true);
    expect(state.patternCharge).toEqual(BOOMITE_5);

    tickFunded(run, state, () => Object.keys(state.chargesByHole).length === 9, 4000);
    expect(Object.keys(state.chargesByHole)).toHaveLength(9);
    for (const c of Object.values(state.chargesByHole)) expect(c).toEqual(BOOMITE_5);
    expect(state.plannedDrillHoles).toHaveLength(0);
  });

  it('4 of 9 drilled: charge hole:* orders 4, the rest are auto-charged as they land, and blast never reports "Missing charge"', () => {
    const { run, state } = newStaffed();
    expect(run('drill_plan grid rows:3 cols:3 spacing:4 depth:8 start:12,12').success).toBe(true);
    tickUntil(run, () => state.drillHoles.length >= 4, 3000);
    const drilledNow = state.drillHoles.length;
    expect(drilledNow).toBeGreaterThanOrEqual(4);
    expect(drilledNow).toBeLessThan(9);

    expect(run('charge hole:* explosive:boomite amount:5 stemming:2').success).toBe(true);
    expect(chargeActionsOf(state)).toHaveLength(drilledNow);

    tickFunded(run, state, () => Object.keys(state.chargesByHole).length === 9, 4000);
    expect(Object.keys(state.chargesByHole)).toHaveLength(9);

    const blast = run('blast');
    expect(blast.success).toBe(true);
    expect(blast.output).not.toContain('Missing charge');
  });

  it('a second charge hole:* with every hole covered orders nothing, spends nothing and is refused with mining.charge.all_covered', () => {
    const { run, state } = setupDrilled(2, 2);
    expect(run('charge hole:* explosive:boomite amount:5 stemming:2').success).toBe(true);
    const cashAfterFirst = state.cash;
    const actionsAfterFirst = chargeActionsOf(state).length;
    expect(actionsAfterFirst).toBe(4);

    const second = run('charge hole:* explosive:boomite amount:5 stemming:2');

    expect(second.success).toBe(false);
    // Every drilled hole is covered: the refusal says so rather than claiming there are no holes.
    expect(second.output).toBe(t('mining.charge.all_covered'));
    expect(state.cash).toBe(cashAfterFirst);
    expect(chargeActionsOf(state)).toHaveLength(actionsAfterFirst);
  });

  it('a second charge hole:* after the charges landed also orders nothing', () => {
    const { run, state } = setupDrilled(1, 2);
    expect(run('charge hole:* explosive:boomite amount:5 stemming:2').success).toBe(true);
    tickFunded(run, state, () => Object.keys(state.chargesByHole).length === 2, 800);
    const cash = state.cash;

    const again = run('charge hole:* explosive:boomite amount:5 stemming:2');

    expect(again.success).toBe(false);
    expect(state.cash).toBe(cash);
    expect(chargeActionsOf(state)).toHaveLength(0);
  });

  it('partially covered: only the uncovered holes are ordered', () => {
    const { run, state } = setupDrilled(1, 3);
    expect(run('charge hole:H1 explosive:boomite amount:5 stemming:2').success).toBe(true);
    const cashBefore = state.cash;

    expect(run('charge hole:* explosive:boomite amount:5 stemming:2').success).toBe(true);

    expect(chargeActionsOf(state).map(a => (a as unknown as { payload: Record<string, unknown> }).payload['holeId']).sort()).toEqual(['H1', 'H2', 'H3']);
    expect(state.cash).toBe(cashBefore);
  });

  it('charge hole:* with no drilled and no planned holes is refused with a localized reason', () => {
    const { run, state } = newStaffed();
    const cashBefore = state.cash;

    const result = run('charge hole:* explosive:boomite amount:5 stemming:2');

    expect(result.success).toBe(false);
    expect(result.output).toBe(t('mining.charge.nothing_to_charge'));
    expect(result.output).not.toBe('mining.charge.nothing_to_charge');
    expect(state.cash).toBe(cashBefore);
    expect(state.patternCharge ?? null).toBeNull();
  });

  it('charge hole:* with only planned (undrilled) holes succeeds and stores the pattern settings', () => {
    const { run, state } = newStaffed();
    expect(run('drill_plan grid rows:1 cols:2 spacing:5 depth:8 start:14,14').success).toBe(true);
    expect(state.drillHoles).toHaveLength(0);

    const result = run('charge hole:* explosive:boomite amount:5 stemming:2');

    expect(result.success).toBe(true);
    expect(state.patternCharge).toEqual(BOOMITE_5);
    expect(chargeActionsOf(state)).toHaveLength(0);
  });

  it('per-hole charge hole:<id> leaves patternCharge unchanged', () => {
    const { run, state } = setupDrilled(1, 2);
    expect(run('charge hole:H1 explosive:boomite amount:5 stemming:2').success).toBe(true);
    expect(state.patternCharge ?? null).toBeNull();

    expect(run('charge hole:* explosive:boomite amount:3 stemming:2').success).toBe(true);
    expect(run('charge hole:H1 explosive:boomite amount:6 stemming:2').success).toBe(true);
    expect(state.patternCharge).toEqual({ explosiveId: 'boomite', amountKg: 3, stemmingM: 2 });
  });
});

describe('a charge with no amount fills the hole up to the stemming', () => {
  it('charge hole:<id> orders the kilograms the hole holds under its stemming, and a denser explosive holds more', () => {
    const { run, state } = setupDrilled(1, 2);
    const fillBoomite = fillChargeKg(8, 2, DRILL_HOLE_DEFAULT_DIAMETER_M, 'boomite');
    const fillKrackle = fillChargeKg(8, 2, DRILL_HOLE_DEFAULT_DIAMETER_M, 'krackle');
    expect(fillBoomite).toBe(12); // 6 m of column at 2 kg/m
    expect(fillKrackle).toBeGreaterThan(fillBoomite);

    const boomite = run('charge hole:H1 explosive:boomite stemming:2');
    const krackle = run('charge hole:H2 explosive:krackle stemming:2');

    expect(boomite.success).toBe(true);
    expect(boomite.output).toContain(`boomite ${fillBoomite}kg`);
    expect(krackle.success).toBe(true);
    expect(state.plannedChargesByHole['H1']).toEqual({ explosiveId: 'boomite', amountKg: fillBoomite, stemmingM: 2 });
    expect(state.plannedChargesByHole['H2']).toEqual({ explosiveId: 'krackle', amountKg: fillKrackle, stemmingM: 2 });
  });

  it('more stemming leaves less explosive in the hole', () => {
    const { run, state } = setupDrilled(1, 2);
    expect(run('charge hole:H1 explosive:boomite stemming:2').success).toBe(true);
    expect(run('charge hole:H2 explosive:boomite stemming:4').success).toBe(true);
    expect(state.plannedChargesByHole['H2']!.amountKg).toBeLessThan(state.plannedChargesByHole['H1']!.amountKg);
    expect(state.plannedChargesByHole['H2']!.amountKg).toBe(fillChargeKg(8, 4, DRILL_HOLE_DEFAULT_DIAMETER_M, 'boomite'));
  });

  it('charge hole:* stores a fill pattern, fills each hole to its own depth, and fills holes drilled later too', () => {
    const { run, state } = newStaffed();
    expect(run('drill_plan grid rows:1 cols:3 spacing:4 depth:8 start:12,12').success).toBe(true);
    tickUntil(run, () => state.drillHoles.length >= 1, 3000);
    state.drillHoles[0]!.depth = 6; // a shallower hole holds less

    const result = run('charge hole:* explosive:boomite stemming:2');

    expect(result.success).toBe(true);
    expect(result.output).toContain(t('mining.charge.pattern_set_fill', { explosive: t('explosive.boomite.name'), stemming: 2 }));
    expect(state.patternCharge).toEqual({ explosiveId: 'boomite', amountKg: null, stemmingM: 2 });
    tickFunded(run, state, () => Object.keys(state.chargesByHole).length === 3, 4000);
    expect(Object.keys(state.chargesByHole)).toHaveLength(3);
    for (const hole of state.drillHoles) {
      expect(state.chargesByHole[hole.id], hole.id).toEqual({
        explosiveId: 'boomite', amountKg: fillChargeKg(hole.depth, 2, hole.diameter, 'boomite'), stemmingM: 2,
      });
    }
    expect(state.chargesByHole[state.drillHoles[0]!.id]!.amountKg).toBeLessThan(state.chargesByHole[state.drillHoles[1]!.id]!.amountKg);
  });

  it('stemming that leaves no room for explosive is refused with mining.charge.no_room, ordering and spending nothing', () => {
    const { run, state } = setupDrilled(1, 1);
    const cashBefore = state.cash;

    const result = run('charge hole:H1 explosive:boomite stemming:8');

    expect(result.success).toBe(false);
    expect(result.output).toBe(t('mining.charge.no_room', { stemming: 8, depth: 8 }));
    expect(state.cash).toBe(cashBefore);
    expect(chargeActionsOf(state)).toHaveLength(0);
    expect(state.plannedChargesByHole['H1']).toBeUndefined();
  });
});

describe('pattern charges are never held back for funds (#1345, #2143)', () => {
  it('cash for 2 of 4 holes: all 4 are ordered at once, none paid, and each pays as it is loaded', () => {
    const { run, state } = setupDrilled(1, 4, 120);

    const result = run('charge hole:* explosive:boomite amount:5 stemming:2');

    expect(result.success).toBe(true);
    expect(state.cash).toBe(120);
    expect(chargeActionsOf(state)).toHaveLength(4);
    expect(Object.keys(state.plannedChargesByHole).sort()).toEqual(['H1', 'H2', 'H3', 'H4']);
    expect(explosivesTotal(state)).toBe(0);
  });

  it('with cash for no hole at all every hole is still ordered, and the orders are flagged unaffordable', () => {
    const { run, state } = setupDrilled(1, 2, 0);

    expect(run('charge hole:* explosive:boomite amount:5 stemming:2').success).toBe(true);
    run('tick 5');

    expect(chargeActionsOf(state)).toHaveLength(2);
    for (const a of state.pendingActions.filter(x => x.type === 'charge_hole')) {
      expect(a.blockedReason).toBe('explosives_unaffordable');
    }
    expect(Object.keys(state.chargesByHole)).toHaveLength(0);
  });

  it('cash exactly equal to one hole cost orders the hole', () => {
    const { run, state } = setupDrilled(1, 1, 60);
    expect(run('charge hole:* explosive:boomite amount:5 stemming:2').success).toBe(true);
    expect(state.cash).toBe(60);
    expect(chargeActionsOf(state)).toHaveLength(1);
  });

  it('removing an ordered hole drops its order without touching cash', () => {
    const { run, state } = setupDrilled(1, 2, 60);
    expect(run('charge hole:* explosive:boomite amount:5 stemming:2').success).toBe(true);
    expect(chargeActionsOf(state)).toHaveLength(2);

    expect(run('drill_plan remove hole:H2').success).toBe(true);

    expect(chargeActionsOf(state)).toHaveLength(1);
    expect(state.cash).toBe(60);
  });
});

describe('blast with nothing charged is refused (#1345)', () => {
  it('blast with an empty plan: refused, blastCount, cash, grid and plan unchanged', () => {
    const { run, state } = newStaffed();
    const blastCount = state.damage.blastCount;
    const cash = state.cash;

    const result = run('blast');

    expect(result.success).toBe(false);
    expect(result.output).toBe(t('mining.blast.no_charged_holes'));
    expect(state.damage.blastCount).toBe(blastCount);
    expect(state.cash).toBe(cash);
    expect(state.drillHoles).toHaveLength(0);
  });

  it('blast with drilled but unloaded holes: refused, nothing changes', () => {
    const { run, state } = setupDrilled(1, 2);
    const blastCount = state.damage.blastCount;
    const cash = state.cash;
    const holes = state.drillHoles.map(h => h.id);

    const result = run('blast');

    expect(result.success).toBe(false);
    expect(result.output).toBe(t('mining.blast.no_charged_holes'));
    expect(state.damage.blastCount).toBe(blastCount);
    expect(state.cash).toBe(cash);
    expect(state.drillHoles.map(h => h.id)).toEqual(holes);
  });

  it('blast with a loaded charge still fires and clears patternCharge afterwards', () => {
    const { run, state } = setupDrilled(1, 2);
    expect(run('charge hole:* explosive:boomite amount:5 stemming:2').success).toBe(true);
    tickFunded(run, state, () => Object.keys(state.chargesByHole).length === 2, 800);
    expect(state.patternCharge).toEqual(BOOMITE_5);

    expect(run('blast').success).toBe(true);

    expect(state.patternCharge ?? null).toBeNull();
  });
});

describe('drill_plan grid over a drilled or charged plan needs confirm:true (#1345)', () => {
  const GRID = 'drill_plan grid rows:1 cols:2 spacing:4 depth:8 start:20,20';

  it('refused without confirm when holes are drilled; state unchanged', () => {
    const { run, state } = setupDrilled(1, 2);
    const holes = state.drillHoles.map(h => ({ ...h }));

    const result = run(GRID);

    expect(result.success).toBe(false);
    expect(result.output).toBe(t('mining.drill_plan.confirm_replace', { drilled: 2, charged: 0 }));
    expect(state.drillHoles).toEqual(holes);
  });

  it('refused without confirm when holes are charged; charges, pattern and cash unchanged', () => {
    const { run, state } = setupDrilled(1, 2);
    expect(run('charge hole:* explosive:boomite amount:5 stemming:2').success).toBe(true);
    tickFunded(run, state, () => Object.keys(state.chargesByHole).length === 2, 800);
    const cash = state.cash;

    const result = run(GRID);

    expect(result.success).toBe(false);
    expect(Object.keys(state.chargesByHole)).toHaveLength(2);
    expect(state.patternCharge).toEqual(BOOMITE_5);
    expect(state.cash).toBe(cash);
  });

  it('with confirm:true replaces the plan and clears the pattern charge', () => {
    const { run, state } = setupDrilled(1, 2);
    expect(run('charge hole:* explosive:boomite amount:5 stemming:2').success).toBe(true);

    const result = run(`${GRID} confirm:true`);

    expect(result.success).toBe(true);
    expect(state.drillHoles).toHaveLength(0);
    expect(state.plannedDrillHoles).toHaveLength(2);
    expect(state.chargesByHole).toEqual({});
    expect(state.patternCharge ?? null).toBeNull();
  });

  it('a plan with only ordered (undrilled) holes is replaced without confirm', () => {
    const { run, state } = newStaffed();
    expect(run('drill_plan grid rows:1 cols:2 spacing:5 depth:8 start:14,14').success).toBe(true);
    expect(state.drillHoles).toHaveLength(0);

    expect(run(GRID).success).toBe(true);
    expect(state.plannedDrillHoles).toHaveLength(2);
  });
});

describe('pattern charge persistence (#1345)', () => {
  it('save/load round-trips patternCharge', () => {
    const { run, state } = setupDrilled(1, 2, 60);
    expect(run('charge hole:* explosive:boomite amount:5 stemming:2').success).toBe(true);

    const loaded = deserialize(serialize(state));

    expect(loaded.patternCharge).toEqual(BOOMITE_5);
  });
});

describe('localized keys (#1345)', () => {
  it.each(['mining.charge.nothing_to_charge', 'mining.drill_plan.confirm_replace', 'mining.blast.no_charged_holes'])(
    '%s resolves to a real string, not the key', key => {
      expect(t(key)).not.toBe(key);
    });

  it.each(['en', 'fr'])('%s locale defines every new key', locale => {
    const dir = new URL('../../src/core/i18n/locales/', import.meta.url);
    const data = JSON.parse(readFileSync(new URL(`${locale}.json`, dir), 'utf8')) as Record<string, string>;
    for (const key of ['mining.charge.nothing_to_charge', 'mining.drill_plan.confirm_replace', 'mining.blast.no_charged_holes']) {
      expect(data[key], `${locale}:${key}`).toBeTypeOf('string');
    }
  });
});
