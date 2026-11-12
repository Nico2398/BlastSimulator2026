// BlastSimulator2026 — Tests for FragmentApproach (#484)
//
// Rubble blocks the nav grid over each rock's footprint for every mover, so a
// vehicle loads or breaks a rock from a free cell beside it: never from the
// rock's own cells, never from under other rubble, never from a cell another
// vehicle holds. A rock with no free side waits for the pile around it to go.

import { describe, it, expect } from 'vitest';
import { createGame } from '../../../src/core/state/GameState.js';
import { purchaseVehicle } from '../../../src/core/entities/Vehicle.js';
import { NavGrid, type NavCell } from '../../../src/core/nav/NavGrid.js';
import type { FragmentData } from '../../../src/core/mining/BlastExecution.js';
import { fragmentApproachCandidates, fragmentApproachCell } from '../../../src/core/economy/FragmentApproach.js';

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
    origin: { x, y: 0, z },
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

const isNeighbourOf = (c: { x: number; z: number }, x: number, z: number) =>
  Math.max(Math.abs(c.x - x), Math.abs(c.z - z)) === 1;

describe('fragmentApproachCell', () => {
  it('is the rock\'s own rounded cell without state (the nominal target)', () => {
    expect(fragmentApproachCell(makeFragment(1, 5, 7))).toEqual({ x: 5, z: 7 });
  });

  it('stands beside the rock, never on it, nearest the vehicle asking', () => {
    const state = createGame({ seed: SEED });
    state.navGrid = makeFlatNavGrid(64);
    const fragment = makeFragment(1, 5, 7);
    state.navGrid.addFragmentFootprint(fragment);
    const hauler = purchaseVehicle(state.vehicles, 'debris_hauler', 9, 7).vehicle;

    const result = fragmentApproachCell(fragment, state, hauler.id)!;
    expect(result).toEqual({ x: 6, z: 7 });
  });

  it('a wide rock is approached from beside its whole footprint', () => {
    const state = createGame({ seed: SEED });
    state.navGrid = makeFlatNavGrid(64);
    const wide = { ...makeFragment(1, 10.5, 7), halfExtents: { x: 2, y: 0.5, z: 0.4 } };
    state.navGrid.addFragmentFootprint(wide);
    const hauler = purchaseVehicle(state.vehicles, 'debris_hauler', 20, 7).vehicle;

    // Footprint spans x 9..12 on row 7: the nearest free side to the east is x = 13.
    expect(fragmentApproachCell(wide, state, hauler.id)).toEqual({ x: 13, z: 7 });
  });

  it('skips a side another vehicle holds, but not one the asking vehicle holds', () => {
    const state = createGame({ seed: SEED });
    state.navGrid = makeFlatNavGrid(64);
    const fragment = makeFragment(1, 5, 7);
    state.navGrid.addFragmentFootprint(fragment);
    purchaseVehicle(state.vehicles, 'rock_fragmenter', 6, 7);
    const requester = purchaseVehicle(state.vehicles, 'debris_hauler', 4, 7).vehicle;

    expect(fragmentApproachCell(fragment, state, requester.id)).toEqual({ x: 4, z: 7 });
  });

  it('reaches past the nearest ring when that ring is rubble', () => {
    const state = createGame({ seed: SEED });
    state.navGrid = makeFlatNavGrid(64);
    const centre = makeFragment(1, 5, 7);
    state.navGrid.addFragmentFootprint(centre);
    for (const [dx, dz] of ALL_NEIGHBOR_OFFSETS) state.navGrid.addFragmentFootprint(makeFragment(10 + dx * 3 + dz, 5 + dx, 7 + dz));
    const result = fragmentApproachCell(centre, state)!;
    expect(Math.max(Math.abs(result.x - 5), Math.abs(result.z - 7))).toBe(2);
  });

  it('a rock buried deeper than a loader reaches has no side to stand on until the pile around it is hauled', () => {
    const state = createGame({ seed: SEED });
    state.navGrid = makeFlatNavGrid(64);
    const centre = makeFragment(1, 5, 7);
    state.navGrid.addFragmentFootprint(centre);
    let id = 10;
    const around: ReturnType<typeof makeFragment>[] = [];
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) if (dx !== 0 || dz !== 0) around.push(makeFragment(id++, 5 + dx, 7 + dz));
    for (const f of around) state.navGrid.addFragmentFootprint(f);

    expect(fragmentApproachCell(centre, state)).toBeNull();
    const west = around.find(f => f.position.x === 3 && f.position.z === 7)!;
    state.navGrid.removeFragmentFootprint(west);
    expect(fragmentApproachCell(centre, state)).toEqual({ x: 3, z: 7 });
  });

  it('never stands on blocked ground', () => {
    const state = createGame({ seed: SEED });
    state.navGrid = makeFlatNavGrid(64);
    const fragment = makeFragment(1, 5, 7);
    state.navGrid.addFragmentFootprint(fragment);
    for (const [dx, dz] of ALL_NEIGHBOR_OFFSETS) {
      if (dx === 0 && dz === 1) continue;
      state.navGrid.setCellAt(5 + dx, 7 + dz, { type: 'blocked', moveCost: 1.0, benchLevel: 0, vehicleOccupied: false });
    }
    expect(fragmentApproachCell(fragment, state)).toEqual({ x: 5, z: 8 });
  });
});

describe('fragmentApproachCandidates', () => {
  it('lists the free cells within a loader\'s reach of the footprint', () => {
    const state = createGame({ seed: SEED });
    state.navGrid = makeFlatNavGrid(64);
    const fragment = makeFragment(1, 5, 7);
    state.navGrid.addFragmentFootprint(fragment);
    const cells = fragmentApproachCandidates(fragment, state);
    // The nearest ring and the one past it, nearest first.
    expect(cells).toHaveLength(24);
    expect(cells.slice(0, 8).every(c => isNeighbourOf(c, 5, 7))).toBe(true);
  });
});
