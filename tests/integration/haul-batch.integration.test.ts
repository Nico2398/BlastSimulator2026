// BlastSimulator2026 — Integration tests: a hauler carries several fragments
// per trip (#1370). Drives the real itinerary/locomotion/arrival-effect
// pipeline through console `tick` commands.

import { upgradeFreightWarehousesToTier3 } from '../helpers/freightWarehouse.js';
import { describe, it, expect } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import type { GameState } from '../../src/core/state/GameState.js';
import { addBlastFragments } from '../../src/core/economy/Logistics.js';
import { syncHaulDispatch } from '../../src/core/economy/HaulDispatch.js';
import { accumulateOreMass } from '../../src/core/mining/BlastOreReport.js';
import { assertWorldInvariants } from '../../src/core/state/WorldInvariants.js';
import type { FragmentData } from '../../src/core/mining/BlastExecution.js';
import { vehicleDriverId, vehicleCargoMassKg } from '../../src/core/entities/Vehicle.js';
import type { EventEmitter } from '../../src/core/state/EventEmitter.js';
import { tickUntil } from './helpers.js';

function makeFragment(id: number, x: number, z: number, mass = 900): FragmentData {
  return {
    id,
    position: { x, y: 0, z },
    volume: 0.3,
    mass,
    rockId: 'cruite',
    oreDensities: { blingite: 0.5 },
    initialVelocity: { x: 0, y: 0, z: 0 },
    isProjection: false,
    halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
    shapeSeed: 1,
    origin: { x, y: 0, z },
  };
}

function setup(): { run: (cmd: string) => unknown; state: GameState; vehicleId: number; emitter: EventEmitter } {
  const { runner, ctx } = createRunner();
  const run = (cmd: string) => runner.run(cmd);
  expect(run('new_game seed:42 size:32 staffed:true')).toMatchObject({ success: true });
  const state = ctx.state!;
  expect(run('build freight_warehouse at:4,18')).toMatchObject({ success: true });
  tickUntil(run, () => state.buildings.buildings.some(b => b.type === 'freight_warehouse' && b.active), 300);
  const vehicle = state.vehicles.vehicles.find(v => v.type === 'debris_hauler')!;
  const driver = state.employees.employees.find(e => e.qualifications.some(q => q.category === 'driving.truck'))!;
  expect(run(`vehicle driver ${vehicle.id} ${driver.id}`)).toMatchObject({ success: true });
  tickUntil(run, () => vehicleDriverId(vehicle) === driver.id, 50);
  return { run, state, vehicleId: vehicle.id, emitter: ctx.emitter };
}

describe('batched hauling (#1370)', () => {
  it('a tier-1 hauler loads at least two small fragments in one trip and one unload stores them all', () => {
    const { run, state, vehicleId, emitter } = setup();
    const vehicle = state.vehicles.vehicles.find(v => v.id === vehicleId)!;
    upgradeFreightWarehousesToTier3(state); // the starting depot holds only 2000 kg
    const frags = [makeFragment(9001, 5, 6), makeFragment(9002, 6, 6), makeFragment(9003, 7, 6)];
    addBlastFragments(state.logistics, frags, state.navGrid);
    syncHaulDispatch(state);
    const storedBefore = state.logistics.storedMassKg;
    const delivered: number[] = [];
    emitter.on('vehicle:haul_delivered', (p: { vehicleId: number; fragmentId: number }) => delivered.push(p.fragmentId));

    expect(run(`vehicle haul ${vehicleId} fragment:9001`)).toMatchObject({ success: true });

    let maxCargo = 0;
    let maxMass = 0;
    let violations = 0;
    tickUntil(run, () => {
      maxCargo = Math.max(maxCargo, vehicle.cargo.length);
      maxMass = Math.max(maxMass, vehicleCargoMassKg(vehicle));
      violations += assertWorldInvariants(state).filter(v => v.kind === 'I8_payload_not_in_transit').length;
      return frags.every(f => state.logistics.fragments.find(t => t.fragment.id === f.id)?.state === 'stored');
    }, 1500);

    expect(maxCargo).toBeGreaterThanOrEqual(2);
    expect(maxMass).toBeLessThanOrEqual(4000);
    expect(violations).toBe(0);
    for (const f of frags) expect(state.logistics.fragments.find(t => t.fragment.id === f.id)!.state).toBe('stored');
    expect(state.logistics.storedMassKg).toBe(storedBefore + 2700);
    expect([...delivered].sort()).toEqual([9001, 9002, 9003]);
    expect(vehicle.cargo).toEqual([]);

    const expectedOre: Record<string, number> = {};
    for (const f of frags) accumulateOreMass(expectedOre, f.volume, f.oreDensities);
    expect(state.collectedOre['blingite']).toBeCloseTo(expectedOre['blingite']!, 6);

    // No haul action survives for any loaded fragment.
    for (const f of frags) {
      expect(state.pendingActions.some(a => a.type === 'haul_debris' && a.payload['fragmentId'] === f.id)).toBe(false);
    }
  });

  it('a single fragment heavier than hauler capacity rides alone', () => {
    const { run, state, vehicleId } = setup();
    const vehicle = state.vehicles.vehicles.find(v => v.id === vehicleId)!;
    upgradeFreightWarehousesToTier3(state); // the starting depot holds only 2000 kg
    addBlastFragments(state.logistics, [makeFragment(9101, 5, 6, 4500), makeFragment(9102, 6, 6, 100)], state.navGrid);
    syncHaulDispatch(state);

    expect(run(`vehicle haul ${vehicleId} fragment:9101`)).toMatchObject({ success: true });

    let maxCargo = 0;
    tickUntil(run, () => {
      maxCargo = Math.max(maxCargo, vehicle.cargo.length);
      return state.logistics.fragments.find(t => t.fragment.id === 9101)?.state === 'stored';
    }, 1500);

    expect(maxCargo).toBe(1);
    expect(state.logistics.fragments.find(t => t.fragment.id === 9101)!.state).toBe('stored');
  });

  it('an extra whose fragment vanished before pickup is skipped; the trip still delivers the rest', () => {
    const { run, state, vehicleId } = setup();
    const vehicle = state.vehicles.vehicles.find(v => v.id === vehicleId)!;
    upgradeFreightWarehousesToTier3(state); // the starting depot holds only 2000 kg
    addBlastFragments(state.logistics, [makeFragment(9201, 5, 6), makeFragment(9202, 6, 6), makeFragment(9203, 7, 6)], state.navGrid);
    syncHaulDispatch(state);
    expect(run(`vehicle haul ${vehicleId} fragment:9201`)).toMatchObject({ success: true });

    // The middle extra disappears (another process took it) before pickup.
    state.logistics.fragments = state.logistics.fragments.filter(f => f.fragment.id !== 9202);
    state.pendingActions = state.pendingActions.filter(a => a.payload['fragmentId'] !== 9202);

    let maxCargo = 0;
    tickUntil(run, () => {
      maxCargo = Math.max(maxCargo, vehicle.cargo.length);
      return [9201, 9203].every(id => state.logistics.fragments.find(t => t.fragment.id === id)?.state === 'stored');
    }, 1500);

    expect(maxCargo).toBeGreaterThanOrEqual(2); // the remaining extra rode in the same trip

    expect(state.logistics.fragments.find(t => t.fragment.id === 9201)!.state).toBe('stored');
    expect(state.logistics.fragments.find(t => t.fragment.id === 9203)!.state).toBe('stored');
    expect(vehicle.cargo).toEqual([]);
  });
});
