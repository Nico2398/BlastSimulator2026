// BlastSimulator2026 — Breakout prediction vs the real blast (#2003)
// A charge buried too deep leaves its broken rock sealed under intact cap (#1724). The prediction
// must name those plans before firing and must agree with executeBlast on every one.
import { describe, it, expect, beforeAll } from 'vitest';
import { createRunner } from '../../../src/console/createRunner.js';
import { createGridPlan } from '../../../src/core/mining/DrillPlan.js';
import { batchCharge } from '../../../src/core/mining/ChargePlan.js';
import { assembleBlastPlan } from '../../../src/core/mining/BlastPlan.js';
import type { BlastPlan } from '../../../src/core/mining/BlastPlan.js';
import { executeBlast } from '../../../src/core/mining/BlastExecution.js';
import { predictBreakout, breakoutWarningKind, isVoxelSealed, type BreakoutPrediction } from '../../../src/core/mining/BreakoutPrediction.js';
import { forkVoxelGrid } from '../../../src/core/world/VoxelGridFork.js';
import { BLAST_SEALED_SHARE_PARTIAL } from '../../../src/core/config/balance.js';
import type { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';

const ORIGIN = { x: 24, z: 32 };
const D89 = 0.089;
const D127 = 0.127;

let grid: VoxelGrid;

beforeAll(() => {
  const { runner, ctx } = createRunner();
  const res = runner.run('sandbox start biome:desert_badlands difficulty:normal seed:42');
  expect(res).toMatchObject({ success: true });
  grid = ctx.grid!;
});

function shot(depth: number, explosive: string, kg: number, diameter = D89): { plan: BlastPlan; ids: string[] } {
  const counter = { nextHoleId: 1 };
  const holes = createGridPlan(counter, ORIGIN, 3, 3, 4, depth, diameter);
  const depths: Record<string, number> = {};
  const diameters: Record<string, number> = {};
  for (const h of holes) { depths[h.id] = h.depth; diameters[h.id] = h.diameter; }
  const { charges, errors } = batchCharge(holes.map(h => h.id), depths, explosive, kg, 2.5, diameters);
  expect(errors).toEqual([]);
  return { plan: assembleBlastPlan(holes, charges), ids: holes.map(h => h.id) };
}

function actualBrokeOut(plan: BlastPlan): boolean {
  const result = executeBlast(plan, forkVoxelGrid(grid), [], undefined);
  expect(result).not.toBeNull();
  return result!.brokeOut;
}

const BREAKS_OUT: Array<[string, number, string, number, number]> = [
  ['8 m x 8 kg Krackle (defaults-like)', 8, 'krackle', 8, D89],
  ['10 m x 10 kg Krackle', 10, 'krackle', 10, D89],
  ['12 m x 15 kg Shatternite', 12, 'shatternite', 15, D89],
];
const SEALS: Array<[string, number, string, number, number]> = [
  ['11 m x 10 kg Krackle', 11, 'krackle', 10, D89],
  ['12 m x 10 kg Krackle', 12, 'krackle', 10, D89],
  ['12 m x 20 kg Krackle in 127 mm holes', 12, 'krackle', 20, D127],
];

describe('predictBreakout', () => {
  it.each(BREAKS_OUT)('%s: no hole is too deep', (_n, depth, ex, kg, dia) => {
    const { plan } = shot(depth, ex, kg, dia);
    const p = predictBreakout(plan, grid)!;
    expect(p).not.toBeNull();
    expect(p.tooDeepHoleIds).toEqual([]);
    expect(p.chargedHoleCount).toBe(9);
  });

  it.each(SEALS)('%s: holes are too deep', (_n, depth, ex, kg, dia) => {
    const { plan } = shot(depth, ex, kg, dia);
    const p = predictBreakout(plan, grid)!;
    expect(p).not.toBeNull();
    expect(p.tooDeepHoleIds.length).toBeGreaterThan(0);
    expect(p.sealedShare).toBeGreaterThanOrEqual(BLAST_SEALED_SHARE_PARTIAL);
    expect(p.brokenVoxels).toBeGreaterThan(0);
    expect(p.sealedVoxels).toBeGreaterThan(0);
  });

  it.each([...BREAKS_OUT, ...SEALS])('%s: agrees with executeBlast brokeOut', (_n, depth, ex, kg, dia) => {
    const { plan } = shot(depth, ex, kg, dia);
    const p = predictBreakout(plan, grid)!;
    const sealsAll = p.sealedShare >= 1 - 1e-9;
    expect(!sealsAll).toBe(actualBrokeOut(plan));
  });

  it('a total seal predicts sealedShare 1 with every charged hole too deep', () => {
    const { plan, ids } = shot(12, 'krackle', 10);
    const p = predictBreakout(plan, grid)!;
    expect(p.sealedShare).toBeCloseTo(1, 5);
    expect([...p.tooDeepHoleIds].sort()).toEqual([...ids].sort());
  });

  it('a clean breakout predicts a small sealed share', () => {
    const { plan } = shot(8, 'krackle', 8);
    const p = predictBreakout(plan, grid)!;
    expect(p.sealedShare).toBeLessThan(BLAST_SEALED_SHARE_PARTIAL);
  });

  it('does not mutate the grid', () => {
    const { plan } = shot(12, 'krackle', 10);
    const before: number[] = [];
    for (let x = 20; x < 40; x++) for (let z = 28; z < 46; z++) for (let y = 0; y < 30; y++) before.push(grid.densityAt(x, y, z));
    predictBreakout(plan, grid);
    const after: number[] = [];
    for (let x = 20; x < 40; x++) for (let z = 28; z < 46; z++) for (let y = 0; y < 30; y++) after.push(grid.densityAt(x, y, z));
    expect(after).toEqual(before);
  });

  it('returns null for an empty plan', () => {
    expect(predictBreakout(assembleBlastPlan([], {}), grid)).toBeNull();
  });

  it('returns null when holes exist but none is charged', () => {
    const holes = createGridPlan({ nextHoleId: 1 }, ORIGIN, 3, 3, 4, 8, D89);
    expect(predictBreakout(assembleBlastPlan(holes, {}), grid)).toBeNull();
  });
});

describe('breakoutWarningKind', () => {
  const base: BreakoutPrediction = { brokenVoxels: 100, sealedVoxels: 0, sealedShare: 0, tooDeepHoleIds: [], chargedHoleCount: 9, fragmented: [], sealedKeys: new Set<string>() };

  it("is 'none' when nothing breaks out (all rock sealed)", () => {
    const { plan } = shot(12, 'krackle', 10);
    expect(breakoutWarningKind(predictBreakout(plan, grid)!)).toBe('none');
  });

  it("is 'partial' once the sealed share reaches the mediocre threshold but some rock opens", () => {
    const p = { ...base, sealedVoxels: 30, sealedShare: BLAST_SEALED_SHARE_PARTIAL + 0.05, tooDeepHoleIds: ['h1'] };
    expect(breakoutWarningKind(p)).toBe('partial');
  });

  it("is 'partial' exactly at the threshold", () => {
    expect(breakoutWarningKind({ ...base, sealedShare: BLAST_SEALED_SHARE_PARTIAL, sealedVoxels: 25 })).toBe('partial');
  });

  it('is null below the threshold', () => {
    expect(breakoutWarningKind({ ...base, sealedShare: BLAST_SEALED_SHARE_PARTIAL - 0.01, sealedVoxels: 24 })).toBeNull();
  });

  it('is null for the default shot', () => {
    const { plan } = shot(8, 'krackle', 8);
    expect(breakoutWarningKind(predictBreakout(plan, grid)!)).toBeNull();
  });

  it("warns 'partial' for the 10 m Krackle shot (about a third of its rock stays sealed)", () => {
    const { plan } = shot(10, 'krackle', 10);
    const p = predictBreakout(plan, grid)!;
    expect(p.sealedShare).toBeGreaterThanOrEqual(BLAST_SEALED_SHARE_PARTIAL);
    expect(p.sealedShare).toBeLessThan(1);
    expect(breakoutWarningKind(p)).toBe('partial');
  });
});

describe('predictBreakout fragmented and sealedKeys (#2053)', () => {
  it('fragmented lists every broken voxel, one entry per voxel', () => {
    const { plan } = shot(10, 'krackle', 10);
    const p = predictBreakout(plan, grid)!;
    expect(p.fragmented.length).toBe(p.brokenVoxels);
    expect(new Set(p.fragmented.map(v => `${v.x},${v.y},${v.z}`)).size).toBe(p.brokenVoxels);
  });

  it('sealedKeys holds exactly sealedVoxels keys, all among the broken voxels', () => {
    const { plan } = shot(10, 'krackle', 10);
    const p = predictBreakout(plan, grid)!;
    expect(p.sealedVoxels).toBeGreaterThan(0);
    expect(p.sealedKeys.size).toBe(p.sealedVoxels);
    const broken = new Set(p.fragmented.map(v => `${v.x},${v.y},${v.z}`));
    for (const key of p.sealedKeys) expect(broken.has(key)).toBe(true);
  });

  it('a total seal marks every broken voxel sealed', () => {
    const { plan } = shot(12, 'krackle', 10);
    const p = predictBreakout(plan, grid)!;
    expect(p.sealedKeys.size).toBe(p.brokenVoxels);
    expect(p.fragmented.every(v => isVoxelSealed(p, v.x, v.y, v.z))).toBe(true);
  });

  it('a clean breakout seals few voxels, so most broken voxels read unsealed', () => {
    const { plan } = shot(8, 'krackle', 8);
    const p = predictBreakout(plan, grid)!;
    expect(p.fragmented.length).toBeGreaterThan(0);
    const unsealed = p.fragmented.filter(v => !isVoxelSealed(p, v.x, v.y, v.z)).length;
    expect(unsealed).toBe(p.brokenVoxels - p.sealedVoxels);
    expect(unsealed).toBeGreaterThan(p.brokenVoxels / 2);
  });

  it('isVoxelSealed is false for a voxel that did not break', () => {
    const { plan } = shot(12, 'krackle', 10);
    const p = predictBreakout(plan, grid)!;
    expect(isVoxelSealed(p, 0, 0, 0)).toBe(false);
  });

  it('isVoxelSealed reads the key set', () => {
    const p = { sealedKeys: new Set(['1,2,3']) };
    expect(isVoxelSealed(p, 1, 2, 3)).toBe(true);
    expect(isVoxelSealed(p, 3, 2, 1)).toBe(false);
  });
});
