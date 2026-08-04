// BlastSimulator2026 — Console commands for mining operations
// drill_plan, charge, sequence, blast, preview, build, weather, tubing, survey

import type { CommandResult } from '../ConsoleRunner.js';
import type { GameContext } from './world.js';
import { createGridPlan, addHole, resetHoleIds } from '../../core/mining/DrillPlan.js';
import { createCharge, batchCharge } from '../../core/mining/ChargePlan.js';
import { setDelay, autoVPattern } from '../../core/mining/Sequence.js';
import { assembleBlastPlan, validateBlastPlan } from '../../core/mining/BlastPlan.js';
import { executeBlast, buildBlastReport } from '../../core/mining/BlastExecution.js';
import { getExplosive } from '../../core/world/ExplosiveCatalog.js';
import { addBlastFragments, syncLogisticsCapacity } from '../../core/economy/Logistics.js';

import { recordVibration, recordBuildingDestruction } from '../../core/scores/ScoreManager.js';
import { recordBlastResult, snapshotStats } from '../../core/campaign/SuccessTracker.js';
import {
  previewEnergy,
  previewFragments,
  previewProjections,
  previewVibrations,
  purchaseSoftware,
} from '../../core/mining/Software.js';
import { buildRamp, RAMP_WIDTH, type RampDirection } from '../../core/mining/Ramp.js';
import {
  createWeatherCycle,
  forceAdvance,
  setWeather,
  ALL_WEATHER_STATES,
  type WeatherState,
} from '../../core/weather/WeatherCycle.js';
import { Random } from '../../core/math/Random.js';
import { buyTubing, installTubing } from '../../core/mining/Tubing.js';
import type { FragmentData } from '../../core/mining/BlastExecution.js';
import { runSurvey, SURVEY_METHODS, type SurveyMethod, computeBlastOreReport } from '../../core/mining/SurveyCalc.js';
import { SURVEY_COSTS } from '../../core/config/balance.js';
import { detectOreReport } from '../../core/events/EventEngine.js';
import { NavGrid } from '../../core/nav/NavGrid.js';
import { getStorageCapacity } from '../../core/entities/Building.js';
import { claimForAction, cellsInRect } from './siteExpansion.js';

// ── Extended context for mining ──

export interface MiningContext extends GameContext {
  weatherCycle?: ReturnType<typeof createWeatherCycle>;
  rng?: Random;
  /** Positions of fragments from the last blast — used by renderer for localized re-mesh. */
  lastBlastFragments?: { x: number; y: number; z: number }[];
  /** Full fragment data from last blast — used by renderer to spawn fragment meshes. */
  lastBlastFragmentData?: FragmentData[];
  /** Drill holes from before the last blast — used by renderer for per-hole detonation timing. */
  lastBlastHoles?: import('../../core/mining/DrillPlan.js').DrillHole[];
}

function requireGame(ctx: MiningContext): string | null {
  if (!ctx.state || !ctx.grid) return 'No game loaded. Use new_game first.';
  return null;
}

// ── Drill plan commands ──

