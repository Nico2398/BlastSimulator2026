// BlastSimulator2026 — Unit tests: climb labellings kept per nav grid revision (#1603, #2091)

import { describe, it, expect } from 'vitest';
import { createGame } from '../../../src/core/state/GameState.js';
import { NavGrid, type NavCell } from '../../../src/core/nav/NavGrid.js';
import { cacheFor, componentsOf, vehicleReachesCell } from '../../../src/core/engine/ReachCache.js';
import { NAV_CLEARANCE_VEHICLE_CELLS } from '../../../src/core/config/balance.js';

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

  it('is true with no nav grid: nothing to weigh', () => {
    expect(vehicleReachesCell(createGame({ seed: 42 }), { x: 3, z: 5 }, 18, 6)).toBe(true);
  });
});
