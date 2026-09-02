// BlastSimulator2026 — Tests for vehicle and employee per-tick movement
// (tickVehicle, tickEmployeeMovement). Split out of GameLoop.test.ts (#407
// refactor) alongside the EntityMovementTick.ts module extraction — these
// describe blocks are self-contained and exercise nothing else in GameLoop.ts.

import { describe, it, expect } from 'vitest';
import { createGame } from '../../../src/core/state/GameState.js';
import { Random } from '../../../src/core/math/Random.js';
import { tickVehicle, tickEmployeeMovement, tickVehicleTaskState, syncDriverPosition } from '../../../src/core/engine/EntityMovementTick.js';
import { hireEmployee } from '../../../src/core/entities/Employee.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { purchaseVehicle, type VehicleTask } from '../../../src/core/entities/Vehicle.js';
import { NavGrid } from '../../../src/core/nav/NavGrid.js';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import {
  AGENT_WALK_SPEED,
  STUCK_THRESHOLD,
  STUCK_MORALE_PENALTY,
  VEHICLE_OCCUPANCY_REROUTE_THRESHOLD,
} from '../../../src/core/config/balance.js';

const VEHICLE_TICK_SEED = 42;

describe('tickVehicle (Task 2.7)', () => {
  it('advances a moving vehicle toward its target cell', () => {
    const state = createGame({ seed: VEHICLE_TICK_SEED });
    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', 0, 0);
    vehicle.task = 'moving';
    vehicle.state = 'moving';
    vehicle.targetX = 2;
    vehicle.targetZ = 0;

    tickVehicle(state, vehicle);
    expect(vehicle.x).toBe(1);
    expect(vehicle.z).toBe(0);
    expect(vehicle.state).toBe('moving');
    expect(vehicle.task).toBe('moving');

    tickVehicle(state, vehicle);
    expect(vehicle.x).toBe(2);
    expect(vehicle.z).toBe(0);
    expect(vehicle.state).toBe('idle');
    expect(vehicle.task).toBe('idle');
  });

  it('puts one vehicle into waiting when two vehicles converge on the same target cell', () => {
    const state = createGame({ seed: VEHICLE_TICK_SEED });
    const { vehicle: left } = purchaseVehicle(state.vehicles, 'rock_digger', 0, 0);
    const { vehicle: right } = purchaseVehicle(state.vehicles, 'drill_rig', 2, 0);

    left.task = 'moving';
    left.state = 'moving';
    left.targetX = 1;
    left.targetZ = 0;

    right.task = 'moving';
    right.state = 'moving';
    right.targetX = 1;
    right.targetZ = 0;

    tickVehicle(state, left);
    tickVehicle(state, right);

    const waitingVehicles = [left, right].filter(v => v.state === 'waiting');
    expect(waitingVehicles).toHaveLength(1);
    const movingVehicles = [left, right].filter(v => v.state !== 'waiting');
    expect(movingVehicles).toHaveLength(1);
    expect(movingVehicles[0]!.x).toBe(1);
    expect(movingVehicles[0]!.z).toBe(0);
  });

  it('resumes waiting vehicle movement when the blocked cell becomes free', () => {
    const state = createGame({ seed: VEHICLE_TICK_SEED });
    const { vehicle: blocker } = purchaseVehicle(state.vehicles, 'rock_digger', 0, 0);
    const { vehicle: waiting } = purchaseVehicle(state.vehicles, 'drill_rig', 2, 0);

    blocker.task = 'moving';
    blocker.state = 'moving';
    blocker.targetX = 1;
    blocker.targetZ = 0;

    waiting.task = 'moving';
    waiting.state = 'moving';
    waiting.targetX = 1;
    waiting.targetZ = 0;

    tickVehicle(state, blocker);
    tickVehicle(state, waiting);
    expect(waiting.state).toBe('waiting');

    blocker.task = 'moving';
    blocker.state = 'moving';
    blocker.targetX = 0;
    blocker.targetZ = 0;
    tickVehicle(state, blocker);

    tickVehicle(state, waiting);
    expect(waiting.x).toBe(1);
    expect(waiting.z).toBe(0);
    expect(waiting.state).toBe('idle');
  });
});

// ── tickVehicle — NavGrid stuck detection (issue #407 review round 2) ────────
// Mirrors the tickEmployeeMovement stuck-threshold test below: the
// tickVehicleOnNavGrid stuck branch (findPath fails every tick) previously had
// zero test coverage — every tickVehicle test above runs with state.navGrid
// null, which only ever exercises tickVehicleDirectLine.

