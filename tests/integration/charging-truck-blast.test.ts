// BlastSimulator2026 — Integration: truck-worked charging far holes and a lost truck (#1660)

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import type { GameState } from '../../src/core/state/GameState.js';
import { destroyVehicle } from '../../src/core/entities/Vehicle.js';
import { killEmployee } from '../../src/core/entities/Employee.js';
import { outstandingChargeBlockedReason } from '../../src/core/mining/ChargeOrder.js';
import { ROLE_LICENCE_REQUIRED } from '../../src/core/entities/Vehicle.js';
import { tickUntilFresh } from '../helpers/blastFixtures.js';

function tickFunded(run: (cmd: string) => unknown, state: GameState, predicate: () => boolean, maxTicks: number): void {
  tickUntilFresh(run, state, () => { state.cash = Math.max(state.cash, 100000); return predicate(); }, maxTicks);
}

/** Staffed game, 1x2 pattern drilled at the given spacing, charge ordered but not yet worked. */
function setup(spacing: number) {
  const { runner, ctx } = createRunner();
  const run = (cmd: string) => runner.run(cmd);
  expect(run('new_game seed:42 size:32 staffed:true').success).toBe(true);
  expect(run(`drill_plan grid rows:1 cols:2 spacing:${spacing} depth:8 start:14,14`).success).toBe(true);
  const state = ctx.state!;
  tickFunded(run, state, () => state.plannedDrillHoles.length === 0, 2000);
  expect(state.drillHoles).toHaveLength(2);
  expect(run('charge hole:* explosive:boomite amount:8 stemming:2').success).toBe(true);
  return { run, state };
}

const chargeOrders = (s: GameState) => s.pendingActions.filter(a => a.type === 'charge_hole');

describe('charging truck, far holes (#1660 symptom 1)', () => {
  it('spacing 5 charges both holes within 600 ticks', () => {
    const { run, state } = setup(5);
    tickFunded(run, state, () => Object.keys(state.plannedChargesByHole).length === 0, 600);
    expect(Object.keys(state.plannedChargesByHole)).toHaveLength(0);
    expect(Object.keys(state.chargesByHole)).toHaveLength(2);
  });

  it('spacing 4 still charges both holes within 600 ticks', () => {
    const { run, state } = setup(4);
    tickFunded(run, state, () => Object.keys(state.plannedChargesByHole).length === 0, 600);
    expect(Object.keys(state.chargesByHole)).toHaveLength(2);
  });
});

describe('charging truck lost with orders outstanding (#1660 symptom 2)', () => {
  it('destroyed truck: reason reads no_vehicle_in_fleet within 2 ticks', () => {
    const { run, state } = setup(4);
    const truck = state.vehicles.vehicles.find(v => v.type === 'charging_truck')!;
    expect(chargeOrders(state).length).toBeGreaterThan(0);
    expect(destroyVehicle(state.vehicles, truck.id)).toBe(true);

    run('tick 1'); run('tick 1');

    expect(chargeOrders(state).length).toBeGreaterThan(0);
    expect(outstandingChargeBlockedReason(state)).toBe('no_vehicle_in_fleet');
  });

  it('truck and driver lost mid-job: reason set and no order stays held by a dead employee', () => {
    const { run, state } = setup(4);
    // Let a crew member claim the first order.
    tickFunded(run, state, () => chargeOrders(state).some(a => a.holderId !== null), 200);
    const claimed = chargeOrders(state).find(a => a.holderId !== null);
    expect(claimed).toBeDefined();
    const truck = state.vehicles.vehicles.find(v => v.type === 'charging_truck')!;
    destroyVehicle(state.vehicles, truck.id);
    killEmployee(state.employees, claimed!.holderId!);

    run('tick 1'); run('tick 1');

    for (const a of chargeOrders(state)) {
      if (a.holderId === null) continue;
      expect(state.employees.employees.find(e => e.id === a.holderId)!.alive).toBe(true);
    }
    expect(outstandingChargeBlockedReason(state)).toBe('no_vehicle_in_fleet');
  });

  it('truck and holder lost while an order is in_progress: other order reports a reason, dead holder releases', () => {
    const { run, state } = setup(4);
    tickFunded(run, state, () => chargeOrders(state).some(a => a.status === 'in_progress'), 400);
    const working = chargeOrders(state).find(a => a.status === 'in_progress');
    expect(working).toBeDefined();
    expect(chargeOrders(state).length).toBeGreaterThan(1);
    const truck = state.vehicles.vehicles.find(v => v.type === 'charging_truck')!;
    destroyVehicle(state.vehicles, truck.id);
    killEmployee(state.employees, working!.holderId!);

    run('tick 1'); run('tick 1');

    const orders = chargeOrders(state);
    expect(orders.length).toBeGreaterThan(0);
    for (const a of orders) {
      if (a.holderId === null) continue;
      expect(state.employees.employees.find(e => e.id === a.holderId)!.alive).toBe(true);
    }
    expect(outstandingChargeBlockedReason(state)).toBe('no_vehicle_in_fleet');
  });

  it('truck alive but every dual-qualified crew member dead: no_dual_qualified_employee', () => {
    const { run, state } = setup(4);
    const licence = ROLE_LICENCE_REQUIRED.charging_truck;
    const dual = state.employees.employees.filter(e => e.alive
      && e.qualifications.some(q => q.category === 'blasting')
      && e.qualifications.some(q => q.category === licence));
    expect(dual.length).toBeGreaterThan(0);
    for (const e of dual) killEmployee(state.employees, e.id);

    run('tick 1'); run('tick 1');

    expect(outstandingChargeBlockedReason(state)).toBe('no_dual_qualified_employee');
  });

  it('no outstanding orders after charging completes: reason is null', () => {
    const { run, state } = setup(4);
    tickFunded(run, state, () => chargeOrders(state).length === 0, 600);
    expect(chargeOrders(state)).toHaveLength(0);
    expect(outstandingChargeBlockedReason(state)).toBeNull();
  });
});
