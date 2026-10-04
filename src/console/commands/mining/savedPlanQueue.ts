// BlastSimulator2026 — Queue a saved blast plan as drill/charge orders

import type { CommandResult } from '../../ConsoleRunner.js';
import type { SavedBlastPlan } from '../../../core/state/GameState.js';
import type { MiningContext } from './types.js';

/**
 * Queue the saved plan's holes as drill_hole orders and its charges as
 * charge_hole orders. All-or-nothing on funds; holes already at the same
 * x,z are skipped.
 */
export function queueSavedBlastPlan(_ctx: MiningContext, _saved: SavedBlastPlan, _name: string): CommandResult {
  // TODO: implement
  return { success: false, output: '' };
}
