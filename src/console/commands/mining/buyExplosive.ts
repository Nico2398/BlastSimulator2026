// BlastSimulator2026 — Console command: buy explosives into warehouse stock (#1678)

import type { CommandResult } from '../../ConsoleRunner.js';
import type { MiningContext } from './types.js';

/** `buy explosive:<id> kg:<n>` — purchase bulk explosives into explosive warehouses. */
export function buyExplosiveCommand(
  _ctx: MiningContext,
  _named: Record<string, string>,
): CommandResult {
  // TODO: implement
  return { success: false, output: '' };
}
