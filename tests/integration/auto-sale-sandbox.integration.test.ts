// BlastSimulator2026 — Integration: stored ore sells itself on the menu-default sandbox (#2145).
//
// A player who never opens the Contracts panel used to hoard every kilo until the warehouse
// filled and hauling stopped. Ore no contract claims is now sold automatically, at a discount,
// once it has waited a few ticks. `contract auto sell off` switches it off.
//
// Opening: desert_badlands, Digger kit, seed 12345, the 3x3 shot on the flattest ore pad and an
// access ramp, as in ore-concentration-2142. The player never accepts or delivers a contract.

import { describe, it, expect, beforeAll } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import type { GameState } from '../../src/core/state/GameState.js';
import { computeVoxelColumnSurfaceY, type VoxelGrid } from '../../src/core/world/VoxelGrid.js';
import { SANDBOX_FLAT_PAD_SIZE } from '../../src/core/config/balance.js';
import { fundForDeliveryWait, clearBlastZone, playTick } from '../helpers/playthrough.js';

const BIOME = 'desert_badlands';
const OPENING_SEED = 12345;
const PLAY_TICKS = 3000;
/** The ramp's top, past the crater's east rim, and its crater-floor end tile. */
const RAMP_REACH_M = 21;
const RAMP_DEPTH_M = 5;
const T = 600_000;

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

const oreKg = (state: GameState): number => Object.values(state.collectedOre).reduce((a, b) => a + b, 0);

/** Opening shot, access ramp, then `PLAY_TICKS` of ordinary play that never touches a contract. */
function playOpening(autoSell: boolean | undefined) {
  const { runner, ctx } = createRunner();
  const run = (c: string) => runner.run(c);
  expect(run(`sandbox start biome:${BIOME} kit:digger seed:${OPENING_SEED}`)).toMatchObject({ success: true });
  const state = ctx.state!;
  state.events.eventFreqMultiplier = 0; // a pending event halts `tick`
  if (autoSell === false) expect(run('contract auto sell off')).toMatchObject({ success: true });
  refresh(state);

  const pad = flattestPad(ctx.grid!, 6);
  const shotX = pad.x0 + 1;
  const shotZ = pad.z0 + 1;
  expect(run(`drill_plan grid rows:3 cols:3 spacing:4 depth:6 start:${shotX},${shotZ}`)).toMatchObject({ success: true });
  tickWhile(run, state, () => state.plannedDrillHoles.length === 0, 1500);
  expect(run('charge hole:* explosive:krackle amount:6 stemming:2')).toMatchObject({ success: true });
  tickWhile(run, state, () => Object.keys(state.plannedChargesByHole).length === 0, 1500);
  clearBlastZone(run, state);
  expect(run('blast detonate')).toMatchObject({ success: true });
  tickWhile(run, state, () => state.lastBlastReport !== null, 600);
  expect(state.lastBlastReport).not.toBeNull();

  const rowZ = shotZ + 4;
  const endX = shotX + 8 + 2;
  expect(run(`build_ramp start:${endX + RAMP_REACH_M},${rowZ} end:${endX},${rowZ} depth:${RAMP_DEPTH_M}`)).toMatchObject({ success: true });

  const cashBeforePlay = state.cash;
  let peakOreKg = 0;
  for (let i = 0; i < PLAY_TICKS; i++) {
    refresh(state);
    playTick(run, state);
    peakOreKg = Math.max(peakOreKg, oreKg(state));
  }
  const salesIncome = state.finances.transactions.filter(tx => tx.type === 'income' && tx.category === 'sales');
  return { state, run, salesIncome, peakOreKg, cashBeforePlay };
}

describe(`default sandbox: unclaimed ore sells itself (${BIOME}, Digger kit, seed ${OPENING_SEED}, #2145)`, () => {
  let played: ReturnType<typeof playOpening>;
  beforeAll(() => { played = playOpening(undefined); }, T);

  it('the player never opened a contract: nothing was accepted by hand', () => {
    const { state } = played;
    const all = [...state.contracts.active, ...state.contracts.completedHistory];
    for (const c of all) expect(c.autoAccepted, `contract #${c.id}`).toBe(true);
  });

  it('ore reached storage after the opening shot', () => {
    expect(played.peakOreKg).toBeGreaterThan(0);
  });

  it('books sales income from the ore without any contract', () => {
    expect(played.salesIncome.length).toBeGreaterThan(0);
    for (const tx of played.salesIncome) expect(tx.amount).toBeGreaterThan(0);
  });

  it('every sales transaction is an auto sale of a named ore', () => {
    for (const tx of played.salesIncome) expect(tx.description).toMatch(/^Auto sale: \w+/);
  });

  it('sold ore left storage: the warehouse holds less ore than was ever hauled in', () => {
    const { state, peakOreKg } = played;
    expect(oreKg(state)).toBeLessThan(peakOreKg);
  });

  it('mine grade counted the sold ore', () => {
    const { state } = played;
    if (state.grade) expect(state.grade.oreDeliveredKg).toBeGreaterThan(0);
  });
});

describe(`autoSell off: ore stays in storage (${BIOME}, Digger kit, seed ${OPENING_SEED}, #2145)`, () => {
  let played: ReturnType<typeof playOpening>;
  beforeAll(() => { played = playOpening(false); }, T);

  it('the switch is recorded', () => {
    expect(played.state.contracts.autoSell).toBe(false);
  });

  it('ore still reaches storage', () => {
    expect(played.peakOreKg).toBeGreaterThan(0);
  });

  it('books no auto sale', () => {
    expect(played.salesIncome.filter(tx => tx.description.startsWith('Auto sale'))).toEqual([]);
  });

  it('keeps every kilo it hauled', () => {
    const { state, peakOreKg } = played;
    expect(oreKg(state)).toBeGreaterThanOrEqual(peakOreKg - 1);
  });

  it('turning it back on sells the stock once the dwell has passed', () => {
    const { state, run } = played;
    expect(run('contract auto sell on')).toMatchObject({ success: true });
    const before = state.finances.transactions.filter(tx => tx.category === 'sales').length;
    for (let i = 0; i < 100; i++) { refresh(state); playTick(run, state); }
    expect(state.finances.transactions.filter(tx => tx.category === 'sales').length).toBeGreaterThan(before);
  });
});
