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

/** Runs `tick 1` until `predicate()` is true or `maxTicks` is exhausted. */
function tickUntil(
  run: (cmd: string) => unknown,
  predicate: () => boolean,
  maxTicks = 400,
): void {
  for (let i = 0; i < maxTicks && !predicate(); i++) {
    run('tick 1');
  }
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
