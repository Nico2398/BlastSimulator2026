// BlastSimulator2026 — Console commands for Phase 7: Campaign, Win/Lose, Stats

import type { CommandResult } from '../ConsoleRunner.js';
import type { GameContext } from './world.js';
import { getAllLevels, getLevel } from '../../core/campaign/Level.js';
import { getLevelProgress } from '../../core/campaign/Campaign.js';
import { addIncome } from '../../core/economy/Finance.js';
import { createGameForLevel } from '../../core/campaign/LevelTransition.js';
import { generateTerrain } from '../../core/world/TerrainGen.js';
import { getMinePreset } from '../../core/world/MineType.js';
import { calculateStarRating } from '../../core/campaign/SuccessTracker.js';
// ── campaign status ──

export function campaignStatusCommand(
  ctx: GameContext,
  _args: string[],
  _named: Record<string, string>,
): CommandResult {
  if (!ctx.state) {
    return { success: false, output: 'No game loaded. Use new_game first.' };
  }
  const campaign = ctx.state.campaign;
  const lines: string[] = ['Campaign Status:'];
  for (const lvl of getAllLevels()) {
    const prog = getLevelProgress(campaign, lvl.id);
    if (!prog) continue;
    const status = !prog.unlocked ? '🔒 Locked'
      : prog.completed ? '✅ Completed'
      : '▶ Unlocked';
    const profit = prog.cumulativeProfit.toLocaleString();
    const threshold = getLevel(lvl.id)?.unlockThreshold.toLocaleString() ?? '?';
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
    return { success: false, output: 'No game loaded. Use new_game first.' };
  }
  const levelId = ctx.state.campaign.activeLevelId;
  if (!levelId) {
    return { success: false, output: 'No active level. Use campaign start level:<id> first.' };
  }
  const level = getLevel(levelId);
  if (!level) return { success: false, output: `Unknown level: ${levelId}` };

  // Force-complete: add a large income transaction to push profit over threshold
  addIncome(ctx.state.finances, level.unlockThreshold, 'contracts', 'debug:force_complete', ctx.state.tickCount);
  ctx.state.cash = ctx.state.finances.cash;
  ctx.state.levelEnded = true;
  ctx.state.levelEndReason = 'completed';

  return {
    success: true,
    output: `Debug: force-completed level "${levelId}". Profit threshold met.`,
  };
}

// ── campaign start ──

export function campaignStartCommand(
  ctx: GameContext,
  _args: string[],
  named: Record<string, string>,
): CommandResult {
  if (!ctx.state) {
    return { success: false, output: 'No game loaded. Use new_game first.' };
  }
  const levelId = named['level'];
  if (!levelId) {
    return { success: false, output: 'Usage: campaign start level:<id>' };
  }

  const newState = createGameForLevel(ctx.state.campaign, levelId);
  if (!newState) {
    const lvl = getLevel(levelId);
    if (!lvl) return { success: false, output: `Unknown level: "${levelId}".` };
    return { success: false, output: `Level "${levelId}" is locked. Complete previous levels first.` };
  }

  // Preserve campaign state from old game
  const savedCampaign = ctx.state.campaign;
  ctx.state = newState;
  ctx.state.campaign = savedCampaign;

  // Generate terrain
  const level = getLevel(levelId)!;
  const preset = getMinePreset(level.mineType);
  if (!preset) {
    return { success: false, output: `Unknown mine type: ${level.mineType}` };
  }
  ctx.grid = generateTerrain({
    sizeX: level.gridX,
    sizeY: level.gridY,
    sizeZ: level.gridZ,
    seed: level.terrainSeed,
    preset,
  });
  if (ctx.state.world) ctx.state.world.gridReady = true;

  return {
    success: true,
    output: `Started level "${levelId}". Grid: ${level.gridX}×${level.gridY}×${level.gridZ}. Cash: $${level.startingCash.toLocaleString()}.`,
  };
}

// ── stats ──

export function statsCommand(
  ctx: GameContext,
  _args: string[],
  _named: Record<string, string>,
): CommandResult {
  if (!ctx.state) {
    return { success: false, output: 'No game loaded. Use new_game first.' };
  }
  const s = ctx.state.levelStats;
  const levelId = ctx.state.campaign.activeLevelId;
  const level = levelId ? getLevel(levelId) : null;

  const ores = [...s.uniqueOresExtracted].join(', ') || 'none';
  const lines = [
    'Level Statistics:',
    `  Total wealth:       $${s.totalWealth.toLocaleString()}`,
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