describe('tickVehicle — NavGrid stuck detection (issue #407 review round 2)', () => {
  /** Solid rock voxel used to build a small hand-crafted NavGrid below. */
  function solidVoxel() {
    return { composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] }, density: 1.0, oreDensities: {}, fractureModifier: 1.0 };
  }

  it('crosses STUCK_THRESHOLD when no path exists: emits vehicle:stuck once, sets isMoveStuck, and moves the vehicle into waiting', () => {
    const state = createGame({ seed: VEHICLE_TICK_SEED });

    // A 5×5×5 NavGrid with rock only under (0,0) — every other column stays
    // void (density 0 everywhere), so a target there is impassable and
    // findPath returns found:false on every tick, forever.
    const vg = new VoxelGrid(5, 5, 5);
    vg.setVoxel(0, 0, 0, solidVoxel());
    vg.setVoxel(0, 1, 0, solidVoxel());
    state.navGrid = NavGrid.buildNavGrid(vg, [], []);

    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', 0, 0);
    vehicle.task = 'moving';
    vehicle.state = 'moving';
    vehicle.targetX = 3;
    vehicle.targetZ = 3; // void column — unreachable

    const emitter = new EventEmitter();
    const stuckEvents: number[] = [];
    emitter.on('vehicle:stuck', ({ vehicleId }) => stuckEvents.push(vehicleId));

    for (let i = 0; i < STUCK_THRESHOLD; i++) {
      tickVehicle(state, vehicle, emitter);
    }

    expect(vehicle.isMoveStuck).toBe(true);
    expect(vehicle.moveConsecutiveFailures).toBe(STUCK_THRESHOLD);
    expect(stuckEvents).toEqual([vehicle.id]); // fired exactly once, on the crossing tick
    expect(vehicle.x).toBe(0); // never moved — no path ever resolved
    expect(vehicle.z).toBe(0);
    expect(vehicle.state).toBe('waiting');
    expect(vehicle.waitingTicks).toBe(STUCK_THRESHOLD);

    // One more failed tick past the threshold — still stuck, but the event
    // does not re-fire on every subsequent tick, only on the falling edge.
    tickVehicle(state, vehicle, emitter);
    expect(stuckEvents).toEqual([vehicle.id]);
    expect(vehicle.isMoveStuck).toBe(true);
    expect(vehicle.waitingTicks).toBe(STUCK_THRESHOLD + 1);
  });
});

// ── tickVehicle — occupancy-block reroute/stuck escalation (issue #591) ─────
// tickVehicleOnNavGrid finds a path just fine here (findPath ignores vehicles
// unless avoidVehicles:true) — the block is a stationary vehicle sitting on
// the immediate next path cell, caught by isCellOccupiedByOtherVehicle, not a
// pathfinding failure. Before the fix, that branch just called
// markVehicleWaiting and returned, forever, with no escalation at all: no
// reroute attempt, no isMoveStuck flip, no vehicle:stuck emission, regardless
// of how long the wait ran. These tests build small hand-crafted NavGrids
// (same solidVoxel() helper as the STUCK_THRESHOLD suite above) and drive a
// blocked vehicle with tickVehicle to exercise the escalation.

