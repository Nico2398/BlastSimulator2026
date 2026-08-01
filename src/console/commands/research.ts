// BlastSimulator2026 — Console command for Research Center tier-unlock tasks
// Wraps queueResearchTask / isTierUnlocked (src/core/entities/BuildingResearch.ts).
// Registered in createRunner.ts alongside the other Phase 5/6 commands.

import type { CommandResult } from '../ConsoleRunner.js';
import type { GameContext } from './world.js';
import {
  queueResearchTask,
  getAllBuildingTypes,
  type BuildingType,
} from '../../core/entities/Building.js';
import { addExpense } from '../../core/economy/Finance.js';
import { getResearchTaskDef } from '../../core/config/balance.js';
import { requireGame } from './commandUtils.js';

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
          output: 'Usage: research queue type:<BuildingType> tier:2|3',
        };
      }
      const tierNum = parseInt(named['tier'] ?? '', 10);
      if (tierNum !== 2 && tierNum !== 3) {
        return {
          success: false,
          code: 'usage',
          output: 'Usage: research queue type:<BuildingType> tier:2|3',
        };
      }
      const tier = tierNum as 2 | 3;

      // TODO(implementer): precedence between no_research_center,
      // already_unlocked, already_queued, conditions_not_met, and
      // insufficient_funds is decided inside queueResearchTask; this handler
      // only needs to relay whatever `code` comes back.
      const result = queueResearchTask(state.buildings, type, tier);
      if (!result.success) {
        const def = getResearchTaskDef(type, tier);
        switch (result.code) {
          case 'no_research_center':
            return {
              success: false,
              code: 'no_research_center',
              output: `A Research Center is required before queueing tier ${tier} ${type}.`,
            };
          case 'already_unlocked':
            return {
              success: false,
              code: 'already_unlocked',
              output: `Tier ${tier} ${type} is already unlocked.`,
            };
          case 'already_queued':
            return {
              success: false,
              code: 'already_queued',
              output: `Tier ${tier} ${type} is already queued for research.`,
            };
          case 'conditions_not_met':
            return {
              success: false,
              code: 'conditions_not_met',
              output: `Tier ${tier} ${type} does not meet its research prerequisites.`,
            };
          case 'insufficient_funds':
          default:
            return {
              success: false,
              code: 'insufficient_funds',
              output: `Insufficient funds: research costs $${def.cost}.`,
            };
        }
      }

      const cost = result.cost ?? getResearchTaskDef(type, tier).cost;
      state.cash -= cost;
      addExpense(state.finances, cost, 'construction', `Research ${type} T${tier}`, state.tickCount);

      return {
        success: true,
        output: `Queued research: ${type} tier ${tier} — $${cost}.`,
      };
    }
    case 'status': {
      if (state.buildings.researchQueue.length === 0) {
        return { success: true, output: 'No research queued.' };
      }
      const lines = ['Research queue:'];
      state.buildings.researchQueue.forEach((task, i) => {
        const status = i === 0 ? 'in progress' : 'pending';
        lines.push(`  [${i}] ${task.targetType} tier ${task.targetTier} — ${status}, ${task.ticksRemaining} ticks remaining, $${task.cost}`);
      });
      return { success: true, output: lines.join('\n') };
    }
    default:
      return { success: false, output: 'Usage: research (queue type:<BuildingType> tier:2|3 | status)' };
  }
}
