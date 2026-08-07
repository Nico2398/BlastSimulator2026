// BlastSimulator2026 — Sandbox console command
//
// Starts a freely-configured site. Mirrors what the sandbox UI panel does, so
// the mode is reachable from a script (and therefore from the scenario suite)
// and not only by clicking.

import type { CommandResult } from '../ConsoleRunner.js';
import type { GameContext } from './world.js';
import {
  SANDBOX_DEFAULTS,
  SANDBOX_DIFFICULTY_ORDER,
  clampSandboxConfig,
  randomSandboxSeed,
  sandboxLevelDef,
  type SandboxConfig,
} from '../../core/campaign/Sandbox.js';
import { getAllBiomes, getBiome } from '../../core/world/BiomeCatalog.js';
import { createGame, createWorldState } from '../../core/state/GameState.js';
import { generateContracts } from '../../core/economy/Contract.js';
import { Random } from '../../core/math/Random.js';
import { regenerateGrid } from './world.js';

/** Named console args → a partial config. Unset keys keep their defaults. Unknown keys (size, cash, …) are ignored. */
export function parseSandboxArgs(named: Record<string, string>): Partial<SandboxConfig> {
  const out: Partial<SandboxConfig> = {};

  if (named['biome'] !== undefined) out.biome = named['biome'];
  if (named['difficulty'] !== undefined) out.difficulty = named['difficulty'] as SandboxConfig['difficulty'];
  // seed:random asks for a fresh map; any number replays a known one.
  if (named['seed'] !== undefined) {
    const seed = named['seed'] === 'random' ? randomSandboxSeed() : Number(named['seed']);
    if (Number.isFinite(seed)) out.seed = seed;
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
  if (requested.difficulty !== undefined && !SANDBOX_DIFFICULTY_ORDER.includes(requested.difficulty)) {
    const valid = SANDBOX_DIFFICULTY_ORDER.join(', ');
    return { success: false, output: `Unknown difficulty: "${requested.difficulty}". Valid: ${valid}` };
  }

  const config = clampSandboxConfig(requested);
  const level = sandboxLevelDef(config);

  ctx.state = createGame({
    seed: config.seed,
    mineType: config.biome,
    startingCash: level.startingCash,
    eventFreqMultiplier: level.eventFreqMultiplier,
  });
  ctx.state.world = createWorldState(level.gridX, level.gridY, level.gridZ, true);

  regenerateGrid(ctx, {
    seed: config.seed,
    climateBias: level.climateBias,
    sizeX: level.gridX,
    sizeY: level.gridY,
    sizeZ: level.gridZ,
    mixedRockHardness: level.mixedRockHardness,
  });

  const contractRng = new Random(ctx.state.seed + ctx.state.tickCount);
  generateContracts(ctx.state.contracts, contractRng, ctx.state.tickCount);

  return {
    success: true,
    output: `Sandbox started. ${level.gridX}x${level.gridY}x${level.gridZ} ${config.biome}, ` +
      `difficulty ${config.difficulty}, seed ${config.seed}, cash $${level.startingCash.toLocaleString('en-US')}.`,
  };
}

/** Re-exported so callers building a sandbox don't need two imports. */
export { SANDBOX_DEFAULTS };