describe('tickVehicle — occupancy-block reroute/stuck escalation (issue #591)', () => {
  /** Solid rock voxel — same fixture as the describe block above. */
  function solidVoxel() {
    return { composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] }, density: 1.0, oreDensities: {}, fractureModifier: 1.0 };
  }

  /**
   * Open 5×3 NavGrid (x:0..4, z:0..2), fully walkable — wide enough that a
   * vehicle blocked mid-route has a real diagonal detour available.
   */
  function buildOpenState() {
    const state = createGame({ seed: VEHICLE_TICK_SEED });
    const vg = new VoxelGrid(5, 2, 3);
    for (let z = 0; z < 3; z++) {
      for (let x = 0; x < 5; x++) {
        vg.setVoxel(x, 0, z, solidVoxel());
      }
    }
    state.navGrid = NavGrid.buildNavGrid(vg, [], []);
    return state;
  }

  /**
   * 1-cell-wide horizontal corridor (x:0..4, z:0..2) — only row z=1 is solid,
   * so rows z=0 and z=2 are 'void' (impassable). No detour around any
   * obstacle placed in the corridor can exist.
   */
  function buildCorridorState() {
    const state = createGame({ seed: VEHICLE_TICK_SEED });
    const vg = new VoxelGrid(5, 2, 3);
    for (let x = 0; x < 5; x++) {
      vg.setVoxel(x, 0, 1, solidVoxel());
    }
    state.navGrid = NavGrid.buildNavGrid(vg, [], []);
    return state;
  }

  it('reroutes around a stationary blocking vehicle once the wait crosses VEHICLE_OCCUPANCY_REROUTE_THRESHOLD, and reaches its target without ever going stuck', () => {
    const state = buildOpenState();

    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', 0, 1);
    vehicle.task = 'moving';
    vehicle.state = 'moving';
    vehicle.targetX = 4;
    vehicle.targetZ = 1;

    // Stationary, driverless vehicle sitting directly on the shortest route.
    // Never ticked (task stays 'idle'), so it never moves out of the way on
    // its own — only a reroute lets vehicle get past it.
    const { vehicle: blocker } = purchaseVehicle(state.vehicles, 'drill_rig', 2, 1);
    blocker.task = 'idle';
    blocker.state = 'idle';

    const emitter = new EventEmitter();
    const stuckEvents: number[] = [];
    emitter.on('vehicle:stuck', ({ vehicleId }) => stuckEvents.push(vehicleId));

    const MAX_TICKS = VEHICLE_OCCUPANCY_REROUTE_THRESHOLD + 20;
    let maxWaitingTicksSeen = 0;
    let ticks = 0;
    while (!(vehicle.x === 4 && vehicle.z === 1 && (vehicle.task as VehicleTask) === 'idle') && ticks < MAX_TICKS) {
      tickVehicle(state, vehicle, emitter);
      expect(vehicle.isMoveStuck).toBe(false);
      maxWaitingTicksSeen = Math.max(maxWaitingTicksSeen, vehicle.waitingTicks);
      ticks++;
    }

    // Proves the vehicle actually got blocked long enough to require the
    // reroute escalation, rather than happening to find a clear route.
    expect(maxWaitingTicksSeen).toBeGreaterThanOrEqual(VEHICLE_OCCUPANCY_REROUTE_THRESHOLD - 1);

    expect(vehicle.x).toBe(4);
    expect(vehicle.z).toBe(1);
    expect(vehicle.task).toBe('idle');
    expect(stuckEvents).toEqual([]);
  });

  it('sets isMoveStuck and emits vehicle:stuck exactly once when no route avoiding the obstacle exists (1-wide corridor)', () => {
    const state = buildCorridorState();

    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', 0, 1);
    vehicle.task = 'moving';
    vehicle.state = 'moving';
    vehicle.targetX = 4;
    vehicle.targetZ = 1;

    const { vehicle: blocker } = purchaseVehicle(state.vehicles, 'drill_rig', 2, 1);
    blocker.task = 'idle';
    blocker.state = 'idle';

    const emitter = new EventEmitter();
    const stuckEvents: number[] = [];
    emitter.on('vehicle:stuck', ({ vehicleId }) => stuckEvents.push(vehicleId));

    // 1 tick to reach the cell right before the blocker, then enough blocked
    // ticks to cross VEHICLE_OCCUPANCY_REROUTE_THRESHOLD and a couple more.
    for (let i = 0; i < 1 + VEHICLE_OCCUPANCY_REROUTE_THRESHOLD + 2; i++) {
      tickVehicle(state, vehicle, emitter);
    }

    expect(vehicle.isMoveStuck).toBe(true);
    expect(stuckEvents).toEqual([vehicle.id]); // fired exactly once
    expect(vehicle.x).toBe(1); // never advanced past the cell before the blocker
    expect(vehicle.z).toBe(1);

    // Further blocked ticks must not re-fire the event.
    tickVehicle(state, vehicle, emitter);
    tickVehicle(state, vehicle, emitter);
    expect(stuckEvents).toEqual([vehicle.id]);
    expect(vehicle.isMoveStuck).toBe(true);
  });

  it('does not escalate before VEHICLE_OCCUPANCY_REROUTE_THRESHOLD is reached — stays waiting, never stuck, never rerouted early', () => {
    const state = buildCorridorState();

    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', 0, 1);
    vehicle.task = 'moving';
    vehicle.state = 'moving';
    vehicle.targetX = 4;
    vehicle.targetZ = 1;

    const { vehicle: blocker } = purchaseVehicle(state.vehicles, 'drill_rig', 2, 1);
    blocker.task = 'idle';
    blocker.state = 'idle';

    const emitter = new EventEmitter();
    const stuckEvents: number[] = [];
    emitter.on('vehicle:stuck', ({ vehicleId }) => stuckEvents.push(vehicleId));

    // First tick: unblocked move onto the cell just before the blocker.
    tickVehicle(state, vehicle, emitter);
    expect(vehicle.x).toBe(1);
    expect(vehicle.z).toBe(1);

    // Blocked ticks 1..(threshold - 1): must never escalate.
    for (let i = 0; i < VEHICLE_OCCUPANCY_REROUTE_THRESHOLD - 1; i++) {
      tickVehicle(state, vehicle, emitter);
      expect(vehicle.isMoveStuck).toBe(false);
      expect(vehicle.state).toBe('waiting');
      expect(vehicle.x).toBe(1);
      expect(vehicle.z).toBe(1);
    }
    expect(vehicle.waitingTicks).toBe(VEHICLE_OCCUPANCY_REROUTE_THRESHOLD - 1);
    expect(stuckEvents).toEqual([]);

    // Crossing tick — waitingTicks reaches the threshold, escalation fires
    // now, not before.
    tickVehicle(state, vehicle, emitter);
    expect(vehicle.isMoveStuck).toBe(true);
    expect(stuckEvents).toEqual([vehicle.id]);
  });

  it('resumes normal movement and clears isMoveStuck once the blocking vehicle moves away, even after the wait escalated into stuck', () => {
    const state = buildCorridorState();

    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', 0, 1);
    vehicle.task = 'moving';
    vehicle.state = 'moving';
    vehicle.targetX = 4;
    vehicle.targetZ = 1;

    const { vehicle: blocker } = purchaseVehicle(state.vehicles, 'drill_rig', 2, 1);
    blocker.task = 'idle';
    blocker.state = 'idle';

    const emitter = new EventEmitter();

    // Drive the wait past the threshold so isMoveStuck is genuinely set by
    // the new occupancy-escalation trigger (not the old moveConsecutiveFailures
    // one — findPath never fails here, the corridor is topologically fine).
    for (let i = 0; i < 1 + VEHICLE_OCCUPANCY_REROUTE_THRESHOLD + 2; i++) {
      tickVehicle(state, vehicle, emitter);
    }
    expect(vehicle.isMoveStuck).toBe(true); // sanity: fixture actually reached stuck

    // Blocker drives off — cell (2,1) is free now.
    blocker.x = 99;
    blocker.z = 99;

    tickVehicle(state, vehicle, emitter);

    expect(vehicle.isMoveStuck).toBe(false);
    expect(vehicle.state).not.toBe('waiting');
    expect(vehicle.waitingTicks).toBe(0);
    expect(vehicle.x).toBe(2);
    expect(vehicle.z).toBe(1);
  });

  // #689: an idle, driverless vehicle parked exactly on ANOTHER vehicle's
  // target cell is the one obstacle no reroute can ever route around — the
  // destination itself is occupied, so every path (direct or detoured) is
  // blocked, and the pre-fix code escalated straight to permanently stuck.
  // Driving a vehicle was never actually licence-gated (only claiming its
  // role-specific task was — isLicensedForRole/findFreeVehicleForRole), so
  // the fix relocates an idle, unreserved blocker instead of giving up.

  it('relocates an idle, unreserved blocker parked on the target cell itself instead of escalating to stuck, and the vehicle then reaches its target (#689)', () => {
    const state = buildCorridorState();

    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', 0, 1);
    vehicle.task = 'moving';
    vehicle.state = 'moving';
    vehicle.targetX = 2;
    vehicle.targetZ = 1;

    const { vehicle: blocker } = purchaseVehicle(state.vehicles, 'drill_rig', 2, 1);
    blocker.task = 'idle';
    blocker.state = 'idle';

    const emitter = new EventEmitter();
    const stuckEvents: number[] = [];
    emitter.on('vehicle:stuck', ({ vehicleId }) => stuckEvents.push(vehicleId));

    const MAX_TICKS = VEHICLE_OCCUPANCY_REROUTE_THRESHOLD + 20;
    let ticks = 0;
    while (!(vehicle.x === 2 && vehicle.z === 1 && (vehicle.task as VehicleTask) === 'idle') && ticks < MAX_TICKS) {
      tickVehicle(state, vehicle, emitter);
      tickVehicle(state, blocker, emitter);
      ticks++;
    }

    expect(vehicle.x).toBe(2);
    expect(vehicle.z).toBe(1);
    expect(vehicle.task).toBe('idle');
    expect(vehicle.isMoveStuck).toBe(false);
    expect(stuckEvents).toEqual([]);

    // The blocker actually moved off the target cell — the vehicle did not
    // somehow reach it while still occupied.
    expect(blocker.x === 2 && blocker.z === 1).toBe(false);
  });

  it('does not relocate a blocker reserved for a pending action, and still escalates to stuck (#689 guard)', () => {
    const state = buildCorridorState();

    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', 0, 1);
    vehicle.task = 'moving';
    vehicle.state = 'moving';
    vehicle.targetX = 2;
    vehicle.targetZ = 1;

    // Idle but reserved for a pending action — a driver is about to claim it,
    // so it must not be shoved aside as if it were free to move.
    const { vehicle: blocker } = purchaseVehicle(state.vehicles, 'drill_rig', 2, 1);
    blocker.task = 'idle';
    blocker.state = 'idle';
    blocker.reservedForActionId = 1;

    const emitter = new EventEmitter();
    const stuckEvents: number[] = [];
    emitter.on('vehicle:stuck', ({ vehicleId }) => stuckEvents.push(vehicleId));

    for (let i = 0; i < 1 + VEHICLE_OCCUPANCY_REROUTE_THRESHOLD + 2; i++) {
      tickVehicle(state, vehicle, emitter);
    }

    expect(vehicle.isMoveStuck).toBe(true);
    expect(stuckEvents).toEqual([vehicle.id]);
    expect(blocker.x).toBe(2); // never relocated
    expect(blocker.z).toBe(1);
  });
});

