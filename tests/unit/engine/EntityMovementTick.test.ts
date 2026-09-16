// BlastSimulator2026 — Tests for the display-only helpers that remain in
// EntityMovementTick.ts once #1089 (mount/itinerary rebuild phase 3b) moves
// every position-writing mover onto Locomotion.ts.
//
// tickVehicle, tickVehicleMovement, tickVehicleDirectLine, tickVehicleOnNavGrid,
// nextGridStep, markVehicleWaiting, canTickVehicle, setVehicleIdle,
// isCellOccupiedByOtherVehicle, syncDriverPosition, and tickEmployeeMovement
// are all deleted from this file by the implementer phase — their coverage
// moved to tests/unit/engine/Locomotion.test.ts. What's left here is a pure
// display mapping (tickVehicleTaskState) and a pure occupancy query
// (isDestinationOccupied), neither of which writes a position.

import { describe, it, expect } from 'vitest';
import { createGame } from '../../../src/core/state/GameState.js';
import type { GameState } from '../../../src/core/state/GameState.js';
import { tickVehicleTaskState, isDestinationOccupied } from '../../../src/core/engine/EntityMovementTick.js';
import { purchaseVehicle } from '../../../src/core/entities/Vehicle.js';
import { NavGrid } from '../../../src/core/nav/NavGrid.js';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';

const VEHICLE_TICK_SEED = 42;

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

  it('does not touch state when task is moving — tickLocomotion owns moving/waiting transitions', () => {
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

// ── isDestinationOccupied (#954 follow-up fix) ──────────────────────────────
// Exported so ActionSelection.ts's resolveActionCost can apply the exact same
// occupied-destination exemption tickEmployeeMovement's own avoidVehicles
// rule already uses — see that call site's own doc comment.

describe('isDestinationOccupied (#954 follow-up fix)', () => {
  const SEED = 42;

  function buildFlatNavGridState(): GameState {
    const state = createGame({ seed: SEED });
    const vg = new VoxelGrid(5, 5, 5);
    for (let x = 0; x < 5; x++) {
      for (let z = 0; z < 5; z++) {
        vg.setVoxel(x, 0, z, { composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] }, density: 1.0, oreDensities: {}, fractureModifier: 1.0 });
      }
    }
    state.navGrid = NavGrid.buildNavGrid(vg, [], []);
    return state;
  }

  it('is false for an ordinary unoccupied walkable cell (happy path)', () => {
    const state = buildFlatNavGridState();
    expect(isDestinationOccupied(state, 2, 2)).toBe(false);
  });

  it('is true for a cell marked vehicleOccupied', () => {
    const state = buildFlatNavGridState();
    const cell = state.navGrid!.cellAt(2, 2)!;
    cell.vehicleOccupied = true;
    expect(isDestinationOccupied(state, 2, 2)).toBe(true);
  });

  it('is true for a cell carrying fragmentOccupancy > 0 (#954)', () => {
    const state = buildFlatNavGridState();
    state.navGrid!.addFragmentOccupant(2, 2);
    expect(isDestinationOccupied(state, 2, 2)).toBe(true);
  });

  it('is false with no NavGrid built yet, or for a cell outside the grid (rejection/boundary)', () => {
    const state = createGame({ seed: SEED });
    expect(state.navGrid).toBeNull();
    expect(isDestinationOccupied(state, 2, 2)).toBe(false);

    const withGrid = buildFlatNavGridState();
    expect(isDestinationOccupied(withGrid, 999, 999)).toBe(false);
  });
});
