// BlastSimulator2026 — Integration: the sandbox Digger kit carries its own fragmenter (#2115).
//
// The Digger kit opens with a rock fragmenter and one driver licensed for both the excavator and the
// fragmenter, so boulders from the first blast are broken and sold instead of sitting as
// `no_vehicle_in_fleet` orders. The Full kit keeps its dedicated third driver, and the campaign
// digger kits (Grumpstone Ridge, Treranium Depths) keep their four vehicles and excavator-only driver.

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import type { GameContext } from '../../src/console/commands/world.js';
import type { GameState } from '../../src/core/state/GameState.js';
import { recordProfit } from '../../src/core/campaign/Campaign.js';
import { getLevel } from '../../src/core/campaign/Level.js';
import { SANDBOX_KITS } from '../../src/core/campaign/Sandbox.js';
import { isOversized } from '../../src/core/mining/BlastCalc.js';
import { computeVoxelColumnSurfaceY, type VoxelGrid } from '../../src/core/world/VoxelGrid.js';
import { EXPLOSIVE_DELIVERY_TICKS, SANDBOX_FLAT_PAD_SIZE } from '../../src/core/config/balance.js';
import { fundForDeliveryWait, clearBlastZone, playContracts, playTick } from '../helpers/playthrough.js';

const BIOME = 'desert_badlands';
const OPENING_SEED = 12345;
const POST_BLAST_TICKS = 2000;
const T = 600_000;

function start(kit: string, seed = 1) {
  const { runner, ctx } = createRunner();
  const res = runner.run(`sandbox start biome:${BIOME} kit:${kit} seed:${seed}`);
  expect(res.success, res.output).toBe(true);
  return { runner, ctx, state: ctx.state! };
}

const holders = (state: GameState, category: string) =>
  state.employees.employees.filter(e => e.qualifications.some(q => q.category === category));

describe('sandbox start kit:digger opens with a fragmenter and a dual-licensed driver (#2115)', () => {
  it('has five vehicles including a rock fragmenter and a rock digger', () => {
    const { state } = start('digger');
    expect(state.vehicles.vehicles).toHaveLength(5);
    expect(state.vehicles.vehicles.filter(v => v.type === 'rock_fragmenter')).toHaveLength(1);
    expect(state.vehicles.vehicles.filter(v => v.type === 'rock_digger')).toHaveLength(1);
  });

  it('has four crew, and no driver other than the truck driver and the dual-licensed one', () => {
    const { state } = start('digger');
    expect(state.employees.employees).toHaveLength(4);
    expect(state.employees.employees.filter(e => e.role === 'driver')).toHaveLength(2);
  });

  it('one driver holds both driving.excavator and driving.rock_fragmenter, and nobody else holds either', () => {
    const { state } = start('digger');
    const excavator = holders(state, 'driving.excavator');
    const fragmenter = holders(state, 'driving.rock_fragmenter');
    expect(excavator).toHaveLength(1);
    expect(fragmenter).toHaveLength(1);
    expect(excavator[0]!.id).toBe(fragmenter[0]!.id);
    expect(excavator[0]!.role).toBe('driver');
  });

  it('is the default kit when none is named', () => {
    const { runner, ctx } = createRunner();
    expect(runner.run(`sandbox start biome:${BIOME} seed:1`).success).toBe(true);
    expect(ctx.state!.vehicles.vehicles.some(v => v.type === 'rock_fragmenter')).toBe(true);
    expect(ctx.state!.employees.employees).toHaveLength(4);
  });

  it('keeps the documented starting cash', () => {
    const { state } = start('digger');
    expect(state.cash).toBe(SANDBOX_KITS.digger.startingCash);
    expect(state.cash).toBe(330_000);
  });

  it('staffed:false still opens a bare site', () => {
    const { runner, ctx } = createRunner();
    expect(runner.run(`sandbox start biome:${BIOME} kit:digger seed:1 staffed:false`).success).toBe(true);
    expect(ctx.state!.vehicles.vehicles).toHaveLength(0);
    expect(ctx.state!.employees.employees).toHaveLength(0);
  });
});

describe('sandbox start kit:full is unchanged (#2115)', () => {
  it('has five vehicles, five crew and a dedicated fragmenter driver beside the excavator driver', () => {
    const { state } = start('full');
    expect(state.vehicles.vehicles).toHaveLength(5);
    expect(state.employees.employees).toHaveLength(5);
    expect(state.employees.employees.filter(e => e.role === 'driver')).toHaveLength(3);
    const excavator = holders(state, 'driving.excavator');
    const fragmenter = holders(state, 'driving.rock_fragmenter');
    expect(excavator).toHaveLength(1);
    expect(fragmenter).toHaveLength(1);
    expect(excavator[0]!.id).not.toBe(fragmenter[0]!.id);
  });

  it('keeps the documented starting cash', () => {
    const { state } = start('full');
    expect(state.cash).toBe(SANDBOX_KITS.full.startingCash);
    expect(state.cash).toBe(370_000);
  });
});

