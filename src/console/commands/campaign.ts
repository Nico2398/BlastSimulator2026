// BlastSimulator2026 — Console commands for Phase 7: Campaign, Win/Lose, Stats

import type { CommandResult } from '../ConsoleRunner.js';
import type { GameContext } from './world.js';
import { regenerateGrid } from './world.js';
import { getAllLevels, getLevel } from '../../core/campaign/Level.js';
import { getLevelProgress, createCampaignState, recordProfit, isCampaignDone, isCampaignLevel } from '../../core/campaign/Campaign.js';
import { addIncome, getFinancialReport } from '../../core/economy/Finance.js';
import { createGameForLevel } from '../../core/campaign/LevelTransition.js';
import { getBiome } from '../../core/world/BiomeCatalog.js';
import { calculateStarRating, snapshotStats } from '../../core/campaign/SuccessTracker.js';
import { Random } from '../../core/math/Random.js';
import { generateContracts } from '../../core/economy/Contract.js';
import { sanitizeFiniteOverride, parseStaffedFlag, staffedSuffix } from './commandUtils.js';
import { t } from '../../core/i18n/I18n.js';
import { mergeCampaignIntoProfile, resetCampaignProfile } from '../../persistence/CampaignProfile.js';
import type { GameState } from '../../core/state/GameState.js';

/**
 * Fold a finished campaign level into the persistent profile: the session's
 * campaign (a no-op when aliased to the profile) and its star rating. Tier 0
 * (tutorial) never touches the profile. Needs `state.levelStats` snapshotted.
 */
export function recordLevelResultInProfile(ctx: GameContext, state: GameState, levelId: string): void {
  const level = getLevel(levelId);
  if (!level || !isCampaignLevel(level)) return;
  const rating = calculateStarRating(state.levelStats, level.unlockThreshold);
  mergeCampaignIntoProfile(ctx.campaignProfile, state.campaign, { [levelId]: rating.stars });
}
// ── campaign status ──

export function campaignStatusCommand(
  ctx: GameContext,
  _args: string[],
  _named: Record<string, string>,
): CommandResult {
  if (!ctx.state) {
    return { success: false, output: t('console.no_game_loaded') };
  }
  const campaign = ctx.campaignProfile.campaign;
  const lines: string[] = ['Campaign Status:'];
  for (const lvl of getAllLevels()) {
    const prog = getLevelProgress(campaign, lvl.id);
    if (!prog) continue;
    const status = !prog.unlocked ? '🔒 Locked'
      : prog.completed ? '✅ Completed'
      : '▶ Unlocked';
    const profit = prog.cumulativeProfit.toLocaleString('en-US');
    const threshold = getLevel(lvl.id)?.unlockThreshold.toLocaleString('en-US') ?? '?';
    lines.push(`  [${lvl.difficultyTier}★] ${lvl.id} — ${status} | Profit: $${profit}/$${threshold}`);
  }
  if (isCampaignDone(campaign)) {
    lines.push(t('campaign.status_complete'));
  }
  const active = ctx.state.campaign.activeLevelId ?? '(world map)';
  lines.push(`Active: ${active}`);
  return { success: true, output: lines.join('\n') };
}

// ── campaign complete (debug) ──

/**
 * Debug force-win. Works on the active level; with `level:<id>` it also
 * activates that level on the running game (unlocking it) so a scenario
 * started by `new_game` can still end as a real campaign win. Grants only the
 * income shortfall below the level's profit threshold, then snapshots the
 * stats so `levelStats.totalWealth` (the state dump's `profit`) reads the
 * threshold rather than a stale pre-completion value.
 */
export function campaignCompleteCommand(
  ctx: GameContext,
  _args: string[],
  named: Record<string, string>,
): CommandResult {
  if (!ctx.state) {
    return { success: false, output: t('console.no_game_loaded') };
  }
  const requested = named['level'];
  if (requested !== undefined) {
    const entry = ctx.state.campaign.levels[requested];
    if (!entry) return { success: false, output: t('campaign.complete_unknown_level', { levelId: requested }) };
    entry.unlocked = true;
    ctx.state.campaign.activeLevelId = requested;
  }
  const levelId = ctx.state.campaign.activeLevelId;
  if (!levelId) {
    return { success: false, output: t('campaign.no_active_level') };
  }
  const level = getLevel(levelId);
  if (!level) return { success: false, output: t('campaign.complete_unknown_level', { levelId }) };

  const shortfall = level.unlockThreshold - getFinancialReport(ctx.state.finances, 0).netProfit;
  if (shortfall > 0) {
    addIncome(ctx.state.finances, shortfall, 'contracts', 'debug:force_complete', ctx.state.tickCount);
  }
  ctx.state.cash = ctx.state.finances.cash;
  snapshotStats(ctx.state.levelStats, ctx.state);
  recordProfit(ctx.state.campaign, levelId, ctx.state.levelStats.totalWealth);
  recordLevelResultInProfile(ctx, ctx.state, levelId);
  ctx.state.levelEnded = true;
  ctx.state.levelEndReason = 'completed';

  return {
    success: true,
    output: t('campaign.force_complete_success', { levelId }),
  };
}

// ── campaign start ──

