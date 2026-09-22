// BlastSimulator2026 — Tests for tickLocomotion
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
import { purchaseVehicle, getVehicleDefByTier, ROLE_LICENCE_REQUIRED, vehicleDriverId, getVehicleReservation } from '../../../src/core/entities/Vehicle.js';
import { NavGrid } from '../../../src/core/nav/NavGrid.js';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import { AGENT_WALK_SPEED, VEHICLE_OCCUPANCY_REROUTE_THRESHOLD, MOVE_STUCK_ABANDON_TICKS, STUCK_MORALE_PENALTY } from '../../../src/core/config/balance.js';
import { tickLocomotion } from '../../../src/core/engine/Locomotion.js';
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

/**
 * RAMP_WIDTH-wide (3-row) horizontal corridor, walled by void on both sides
 * (z=0 and z=4). Clearance caps out at NAV_CLEARANCE_MAX_CELLS only on the
 * centre row (z=2, Chebyshev distance 2 from either wall); the two edge rows
 * (z=1, z=3) read clearance 1, below NAV_CLEARANCE_VEHICLE_CELLS — so despite
 * being physically 3 cells wide, a *vehicle* still has exactly one passable
 * lane (z=2) with no lateral bypass, same as the pre-#1154 single-row
 * corridor this replaces (#1154 requires clearance>=2 for a vehicle, which a
 * literal 1-wide corridor can never satisfy even to take a first step).
 */
function buildCorridorState(sizeX: number): GameState {
  const state = createGame({ seed: SEED });
  const vg = new VoxelGrid(sizeX, 2, 5);
  for (let x = 0; x < sizeX; x++) {
    vg.setVoxel(x, 0, 1, solidVoxel());
    vg.setVoxel(x, 0, 2, solidVoxel());
    vg.setVoxel(x, 0, 3, solidVoxel());
  }
  state.navGrid = NavGrid.buildNavGrid(vg, [], []);
  return state;
}

/**
 * Two parallel vehicle-passable lanes (centred z=2 and z=8, each a
 * RAMP_WIDTH-wide 3-row corridor per buildCorridorState's reasoning), joined
 * only at their two ends (x=0..2 and x=sizeX-3..sizeX-1) by a solid bridge
 * spanning both lanes' full z-range. A blocker parked mid-way along the z=2
 * lane therefore still has a route around it — the long way via the z=8 lane
 * — but that route is several times longer than the direct one, so the
 * unconstrained shortest path always prefers to go straight through the
 * blocked cell. This is the chokepoint shape #1166's slope gate produces on
 * real terrain, reduced to its minimum. The 3-row lanes and 3-column bridges
 * (rather than the pre-#1154 single-cell corridor/connector) are the minimum
 * width a vehicle's NAV_CLEARANCE_VEHICLE_CELLS=2 requirement can actually
 * traverse — see buildCorridorState.
 */
