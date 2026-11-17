// BlastSimulator2026 — Unit tests: climb labellings kept per nav grid revision (#1603, #2091)

import { describe, it, expect } from 'vitest';
import { createGame, isProgressionSite } from '../../../src/core/state/GameState.js';
import { vehicleMaxSlopeRatio, purchaseVehicle, type Vehicle } from '../../../src/core/entities/Vehicle.js';
import { createGradeState } from '../../../src/core/economy/MineGrade.js';
import { NavGrid, type NavCell } from '../../../src/core/nav/NavGrid.js';
import { cacheFor, componentsOf, vehicleReachesCell } from '../../../src/core/engine/ReachCache.js';
import { NAV_CLEARANCE_VEHICLE_CELLS, TRAVEL_VEHICLE_MAX_SLOPE_RATIO, VEHICLE_MAX_SLOPE_RATIO } from '../../../src/core/config/balance.js';

/** 24 x 12 open ground walled at x = 10. */
function walledGrid(): NavGrid {
  const cells: NavCell[][] = [];
  for (let z = 0; z < 12; z++) {
    const row: NavCell[] = [];
    for (let x = 0; x < 24; x++) {
      const blocked = x === 10;
      row.push({ type: blocked ? 'blocked' : 'walkable', moveCost: blocked ? Infinity : 1, benchLevel: 0, vehicleOccupied: false });
    }
    cells.push(row);
  }
  return new NavGrid(24, 12, cells);
}

describe('cacheFor / componentsOf', () => {
  it('is null with no nav grid', () => {
    expect(cacheFor(createGame({ seed: 42 }))).toBeNull();
  });

  it('keeps one labelling per clearance until the nav grid revision moves', () => {
    const state = createGame({ seed: 42 });
    state.navGrid = walledGrid();
    const cache = cacheFor(state)!;
    const first = componentsOf(cache, NAV_CLEARANCE_VEHICLE_CELLS);
    expect(componentsOf(cacheFor(state)!, NAV_CLEARANCE_VEHICLE_CELLS)).toBe(first);
    state.navGrid.bumpRevision();
    expect(componentsOf(cacheFor(state)!, NAV_CLEARANCE_VEHICLE_CELLS)).not.toBe(first);
  });
});

describe('vehicleReachesCell (#2091)', () => {
  it("is true on the vehicle's own side of a wall and false across it", () => {
    const state = createGame({ seed: 42 });
    state.navGrid = walledGrid();
    expect(vehicleReachesCell(state, { x: 3, z: 5 }, 6, 6)).toBe(true);
    expect(vehicleReachesCell(state, { x: 3, z: 5 }, 18, 6)).toBe(false);
  });

  it('is false for a blocked target cell', () => {
    const state = createGame({ seed: 42 });
    state.navGrid = walledGrid();
    expect(vehicleReachesCell(state, { x: 3, z: 5 }, 10, 6)).toBe(false);
  });

  it('is false for a vehicle parked on a thin cell it cannot climb off, and true one step gentler', () => {
    // The thin ring at x = 9 beside the wall sits `rise` metres above the clear ground west of it.
    const ledge = (rise: number): NavGrid => {
      const cells: NavCell[][] = [];
      for (let z = 0; z < 12; z++) {
        const row: NavCell[] = [];
        for (let x = 0; x < 24; x++) {
          const blocked = x === 10;
          row.push({
            type: blocked ? 'blocked' : 'walkable', moveCost: blocked ? Infinity : 1, benchLevel: 0, vehicleOccupied: false,
            clearance: blocked ? 0 : x === 9 ? 1 : 2, surfaceY: x === 9 ? rise : 0,
          });
        }
        cells.push(row);
      }
      return new NavGrid(24, 12, cells);
    };
    const state = createGame({ seed: 42 });
    const limit = vehicleMaxSlopeRatio(isProgressionSite(state));
    // Too steep straight off and diagonally off (a diagonal step's run is longer).
    state.navGrid = ledge((limit + 0.015) * Math.SQRT2);
    expect(vehicleReachesCell(state, { x: 9, z: 5 }, 3, 5)).toBe(false);
    state.navGrid = ledge(limit - 0.05);
    expect(vehicleReachesCell(state, { x: 9, z: 5 }, 3, 5)).toBe(true);
  });

  it('is true with no nav grid: nothing to weigh', () => {
    expect(vehicleReachesCell(createGame({ seed: 42 }), { x: 3, z: 5 }, 18, 6)).toBe(true);
  });
});

