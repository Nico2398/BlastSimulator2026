// Sandbox mode — through the real console runner and game loop

import { describe, it, expect, beforeEach } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import type { ConsoleRunner } from '../../src/console/ConsoleRunner.js';
import type { GameContext } from '../../src/console/commands/world.js';
import { parseSandboxArgs } from '../../src/console/commands/sandbox.js';
import { SANDBOX_DEFAULTS } from '../../src/core/campaign/Sandbox.js';
import type { VoxelGrid } from '../../src/core/world/VoxelGrid.js';

/** Solid-voxel count — a cheap fingerprint of a generated map. */
function solidCount(grid: VoxelGrid): number {
  let n = 0;
  grid.forEachSolid(() => { n++; });
  return n;
}

describe('sandbox mode', () => {
  let runner: ConsoleRunner;
  let ctx: GameContext;

  beforeEach(() => {
    const made = createRunner();
    runner = made.runner;
    ctx = made.ctx;
  });

  it('starts a site from nothing — no new_game needed first', () => {
    const result = runner.run('sandbox start biome:alpine_granite seed:777 size:48 depth:24');
    expect(result.success).toBe(true);
    expect(ctx.state).toBeTruthy();
    expect(ctx.grid).toBeTruthy();
    expect(ctx.state!.world).toMatchObject({ sizeX: 48, sizeY: 24, sizeZ: 48 });
  });

  it('applies every parameter it is given', () => {
    runner.run('sandbox start biome:red_canyon seed:31337 size:56 depth:28 cash:250000 events:0 prices:2');
    expect(ctx.state!.seed).toBe(31337);
    expect(ctx.state!.cash).toBe(250000);
    expect(ctx.grid!.sizeX).toBe(56);
  });

  it('rebuilds an identical map from the same seed and settings', () => {
    const args = 'sandbox start biome:green_foothills seed:2024 size:48 depth:24';
    runner.run(args);
    const first = solidCount(ctx.grid!);

    const second = createRunner();
    second.runner.run(args);
    expect(solidCount(second.ctx.grid!)).toBe(first);
    expect(second.ctx.grid!.sizeX).toBe(ctx.grid!.sizeX);
  });

  it('produces a different map for a different seed', () => {
    runner.run('sandbox start biome:green_foothills seed:1 size:48 depth:24');
    const a = solidCount(ctx.grid!);

    const other = createRunner();
    other.runner.run('sandbox start biome:green_foothills seed:99999 size:48 depth:24');
    expect(solidCount(other.ctx.grid!)).not.toBe(a);
  });

  it('rejects an unknown biome instead of silently substituting one', () => {
    const result = runner.run('sandbox start biome:atlantis');
    expect(result.success).toBe(false);
    expect(result.output).toContain('Unknown biome');
  });

  it('clamps an absurd size rather than trying to build it', () => {
    const result = runner.run('sandbox start size:100000');
    expect(result.success).toBe(true);
    expect(ctx.grid!.sizeX).toBeLessThanOrEqual(160);
  });

  it('is playable: a blast on a sandbox site removes rock', () => {
    runner.run('sandbox start biome:desert_badlands seed:42 size:48 depth:24 cash:500000');
    const before = solidCount(ctx.grid!);

    runner.run('drill_plan grid rows:3 cols:3 spacing:4 depth:6 start:20,20');
    runner.run('charge hole:* explosive:boomite amount:5 stemming:2');
    runner.run('sequence auto');
    const blast = runner.run('blast');

    expect(blast.success).toBe(true);
    expect(solidCount(ctx.grid!)).toBeLessThan(before);
  });

  it('generates contracts so the economy is live from the first tick', () => {
    runner.run('sandbox start seed:5 size:48 depth:24');
    expect(ctx.state!.contracts.available.length).toBeGreaterThan(0);
  });
});

describe('parseSandboxArgs', () => {
  it('leaves unmentioned keys alone so defaults survive', () => {
    expect(parseSandboxArgs({ size: '48' })).toEqual({ size: 48 });
  });

  it('reads seed:random as a fresh seed in range', () => {
    const parsed = parseSandboxArgs({ seed: 'random' });
    expect(parsed.seed).toBeGreaterThanOrEqual(0);
    expect(parsed.seed).toBeLessThanOrEqual(999999);
  });

  it('ignores a non-numeric value rather than yielding NaN', () => {
    expect(parseSandboxArgs({ size: 'huge' })).toEqual({});
  });

  it('splits the explosive list', () => {
    expect(parseSandboxArgs({ explosives: 'boomite, krackle' }).availableExplosives)
      .toEqual(['boomite', 'krackle']);
  });

  it('reads the mixed-rock flag as a real boolean', () => {
    expect(parseSandboxArgs({ mixed_rock: 'true' }).mixedRockHardness).toBe(true);
    expect(parseSandboxArgs({ mixed_rock: 'false' }).mixedRockHardness).toBe(false);
  });

  it('parses a full parameter list the UI would emit', () => {
    const parsed = parseSandboxArgs({
      biome: 'volcanic_flats', seed: '4242', size: '80', depth: '36',
      cash: '150000', goal: '200000', events: '1.5', prices: '0.8',
      decay: '0.07', mixed_rock: 'true', explosives: 'boomite',
    });
    expect(parsed).toEqual({
      biome: 'volcanic_flats', seed: 4242, size: 80, depth: 36,
      startingCash: 150000, unlockThreshold: 200000,
      eventFreqMultiplier: 1.5, contractPriceMultiplier: 0.8,
      scoreDecayRate: 0.07, mixedRockHardness: true,
      availableExplosives: ['boomite'],
    });
    expect(Object.keys(SANDBOX_DEFAULTS)).toEqual(expect.arrayContaining(Object.keys(parsed)));
  });
});