function buildRingCorridorState(sizeX: number): GameState {
  const state = createGame({ seed: SEED });
  const vg = new VoxelGrid(sizeX, 2, 11);
  for (let x = 0; x < sizeX; x++) {
    for (const z of [1, 2, 3, 7, 8, 9]) {
      vg.setVoxel(x, 0, z, solidVoxel());
    }
  }
  for (const xStart of [0, sizeX - 3]) {
    for (let dx = 0; dx < 3; dx++) {
      for (let z = 1; z <= 9; z++) {
        vg.setVoxel(xStart + dx, 0, z, solidVoxel());
      }
    }
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

  it('never changes an unoccupied vehicle\'s x/z across 10 ticks', () => {
    const state = buildFlatNavGridState(20, 5);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 5, 5);
    vehicle.occupantIds = [];

    for (let i = 0; i < 10; i++) {
      tickLocomotion(state);
      expect(vehicle.x).toBe(5);
      expect(vehicle.z).toBe(5);
    }
  });

  it('waits on a blocked drive leg, attempts exactly one reroute, then sets employee.isMoveStuck and stops the vehicle — scaled by VEHICLE_OCCUPANCY_REROUTE_THRESHOLD, not an arbitrary iteration count', () => {
    const state = buildCorridorState(5);
    const rng = new Random(SEED);
    const { employee: driver } = hireEmployee(state.employees, 'driller', rng, 0, 2);
    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', 0, 2);
    vehicle.occupantIds = [driver.id];
    driver.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
    driver.itinerary = {
      legs: [{
        mode: 'drive', vehicleId: vehicle.id, destX: 4, destZ: 2,
        arrival: 'exact', onArrive: { kind: 'none' }, estTicks: 4,
      }],
      goal: { kind: 'reposition', x: 4, z: 2 },
      workTicks: 0,
      estTotalTicks: 4,
    } satisfies Itinerary;

    // Stationary, unoccupied blocker sitting directly on the only route
    // through the corridor's single vehicle-passable lane (z=2) — never
    // moves out of the way on its own.
    purchaseVehicle(state.vehicles, 'drill_rig', 2, 2);

    for (let i = 0; i < 1 + VEHICLE_OCCUPANCY_REROUTE_THRESHOLD + 2; i++) {
      tickLocomotion(state);
    }

    expect(driver.isMoveStuck).toBe(true);
    // Never advanced past the cell right before the blocker.
    expect(vehicle.x).toBe(1);
    expect(vehicle.z).toBe(2);

    const stuckX = vehicle.x;
    const stuckZ = vehicle.z;
    tickLocomotion(state);
    expect(vehicle.x).toBe(stuckX);
    expect(vehicle.z).toBe(stuckZ);
  });

  // #1166: a parked vehicle sitting on a chokepoint — a cell the direct
  // route must cross, with a legal but far longer way around — used to
  // livelock the driver rather than send it the long way. handleOccupancyBlock
  // took a single step of the avoiding route and then dropped it, so the very
  // next tick's unconstrained findPath (drive legs pass avoidVehicles:false)
  // routed straight back at the blocker, blocked again, waited out the
  // threshold again, and stepped back onto the detour again, forever. Nothing
  // escalated: every reroute resets isMoveStuck/moveConsecutiveFailures, and
  // the intervening ticks are ordinary successful movement, so the
  // stuck-abandon path never fired and no event was emitted.
  it('drives the long way around a vehicle parked on a chokepoint instead of oscillating in front of it forever', () => {
    const state = buildRingCorridorState(12);
    const rng = new Random(SEED);
    const { employee: driver } = hireEmployee(state.employees, 'driller', rng, 0, 2);
    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', 0, 2);
    vehicle.occupantIds = [driver.id];
    driver.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
    driver.itinerary = {
      legs: [{
        mode: 'drive', vehicleId: vehicle.id, destX: 11, destZ: 2,
        arrival: 'exact', onArrive: { kind: 'none' }, estTicks: 11,
      }],
      goal: { kind: 'reposition', x: 11, z: 2 },
      workTicks: 0,
      estTotalTicks: 11,
    } satisfies Itinerary;

    // Stationary blocker mid-corridor on the z=2 lane. A route around it
    // exists (out via the x=0 bridge, along the z=8 lane, back in via the
    // x=9..11 bridge) but is several times longer, so every unconstrained
    // repath prefers the cell it is parked on.
    purchaseVehicle(state.vehicles, 'drill_rig', 5, 2);

    // Generous ceiling: the detour is several times the direct distance at
    // rock_digger speed, plus the one VEHICLE_OCCUPANCY_REROUTE_THRESHOLD
    // wait before it starts. Loop exits on arrival rather than running the
    // budget out.
    const MAX_TICKS = 600;
    let ticks = 0;
    while (ticks < MAX_TICKS && driver.itinerary !== null) {
      tickLocomotion(state);
      ticks++;
    }

    expect(driver.itinerary).toBeNull();
    expect(vehicle.x).toBe(11);
    expect(vehicle.z).toBe(2);
    // The blocker was never asked to move — the driver went around it.
    expect(state.vehicles.vehicles.find(v => v.id !== vehicle.id)!.x).toBe(5);
  });

  // #1154 fixer round: findPathAvoidingOtherVehicles' escalation search
  // (avoidVehicles:true) shares isImpassable with ordinary foot pathfinding,
  // which — since #954 — treats any fragment-occupied cell as impassable too,
  // not just a vehicle-occupied one. That conflation is wrong for this
  // vehicle-only escalation: left unguarded, a detour route that happens to
  // cross ground fragments (exactly the shape of a debris_hauler driving
  // into its own fresh blast crater to collect them) reads as fully blocked
  // and the driver never reroutes at all — permanently stuck rather than
  // merely slow. The fix temporarily zeroes fragment occupancy for the
  // duration of this one escalation call, so a route through fragments (never
  // through another live vehicle) still succeeds.
  it('reroutes through a fragment-littered detour cell instead of getting stuck treating fragments as impassable', () => {
    const state = buildRingCorridorState(12);
    const rng = new Random(SEED);
    const { employee: driver } = hireEmployee(state.employees, 'driller', rng, 0, 2);
    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', 0, 2);
    vehicle.occupantIds = [driver.id];
    driver.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
    driver.itinerary = {
      legs: [{
        mode: 'drive', vehicleId: vehicle.id, destX: 11, destZ: 2,
        arrival: 'exact', onArrive: { kind: 'none' }, estTicks: 11,
      }],
      goal: { kind: 'reposition', x: 11, z: 2 },
      workTicks: 0,
      estTotalTicks: 11,
    } satisfies Itinerary;

    // Stationary blocker mid-corridor on the z=2 lane, exactly as the
    // chokepoint test above — the only route avoiding it is the z=8 lane.
    purchaseVehicle(state.vehicles, 'drill_rig', 5, 2);

    // A fragment wall spanning the full width of the z=8 detour lane
    // (z=7,8,9 at x=6) — ground debris, not a vehicle, but enough to close
    // off the entire lane if fragment occupancy is (wrongly) treated as
    // impassable by the vehicle-avoidance escalation.
    for (const fz of [7, 8, 9]) {
      state.navGrid!.addFragmentOccupant(6, fz);
      state.logistics.fragments.push({
        fragment: {
          id: fz, position: { x: 6, y: 0, z: fz }, volume: 1, mass: 10,
          rockId: 'cruite', oreDensities: {}, initialVelocity: { x: 0, y: 0, z: 0 },
          isProjection: false, halfExtents: { x: 0.5, y: 0.5, z: 0.5 }, shapeSeed: 1,
        },
        state: 'on_ground',
        vehicleId: null,
      });
    }

    const MAX_TICKS = 600;
    let ticks = 0;
    while (ticks < MAX_TICKS && driver.itinerary !== null) {
      tickLocomotion(state);
      ticks++;
    }

    // Reached the destination via the fragment-littered detour rather than
    // getting stuck waiting forever in front of the vehicle blocker.
    expect(driver.itinerary).toBeNull();
    expect(driver.isMoveStuck).toBe(false);
    expect(vehicle.x).toBe(11);
    expect(vehicle.z).toBe(2);
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
    const { employee: driver } = hireEmployee(state.employees, 'driller', rng, 0, 2);
    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', 0, 2);
    vehicle.occupantIds = [driver.id];
    driver.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
    driver.itinerary = {
      legs: [{
        mode: 'drive', vehicleId: vehicle.id, destX: 4, destZ: 2,
        arrival: 'exact', onArrive: { kind: 'none' }, estTicks: 4,
      }],
      goal: { kind: 'reposition', x: 4, z: 2 },
      workTicks: 0,
      estTotalTicks: 4,
    } satisfies Itinerary;

    // Idle, driverless, unreserved blocker sitting exactly on the drive
    // leg's own destination cell.
    const { vehicle: blocker } = purchaseVehicle(state.vehicles, 'drill_rig', 4, 2);
    expect(vehicleDriverId(blocker)).toBeNull();
    expect(getVehicleReservation(state.vehicles, blocker.id)).toBeNull();

    for (let i = 0; i < 1 + VEHICLE_OCCUPANCY_REROUTE_THRESHOLD + 5; i++) {
      tickLocomotion(state);
    }

    // The blocker moved off the destination cell...
    expect(blocker.x === 4 && blocker.z === 2).toBe(false);
    // ...and the requester is no longer permanently stuck: it has either
    // reached the destination (itinerary cleared) or is still progressing
    // toward it (not marked stuck).
    if (driver.itinerary !== null) {
      expect(driver.isMoveStuck).toBe(false);
    } else {
      expect(vehicle.x).toBe(4);
      expect(vehicle.z).toBe(2);
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

// #1091: driveVehicleTowardTarget (the old ad-hoc, itinerary-independent
// drive primitive) is deleted — no remaining caller needs a drive step
// outside the itinerary model any more. Its three behaviors here have real
// equivalents already covered elsewhere in this same file, through the
// itinerary/tickLocomotion path that is now the ONLY mover (this file's own
// header comment): a boarded vehicle advancing at its own tiered speed with
// the driver's position tracking it ("advances a mounted employee at the
// vehicle's tiered speed..." above), arrival exactly at the target leg
// destination ("clears the itinerary once the FINAL leg is reached" above),
// and an unoccupied vehicle never moving ("never changes an unoccupied
// vehicle's x/z across 10 ticks..." above). No replacement case was added
// here — deleting the low-level entry point removed the tests for it rather
// than the behavior itself.

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

    // The oscillation genuinely tripped isStuck this tick — that's what
    // pushed this into the abandon branch at all (proven by the morale
    // penalty and the abandon below). But abandon runs through
    // interruptActiveAction, whose clearHolderWalkFields (TaskCancellation.ts)
    // unconditionally resets isMoveStuck/moveConsecutiveFailures to their
    // idle defaults on every abandon — mirrors the identical vehicle-side
    // reset a few lines below in Locomotion.ts's own drive-leg abandon path,
    // and vehicles.integration.test.ts's own "released, back to idle" check.
    // A freshly-released employee is idle, not walking-stuck.
    expect(employee.isMoveStuck).toBe(false);
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

    // Same reset as the legacy foot-walk case above — clearHolderWalkFields
    // (via interruptActiveAction) and Locomotion.ts's own explicit
    // vehicle-side reset both zero isMoveStuck once the abandon actually
    // happens; only the reservation release/dismount below is the durable
    // observable outcome.
    expect(driver.isMoveStuck).toBe(false);
    expect(result.abandoned).toEqual(expect.arrayContaining([{ employeeId: driver.id, actionId: 88 }]));
    expect(driver.activeActionId).toBeNull();
    // Dismounted — the vehicle's driver reservation is released along with the abandon.
    expect(vehicleDriverId(vehicle)).toBeNull();
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

  // #1154 fixer round: nextGridStep's "am I already standing on the path's
  // own first waypoint" check used Math.floor, but that waypoint (built from
  // advanceLeg's driveFromX/driveFromZ, NavGrid.clampX/clampZ) is always the
  // mover's ROUNDED cell. For any position whose fractional part is >= 0.5
  // (round and floor disagree — about half of every tick spent driving), the
  // mismatch misidentified the mover's own current cell as the "next step"
  // still ahead of it. A live vehicle merely parked on that current cell —
  // never actually in the way of the real next step — then read as
  // isOccupiedByOtherVehicle and blocked the drive leg outright, escalating
  // to a full reroute after VEHICLE_OCCUPANCY_REROUTE_THRESHOLD ticks of
  // phantom waiting. Reproduced live via hauling-gate.json: a drill_rig
  // routed around a building's clearance-insufficient ring happened to round
  // onto a parked debris_hauler's cell partway through, costing 20+ ticks to
  // a detour the real next step never needed.
  it('does not block on a live vehicle parked on its own current (rounded) cell when its continuous position floors to a different cell', () => {
    const state = buildFlatNavGridState(20, 5);
    const rng = new Random(SEED);
    const { employee: driver } = hireEmployee(state.employees, 'driller', rng, 0, 2);
    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', 0, 2);
    vehicle.occupantIds = [driver.id];
    driver.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
    driver.itinerary = {
      legs: [{
        mode: 'drive', vehicleId: vehicle.id, destX: 10, destZ: 2,
        arrival: 'exact', onArrive: { kind: 'none' }, estTicks: 10,
      }],
      goal: { kind: 'reposition', x: 10, z: 2 },
      workTicks: 0,
      estTotalTicks: 10,
    } satisfies Itinerary;

    // Continuous position mid-cell, fractional part >= 0.5 — floors to 2,
    // rounds to 3. Not itinerary-derived; set directly so the test isolates
    // nextGridStep's own rounding convention from getVehicleDefByTier's
    // exact per-tick step size.
    driver.x = 2.6;
    driver.z = 2;
    vehicle.x = 2.6;
    vehicle.z = 2;

    // Another live vehicle parked exactly on the mover's own rounded cell
    // (3, 2) — not a real obstacle on the route ahead, since the mover is
    // already there.
    purchaseVehicle(state.vehicles, 'drill_rig', 3, 2);

    tickLocomotion(state);

    // Genuine progress this tick — never treated as blocked by a vehicle
    // sitting on the cell the mover itself already occupies.
    expect(driver.isMoveStuck).toBe(false);
    expect(vehicle.x).toBeGreaterThan(2.6);
  });
});
