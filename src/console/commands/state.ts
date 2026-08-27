// BlastSimulator2026 — Console command to dump game state as JSON
// Allows agents to programmatically inspect the full game state.

import type { CommandResult } from '../ConsoleRunner.js';
import type { MiningContext } from './mining.js';
import { t } from '../../core/i18n/I18n.js';
import { requireGame } from './commandUtils.js';

/**
 * Fragments serialized verbatim before the rest collapse into counts. A
 * late-level site tracks hundreds of thousands of on-ground fragments (five
 * level-3 blasts left 603k), and dumping them all made `state full` a 318 MB
 * string that hung every harness evaluate downstream (#481).
 */
const MAX_SERIALIZED_FRAGMENTS = 200;

/** The logistics block with its unbounded fragment list summarized. */
function serializeLogistics(logistics: {
  fragments: { state: string }[];
  storageCapacityKg: number;
  storedMassKg: number;
}): Record<string, unknown> {
  const byState: Record<string, number> = {};
  for (const f of logistics.fragments) {
    byState[f.state] = (byState[f.state] ?? 0) + 1;
  }
  return {
    storageCapacityKg: logistics.storageCapacityKg,
    storedMassKg: logistics.storedMassKg,
    fragmentCount: logistics.fragments.length,
    fragmentCountsByState: byState,
    fragments: logistics.fragments.slice(0, MAX_SERIALIZED_FRAGMENTS),
    // Never truncate silently — a dump that reads as complete must be complete.
    fragmentsTruncated: Math.max(0, logistics.fragments.length - MAX_SERIALIZED_FRAGMENTS),
  };
}

/**
 * Serialize the MiningContext into a JSON-safe object.
 * Sets are converted to arrays. Omits the VoxelGrid (too large) and caps the
 * logistics fragment list (unbounded — see serializeLogistics).
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
    logistics: serializeLogistics(s.logistics),
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
    softwareTier: s.softwareTier,
    tubingState: { inventory: s.tubingState.inventory, installedHoles: [...s.tubingState.installedHoles] },
    navGrid: (() => {
      const ng = s.navGrid;
      if (!ng) return null;
      const counts: Record<string, number> = { walkable: 0, blocked: 0, drill_hole: 0, ramp: 0, void: 0 };
      for (const row of ng.cells) {
        for (const cell of row) {
          counts[cell.type]!++;
        }
      }
      return {
        width: ng.width,
        height: ng.height,
        maxSurfaceY: ng.maxSurfaceY,
        cellTypeCounts: counts,
      };
    })(),
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
  const err = requireGame(ctx);
  if (err) return err;

  const sub = args[0] ?? 'full';

  if (sub === 'summary') {
    const s = ctx.state!;
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
    output: t('state.usage'),
  };
}
