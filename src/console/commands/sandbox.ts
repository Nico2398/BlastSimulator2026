// BlastSimulator2026 — Sandbox console command
//
// Starts a freely-configured site. Mirrors what the sandbox UI panel does, so
// the mode is reachable from a script (and therefore from the scenario suite)
// and not only by clicking.

import type { CommandResult } from '../ConsoleRunner.js';
import type { GameContext } from './world.js';
import {
  SANDBOX_DEFAULTS,
  SANDBOX_KIT_ORDER,
  resolveSandboxKitId,
  clampSandboxConfig,
  randomSandboxSeed,
  SANDBOX_KITS,
  sandboxLevelDef,
  type SandboxConfig,
} from '../../core/campaign/Sandbox.js';
import { getAllBiomes, getBiome } from '../../core/world/BiomeCatalog.js';
import { createGame, createWorldState } from '../../core/state/GameState.js';
import { generateContracts } from '../../core/economy/Contract.js';
import { stateRubbleStockKg } from '../../core/economy/SpoilHeaps.js';
import { resolveContractOres } from '../../core/campaign/Level.js';
import { Random } from '../../core/math/Random.js';
import { regenerateGrid } from './world.js';
import { isStaffedComposition, resolveStartingSite } from '../../core/state/StartingBuildings.js';
import { staffedSuffix, parseOptionalStaffedFlag } from './commandUtils.js';
import { t } from '../../core/i18n/I18n.js';

/** Named console args → a partial config. Unset keys keep their defaults. Unknown keys (size, cash, …) are ignored. */
export function parseSandboxArgs(named: Record<string, string>): Partial<SandboxConfig> {
  const out: Partial<SandboxConfig> = {};

  if (named['biome'] !== undefined) out.biome = named['biome'];
  // seed:random asks for a fresh map; any number replays a known one.
  if (named['seed'] !== undefined) {
    const seed = named['seed'] === 'random' ? randomSandboxSeed() : Number(named['seed']);
    if (Number.isFinite(seed)) out.seed = seed;
  }
  // Unknown kit values are left unset here; sandboxCommand reports them.
  const rawKit = rawKitArg(named);
  const kit = rawKit === undefined ? undefined : resolveSandboxKitId(rawKit);
  if (kit) out.kit = kit;
  return out;
}

/**
 * The raw `kit:` value, else the legacy `difficulty:` alias (kit wins if both).
 * Resolved separately from parseSandboxArgs so an unknown value can be reported.
 */
function rawKitArg(named: Record<string, string>): string | undefined {
  return named['kit'] ?? named['difficulty'];
}

/**
 * `sandbox start [biome:… kit:digger|full seed:… …]` (`difficulty:` is a legacy alias for `kit:`)
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
    return { success: false, output: t('sandbox.unknown_subcommand', { sub }) };
  }

  const requested = parseSandboxArgs(named);
  if (requested.biome !== undefined && !getBiome(requested.biome)) {
    const valid = getAllBiomes().map(b => b.id).join(', ');
    return { success: false, output: t('sandbox.unknown_biome', { biome: requested.biome, valid }) };
  }
  const rawKit = rawKitArg(named);
  if (rawKit !== undefined && requested.kit === undefined) {
    return { success: false, output: t('sandbox.unknown_kit', { kit: rawKit, valid: SANDBOX_KIT_ORDER.join(', ') }) };
  }

  const flags = parseOptionalStaffedFlag(named['staffed']);
  if (flags.error) {
    return { success: false, output: flags.error };
  }

  const config = clampSandboxConfig(requested);
  const level = sandboxLevelDef(config);
  // Absent: the kit's free site. true: the global staffed roster, no buildings. false: bare.
  const startingSite = resolveStartingSite(level.startingSite, flags.staffed);

  ctx.state = createGame({
    seed: config.seed,
    mineType: config.biome,
    startingCash: level.startingCash,
    eventFreqMultiplier: level.eventFreqMultiplier,
    scoreDecayRate: level.scoreDecayRate,
    ...(startingSite ? { startingSite } : {}),
  });
  ctx.state.world = createWorldState(level.gridX, level.datum, level.gridZ, true);

  regenerateGrid(ctx, {
    seed: config.seed,
    climateBias: level.climateBias,
    sizeX: level.gridX,
    datum: level.datum,
    sizeZ: level.gridZ,
    mixedRockHardness: level.mixedRockHardness,
    ...(level.oreDeposits !== undefined ? { oreDeposits: level.oreDeposits } : {}),
    ...(level.pitMask ? { pitMask: level.pitMask } : {}),
    startingCrew: true,
    fleetMustStayMobile: true,
    ...(startingSite ? { startingBuildings: startingSite.buildings } : {}),
  });

  if (level.market) ctx.state.contracts.market = level.market;
  const contractRng = new Random(ctx.state.seed + ctx.state.tickCount);
  generateContracts(ctx.state.contracts, contractRng, ctx.state.tickCount, level.contractPriceMultiplier, resolveContractOres(ctx.state), stateRubbleStockKg(ctx.state));

  return {
    success: true,
    output: t('sandbox.start_success', {
      gridX: level.gridX,
      gridZ: level.gridZ,
      biome: config.biome,
      kit: t(SANDBOX_KITS[config.kit].labelKey),
      seed: config.seed,
      cash: level.startingCash.toLocaleString('en-US'),
      staffedSuffix: staffedSuffix(isStaffedComposition(startingSite)),
    }),
  };
}

/** Re-exported so callers building a sandbox don't need two imports. */
export { SANDBOX_DEFAULTS };