export function drillPlanCommand(
  ctx: MiningContext,
  args: string[],
  named: Record<string, string>,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return { success: false, output: err };

  const sub = args[0];

  if (sub === 'grid') {
    const origin = (named['origin'] ?? named['start'] ?? '0,0').split(',').map(Number);
    const rows = parseInt(named['rows'] ?? '3', 10);
    const cols = parseInt(named['cols'] ?? '3', 10);
    const spacing = parseFloat(named['spacing'] ?? '3');
    const depth = parseFloat(named['depth'] ?? '8');
    const diameter = parseFloat(named['diameter'] ?? '0.15');

    resetHoleIds();
    const planned = createGridPlan(
      { x: origin[0] ?? 0, z: origin[1] ?? 0 },
      rows, cols, spacing, depth, diameter,
    );

    // Claim before committing the plan: a grid reaching ground the site
    // cannot have is refused whole, rather than landing half on the map.
    const claim = claimForAction(ctx, planned.map(h => ({ x: h.x, z: h.z })), 'drill');
    if (!claim.ok) {
      resetHoleIds();
      return { success: false, output: claim.output! };
    }

    ctx.state!.drillHoles = planned;
    // Clear stale charges/sequences from previous plan
    ctx.state!.chargesByHole = {};
    ctx.state!.sequenceDelays = {};

    // Patch NavGrid to reflect new drill hole cells
    if (ctx.state!.navGrid && ctx.grid) {
      const ox = Math.floor(origin[0] ?? 0);
      const oz = Math.floor(origin[1] ?? 0);
      const region = {
        minX: ox, maxX: ox + Math.ceil(cols * spacing),
        minZ: oz, maxZ: oz + Math.ceil(rows * spacing),
      };
      NavGrid.patchNavGrid(ctx.state!.navGrid, ctx.grid, ctx.state!.buildings.buildings, ctx.state!.drillHoles, region);
    }

    return {
      success: true,
      output: `Drill plan: ${rows}×${cols} grid, ${ctx.state!.drillHoles.length} holes, spacing ${spacing}m, depth ${depth}m`,
    };
  }

  if (sub === 'add') {
    const x = parseFloat(named['x'] ?? '0');
    const z = parseFloat(named['z'] ?? named['y'] ?? '0');
    const depth = parseFloat(named['depth'] ?? '8');
    const diameter = parseFloat(named['diameter'] ?? '0.15');
    const claim = claimForAction(ctx, [{ x, z }], 'drill');
    if (!claim.ok) return { success: false, output: claim.output! };

    const hole = addHole(ctx.state!.drillHoles, x, z, depth, diameter);
    return { success: true, output: `Added hole ${hole.id} at (${x}, ${z}), depth ${depth}m` };
  }

  if (sub === 'show') {
    if (ctx.state!.drillHoles.length === 0) {
      return { success: true, output: 'No drill holes. Use drill_plan grid or drill_plan add.' };
    }
    const lines = ctx.state!.drillHoles.map(h =>
      `  ${h.id}: (${h.x}, ${h.z}) depth=${h.depth}m dia=${h.diameter}m`,
    );
    return { success: true, output: `Drill plan (${lines.length} holes):\n${lines.join('\n')}` };
  }

  return { success: false, output: 'Usage: drill_plan grid|add|show [options]' };
}

// ── Charge commands ──

export function chargeCommand(
  ctx: MiningContext,
  _args: string[],
  named: Record<string, string>,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return { success: false, output: err };

  if (_args[0] === 'show') {
    const entries = Object.entries(ctx.state!.chargesByHole);
    if (entries.length === 0) return { success: true, output: 'No charges set.' };
    const lines = entries.map(([id, c]) =>
      `  ${id}: ${c.explosiveId} ${c.amountKg}kg, stemming ${c.stemmingM}m`,
    );
    return { success: true, output: `Charges:\n${lines.join('\n')}` };
  }

  const holeSpec = named['hole'] ?? '';
  const explosiveId = named['explosive'] ?? '';
  const amount = parseFloat((named['amount'] ?? '0').replace('kg', ''));
  const stemming = parseFloat((named['stemming'] ?? '0').replace('m', ''));

  if (!explosiveId) return { success: false, output: 'Missing explosive. Usage: charge hole:1 explosive:boomite amount:5kg stemming:2m' };

  if (holeSpec === '*') {
    const holeIds = ctx.state!.drillHoles.map(h => h.id);
    const depths: Record<string, number> = {};
    for (const h of ctx.state!.drillHoles) depths[h.id] = h.depth;
    const result = batchCharge(holeIds, depths, explosiveId, amount, stemming);
    if (result.errors.length > 0) {
      return { success: false, output: `Errors:\n${result.errors.map(e => `  ${e.holeId}: ${e.message}`).join('\n')}` };
    }
    ctx.state!.chargesByHole = { ...ctx.state!.chargesByHole, ...result.charges };
    return { success: true, output: `Charged ${holeIds.length} holes with ${explosiveId} ${amount}kg` };
  }

  // Resolve holeId: accept either the exact ID (H1) or the legacy hole_N format
  const holeId = ctx.state!.drillHoles.find(h => h.id === holeSpec)
    ? holeSpec
    : (holeSpec.startsWith('hole_') ? holeSpec : `hole_${holeSpec}`);
  const hole = ctx.state!.drillHoles.find(h => h.id === holeId);
  if (!hole) return { success: false, output: `Hole "${holeId}" not found` };

  const result = createCharge(explosiveId, amount, stemming, hole.depth);
  if ('error' in result) return { success: false, output: result.error };

  ctx.state!.chargesByHole[holeId] = result.charge;
  return { success: true, output: `Charged ${holeId}: ${explosiveId} ${amount}kg, stemming ${stemming}m` };
}

