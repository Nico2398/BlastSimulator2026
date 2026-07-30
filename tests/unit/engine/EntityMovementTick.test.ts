// BlastSimulator2026 — Tests for vehicle and employee per-tick movement
// (tickVehicle, tickEmployeeMovement). Split out of GameLoop.test.ts (#407
// refactor) alongside the EntityMovementTick.ts module extraction — these
// describe blocks are self-contained and exercise nothing else in GameLoop.ts.

import { describe, it, expect } from 'vitest';
import { createGame } from '../../../src/core/state/GameState.js';
import { Random } from '../../../src/core/math/Random.js';
import { tickVehicle, tickEmployeeMovement } from '../../../src/core/engine/EntityMovementTick.js';
import { hireEmployee } from '../../../src/core/entities/Employee.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { purchaseVehicle } from '../../../src/core/entities/Vehicle.js';
import { NavGrid } from '../../../src/core/nav/NavGrid.js';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import { AGENT_WALK_SPEED, STUCK_THRESHOLD, STUCK_MORALE_PENALTY } from '../../../src/core/config/balance.js';

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
