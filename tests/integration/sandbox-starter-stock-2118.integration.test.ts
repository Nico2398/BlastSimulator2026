// BlastSimulator2026 — Integration: sandbox kits open richer and with a stocked explosive warehouse (#2118).
//
// Both sandbox kits start with +150k cash (Digger 480k, Full 520k) and an operating tier-1 explosive
// warehouse holding 100 kg of krackle, placed with the starting buildings at no charge. The first charge
// order therefore draws from stock: no cash-bought delivery wait (EXPLOSIVE_DELIVERY_TICKS), so the first
// blast fires soon after the drill order completes. A campaign level's opening is unchanged.

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import type { GameContext } from '../../src/console/commands/world.js';
import type { GameState } from '../../src/core/state/GameState.js';
import { recordProfit } from '../../src/core/campaign/Campaign.js';
import { getLevel } from '../../src/core/campaign/Level.js';
import { SANDBOX_KITS } from '../../src/core/campaign/Sandbox.js';
import { getExplosivesStockByType } from '../../src/core/entities/Building.js';
import { defaultChargeKg, defaultGridDepthM } from '../../src/core/economy/PermitDefaults.js';
import { computeVoxelColumnSurfaceY, type VoxelGrid } from '../../src/core/world/VoxelGrid.js';
import {
  CHARGE_DEFAULT_STEMMING_M,
  DRILL_GRID_DEFAULT_SPACING_M,
  DRILL_HOLE_DEFAULT_DIAMETER_M,
  EXPLOSIVE_DELIVERY_TICKS,
  SANDBOX_FLAT_PAD_SIZE,
  SANDBOX_STARTER_EXPLOSIVE_ID,
  SANDBOX_STARTER_EXPLOSIVE_KG,
} from '../../src/core/config/balance.js';
import { clearBlastZone, playTick } from '../helpers/playthrough.js';

const BIOMES = ['desert_badlands', 'green_foothills', 'red_canyon', 'alpine_granite', 'tropical_karst', 'volcanic_flats'] as const;
const KITS = ['digger', 'full'] as const;
const OPENING_SEED = 12345;
const BLAST_WINDOW_TICKS = 300;
const TIMEOUT = 120_000;

function start(kit: string, biome = 'desert_badlands', seed = 1) {
  const { runner, ctx } = createRunner();
  const res = runner.run(`sandbox start biome:${biome} kit:${kit} seed:${seed}`);
  expect(res.success, res.output).toBe(true);
  return { runner, ctx, state: ctx.state! };
}

const explosiveWarehouses = (state: GameState) => state.buildings.buildings.filter(b => b.type === 'explosive_warehouse');

describe('C1: sandbox kits start with +150k cash (#2118)', () => {
  it('digger opens with 480,000 and full with 520,000', () => {
    expect(start('digger').state.cash).toBe(480_000);
    expect(start('full').state.cash).toBe(520_000);
  });

  it('the opening cash equals the kit table and full stays above digger', () => {
    expect(start('digger').state.cash).toBe(SANDBOX_KITS.digger.startingCash);
    expect(start('full').state.cash).toBe(SANDBOX_KITS.full.startingCash);
    expect(SANDBOX_KITS.full.startingCash).toBeGreaterThan(SANDBOX_KITS.digger.startingCash);
  });

  it('the opening cash is exactly the kit cash: the starter warehouse is not charged', () => {
    for (const kit of KITS) {
      const { state } = start(kit);
      expect(state.cash, kit).toBe(SANDBOX_KITS[kit].startingCash);
      expect(state.finances.transactions.filter(t => t.type === 'expense'), kit).toHaveLength(0);
    }
  });
});