// ── One limit per vehicle role (#2288 C4, C5) ───────────────────────────────

/** 24 x 12 open ground, low west of x = 10 and `rise` metres higher from x = 10 east: every way east is one step of `rise`. */
function stepGrid(rise: number): NavGrid {
  const cells: NavCell[][] = [];
  for (let z = 0; z < 12; z++) {
    const row: NavCell[] = [];
    for (let x = 0; x < 24; x++) {
      row.push({ type: 'walkable', moveCost: 1, benchLevel: 0, vehicleOccupied: false, clearance: 2, surfaceY: x >= 10 ? rise : 0, climbY: x >= 10 ? rise : 0 });
    }
    cells.push(row);
  }
  return new NavGrid(24, 12, cells, rise);
}

function progressionState(rise: number) {
  const state = createGame({ seed: 42 });
  state.grade = createGradeState();
  state.navGrid = stepGrid(rise);
  return state;
}

const tanDeg = (d: number): number => Math.tan(d * Math.PI / 180);

describe('vehicleReachesCell: each vehicle by its own role limit (#2288 C5)', () => {
  it('a drill rig climbs a 14 degree step a shuttle cannot', () => {
    const state = progressionState(tanDeg(14));
    const rig = purchaseVehicle(state.vehicles, 'drill_rig', 3, 5).vehicle;
    const shuttle = purchaseVehicle(state.vehicles, 'travel_vehicle', 3, 5).vehicle;
    expect(vehicleReachesCell(state, rig, 18, 6)).toBe(true);
    expect(vehicleReachesCell(state, shuttle, 18, 6)).toBe(false);
  });

  it('both tiers of the travel vehicle are held to the low limit', () => {
    const state = progressionState(tanDeg(14));
    for (const tier of [1, 2] as const) {
      const shuttle = purchaseVehicle(state.vehicles, 'travel_vehicle', 3, 5, tier).vehicle;
      expect(vehicleReachesCell(state, shuttle, 18, 6)).toBe(false);
    }
  });

  it('a shuttle still reaches its own side of a step it cannot climb', () => {
    const state = progressionState(tanDeg(14));
    const shuttle = purchaseVehicle(state.vehicles, 'travel_vehicle', 3, 5).vehicle;
    expect(vehicleReachesCell(state, shuttle, 6, 6)).toBe(true);
  });

  it('every work role climbs the 14 degree step', () => {
    const state = progressionState(tanDeg(14));
    for (const role of ['drill_rig', 'rock_digger', 'rock_fragmenter', 'charging_truck', 'debris_hauler', 'building_destroyer'] as const) {
      const v = purchaseVehicle(state.vehicles, role, 3, 5).vehicle;
      expect(vehicleReachesCell(state, v, 18, 6), role).toBe(true);
    }
  });

  it('a step exactly at the travel limit is admitted to the shuttle', () => {
    const state = progressionState(TRAVEL_VEHICLE_MAX_SLOPE_RATIO);
    const shuttle = purchaseVehicle(state.vehicles, 'travel_vehicle', 3, 5).vehicle;
    expect(vehicleReachesCell(state, shuttle, 18, 6)).toBe(true);
  });

  it('a step just over the travel limit is refused to the shuttle and taken by a rig', () => {
    const state = progressionState(tanDeg(8.5));
    const shuttle = purchaseVehicle(state.vehicles, 'travel_vehicle', 3, 5).vehicle;
    const rig = purchaseVehicle(state.vehicles, 'drill_rig', 3, 5).vehicle;
    expect(vehicleReachesCell(state, shuttle, 18, 6)).toBe(false);
    expect(vehicleReachesCell(state, rig, 18, 6)).toBe(true);
  });

  it('a step at the work limit is taken by a rig and one over it by none', () => {
    const at = progressionState(VEHICLE_MAX_SLOPE_RATIO);
    expect(vehicleReachesCell(at, purchaseVehicle(at.vehicles, 'drill_rig', 3, 5).vehicle, 18, 6)).toBe(true);
    const over = progressionState(tanDeg(24));
    expect(vehicleReachesCell(over, purchaseVehicle(over.vehicles, 'drill_rig', 3, 5).vehicle, 18, 6)).toBe(false);
    expect(vehicleReachesCell(over, purchaseVehicle(over.vehicles, 'travel_vehicle', 3, 5).vehicle, 18, 6)).toBe(false);
  });

  it('off a progression site the shuttle shares the nav limit and climbs the 14 degree step', () => {
    const state = createGame({ seed: 42 });
    state.navGrid = stepGrid(tanDeg(14));
    expect(isProgressionSite(state)).toBe(false);
    const shuttle = purchaseVehicle(state.vehicles, 'travel_vehicle', 3, 5).vehicle;
    expect(vehicleReachesCell(state, shuttle, 18, 6)).toBe(true);
  });
});