// ── Task 2.8: Vehicle.waitingTicks tracking ──────────────────────────────────

describe('tickVehicle — waitingTicks (Task 2.8)', () => {
  it('increments waitingTicks by 1 on each tick the vehicle remains in waiting state', () => {
    const state = createGame({ seed: VEHICLE_TICK_SEED });
    const { vehicle: blocker } = purchaseVehicle(state.vehicles, 'rock_digger', 0, 0);
    const { vehicle: waiting } = purchaseVehicle(state.vehicles, 'debris_hauler', 2, 0);

    // Both vehicles head for the same cell (1, 0)
    blocker.task = 'moving'; blocker.state = 'moving';
    blocker.targetX = 1;     blocker.targetZ = 0;

    waiting.task = 'moving'; waiting.state = 'moving';
    waiting.targetX = 1;     waiting.targetZ = 0;

    // Tick 1 — blocker arrives at (1,0); debris_hauler is blocked → waiting
    tickVehicle(state, blocker);
    tickVehicle(state, waiting);
    expect(waiting.state).toBe('waiting');
    expect(waiting.waitingTicks).toBe(1);

    // Tick 2 — blocker is idle at (1,0), still blocking; waitingTicks → 2
    tickVehicle(state, blocker); // no-op (task = 'idle')
    tickVehicle(state, waiting);
    expect(waiting.waitingTicks).toBe(2);

    // Tick 3 — same situation; waitingTicks → 3
    tickVehicle(state, blocker);
    tickVehicle(state, waiting);
    expect(waiting.waitingTicks).toBe(3);
  });

  it('resets waitingTicks to 0 when the vehicle transitions from waiting to moving', () => {
    const state = createGame({ seed: VEHICLE_TICK_SEED });
    const { vehicle: blocker } = purchaseVehicle(state.vehicles, 'rock_digger', 0, 0);
    const { vehicle: waiting } = purchaseVehicle(state.vehicles, 'debris_hauler', 2, 0);

    blocker.task = 'moving'; blocker.state = 'moving';
    blocker.targetX = 1;     blocker.targetZ = 0;

    waiting.task = 'moving'; waiting.state = 'moving';
    waiting.targetX = 1;     waiting.targetZ = 0;

    // Build up waitingTicks
    tickVehicle(state, blocker);
    tickVehicle(state, waiting);
    expect(waiting.state).toBe('waiting');
    expect(waiting.waitingTicks).toBe(1);

    tickVehicle(state, blocker); // no-op
    tickVehicle(state, waiting);
    expect(waiting.waitingTicks).toBe(2);

    // Teleport the blocker away so cell (1,0) is free
    blocker.x = 99;
    blocker.z = 99;

    // Next tickVehicle — waiting vehicle finally moves; waitingTicks must reset
    tickVehicle(state, waiting);
    expect(waiting.state).not.toBe('waiting');
    expect(waiting.waitingTicks).toBe(0);
  });

  it('resets waitingTicks to 0 when the vehicle reaches its target and becomes idle', () => {
    const state = createGame({ seed: VEHICLE_TICK_SEED });
    const { vehicle: v } = purchaseVehicle(state.vehicles, 'debris_hauler', 0, 0);

    // Manually prime waitingTicks to a non-zero value (simulates prior waiting)
    v.waitingTicks = 5;

    // Vehicle moves straight to its target — no blocking
    v.task = 'moving'; v.state = 'moving';
    v.targetX = 1;     v.targetZ = 0;

    tickVehicle(state, v);

    // Vehicle reached target → idle; waitingTicks must be 0
    expect(v.state).toBe('idle');
    expect(v.waitingTicks).toBe(0);
  });
});

