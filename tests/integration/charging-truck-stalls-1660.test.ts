import { describe, it, expect } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import { killEmployee } from '../../src/core/entities/Employee.js';
import { destroyVehicle } from '../../src/core/entities/Vehicle.js';
import { outstandingChargeBlockedReason } from '../../src/core/mining/ChargeOrder.js';
import { EXPLOSIVE_DELIVERY_TICKS } from '../../src/core/config/balance.js';

function drilledGame(cols: number, spacing: number) {
  const { runner, ctx } = createRunner();
  const run = (cmd: string) => runner.run(cmd);
  expect(run('new_game seed:42 size:32 staffed:true').success).toBe(true);
  expect(run(`drill_plan grid rows:1 cols:${cols} spacing:${spacing} depth:8 start:14,14`).success).toBe(true);
  const state = ctx.state!;
  for (let i = 0; i < 800 && state.plannedDrillHoles.length > 0; i++) run('tick 1');
  state.cash = 1e6;
  expect(run('charge hole:* explosive:boomite amount:5 stemming:2').success).toBe(true);
  const tick = () => { state.cash = Math.max(state.cash, 1e6); run('tick 1'); };
  return { state, tick };
}

describe('truck-worked charging stalls (#1660)', () => {
  it('a truck blocked by the parked drill rig crosses it and charges both holes at spacing 5', () => {
    const { state, tick } = drilledGame(2, 5);
    for (let i = 0; i < EXPLOSIVE_DELIVERY_TICKS + 600 && Object.keys(state.chargesByHole).length < 2; i++) tick();
    expect(Object.keys(state.chargesByHole)).toHaveLength(2);
  });

  it('shows no_vehicle_in_fleet after the charging truck is destroyed', () => {
    const { state, tick } = drilledGame(3, 4);
    for (let i = 0; i < 30; i++) tick();
    const truck = state.vehicles.vehicles.find(v => v.type === 'charging_truck')!;
    destroyVehicle(state.vehicles, truck.id);
    for (let i = 0; i < 3; i++) tick();
    expect(outstandingChargeBlockedReason(state)).toBe('no_vehicle_in_fleet');
  });

  it('releases a charge claim held by a dead employee so the order is re-stamped', () => {
    const { state, tick } = drilledGame(3, 4);
    // Wait out the explosives delivery (#1895) so a crew member can claim the order.
    for (let i = 0; i < EXPLOSIVE_DELIVERY_TICKS + 30; i++) tick();
    const claim = state.pendingActions.find(a => a.type === 'charge_hole' && a.holderId !== null)!;
    expect(claim).toBeDefined();
    const holderId = claim.holderId!;
    for (const e of state.employees.employees) if (e.qualifications.some(q => q.category === 'blasting')) killEmployee(state.employees, e.id);
    for (let i = 0; i < 3; i++) tick();
    expect(state.pendingActions.some(a => a.type === 'charge_hole' && a.holderId === holderId)).toBe(false);
    expect(outstandingChargeBlockedReason(state)).not.toBeNull();
  });
});