export function campaignStartCommand(
  ctx: GameContext,
  _args: string[],
  named: Record<string, string>,
): CommandResult {
  const levelId = named['level'];
  if (!levelId) {
    return { success: false, output: t('campaign.start_usage') };
  }

  // Campaign levels (tier > 0) play on the persistent profile itself, so core
  // recordProfit writes progress straight into it. The tutorial and any other
  // mode keep a throwaway campaign and never touch the profile (#1312).
  const target = getLevel(levelId);
  const campaign = target && isCampaignLevel(target) ? ctx.campaignProfile.campaign : createCampaignState();

  // `staffed:`, mirroring new_game/sandbox start's own opt-in (#551): a
  // pre-hired roster and pre-purchased fleet, so a scenario that only needs
  // an ordinary staffed opening does not have to hire/license/buy/assign it
  // by hand on every campaign level.
  const flags = parseStaffedFlag(named['staffed']);
  if (flags.error) {
    return { success: false, output: flags.error };
  }

  const newState = createGameForLevel(campaign, levelId, flags.staffed);
  if (!newState) {
    const lvl = getLevel(levelId);
    if (!lvl) return { success: false, output: t('campaign.start_unknown_level', { levelId }) };
    return { success: false, output: t('campaign.level_locked', { levelId }) };
  }

  ctx.state = newState;
  ctx.state.campaign = campaign;

  // `cash:` override, mirroring new_game's own knob (world.ts). Without it a
  // scenario cannot fund itself at all on a campaign level: createGameForLevel
  // builds a brand-new GameState from `level.startingCash`, so a
  // `new_game cash:N` bump on the preceding step is silently discarded here.
  // That matters now that the console refuses unaffordable purchases — a
  // scenario that legitimately needs a bigger fleet than the level's default
  // cash allows has nowhere else to get it. Debug grant, same class as
  // new_game's, and deliberately applied to both the flat field and the
  // ledger so they cannot disagree (Finding #36's class).
  const cashOverride = named['cash'] !== undefined ? sanitizeFiniteOverride(parseInt(named['cash'], 10)) : undefined;
  if (cashOverride !== undefined) {
    ctx.state.cash = cashOverride;
    ctx.state.finances.cash = cashOverride;
  }

  // Generate terrain
  const level = getLevel(levelId)!;
  const biome = getBiome(level.biome);
  if (!biome) {
    return { success: false, output: t('campaign.unknown_biome', { biome: level.biome }) };
  }
  if (ctx.state.world) ctx.state.world.gridReady = true;
  regenerateGrid(ctx, {
    seed: level.terrainSeed,
    climateBias: level.climateBias,
    sizeX: level.gridX,
    datum: level.datum,
    sizeZ: level.gridZ,
    mixedRockHardness: level.mixedRockHardness,
    startingCrew: true,
  });

  // Generate initial contracts so they're available immediately
  const contractRng = new Random(ctx.state.seed + ctx.state.tickCount);
  generateContracts(ctx.state.contracts, contractRng, ctx.state.tickCount, level.contractPriceMultiplier);

  // Report the cash actually in hand, not the level default — an override that
  // took effect but printed the default would be indistinguishable from one
  // that was silently ignored, which is the bug this override exists to fix.
  return {
    success: true,
    output: t('campaign.start_success', {
      levelId,
      gridX: level.gridX,
      gridZ: level.gridZ,
      cash: ctx.state.cash.toLocaleString('en-US'),
      staffedSuffix: staffedSuffix(flags.staffed),
    }),
  };
}

// ── campaign reset ──

export function campaignResetCommand(
  ctx: GameContext,
  _args: string[],
  _named: Record<string, string>,
): CommandResult {
  resetCampaignProfile(ctx.campaignProfile);
  return { success: true, output: t('campaign.reset_success') };
}

// ── tutorial start ──

export function tutorialStartCommand(
  ctx: GameContext,
  _args: string[],
  _named: Record<string, string>,
): CommandResult {
  if (!ctx.state) {
    return { success: false, output: t('console.no_game_loaded') };
  }
  ctx.state.isPaused = true;
  return { success: true, output: t('campaign.tutorial_started') };
}

// ── stats ──

export function statsCommand(
  ctx: GameContext,
  _args: string[],
  _named: Record<string, string>,
): CommandResult {
  if (!ctx.state) {
    return { success: false, output: t('console.no_game_loaded') };
  }
  const s = ctx.state.levelStats;
  const levelId = ctx.state.campaign.activeLevelId;
  const level = levelId ? getLevel(levelId) : null;

  const ores = [...s.uniqueOresExtracted].join(', ') || 'none';
  const lines = [
    'Level Statistics:',
    `  Total wealth:       $${s.totalWealth.toLocaleString('en-US')}`,
    `  Max depth:          ${s.maxDepthReached} voxels`,
    `  Volume blasted:     ${s.totalVolumeBlasted.toFixed(1)} m³`,
    `  Blasts performed:   ${s.blastsPerformed}`,
    `  Casualties:         ${s.casualties}`,
    `  Best ecology:       ${s.bestEcology.toFixed(1)}`,
    `  Best safety:        ${s.bestSafety.toFixed(1)}`,
    `  Unique ores:        ${ores}`,
  ];

  if (level) {
    const rating = calculateStarRating(s, level.unlockThreshold);
    const stars = '★'.repeat(rating.stars) + '☆'.repeat(3 - rating.stars);
    lines.push(`  Star rating:        ${stars}`);
    lines.push(`    Profit: ${rating.details.profitPass ? '✅' : '❌'} | Safety: ${rating.details.safetyPass ? '✅' : '❌'} | Ecology: ${rating.details.ecologyPass ? '✅' : '❌'}`);
  }

  return { success: true, output: lines.join('\n') };
}