describe('reach cache cost is bounded by distinct limits, not vehicles (#2288 C4)', () => {
  it('N shuttles and M drill rigs build at most two vehicle labellings', () => {
    const state = progressionState(tanDeg(14));
    const fleet: Vehicle[] = [];
    for (let i = 0; i < 5; i++) fleet.push(purchaseVehicle(state.vehicles, 'travel_vehicle', 1 + i, 2 + i).vehicle);
    for (let i = 0; i < 4; i++) fleet.push(purchaseVehicle(state.vehicles, 'drill_rig', 1 + i, 8 - i).vehicle);
    for (const v of fleet) vehicleReachesCell(state, v, 18, 6);
    const cache = cacheFor(state)!;
    expect(cache.components.size).toBeLessThanOrEqual(2);
    expect(cache.components.size).toBe(2);
  });

  it('only shuttles ask for one labelling', () => {
    const state = progressionState(tanDeg(14));
    for (let i = 0; i < 6; i++) vehicleReachesCell(state, purchaseVehicle(state.vehicles, 'travel_vehicle', 1 + i, 2).vehicle, 18, 6);
    expect(cacheFor(state)!.components.size).toBe(1);
  });

  it('asking again for the same fleet builds nothing new', () => {
    const state = progressionState(tanDeg(14));
    const rig = purchaseVehicle(state.vehicles, 'drill_rig', 3, 5).vehicle;
    const shuttle = purchaseVehicle(state.vehicles, 'travel_vehicle', 4, 5).vehicle;
    vehicleReachesCell(state, rig, 18, 6);
    vehicleReachesCell(state, shuttle, 18, 6);
    const before = cacheFor(state)!.components.size;
    for (let i = 0; i < 5; i++) { vehicleReachesCell(state, rig, 18, 6); vehicleReachesCell(state, shuttle, 18, 6); }
    expect(cacheFor(state)!.components.size).toBe(before);
  });

  it('the labelling kept for a limit is reused and differs from another limit', () => {
    const state = progressionState(tanDeg(14));
    const cache = cacheFor(state)!;
    const low = componentsOf(cache, NAV_CLEARANCE_VEHICLE_CELLS, TRAVEL_VEHICLE_MAX_SLOPE_RATIO);
    const high = componentsOf(cache, NAV_CLEARANCE_VEHICLE_CELLS, VEHICLE_MAX_SLOPE_RATIO);
    expect(low).not.toBe(high);
    expect(componentsOf(cache, NAV_CLEARANCE_VEHICLE_CELLS, TRAVEL_VEHICLE_MAX_SLOPE_RATIO)).toBe(low);
    expect(cache.components.size).toBe(2);
  });
});
