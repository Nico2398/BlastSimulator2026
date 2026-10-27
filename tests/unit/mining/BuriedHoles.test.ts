// BlastSimulator2026 — Unit tests: holes buried under on-ground rubble (#1937)
//
// On a progression site a planned hole is buried while any on_ground fragment's
// footprint (position +- halfExtents, cells via Math.round) covers its cell.

import { describe, it, expect } from 'vitest';
import {
  cellKey, buildBuriedCellIndex, isCellBuried, buriedHoleIds,
  buriedHolesOf, isHoleBuried, fragmentBuriesPlannedHole, rubbleCoverCounts,
} from '../../../src/core/mining/BuriedHoles.js';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import { syncHaulDispatch } from '../../../src/core/economy/HaulDispatch.js';
import { createGame, type GameState } from '../../../src/core/state/GameState.js';
import { createGradeState } from '../../../src/core/economy/MineGrade.js';
import { addBlastFragments } from '../../../src/core/economy/Logistics.js';
import type { FragmentData } from '../../../src/core/mining/BlastExecution.js';

function frag(id: number, x: number, z: number, half = 0.3, y = 0): FragmentData {
  return {
    id, position: { x, y, z }, volume: 0.3, mass: 1000, rockId: 'cruite', oreDensities: {},
    initialVelocity: { x: 0, y: 0, z: 0 }, isProjection: false,
    halfExtents: { x: half, y: half, z: half }, shapeSeed: id, origin: { x, y: 0, z },
  };
}

function site(progression = true): GameState {
  const state = createGame({ seed: 42 });
  if (progression) state.grade = createGradeState();
  return state;
}

function plan(state: GameState, id: string, x: number, z: number): void {
  state.plannedDrillHoles.push({ id, x, z, depth: 6, diameter: 0.089 });
}

describe('cell index primitives', () => {
  it('cellKey is distinct for distinct cells and stable for the same cell', () => {
    expect(cellKey(3, 4)).toBe(cellKey(3, 4));
    expect(cellKey(3, 4)).not.toBe(cellKey(4, 3));
    expect(cellKey(0, 0)).not.toBe(cellKey(1, 0));
    expect(cellKey(0, 0)).not.toBe(cellKey(0, 1));
  });

  it('a fragment covers its centre cell', () => {
    const index = buildBuriedCellIndex([{ x: 10, z: 12, halfX: 0.2, halfZ: 0.2 }]);
    expect(isCellBuried(index, 10, 12)).toBe(true);
    expect(isCellBuried(index, 11, 12)).toBe(false);
  });

  it('a wide fragment covers cells beyond its centre cell', () => {
    const index = buildBuriedCellIndex([{ x: 10, z: 10, halfX: 2, halfZ: 0.2 }]);
    for (const x of [8, 9, 10, 11, 12]) expect(isCellBuried(index, x, 10)).toBe(true);
    expect(isCellBuried(index, 13, 10)).toBe(false);
    expect(isCellBuried(index, 7, 10)).toBe(false);
    expect(isCellBuried(index, 10, 11)).toBe(false);
  });

  it('a footprint that stops short of a cell boundary does not cover the next cell (round semantics)', () => {
    // Extent reaches x = 10.4 -> round = 10; next cell (11) starts being covered only at >= 10.5.
    const index = buildBuriedCellIndex([{ x: 10, z: 10, halfX: 0.4, halfZ: 0.4 }]);
    expect(isCellBuried(index, 11, 10)).toBe(false);
    expect(isCellBuried(index, 9, 10)).toBe(false);
    const wider = buildBuriedCellIndex([{ x: 10, z: 10, halfX: 0.6, halfZ: 0.6 }]);
    expect(isCellBuried(wider, 11, 10)).toBe(true);
    expect(isCellBuried(wider, 9, 10)).toBe(true);
  });

  it('a hole query on a fractional position uses the containing (rounded) cell', () => {
    const index = buildBuriedCellIndex([{ x: 5, z: 5, halfX: 0.1, halfZ: 0.1 }]);
    expect(isCellBuried(index, 5.3, 4.8)).toBe(true);
    expect(isCellBuried(index, 5.6, 5)).toBe(false);
  });

  it('empty input buries nothing', () => {
    expect(isCellBuried(buildBuriedCellIndex([]), 0, 0)).toBe(false);
  });

  it('buriedHoleIds picks exactly the holes on covered cells', () => {
    const index = buildBuriedCellIndex([{ x: 4, z: 4, halfX: 0.2, halfZ: 0.2 }]);
    const ids = buriedHoleIds(index, [{ id: 'H1', x: 4, z: 4 }, { id: 'H2', x: 8, z: 8 }]);
    expect([...ids]).toEqual(['H1']);
  });
});