// ── Sequence commands ──

export function sequenceCommand(
  ctx: MiningContext,
  args: string[],
  named: Record<string, string>,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return { success: false, output: err };

  const sub = args[0];

  if (sub === 'auto') {
    const step = parseFloat((named['delay_step'] ?? '25').replace('ms', ''));
    ctx.state!.sequenceDelays = autoVPattern(ctx.state!.drillHoles, step);
    return { success: true, output: `Auto V-pattern sequence, ${step}ms step, ${Object.keys(ctx.state!.sequenceDelays).length} holes` };
  }

  if (sub === 'set') {
    const hole = named['hole'] ?? '';
    const delay = parseFloat((named['delay'] ?? '0').replace('ms', ''));
    const holeId = ctx.state!.drillHoles.find(h => h.id === hole)
      ? hole
      : (hole.startsWith('hole_') ? hole : `hole_${hole}`);
    setDelay(ctx.state!.sequenceDelays, holeId, delay);
    return { success: true, output: `Set ${holeId} delay: ${delay}ms` };
  }

  if (sub === 'show') {
    const entries = Object.entries(ctx.state!.sequenceDelays);
    if (entries.length === 0) return { success: true, output: 'No sequence set.' };
    const lines = entries.sort(([, a], [, b]) => a - b)
      .map(([id, d]) => `  ${id}: ${d}ms`);
    return { success: true, output: `Sequence:\n${lines.join('\n')}` };
  }

  return { success: false, output: 'Usage: sequence auto|set|show [options]' };
}

// ── Blast commands ──

