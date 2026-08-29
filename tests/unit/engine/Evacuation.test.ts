// BlastSimulator2026 — Tests for findSafeEvacuationCell / evacuateZone
// (src/core/engine/Evacuation.ts, #557).

import { describe, it, expect } from 'vitest';
import { createGame } from '../../../src/core/state/GameState.js';
import { NavGrid } from '../../../src/core/nav/NavGrid.js';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import { findSafeEvacuationCell, evacuateZone } from '../../../src/core/engine/Evacuation.js';
import { isInZone, type ZoneBounds } from '../../../src/core/entities/Zone.js';
import { hireEmployee } from '../../../src/core/entities/Employee.js';
import { purchaseVehicle } from '../../../src/core/entities/Vehicle.js';
import { Random } from '../../../src/core/math/Random.js';
import { EVACUATION_CLEARANCE_M } from '../../../src/core/config/balance.js';

const EVACUATION_SEED = 42;

/** A flat, fully solid, fully walkable size×1×size NavGrid — every column passable. */
function flatWalkableGrid(size: number): NavGrid {
  const vg = new VoxelGrid(size, 1, size);
  for (let x = 0; x < size; x++) {
    for (let z = 0; z < size; z++) {
      vg.setVoxel(x, 0, z, {
        composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
        density: 1.0,
        oreDensities: {},
        fractureModifier: 1.0,
      });
    }
  }
  return NavGrid.buildNavGrid(vg, [], []);
}

describe('findSafeEvacuationCell', () => {
  it('finds a navigable cell clear of the zone by EVACUATION_CLEARANCE_M, reachable from inside it', () => {
    const state = createGame({ seed: EVACUATION_SEED });
    state.navGrid = flatWalkableGrid(40);
    const zone: ZoneBounds = { x1: 10, z1: 10, x2: 20, z2: 20 };

    const dest = findSafeEvacuationCell(state, 15, 15, zone);

    expect(dest).not.toBeNull();
    // Not merely outside the zone box — clear of it by the full clearance margin.
    const clearedZone: ZoneBounds = {
      x1: zone.x1 - EVACUATION_CLEARANCE_M, z1: zone.z1 - EVACUATION_CLEARANCE_M,
      x2: zone.x2 + EVACUATION_CLEARANCE_M, z2: zone.z2 + EVACUATION_CLEARANCE_M,
    };
    expect(isInZone(dest!.x, dest!.z, clearedZone)).toBe(false);
    // Within the grid the entity can actually be routed across.
    expect(state.navGrid!.containsCell(dest!.x, dest!.z)).toBe(true);
  });

  it('starting exactly on the zone boundary still finds a cell clear of it', () => {
    const state = createGame({ seed: EVACUATION_SEED });
    state.navGrid = flatWalkableGrid(40);
    const zone: ZoneBounds = { x1: 10, z1: 10, x2: 20, z2: 20 };

    const dest = findSafeEvacuationCell(state, zone.x1, zone.z1, zone);

    expect(dest).not.toBeNull();
    expect(isInZone(dest!.x, dest!.z, zone)).toBe(false);
  });

  it('returns null when no cell in the grid can clear the zone by the required margin', () => {
    const state = createGame({ seed: EVACUATION_SEED });
    // A grid barely bigger than the zone itself, padded by less than the
    // clearance margin on every side — nowhere in the covered box can
    // satisfy EVACUATION_CLEARANCE_M.
    state.navGrid = flatWalkableGrid(22);
    const zone: ZoneBounds = { x1: -100, z1: -100, x2: 100, z2: 100 };

    expect(findSafeEvacuationCell(state, 10, 10, zone)).toBeNull();
  });

  it('returns null with no NavGrid to route across', () => {
    const state = createGame({ seed: EVACUATION_SEED });
    state.navGrid = null;
    const zone: ZoneBounds = { x1: 10, z1: 10, x2: 20, z2: 20 };

    expect(findSafeEvacuationCell(state, 15, 15, zone)).toBeNull();
  });
});

describe('evacuateZone', () => {
  it('orders every employee and vehicle inside the zone to a safe destination, without teleporting them', () => {
    const state = createGame({ seed: EVACUATION_SEED });
    state.navGrid = flatWalkableGrid(40);
    const zone: ZoneBounds = { x1: 10, z1: 10, x2: 20, z2: 20 };

    const rng = new Random(EVACUATION_SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 15, 15);
    hireEmployee(state.employees, 'driller', rng, 35, 35); // outside the zone
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 12, 12);

    const beforeEmployeeX = employee.x;
    const beforeVehicleX = vehicle.x;

    const result = evacuateZone(state, zone);

    // Not teleported: same-call positions are unchanged.
    expect(employee.x).toBe(beforeEmployeeX);
    expect(vehicle.x).toBe(beforeVehicleX);

    // Routed out instead.
    expect(employee.destinationX).not.toBeNull();
    expect(isInZone(employee.destinationX!, employee.destinationZ!, zone)).toBe(false);
    expect(vehicle.task).toBe('moving');
    expect(isInZone(vehicle.targetX, vehicle.targetZ, zone)).toBe(false);

    expect(result.orderedEmployeeIds).toContain(employee.id);
    expect(result.orderedVehicleIds).toContain(vehicle.id);
    expect(result.strandedEmployeeIds).toEqual([]);
    expect(result.strandedVehicleIds).toEqual([]);
  });

  it('leaves entities already outside the zone alone', () => {
    const state = createGame({ seed: EVACUATION_SEED });
    state.navGrid = flatWalkableGrid(40);
    const zone: ZoneBounds = { x1: 10, z1: 10, x2: 20, z2: 20 };

    const rng = new Random(EVACUATION_SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 35, 35);

    const result = evacuateZone(state, zone);

    expect(result.orderedEmployeeIds).not.toContain(employee.id);
    expect(employee.destinationX).toBeNull();
  });

  it('an empty zone evacuates nothing', () => {
    const state = createGame({ seed: EVACUATION_SEED });
    state.navGrid = flatWalkableGrid(40);
    const zone: ZoneBounds = { x1: 10, z1: 10, x2: 20, z2: 20 };

    const result = evacuateZone(state, zone);

    expect(result.orderedEmployeeIds).toEqual([]);
    expect(result.orderedVehicleIds).toEqual([]);
    expect(result.strandedEmployeeIds).toEqual([]);
    expect(result.strandedVehicleIds).toEqual([]);
  });

  it('strands an entity no safe cell can be found for, and leaves it exactly where it stands', () => {
    const state = createGame({ seed: EVACUATION_SEED });
    // Grid too small for anywhere to clear the (much larger) zone.
    state.navGrid = flatWalkableGrid(22);
    const zone: ZoneBounds = { x1: -100, z1: -100, x2: 100, z2: 100 };

    const rng = new Random(EVACUATION_SEED);
    const { employee } = hireEmployee(state.employees, 'driller', rng, 10, 10);
    const beforeX = employee.x;
    const beforeZ = employee.z;

    const result = evacuateZone(state, zone);

    expect(employee.x).toBe(beforeX);
    expect(employee.z).toBe(beforeZ);
    expect(employee.destinationX).toBeNull();
    expect(result.strandedEmployeeIds).toContain(employee.id);
    expect(result.orderedEmployeeIds).not.toContain(employee.id);
  });
});
