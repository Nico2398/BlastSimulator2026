// BlastSimulator2026 — Sandbox console command
//
// Starts a freely-configured site. Mirrors what the sandbox UI panel does, so
// the mode is reachable from a script (and therefore from the scenario suite)
// and not only by clicking.

import type { CommandResult } from '../ConsoleRunner.js';
import type { GameContext } from './world.js';
import {
  SANDBOX_DEFAULTS,
  clampSandboxConfig,
  randomSandboxSeed,
  sandboxLevelDef,
  type SandboxConfig,
} from '../../core/campaign/Sandbox.js';
import { getAllBiomes, getBiome } from '../../core/world/BiomeCatalog.js';
import { createGame } from '../../core/state/GameState.js';
import { generateContracts } from '../../core/economy/Contract.js';
import { Random } from '../../core/math/Random.js';
import { regenerateGrid } from './world.js';

/** Named console args → a partial config. Unset keys keep their defaults. */
export function parseSandboxArgs(named: Record<string, string>): Partial<SandboxConfig> {
  const out: Partial<SandboxConfig> = {};
  const num = (key: string): number | undefined => {
    const raw = named[key];
    if (raw === undefined) return undefined;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  if (named['biome'] !== undefined) out.biome = named['biome'];
  // seed:random asks for a fresh map; any number replays a known one.
  if (named['seed'] !== undefined) {
    const seed = named['seed'] === 'random' ? randomSandboxSeed() : num('seed');
    if (seed !== undefined) out.seed = seed;
  }
  const assign = <K extends keyof SandboxConfig>(key: K, value: number | undefined) => {
    if (value !== undefined) out[key] = value as SandboxConfig[K];
  };
  assign('size', num('size'));
  assign('depth', num('depth'));
  assign('startingCash', num('cash'));
  assign('unlockThreshold', num('goal'));
  assign('eventFreqMultiplier', num('events'));
  assign('contractPriceMultiplier', num('prices'));
  assign('scoreDecayRate', num('decay'));
  if (named['mixed_rock'] !== undefined) out.mixedRockHardness = named['mixed_rock'] === 'true';
  if (named['explosives'] !== undefined) {
    out.availableExplosives = named['explosives'].split(',').map(s => s.trim()).filter(Boolean);
  }
  return out;
}

/**
 * `sandbox start [biome:… seed:… size:… …]`
 *
 * Unlike `campaign start`, this needs no prior `new_game` and is gated by no
 * unlock: a sandbox site is created from nothing, which is the whole point of
 * the mode.
 */
export function sandboxCommand(
  ctx: GameContext,
  args: string[],
  named: Record<string, string>,
): CommandResult {
  const sub = args[0] ?? 'start';
  if (sub !== 'start') {
    return { success: false, output: `Unknown sub-command: "${sub}". Use: start` };
  }

  const requested = parseSandboxArgs(named);
  if (requested.biome !== undefined && !getBiome(requested.biome)) {
    const valid = getAllBiomes().map(b => b.id).join(', ');
    return { success: false, output: `Unknown biome: "${requested.biome}". Valid: ${valid}` };
  }

  const config = clampSandboxConfig(requested);
  const level = sandboxLevelDef(config);

  ctx.state = createGame({
    seed: config.seed,
    mineType: config.biome,
    startingCash: config.startingCash,
    eventFreqMultiplier: config.eventFreqMultiplier,
  });
  ctx.state.world = { sizeX: level.gridX, sizeY: level.gridY, sizeZ: level.gridZ, gridReady: true };

  regenerateGrid(ctx, {
    seed: config.seed,
    climateBias: level.climateBias,
    sizeX: level.gridX,
    sizeY: level.gridY,
    sizeZ: level.gridZ,
    mixedRockHardness: config.mixedRockHardness,
  });

  const contractRng = new Random(ctx.state.seed + ctx.state.tickCount);
  generateContracts(ctx.state.contracts, contractRng, ctx.state.tickCount);

  return {
    success: true,
    output: `Sandbox started. ${level.gridX}x${level.gridY}x${level.gridZ} ${config.biome}, seed ${config.seed}, cash $${config.startingCash.toLocaleString('en-US')}.`,
  };
}

/** Re-exported so callers building a sandbox don't need two imports. */
export { SANDBOX_DEFAULTS };