export function blastCommand(
  ctx: MiningContext,
  _args: string[],
  _named: Record<string, string>,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return { success: false, output: err };

  const plan = assembleBlastPlan(ctx.state!.drillHoles, ctx.state!.chargesByHole, ctx.state!.sequenceDelays);
  const errors = validateBlastPlan(plan);
  if (errors.length > 0) {
    return { success: false, output: `Invalid plan:\n${errors.map(e => `  ${e.holeId}: ${e.issue}`).join('\n')}` };
  }

  const result = executeBlast(plan, ctx.grid!, [], undefined, ctx.state!.buildings, ctx.emitter);
  if (!result) return { success: false, output: 'Blast execution failed.' };

  // Store fragment data for renderer (localized remesh + mesh spawning)
  ctx.lastBlastFragments = result.fragments.map(f => f.position);
  ctx.lastBlastFragmentData = result.fragments;

  const state = ctx.state!;

  // Buildings destroyed by the blast: score penalty per building. Their freed
  // footprint is already inside clearedRegion (a building is only destroyed
  // when its footprint overlaps a cleared voxel), so the NavGrid patch below
  // — keyed on clearedRegion — covers it without a second patch call.
  for (const destroyed of result.destroyedBuildings) {
    recordBuildingDestruction(state.scores, destroyed.type === 'explosive_warehouse');
  }

  // A blast can destroy a Freight Warehouse — keep logistics capacity honest.
  if (result.destroyedBuildings.length > 0) {
    syncLogisticsCapacity(state.logistics, getStorageCapacity(state.buildings));
  }

  // Ore value is informational only here — cash is credited when the ore is
  // actually hauled, stored, and sold/delivered (see Logistics.consumeStoredOre).

  // Update scores based on blast outcome
  if (result.projectionCount > 0) {
    recordVibration(state.scores, result.projectionCount * 0.5);
  }

  // Track blast in damage state and level stats
  state.damage.blastCount++;
  recordBlastResult(state.levelStats, result.fragments);
  snapshotStats(state.levelStats, state);

  // Trigger one post-blast ore report event when conditions are met.
  const oreReport = computeBlastOreReport(result.fragments, state.surveyResults);
  state.lastOreReport = oreReport;
  detectOreReport(oreReport, state.events, state.tickCount);

  // Track blast fragments in logistics for contract delivery. collectedOre is
  // only credited once a fragment is hauled and delivered to a warehouse
  // (see Logistics.deliverToDepot), not the instant the blast resolves.
  addBlastFragments(state.logistics, result.fragments);

  // Store drill holes before clearing (needed by renderer for per-hole detonation timing)
  ctx.lastBlastHoles = [...state.drillHoles];

  // Charge cost, summed before the plan is cleared below — BlastResult has no
  // notion of money spent, only rock/ore recovered.
  let spent = 0;
  for (const charge of Object.values(state.chargesByHole)) {
    const explosive = getExplosive(charge.explosiveId);
    if (explosive) spent += explosive.costPerKg * charge.amountKg;
  }
  state.lastBlastReport = buildBlastReport(result, state.tickCount, spent);

  // Clear drill plan after blast (holes are consumed)
  state.drillHoles = [];
  state.chargesByHole = {};
  state.sequenceDelays = {};

  // Patch NavGrid to reflect terrain changes from the blast
  if (state.navGrid) {
    NavGrid.patchNavGrid(state.navGrid, ctx.grid!, state.buildings.buildings, state.drillHoles, result.clearedRegion);
  }

  return {
    success: true,
    output: [
      `=== BLAST REPORT ===`,
      `Rating: ${result.rating.toUpperCase()}`,
      `Cleared voxels: ${result.clearedVoxels}`,
      `Cracked voxels: ${result.crackedVoxels}`,
      `Fragments: ${result.fragmentCount}`,
      `Average fragment size: ${result.averageFragmentSize.toFixed(3)} m³`,
      `Oversized fragments: ${result.oversizedFragments}`,
      `Projections: ${result.projectionCount}`,
      `Total rock volume: ${result.totalRockVolume.toFixed(1)} m³`,
      `Total ore value: $${result.totalOreValue.toFixed(0)}`,
      ...(result.destroyedBuildings.length > 0
        ? [`Buildings destroyed: ${result.destroyedBuildings.map(b => `${b.type} #${b.buildingId}`).join(', ')}`]
        : []),
    ].join('\n'),
  };
}

// ── Blast plan save/load/validate ──

export function blastPlanCommand(
  ctx: MiningContext,
  args: string[],
  named: Record<string, string>,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return { success: false, output: err };

  const sub = args[0];

  if (sub === 'save') {
    const name = named['name'] ?? 'default';
    ctx.state!.savedPlans[name] = {
      drillHoles: [...ctx.state!.drillHoles],
      chargesByHole: { ...ctx.state!.chargesByHole },
      sequenceDelays: { ...ctx.state!.sequenceDelays },
    };
    return { success: true, output: `Plan saved as "${name}"` };
  }

  if (sub === 'load') {
    const name = named['name'] ?? 'default';
    const saved = ctx.state!.savedPlans[name];
    if (!saved) return { success: false, output: `No saved plan "${name}"` };
    ctx.state!.drillHoles = [...saved.drillHoles];
    ctx.state!.chargesByHole = { ...saved.chargesByHole };
    ctx.state!.sequenceDelays = { ...saved.sequenceDelays };
    return { success: true, output: `Plan "${name}" loaded` };
  }

  if (sub === 'validate') {
    const plan = assembleBlastPlan(ctx.state!.drillHoles, ctx.state!.chargesByHole, ctx.state!.sequenceDelays);
    const errors = validateBlastPlan(plan);
    if (errors.length === 0) return { success: true, output: 'Plan is valid and ready to blast.' };
    return { success: false, output: `Validation issues:\n${errors.map(e => `  ${e.holeId}: ${e.issue}`).join('\n')}` };
  }

  if (sub === 'list') {
    const names = Object.keys(ctx.state!.savedPlans);
    if (names.length === 0) return { success: true, output: 'No saved plans.' };
    return { success: true, output: `Saved plans:\n${names.map(n => `  ${n}`).join('\n')}` };
  }

  return { success: false, output: 'Usage: blast_plan save|load|list|validate name:plan1' };
}

// ── Preview commands ──

export function previewCommand(
  ctx: MiningContext,
  args: string[],
  _named: Record<string, string>,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return { success: false, output: err };

  const plan = assembleBlastPlan(ctx.state!.drillHoles, ctx.state!.chargesByHole, ctx.state!.sequenceDelays);
  const tier = ctx.state!.softwareTier;
  const sub = args[0];

  if (sub === 'energy') {
    const result = previewEnergy(plan, ctx.grid!, tier);
    if (!result) return { success: false, output: `Requires software tier 1+ (current: ${tier})` };
    return { success: true, output: `Energy preview: ${result.energyMap.size} voxels, max=${result.maxEnergy.toFixed(1)}, min=${result.minEnergy.toFixed(1)}` };
  }
  if (sub === 'fragments') {
    const result = previewFragments(plan, ctx.grid!, tier);
    if (!result) return { success: false, output: `Requires software tier 2+ (current: ${tier})` };
    return { success: true, output: `Fragment preview: ${result.fracturedCount} fractured, ${result.crackedCount} cracked, ${result.unaffectedCount} unaffected, avg size ${result.avgFragmentSize.toFixed(2)}` };
  }
  if (sub === 'projections') {
    const result = previewProjections(plan, ctx.grid!, tier);
    if (!result) return { success: false, output: `Requires software tier 3+ (current: ${tier})` };
    return { success: true, output: `Projection preview: ${result.projectionZoneCount} voxels in projection zone` };
  }
  if (sub === 'vibrations') {
    const result = previewVibrations(plan, [], tier);
    if (!result) return { success: false, output: `Requires software tier 4+ (current: ${tier})` };
    return { success: true, output: `Vibration preview: max=${result.maxVibration.toFixed(4)}` };
  }

  return { success: false, output: 'Usage: preview energy|fragments|projections|vibrations' };
}

/**
 * Show a comprehensive blast preview covering energy, fragmentation,
 * projections, and vibrations — each unlocked by the corresponding
 * software tier.  Sections with insufficient tier display a lock message.
 */
export function blastPreviewCommand(
  ctx: MiningContext,
  _args: string[],
  _named: Record<string, string>,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return { success: false, output: err };

  if (ctx.state!.drillHoles.length === 0) {
    return { success: false, output: 'No drill plan. Create one with drill_plan grid or drill_plan add.' };
  }

  const plan = assembleBlastPlan(ctx.state!.drillHoles, ctx.state!.chargesByHole, ctx.state!.sequenceDelays);
  const errors = validateBlastPlan(plan);
  if (errors.length > 0) {
    return { success: false, output: `Invalid plan:\n${errors.map(e => `  ${e.holeId}: ${e.issue}`).join('\n')}` };
  }

  const tier = ctx.state!.softwareTier;
  const energyPreview = previewEnergy(plan, ctx.grid!, tier);
  const fragmentPreview = previewFragments(plan, ctx.grid!, tier);
  const projectionPreview = previewProjections(plan, ctx.grid!, tier);
  const vibrationPreview = previewVibrations(plan, [], tier);

  const lines: string[] = ['=== BLAST PREVIEW ==='];

  lines.push('');
  if (energyPreview) {
    lines.push('--- Energy Map ---');
    lines.push(`  Affected voxels: ${energyPreview.energyMap.size}`);
    lines.push(`  Min energy: ${energyPreview.minEnergy.toFixed(1)}`);
    lines.push(`  Max energy: ${energyPreview.maxEnergy.toFixed(1)}`);
  } else {
    lines.push('--- Energy Map --- [Requires software tier 1]');
  }

  lines.push('');
  if (fragmentPreview) {
    lines.push('--- Fragmentation ---');
    lines.push(`  Fractured: ${fragmentPreview.fracturedCount}`);
    lines.push(`  Cracked: ${fragmentPreview.crackedCount}`);
    lines.push(`  Unaffected: ${fragmentPreview.unaffectedCount}`);
    lines.push(`  Average fragment size: ${fragmentPreview.avgFragmentSize.toFixed(3)} m³`);
  } else {
    lines.push('--- Fragmentation --- [Requires software tier 2]');
  }

  lines.push('');
  if (projectionPreview) {
    const fractured = fragmentPreview?.fracturedCount ?? 0;
    const cracked = fragmentPreview?.crackedCount ?? 0;
    // Fragments that are fractured/cracked but NOT projected outward collapse in place
    const collapseCount = (fractured + cracked) - projectionPreview.projectionZoneCount;
    lines.push('--- Projections ---');
    lines.push(`  Projection zone voxels: ${projectionPreview.projectionZoneCount}`);
    lines.push(`  Projected fragments: ${projectionPreview.projectionZoneCount}`);
    lines.push(`  Collapse fragments: ${collapseCount}`);
  } else {
    lines.push('--- Projections --- [Requires software tier 3]');
  }

  lines.push('');
  if (vibrationPreview) {
    lines.push('--- Vibrations ---');
    lines.push(`  Max vibration: ${vibrationPreview.maxVibration.toFixed(4)}`);
    lines.push(`  Affected villages: ${vibrationPreview.villages.length}`);
  } else {
    lines.push('--- Vibrations --- [Requires software tier 4]');
  }

  return { success: true, output: lines.join('\n') };
}

// ── Buy software ──

export function buySoftwareCommand(
  ctx: MiningContext,
  _args: string[],
  named: Record<string, string>,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return { success: false, output: err };

  const currentTier = ctx.state!.softwareTier;

  if (named['tier'] !== undefined) {
    const requestedTier = parseInt(named['tier'], 10);
    if (requestedTier <= currentTier) {
      return { success: false, output: `Already at tier ${requestedTier} or higher` };
    }
    if (requestedTier > currentTier + 1) {
      return { success: false, output: `Must purchase tier ${currentTier + 1} first` };
    }
    // requestedTier === currentTier + 1 — fall through to purchase
  }

  const result = purchaseSoftware(currentTier, ctx.state!.cash);
  if ('error' in result) return { success: false, output: result.error };
  ctx.state!.cash -= result.cost;
  ctx.state!.softwareTier = result.newTier;
  return { success: true, output: `Upgraded to software tier ${result.newTier}. Cost: $${result.cost}` };
}

// ── Build ramp ──

export function buildRampCommand(
  ctx: MiningContext,
  _args: string[],
  named: Record<string, string>,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return { success: false, output: err };

  let originX: number;
  let originZ: number;
  let direction: RampDirection;
  let length: number;
  const depth = parseInt(named['depth'] ?? '8', 10);

  if (named['start'] && named['end']) {
    const start = named['start'].split(',').map(Number);
    const end = named['end'].split(',').map(Number);
    originX = start[0] ?? 0;
    originZ = start[1] ?? 0;
    const dx = (end[0] ?? 0) - originX;
    const dz = (end[1] ?? 0) - originZ;
    if (Math.abs(dz) >= Math.abs(dx)) {
      direction = dz >= 0 ? 'south' : 'north';
      length = Math.abs(Math.round(dz));
    } else {
      direction = dx >= 0 ? 'east' : 'west';
      length = Math.abs(Math.round(dx));
    }
  } else {
    const origin = (named['origin'] ?? '0,0').split(',').map(Number);
    originX = origin[0] ?? 0;
    originZ = origin[1] ?? 0;
    direction = (named['direction'] ?? 'south') as RampDirection;
    length = parseInt(named['length'] ?? '10', 10);
  }

  const footprint = rampFootprint(originX, originZ, direction, length);
  const rampClaim = claimForAction(ctx, cellsInRect(footprint.minX, footprint.minZ, footprint.maxX, footprint.maxZ), 'build a ramp');
  if (!rampClaim.ok) return { success: false, output: rampClaim.output! };

  const result = buildRamp(ctx.grid!, {
    originX, originZ,
    direction, length, targetDepth: depth,
  }, ctx.state!.cash, ctx.emitter);

  if (!result.success) return { success: false, output: result.message };
  ctx.state!.cash -= result.cost;

  // Patch NavGrid to reflect ramp terrain changes
  if (ctx.state!.navGrid && ctx.grid) {
    NavGrid.patchNavGrid(ctx.state!.navGrid, ctx.grid, ctx.state!.buildings.buildings, ctx.state!.drillHoles, footprint);
  }

  return { success: true, output: result.message };
}

/** The cells a ramp of `length` cuts through, running `direction` from (originX, originZ). Max inclusive. */
function rampFootprint(
  originX: number, originZ: number, direction: RampDirection, length: number,
): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const ox = Math.floor(originX);
  const oz = Math.floor(originZ);
  if (direction === 'north' || direction === 'south') {
    return {
      minX: ox,
      maxX: ox + RAMP_WIDTH,
      minZ: Math.min(oz, direction === 'north' ? oz - length : oz),
      maxZ: Math.max(oz, direction === 'south' ? oz + length : oz),
    };
  }
  return {
    minX: Math.min(ox, direction === 'west' ? ox - length : ox),
    maxX: Math.max(ox, direction === 'east' ? ox + length : ox),
    minZ: oz,
    maxZ: oz + RAMP_WIDTH,
  };
}

