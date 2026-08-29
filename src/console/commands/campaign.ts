// BlastSimulator2026 — Console commands for Phase 7: Campaign, Win/Lose, Stats

import type { CommandResult } from '../ConsoleRunner.js';
import type { GameContext } from './world.js';
import { regenerateGrid } from './world.js';
import { getAllLevels, getLevel } from '../../core/campaign/Level.js';
import { getLevelProgress, createCampaignState } from '../../core/campaign/Campaign.js';
import { addIncome } from '../../core/economy/Finance.js';
import { createGameForLevel } from '../../core/campaign/LevelTransition.js';
import { getBiome } from '../../core/world/BiomeCatalog.js';
import { calculateStarRating } from '../../core/campaign/SuccessTracker.js';
import { Random } from '../../core/math/Random.js';
import { generateContracts } from '../../core/economy/Contract.js';
import { sanitizeFiniteOverride, parseStaffedFlag, staffedSuffix } from './commandUtils.js';
import { t } from '../../core/i18n/I18n.js';
// ── campaign status ──

export function campaignStatusCommand(
  ctx: GameContext,
  _args: string[],
  _named: Record<string, string>,
): CommandResult {
  if (!ctx.state) {
    return { success: false, output: t('console.no_game_loaded') };
  }
  const campaign = ctx.state.campaign;
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
  if (campaign.campaignComplete) {
    lines.push('🏆 CAMPAIGN COMPLETE!');
  }
  const active = campaign.activeLevelId ?? '(world map)';
  lines.push(`Active: ${active}`);
  return { success: true, output: lines.join('\n') };
}

// ── campaign complete (debug) ──

export function campaignCompleteCommand(
  ctx: GameContext,
  _args: string[],
  _named: Record<string, string>,
): CommandResult {
  if (!ctx.state) {
    return { success: false, output: t('console.no_game_loaded') };
  }
  const levelId = ctx.state.campaign.activeLevelId;
  if (!levelId) {
    return { success: false, output: t('campaign.no_active_level') };
  }
  const level = getLevel(levelId);
  if (!level) return { success: false, output: t('campaign.complete_unknown_level', { levelId }) };

  // Force-complete: add a large income transaction to push profit over threshold
  addIncome(ctx.state.finances, level.unlockThreshold, 'contracts', 'debug:force_complete', ctx.state.tickCount);
  ctx.state.cash = ctx.state.finances.cash;
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

  // No prior game means no prior progress either — a fresh CampaignState is
  // exactly what a preceding `new_game` would have produced, since neither
  // this command nor createGameForLevel reads anything else off the old
  // state. main.ts's own WorldMap "Start Level" handler already relies on
  // this equivalence (`ctx.state ? [] : ['new_game']`) to skip a redundant
  // new_game before a player's very first level; this makes the console
  // command itself tolerate the same case instead of erroring on it.
  const campaign = ctx.state?.campaign ?? createCampaignState();

  // `staffed:`, mirroring new_game/sandbox start's own opt-in (#551): a
  // pre-hired roster and pre-purchased fleet, so a scenario that only needs
  // an ordinary staffed opening does not have to hire/license/buy/assign it
  // by hand on every campaign level.
  const staffedFlag = parseStaffedFlag(named['staffed']);
  if (staffedFlag.error) {
    return { success: false, output: staffedFlag.error };
  }

  const newState = createGameForLevel(campaign, levelId, staffedFlag.staffed);
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
    sizeY: level.gridY,
    sizeZ: level.gridZ,
    mixedRockHardness: level.mixedRockHardness,
  });

  // Generate initial contracts so they're available immediately
  const contractRng = new Random(ctx.state.seed + ctx.state.tickCount);
  generateContracts(ctx.state.contracts, contractRng, ctx.state.tickCount);

  // Report the cash actually in hand, not the level default — an override that
  // took effect but printed the default would be indistinguishable from one
  // that was silently ignored, which is the bug this override exists to fix.
  return {
    success: true,
    output: t('campaign.start_success', {
      levelId,
      gridX: level.gridX,
      gridY: level.gridY,
      gridZ: level.gridZ,
      cash: ctx.state.cash.toLocaleString('en-US'),
      staffedSuffix: staffedSuffix(staffedFlag.staffed),
    }),
  };
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
