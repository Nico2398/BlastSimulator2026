// `sandbox start` leaves a free seismic survey over the starter deposit (#2148).
//
// Same path the menu uses: createRunner -> `sandbox start`. The survey is a gift
// from a "previous owner": no employee hired, no cash spent, no surveyor needed,
// and the Blast Workshop can value a pattern on the deposit straight away.

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../../src/console/createRunner.js';
import type { GameContext } from '../../../src/console/commands/world.js';
import { SANDBOX_KITS } from '../../../src/core/campaign/Sandbox.js';
import { resolveStarterDeposit } from '../../../src/core/world/StarterDeposit.js';
import { createGridPlan } from '../../../src/core/mining/DrillPlan.js';
import { batchCharge } from '../../../src/core/mining/ChargePlan.js';
import { assembleBlastPlan } from '../../../src/core/mining/BlastPlan.js';
import { estimateBlastOre } from '../../../src/core/mining/BlastValueEstimate.js';
import { resolveMarketId } from '../../../src/core/campaign/Level.js';
import { sandboxTerrainConfig } from '../../helpers/sandboxSite.js';

const BIOMES = ['desert_badlands', 'green_foothills', 'red_canyon', 'alpine_granite', 'tropical_karst', 'volcanic_flats'] as const;
const KITS = ['digger', 'full'] as const;
const SEEDS = [1, 42, 12345] as const;
const TIMEOUT = 120_000;

function start(args: string): GameContext {
  const { runner, ctx } = createRunner();
  const res = runner.run(`sandbox start ${args}`.trim());
  expect(res.success, res.output).toBe(true);
  return ctx;
}

function referenceShotOn(d: { x: number; z: number }) {
  const holes = createGridPlan({ nextHoleId: 1 }, { x: d.x - 4, z: d.z - 4 }, 3, 3, 4, 5, 0.15);
  const depths: Record<string, number> = {};
  for (const h of holes) depths[h.id] = h.depth;
  const { charges } = batchCharge(holes.map(h => h.id), depths, 'krackle', 4, 2.5);
  return assembleBlastPlan(holes, charges);
}

const cases = BIOMES.flatMap(biome => KITS.flatMap(kit => SEEDS.map(seed => [biome, kit, seed] as const)));

describe('sandbox start: free starter survey', () => {
  it('C1 the menu defaults leave exactly one seismic survey centred on the starter deposit', () => {
    const ctx = start('');
    const surveys = ctx.state!.surveyResults;
    expect(surveys).toHaveLength(1);
    expect(surveys[0]!.method).toBe('seismic');
    const deposit = resolveStarterDeposit(sandboxTerrainConfig('desert_badlands', 12345))!;
    expect(surveys[0]!.centerX).toBe(deposit.x);
    expect(surveys[0]!.centerZ).toBe(deposit.z);
  }, TIMEOUT);

  it.each(cases)('C1 %s, %s kit, seed %i: one seismic survey on the deposit', (biome, kit, seed) => {
    const ctx = start(`biome:${biome} kit:${kit} seed:${seed}`);
    const deposit = resolveStarterDeposit(sandboxTerrainConfig(biome, seed))!;
    expect(deposit).not.toBeNull();
    const surveys = ctx.state!.surveyResults;
    expect(surveys).toHaveLength(1);
    expect(surveys[0]!.method).toBe('seismic');
    expect([surveys[0]!.centerX, surveys[0]!.centerZ]).toEqual([deposit.x, deposit.z]);
  }, TIMEOUT);

  it('C1 starting a second sandbox replaces the first: still exactly one survey, on the new deposit', () => {
    const { runner, ctx } = createRunner();
    expect(runner.run('sandbox start biome:desert_badlands seed:1').success).toBe(true);
    expect(runner.run('sandbox start biome:green_foothills seed:2').success).toBe(true);
    const deposit = resolveStarterDeposit(sandboxTerrainConfig('green_foothills', 2))!;
    const surveys = ctx.state!.surveyResults;
    expect(surveys).toHaveLength(1);
    expect([surveys[0]!.centerX, surveys[0]!.centerZ]).toEqual([deposit.x, deposit.z]);
  }, TIMEOUT);

  it.each(KITS)('C2 %s kit: no one is hired and cash equals the kit starting cash', (kit) => {
    const ctx = start(`kit:${kit}`);
    const state = ctx.state!;
    expect(state.cash).toBe(SANDBOX_KITS[kit].startingCash);
    expect(state.employees.employees).toHaveLength(SANDBOX_KITS[kit].startingSite.employees.length);
    expect(state.employees.employees.some(e => e.role === 'surveyor')).toBe(false);
  }, TIMEOUT);

  it('C2 the survey is not an ordered or running survey action', () => {
    const ctx = start('');
    expect(ctx.state!.surveyResults).toHaveLength(1);
    expect(ctx.state!.tickCount).toBe(0);
    expect(ctx.state!.surveyResults[0]!.completedTick).toBe(0);
  }, TIMEOUT);

  it.each(KITS)('C3 %s kit: a reference pattern on the deposit has a non-zero ore estimate with no survey ordered', (kit) => {
    const ctx = start(`kit:${kit} seed:42`);
    const state = ctx.state!;
    const deposit = resolveStarterDeposit(sandboxTerrainConfig('desert_badlands', 42))!;
    const plan = referenceShotOn(deposit);
    const estimate = estimateBlastOre(plan, state.surveyResults, ctx.grid!, new Set(), resolveMarketId(state));
    expect(estimate.value).toBeGreaterThan(0);
    expect(estimate.holeCoverage).toBe(1);
  }, TIMEOUT);

  it.each(BIOMES)('C3 %s: the default-kit reference pattern is valued on the deposit', (biome) => {
    const ctx = start(`biome:${biome} seed:1`);
    const state = ctx.state!;
    const deposit = resolveStarterDeposit(sandboxTerrainConfig(biome, 1))!;
    const estimate = estimateBlastOre(referenceShotOn(deposit), state.surveyResults, ctx.grid!, new Set(), resolveMarketId(state));
    expect(estimate.value).toBeGreaterThan(0);
  }, TIMEOUT);

  it('C3 ground far from the deposit stays unvalued: the survey covers the deposit only', () => {
    const ctx = start('');
    const state = ctx.state!;
    const plan = referenceShotOn({ x: 50, z: 50 });
    const estimate = estimateBlastOre(plan, state.surveyResults, ctx.grid!, new Set(), resolveMarketId(state));
    expect(estimate.holeCoverage).toBe(0);
    expect(estimate.value).toBe(0);
  }, TIMEOUT);

  it('a campaign new_game records no starter survey', () => {
    const { runner, ctx } = createRunner();
    expect(runner.run('new_game seed:42').success).toBe(true);
    expect(ctx.state!.surveyResults).toHaveLength(0);
  }, TIMEOUT);
});