// ── tickVehicleTaskState (issue #411) ────────────────────────────────────────
// VehicleOperationalState.working was never assigned anywhere prior to this —
// vehicle-task-states-visual's working-state screenshot was unreachable.
// tickVehicleTaskState is the pure per-vehicle transform; tick-loop wiring is
// covered separately in tests/integration/vehicles.integration.test.ts.

describe('tickVehicleTaskState (#411)', () => {
  const WORK_TASKS = ['transport', 'loading', 'drilling', 'clearing'] as const;

  it.each(WORK_TASKS)('sets state to working when task is %s', (task) => {
    const state = createGame({ seed: VEHICLE_TICK_SEED });
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 0, 0);
    vehicle.task = task;
    vehicle.state = 'idle';

    tickVehicleTaskState(vehicle);

    expect(vehicle.state).toBe('working');
  });

  it('returns state to idle when task returns to idle', () => {
    const state = createGame({ seed: VEHICLE_TICK_SEED });
    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', 0, 0);
    vehicle.task = 'loading';
    vehicle.state = 'working';

    vehicle.task = 'idle';
    tickVehicleTaskState(vehicle);

    expect(vehicle.state).toBe('idle');
  });

  it('is idempotent — calling repeatedly with the same work task keeps state working', () => {
    const state = createGame({ seed: VEHICLE_TICK_SEED });
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);
    vehicle.task = 'drilling';
    vehicle.state = 'idle';

    tickVehicleTaskState(vehicle);
    tickVehicleTaskState(vehicle);
    tickVehicleTaskState(vehicle);

    expect(vehicle.state).toBe('working');
  });

  it('does not touch state when task is moving — tickVehicle owns moving/waiting transitions', () => {
    const state = createGame({ seed: VEHICLE_TICK_SEED });
    const { vehicle } = purchaseVehicle(state.vehicles, 'building_destroyer', 0, 0);
    vehicle.task = 'moving';
    vehicle.state = 'moving';

    tickVehicleTaskState(vehicle);

    expect(vehicle.state).toBe('moving');
  });

  it('does not touch a waiting state when task is moving', () => {
    const state = createGame({ seed: VEHICLE_TICK_SEED });
    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_fragmenter', 0, 0);
    vehicle.task = 'moving';
    vehicle.state = 'waiting';

    tickVehicleTaskState(vehicle);

    expect(vehicle.state).toBe('waiting');
  });
});

