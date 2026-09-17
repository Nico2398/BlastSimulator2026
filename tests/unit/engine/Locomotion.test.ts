// BlastSimulator2026 — Tests for tickLocomotion and driveVehicleTowardTarget
// (src/core/engine/Locomotion.ts, #1089 mount/itinerary rebuild phase 3b).
//
// tickLocomotion is the ONLY mover: it walks every alive employee's current
// itinerary leg (or, for an employee with no itinerary, the legacy
// destinationX/Z single foot leg) one tick's worth of movement, and — for a
// mounted employee — writes their vehicle's x/z from theirs. This is the sole
// place a vehicle's position ever changes (gameplay-vehicle-fleet skill,
// `vehicles` rule). tickVehicle/tickEmployeeMovement (EntityMovementTick.ts)
// still exist at this (red) phase, so these tests exercise the NEW module
// directly rather than through the old tick pipeline.
//
// Locomotion.ts is a stub that throws 'not implemented' at this phase — every
// test below is expected to fail for that reason, not from a fixture bug.

import { describe, it, expect, vi } from 'vitest';
import { createGame } from '../../../src/core/state/GameState.js';
import type { GameState, PendingAction } from '../../../src/core/state/GameState.js';
import { Random } from '../../../src/core/math/Random.js';
import { hireEmployee, assignSkill } from '../../../src/core/entities/Employee.js';
import { purchaseVehicle, getVehicleDefByTier, ROLE_LICENCE_REQUIRED } from '../../../src/core/entities/Vehicle.js';
import { NavGrid } from '../../../src/core/nav/NavGrid.js';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import { AGENT_WALK_SPEED, VEHICLE_OCCUPANCY_REROUTE_THRESHOLD, MOVE_STUCK_ABANDON_TICKS, STUCK_MORALE_PENALTY } from '../../../src/core/config/balance.js';
import { tickLocomotion, driveVehicleTowardTarget } from '../../../src/core/engine/Locomotion.js';
import * as AgentAdvanceModule from '../../../src/core/nav/AgentAdvance.js';
import { NULL_ROUTE_COMMITMENT } from '../../../src/core/nav/AgentAdvance.js';
import type { Itinerary } from '../../../src/core/engine/Itinerary.js';

const SEED = 42;

/** Solid rock voxel — same fixture shape used throughout the existing movement suites. */
function solidVoxel() {
  return { composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] }, density: 1.0, oreDensities: {}, fractureModifier: 1.0 };
}

/** A fully walkable flat NavGrid, wide enough for long straight drives. */
function buildFlatNavGridState(sizeX: number, sizeZ: number): GameState {
  const state = createGame({ seed: SEED });
  const vg = new VoxelGrid(sizeX, 2, sizeZ);
  for (let x = 0; x < sizeX; x++) {
    for (let z = 0; z < sizeZ; z++) {
      vg.setVoxel(x, 0, z, solidVoxel());
    }
  }
  state.navGrid = NavGrid.buildNavGrid(vg, [], []);
  return state;
}

/** 1-cell-wide horizontal corridor (only row z=1 solid) — no detour around any obstacle placed in it can exist. */
function buildCorridorState(sizeX: number): GameState {
  const state = createGame({ seed: SEED });
  const vg = new VoxelGrid(sizeX, 2, 3);
  for (let x = 0; x < sizeX; x++) {
    vg.setVoxel(x, 0, 1, solidVoxel());
  }
  state.navGrid = NavGrid.buildNavGrid(vg, [], []);
  return state;
}

/** Minimal 'general_work' PendingAction fixture, mirrors the `makeAction` shape used across the engine test suites. */
function makeGeneralWorkAction(id: number): PendingAction {
  return {
    id,
    type: 'general_work',
    requiredSkill: null,
    requiredVehicleRole: null,
    targetX: 0, targetZ: 0, targetY: 0,
    payload: {},
    targetEmployeeId: null,
    status: 'queued',
    holderId: null,
    queuedAtTick: 0,
  };
}

