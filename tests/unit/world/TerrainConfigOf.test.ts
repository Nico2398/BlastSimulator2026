// BlastSimulator2026 — terrainConfigOf and oreIslandsOf: what a game's world generates from and holds (#2286).

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../../src/console/createRunner.js';
import { createGame, type GameState } from '../../../src/core/state/GameState.js';
import { oreIslandsOf, terrainConfigOf } from '../../../src/core/world/TerrainConfigOf.js';
import { terrainConfigOf as terrainConfigViaConsole } from '../../../src/console/commands/world.js';
import { buildTerrainContext } from '../../../src/core/world/TerrainGen.js';
import { ORE_ISLAND_ORE_IDS } from '../../../src/core/config/balance.js';
import { makeGameContext } from '../../helpers/gameContext.js';

function sandboxState(seed: number): GameState {
  const { runner, ctx } = createRunner();
  const result = runner.run(`sandbox start biome:green_foothills seed:${seed}`);
  expect(result.success, result.output).toBe(true);
  return ctx.state!;
}

describe('terrainConfigOf (#2286)', () => {
  it('is still reachable from the console module', () => {
    expect(terrainConfigViaConsole).toBe(terrainConfigOf);
  });

  it('is null for a state with no world', () => {
    const state = createGame({ seed: 1, mineType: 'desert' });
    state.world = undefined as unknown as GameState['world'];
    expect(terrainConfigOf(state)).toBeNull();
  });

  it('carries the state seed and the base world size', () => {
    const state = sandboxState(42);
    const config = terrainConfigOf(state)!;
    expect(config.seed).toBe(state.seed);
    expect(config.sizeX).toBe(state.world!.baseSizeX);
    expect(config.sizeZ).toBe(state.world!.baseSizeZ);
    expect(config.oreDeposits).toBe(true);
  });
});

describe('oreIslandsOf (#2286, C7)', () => {
  it.each([42, 1, 7])('lists the islands of a progression site (seed %i)', (seed) => {
    const state = sandboxState(seed);
    const expected = buildTerrainContext(terrainConfigOf(state)!).oreIslands!.list();
    const islands = oreIslandsOf(state);
    expect(islands.length).toBeGreaterThan(0);
    expect(islands).toEqual(expected);
  });

  it('every island holds known G2 ores and has a positive radius', () => {
    for (const island of oreIslandsOf(sandboxState(42))) {
      expect(island.radius).toBeGreaterThan(0);
      expect(island.oreIds.length).toBeGreaterThan(0);
      for (const id of island.oreIds) expect(ORE_ISLAND_ORE_IDS).toContain(id);
    }
  });

  it('is deterministic for the same state', () => {
    const state = sandboxState(42);
    expect(oreIslandsOf(state)).toEqual(oreIslandsOf(state));
  });

  it('differs between seeds', () => {
    expect(oreIslandsOf(sandboxState(42))).not.toEqual(oreIslandsOf(sandboxState(1)));
  });

  it('is empty for a game with no ore deposits', () => {
    const ctx = makeGameContext({ mineType: 'desert', seed: '42' });
    expect(ctx.state!.world!.oreDeposits).toBeUndefined();
    expect(oreIslandsOf(ctx.state!)).toEqual([]);
  });

  it('is empty when the state has no world', () => {
    const state = createGame({ seed: 1, mineType: 'desert' });
    state.world = undefined as unknown as GameState['world'];
    expect(oreIslandsOf(state)).toEqual([]);
  });

  it('is empty when the mine type names no biome', () => {
    const state = sandboxState(42);
    state.mineType = 'no_such_biome' as GameState['mineType'];
    expect(oreIslandsOf(state)).toEqual([]);
  });
});
