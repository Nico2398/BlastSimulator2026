// BlastSimulator2026 — Integration: sandbox kits, new games and campaign levels open with no explosive stock (#2153)
//
// Nothing starts in a warehouse any more. A sandbox kit's first shot is bought with cash as each hole is loaded,
// at list price, and the opening cash is the kit table's figure untouched.

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import type { GameContext } from '../../src/console/commands/world.js';
import type { GameState } from '../../src/core/state/GameState.js';
import { recordProfit } from '../../src/core/campaign/Campaign.js';
import { SANDBOX_KITS } from '../../src/core/campaign/Sandbox.js';
import { getExplosive } from '../../src/core/world/ExplosiveCatalog.js';
import { computeVoxelColumnSurfaceY, type VoxelGrid } from '../../src/core/world/VoxelGrid.js';
import { SANDBOX_FLAT_PAD_SIZE } from '../../src/core/config/balance.js';
import { playTick } from '../helpers/playthrough.js';

const BIOMES = ['desert_badlands', 'green_foothills', 'red_canyon', 'alpine_granite', 'tropical_karst', 'volcanic_flats'] as const;
const KITS = ['digger', 'full'] as const;
const TIMEOUT = 120_000;

function start(kit: string, biome = 'desert_badlands', seed = 1) {
  const { runner, ctx } = createRunner();
  const res = runner.run(`sandbox start biome:${biome} kit:${kit} seed:${seed}`);
  expect(res.success, res.output).toBe(true);
  return { runner, ctx, state: ctx.state! };
}

/** True when any building carries the removed field, even empty. */
const carriesStockField = (state: GameState): boolean =>
  state.buildings.buildings.some(b => 'storedExplosives' in b);

describe('sandbox kits open with no explosive stock (#2153)', () => {
  it.each(KITS)('%s kit: no building has a storedExplosives field', (kit) => {
    expect(carriesStockField(start(kit).state)).toBe(false);
  });

  it.each(BIOMES)('%s: no stock for either kit across seeds', (biome) => {
    for (const kit of KITS) for (const seed of [1, 7]) {
      expect(carriesStockField(start(kit, biome, seed).state), `${kit} ${biome} ${seed}`).toBe(false);
    }
  }, TIMEOUT);

  it('the opening cash is the kit table figure and nothing is spent', () => {
    for (const kit of KITS) {
      const { state } = start(kit);
      expect(state.cash, kit).toBe(SANDBOX_KITS[kit].startingCash);
      expect(state.finances.transactions.filter(t => t.type === 'expense'), kit).toHaveLength(0);
    }
  });

  it('a second start in the same process is just as empty', () => {
    start('digger');
    expect(carriesStockField(start('digger').state)).toBe(false);
  });
});

describe('new games and campaign levels hold no stock (#2153)', () => {
  it('new_game staffed:true opens with no stock field anywhere', () => {
    const { runner, ctx } = createRunner();
    expect(runner.run('new_game seed:42 size:32 staffed:true').success).toBe(true);
    expect(carriesStockField(ctx.state!)).toBe(false);
  });

  it.each(['tutorial_pit', 'dusty_hollow', 'grumpstone_ridge'])('%s opens with no stock field', (levelId) => {
    const { runner, ctx } = createRunner();
    recordProfit(ctx.campaignProfile.campaign, 'tutorial_pit', 5000);
    recordProfit(ctx.campaignProfile.campaign, 'dusty_hollow', 80000);
    const res = runner.run(`campaign start level:${levelId}`);
    expect(res.success, res.output).toBe(true);
    expect(carriesStockField(ctx.state!)).toBe(false);
  });
});

function flattestPad(grid: VoxelGrid): { x0: number; z0: number } {
  const size = SANDBOX_FLAT_PAD_SIZE;
  let best = { x0: 0, z0: 0, spread: Infinity };
  for (let x0 = 0; x0 + size <= grid.sizeX; x0 += 3) {
    for (let z0 = 0; z0 + size <= grid.sizeZ; z0 += 3) {
      let lo = Infinity, hi = -Infinity, oreCells = 0;
      for (let x = x0; x < x0 + size; x++) for (let z = z0; z < z0 + size; z++) {
        const y = computeVoxelColumnSurfaceY(grid, x, z)!;
        lo = Math.min(lo, y); hi = Math.max(hi, y);
        for (let d = 0; d < 8; d++) if (grid.oresAt(x, y - d, z)) oreCells++;
      }
      if (oreCells > 0 && hi - lo < best.spread) best = { x0, z0, spread: hi - lo };
    }
  }
  return best;
}

describe('the first shot of a sandbox kit is paid from cash at loading (#2153)', () => {
  it('digger kit: three holes loaded cost list price each, booked as they load', () => {
    const { runner, ctx, state } = start('digger', 'desert_badlands', 12345);
    const run = (c: string) => runner.run(c);
    state.events.eventFreqMultiplier = 0;
    const refresh = () => { for (const e of state.employees.employees) e.fatigue = 100; };
    refresh();
    const pad = flattestPad((ctx as GameContext).grid!);

    expect(run(`drill_plan grid rows:1 cols:3 spacing:4 depth:8 start:${pad.x0 + 1},${pad.z0 + 1}`)).toMatchObject({ success: true });
    for (let n = 0; n < 1500 && state.plannedDrillHoles.length > 0; n++) { refresh(); playTick(run, state); }
    expect(state.drillHoles).toHaveLength(3);

    const expenses = () => state.finances.transactions.filter(t => t.category === 'explosives');
    expect(expenses()).toHaveLength(0);
    const cashBefore = state.cash;
    expect(run('charge hole:* explosive:krackle amount:5 stemming:2')).toMatchObject({ success: true });
    expect(state.cash).toBe(cashBefore);

    for (let n = 0; n < 1500 && Object.keys(state.chargesByHole).length < 3; n++) { refresh(); playTick(run, state); }
    expect(Object.keys(state.chargesByHole)).toHaveLength(3);

    const perHole = 5 * getExplosive('krackle')!.costPerKg;
    expect(expenses()).toHaveLength(3);
    for (const t of expenses()) expect(t.amount).toBeCloseTo(perHole, 6);
    for (const c of Object.values(state.chargesByHole)) expect('fromStockKg' in c).toBe(false);
  }, 300_000);
});