describe('tickLocomotion', () => {
  it('advances a mounted employee at the vehicle\'s tiered speed, not AGENT_WALK_SPEED, and the vehicle tracks the employee\'s position', () => {
    const state = buildFlatNavGridState(20, 5);
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driver', rng, 0, 0);
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 0, 0, 1);
    vehicle.occupantIds = [employee.id];
    employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };

    const speed = getVehicleDefByTier(vehicle.type, vehicle.tier).speed;
    expect(speed).not.toBe(AGENT_WALK_SPEED);

    employee.itinerary = {
      legs: [{
        mode: 'drive', vehicleId: vehicle.id, destX: 12, destZ: 0,
        arrival: 'exact', onArrive: { kind: 'none' }, estTicks: Math.ceil(12 / speed),
      }],
      goal: { kind: 'reposition', x: 12, z: 0 },
      workTicks: 0,
      estTotalTicks: Math.ceil(12 / speed),
    } satisfies Itinerary;

    tickLocomotion(state);

    expect(employee.x).toBe(speed);
    expect(employee.z).toBe(0);
    expect(vehicle.x).toBe(employee.x);
    expect(vehicle.z).toBe(employee.z);
  });

  it('advances an on-foot employee with an itinerary foot leg at AGENT_WALK_SPEED', () => {
    const state = buildFlatNavGridState(20, 5);
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);

    employee.itinerary = {
      legs: [{
        mode: 'foot', vehicleId: null, destX: 12, destZ: 0,
        arrival: 'exact', onArrive: { kind: 'none' }, estTicks: 6,
      }],
      goal: { kind: 'reposition', x: 12, z: 0 },
      workTicks: 0,
      estTotalTicks: 6,
    } satisfies Itinerary;

    tickLocomotion(state);

    expect(employee.x).toBe(AGENT_WALK_SPEED);
    expect(employee.z).toBe(0);
  });

  it('advances an on-foot employee with no itinerary but destinationX/Z set (legacy single foot leg) at AGENT_WALK_SPEED', () => {
    const state = buildFlatNavGridState(20, 5);
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    employee.itinerary = null;
    employee.destinationX = 12;
    employee.destinationZ = 0;

    tickLocomotion(state);

    expect(employee.x).toBe(AGENT_WALK_SPEED);
    expect(employee.z).toBe(0);
  });

  it('never changes an unoccupied vehicle\'s x/z across 10 ticks, regardless of any stray targetX/targetZ', () => {
    const state = buildFlatNavGridState(20, 5);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 5, 5);
    vehicle.occupantIds = [];
    vehicle.targetX = 19;
    vehicle.targetZ = 4;

    for (let i = 0; i < 10; i++) {
      tickLocomotion(state);
      expect(vehicle.x).toBe(5);
      expect(vehicle.z).toBe(5);
    }
  });

  it('waits on a blocked drive leg, attempts exactly one reroute, then sets employee.isMoveStuck and stops the vehicle — scaled by VEHICLE_OCCUPANCY_REROUTE_THRESHOLD, not an arbitrary iteration count', () => {
    const state = buildCorridorState(5);
    const rng = new Random(SEED);
    const { employee: driver } = hireEmployee(state.employees, 'driller', rng, 0, 1);
    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', 0, 1);
    vehicle.occupantIds = [driver.id];
    driver.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
    driver.itinerary = {
      legs: [{
        mode: 'drive', vehicleId: vehicle.id, destX: 4, destZ: 1,
        arrival: 'exact', onArrive: { kind: 'none' }, estTicks: 4,
      }],
      goal: { kind: 'reposition', x: 4, z: 1 },
      workTicks: 0,
      estTotalTicks: 4,
    } satisfies Itinerary;

    // Stationary, unoccupied blocker sitting directly on the only route
    // through the 1-wide corridor — never moves out of the way on its own.
    purchaseVehicle(state.vehicles, 'drill_rig', 2, 1);

    for (let i = 0; i < 1 + VEHICLE_OCCUPANCY_REROUTE_THRESHOLD + 2; i++) {
      tickLocomotion(state);
    }

    expect(driver.isMoveStuck).toBe(true);
    // Never advanced past the cell right before the blocker.
    expect(vehicle.x).toBe(1);
    expect(vehicle.z).toBe(1);

    const stuckX = vehicle.x;
    const stuckZ = vehicle.z;
    tickLocomotion(state);
    expect(vehicle.x).toBe(stuckX);
    expect(vehicle.z).toBe(stuckZ);
  });

  // #1103: an idle, driverless, unreserved vehicle squatting exactly on
  // another vehicle's drive-leg destination has no task of its own to
  // interrupt — relocateDestinationBlocker must move it clear once the
  // reroute-avoiding-vehicles attempt fails (destination itself is
  // occupied, so no such route exists), rather than leaving the requester
  // stuck forever. Mirrors the "waits...then stuck" test above, but the
  // blocker sits ON destX/destZ instead of merely on the route.
  it('relocates an idle, unreserved vehicle squatting on another vehicle\'s destination cell instead of leaving the requester stuck forever', () => {
    const state = buildCorridorState(6);
    const rng = new Random(SEED);
    const { employee: driver } = hireEmployee(state.employees, 'driller', rng, 0, 1);
    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', 0, 1);
    vehicle.occupantIds = [driver.id];
    driver.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
    driver.itinerary = {
      legs: [{
        mode: 'drive', vehicleId: vehicle.id, destX: 4, destZ: 1,
        arrival: 'exact', onArrive: { kind: 'none' }, estTicks: 4,
      }],
      goal: { kind: 'reposition', x: 4, z: 1 },
      workTicks: 0,
      estTotalTicks: 4,
    } satisfies Itinerary;

    // Idle, driverless, unreserved blocker sitting exactly on the drive
    // leg's own destination cell.
    const { vehicle: blocker } = purchaseVehicle(state.vehicles, 'drill_rig', 4, 1);
    expect(blocker.task).toBe('idle');
    expect(blocker.driverId).toBeNull();
    expect(blocker.reservedForActionId).toBeNull();

    for (let i = 0; i < 1 + VEHICLE_OCCUPANCY_REROUTE_THRESHOLD + 5; i++) {
      tickLocomotion(state);
    }

    // The blocker moved off the destination cell...
    expect(blocker.x === 4 && blocker.z === 1).toBe(false);
    // ...and the requester is no longer permanently stuck: it has either
    // reached the destination (itinerary cleared) or is still progressing
    // toward it (not marked stuck).
    if (driver.itinerary !== null) {
      expect(driver.isMoveStuck).toBe(false);
    } else {
      expect(vehicle.x).toBe(4);
      expect(vehicle.z).toBe(1);
    }
  });

  it('applies a non-final leg\'s onArrive step (board) on arrival and continues the itinerary to the next leg', () => {
    const state = buildFlatNavGridState(20, 5);
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    // A real board() call (unlike this file's other fixtures, which set
    // occupantIds/locomotion directly) enforces the role's licence.
    assignSkill(state.employees, employee.id, ROLE_LICENCE_REQUIRED.drill_rig, 1);
    // 1 cell away — well within a single tick's AGENT_WALK_SPEED (2).
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 1, 0);

    employee.itinerary = {
      legs: [
        {
          mode: 'foot', vehicleId: vehicle.id, destX: vehicle.x, destZ: vehicle.z,
          arrival: 'adjacent', onArrive: { kind: 'board', vehicleId: vehicle.id }, estTicks: 1,
        },
        {
          mode: 'drive', vehicleId: vehicle.id, destX: 10, destZ: 0,
          arrival: 'exact', onArrive: { kind: 'none' }, estTicks: 9,
        },
      ],
      goal: { kind: 'reposition', x: 10, z: 0 },
      workTicks: 0,
      estTotalTicks: 10,
    } satisfies Itinerary;

    tickLocomotion(state);

    expect(vehicle.occupantIds).toContain(employee.id);
    expect(employee.locomotion).toEqual({ kind: 'mounted', vehicleId: vehicle.id });
    // Itinerary continues — the drive leg is still pending, not abandoned.
    expect(employee.itinerary).not.toBeNull();
    expect(employee.itinerary!.legs).toHaveLength(1);
    expect(employee.itinerary!.legs[0]!.mode).toBe('drive');
  });

  it('clears the itinerary once the FINAL leg is reached', () => {
    const state = buildFlatNavGridState(20, 5);
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);

    employee.itinerary = {
      legs: [{
        mode: 'foot', vehicleId: null, destX: 1, destZ: 0,
        arrival: 'exact', onArrive: { kind: 'none' }, estTicks: 1,
      }],
      goal: { kind: 'reposition', x: 1, z: 0 },
      workTicks: 0,
      estTotalTicks: 1,
    } satisfies Itinerary;

    tickLocomotion(state);

    expect(employee.x).toBe(1);
    expect(employee.z).toBe(0);
    expect(employee.itinerary).toBeNull();
  });

  it('is a no-op for an employee with no itinerary and no legacy destination (boundary)', () => {
    const state = buildFlatNavGridState(20, 5);
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 3, 4);
    employee.itinerary = null;
    employee.destinationX = null;
    employee.destinationZ = null;

    expect(() => tickLocomotion(state)).not.toThrow();
    expect(employee.x).toBe(3);
    expect(employee.z).toBe(4);
  });
});