// ── syncDriverPosition (issue #922) ──────────────────────────────────────────
// While `vehicle.driverId === employee.id`, the employee is logically inside
// the vehicle — no mesh drawn for them (EntitySync.test.ts), and their x/z
// tracks the vehicle's continuously, tick by tick, not just at dismount.
// Before this fix, a driven employee's x/z stayed frozen at the boarding
// cell for the entire drive (only the dismount snap in
// VehicleReservation.releaseVehicleReservation ever updated it) — the driver
// mesh appeared parked at the boarding cell while the vehicle drove off.

describe('syncDriverPosition (#922)', () => {
  it('is a no-op when the vehicle has no driver', () => {
    const state = createGame({ seed: VEHICLE_TICK_SEED });
    const rng = new Random(VEHICLE_TICK_SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 3, 4);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 9, 9);
    vehicle.driverId = null;

    syncDriverPosition(state, vehicle);

    expect(employee.x).toBe(3);
    expect(employee.z).toBe(4);
  });

  it("sets the driver employee's x/z to the vehicle's x/z", () => {
    const state = createGame({ seed: VEHICLE_TICK_SEED });
    const rng = new Random(VEHICLE_TICK_SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 7, 3);
    vehicle.driverId = employee.id;

    syncDriverPosition(state, vehicle);

    expect(employee.x).toBe(7);
    expect(employee.z).toBe(3);
  });

  it('tracks the vehicle continuously across repeated calls as it advances, not just once', () => {
    const state = createGame({ seed: VEHICLE_TICK_SEED });
    const rng = new Random(VEHICLE_TICK_SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);
    vehicle.driverId = employee.id;

    syncDriverPosition(state, vehicle);
    expect(employee.x).toBe(0);
    expect(employee.z).toBe(0);

    vehicle.x = 4;
    vehicle.z = 1;
    syncDriverPosition(state, vehicle);
    expect(employee.x).toBe(4);
    expect(employee.z).toBe(1);

    vehicle.x = 9;
    vehicle.z = 6;
    syncDriverPosition(state, vehicle);
    expect(employee.x).toBe(9);
    expect(employee.z).toBe(6);
  });

  it('never touches an employee who is not this vehicle\'s driver (boundary: another employee exists)', () => {
    const state = createGame({ seed: VEHICLE_TICK_SEED });
    const rng = new Random(VEHICLE_TICK_SEED);
    const { employee: driver } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    const { employee: bystander } = hireEmployee(state.employees, 'surveyor', new Random(VEHICLE_TICK_SEED + 1), 5, 5);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 12, 12);
    vehicle.driverId = driver.id;

    syncDriverPosition(state, vehicle);

    expect(driver.x).toBe(12);
    expect(driver.z).toBe(12);
    expect(bystander.x).toBe(5);
    expect(bystander.z).toBe(5);
  });

  it('is a no-op (never throws) when driverId names an employee that no longer exists (boundary: dangling id)', () => {
    const state = createGame({ seed: VEHICLE_TICK_SEED });
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 8, 8);
    vehicle.driverId = 999999;

    expect(() => syncDriverPosition(state, vehicle)).not.toThrow();
  });
});