// ── Weather commands ──

export function weatherCommand(
  ctx: MiningContext,
  args: string[],
  _named: Record<string, string>,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return { success: false, output: err };

  if (!ctx.weatherCycle) {
    ctx.weatherCycle = createWeatherCycle(ctx.state!.seed);
    ctx.rng = new Random(ctx.state!.seed + 1000);
  }

  if (args[0] === 'advance') {
    forceAdvance(ctx.weatherCycle, ctx.rng!);
    return { success: true, output: `Weather: ${ctx.weatherCycle.current}` };
  }

  if (args[0] === 'set') {
    const target = args[1] as WeatherState | undefined;
    if (!target || !ALL_WEATHER_STATES.includes(target)) {
      return {
        success: false,
        output: `Usage: weather set <state>. Valid: ${ALL_WEATHER_STATES.join(', ')}`,
      };
    }
    setWeather(ctx.weatherCycle, target);
    return { success: true, output: `Weather: ${ctx.weatherCycle.current}` };
  }

  return { success: true, output: `Current weather: ${ctx.weatherCycle.current}` };
}

// ── Tubing commands ──

export function tubingCommand(
  ctx: MiningContext,
  args: string[],
  named: Record<string, string>,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return { success: false, output: err };

  const sub = args[0];

  if (sub === 'buy') {
    const amount = parseInt(named['amount'] ?? '1', 10);
    const result = buyTubing(ctx.state!.tubingState, amount, ctx.state!.cash);
    if (!result.success) return { success: false, output: result.message };
    ctx.state!.cash -= result.cost;
    return { success: true, output: `${result.message}. Inventory: ${ctx.state!.tubingState.inventory}` };
  }

  if (sub === 'install') {
    const holeSpec = named['hole'] ?? '';
    const holeId = ctx.state!.drillHoles.find(h => h.id === holeSpec)
      ? holeSpec
      : (holeSpec.startsWith('hole_') ? holeSpec : `hole_${holeSpec}`);
    const result = installTubing(ctx.state!.tubingState, holeId);
    return { success: result.success, output: result.message };
  }

  return { success: true, output: `Tubing inventory: ${ctx.state!.tubingState.inventory}, installed: ${ctx.state!.tubingState.installedHoles.size} holes` };
}

