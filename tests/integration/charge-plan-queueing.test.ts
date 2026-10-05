// BlastSimulator2026 — Integration tests: charge_hole action queueing (#554)
//
// `charge hole:*` used to write finished HoleCharge records straight into
// state.chargesByHole in one frame — instant, no employee, no time. #554
// changes this, mirroring #553's drill_hole split: `charge hole:<id>` queues
// one `charge_hole` PendingAction per hole instead (requiredSkill:
// 'blasting', requiredVehicleRole: null — on foot, unlike drilling's
// drill_rig gate), validated immediately at order time (createCharge's
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
import { getFinancialReport } from '../../src/core/economy/Finance.js';
import { formatMoney } from '../../src/core/economy/formatMoney.js';
import { t } from '../../src/core/i18n/I18n.js';

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
    expect(chargeActions[0]!.requiredVehicleRole).toBeNull();
    expect(chargeActions[0]!.payload['holeId']).toBe(holeId);
  });

  it('charge hole:* queues one charge_hole action per already-drilled hole only — an undrilled hole is skipped, not errored', () => {
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

    const result = run('charge hole:* explosive:boomite amount:5 stemming:2');
    expect(result.success).toBe(true);

    const chargeActions = state.pendingActions.filter(a => a.type === 'charge_hole');
    expect(chargeActions).toHaveLength(drilledCountBefore);
    for (const drilled of state.drillHoles) {
      expect(chargeActions.some(a => a.payload['holeId'] === drilled.id)).toBe(true);
    }
    // No charge_hole action targets a hole still sitting in plannedDrillHoles.
    for (const stillPlanned of state.plannedDrillHoles) {
      expect(chargeActions.some(a => a.payload['holeId'] === stillPlanned.id)).toBe(false);
    }
    expect(stillPlannedCountBefore).toBeGreaterThan(0);
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

    tickUntil(run, () => state.chargesByHole[holeId] !== undefined, 400);

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
    tickUntil(run, () => state.chargesByHole[holeId] !== undefined, 400);
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

    // boomite's maxChargeKg is well under 999.
    const result = run(`charge hole:${holeId} explosive:boomite amount:999 stemming:2`);

    expect(result.success).toBe(false);
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

describe('charge order cash cost (#1341)', () => {
  it('charge hole:* amount:12kg of a $200/kg explosive on 6 holes lowers cash by exactly $14,400 and books an explosives expense', () => {
    const { run, state } = setupDrilled(2, 3);
    expect(state.drillHoles).toHaveLength(6);
    const cashBefore = state.cash;

    const result = run('charge hole:* explosive:dynatomics amount:12kg stemming:2');

    expect(result.success).toBe(true);
    expect(state.cash).toBe(cashBefore - 14_400);
    expect(state.finances.cash).toBe(state.cash);
    const report = getFinancialReport(state.finances, state.tickCount);
    expect(report.expensesByCategory).toContainEqual({ category: 'explosives', total: 14_400 });
  });

  it('a single charge hole:H1 charges once at order time and nothing more when the charge lands', () => {
    const { run, state } = setupDrilled(1, 1);
    const holeId = state.drillHoles[0]!.id;
    const cashBefore = state.cash;

    expect(run(`charge hole:${holeId} explosive:boomite amount:5 stemming:2`).success).toBe(true);
    expect(state.cash).toBe(cashBefore - 60);
    expect(explosivesTotal(state)).toBe(60);

    tickUntil(run, () => state.chargesByHole[holeId] !== undefined, 400);
    expect(state.chargesByHole[holeId]).toBeDefined();
    expect(explosivesTotal(state)).toBe(60);
    const explosivesTx = state.finances.transactions.filter(t => t.category === 'explosives');
    expect(explosivesTx).toHaveLength(1);
  });

  it('firing the blast books no further explosives cost, and the report spent equals the sum of loaded charge costs', () => {
    const { run, state } = setupDrilled(1, 2);
    expect(run('charge hole:* explosive:boomite amount:5 stemming:2').success).toBe(true);
    const holes = state.drillHoles.length;
    tickUntil(run, () => Object.keys(state.chargesByHole).length === holes, 600);
    expect(Object.keys(state.chargesByHole)).toHaveLength(holes);
    expect(run('sequence auto').success).toBe(true);
    const expected = holes * 5 * 12;
    expect(explosivesTotal(state)).toBe(expected);

    const explosivesTxBefore = state.finances.transactions.filter(t => t.category === 'explosives').length;
    const blast = run('blast');
    expect(blast.success).toBe(true);

    expect(state.lastBlastReport!.spent).toBe(expected);
    expect(explosivesTotal(state)).toBe(expected);
    expect(state.finances.transactions.filter(t => t.category === 'explosives')).toHaveLength(explosivesTxBefore);
  });

  it('employee cancel <id> refunds the full order cost as a refund income transaction', () => {
    const { run, state } = setupDrilled(1, 1);
    const holeId = state.drillHoles[0]!.id;
    const cashBefore = state.cash;
    expect(run(`charge hole:${holeId} explosive:boomite amount:5 stemming:2`).success).toBe(true);
    const action = state.pendingActions.find(a => a.type === 'charge_hole')!;
    expect(action.payload['orderCost']).toBe(60);
    expect(state.cash).toBe(cashBefore - 60);

    expect(run(`employee cancel ${action.id}`).success).toBe(true);

    expect(state.cash).toBe(cashBefore);
    expect(state.finances.cash).toBe(state.cash);
    const refund = state.finances.transactions.find(t => t.category === 'refund' && t.amount === 60);
    expect(refund).toBeDefined();
    expect(refund!.type).toBe('income');
  });

  it('drill_plan clear refunds every outstanding charge order', () => {
    const { run, state } = setupDrilled(1, 2);
    const cashBefore = state.cash;
    const holes = state.drillHoles.length;
    expect(run('charge hole:* explosive:boomite amount:5 stemming:2').success).toBe(true);
    expect(state.cash).toBe(cashBefore - holes * 60);

    expect(run('drill_plan clear').success).toBe(true);

    expect(state.cash).toBe(cashBefore);
    expect(state.finances.cash).toBe(state.cash);
  });

  it('drill_plan remove hole:<id> refunds only that hole\'s outstanding order', () => {
    const { run, state } = setupDrilled(1, 2);
    const [first, second] = state.drillHoles.map(h => h.id);
    expect(run(`charge hole:${first} explosive:boomite amount:5 stemming:2`).success).toBe(true);
    expect(run(`charge hole:${second} explosive:boomite amount:3 stemming:2`).success).toBe(true);
    const cashAfterOrders = state.cash;

    expect(run(`drill_plan remove hole:${first}`).success).toBe(true);

    expect(state.cash).toBe(cashAfterOrders + 60);
    expect(state.pendingActions.filter(a => a.type === 'charge_hole')).toHaveLength(1);
  });

  it('re-charging a hole with an outstanding order nets new minus old, with one action per hole', () => {
    const { run, state } = setupDrilled(1, 1);
    const holeId = state.drillHoles[0]!.id;
    const cashBefore = state.cash;
    expect(run(`charge hole:${holeId} explosive:boomite amount:5 stemming:2`).success).toBe(true);
    expect(run(`charge hole:${holeId} explosive:boomite amount:8 stemming:2`).success).toBe(true);

    expect(state.cash).toBe(cashBefore - 96);
    expect(state.pendingActions.filter(a => a.type === 'charge_hole' && a.payload['holeId'] === holeId)).toHaveLength(1);
    expect(state.finances.cash).toBe(state.cash);
  });

  it('insufficient funds refuses the charge with console.insufficient_funds, queues nothing and leaves cash unchanged', () => {
    const { run, state } = setupDrilled(1, 1, 59);
    const holeId = state.drillHoles[0]!.id;

    const result = run(`charge hole:${holeId} explosive:boomite amount:5 stemming:2`);

    expect(result.success).toBe(false);
    expect(result.output).toBe(t('console.insufficient_funds', { need: formatMoney(60), have: formatMoney(59) }));
    expect(state.cash).toBe(59);
    expect(state.pendingActions.filter(a => a.type === 'charge_hole')).toHaveLength(0);
    expect(state.plannedChargesByHole[holeId]).toBeUndefined();
  });

  it('cash exactly equal to the cost is allowed', () => {
    const { run, state } = setupDrilled(1, 1, 60);
    const holeId = state.drillHoles[0]!.id;

    expect(run(`charge hole:${holeId} explosive:boomite amount:5 stemming:2`).success).toBe(true);

    expect(state.cash).toBe(0);
    expect(state.pendingActions.filter(a => a.type === 'charge_hole')).toHaveLength(1);
  });

  it('hole:* batch is atomic: when the total is unaffordable no hole is charged', () => {
    // 3 holes x $60 = $180 needed, only $119 on hand: two would fit, none may be taken.
    const { run, state } = setupDrilled(1, 3, 119);
    expect(state.drillHoles).toHaveLength(3);

    const result = run('charge hole:* explosive:boomite amount:5 stemming:2');

    expect(result.success).toBe(false);
    expect(result.output).toContain('Insufficient funds');
    expect(state.cash).toBe(119);
    expect(state.pendingActions.filter(a => a.type === 'charge_hole')).toHaveLength(0);
    expect(state.plannedChargesByHole).toEqual({});
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

describe('charge order funds check with a zero-or-negative net cost (#1341)', () => {
  it('re-ordering the same charge on a hole is accepted when cash is negative, because the refund covers the new cost', () => {
    const { run, state } = setupDrilled(1, 1);
    const holeId = state.drillHoles[0]!.id;
    expect(run(`charge hole:${holeId} explosive:boomite amount:5 stemming:2`).success).toBe(true);

    state.cash = -8_290;
    state.finances.cash = -8_290;
    const again = run(`charge hole:${holeId} explosive:boomite amount:5 stemming:2`);
    expect(again.success).toBe(true);
    expect(state.cash).toBe(-8_290);
  });

  it('a cheaper replacement on negative cash is accepted and leaves cash higher', () => {
    const { run, state } = setupDrilled(1, 1);
    const holeId = state.drillHoles[0]!.id;
    expect(run(`charge hole:${holeId} explosive:boomite amount:8 stemming:2`).success).toBe(true);
    state.cash = -1_000;
    state.finances.cash = -1_000;
    expect(run(`charge hole:${holeId} explosive:boomite amount:4 stemming:2`).success).toBe(true);
    expect(state.cash).toBeGreaterThan(-1_000);
  });

  it('a new charge with positive net cost on negative cash is still refused', () => {
    const { run, state } = setupDrilled(1, 1);
    const holeId = state.drillHoles[0]!.id;
    state.cash = -100;
    state.finances.cash = -100;
    const r = run(`charge hole:${holeId} explosive:boomite amount:5 stemming:2`);
    expect(r.success).toBe(false);
    expect(r.output).toContain('Insufficient funds');
    expect(state.cash).toBe(-100);
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
    expect(result.output).toMatch(/\b6(\.0)?\b/); // (6 - 3) * 2 = 6 kg fits
    expect(state.cash).toBe(cashBefore);
    expect(state.plannedChargesByHole[holeId]).toBeUndefined();
    expect(state.pendingActions.filter(a => a.type === 'charge_hole')).toHaveLength(0);
  });

  it('a krackle 10 kg + 2 m stemming order on a 6 m hole is refused with the 8 kg maximum in the message and nothing is spent', () => {
    const { run, state } = setupSixMetreHole();
    const holeId = state.drillHoles[0]!.id;
    const cashBefore = state.cash;

    const result = run(`charge hole:${holeId} explosive:krackle amount:10 stemming:2`);

    expect(result.success).toBe(false);
    expect(result.output).toMatch(/\b8(\.0)?\b/);
    expect(state.cash).toBe(cashBefore);
    expect(state.plannedChargesByHole[holeId]).toBeUndefined();
    expect(state.pendingActions.filter(a => a.type === 'charge_hole')).toHaveLength(0);
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
    drillAndLand(run, state, 'rows:1 cols:1 spacing:5 depth:8 start:12,12');
    drillAndLand(run, state, 'rows:1 cols:1 spacing:5 depth:4 start:20,20');
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
    tickUntil(run, () => Object.keys(state.plannedChargesByHole).length === 0, 800);
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
