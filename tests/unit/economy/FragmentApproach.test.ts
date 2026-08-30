// BlastSimulator2026 — Tests for FragmentApproach.fragmentApproachCell (#484)
//
// The 1-argument (nominal-cell) form is already exercised indirectly by
// HaulingTask.test.ts and BoulderBreaking.approach.test.ts. The 2-argument
// occupied-cell fallback — the exact fix for #484's livelock (a
// rock_fragmenter parked on a fragment's own cell permanently blocking a
// debris_hauler targeting the same cell) — has no direct coverage anywhere.
// This file covers `state`/`excludeVehicleId`, the occupied-primary-cell
// nearest-free-neighbour search, and its fallback when every neighbour is
// unusable.

import { describe, it, expect } from 'vitest';
import { createGame } from '../../../src/core/state/GameState.js';
import { purchaseVehicle } from '../../../src/core/entities/Vehicle.js';
import { NavGrid, type NavCell } from '../../../src/core/nav/NavGrid.js';
import type { FragmentData } from '../../../src/core/mining/BlastExecution.js';
import { fragmentApproachCell } from '../../../src/core/economy/FragmentApproach.js';

const SEED = 42;

function makeFragment(id: number, x: number, z: number): FragmentData {
  return {
    id,
    position: { x, y: 0, z },
    volume: 0.3,
    mass: 1000,
    rockId: 'cruite',
    oreDensities: {},
    initialVelocity: { x: 0, y: 0, z: 0 },
    isProjection: false,
    halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
    shapeSeed: 1,
  };
}

/** A flat, fully walkable size×size NavGrid, mirroring VehiclePanel.test.ts's fixture. */
function makeFlatNavGrid(size: number): NavGrid {
  const cells: NavCell[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => ({ type: 'walkable' as const, moveCost: 1.0, benchLevel: 0, vehicleOccupied: false })));
  return new NavGrid(size, size, cells, 0);
}

const ALL_NEIGHBOR_OFFSETS: readonly [number, number][] = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1], [0, 1],
  [1, -1], [1, 0], [1, 1],
];

describe('fragmentApproachCell — primary cell free', () => {
  it('returns the fragment\'s own rounded position when no state is supplied (1-arg form)', () => {
    const fragment = makeFragment(1, 5, 7);
    expect(fragmentApproachCell(fragment)).toEqual({ x: 5, z: 7 });
  });

  it('returns the primary cell when state is supplied but no vehicle occupies it', () => {
    const state = createGame({ seed: SEED });
    const fragment = makeFragment(1, 5, 7);

    expect(fragmentApproachCell(fragment, state)).toEqual({ x: 5, z: 7 });
  });

  it('returns the primary cell when the only vehicle there is the excluded one', () => {
    const state = createGame({ seed: SEED });
    const fragment = makeFragment(1, 5, 7);
    const vehicle = purchaseVehicle(state.vehicles, 'rock_fragmenter', 5, 7).vehicle;

    expect(fragmentApproachCell(fragment, state, vehicle.id)).toEqual({ x: 5, z: 7 });
  });
});

describe('fragmentApproachCell — primary cell occupied by another vehicle', () => {
  it('falls back to the nearest free walkable neighbour', () => {
    const state = createGame({ seed: SEED });
    state.navGrid = makeFlatNavGrid(64);
    const fragment = makeFragment(1, 5, 7);
    // Occupies the fragment's own cell — mirrors a rock_fragmenter parked
    // where its own sub-fragments spawned (#484's original livelock).
    purchaseVehicle(state.vehicles, 'rock_fragmenter', 5, 7);

    const result = fragmentApproachCell(fragment, state, /* excludeVehicleId */ 999);

    // Not the occupied primary cell...
    expect(result).not.toEqual({ x: 5, z: 7 });
    // ...but a genuine 8-neighbour of it.
    expect(Math.abs(result.x - 5)).toBeLessThanOrEqual(1);
    expect(Math.abs(result.z - 7)).toBeLessThanOrEqual(1);
    // Nearest candidate: iteration order (dx=-1..1, dz=-1..1) picks the
    // first minimal-distance free cell, which is the cardinal (-1, 0)
    // neighbour ahead of any diagonal.
    expect(result).toEqual({ x: 4, z: 7 });
  });

  it('excludes the requesting vehicle\'s own occupancy of a neighbour from the search', () => {
    const state = createGame({ seed: SEED });
    state.navGrid = makeFlatNavGrid(64);
    const fragment = makeFragment(1, 5, 7);
    const other = purchaseVehicle(state.vehicles, 'rock_fragmenter', 5, 7).vehicle;
    // The requesting vehicle itself already sits on the nearest neighbour
    // cell — it must not be treated as blocking its own path there.
    const requester = purchaseVehicle(state.vehicles, 'debris_hauler', 4, 7).vehicle;

    const result = fragmentApproachCell(fragment, state, requester.id);

    expect(result).toEqual({ x: 4, z: 7 });
    expect(other.x).toBe(5);
  });

  it('falls back to the primary cell when every neighbour is occupied or unwalkable', () => {
    const state = createGame({ seed: SEED });
    state.navGrid = makeFlatNavGrid(64);
    const fragment = makeFragment(1, 5, 7);
    purchaseVehicle(state.vehicles, 'rock_fragmenter', 5, 7);

    // Block half the ring via the NavGrid, occupy the other half with vehicles.
    ALL_NEIGHBOR_OFFSETS.forEach(([dx, dz], i) => {
      const x = 5 + dx;
      const z = 7 + dz;
      if (i % 2 === 0) {
        state.navGrid!.setCellAt(x, z, { type: 'blocked', moveCost: 1.0, benchLevel: 0, vehicleOccupied: false });
      } else {
        purchaseVehicle(state.vehicles, 'debris_hauler', x, z);
      }
    });

    const result = fragmentApproachCell(fragment, state, /* excludeVehicleId */ 999);

    // Documented fallback (see FragmentApproach.ts): `best ?? primary` — the
    // caller's own stuck-detection handles a genuinely unreachable target
    // rather than this function throwing or looping.
    expect(result).toEqual({ x: 5, z: 7 });
  });

  it('falls back to the primary cell when state has no navGrid and every neighbour is occupied', () => {
    const state = createGame({ seed: SEED });
    // No navGrid assigned — mirrors a caller that only has vehicle data.
    const fragment = makeFragment(1, 5, 7);
    purchaseVehicle(state.vehicles, 'rock_fragmenter', 5, 7);
    ALL_NEIGHBOR_OFFSETS.forEach(([dx, dz]) => {
      purchaseVehicle(state.vehicles, 'debris_hauler', 5 + dx, 7 + dz);
    });

    const result = fragmentApproachCell(fragment, state, /* excludeVehicleId */ 999);

    expect(result).toEqual({ x: 5, z: 7 });
  });
});
