// BlastSimulator2026 — Tests for the detonation sequence (src/core/engine/DetonationSequence.ts, #1362):
// arm -> evacuate -> ready, with cancel and a stranded phase.

import { describe, it, expect, beforeEach } from 'vitest';
import { createGame, type GameState } from '../../../src/core/state/GameState.js';
import { NavGrid } from '../../../src/core/nav/NavGrid.js';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import { addHole } from '../../../src/core/mining/DrillPlan.js';
import { createCharge } from '../../../src/core/mining/ChargePlan.js';
import { hireEmployee } from '../../../src/core/entities/Employee.js';
import { purchaseVehicle } from '../../../src/core/entities/Vehicle.js';
import { isInZone, computeDangerZone } from '../../../src/core/entities/Zone.js';
import { Random } from '../../../src/core/math/Random.js';
import { BLAST_DANGER_MARGIN_M, DETONATION_REEVACUATE_INTERVAL_TICKS } from '../../../src/core/config/balance.js';
import {
  armDetonation, cancelDetonation, detonationPhase, tickDetonation,
} from '../../../src/core/engine/DetonationSequence.js';

const holeCounter = { nextHoleId: 1 };

function flatWalkableGrid(size: number): NavGrid {
  const vg = new VoxelGrid(size, size);
  for (let x = 0; x < size; x++) {
    for (let z = 0; z < size; z++) {
      vg.setVoxel(x, 0, z, {
        composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
        density: 1.0, oreDensities: {}, fractureModifier: 1.0,
      });
    }
  }
  return NavGrid.buildNavGrid(vg, [], []);
}

/** One charged hole at (20,20): danger zone is the 15 m-padded box (5,5)-(35,35). */
function chargedState(withNav = true): GameState {
  const state = createGame({ seed: 42 });
  if (withNav) state.navGrid = flatWalkableGrid(80);
  const hole = addHole(holeCounter, state.drillHoles, 20, 20, 8, 0.15);
  const c = createCharge('boomite', 5, 2, hole.depth);
  if ('charge' in c) state.chargesByHole[hole.id] = c.charge;
  return state;
}

function addWorker(state: GameState, x: number, z: number) {
  return hireEmployee(state.employees, 'driller', new Random(42), x, z).employee;
}

beforeEach(() => { holeCounter.nextHoleId = 1; });

describe('armDetonation', () => {
  it('arms: sets state.pendingDetonation with the current tick and returns it', () => {
    const state = chargedState();
    state.tickCount = 7;
    const res = armDetonation(state);
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(state.pendingDetonation).toBe(res.data);
    expect(res.data.armedTick).toBe(7);
    expect(res.data.lastEvacuationTick).toBe(7);
    expect(res.data.strandedEmployeeIds).toEqual([]);
    expect(res.data.strandedVehicleIds).toEqual([]);
  });

  it('sounds the horn: an employee inside the zone is routed out, not teleported', () => {
    const state = chargedState();
    const emp = addWorker(state, 22, 22);
    expect(armDetonation(state).success).toBe(true);
    expect(emp.x).toBe(22);
    expect(emp.destinationX).not.toBeNull();
    expect(isInZone(emp.destinationX!, emp.destinationZ!, computeDangerZone(state.drillHoles, BLAST_DANGER_MARGIN_M)!)).toBe(false);
  });

  it('records a stranded employee when no safe cell exists', () => {
    const state = chargedState(false); // no navGrid: nowhere to route
    const emp = addWorker(state, 22, 22);
    const res = armDetonation(state);
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.strandedEmployeeIds).toEqual([emp.id]);
  });

  it('records a driverless vehicle in the zone as stranded', () => {
    const state = chargedState();
    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', 22, 22);
    vehicle.occupantIds = [];
    const res = armDetonation(state);
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.strandedVehicleIds).toEqual([vehicle.id]);
  });

  it('refuses with no holes and leaves pendingDetonation null', () => {
    const state = createGame({ seed: 42 });
    const res = armDetonation(state);
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.length).toBeGreaterThan(0);
    expect(state.pendingDetonation).toBeNull();
  });

  it('refuses holes that carry no charge', () => {
    const state = createGame({ seed: 42 });
    addHole(holeCounter, state.drillHoles, 20, 20, 8, 0.15);
    expect(armDetonation(state).success).toBe(false);
    expect(state.pendingDetonation).toBeNull();
  });

  it('a second arm while armed is refused and keeps the first record untouched', () => {
    const state = chargedState();
    const first = armDetonation(state);
    expect(first.success).toBe(true);
    const armedRecord = state.pendingDetonation;
    state.tickCount = 50;
    const second = armDetonation(state);
    expect(second.success).toBe(false);
    expect(state.pendingDetonation).toBe(armedRecord);
    expect(state.pendingDetonation!.armedTick).toBe(0);
  });
});