// ── #1130: abandon on a period-2 oscillation, not just a failed replan ─────
//
// advanceAlongPath (AgentAdvance.ts) now reports isStuck: true on a tick
// whose final position exactly matches the mover's own position 2 ticks
// back (moveHistoryX/Z), even though a route WAS found this tick
// (pathFound: true) — a genuine A/B/A/B cycle near a terrain ridge that
// never trips the old `!path.found` stuck path. Both call sites in
// Locomotion.ts (the legacy foot-walk leg and the itinerary leg, on-foot or
// drive) must treat `!outcome.pathFound || outcome.isStuck` as the abandon
// condition, not `!outcome.pathFound` alone — mocked here at the
// advanceAlongPath boundary so the oscillation itself (AgentAdvance.ts's own
// concern, covered directly in tests/unit/nav/AgentAdvance.test.ts) doesn't
// have to be reproduced through a real NavGrid detour to prove Locomotion's
// own dispatch of the outcome.

describe('tickLocomotion — abandons on isStuck even when pathFound is true (#1130)', () => {
  /** An advanceAlongPath outcome shaped like a found-but-oscillating tick, already past the stuck grace window. */
  function oscillatingStuckOutcome(x: number, z: number): ReturnType<typeof AgentAdvanceModule.advanceAlongPath> {
    return {
      pathFound: true,
      x, z,
      consecutiveFailures: MOVE_STUCK_ABANDON_TICKS,
      isStuck: true,
      becameStuck: true,
      isPathComplete: false,
      committed: NULL_ROUTE_COMMITMENT,
      moveHistoryX: null,
      moveHistoryZ: null,
    };
  }

  it('legacy foot-walk leg (destinationX/Z, no itinerary): abandons the active action and applies the morale penalty exactly as a failed replan would', () => {
    const state = buildFlatNavGridState(20, 5);
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    employee.itinerary = null;
    employee.destinationX = 12;
    employee.destinationZ = 0;
    employee.activeActionId = 77;
    const action = { ...makeGeneralWorkAction(77), holderId: employee.id, status: 'assigned' as const };
    state.pendingActions.push(action);
    const startingMorale = employee.morale;

    const spy = vi.spyOn(AgentAdvanceModule, 'advanceAlongPath').mockReturnValue(oscillatingStuckOutcome(0, 0));

    const result = tickLocomotion(state);

    spy.mockRestore();

    expect(employee.isMoveStuck).toBe(true);
    expect(employee.morale).toBe(Math.max(0, startingMorale - STUCK_MORALE_PENALTY));
    expect(result.abandoned).toEqual(expect.arrayContaining([{ employeeId: employee.id, actionId: 77 }]));
    expect(employee.activeActionId).toBeNull();
    const stored = state.pendingActions.find(a => a.id === 77)!;
    expect(stored.status).toBe('queued');
  });

  it('itinerary drive leg: abandons and dismounts the driver exactly as a failed replan would, even though the route was genuinely found this tick', () => {
    const state = buildFlatNavGridState(20, 5);
    const rng = new Random(SEED);
    const { employee: driver } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', 0, 0);
    vehicle.occupantIds = [driver.id];
    vehicle.driverId = driver.id;
    driver.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
    driver.activeActionId = 88;
    const action = { ...makeGeneralWorkAction(88), holderId: driver.id, status: 'assigned' as const, requiredVehicleRole: 'rock_digger' as const };
    state.pendingActions.push(action);
    driver.itinerary = {
      legs: [{
        mode: 'drive', vehicleId: vehicle.id, destX: 12, destZ: 0,
        arrival: 'exact', onArrive: { kind: 'none' }, estTicks: 6,
      }],
      goal: { kind: 'reposition', x: 12, z: 0 },
      workTicks: 0,
      estTotalTicks: 6,
    } satisfies Itinerary;

    const spy = vi.spyOn(AgentAdvanceModule, 'advanceAlongPath').mockReturnValue(oscillatingStuckOutcome(0, 0));

    const result = tickLocomotion(state);

    spy.mockRestore();

    expect(driver.isMoveStuck).toBe(true);
    expect(result.abandoned).toEqual(expect.arrayContaining([{ employeeId: driver.id, actionId: 88 }]));
    expect(driver.activeActionId).toBeNull();
    // Dismounted — the vehicle's driver reservation is released along with the abandon.
    expect(vehicle.driverId).toBeNull();
  });

  it('does not abandon when pathFound is true and isStuck is false — the ordinary, non-stuck advancing path is untouched', () => {
    const state = buildFlatNavGridState(20, 5);
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    employee.itinerary = null;
    employee.destinationX = 12;
    employee.destinationZ = 0;
    employee.activeActionId = 99;
    const action = { ...makeGeneralWorkAction(99), holderId: employee.id, status: 'assigned' as const };
    state.pendingActions.push(action);

    const spy = vi.spyOn(AgentAdvanceModule, 'advanceAlongPath').mockReturnValue({
      pathFound: true,
      x: AGENT_WALK_SPEED, z: 0,
      consecutiveFailures: 0,
      isStuck: false,
      becameStuck: false,
      isPathComplete: false,
      committed: NULL_ROUTE_COMMITMENT,
      moveHistoryX: 0,
      moveHistoryZ: 0,
    });

    const result = tickLocomotion(state);

    spy.mockRestore();

    expect(employee.isMoveStuck).toBe(false);
    expect(result.abandoned).toEqual([]);
    expect(employee.activeActionId).toBe(99);
  });

  it('handleOccupancyBlock\'s successful reroute resets moveHistoryX/Z — a reroute must never be compared against pre-reroute history', () => {
    // Open grid (unlike buildCorridorState): once the occupancy-block wait
    // threshold is reached, findPathAvoidingOtherVehicles has a real detour
    // around the single blocker to succeed with, unlike the always-fails
    // corridor case the "waits on a blocked drive leg" test above covers.
    const state = buildFlatNavGridState(8, 5);
    const rng = new Random(SEED);
    const { employee: driver } = hireEmployee(state.employees, 'driller', rng, 0, 1);
    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', 0, 1);
    vehicle.occupantIds = [driver.id];
    driver.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
    // Stale history from before the block — must not survive the reroute.
    driver.moveHistoryX = 42;
    driver.moveHistoryZ = 42;
    driver.itinerary = {
      legs: [{
        mode: 'drive', vehicleId: vehicle.id, destX: 6, destZ: 1,
        arrival: 'exact', onArrive: { kind: 'none' }, estTicks: 6,
      }],
      goal: { kind: 'reposition', x: 6, z: 1 },
      workTicks: 0,
      estTotalTicks: 6,
    } satisfies Itinerary;

    // Stationary, unoccupied blocker directly on the straight-line route.
    purchaseVehicle(state.vehicles, 'drill_rig', 2, 1);

    for (let i = 0; i < 1 + VEHICLE_OCCUPANCY_REROUTE_THRESHOLD + 2; i++) {
      tickLocomotion(state);
    }

    // The reroute succeeded on an open grid — never permanently stuck.
    expect(driver.isMoveStuck).toBe(false);
    // The stale pre-block history must have been reset (to null, then
    // possibly re-seeded by later real ticks) rather than carried straight
    // through the reroute unmodified.
    expect(driver.moveHistoryX).not.toBe(42);
    expect(driver.moveHistoryZ).not.toBe(42);
  });
});