describe('buriedHolesOf (#1937)', () => {
  it('a planned hole under an on_ground fragment is buried on a progression site', () => {
    const state = site();
    plan(state, 'H1', 20, 20);
    addBlastFragments(state.logistics, [frag(1, 20, 20)]);
    expect([...buriedHolesOf(state)]).toEqual(['H1']);
    expect(isHoleBuried(state, 'H1')).toBe(true);
  });

  it('a hole beside the rubble is not buried', () => {
    const state = site();
    plan(state, 'H1', 24, 20);
    addBlastFragments(state.logistics, [frag(1, 20, 20)]);
    expect(buriedHolesOf(state).size).toBe(0);
    expect(isHoleBuried(state, 'H1')).toBe(false);
  });

  it('a fragment wider than one cell buries holes on its neighbouring cells', () => {
    const state = site();
    plan(state, 'H1', 20, 20);
    plan(state, 'H2', 22, 20);
    plan(state, 'H3', 26, 20);
    addBlastFragments(state.logistics, [frag(1, 21, 20, 1.6)]);
    expect([...buriedHolesOf(state)].sort()).toEqual(['H1', 'H2']);
  });

  it('a hole half a cell off the fragment footprint is not covered', () => {
    const state = site();
    plan(state, 'H1', 21, 20);
    addBlastFragments(state.logistics, [frag(1, 20, 20, 0.4)]);
    expect(isHoleBuried(state, 'H1')).toBe(false);
  });

  it('clears when the fragment is hauled away (removed from the ground)', () => {
    const state = site();
    plan(state, 'H1', 20, 20);
    addBlastFragments(state.logistics, [frag(1, 20, 20)]);
    expect(isHoleBuried(state, 'H1')).toBe(true);
    state.logistics.fragments.splice(0, 1);
    expect(isHoleBuried(state, 'H1')).toBe(false);
  });

  it('in_transit and stored fragments never bury', () => {
    const state = site();
    plan(state, 'H1', 20, 20);
    addBlastFragments(state.logistics, [frag(1, 20, 20), frag(2, 20, 20)]);
    state.logistics.fragments[0]!.state = 'in_transit';
    state.logistics.fragments[1]!.state = 'stored';
    expect(buriedHolesOf(state).size).toBe(0);
  });

  it('shrinking the fragment (smaller halfExtents) frees the hole', () => {
    const state = site();
    plan(state, 'H1', 22, 20);
    addBlastFragments(state.logistics, [frag(1, 20, 20, 2.2)]);
    expect(isHoleBuried(state, 'H1')).toBe(true);
    state.tickCount += 1; // the rubble index is cached per tick
    state.logistics.fragments[0]!.fragment.halfExtents = { x: 0.3, y: 0.3, z: 0.3 };
    expect(isHoleBuried(state, 'H1')).toBe(false);
  });

  it('never counts on a non-progression site', () => {
    const state = site(false);
    plan(state, 'H1', 20, 20);
    addBlastFragments(state.logistics, [frag(1, 20, 20)]);
    expect(buriedHolesOf(state).size).toBe(0);
    expect(isHoleBuried(state, 'H1')).toBe(false);
    expect(fragmentBuriesPlannedHole(state, 1)).toBe(false);
  });

  it('many fragments on the same cell bury the hole once; hauling all but one keeps it buried', () => {
    const state = site();
    plan(state, 'H1', 20, 20);
    addBlastFragments(state.logistics, [frag(1, 20, 20), frag(2, 20.1, 20), frag(3, 19.9, 20)]);
    expect([...buriedHolesOf(state)]).toEqual(['H1']);
    state.logistics.fragments.splice(0, 2);
    expect(isHoleBuried(state, 'H1')).toBe(true);
    state.logistics.fragments.splice(0, 1);
    expect(isHoleBuried(state, 'H1')).toBe(false);
  });

  it('an unknown hole id is not buried', () => {
    const state = site();
    addBlastFragments(state.logistics, [frag(1, 20, 20)]);
    expect(isHoleBuried(state, 'nope')).toBe(false);
  });

  it('a few thousand fragments and many holes resolve quickly (linear, not fragments x holes)', () => {
    const state = site();
    const frags: FragmentData[] = [];
    for (let i = 0; i < 4000; i++) frags.push(frag(i + 1, (i % 80) + 100, Math.floor(i / 80) + 100, 0.4));
    addBlastFragments(state.logistics, frags);
    for (let i = 0; i < 400; i++) plan(state, `H${i}`, 100 + (i % 20) * 4, 100 + Math.floor(i / 20) * 2);
    const start = performance.now();
    const buried = buriedHolesOf(state);
    const elapsed = performance.now() - start;
    expect(buried.size).toBe(400);
    expect(elapsed).toBeLessThan(250);
  });
});

