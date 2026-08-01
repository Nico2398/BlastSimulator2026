// BlastSimulator2026 — Console command for Research Center tier-unlock tasks
// Wraps queueResearchTask / isTierUnlocked (src/core/entities/BuildingResearch.ts).
// Registered in createRunner.ts alongside the other Phase 5/6 commands.

import type { CommandResult } from '../ConsoleRunner.js';
import type { GameContext } from './world.js';
import {
  queueResearchTask,
  hasActiveResearchCenter,
  isTierUnlocked,
  isResearchQueued,
  getUnmetConditions,
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

      // Precedence: no_research_center, already_unlocked, already_queued,
      // conditions_not_met (all read-only, replicated here so cash is only
      // checked once every other precondition already passes), then
      // insufficient_funds, and only then commit via queueResearchTask —
      // avoids leaving a phantom queued task when funds are short.
      const def = getResearchTaskDef(type, tier);

      if (!hasActiveResearchCenter(state.buildings)) {
        return {
          success: false,
          code: 'no_research_center',
          output: `A Research Center is required before queueing tier ${tier} ${type}.`,
        };
      }
      if (isTierUnlocked(state.buildings, type, tier)) {
        return {
          success: false,
          code: 'already_unlocked',
          output: `Tier ${tier} ${type} is already unlocked.`,
        };
      }
      if (isResearchQueued(state.buildings, type, tier)) {
        return {
          success: false,
          code: 'already_queued',
          output: `Tier ${tier} ${type} is already queued for research.`,
        };
      }
      if (getUnmetConditions(state.buildings, def.conditions).length > 0) {
        return {
          success: false,
          code: 'conditions_not_met',
          output: `Tier ${tier} ${type} does not meet its research prerequisites.`,
        };
      }
      if (state.cash < def.cost) {
        return {
          success: false,
          code: 'insufficient_funds',
          output: `Insufficient funds: research costs $${def.cost}.`,
        };
      }

      const result = queueResearchTask(state.buildings, type, tier);
      if (!result.success) {
        // Preconditions were re-checked above; a failure here means state
        // changed between the checks and the commit (should not happen in
        // single-threaded console mode), but relay it defensively.
        return {
          success: false,
          code: result.code ?? 'no_research_center',
          output: `Could not queue research: ${result.code ?? 'unknown error'}.`,
        };
      }

      const cost = result.cost ?? def.cost;
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