describe('driveVehicleTowardTarget', () => {
  it('advances an already-boarded vehicle toward (targetX, targetZ) at its own tiered speed, independent of any itinerary', () => {
    const state = buildFlatNavGridState(20, 5);
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 0, 0);
    vehicle.occupantIds = [employee.id];
    employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
    employee.itinerary = null; // ad hoc phase-driving — no itinerary involved at all

    const speed = getVehicleDefByTier(vehicle.type, vehicle.tier).speed;

    const result = driveVehicleTowardTarget(state, vehicle, 12, 0);

    expect(result.arrived).toBe(false);
    expect(vehicle.x).toBe(speed);
    expect(vehicle.z).toBe(0);
    // The driver's own position tracks the vehicle.
    expect(employee.x).toBe(speed);
    expect(employee.z).toBe(0);
  });

  it('reports arrived: true and the vehicle sits exactly at the target once reached (boundary: within one tick\'s reach)', () => {
    const state = buildFlatNavGridState(20, 5);
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 0, 0);
    vehicle.occupantIds = [employee.id];
    employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };

    let result = { arrived: false };
    for (let i = 0; i < 10 && !result.arrived; i++) {
      result = driveVehicleTowardTarget(state, vehicle, 3, 0);
    }

    expect(result.arrived).toBe(true);
    expect(vehicle.x).toBe(3);
    expect(vehicle.z).toBe(0);
  });

  it('is a no-op (arrived: false, position unchanged) when the vehicle has no occupant (rejection)', () => {
    const state = buildFlatNavGridState(20, 5);
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 5, 5);
    vehicle.occupantIds = [];

    const result = driveVehicleTowardTarget(state, vehicle, 19, 4);

    expect(result.arrived).toBe(false);
    expect(vehicle.x).toBe(5);
    expect(vehicle.z).toBe(5);
  });
});
