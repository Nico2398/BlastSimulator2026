// BlastSimulator2026 — Console commands for mining operations
// drill_plan, charge, sequence, blast, preview, build, weather, tubing

import type { CommandResult } from '../ConsoleRunner.js';
import type { GameContext } from './world.js';
import { createGridPlan, addHole, resetHoleIds } from '../../core/mining/DrillPlan.js';
import { createCharge, batchCharge } from '../../core/mining/ChargePlan.js';
import { setDelay, autoVPattern } from '../../core/mining/Sequence.js';
import { assembleBlastPlan, validateBlastPlan } from '../../core/mining/BlastPlan.js';
import { executeBlast } from '../../core/mining/BlastExecution.js';
import { addIncome } from '../../core/economy/Finance.js';
import { recordVibration } from '../../core/scores/ScoreManager.js';
import { recordBlastResult, snapshotStats } from '../../core/campaign/SuccessTracker.js';
import {
  previewEnergy,
  previewFragments,
  previewProjections,
  previewVibrations,
  purchaseSoftware,
} from '../../core/mining/Software.js';
import { buildRamp, type RampDirection } from '../../core/mining/Ramp.js';
import {
  createWeatherCycle,
  forceAdvance,
} from '../../core/weather/WeatherCycle.js';
import { Random } from '../../core/math/Random.js';
import { buyTubing, installTubing, createTubingState } from '../../core/mining/Tubing.js';
import type { FragmentData } from '../../core/mining/BlastExecution.js';

// ── Extended context for mining ──

export interface MiningContext extends GameContext {
  weatherCycle?: ReturnType<typeof createWeatherCycle>;
  rng?: Random;
  softwareTier: number;
  tubingState: ReturnType<typeof createTubingState>;
  /** Positions of fragments from the last blast — used by renderer for localized re-mesh. */
  lastBlastFragments?: { x: number; y: number; z: number }[];
  /** Full fragment data from last blast — used by renderer to spawn fragment meshes. */
  lastBlastFragmentData?: FragmentData[];
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
    ctx.state!.drillHoles = createGridPlan(
      { x: origin[0] ?? 0, z: origin[1] ?? 0 },
      rows, cols, spacing, depth, diameter,
    );
    // Clear stale charges/sequences from previous plan
    ctx.state!.chargesByHole = {};
    ctx.state!.sequenceDelays = {};

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

  const result = executeBlast(plan, ctx.grid!, []);
  if (!result) return { success: false, output: 'Blast execution failed.' };

  // Store fragment data for renderer (localized remesh + mesh spawning)
  ctx.lastBlastFragments = result.fragments.map(f => f.position);
  ctx.lastBlastFragmentData = result.fragments;

  const state = ctx.state!;

  // Credit ore revenue to finances
  if (result.totalOreValue > 0) {
    state.cash += result.totalOreValue;
    addIncome(state.finances, result.totalOreValue, 'sales', 'Blast ore extraction', state.tickCount);
  }

  // Update scores based on blast outcome
  if (result.projectionCount > 0) {
    recordVibration(state.scores, result.projectionCount * 0.5);
  }

  // Track blast in damage state and level stats
  state.damage.blastCount++;
  recordBlastResult(state.levelStats, result.fragments);
  snapshotStats(state.levelStats, state);

  // Clear drill plan after blast (holes are consumed)
  state.drillHoles = [];
  state.chargesByHole = {};
  state.sequenceDelays = {};

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

  return { success: false, output: 'Usage: blast_plan save|load|validate name:plan1' };
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
  const sub = args[0];

  if (sub === 'energy') {
    const result = previewEnergy(plan, ctx.grid!, ctx.softwareTier);
    if (!result) return { success: false, output: `Requires software tier 1+ (current: ${ctx.softwareTier})` };
    return { success: true, output: `Energy preview: ${result.energyMap.size} voxels, max=${result.maxEnergy.toFixed(1)}, min=${result.minEnergy.toFixed(1)}` };
  }
  if (sub === 'fragments') {
    const result = previewFragments(plan, ctx.grid!, ctx.softwareTier);
    if (!result) return { success: false, output: `Requires software tier 2+ (current: ${ctx.softwareTier})` };
    return { success: true, output: `Fragment preview: ${result.fracturedCount} fractured, ${result.crackedCount} cracked, ${result.unaffectedCount} unaffected, avg size ${result.avgFragmentSize.toFixed(2)}` };
  }
  if (sub === 'projections') {
    const result = previewProjections(plan, ctx.grid!, ctx.softwareTier);
    if (!result) return { success: false, output: `Requires software tier 3+ (current: ${ctx.softwareTier})` };
    return { success: true, output: `Projection preview: ${result.projectionZoneCount} voxels in projection zone` };
  }
  if (sub === 'vibrations') {
    const result = previewVibrations(plan, [], ctx.softwareTier);
    if (!result) return { success: false, output: `Requires software tier 4+ (current: ${ctx.softwareTier})` };
    return { success: true, output: `Vibration preview: max=${result.maxVibration.toFixed(4)}` };
  }

  return { success: false, output: 'Usage: preview energy|fragments|projections|vibrations' };
}

// ── Buy software ──

export function buySoftwareCommand(
  ctx: MiningContext,
  _args: string[],
  _named: Record<string, string>,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return { success: false, output: err };

  const result = purchaseSoftware(ctx.softwareTier, ctx.state!.cash);
  if ('error' in result) return { success: false, output: result.error };
  ctx.state!.cash -= result.cost;
  ctx.softwareTier = result.newTier;
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

  const origin = (named['origin'] ?? '0,0').split(',').map(Number);
  const direction = (named['direction'] ?? 'south') as RampDirection;
  const length = parseInt(named['length'] ?? '10', 10);
  const depth = parseInt(named['depth'] ?? '8', 10);

  const result = buildRamp(ctx.grid!, {
    originX: origin[0] ?? 0, originZ: origin[1] ?? 0,
    direction, length, targetDepth: depth,
  }, ctx.state!.cash);

  if (!result.success) return { success: false, output: result.message };
  ctx.state!.cash -= result.cost;
  return { success: true, output: result.message };
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
    const result = buyTubing(ctx.tubingState, amount, ctx.state!.cash);
    if (!result.success) return { success: false, output: result.message };
    ctx.state!.cash -= result.cost;
    return { success: true, output: `${result.message}. Inventory: ${ctx.tubingState.inventory}` };
  }

  if (sub === 'install') {
    const holeSpec = named['hole'] ?? '';
    const holeId = ctx.state!.drillHoles.find(h => h.id === holeSpec)
      ? holeSpec
      : (holeSpec.startsWith('hole_') ? holeSpec : `hole_${holeSpec}`);
    const result = installTubing(ctx.tubingState, holeId);
    return { success: result.success, output: result.message };
  }

  return { success: true, output: `Tubing inventory: ${ctx.tubingState.inventory}, installed: ${ctx.tubingState.installedHoles.size} holes` };
}
