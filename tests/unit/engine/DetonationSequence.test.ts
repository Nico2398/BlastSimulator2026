// BlastSimulator2026 — Tests for the detonation sequence (src/core/engine/DetonationSequence.ts, #1362):
// arm -> evacuate -> ready, with cancel and a stranded phase.

import { describe, it, expect, beforeEach } from 'vitest';
import { createGame, type GameState } from '../../../src/core/state/GameState.js';
import { NavGrid } from '../../../src/core/nav/NavGrid.js';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import { addHole } from '../../../src/core/mining/DrillPlan.js';
import { createCharge } from '../../../src/core/mining/ChargePlan.js';
import { hireEmployee, assignSkill } from '../../../src/core/entities/Employee.js';
import { purchaseVehicle } from '../../../src/core/entities/Vehicle.js';
import { isInZone, computeDangerZone } from '../../../src/core/entities/Zone.js';
import { Random } from '../../../src/core/math/Random.js';
import {
  BLAST_DANGER_MARGIN_M, DETONATION_REEVACUATE_INTERVAL_TICKS, DETONATION_STUCK_WALKER_FAILURE_TICKS,
} from '../../../src/core/config/balance.js';
import {
  armDetonation, cancelDetonation, detonationPhase, tickDetonation, isStuckWalker,
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

  it('re-evacuation sends a licensed employee who became available after arm time, clearing the stranded verdict (#1746)', () => {
    const state = chargedState();
    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', 30, 30);
    vehicle.occupantIds = [];
    const bystander = addWorker(state, 70, 70);
    assignSkill(state.employees, bystander.id, 'driving.excavator', 1);
    bystander.injured = true; // unavailable when armed
    armDetonation(state);
    expect(state.pendingDetonation!.strandedVehicleIds).toContain(vehicle.id);
    expect(detonationPhase(state).kind).toBe('stranded');

    bystander.injured = false; // freed before the next re-evacuation
    state.tickCount = DETONATION_REEVACUATE_INTERVAL_TICKS;
    const phase = tickDetonation(state);

    expect(bystander.itinerary).not.toBeNull();
    expect(state.pendingDetonation!.strandedVehicleIds).not.toContain(vehicle.id);
    expect(phase.kind).not.toBe('stranded');
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

/** Arm a detonation with employees at the given cells; arming orders each of them out (destination set). */
function armWithWalkers(positions: Array<[number, number]>) {
  const state = chargedState();
  const emps = positions.map(([x, z]) => addWorker(state, x, z));
  armDetonation(state);
  // Callers pass at most three positions and only index ones they passed; a tuple type drops the undefined from indexed access.
  type Worker = ReturnType<typeof addWorker>;
  return { state, emps: emps as [Worker, Worker, Worker] };
}

describe('isStuckWalker (#1990)', () => {
  it('is true when isMoveStuck is set', () => {
    expect(isStuckWalker({ isMoveStuck: true, moveConsecutiveFailures: 0 })).toBe(true);
  });

  it('is true at the failure bound without the stuck flag', () => {
    expect(isStuckWalker({ isMoveStuck: false, moveConsecutiveFailures: DETONATION_STUCK_WALKER_FAILURE_TICKS })).toBe(true);
  });

  it('is false one failure below the bound (boundary)', () => {
    expect(isStuckWalker({ isMoveStuck: false, moveConsecutiveFailures: DETONATION_STUCK_WALKER_FAILURE_TICKS - 1 })).toBe(false);
  });

  it('is false for a walker with no failures', () => {
    expect(isStuckWalker({ isMoveStuck: false, moveConsecutiveFailures: 0 })).toBe(false);
  });
});

describe('detonationPhase with a stuck walker (#1990)', () => {
  it('names an in-zone employee flagged isMoveStuck as stranded', () => {
    const { state, emps } = armWithWalkers([[22, 22]]);
    emps[0].isMoveStuck = true;
    expect(detonationPhase(state)).toEqual({ kind: 'stranded', names: [emps[0].name] });
  });

  it('names an in-zone employee at the failure bound even when isMoveStuck is false', () => {
    const { state, emps } = armWithWalkers([[22, 22]]);
    emps[0].isMoveStuck = false;
    emps[0].moveConsecutiveFailures = DETONATION_STUCK_WALKER_FAILURE_TICKS;
    expect(detonationPhase(state)).toEqual({ kind: 'stranded', names: [emps[0].name] });
  });

  it('counts an employee below the failure bound and not stuck as still evacuating', () => {
    const { state, emps } = armWithWalkers([[22, 22]]);
    emps[0].moveConsecutiveFailures = DETONATION_STUCK_WALKER_FAILURE_TICKS - 1;
    expect(detonationPhase(state)).toEqual({ kind: 'evacuating', remaining: 1 });
  });

  it('counts an employee still walking out (destination set, no failures) as left, not stranded', () => {
    const { state, emps } = armWithWalkers([[22, 22]]);
    expect(emps[0].destinationX).not.toBeNull();
    expect(detonationPhase(state)).toEqual({ kind: 'evacuating', remaining: 1 });
  });

  it('stuck + walking: still evacuating with both counted', () => {
    const { state, emps } = armWithWalkers([[22, 22], [25, 25]]);
    emps[0].isMoveStuck = true;
    expect(detonationPhase(state)).toEqual({ kind: 'evacuating', remaining: 2 });
  });

  it('once the walker leaves, the phase is stranded naming only the stuck one', () => {
    const { state, emps } = armWithWalkers([[22, 22], [25, 25]]);
    emps[0].isMoveStuck = true;
    emps[1].x = 70; emps[1].z = 70;
    expect(detonationPhase(state)).toEqual({ kind: 'stranded', names: [emps[0].name] });
  });

  it('ignores a stuck employee outside the zone', () => {
    const { state, emps } = armWithWalkers([[22, 22], [70, 70]]);
    emps[1].isMoveStuck = true;
    expect(detonationPhase(state)).toEqual({ kind: 'evacuating', remaining: 1 });
  });

  it('ignores a dead stuck employee inside the zone', () => {
    const { state, emps } = armWithWalkers([[22, 22], [25, 25]]);
    emps[0].isMoveStuck = true;
    emps[0].alive = false;
    expect(detonationPhase(state)).toEqual({ kind: 'evacuating', remaining: 1 });
  });

  it('is ready once the zone is clear, stuck flags notwithstanding', () => {
    const { state, emps } = armWithWalkers([[22, 22]]);
    emps[0].isMoveStuck = true;
    emps[0].x = 70; emps[0].z = 70;
    expect(detonationPhase(state)).toEqual({ kind: 'ready' });
  });
});

describe('tickDetonation with a stuck walker (#1990)', () => {
  it('latches a stuck in-zone employee into pending.strandedEmployeeIds on the re-evacuation tick', () => {
    const { state, emps } = armWithWalkers([[22, 22]]);
    emps[0].isMoveStuck = true;
    state.tickCount = DETONATION_REEVACUATE_INTERVAL_TICKS;
    const phase = tickDetonation(state);
    expect(state.pendingDetonation!.strandedEmployeeIds).toContain(emps[0].id);
    expect(phase).toEqual({ kind: 'stranded', names: [emps[0].name] });
  });

  it('stays stranded after the stuck counters reset on a later tick', () => {
    const { state, emps } = armWithWalkers([[22, 22]]);
    emps[0].isMoveStuck = true;
    state.tickCount = DETONATION_REEVACUATE_INTERVAL_TICKS;
    tickDetonation(state);
    emps[0].isMoveStuck = false;
    emps[0].moveConsecutiveFailures = 0;
    state.tickCount += 1;
    expect(tickDetonation(state)).toEqual({ kind: 'stranded', names: [emps[0].name] });
  });

  it('does not latch a stuck employee who is outside the zone or dead', () => {
    const { state, emps } = armWithWalkers([[22, 22], [70, 70], [25, 25]]);
    emps[1].isMoveStuck = true;
    emps[2].isMoveStuck = true;
    emps[2].alive = false;
    state.tickCount = DETONATION_REEVACUATE_INTERVAL_TICKS;
    tickDetonation(state);
    expect(state.pendingDetonation!.strandedEmployeeIds).toEqual([]);
  });

  it('moves to ready when the zone clears, as before', () => {
    const { state, emps } = armWithWalkers([[22, 22]]);
    emps[0].isMoveStuck = true;
    emps[0].x = 70; emps[0].z = 70;
    expect(tickDetonation(state)).toEqual({ kind: 'ready' });
  });
});
