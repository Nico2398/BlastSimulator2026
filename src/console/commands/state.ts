// BlastSimulator2026 — Console command to dump game state as JSON
// Allows agents to programmatically inspect the full game state.

import type { CommandResult } from '../ConsoleRunner.js';
import type { MiningContext } from './mining.js';

/**
 * Serialize the MiningContext into a JSON-safe object.
 * Sets are converted to arrays. Omits the VoxelGrid (too large).
 */
function serializeState(ctx: MiningContext): Record<string, unknown> {
  if (!ctx.state) return {};
  const s = ctx.state;

  return {
    seed: s.seed,
    time: s.time,
    tickCount: s.tickCount,
    timeScale: s.timeScale,
    isPaused: s.isPaused,
    mineType: s.mineType,
    world: s.world,
    surveyedPositions: [...s.surveyedPositions],
    cash: s.cash,
    drillHoles: s.drillHoles,
    chargesByHole: s.chargesByHole,
    sequenceDelays: s.sequenceDelays,
    savedPlans: s.savedPlans,
    finances: s.finances,
    contracts: s.contracts,
    logistics: s.logistics,
    buildings: s.buildings,
    vehicles: s.vehicles,
    employees: s.employees,
    scores: s.scores,
    damage: s.damage,
    zone: s.zone,
    events: {
      timers: s.events.timers,
      pendingEvent: s.events.pendingEvent,
      followUpQueue: s.events.followUpQueue,
      firedEventIds: s.events.firedEventIds,
    },
    corruption: s.corruption,
    mafia: s.mafia,
    campaign: s.campaign,
    bankruptcy: s.bankruptcy,
    arrest: s.arrest,
    ecological: s.ecological,
    revolt: s.revolt,
    levelStats: s.levelStats,
    levelEnded: s.levelEnded,
    levelEndReason: s.levelEndReason,
    softwareTier: ctx.softwareTier,
  };
}

/**
 * `state` command — dump game state as JSON for agent inspection.
 *
 * Usage:
 *   state            → full JSON dump
 *   state summary    → compact summary of key metrics
 */
export function stateCommand(
  ctx: MiningContext,
  args: string[],
  _named: Record<string, string>,
): CommandResult {
  if (!ctx.state) {
    return { success: false, output: 'No game loaded. Use new_game first.' };
  }

  const sub = args[0] ?? 'full';

  if (sub === 'summary') {
    const s = ctx.state;
    const summary = {
      seed: s.seed,
      mineType: s.mineType,
      tickCount: s.tickCount,
      cash: s.cash,
      holes: s.drillHoles.length,
      charged: Object.keys(s.chargesByHole).length,
      sequenced: Object.keys(s.sequenceDelays).length,
      scores: s.scores,
      buildings: s.buildings.buildings.length,
      vehicles: s.vehicles.vehicles.length,
      employees: s.employees.employees.length,
      levelEnded: s.levelEnded,
      levelEndReason: s.levelEndReason,
      campaignLevel: s.campaign.activeLevelId,
    };
    return { success: true, output: JSON.stringify(summary, null, 2) };
  }

  if (sub === 'full') {
    return { success: true, output: JSON.stringify(serializeState(ctx), null, 2) };
  }

  return {
    success: false,
    output: 'Usage: state [full|summary]',
  };
}
