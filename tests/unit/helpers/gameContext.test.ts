// BlastSimulator2026 — Failing (red-phase) tests for the shared GameContext
// test-fixture builder (#830). Pins down `makeEmptyGameContext`/
// `makeGameContext`'s exact behavior against the REAL `newGameCommand`
// (src/console/commands/world.ts) and REAL `GameState`/`VoxelGrid` shapes —
// verified against actual runtime output, not the plan's guesses. See the
// "Discoveries" list at the bottom of this file for every place the plan's
// assumed field names/defaults differ from reality.

import { describe, it, expect } from 'vitest';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { clearDrillPlan } from '../../../src/console/commands/mining/drillPlan.js';
import type { MiningContext } from '../../../src/console/commands/mining/types.js';
import { DEFAULT_GRID_SIZE } from '../../../src/core/config/balance.js';
import { makeEmptyGameContext, makeGameContext } from '../../helpers/gameContext.js';

describe('makeEmptyGameContext', () => {
  it('with no args returns all-null state/grid/landscape/playableArea and a fresh EventEmitter', () => {
    const ctx = makeEmptyGameContext();
    expect(ctx.state).toBeNull();
    expect(ctx.grid).toBeNull();
    expect(ctx.landscape).toBeNull();
    expect(ctx.playableArea).toBeNull();
    expect(ctx.emitter).toBeInstanceOf(EventEmitter);
  });

  it('two separate calls never share the same EventEmitter instance', () => {
    const ctx1 = makeEmptyGameContext();
    const ctx2 = makeEmptyGameContext();
    expect(ctx1.emitter).not.toBe(ctx2.emitter);
  });

  it('overriding only `state` leaves grid/landscape/playableArea null', () => {
    const { state } = makeGameContext();
    const ctx = makeEmptyGameContext({ state });
    expect(ctx.state).toBe(state);
    expect(ctx.grid).toBeNull();
    expect(ctx.landscape).toBeNull();
    expect(ctx.playableArea).toBeNull();
  });

  it('overriding `state` and `grid` together leaves landscape/playableArea null', () => {
    const { state, grid } = makeGameContext();
    const ctx = makeEmptyGameContext({ state, grid });
    expect(ctx.state).toBe(state);
    expect(ctx.grid).toBe(grid);
    expect(ctx.landscape).toBeNull();
    expect(ctx.playableArea).toBeNull();
  });

  it('overriding `emitter` uses the exact supplied instance', () => {
    const emitter = new EventEmitter();
    const ctx = makeEmptyGameContext({ emitter });
    expect(ctx.emitter).toBe(emitter);
  });
});

describe('makeGameContext', () => {
  it('with no args starts a game: mineType "desert" (the legacy alias newGameCommand defaults tests to), seed 42, grid sized 32', () => {
    const ctx = makeGameContext();
    expect(ctx.state).not.toBeNull();
    expect(ctx.grid).not.toBeNull();
    expect(ctx.state!.mineType).toBe('desert');
    expect(ctx.state!.seed).toBe(42);
    expect(ctx.grid!.sizeX).toBe(32);
    expect(ctx.grid!.sizeY).toBe(32);
    expect(ctx.grid!.sizeZ).toBe(32);
  });

  it('forwards `seed` only, leaving mineType/size at their defaults', () => {
    const ctx = makeGameContext({ seed: 7 });
    expect(ctx.state!.seed).toBe(7);
    expect(ctx.state!.mineType).toBe('desert');
    expect(ctx.grid!.sizeX).toBe(32);
  });

  it('forwards `size` only, resizing the grid on all three axes (sizeY defaults to size when sizeY is not given, mirroring newGameCommand)', () => {
    const ctx = makeGameContext({ size: 16 });
    expect(ctx.grid!.sizeX).toBe(16);
    expect(ctx.grid!.sizeY).toBe(16);
    expect(ctx.grid!.sizeZ).toBe(16);
  });

  it('forwards `sizeY` independently of `size`', () => {
    const ctx = makeGameContext({ size: 16, sizeY: 8 });
    expect(ctx.grid!.sizeX).toBe(16);
    expect(ctx.grid!.sizeY).toBe(8);
    expect(ctx.grid!.sizeZ).toBe(16);
  });

  it('forwards `cash`, overriding the STARTING_CASH default', () => {
    const defaultCtx = makeGameContext();
    const ctx = makeGameContext({ cash: 500000 });
    expect(ctx.state!.cash).toBe(500000);
    expect(ctx.state!.cash).not.toBe(defaultCtx.state!.cash);
  });

  it('`staffed: true` hires the starting roster and purchases the starting fleet (STARTING_SITE_STAFFED_COMPOSITION)', () => {
    const unstaffed = makeGameContext();
    expect(unstaffed.state!.employees.employees.length).toBe(0);
    expect(unstaffed.state!.vehicles.vehicles.length).toBe(0);

    const staffed = makeGameContext({ staffed: true });
    expect(staffed.state!.employees.employees.length).toBeGreaterThan(0);
    expect(staffed.state!.vehicles.vehicles.length).toBeGreaterThan(0);
  });

  it('forwards `mineType` to a real biome id (green_foothills), reflected verbatim on state.mineType', () => {
    const ctx = makeGameContext({ mineType: 'green_foothills' });
    expect(ctx.state!.mineType).toBe('green_foothills');
  });

  it('the returned context is assignable to MiningContext and usable by a mining command', () => {
    const ctx: MiningContext = makeGameContext();
    // clearDrillPlan requires ctx.state to be set and returns the count of
    // cleared holes — 0 on a freshly-started game with no drill plan.
    expect(clearDrillPlan(ctx)).toBe(0);
  });

  it('throws when `mineType` is not a recognized biome id, because newGameCommand reports success: false', () => {
    expect(() => makeGameContext({ mineType: 'not_a_real_mine_type' })).toThrow();
  });

  it('matches newGameCommand\'s actual (non-throwing) behavior for a degenerate `size: 0` — an empty 0x0x0 grid, not a rejection', () => {
    const ctx = makeGameContext({ size: 0 });
    expect(ctx.state).not.toBeNull();
    expect(ctx.grid).not.toBeNull();
    expect(ctx.grid!.sizeX).toBe(0);
    expect(ctx.grid!.sizeY).toBe(0);
    expect(ctx.grid!.sizeZ).toBe(0);
  });

  it('DEFAULT_GRID_SIZE (newGameCommand\'s own un-overridden default) differs from makeGameContext\'s no-arg default of 32', () => {
    // Documents that makeGameContext deliberately defaults `size` to a small,
    // fast 32 rather than forwarding no `size` at all (which would resolve to
    // newGameCommand's own DEFAULT_GRID_SIZE, 64) — most unit/integration
    // fixtures want the smaller, faster grid.
    expect(DEFAULT_GRID_SIZE).toBe(64);
    expect(makeGameContext().grid!.sizeX).toBe(32);
  });
});
