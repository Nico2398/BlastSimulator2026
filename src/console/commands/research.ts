// BlastSimulator2026 — Console command for Research Center tier-unlock tasks
// Wraps queueResearchTask / isTierUnlocked (src/core/entities/BuildingResearch.ts).
// Registered in createRunner.ts alongside the other Phase 5/6 commands.

import type { CommandResult } from '../ConsoleRunner.js';
import type { GameContext } from './world.js';
import {
  queueResearchTask,
  isTierUnlocked,
  getAllBuildingTypes,
  type BuildingType,
} from '../../core/entities/Building.js';
import { addExpense } from '../../core/economy/Finance.js';
import { RESEARCH_TIER_TICKS, RESEARCH_TIER_COST } from '../../core/config/balance.js';
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
        return { success: false, output: 'Usage: research queue type:<BuildingType> tier:2|3' };
      }
      const tierNum = parseInt(named['tier'] ?? '', 10);
      if (tierNum !== 2 && tierNum !== 3) {
        return { success: false, output: 'Usage: research queue type:<BuildingType> tier:2|3' };
      }
      const tier = tierNum as 2 | 3;

      if (isTierUnlocked(state.buildings, type, tier)) {
        return { success: false, output: `Tier ${tier} ${type} is already unlocked.` };
      }

      const ticks = RESEARCH_TIER_TICKS[tier];
      const cost = RESEARCH_TIER_COST[tier];
      if (state.cash < cost) {
        return { success: false, output: `Insufficient funds: research costs $${cost}.` };
      }
      queueResearchTask(state.buildings, type, tier, ticks, cost);
      state.cash -= cost;
      addExpense(state.finances, cost, 'construction', `Research ${type} T${tier}`, state.tickCount);

      return {
        success: true,
        output: `Queued research: ${type} tier ${tier} — ${ticks} ticks, $${cost}.`,
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