// ── tickVehicle wires syncDriverPosition in on every tick (issue #922) ──────
// tickVehicle is the sole place a reserved vehicle's x/z is ever advanced
// (EntityMovementTick.ts's own header comment) — syncDriverPosition must run
// at the end of every tickVehicle call so a driver's logical position never
// lags behind the vehicle mid-drive.

describe('tickVehicle — keeps a driver glued to the vehicle every tick (#922)', () => {
  it('updates the driver x/z on every tick as a direct-line vehicle (no NavGrid) advances toward its target', () => {
    const state = createGame({ seed: VEHICLE_TICK_SEED });
    const rng = new Random(VEHICLE_TICK_SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', 0, 0);
    vehicle.driverId = employee.id;
    vehicle.task = 'moving';
    vehicle.state = 'moving';
    vehicle.targetX = 3;
    vehicle.targetZ = 0;

    for (let i = 0; i < 3; i++) {
      tickVehicle(state, vehicle);
      expect(employee.x).toBe(vehicle.x);
      expect(employee.z).toBe(vehicle.z);
    }

    expect(vehicle.x).toBe(3);
    // Reached the target — the driver must have moved off the original (0,0)
    // boarding cell along with the vehicle, not stayed pinned there.
    expect(employee.x).not.toBe(0);
  });

  it('leaves a driverless vehicle\'s tick with no effect on any employee (boundary: driverId null)', () => {
    const state = createGame({ seed: VEHICLE_TICK_SEED });
    const rng = new Random(VEHICLE_TICK_SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 20, 20);
    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', 0, 0);
    vehicle.driverId = null;
    vehicle.task = 'moving';
    vehicle.state = 'moving';
    vehicle.targetX = 3;
    vehicle.targetZ = 0;

    tickVehicle(state, vehicle);

    expect(employee.x).toBe(20);
    expect(employee.z).toBe(20);
  });

  it('does not clobber an on-foot employee\'s own movement when they still hold a stale driverId on a parked (non-moving) vehicle', () => {
    // Regression shape for #922: vehicle.task !== 'moving' (parked/idle) but
    // vehicle.driverId is still set to an employee who is independently
    // walking toward their own destinationX/Z (nothing clears driverId when
    // a driver is dispatched to an unrelated on-foot task — see
    // ActionSelection/EmployeeDispatch). Under the old unconditional-sync
    // behavior, syncDriverPosition ran every tick regardless of whether the
    // vehicle actually drove, snapping the employee's x/z back to the
    // stationary vehicle's position and cancelling out tickEmployeeMovement's
    // own advance before it ever accumulated. Ticks vehicle then employee
    // movement in the same order the real game loop does (tick.ts 8f then 8g).
    const state = createGame({ seed: VEHICLE_TICK_SEED });
    const rng = new Random(VEHICLE_TICK_SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', 0, 0);
    vehicle.driverId = employee.id;
    vehicle.task = 'idle';
    vehicle.state = 'idle';
    vehicle.targetX = vehicle.x;
    vehicle.targetZ = vehicle.z;

    // Far enough that 3 ticks at AGENT_WALK_SPEED never reach it — accumulated
    // progress (not a single step re-taken from x=0 each tick) is what this
    // test needs to observe.
    employee.destinationX = 20;
    employee.destinationZ = 0;

    for (let i = 0; i < 3; i++) {
      tickVehicle(state, vehicle);
      tickEmployeeMovement(state);
    }

    // Vehicle never moved (parked, task !== 'moving').
    expect(vehicle.x).toBe(0);
    expect(vehicle.z).toBe(0);
    // 3 ticks of accumulated walking, not 1 tick's worth re-taken from x=0
    // every time (the old bug: syncDriverPosition ran unconditionally and
    // reset the employee back to the parked vehicle's x=0 before each tick's
    // walk step, so x would plateau at AGENT_WALK_SPEED instead of growing).
    expect(employee.x).toBe(3 * AGENT_WALK_SPEED);
    expect(employee.x).not.toBe(vehicle.x);
  });
});

// ── tickEmployeeMovement (issue #407) ────────────────────────────────────────

describe('tickEmployeeMovement', () => {
  const SEED = 42;

  /** Solid rock voxel used to build small hand-crafted NavGrids below. */
  function solidVoxel() {
    return { composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] }, density: 1.0, oreDensities: {}, fractureModifier: 1.0 };
  }

  it('is a no-op for an employee with no destination set', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.x = 5;
    employee.z = 7;
    employee.destinationX = null;
    employee.destinationZ = null;

    const result = tickEmployeeMovement(state);

    expect(employee.x).toBe(5);
    expect(employee.z).toBe(7);
    expect(employee.destinationX).toBeNull();
    expect(employee.destinationZ).toBeNull();
    expect(result).toEqual({ moved: [], arrived: [], stuck: [] });
  });

  it('falls back to a direct line toward the destination when no NavGrid has been built yet, without crashing', () => {
    const state = createGame({ seed: SEED });
    expect(state.navGrid).toBeNull();
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.x = 0;
    employee.z = 0;
    employee.destinationX = 10;
    employee.destinationZ = 0;

    let result;
    expect(() => { result = tickEmployeeMovement(state); }).not.toThrow();

    // AGENT_WALK_SPEED cells covered this tick, straight toward (10, 0) — not yet arrived.
    expect(employee.x).toBeCloseTo(AGENT_WALK_SPEED, 5);
    expect(employee.z).toBe(0);
    expect(employee.destinationX).toBe(10);
    expect(result!.moved).toEqual([employee.id]);
    expect(result!.arrived).toEqual([]);
  });

  it('reaches its destination in one tick when already within walking speed — position exact, destination cleared', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.x = 0;
    employee.z = 0;
    employee.destinationX = 1; // 1 cell away, well within AGENT_WALK_SPEED
    employee.destinationZ = 0;

    const result = tickEmployeeMovement(state);

    expect(employee.x).toBe(1);
    expect(employee.z).toBe(0);
    expect(employee.destinationX).toBeNull();
    expect(employee.destinationZ).toBeNull();
    expect(result.arrived).toEqual([employee.id]);
  });

  it('crosses STUCK_THRESHOLD when no path exists: emits agent:stuck once, sets isMoveStuck, applies the morale penalty', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng);

    // A 5×5×5 NavGrid with rock only under (0,0) — every other column stays
    // void (density 0 everywhere), so a destination there is impassable and
    // findPath returns found:false on every tick, forever.
    const vg = new VoxelGrid(5, 5, 5);
    vg.setVoxel(0, 0, 0, solidVoxel());
    vg.setVoxel(0, 1, 0, solidVoxel());
    state.navGrid = NavGrid.buildNavGrid(vg, [], []);

    employee.x = 0;
    employee.z = 0;
    employee.destinationX = 3;
    employee.destinationZ = 3; // void column — unreachable
    employee.morale = 60;

    const emitter = new EventEmitter();
    const stuckEvents: number[] = [];
    emitter.on('agent:stuck', ({ employeeId }) => stuckEvents.push(employeeId));

    let result;
    for (let i = 0; i < STUCK_THRESHOLD; i++) {
      result = tickEmployeeMovement(state, emitter);
    }

    expect(employee.isMoveStuck).toBe(true);
    expect(employee.moveConsecutiveFailures).toBe(STUCK_THRESHOLD);
    expect(stuckEvents).toEqual([employee.id]); // fired exactly once, on the crossing tick
    expect(result!.stuck).toEqual([employee.id]);
    expect(employee.x).toBe(0); // never moved — no path ever resolved
    expect(employee.z).toBe(0);
    expect(employee.morale).toBe(60 - STUCK_MORALE_PENALTY);
  });
});
