// BlastSimulator2026 — Unit tests: vehicle routes keep to one-way ramps (PathRequest.rampFlow).
//
// Two corridors run east-west between the same two ends: the north one (z 0-2) and the south one (z 4-6), split by a
// wall on z 3 from x 1 to 10. The ground climbs eastwards, 0.3 m a tile, so a route west descends either corridor.

import { describe, it, expect } from 'vitest';
import { findPath, type RampFlowField } from '../../../src/core/nav/Pathfinding.js';
import { NavGrid, type NavCell } from '../../../src/core/nav/NavGrid.js';

const W = 12;
const H = 7;

function grid(): NavGrid {
  const cells: NavCell[][] = [];
  for (let z = 0; z < H; z++) {
    const row: NavCell[] = [];
    for (let x = 0; x < W; x++) {
      const wall = z === 3 && x >= 1 && x <= 10;
      row.push({
        type: wall ? 'blocked' : 'walkable', moveCost: wall ? Infinity : 1, benchLevel: 0, vehicleOccupied: false,
        clearance: 1, surfaceY: x * 0.3,
      });
    }
    cells.push(row);
  }
  return new NavGrid(W, H, cells);
}

/** `dir` (1 down only, -1 up only) over the north corridor and/or the south one. */
function field(north: number, south: number): RampFlowField {
  const f = new Int8Array(W * H);
  for (let z = 0; z < H; z++) for (let x = 1; x <= 10; x++) {
    if (z <= 2) f[z * W + x] = north;
    if (z >= 4) f[z * W + x] = south;
  }
  return f;
}

/** Route west, from the north corridor's east end down to its west end. */
const west = (rampFlow: RampFlowField | null = null) => findPath(grid(), { agentId: 1, fromX: 11, fromZ: 1, toX: 0, toZ: 1, avoidVehicles: false, rampFlow });

const usesSouth = (path: ReturnType<typeof west>) => path.waypoints.some(p => p.z >= 4 && p.x > 0 && p.x < 11);

describe('vehicle routes and one-way ramps', () => {
  it('drives straight down the near corridor when no ramp is one-way', () => {
    const path = west();
    expect(path.found).toBe(true);
    expect(usesSouth(path)).toBe(false);
  });

  it('keeps out of a corridor whose traffic only climbs, and takes the one going down', () => {
    const path = west(field(-1, 1));
    expect(path.found).toBe(true);
    expect(usesSouth(path)).toBe(true);
  });

  it('drives down a down-only corridor as if it were two-way', () => {
    const path = west(field(1, -1));
    expect(path.found).toBe(true);
    expect(usesSouth(path)).toBe(false);
    expect(path.totalCost).toBeCloseTo(west().totalCost, 6);
  });

  it('still finds a way when every way runs against the traffic: a one-way ramp never strands a vehicle', () => {
    const path = west(field(-1, -1));
    expect(path.found).toBe(true);
    expect(path.totalCost).toBeGreaterThan(west().totalCost);
  });

  it('a null field is no field', () => {
    expect(west(null).waypoints).toEqual(west().waypoints);
  });
});
