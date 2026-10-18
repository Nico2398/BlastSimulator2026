// BlastSimulator2026 — OreEstimateMemo unit tests (#1703)
// The memo reruns the blast-energy estimate only when one of its inputs changed.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/core/mining/BlastValueEstimate.js', () => ({
  estimateBlastOre: vi.fn(() => ({ value: 42, coverage: 0.5 })),
}));
vi.mock('../../../src/core/mining/WetHoles.js', () => ({
  wetHoleIdsFor: vi.fn(() => new Set<string>()),
}));

import { OreEstimateMemo } from '../../../src/ui/panels/oreEstimateMemo.js';
import { estimateBlastOre } from '../../../src/core/mining/BlastValueEstimate.js';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import type { GameState } from '../../../src/core/state/GameState.js';
import type { BlastPlan } from '../../../src/core/mining/BlastPlan.js';

const estimate = vi.mocked(estimateBlastOre);

function stateWith(surveys: Array<{ id: number; completedTick: number; stale?: boolean }>): GameState {
  return { surveyResults: surveys, contracts: {} } as unknown as GameState;
}

function planWith(holeX: number): BlastPlan {
  return { holes: [{ id: 'H1', x: holeX, z: 5, depth: 4, diameter: 0.15 }], charges: [] } as unknown as BlastPlan;
}

describe('OreEstimateMemo', () => {
  beforeEach(() => { estimate.mockClear(); });

  it('returns 0 without a grid and does not estimate', () => {
    expect(new OreEstimateMemo().get(stateWith([]), planWith(1), null)).toEqual({ value: 0, coverage: 0 });
    expect(estimate).not.toHaveBeenCalled();
  });

  it('caches on an unchanged key', () => {
    const memo = new OreEstimateMemo();
    const grid = new VoxelGrid(16, 16);
    const state = stateWith([]);
    const plan = planWith(1);
    expect(memo.get(state, plan, grid)).toEqual({ value: 42, coverage: 0.5 });
    expect(memo.get(state, plan, grid)).toEqual({ value: 42, coverage: 0.5 });
    expect(estimate).toHaveBeenCalledTimes(1);
  });

  it('recomputes when the plan changes', () => {
    const memo = new OreEstimateMemo();
    const grid = new VoxelGrid(16, 16);
    const state = stateWith([]);
    memo.get(state, planWith(1), grid);
    memo.get(state, planWith(2), grid);
    expect(estimate).toHaveBeenCalledTimes(2);
  });

  it('recomputes when a survey is added or goes stale', () => {
    const memo = new OreEstimateMemo();
    const grid = new VoxelGrid(16, 16);
    const plan = planWith(1);
    memo.get(stateWith([]), plan, grid);
    memo.get(stateWith([{ id: 1, completedTick: 3 }]), plan, grid);
    memo.get(stateWith([{ id: 1, completedTick: 3, stale: true }]), plan, grid);
    expect(estimate).toHaveBeenCalledTimes(3);
  });

  it('recomputes on every grid edit, even inside an already-dirty chunk', () => {
    const memo = new OreEstimateMemo();
    const grid = new VoxelGrid(16, 16);
    const state = stateWith([]);
    const plan = planWith(1);
    grid.setVoxel(1, 1, 1, { composition: { rocks: [] }, density: 1, oreDensities: {}, fractureModifier: 1 });
    memo.get(state, plan, grid);
    grid.setVoxel(2, 1, 1, { composition: { rocks: [] }, density: 1, oreDensities: {}, fractureModifier: 1 });
    memo.get(state, plan, grid);
    expect(estimate).toHaveBeenCalledTimes(2);
  });

  it('recomputes for a different grid instance', () => {
    const memo = new OreEstimateMemo();
    const state = stateWith([]);
    const plan = planWith(1);
    memo.get(state, plan, new VoxelGrid(16, 16));
    memo.get(state, plan, new VoxelGrid(16, 16));
    expect(estimate).toHaveBeenCalledTimes(2);
  });

  it('returns the coverage from the estimate, on a fresh compute and a cached read', () => {
    estimate.mockReturnValueOnce({ value: 7, coverage: 0.25 });
    const memo = new OreEstimateMemo();
    const grid = new VoxelGrid(16, 16);
    const state = stateWith([]);
    const plan = planWith(1);
    expect(memo.get(state, plan, grid)).toEqual({ value: 7, coverage: 0.25 });
    expect(memo.get(state, plan, grid)).toEqual({ value: 7, coverage: 0.25 });
  });

  it('recomputes coverage when a survey changes while holes stay put', () => {
    estimate.mockReturnValueOnce({ value: 0, coverage: 0 }).mockReturnValueOnce({ value: 5, coverage: 1 });
    const memo = new OreEstimateMemo();
    const grid = new VoxelGrid(16, 16);
    const plan = planWith(1);
    expect(memo.get(stateWith([]), plan, grid).coverage).toBe(0);
    expect(memo.get(stateWith([{ id: 1, completedTick: 3 }]), plan, grid)).toEqual({ value: 5, coverage: 1 });
  });
});
