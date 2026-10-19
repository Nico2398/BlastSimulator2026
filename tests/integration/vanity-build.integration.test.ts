// BlastSimulator2026 — Integration: vanity projects through the `build` console command (#1947)
//
// Crewless like the spoil heap: `build` charges and places at once. Available on a
// progression site from grade 4; the golf course must touch a spoil heap.

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import { unlockLinesFor } from '../../src/core/economy/MineGrade.js';
import { BUILDING_DEFS, getTotalOperatingCost } from '../../src/core/entities/Building.js';
import { createBoardState } from '../../src/core/economy/Board.js';
import type { GameState } from '../../src/core/state/GameState.js';

function site(grade: number, cash = 10_000_000) {
  const { runner, ctx } = createRunner();
  const run = (cmd: string) => runner.run(cmd) as { success: boolean; message?: string };
  expect(run('sandbox start seed:42 staffed:true')).toMatchObject({ success: true });
  const state = ctx.state as GameState;
  expect(state.grade).toBeDefined();
  state.grade!.grade = grade;
  state.cash = cash;
  return { run, state };
}

const ofType = (s: GameState, t: string) => s.buildings.buildings.filter(b => b.type === t);
const living = (s: GameState) => s.employees.employees.filter(e => e.alive);

describe('vanity build availability (#1947)', () => {
  it('is refused at grade 3 with no cash change and nothing placed', () => {
    const { run, state } = site(3);
    const cash = state.cash;
    const morale = living(state).map(e => e.morale);
    expect(run('build ceo_statue at:10,10').success).toBe(false);
    expect(state.cash).toBe(cash);
    expect(ofType(state, 'ceo_statue')).toHaveLength(0);
    expect(living(state).map(e => e.morale)).toEqual(morale);
  });

  it('is accepted at grade 4 and charges exactly 250000', () => {
    const { run, state } = site(4);
    const cash = state.cash;
    expect(run('build ceo_statue at:10,10')).toMatchObject({ success: true });
    expect(state.cash).toBe(cash - 250_000);
    expect(ofType(state, 'ceo_statue')).toHaveLength(1);
    expect(state.plannedBuildings).toHaveLength(0);
  });

  it('dips every living employee morale by 2, once', () => {
    const { run, state } = site(4);
    expect(living(state).length).toBeGreaterThan(0);
    const before = living(state).map(e => e.morale);
    run('build ceo_statue at:10,10');
    living(state).forEach((e, i) => expect(e.morale).toBe(Math.max(0, before[i]! - 2)));
  });

  it('refuses on insufficient funds at grade 4', () => {
    const { run, state } = site(4, 249_999);
    expect(run('build ceo_statue at:10,10').success).toBe(false);
    expect(state.cash).toBe(249_999);
    expect(ofType(state, 'ceo_statue')).toHaveLength(0);
  });
});

describe('golf course placement (#1947)', () => {
  const heap = BUILDING_DEFS.spoil_heap[1].footprint;
  const heapW = Math.max(...heap.map(c => c[0])) + 1;
  // Flat ground on seed 42: a 6x6 course beside the heap must also pass the slope check.
  const HX = 40, HZ = 20;

  it('is refused unless it touches a spoil heap, charging nothing', () => {
    const { run, state } = site(4);
    const cash = state.cash;
    expect(run('build golf_course at:10,10').success).toBe(false);
    expect(state.cash).toBe(cash);
    expect(ofType(state, 'golf_course')).toHaveLength(0);
  });

  it('is accepted beside a spoil heap and charges 600000', () => {
    const { run, state } = site(4);
    expect(run(`build spoil_heap at:${HX},${HZ}`)).toMatchObject({ success: true });
    const cash = state.cash;
    expect(run(`build golf_course at:${HX + heapW},${HZ}`)).toMatchObject({ success: true });
    expect(state.cash).toBe(cash - 600_000);
    expect(ofType(state, 'golf_course')).toHaveLength(1);
  });

  it('is refused when only diagonal to the heap', () => {
    const { run, state } = site(4);
    run(`build spoil_heap at:${HX},${HZ}`);
    const heapD = Math.max(...heap.map(c => c[1])) + 1;
    expect(run(`build golf_course at:${HX + heapW},${HZ + heapD}`).success).toBe(false);
    expect(ofType(state, 'golf_course')).toHaveLength(0);
  });
});

