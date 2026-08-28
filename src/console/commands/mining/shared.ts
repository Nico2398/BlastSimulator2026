// BlastSimulator2026 — Cross-family helpers shared by mining console commands

import type { CommandResult } from '../../ConsoleRunner.js';
import type { GameState, PendingAction } from '../../../core/state/GameState.js';
import { cancelAction } from '../../../core/engine/TaskDispatch.js';
import { t } from '../../../core/i18n/I18n.js';
import { assembleBlastPlan, validateBlastPlan } from '../../../core/mining/BlastPlan.js';
import type { BlastPlan, ValidationError } from '../../../core/mining/BlastPlan.js';
import type { MiningContext } from './types.js';

export function requireGame(ctx: MiningContext): string | null {
  if (!ctx.state || !ctx.grid) return t('console.no_game_loaded');
  return null;
}

/**
 * Shared preamble for every *Command function that requires an active
 * game and then dispatches on a subcommand (args[0]) — the no-game-loaded
 * guard and the subcommand extraction were duplicated identically across
 * drillPlanCommand, sequenceCommand, blastPlanCommand, tubingCommand, and
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
 * remove and charge must see planned holes; sequence set and tubing install
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
 * Cancel the outstanding `charge_hole` PendingAction for `holeId`, if any
 * (#554, mirrors drill_hole's cancel-before-replace pattern). A no-op when
 * the hole has no order in flight.
 */
export function cancelOutstandingChargeAction(state: GameState, holeId: string): void {
  const action = state.pendingActions.find(a => a.type === 'charge_hole' && a.payload['holeId'] === holeId);
  if (action) cancelAction(state, action.id);
}

/**
 * Removes a cancelled `drill_hole`/`charge_hole` action's own ghost from the
 * "ordered but not yet landed" pool it was tracked in (`plannedDrillHoles`/
 * `plannedChargesByHole`) — `cancelAction` (`TaskDispatch.ts`) only removes
 * the generic `PendingAction`/`ghostPreviews` record, deliberately staying
 * ignorant of mining-specific state so it can cancel any action type; the
 * planned-pool entry is this module's own bookkeeping and has to be cleared
 * here.
 *
 * `drillPlanCommand`'s `remove hole:<id>` and `clearDrillPlan` already call
 * `cancelAction` immediately alongside their own splice/delete of the
 * matching planned entry, so they need nothing further. The gap this closes
 * is the *other* way a player cancels an order: the Operations panel's Work
 * Queue cancel button, which reaches `cancelAction` only through the generic
 * `employee cancel <id>` command (`employees.ts`) with no mining-specific
 * cleanup of its own — leaving a permanent, un-clearable ghost on the hole
 * (#554's code review, reproduced live: `orderedChargeCount`/
 * `plannedChargesByHole` still carried the cancelled hole after
 * `employee cancel <id>` reported success). The issue's own text is explicit
 * that cancelling a charge order removes its ghost; this generic path is
 * exactly where that promise broke, and — since `plannedDrillHoles` is
 * populated at order time the same way (#553) — the identical gap existed
 * for a cancelled drill order too.
 */
export function releasePlannedHoleForCancelledAction(state: GameState, action: PendingAction): void {
  // #555: a cancelled dig_ramp_segment keyed off rampId/segmentIndex, not
  // holeId — handled separately, same generic-cancel-path gap as
  // drill_hole/charge_hole above (the Operations panel's Work Queue cancel
  // button reaches only this hook, not buildRampCommand's own cancel path).
  if (action.type === 'dig_ramp_segment') {
    const rampId = action.payload['rampId'];
    if (typeof rampId !== 'number') return;
    const ramp = state.plannedRamps.find(r => r.id === rampId);
    if (!ramp) return;

    const segmentIndex = action.payload['segmentIndex'];
    const idx = ramp.segments.findIndex(s => s.index === segmentIndex);
    if (idx !== -1) ramp.segments.splice(idx, 1);

    if (!ramp.segments.some(s => !s.done)) {
      const rampIdx = state.plannedRamps.findIndex(r => r.id === rampId);
      if (rampIdx !== -1) state.plannedRamps.splice(rampIdx, 1);
    }
    return;
  }

  // #556: a cancelled place_building order keyed off buildingOrderId, not
  // holeId — same generic-cancel-path gap as dig_ramp_segment above. Money
  // is already refunded in full by cancelAction/actionOrderCost (a building
  // is one atomic unit, not segmented); this only removes the PlannedBuilding
  // (and its ghost, via completePendingAction — already run by cancelAction
  // before this hook fires) so the site can be built on again.
  if (action.type === 'place_building') {
    const buildingOrderId = action.payload['buildingOrderId'];
    if (typeof buildingOrderId !== 'number') return;
    const idx = state.plannedBuildings.findIndex(pb => pb.id === buildingOrderId);
    if (idx !== -1) state.plannedBuildings.splice(idx, 1);
    return;
  }

  const holeId = action.payload['holeId'];
  if (typeof holeId !== 'string') return;

  if (action.type === 'drill_hole') {
    const idx = state.plannedDrillHoles.findIndex(h => h.id === holeId);
    if (idx !== -1) state.plannedDrillHoles.splice(idx, 1);
  } else if (action.type === 'charge_hole') {
    delete state.plannedChargesByHole[holeId];
  }
}

/**
 * Assemble the current drill/charge/sequence state into a BlastPlan —
 * the same three GameState fields passed to assembleBlastPlan at every
 * call site (blastCommand, blastPlanCommand's validate, previewCommand,
 * blastPreviewCommand) (#790).
 */
export function assembleCurrentBlastPlan(state: GameState): BlastPlan {
  return assembleBlastPlan(state.drillHoles, state.chargesByHole, state.sequenceDelays);
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