describe('C2: both kits open with a stocked tier-1 explosive warehouse (#2118)', () => {
  it.each(KITS)('%s kit: one operating tier-1 explosive warehouse holding exactly 100 kg of krackle', (kit) => {
    const { state } = start(kit);
    const warehouses = explosiveWarehouses(state);
    expect(warehouses).toHaveLength(1);
    const w = warehouses[0]!;
    expect(w.tier).toBe(1);
    expect(w.active).toBe(true);
    expect(w.storedExplosives?.['krackle']).toBe(100);
    expect(w.storedExplosives?.[SANDBOX_STARTER_EXPLOSIVE_ID]).toBe(SANDBOX_STARTER_EXPLOSIVE_KG);
    expect(getExplosivesStockByType(state.buildings)['krackle']).toBe(100);
  });

  it.each(KITS)('%s kit: holds nothing but krackle', (kit) => {
    const { state } = start(kit);
    const stock = getExplosivesStockByType(state.buildings);
    expect(Object.keys(stock).filter(id => (stock[id] ?? 0) > 0)).toEqual(['krackle']);
  });

  it.each(KITS)('%s kit: the freight warehouse and spoil heap stay, three buildings in all', (kit) => {
    const { state } = start(kit);
    const types = state.buildings.buildings.map(b => b.type).sort();
    expect(types).toEqual(['explosive_warehouse', 'freight_warehouse', 'spoil_heap']);
    for (const b of state.buildings.buildings) expect(b.active, b.type).toBe(true);
  });

  it('the freight warehouse and spoil heap hold no explosives', () => {
    const { state } = start('digger');
    for (const b of state.buildings.buildings.filter(x => x.type !== 'explosive_warehouse')) {
      expect(Object.values(b.storedExplosives ?? {}).reduce((a, c) => a + c, 0), b.type).toBe(0);
    }
  });

  it.each(BIOMES)('%s: places the stocked warehouse for both kits across seeds', (biome) => {
    for (const kit of KITS) {
      for (const seed of [1, 7]) {
        const { state } = start(kit, biome, seed);
        const w = explosiveWarehouses(state);
        expect(w, `${kit} ${biome} seed ${seed}`).toHaveLength(1);
        expect(w[0]!.storedExplosives?.['krackle'], `${kit} ${biome} seed ${seed}`).toBe(100);
      }
    }
  }, TIMEOUT);

  it('a second start in the same process opens with the full 100 kg again (stock is copied, not shared)', () => {
    const first = start('digger');
    explosiveWarehouses(first.state)[0]!.storedExplosives!['krackle'] = 0;
    const second = start('digger');
    expect(explosiveWarehouses(second.state)[0]!.storedExplosives?.['krackle']).toBe(100);
    const third = start('full');
    expect(explosiveWarehouses(third.state)[0]!.storedExplosives?.['krackle']).toBe(100);
  });
});

describe('C3: a campaign opening is unchanged (#2118)', () => {
  it('EXPLOSIVE_DELIVERY_TICKS is still 400', () => {
    expect(EXPLOSIVE_DELIVERY_TICKS).toBe(400);
  });

  it.each(['tutorial_pit', 'dusty_hollow', 'grumpstone_ridge'])('%s opens with its own cash and no explosive stock', (levelId) => {
    const { runner, ctx } = createRunner();
    recordProfit(ctx.campaignProfile.campaign, 'tutorial_pit', 5000);
    recordProfit(ctx.campaignProfile.campaign, 'dusty_hollow', 80000);
    const res = runner.run(`campaign start level:${levelId}`);
    expect(res.success, res.output).toBe(true);
    const state = ctx.state!;
    expect(state.cash).toBe(getLevel(levelId)!.startingCash);
    expect(explosiveWarehouses(state)).toHaveLength(0);
    expect(Object.values(getExplosivesStockByType(state.buildings)).reduce((a, c) => a + c, 0)).toBe(0);
  });

  it('campaign starting cash is unchanged', () => {
    expect(getLevel('tutorial_pit')!.startingCash).toBe(500_000);
    expect(getLevel('dusty_hollow')!.startingCash).toBe(50_000);
    expect(getLevel('grumpstone_ridge')!.startingCash).toBe(210_000);
    expect(getLevel('treranium_depths')!.startingCash).toBe(125_000);
    expect(getLevel('shareholder_summit')!.startingCash).toBe(900_000);
  });
});

// ── C4: the first charge order draws fully from stock, and the first blast fires soon ──

function refresh(state: GameState): void {
  for (const e of state.employees.employees) e.fatigue = 100;
}