describe('cancelDetonation', () => {
  it('clears an armed detonation and returns true', () => {
    const state = chargedState();
    armDetonation(state);
    expect(cancelDetonation(state)).toBe(true);
    expect(state.pendingDetonation).toBeNull();
    expect(detonationPhase(state)).toEqual({ kind: 'idle' });
  });

  it('returns false when nothing is armed (boundary)', () => {
    const state = chargedState();
    expect(cancelDetonation(state)).toBe(false);
    expect(state.pendingDetonation).toBeNull();
  });

  it('can re-arm after a cancel', () => {
    const state = chargedState();
    armDetonation(state);
    cancelDetonation(state);
    expect(armDetonation(state).success).toBe(true);
  });
});

describe('detonationPhase', () => {
  it('is idle when nothing is armed', () => {
    expect(detonationPhase(chargedState())).toEqual({ kind: 'idle' });
  });

  it('is ready when armed on an already-clear zone', () => {
    const state = chargedState();
    addWorker(state, 70, 70);
    armDetonation(state);
    expect(detonationPhase(state)).toEqual({ kind: 'ready' });
  });

  it('is evacuating with the occupant count while people are still inside', () => {
    const state = chargedState();
    addWorker(state, 22, 22);
    addWorker(state, 23, 23);
    armDetonation(state);
    expect(detonationPhase(state)).toEqual({ kind: 'evacuating', remaining: 2 });
  });

  it('counts a vehicle with a driver as remaining while it is still inside', () => {
    const state = chargedState();
    const emp = addWorker(state, 70, 70);
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 22, 22);
    vehicle.occupantIds = [emp.id];
    armDetonation(state);
    expect(detonationPhase(state)).toEqual({ kind: 'evacuating', remaining: 1 });
  });

  it('is stranded with the occupant name when nobody can leave', () => {
    const state = chargedState(false);
    const emp = addWorker(state, 22, 22);
    armDetonation(state);
    const phase = detonationPhase(state);
    expect(phase.kind).toBe('stranded');
    if (phase.kind === 'stranded') {
      expect(phase.names).toHaveLength(1);
      expect(phase.names[0]).toContain(emp.name);
    }
  });

  it('names a stranded driverless vehicle too', () => {
    const state = chargedState();
    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', 22, 22);
    vehicle.occupantIds = [];
    armDetonation(state);
    const phase = detonationPhase(state);
    expect(phase.kind).toBe('stranded');
    if (phase.kind === 'stranded') expect(phase.names.length).toBeGreaterThanOrEqual(1);
  });

  it('is a pure read: repeated calls do not change state', () => {
    const state = chargedState();
    addWorker(state, 22, 22);
    armDetonation(state);
    const before = JSON.stringify(state.pendingDetonation);
    detonationPhase(state);
    detonationPhase(state);
    expect(JSON.stringify(state.pendingDetonation)).toBe(before);
  });
});

describe('tickDetonation', () => {
  it('returns idle when nothing is armed', () => {
    expect(tickDetonation(chargedState())).toEqual({ kind: 'idle' });
  });

  it('moves evacuating -> ready once the zone empties', () => {
    const state = chargedState();
    const emp = addWorker(state, 22, 22);
    armDetonation(state);
    expect(tickDetonation(state)).toEqual({ kind: 'evacuating', remaining: 1 });
    emp.x = 70; emp.z = 70;
    expect(tickDetonation(state)).toEqual({ kind: 'ready' });
  });

  it('does not re-issue the evacuation order before the interval elapses', () => {
    const state = chargedState();
    addWorker(state, 22, 22);
    armDetonation(state);
    state.tickCount = DETONATION_REEVACUATE_INTERVAL_TICKS - 1;
    tickDetonation(state);
    expect(state.pendingDetonation!.lastEvacuationTick).toBe(0);
  });

  it('re-issues the evacuation order every DETONATION_REEVACUATE_INTERVAL_TICKS', () => {
    const state = chargedState();
    addWorker(state, 22, 22);
    armDetonation(state);
    state.tickCount = DETONATION_REEVACUATE_INTERVAL_TICKS;
    tickDetonation(state);
    expect(state.pendingDetonation!.lastEvacuationTick).toBe(DETONATION_REEVACUATE_INTERVAL_TICKS);
  });

  it('re-evacuation re-routes someone who drifted back into the zone', () => {
    const state = chargedState();
    const emp = addWorker(state, 22, 22);
    armDetonation(state);
    emp.destinationX = null; emp.destinationZ = null; // order lost
    state.tickCount = DETONATION_REEVACUATE_INTERVAL_TICKS;
    tickDetonation(state);
    expect(emp.destinationX).not.toBeNull();
  });

  it('stays stranded (never ready) while the stranded occupant is still inside', () => {
    const state = chargedState(false);
    addWorker(state, 22, 22);
    armDetonation(state);
    for (let i = 1; i <= 3 * DETONATION_REEVACUATE_INTERVAL_TICKS; i++) {
      state.tickCount = i;
      expect(tickDetonation(state).kind).toBe('stranded');
    }
  });

  it('a cancelled detonation ticks as idle', () => {
    const state = chargedState();
    addWorker(state, 22, 22);
    armDetonation(state);
    cancelDetonation(state);
    expect(tickDetonation(state)).toEqual({ kind: 'idle' });
  });
});