describe('fragmentBuriesPlannedHole (#1937)', () => {
  it('is true for an on_ground fragment covering a planned hole, false for one that does not', () => {
    const state = site();
    plan(state, 'H1', 20, 20);
    addBlastFragments(state.logistics, [frag(1, 20, 20), frag(2, 40, 40)]);
    expect(fragmentBuriesPlannedHole(state, 1)).toBe(true);
    expect(fragmentBuriesPlannedHole(state, 2)).toBe(false);
  });

  it('is false for an in_transit fragment and for an unknown id', () => {
    const state = site();
    plan(state, 'H1', 20, 20);
    addBlastFragments(state.logistics, [frag(1, 20, 20)]);
    expect(fragmentBuriesPlannedHole(state, 99)).toBe(false);
    state.logistics.fragments[0]!.state = 'in_transit';
    expect(fragmentBuriesPlannedHole(state, 1)).toBe(false);
  });
});

describe('rubbleCoverCounts (#2091)', () => {
  it('counts every on-ground fragment covering a cell, stacked ones included', () => {
    const state = site();
    addBlastFragments(state.logistics, [frag(1, 20, 20), frag(2, 20, 20), frag(3, 21, 20)]);
    const counts = rubbleCoverCounts(state);
    expect(counts.get(cellKey(20, 20))).toBe(2);
    expect(counts.get(cellKey(21, 20))).toBe(1);
  });

  it('a wide fragment counts on every cell it covers', () => {
    const state = site();
    addBlastFragments(state.logistics, [frag(1, 10, 10, 1.2)]);
    const counts = rubbleCoverCounts(state);
    for (const x of [9, 10, 11]) expect(counts.get(cellKey(x, 10))).toBe(1);
  });

  it('leaves out fragments no longer on the ground, and cells no rubble covers', () => {
    const state = site();
    addBlastFragments(state.logistics, [frag(1, 20, 20)]);
    state.logistics.fragments[0]!.state = 'in_transit';
    const counts = rubbleCoverCounts(state);
    expect(counts.get(cellKey(20, 20))).toBeUndefined();
    expect(counts.size).toBe(0);
  });
});

describe('sealed rubble does not bury (#1937, #1774)', () => {
  function capGrid(): VoxelGrid {
    const grid = new VoxelGrid(6, 6);
    for (let y = 0; y < 10; y++) for (let z = 0; z < 6; z++) for (let x = 0; x < 6; x++) {
      grid.setVoxel(x, y, z, { composition: { rocks: [{ rockId: 'sandite', coefficient: 1.0 }] }, density: 1, oreDensities: {}, fractureModifier: 1 });
    }
    return grid;
  }

  it('a fragment sealed under intact rock leaves the hole unburied; ground rubble still buries', () => {
    const state = site();
    plan(state, 'H1', 2, 2);
    plan(state, 'H2', 4, 4);
    addBlastFragments(state.logistics, [frag(1, 2, 2, 0.3, 4), frag(2, 4, 4, 0.3, 3)]);
    const grid = capGrid();
    // Open the column under H2's fragment so only fragment 1 stays sealed.
    for (let y = 2; y < 10; y++) grid.clearVoxel(4, y, 4);
    syncHaulDispatch(state, grid);
    expect([...buriedHolesOf(state)]).toEqual(['H2']);
    expect(fragmentBuriesPlannedHole(state, 1)).toBe(false);
    expect(fragmentBuriesPlannedHole(state, 2)).toBe(true);
  });
});