/** Flattest ore-bearing pad of the grid, where the sandbox guarantees a flat drill site. */
function flattestPad(grid: VoxelGrid, depthM: number): { x0: number; z0: number } {
  const size = SANDBOX_FLAT_PAD_SIZE;
  let best = { x0: 0, z0: 0, spread: Infinity };
  for (let x0 = 0; x0 + size <= grid.sizeX; x0 += 3) {
    for (let z0 = 0; z0 + size <= grid.sizeZ; z0 += 3) {
      let lo = Infinity, hi = -Infinity, oreCells = 0;
      for (let x = x0; x < x0 + size; x++) for (let z = z0; z < z0 + size; z++) {
        const y = computeVoxelColumnSurfaceY(grid, x, z)!;
        lo = Math.min(lo, y); hi = Math.max(hi, y);
        for (let d = 0; d < depthM; d++) if (grid.oresAt(x, y - d, z)) oreCells++;
      }
      if (oreCells > 0 && hi - lo < best.spread) best = { x0, z0, spread: hi - lo };
    }
  }
  return best;
}

describe('C4: Digger kit first shot draws its explosives from stock (#2118)', () => {
  it('3x3 at the default depth with the Charge default: no delivery wait, blast within 300 ticks of the drill order', () => {
    const { runner, ctx } = createRunner();
    const run = (c: string) => runner.run(c);
    expect(run(`sandbox start biome:desert_badlands kit:digger seed:${OPENING_SEED}`)).toMatchObject({ success: true });
    const state = ctx.state!;
    state.events.eventFreqMultiplier = 0;
    refresh(state);

    // What the Drill and Charge steps open at for this site.
    const depth = defaultGridDepthM(state.grade?.grade);
    const amount = defaultChargeKg(state.grade?.grade, 9, depth, CHARGE_DEFAULT_STEMMING_M, DRILL_HOLE_DEFAULT_DIAMETER_M);
    const pad = flattestPad((ctx as GameContext).grid!, depth);

    expect(run(`drill_plan grid rows:3 cols:3 spacing:${DRILL_GRID_DEFAULT_SPACING_M} depth:${depth} start:${pad.x0 + 1},${pad.z0 + 1}`)).toMatchObject({ success: true });
    for (let n = 0; n < 1500 && state.plannedDrillHoles.length > 0; n++) { refresh(state); playTick(run, state); }
    expect(state.plannedDrillHoles).toHaveLength(0);
    expect(state.drillHoles).toHaveLength(9);
    const drillDoneTick = state.tickCount;

    expect(run(`charge hole:* explosive:${SANDBOX_STARTER_EXPLOSIVE_ID} amount:${amount} stemming:${CHARGE_DEFAULT_STEMMING_M}`)).toMatchObject({ success: true });

    // The whole order is drawn from stock: no delivery pending, none in transit.
    const orders = state.pendingActions.filter(a => a.type === 'charge_hole');
    expect(orders).toHaveLength(9);
    for (const a of orders) {
      expect(a.payload['deliveryArrivalTick'], 'no cash-bought delivery').toBeUndefined();
      expect(a.payload['orderCost'], 'no cash charged').toBe(0);
    }
    const drawn = orders.reduce((sum, a) => sum + ((a.payload['orderStock'] as { kg: number } | undefined)?.kg ?? 0), 0);
    expect(drawn).toBeCloseTo(9 * amount, 6);
    expect(getExplosivesStockByType(state.buildings)['krackle'] ?? 0).toBeCloseTo(100 - 9 * amount, 6);

    for (let n = 0; n < BLAST_WINDOW_TICKS && Object.keys(state.plannedChargesByHole).length > 0; n++) {
      refresh(state);
      playTick(run, state);
      expect(state.pendingActions.some(a => a.blockedReason === 'explosives_in_transit'), 'no explosives in transit').toBe(false);
    }
    expect(Object.keys(state.plannedChargesByHole)).toHaveLength(0);
    clearBlastZone(run, state);
    expect(run('blast detonate')).toMatchObject({ success: true });
    for (let n = 0; n < BLAST_WINDOW_TICKS && state.lastBlastReport === null; n++) { refresh(state); playTick(run, state); }

    expect(state.lastBlastReport, 'blast fired').not.toBeNull();
    const elapsed = state.tickCount - drillDoneTick;
    expect(elapsed).toBeLessThanOrEqual(BLAST_WINDOW_TICKS);
    expect(elapsed).toBeLessThan(EXPLOSIVE_DELIVERY_TICKS);
  }, 300_000);
});