// ── Survey command ──

export function surveyCommand(
  ctx: MiningContext,
  args: string[],
  named: Record<string, string>,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return { success: false, output: err };

  const sub = args[0];

  if (sub === 'show') {
    const pending = ctx.state!.pendingActions.filter(a => a.type === 'survey');
    if (pending.length === 0) return { success: true, output: 'No pending surveys.' };
    // payload['method'] is Record<string, unknown> — String() narrows to a printable value
    const lines = pending.map(
      a => `  [${a.id}] ${String(a.payload['method'])} at (${a.targetX}, ${a.targetZ})`,
    );
    return { success: true, output: `Pending surveys:\n${lines.join('\n')}` };
  }

  if (sub === 'mode') {
    const pendingCount = ctx.state!.pendingActions.filter(a => a.type === 'survey').length;
    const completedCount = ctx.state!.surveyResults.length;
    return {
      success: true,
      output: `Survey status: ${completedCount} completed, ${pendingCount} pending.`,
    };
  }

  if (sub === 'ore_report') {
    const report = ctx.state!.lastOreReport;
    if (!report) {
      return {
        success: false,
        output: 'No blast ore report available yet. Run a blast first.',
      };
    }

    const oreLines = Object.entries(report.oreYields).map(
      ([oreId, kg]) => `  ${oreId}: ${kg.toFixed(1)}kg`,
    );

    const lines = [
      '=== ORE REPORT ===',
      ...(oreLines.length > 0 ? oreLines : ['  (no ore recovered)']),
      `Total yield: ${report.totalYieldKg.toFixed(1)}kg`,
      `Estimated yield: ${report.estimatedYieldKg.toFixed(1)}kg`,
      report.estimatedYieldKg === 0
        ? 'Yield ratio: n/a (no surveyed ore in blast zone)'
        : `Yield ratio: ${(report.yieldRatio * 100).toFixed(0)}% of estimate`,
    ];

    return { success: true, output: lines.join('\n') };
  }

  if (!sub) {
    return { success: false, output: 'Usage: survey <seismic|core_sample|aerial> x:<X> z:<Z>' };
  }
  if (!(SURVEY_METHODS as string[]).includes(sub)) {
    return {
      success: false,
      output: `Unknown method "${sub}". Usage: survey <seismic|core_sample|aerial> x:<X> z:<Z>`,
    };
  }

  // sub is a validated SurveyMethod from this point
  const method = sub as SurveyMethod;

  if (named['x'] === undefined || named['z'] === undefined) {
    return {
      success: false,
      output: 'Usage: survey <seismic|core_sample|aerial> x:<X> z:<Z>',
    };
  }

  const x = parseInt(named['x'], 10);
  const z = parseInt(named['z'], 10);
  if (isNaN(x) || isNaN(z)) {
    return { success: false, output: 'Invalid coordinates: x and z must be integers.' };
  }

  const claim = claimForAction(ctx, [{ x, z }], 'survey');
  if (!claim.ok) return { success: false, output: claim.output! };

  const result = runSurvey(ctx.state!, { method, centerX: x, centerZ: z });

  if (!result.success) {
    if (result.error === 'insufficient_funds') {
      return { success: false, output: `Insufficient funds. ${method} survey costs $${SURVEY_COSTS[method]}.` };
    }
    if (result.error === 'no_surveyor') {
      return { success: false, output: 'No available surveyor. Hire an employee with geology qualification.' };
    }
    return { success: false, output: 'Survey failed.' };
  }

  return {
    success: true,
    output: `${method} survey queued at (${x}, ${z}). Action ID: ${result.actionId}.`,
  };
}
