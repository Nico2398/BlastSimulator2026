// #2123: the probe opening's reference shot is centred on the site's starter deposit.
import { describe, it, expect } from 'vitest';
import { createGameEngine } from '../../../scripts/shared/command-runner.js';
import { runCommand } from '../../../src/console/createRunner.js';
import { terrainConfigOf } from '../../../src/console/commands/world.js';
import { resolveStarterDeposit } from '../../../src/core/world/StarterDeposit.js';
import { starterShotOrigin } from '../../../scripts/shared/probe-strategies.js';
import type { GameState } from '../../../src/core/state/GameState.js';

/** Default span of the reference shot: 3x3 holes at spacing 4. */
const DEFAULT_SPAN = 8;

function sandboxState(biome: string, seed: number): GameState {
  const engine = createGameEngine();
  const result = runCommand(engine, `sandbox start biome:${biome} kit:digger seed:${seed}`);
  expect(result.success).toBe(true);
  return engine.ctx.state!;
}

function depositOf(state: GameState): { x: number; z: number } {
  const config = terrainConfigOf(state);
  expect(config).not.toBeNull();
  const deposit = resolveStarterDeposit(config!);
  expect(deposit).not.toBeNull();
  return { x: deposit!.x, z: deposit!.z };
}

describe('starterShotOrigin', () => {
  it('centres the default 8 m shot on the desert_badlands seed 42 starter deposit', () => {
    const state = sandboxState('desert_badlands', 42);
    const c = depositOf(state);
    const origin = starterShotOrigin(state);
    expect(origin).not.toBeNull();
    expect(origin!.x).toBe(c.x - DEFAULT_SPAN / 2);
    expect(origin!.z).toBe(c.z - DEFAULT_SPAN / 2);
  });

  it('centres the default shot on the green_foothills seed 7 starter deposit', () => {
    const state = sandboxState('green_foothills', 7);
    const c = depositOf(state);
    const origin = starterShotOrigin(state);
    expect(origin).not.toBeNull();
    expect(origin!.x).toBe(c.x - DEFAULT_SPAN / 2);
    expect(origin!.z).toBe(c.z - DEFAULT_SPAN / 2);
  });

  it('the footprint midpoint (origin + span/2) lands on the deposit centre on both axes', () => {
    for (const [biome, seed] of [['desert_badlands', 42], ['green_foothills', 7]] as const) {
      const state = sandboxState(biome, seed);
      const c = depositOf(state);
      const origin = starterShotOrigin(state)!;
      expect(origin.x + DEFAULT_SPAN / 2).toBe(c.x);
      expect(origin.z + DEFAULT_SPAN / 2).toBe(c.z);
    }
  });

  it('honours a custom span', () => {
    const state = sandboxState('desert_badlands', 42);
    const c = depositOf(state);
    const origin = starterShotOrigin(state, 12);
    expect(origin).not.toBeNull();
    expect(origin!.x).toBe(c.x - 6);
    expect(origin!.z).toBe(c.z - 6);
    const narrow = starterShotOrigin(state, 4)!;
    expect(narrow.x).toBe(c.x - 2);
    expect(narrow.z).toBe(c.z - 2);
  });

  it('a zero span puts the origin on the deposit centre', () => {
    const state = sandboxState('green_foothills', 7);
    const c = depositOf(state);
    expect(starterShotOrigin(state, 0)).toEqual({ x: c.x, z: c.z });
  });

  it('is deterministic for one site and differs between sites', () => {
    const a = starterShotOrigin(sandboxState('desert_badlands', 42));
    const b = starterShotOrigin(sandboxState('desert_badlands', 42));
    expect(a).toEqual(b);
    const other = starterShotOrigin(sandboxState('green_foothills', 7));
    expect(other).not.toBeNull();
    expect(other).not.toEqual(a);
  });

  it('returns null when the site has ore deposits off', () => {
    const state = sandboxState('desert_badlands', 42);
    state.world!.oreDeposits = false;
    expect(starterShotOrigin(state)).toBeNull();
  });

  it('returns null when the state carries no world to derive terrain from', () => {
    const state = sandboxState('desert_badlands', 42);
    const bare = { ...state, world: undefined } as unknown as GameState;
    expect(starterShotOrigin(bare)).toBeNull();
  });

  it('returns null for a campaign level state (ore deposits off)', () => {
    const engine = createGameEngine();
    const result = runCommand(engine, 'new_game seed:42');
    expect(result.success).toBe(true);
    const state = engine.ctx.state!;
    expect(resolveStarterDeposit(terrainConfigOf(state)!)).toBeNull();
    expect(starterShotOrigin(state)).toBeNull();
  });
});
