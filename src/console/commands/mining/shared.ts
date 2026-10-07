// BlastSimulator2026 — Cross-family helpers shared by mining console commands

import type { CommandResult } from '../../ConsoleRunner.js';
import type { GameState } from '../../../core/state/GameState.js';
import { cancelAction } from '../../../core/engine/TaskDispatch.js';
import { t } from '../../../core/i18n/I18n.js';
import { assembleBlastPlan, validateBlastPlan } from '../../../core/mining/BlastPlan.js';
import type { BlastPlan, ValidationError } from '../../../core/mining/BlastPlan.js';
import type { MiningContext } from './types.js';
import type { GameContext } from '../world.js';
import { villagePositions } from '../../../core/mining/BlastExecution.js';
import type { VillagePosition } from '../../../core/mining/BlastExecution.js';
import { clearTubing } from '../../../core/mining/Tubing.js';
import { wetHoleIdsFor } from '../../../core/mining/WetHoles.js';
import { emitFootprintOccupancyChanged } from '../buildingHelpers.js';

export function requireGame(ctx: MiningContext): string | null {
  if (!ctx.state || !ctx.grid) return t('console.no_game_loaded');
  return null;
}

/**
 * Shared preamble for every *Command function that requires an active
 * game and then dispatches on a subcommand (args[0]) — the no-game-loaded
 * guard and the subcommand extraction were duplicated identically across
 * drillPlanCommand, blastPlanCommand, tubingCommand, and
 * surveyCommand (#790). Returns the CommandResult to return immediately
 * on failure, or the extracted subcommand to continue with.
 */
export function requireGameWithSub(
  ctx: MiningContext,
  args: string[],
): { error: CommandResult } | { error: null; sub: string | undefined } {
  const err = requireGame(ctx);
  if (err) return { error: { success: false, output: err } };
  return { error: null, sub: args[0] };
}

/**
 * Resolve a user-supplied hole spec (`named['hole']`) to a canonical hole
 * id: the exact id if it already names a real hole, otherwise the legacy
 * `hole_N` fallback format. `includePlanned` controls whether an ordered-
 * but-not-yet-drilled hole counts as "real" for this purpose — drill_plan
 * remove and charge must see planned holes; tubing install
 * must not, since they only ever act on an already-drilled hole (#634).
 */
export function resolveHoleId(
  state: GameState,
  holeSpec: string,
  includePlanned: boolean = true,
): string {
  const found = includePlanned
    ? (state.drillHoles.find(h => h.id === holeSpec) || state.plannedDrillHoles.find(h => h.id === holeSpec))
    : state.drillHoles.find(h => h.id === holeSpec);
  return found
    ? holeSpec
    : (holeSpec.startsWith('hole_') ? holeSpec : `hole_${holeSpec}`);
}

/**
 * Assemble the current drill/charge state into a BlastPlan —
 * the same three GameState fields passed to assembleBlastPlan at every
 * call site (blastCommand, blastPlanCommand's validate, previewCommand,
 * blastPreviewCommand) (#790).
 */
export function assembleCurrentBlastPlan(state: GameState): BlastPlan {
  return assembleBlastPlan(state.drillHoles, state.chargesByHole);
}

/**
 * Validate the current blast plan against the current set of
 * still-loading charge orders — the second GameState field
 * (plannedChargesByHole) every validate-then-refuse call site reads
 * identically (#790).
 */
export function validateCurrentBlastPlan(state: GameState, plan: BlastPlan): ValidationError[] {
  return validateBlastPlan(plan, new Set(Object.keys(state.plannedChargesByHole)));
}

/**
 * Render blast-plan validation errors as the multi-line message every
 * validate-then-refuse call site built identically, varying only in
 * header text ("Invalid plan" vs "Validation issues") (#790).
 */
export function formatBlastPlanErrors(errors: ValidationError[], header: string): string {
  return `${header}:\n${errors.map(e => `  ${e.holeId}: ${t(e.issue)}`).join('\n')}`;
}

/**
 * Assemble the current blast plan and validate it, returning either the
 * CommandResult to return immediately on validation failure or the valid
 * plan to proceed with — the assemble+validate+early-return sequence
 * duplicated identically at every command that must refuse to blast an
 * invalid plan (blastCommand, blastPlanCommand's validate sub,
 * blastPreviewCommand) (#790).
 */
export function assembleValidBlastPlan(
  state: GameState,
  header: string,
): { error: CommandResult } | { error: null; plan: BlastPlan } {
  const plan = assembleCurrentBlastPlan(state);
  const errors = validateCurrentBlastPlan(state, plan);
  if (errors.length > 0) {
    return { error: { success: false, output: formatBlastPlanErrors(errors, header) } };
  }
  return { error: null, plan };
}

/** Ids of drilled holes currently wet (rain-flooded); weather defaults to 'sunny' before the cycle exists. */
export function wetHoleIdSet(ctx: MiningContext): Set<string> {
  return wetHoleIdsFor(ctx.state!);
}

/** Vibration targets for the current level's villages (none when no playable area is loaded). */
export function levelVillagePositions(ctx: MiningContext): VillagePosition[] {
  return villagePositions(ctx.playableArea?.villages() ?? []);
}

/** Cancel every pending action of `type`; other types untouched. */
export function cancelPendingActionsOfType(state: GameState, type: string): void {
  // Snapshot: cancelAction splices state.pendingActions.
  for (const action of state.pendingActions.filter(a => a.type === type)) {
    cancelAction(state, action.id);
  }
}

/**
 * Cancel every pending `drill_hole` action and empty `state.plannedDrillHoles`.
 * Returns the number of ordered holes cancelled. Other action types untouched.
 */
export function cancelOutstandingDrillActions(state: GameState): number {
  const ordered = state.plannedDrillHoles.length;
  cancelPendingActionsOfType(state, 'drill_hole');
  state.plannedDrillHoles = [];
  return ordered;
}

/**
 * Reset every plan-scoped record: drilled holes, tubing (inventory kept),
 * charges. Shared by `drill_plan clear` and the
 * post-blast cleanup so the two cannot drift apart (#1351).
 */
export function resetPlanState(state: GameState): void {
  state.drillHoles = [];
  clearTubing(state.tubingState);
  state.chargesByHole = {};
  state.plannedChargesByHole = {};
  state.patternCharge = null;
  state.chargeAwaitingFunds = [];
}

/**
 * Emit nav:occupancy_changed for the 1x1 cell under each hole so the NavGrid
 * cost is restored when drilled holes are removed (#1360); `drill_plan clear`
 * reaches it through clearDrillPlan. No-op when grid is null or holes is empty.
 */
export function emitHoleCellsChanged(
  ctx: GameContext,
  holes: ReadonlyArray<{ x: number; z: number }>,
): void {
  for (const h of holes) {
    emitFootprintOccupancyChanged(ctx, Math.floor(h.x), Math.floor(h.z), 1, 1);
  }
}