describe('grade 4 unlock line (#1947)', () => {
  it('grade 4 lists the vanity unlock line', () => {
    expect(unlockLinesFor(4).map(l => l.key)).toContain('progression.unlock.vanity');
  });

  it.each([1, 2, 3])('grade %i does not', (g) => {
    expect(unlockLinesFor(g).map(l => l.key)).not.toContain('progression.unlock.vanity');
  });
});

describe('sandbox start grade arg (#1947)', () => {
  it.each([3, 4])('`sandbox start grade:%i` opens the site at that grade', (g) => {
    const { runner, ctx } = createRunner();
    expect(runner.run(`sandbox start seed:42 kit:full staffed:true grade:${g}`)).toMatchObject({ success: true });
    expect(ctx.state!.grade!.grade).toBe(g);
  });
});

describe('vanity build with a board attached (#1947)', () => {
  const CONFIG = { quarterTicks: 100, oreTargetT: 10, profitTarget: 1000 };

  it('is allowed below grade 4 and raises board confidence by 10', () => {
    const { run, state } = site(1);
    state.board = createBoardState(CONFIG, 0);
    const before = state.board.confidence;
    expect(run('build ceo_statue at:10,10')).toMatchObject({ success: true });
    expect(state.board.confidence).toBe(before + 10);
    expect(ofType(state, 'ceo_statue')).toHaveLength(1);
  });

  it('clamps confidence at the maximum', () => {
    const { run, state } = site(1);
    state.board = createBoardState(CONFIG, 0);
    state.board.confidence = 95;
    run('build ceo_statue at:10,10');
    expect(state.board.confidence).toBe(100);
  });

  it('a refused build leaves confidence untouched', () => {
    const { run, state } = site(1, 1000);
    state.board = createBoardState(CONFIG, 0);
    const before = state.board.confidence;
    expect(run('build ceo_statue at:10,10').success).toBe(false);
    expect(state.board.confidence).toBe(before);
  });

  it('without a board the build succeeds at grade 4 and nothing throws', () => {
    const { run, state } = site(4);
    expect(state.board).toBeUndefined();
    expect(run('build ceo_statue at:10,10')).toMatchObject({ success: true });
  });
});

describe('golf upkeep (#1947)', () => {
  it('getTotalOperatingCost includes 20 per tick for a golf course', () => {
    const { run, state } = site(4);
    const base = getTotalOperatingCost(state.buildings);
    run('build spoil_heap at:40,20');
    const withHeap = getTotalOperatingCost(state.buildings);
    const heapW = Math.max(...BUILDING_DEFS.spoil_heap[1].footprint.map(c => c[0])) + 1;
    expect(run(`build golf_course at:${40 + heapW},20`)).toMatchObject({ success: true });
    expect(ofType(state, 'golf_course')).toHaveLength(1);
    expect(getTotalOperatingCost(state.buildings) - withHeap).toBe(20);
    expect(withHeap).toBeGreaterThanOrEqual(base);
  });

  it.each(['ceo_statue', 'executive_helipad', 'gold_tower'] as const)('%s adds no upkeep', (type) => {
    const { run, state } = site(4);
    const base = getTotalOperatingCost(state.buildings);
    expect(run(`build ${type} at:10,10`)).toMatchObject({ success: true });
    expect(getTotalOperatingCost(state.buildings)).toBe(base);
  });
});

describe('sandbox start grade arg validation (#1947)', () => {
  it.each(['x', '-1', '1.5', ''])('rejects grade:%s', (bad) => {
    const { runner } = createRunner();
    const result = runner.run(`sandbox start seed:42 grade:${bad}`) as { success: boolean; message?: string };
    expect(result.success).toBe(false);
  });
});
