// BlastSimulator2026 — Integration: wide and widened ramps stay walkable and routable across their whole width (#1298)

import { describe, it, expect } from 'vitest';
import { NavGrid } from '../../src/core/nav/NavGrid.js';
import { findPath } from '../../src/core/nav/Pathfinding.js';
import { VoxelGrid } from '../../src/core/world/VoxelGrid.js';
import { buildRamp, carveRampSegment, type RampDef } from '../../src/core/mining/Ramp.js';
import { orderRampWiden, rampFootprint } from '../../src/core/mining/RampWidening.js';
import { createGame, type BuiltRamp } from '../../src/core/state/GameState.js';
import type { RampWidth } from '../../src/core/config/balance.js';

const ORIGIN_X = 15, ORIGIN_Z = 5, LENGTH = 14, DEPTH = 6;
const DEF: RampDef = { originX: ORIGIN_X, originZ: ORIGIN_Z, direction: 'south', length: LENGTH, targetDepth: DEPTH };

function makePlateau(): VoxelGrid {
  const grid = new VoxelGrid(30, 34);
  for (let x = 0; x < 30; x++)
    for (let z = 0; z < 34; z++)
      for (let y = 0; y <= 22; y++)
        grid.setVoxel(x, y, z, { composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] }, density: 1.0, oreDensities: {}, fractureModifier: 1.0 });
  return grid;
}

function countBlocked(nav: NavGrid): number {
  let n = 0;
  for (let x = 0; x < nav.width; x++) for (let z = 0; z < nav.height; z++) if (nav.cellAt(x, z)?.type === 'blocked') n++;
  return n;
}

function assertWholeCorridorTraversable(nav: NavGrid, width: RampWidth): void {
  const half = Math.floor(width / 2);
  for (let z = ORIGIN_Z; z < ORIGIN_Z + LENGTH; z++) {
    for (let x = ORIGIN_X - half; x <= ORIGIN_X + half; x++) {
      const cell = nav.cellAt(x, z);
      expect(cell, `cell ${x},${z}`).toBeDefined();
      expect(['walkable', 'ramp'], `cell ${x},${z} type ${cell?.type}`).toContain(cell!.type);
    }
  }
}

function route(nav: NavGrid, fromX: number, fromZ: number, toX: number, toZ: number) {
  return findPath(nav, { agentId: 1, fromX, fromZ, toX, toZ, avoidVehicles: false });
}

describe('dug ramps of width 5 and 7', () => {
  it.each([5, 7] as RampWidth[])('%i wide: every corridor column is walkable or ramp, none blocked', (width) => {
    const grid = makePlateau();
    const blockedBefore = countBlocked(NavGrid.buildNavGrid(grid, [], []));
    expect(buildRamp(grid, { ...DEF, width }, 1e9).success).toBe(true);
    const nav = NavGrid.buildNavGrid(grid, [], []);
    assertWholeCorridorTraversable(nav, width);
    expect(countBlocked(nav)).toBe(blockedBefore);
  });

  it.each([5, 7] as RampWidth[])('%i wide: routes from the rim to the pit floor through an edge column', (width) => {
    const grid = makePlateau();
    buildRamp(grid, { ...DEF, width }, 1e9);
    const nav = NavGrid.buildNavGrid(grid, [], []);
    const half = Math.floor(width / 2);
    const deepZ = ORIGIN_Z + LENGTH - 1;
    for (const edgeX of [ORIGIN_X - half, ORIGIN_X + half]) {
      const r = route(nav, edgeX, ORIGIN_Z - 1, edgeX, deepZ);
      expect(r.found, `edge column ${edgeX}`).toBe(true);
      const last = r.waypoints.at(-1)!;
      expect(Math.round(last.x)).toBe(edgeX);
      expect(Math.round(last.z)).toBe(deepZ);
    }
  });
});

describe('a widened ramp', () => {
  function widenFully(from: RampWidth, to: RampWidth) {
    const grid = makePlateau();
    const def: RampDef = { ...DEF, width: from };
    expect(buildRamp(grid, def, 1e9).success).toBe(true);
    const state = createGame({ seed: 42 });
    state.cash = 1e9;
    const ramp: BuiltRamp = { id: 1, def, width: from, footprint: rampFootprint(def, from) };
    state.builtRamps.push(ramp);
    state.nextBuiltRampId = 2;
    const r = orderRampWiden(state, grid, 1, to);
    expect(r.success).toBe(true);
    for (const seg of state.plannedRamps[0]!.segments) carveRampSegment(grid, { cells: seg.cells, region: seg.region });
    return grid;
  }

  it('3 to 7: full width walkable or ramp, no blocked cells created', () => {
    const grid = widenFully(3, 7);
    const nav = NavGrid.buildNavGrid(grid, [], []);
    assertWholeCorridorTraversable(nav, 7);
    expect(countBlocked(nav)).toBe(0);
  });

  it('5 to 7: full width walkable or ramp', () => {
    const nav = NavGrid.buildNavGrid(widenFully(5, 7), [], []);
    assertWholeCorridorTraversable(nav, 7);
  });

  it('new strips meet the old corridor floor: adjacent columns differ by at most one voxel at every row', () => {
    const nav = NavGrid.buildNavGrid(widenFully(3, 7), [], []);
    for (let z = ORIGIN_Z; z < ORIGIN_Z + LENGTH; z++) {
      for (let x = ORIGIN_X - 3; x < ORIGIN_X + 3; x++) {
        const a = nav.cellAt(x, z)!.surfaceY;
        const b = nav.cellAt(x + 1, z)!.surfaceY;
        expect(Math.abs(a - b), `z=${z} x=${x}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('is routable rim to pit floor through either new outer edge column', () => {
    const nav = NavGrid.buildNavGrid(widenFully(3, 7), [], []);
    const deepZ = ORIGIN_Z + LENGTH - 1;
    for (const edgeX of [ORIGIN_X - 3, ORIGIN_X + 3]) {
      expect(route(nav, edgeX, ORIGIN_Z - 1, edgeX, deepZ).found, `edge ${edgeX}`).toBe(true);
    }
  });
});