describe('campaign digger kits keep their composition (#2115)', () => {
  it.each(['grumpstone_ridge', 'treranium_depths'])('%s opens with four vehicles, no fragmenter, four crew and an excavator-only driver', (levelId) => {
    const { runner, ctx } = createRunner();
    recordProfit(ctx.campaignProfile.campaign, 'tutorial_pit', 5000);
    recordProfit(ctx.campaignProfile.campaign, 'dusty_hollow', 80000);
    recordProfit(ctx.campaignProfile.campaign, 'grumpstone_ridge', 250000);
    const res = runner.run(`campaign start level:${levelId}`);
    expect(res.success, res.output).toBe(true);
    const state = ctx.state!;
    expect(state.vehicles.vehicles).toHaveLength(4);
    expect(state.vehicles.vehicles.some(v => v.type === 'rock_fragmenter')).toBe(false);
    expect(state.employees.employees).toHaveLength(4);
    expect(holders(state, 'driving.rock_fragmenter')).toHaveLength(0);
    expect(holders(state, 'driving.excavator')).toHaveLength(1);
    expect(state.cash).toBe(getLevel(levelId)!.startingCash);
  });
});

// ── C4: the standard opening breaks its boulders and sells ore ──

function refresh(state: GameState): void {
  fundForDeliveryWait(state);
  for (const e of state.employees.employees) e.fatigue = 100;
}

function tickWhile(run: (c: string) => unknown, state: GameState, until: () => boolean, max: number): void {
  for (let n = 0; n < max && !until(); n++) { refresh(state); run('tick 1'); }
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

interface OpeningPlayed {
  state: GameState;
  boulderOrdersSeen: number;
  stuckNoVehicleSamples: number;
  boulderOrdersWorked: boolean;
  oversizedAtBlast: number;
  oversizedAtEnd: number;
  salesIncome: number;
}

function playOpening(): OpeningPlayed {
  const { runner, ctx } = createRunner();
  const run = (c: string) => runner.run(c);
  expect(run(`sandbox start biome:${BIOME} kit:digger seed:${OPENING_SEED}`)).toMatchObject({ success: true });
  const state = ctx.state!;
  state.events.eventFreqMultiplier = 0; // a pending event halts `tick`
  refresh(state);

  const pad = flattestPad((ctx as GameContext).grid!, 5);
  expect(run(`drill_plan grid rows:3 cols:3 spacing:4 depth:5 start:${pad.x0 + 1},${pad.z0 + 1}`)).toMatchObject({ success: true });
  tickWhile(run, state, () => state.plannedDrillHoles.length === 0, 1500);
  expect(run('charge hole:* explosive:krackle amount:4kg stemming:2.5m')).toMatchObject({ success: true });
  tickWhile(run, state, () => Object.keys(state.plannedChargesByHole).length === 0, EXPLOSIVE_DELIVERY_TICKS + 1500);
  clearBlastZone(run, state);
  expect(run('blast detonate')).toMatchObject({ success: true });
  tickWhile(run, state, () => state.lastBlastReport !== null, 600);
  expect(state.lastBlastReport).not.toBeNull();

  const oversizedAtBlast = state.logistics.fragments.filter(f => isOversized(f.fragment.volume)).length;
  const incomeBefore = state.finances.transactions.length;
  const seen = new Set<number>();
  const worked = new Set<number>();
  let stuckNoVehicleSamples = 0;
  for (let i = 0; i < POST_BLAST_TICKS; i++) {
    refresh(state);
    playContracts(run, state);
    playTick(run, state);
    for (const a of state.pendingActions) {
      if (a.type !== 'fragment_debris') continue;
      seen.add(a.id);
      if (a.status !== 'queued') worked.add(a.id);
      if (a.blockedReason === 'no_vehicle_in_fleet') stuckNoVehicleSamples++;
    }
  }
  const salesIncome = state.finances.transactions
    .slice(incomeBefore)
    .filter(t => t.type === 'income' && (t.category === 'sales' || t.category === 'contracts'))
    .reduce((sum, t) => sum + t.amount, 0);
  return {
    state,
    boulderOrdersSeen: seen.size,
    stuckNoVehicleSamples,
    boulderOrdersWorked: worked.size > 0,
    oversizedAtBlast,
    oversizedAtEnd: state.logistics.fragments.filter(f => isOversized(f.fragment.volume)).length,
    salesIncome,
  };
}

describe(`digger kit standard opening on ${BIOME} seed ${OPENING_SEED} (#2115)`, () => {
  let cached: OpeningPlayed | undefined;
  const played = (): OpeningPlayed => (cached ??= playOpening());

  it('the blast leaves boulders for the fragmenter', () => {
    expect(played().oversizedAtBlast).toBeGreaterThan(0);
    expect(played().boulderOrdersSeen).toBeGreaterThan(0);
  }, T);

  it('no fragment_debris order is ever stuck at no_vehicle_in_fleet', () => {
    expect(played().stuckNoVehicleSamples).toBe(0);
  }, T);

  it('fragment_debris orders are being done within 2000 ticks of the blast', () => {
    expect(played().boulderOrdersWorked).toBe(true);
    expect(played().oversizedAtEnd).toBeLessThan(played().oversizedAtBlast);
  }, T);

  it('ore is sold within 2000 ticks of the blast', () => {
    expect(played().salesIncome).toBeGreaterThan(0);
  }, T);
});
