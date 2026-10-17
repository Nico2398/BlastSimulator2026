// BlastSimulator2026 — fragment ids stay unique across blasts (#1903)
// Every blast used to number its fragments from 0, so a second blast left two
// fragments on the ground sharing an id and a haul order named the wrong one.

import { describe, it, expect } from 'vitest';
import { drillGridChargeAndBlast, tickUntilFresh, buyChargingTruck } from '../../helpers/blastFixtures.js';
import { createLogisticsState, reserveFragmentIds } from '../../../src/core/economy/Logistics.js';
import { executeBlast } from '../../../src/core/mining/BlastExecution.js';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import { createGridPlan } from '../../../src/core/mining/DrillPlan.js';
import { batchCharge } from '../../../src/core/mining/ChargePlan.js';
import { assembleBlastPlan } from '../../../src/core/mining/BlastPlan.js';
import type { GameState } from '../../../src/core/state/GameState.js';

/** Drills and charges a second pattern on the same game, then fires it. The first blast killed the crew standing in it, so re-equip first. */
function fireSecondBlast(run: (cmd: string) => unknown, state: GameState, startX: number, startZ: number): void {
  state.cash = 5_000_000;
  state.finances.cash = 5_000_000;
  tickUntilFresh(run, state, () => state.hiringPool.candidates.some(c => c.role === 'driller'), 400);
  expect(run('employee hire role:driller')).toMatchObject({ success: true });
  const driller = state.employees.employees.filter(e => e.alive).at(-1)!;
  expect(run('vehicle buy drill_rig')).toMatchObject({ success: true });
  expect(run(`employee assign_skill ${driller.id} skill:driving.drill_rig level:1`)).toMatchObject({ success: true });
  buyChargingTruck(run, state, driller.id);
  const drill = run(`drill_plan grid rows:2 cols:2 spacing:5 depth:6 start:${startX},${startZ} diameter:0.089`);
  expect(drill, JSON.stringify(drill)).toMatchObject({ success: true });
  tickUntilFresh(run, state, () => state.plannedDrillHoles.length === 0, 3000);
  expect(run('charge hole:* explosive:boomite amount:5 stemming:2')).toMatchObject({ success: true });
  tickUntilFresh(run, state, () => Object.keys(state.plannedChargesByHole).length === 0, 3000);
  state.cash = 5_000_000;
  state.finances.cash = 5_000_000;
  const shot = run('blast');
  expect(shot, JSON.stringify(shot)).toMatchObject({ success: true });
}

function twoBlasts() {
  const first = drillGridChargeAndBlast({ rows: 2, cols: 2, spacing: 5, startX: 14, startZ: 14, amount: 5 });
  const { run, state } = first;
  const firstFragments = state.logistics.fragments.map(f => f.fragment);
  const firstCount = firstFragments.length;
  fireSecondBlast(run, state, 14, 30);
  return { ...first, firstFragments, firstCount };
}

describe('reserveFragmentIds', () => {
  it('starts a fresh logistics state at zero', () => {
    expect(createLogisticsState().nextFragmentId).toBe(0);
  });

  it('returns the first id of the block and advances the counter', () => {
    const s = createLogisticsState();
    expect(reserveFragmentIds(s, 5)).toBe(0);
    expect(s.nextFragmentId).toBe(5);
    expect(reserveFragmentIds(s, 3)).toBe(5);
    expect(s.nextFragmentId).toBe(8);
  });

  it('reserving zero ids changes nothing', () => {
    const s = createLogisticsState();
    s.nextFragmentId = 7;
    expect(reserveFragmentIds(s, 0)).toBe(7);
    expect(s.nextFragmentId).toBe(7);
  });
});

describe('executeBlast firstFragmentId', () => {
  function plan() {
    const grid = new VoxelGrid(40, 40);
    for (let z = 5; z <= 25; z++) for (let y = 0; y <= 10; y++) for (let x = 5; x <= 25; x++) {
      grid.setVoxel(x, y, z, {
        composition: { rocks: [{ rockId: 'molite', coefficient: 1.0 }] },
        density: 1.0, oreDensities: {}, fractureModifier: 1.0,
      });
    }
    const counter = { nextHoleId: 1 };
    const holes = createGridPlan(counter, { x: 12, z: 12 }, 2, 3, 4, 8, 0.15);
    const depths: Record<string, number> = {};
    for (const h of holes) depths[h.id] = h.depth;
    const { charges } = batchCharge(holes.map(h => h.id), depths, 'boomite', 5, 2);
    return { grid, p: assembleBlastPlan(holes, charges) };
  }

  it('without the argument ids start at 0', () => {
    const { grid, p } = plan();
    const result = executeBlast(p, grid, [])!;
    expect(result.fragments.length).toBeGreaterThan(0);
    expect(Math.min(...result.fragments.map(f => f.id))).toBe(0);
  });

  it('with the argument ids start at firstFragmentId and are consecutive', () => {
    const { grid, p } = plan();
    const result = executeBlast(p, grid, [], undefined, undefined, undefined, undefined, undefined, 100)!;
    const ids = result.fragments.map(f => f.id);
    expect(Math.min(...ids)).toBe(100);
    expect(Math.max(...ids)).toBe(100 + ids.length - 1);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('blast console command — unique fragment ids across blasts', () => {
  it('leaves no duplicate fragment id on the ground after two blasts', () => {
    const { state } = twoBlasts();
    const ids = state.logistics.fragments.map(f => f.fragment.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('numbers the second blast from the first blast\'s fragment count', () => {
    const { state, firstCount } = twoBlasts();
    expect(firstCount).toBeGreaterThan(0);
    const firstIds = new Set(Array.from({ length: firstCount }, (_, i) => i));
    const second = state.logistics.fragments.map(f => f.fragment.id).filter(id => !firstIds.has(id));
    expect(second.length).toBeGreaterThan(0);
    expect(Math.min(...second)).toBe(firstCount);
  });

  it('nextFragmentId equals the total fragments created', () => {
    const { state } = twoBlasts();
    expect(state.logistics.nextFragmentId).toBe(state.logistics.fragments.length);
    expect(state.logistics.nextFragmentId).toBeGreaterThan(0);
  });

  it('does not reuse ids of fragments removed from the ground', () => {
    const first = drillGridChargeAndBlast({ rows: 2, cols: 2, spacing: 5, startX: 14, startZ: 14, amount: 5 });
    const { run, state } = first;
    const total = state.logistics.fragments.length;
    state.logistics.fragments.length = 0; // all delivered / hauled away
    expect(state.logistics.nextFragmentId).toBe(total);
    fireSecondBlast(run, state, 14, 30);
    const ids = state.logistics.fragments.map(f => f.fragment.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(Math.min(...ids)).toBe(total);
  });

  it('a second-blast fragment id resolves to exactly that fragment', () => {
    const { state, firstCount } = twoBlasts();
    const target = state.logistics.fragments.find(f => f.fragment.id >= firstCount)!;
    const matches = state.logistics.fragments.filter(f => f.fragment.id === target.fragment.id);
    expect(matches).toEqual([target]);
  });

  it('a refused blast consumes no ids', () => {
    const { run, state } = drillGridChargeAndBlast({ rows: 1, cols: 1, spacing: 3, startX: 14, startZ: 14, amount: 5 });
    const before = state.logistics.nextFragmentId;
    expect(run('blast')).toMatchObject({ success: false });
    expect(state.logistics.nextFragmentId).toBe(before);
  });
});
