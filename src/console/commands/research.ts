// BlastSimulator2026 — Console command for Research Center tier-unlock tasks
// Wraps queueResearchTask / isTierUnlocked (src/core/entities/BuildingResearch.ts).
// Registered in createRunner.ts alongside the other Phase 5/6 commands.

import type { CommandResult } from '../ConsoleRunner.js';
import type { GameContext } from './world.js';
import {
  queueResearchTask,
  getQueueBlockCode,
  getResearchCenterProfile,
  getActiveResearchTasks,
  getAllBuildingTypes,
  type BuildingType,
  type QueueBlockCode,
} from '../../core/entities/Building.js';
import { addExpense } from '../../core/economy/Finance.js';
import { getResearchTaskDef } from '../../core/config/balance.js';
import { factorFor, researchCostFor } from '../../core/events/ActiveModifiers.js';
import { t } from '../../core/i18n/I18n.js';
import { requireGame, buildingTypeName } from './commandUtils.js';

/** Locale key of the message for each read-only `getQueueBlockCode` result. */
const QUEUE_BLOCK_KEYS: Record<QueueBlockCode, string> = {
  no_research_center: 'research.queue_no_center',
  already_unlocked: 'research.queue_already_unlocked',
  already_queued: 'research.queue_already_queued',
  conditions_not_met: 'research.queue_conditions_not_met',
};

/**
 * Manage Research Center tasks.
 * Usage:
 *   research queue type:<BuildingType> tier:2|3
 *   research status
 */
export function researchCommand(
  ctx: GameContext,
  args: string[],
  named: Record<string, string>,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return err;
  const state = ctx.state!;
  const sub = args[0] ?? 'status';

  switch (sub) {
    case 'queue': {
      const type = named['type'] as BuildingType | undefined;
      if (!type || !getAllBuildingTypes().includes(type)) {
        return {
          success: false,
          code: 'usage',
          output: t('research.queue_usage'),
        };
      }
      const tierNum = parseInt(named['tier'] ?? '', 10);
      if (tierNum !== 2 && tierNum !== 3) {
        return {
          success: false,
          code: 'usage',
          output: t('research.queue_usage'),
        };
      }
      const tier = tierNum as 2 | 3;

      // Precedence: no_research_center, already_unlocked, already_queued,
      // conditions_not_met (the shared read-only chain from
      // getQueueBlockCode, checked here so cash is only checked once every
      // other precondition already passes), then insufficient_funds, and
      // only then commit via queueResearchTask — avoids leaving a phantom
      // queued task when funds are short.
      const def = getResearchTaskDef(type, tier);

      const blockCode = getQueueBlockCode(state.buildings, type, tier);
      if (blockCode) {
        return {
          success: false,
          code: blockCode,
          output: t(QUEUE_BLOCK_KEYS[blockCode], { type: buildingTypeName(type), tier }),
        };
      }
      const factor = factorFor(state.events.activeModifiers, 'research_cost', state.tickCount);
      const scaled = researchCostFor(def.cost, state.events.activeModifiers, state.tickCount);
      if (state.cash < scaled) {
        return {
          success: false,
          code: 'insufficient_funds',
          output: t('research.queue_insufficient_funds', { cost: scaled }),
        };
      }

      const result = queueResearchTask(state.buildings, type, tier, factor);
      if (!result.success) {
        // Preconditions were re-checked above; a failure here means state
        // changed between the checks and the commit (should not happen in
        // single-threaded console mode), but relay it defensively.
        const failCode = result.code ?? 'no_research_center';
        return {
          success: false,
          code: failCode,
          output: t('research.queue_failed', { code: failCode }),
        };
      }

      const cost = result.cost ?? def.cost;
      state.cash -= cost;
      addExpense(state.finances, cost, 'construction', `Research ${type} T${tier}`, state.tickCount);

      const queuedKey = def.ticks > 0 ? 'research.queue_queued' : 'research.queue_queued_instant';
      return {
        success: true,
        output: t(queuedKey, { type: buildingTypeName(type), tier, ticks: def.ticks, cost }),
      };
    }
    case 'status': {
      const queue = state.buildings.researchQueue;
      const profile = getResearchCenterProfile(state.buildings);
      if (queue.length === 0 && !profile) {
        return { success: true, output: t('research.status_no_center') };
      }
      if (queue.length === 0 && profile) {
        const header = t('research.status_header', { speed: profile.speed, active: 0, slots: profile.slots });
        return { success: true, output: `${header}\nNo research queued.` };
      }
      const activeCount = getActiveResearchTasks(state.buildings).length;
      const lines = profile
        ? [t('research.status_header', { speed: profile.speed, active: activeCount, slots: profile.slots })]
        : [t('research.status_no_center')];
      queue.forEach((task, i) => {
        const key = i < activeCount ? 'research.status_task_active' : 'research.status_task_pending';
        lines.push(t(key, {
          index: i,
          name: buildingTypeName(task.targetType),
          tier: task.targetTier,
          remaining: Math.ceil(task.ticksRemaining),
          cost: task.cost,
        }));
      });
      return { success: true, output: lines.join('\n') };
    }
    default:
      return { success: false, output: t('research.usage') };
  }
}
