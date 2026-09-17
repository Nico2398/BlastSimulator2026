// BlastSimulator2026 — Tests for the display-only helpers that remain in
// EntityMovementTick.ts once #1089 (mount/itinerary rebuild phase 3b) moves
// every position-writing mover onto Locomotion.ts.
//
// tickVehicle, tickVehicleMovement, tickVehicleDirectLine, tickVehicleOnNavGrid,
// nextGridStep, markVehicleWaiting, canTickVehicle, setVehicleIdle,
// isCellOccupiedByOtherVehicle, syncDriverPosition, and tickEmployeeMovement
// are all deleted from this file by the implementer phase — their coverage
// moved to tests/unit/engine/Locomotion.test.ts. What's left here is a pure
// occupancy query (isDestinationOccupied) and the occupancy-cache write
// (updateVehicleCellOccupancy), neither of which owns a position.
//
// #1138: tickVehicleTaskState (the VehicleTask -> VehicleOperationalState
// display mapping) is deleted along with Vehicle.task/.state themselves —
// vehicle display state is fully derived now (VehicleStatus.computeVehicleStatus,
// see that file's own test suite). updateVehicleCellOccupancy gained an
// explicit `isStationaryNow` parameter in the same change (it used to read
// `vehicle.state !== 'moving'` itself) — covered fresh below since it had no
// dedicated unit coverage before this file's own tickVehicleTaskState block
// crowded it out.

import { describe, it, expect } from 'vitest';
import { createGame } from '../../../src/core/state/GameState.js';
import type { GameState } from '../../../src/core/state/GameState.js';
import { isDestinationOccupied, updateVehicleCellOccupancy } from '../../../src/core/engine/EntityMovementTick.js';
import { purchaseVehicle } from '../../../src/core/entities/Vehicle.js';
import { NavGrid } from '../../../src/core/nav/NavGrid.js';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';

const VEHICLE_TICK_SEED = 42;

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

// ── updateVehicleCellOccupancy (#954, isStationaryNow param added #1138) ───

describe('updateVehicleCellOccupancy', () => {
  function buildFlatNavGridState(): GameState {
    const state = createGame({ seed: VEHICLE_TICK_SEED });
    const vg = new VoxelGrid(5, 5, 5);
    for (let x = 0; x < 5; x++) {
      for (let z = 0; z < 5; z++) {
        vg.setVoxel(x, 0, z, { composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] }, density: 1.0, oreDensities: {}, fractureModifier: 1.0 });
      }
    }
    state.navGrid = NavGrid.buildNavGrid(vg, [], []);
    return state;
  }

  it('marks the new cell occupied when isStationaryNow is true', () => {
    const state = buildFlatNavGridState();
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 2, 2);

    updateVehicleCellOccupancy(state, vehicle, true, true, 2, 2);

    expect(state.navGrid!.cellAt(2, 2)!.vehicleOccupied).toBe(true);
  });

  it('clears the previous cell when the vehicle stops being stationary (wasStationary && !isStationaryNow)', () => {
    const state = buildFlatNavGridState();
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 2, 2);
    state.navGrid!.cellAt(2, 2)!.vehicleOccupied = true;
    vehicle.x = 3; vehicle.z = 2;

    updateVehicleCellOccupancy(state, vehicle, true, false, 2, 2);

    expect(state.navGrid!.cellAt(2, 2)!.vehicleOccupied).toBe(false);
  });

  it('clears the previous cell when the vehicle moved to a new cell, regardless of the stationary flags', () => {
    const state = buildFlatNavGridState();
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 2, 2);
    state.navGrid!.cellAt(2, 2)!.vehicleOccupied = true;
    vehicle.x = 3; vehicle.z = 2;

    updateVehicleCellOccupancy(state, vehicle, false, false, 2, 2);

    expect(state.navGrid!.cellAt(2, 2)!.vehicleOccupied).toBe(false);
  });

  it('leaves the previous cell alone when the vehicle stayed put and was already moving (wasStationary=false, isStationaryNow=false, no cell change)', () => {
    const state = buildFlatNavGridState();
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 2, 2);
    state.navGrid!.cellAt(2, 2)!.vehicleOccupied = true;

    updateVehicleCellOccupancy(state, vehicle, false, false, 2, 2);

    // Not cleared: no cell change and no was-stationary-to-moving transition.
    expect(state.navGrid!.cellAt(2, 2)!.vehicleOccupied).toBe(true);
  });

  it('is a no-op that does not throw when state.navGrid is null', () => {
    const state = createGame({ seed: VEHICLE_TICK_SEED });
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 2, 2);
    expect(state.navGrid).toBeNull();

    expect(() => updateVehicleCellOccupancy(state, vehicle, true, true, 2, 2)).not.toThrow();
  });
});
