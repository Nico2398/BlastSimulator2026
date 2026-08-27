// BlastSimulator2026 — Console commands for mining operations
// drill_plan, charge, sequence, blast, preview, build, weather, tubing, survey

import type { CommandResult } from '../ConsoleRunner.js';
import type { GameContext } from './world.js';
import type { GameState, PendingAction } from '../../core/state/GameState.js';
import { t } from '../../core/i18n/I18n.js';
import {
  createGridPlan, addHole, removeHole, resetHoleIds,
  computeDrillHoleDurationTicks,
} from '../../core/mining/DrillPlan.js';
import type { DrillHole } from '../../core/mining/DrillPlan.js';
import { dispatchPendingAction, cancelAction } from '../../core/engine/TaskDispatch.js';
import { createCharge, batchCharge, computeChargeHoleDurationTicks } from '../../core/mining/ChargePlan.js';
import { setDelay, autoVPattern } from '../../core/mining/Sequence.js';
import { assembleBlastPlan, validateBlastPlan } from '../../core/mining/BlastPlan.js';
import type { BlastPlan, ValidationError } from '../../core/mining/BlastPlan.js';
import { executeBlast, buildBlastReport } from '../../core/mining/BlastExecution.js';
import { getExplosive } from '../../core/world/ExplosiveCatalog.js';
import { MIN_STEMMING_M, MAX_DRILL_GRID_HOLES, MAX_RAMP_LENGTH } from '../../core/config/balance.js';
import { addBlastFragments, syncLogisticsCapacity } from '../../core/economy/Logistics.js';
import { addExpense } from '../../core/economy/Finance.js';
import { formatMoney } from '../../core/economy/formatMoney.js';
import { processProjections } from '../../core/entities/Damage.js';
import { killEmployee } from '../../core/entities/Employee.js';
import { destroyVehicle } from '../../core/entities/Vehicle.js';

import { recordVibration, recordBuildingDestruction } from '../../core/scores/ScoreManager.js';
import { recordBlastResult, snapshotStats } from '../../core/campaign/SuccessTracker.js';
import {
  previewEnergy,
  previewFragments,
  previewProjections,
  previewVibrations,
  purchaseSoftware,
} from '../../core/mining/Software.js';
import {
  RAMP_WIDTH, RAMP_COST_PER_METER, validateRampOrder, defineRampSegments,
  computeColumnSurfaceY, rampStepColumn,
  type RampDirection, type RampDef,
} from '../../core/mining/Ramp.js';
import type { PlannedRamp } from '../../core/state/GameState.js';
import {
  createWeatherCycle,
  forceAdvance,
  setWeather,
  ALL_WEATHER_STATES,
  type WeatherState,
} from '../../core/weather/WeatherCycle.js';
import { wetHoles } from '../../core/mining/WetHoles.js';
import { Random } from '../../core/math/Random.js';
import { buyTubing, installTubing } from '../../core/mining/Tubing.js';
import type { FragmentData } from '../../core/mining/BlastExecution.js';
import { runSurvey, SURVEY_METHODS, type SurveyMethod, computeBlastOreReport } from '../../core/mining/SurveyCalc.js';
import { SURVEY_COSTS, VOXEL_SIZE_CM, SURVEY_COVERAGE_RADIUS } from '../../core/config/balance.js';
import { detectOreReport } from '../../core/events/EventEngine.js';
import { NavGrid } from '../../core/nav/NavGrid.js';
import { getStorageCapacity } from '../../core/entities/Building.js';
import { claimForAction, cellsInRect, cellsInDisc } from './siteExpansion.js';

// ── Extended context for mining ──

export interface MiningContext extends GameContext {
  weatherCycle?: ReturnType<typeof createWeatherCycle>;
  rng?: Random;
  /** Positions of fragments from the last blast — used by renderer for localized re-mesh. */
  lastBlastFragments?: { x: number; y: number; z: number }[];
  /** Full fragment data from last blast — used by renderer to spawn fragment meshes. */
  lastBlastFragmentData?: FragmentData[];
  /** Drill holes from before the last blast — used by renderer for per-hole detonation timing. */
  lastBlastHoles?: import('../../core/mining/DrillPlan.js').DrillHole[];
  /** Each fragment's journey from where it broke to where it settled — the renderer animates these. */
  lastBlastFlights?: import('../../core/mining/BlastResolve.js').FragmentFlight[];
}

function requireGame(ctx: MiningContext): string | null {
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
function requireGameWithSub(
  ctx: MiningContext,
  args: string[],
): { error: CommandResult } | { error: null; sub: string | undefined } {
  const err = requireGame(ctx);
  if (err) return { error: { success: false, output: err } };
  return { error: null, sub: args[0] };
}

/** Payload carried by a queued `drill_hole` PendingAction (#553). */
export interface DrillHoleActionPayload {
  holeId: string;
  x: number;
  z: number;
  depth: number;
  diameter: number;
  durationTicks: number;
}

/** Payload carried by a queued `charge_hole` PendingAction (#554). */
export interface ChargeHoleActionPayload {
  holeId: string;
  explosiveId: string;
  amountKg: number;
  stemmingM: number;
  durationTicks: number;
}

/** Payload carried by a queued `dig_ramp_segment` PendingAction (#555). */
export interface RampSegmentActionPayload {
  rampId: number;
  segmentIndex: number;
  cells: { x: number; y: number; z: number }[];
  region: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number } | null;
  segmentCost: number;
}

/**
 * Cancel every outstanding `drill_hole` PendingAction (queued/assigned/
 * in_progress — anything not yet completed) and empty both hole pools
 * (`plannedDrillHoles` and `drillHoles`), plus any per-hole charge/sequence
 * state keyed by hole id (#553). Cancellation is routed through the shared
 * `cancelAction` (#548) so an in-flight employee/vehicle is released back to
 * idle and any order-time cost is refunded — `drill_hole` carries none today
 * (only `survey` charges upfront), so the refund is always 0 in practice.
 * Returns the total number of holes cleared (ordered + drilled).
 */
export function clearDrillPlan(ctx: MiningContext): number {
  const state = ctx.state!;
  const clearedCount = state.drillHoles.length + state.plannedDrillHoles.length;

  for (const action of state.pendingActions.filter(a => a.type === 'drill_hole' || a.type === 'charge_hole')) {
    cancelAction(state, action.id);
  }

  state.plannedDrillHoles = [];
  state.drillHoles = [];
  state.chargesByHole = {};
  state.plannedChargesByHole = {};
  state.sequenceDelays = {};

  return clearedCount;
}

/**
 * Cancel the outstanding `charge_hole` PendingAction for `holeId`, if any
 * (#554, mirrors drill_hole's cancel-before-replace pattern). A no-op when
 * the hole has no order in flight.
 */
function cancelOutstandingChargeAction(state: GameState, holeId: string): void {
  const action = state.pendingActions.find(a => a.type === 'charge_hole' && a.payload['holeId'] === holeId);
  if (action) cancelAction(state, action.id);
}

/**
 * Resolve a user-supplied hole spec (`named['hole']`) to a canonical hole
 * id: the exact id if it already names a real hole, otherwise the legacy
 * `hole_N` fallback format. `includePlanned` controls whether an ordered-
 * but-not-yet-drilled hole counts as "real" for this purpose — drill_plan
 * remove and charge must see planned holes; sequence set and tubing install
 * must not, since they only ever act on an already-drilled hole (#634).
 */
function resolveHoleId(
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
 * Drop every per-hole charge/sequence record for `holeId` — called when a
 * hole leaves the plan (drilled or still-ordered branch of drill_plan
 * remove) so no stale charge or delay survives under an id nothing
 * references anymore (#634).
 */
function clearHoleCharges(state: GameState, holeId: string): void {
  delete state.chargesByHole[holeId];
  delete state.plannedChargesByHole[holeId];
  delete state.sequenceDelays[holeId];
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
 * `drillPlanCommand`'s `remove hole:<id>` and `clearDrillPlan` above already
 * call `cancelAction` immediately alongside their own splice/delete of the
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

// ── Drill plan commands ──

export function drillPlanCommand(
  ctx: MiningContext,
  args: string[],
  named: Record<string, string>,
): CommandResult {
  const preamble = requireGameWithSub(ctx, args);
  if (preamble.error) return preamble.error;
  const sub = preamble.sub;

  if (sub === 'grid') {
    const origin = (named['origin'] ?? named['start'] ?? '0,0').split(',').map(Number);
    const rows = parseInt(named['rows'] ?? '3', 10);
    const cols = parseInt(named['cols'] ?? '3', 10);
    const spacing = parseFloat(named['spacing'] ?? '3');
    const depth = parseFloat(named['depth'] ?? '8');
    const diameter = parseFloat(named['diameter'] ?? '0.15');

    if (!Number.isFinite(rows) || !Number.isFinite(cols) || rows < 1 || cols < 1) {
      return { success: false, output: 'Invalid drill grid: rows and cols must be positive whole numbers.' };
    }
    if (rows * cols > MAX_DRILL_GRID_HOLES) {
      return {
        success: false,
        output: `Drill grid too large: ${rows}×${cols} = ${rows * cols} holes exceeds the ${MAX_DRILL_GRID_HOLES}-hole limit per plan.`,
      };
    }

    resetHoleIds();
    const planned = createGridPlan(
      { x: origin[0] ?? 0, z: origin[1] ?? 0 },
      rows, cols, spacing, depth, diameter,
    );

    // Claim before committing the plan: a grid reaching ground the site
    // cannot have is refused whole, rather than landing half on the map.
    const claim = claimForAction(ctx, planned.map(h => ({ x: h.x, z: h.z })), 'drill');
    if (!claim.ok) {
      resetHoleIds();
      return { success: false, output: claim.output! };
    }

    // A grid replaces the whole plan (#553): drop every hole (ordered or
    // already drilled) and any drill_hole action still outstanding for them
    // first, so resetHoleIds()'s restart-at-H1 above never collides with an
    // id still live in pendingActions/plannedDrillHoles.
    clearDrillPlan(ctx);

    for (const hole of planned) {
      dispatchDrillHoleAction(ctx, hole);
      ctx.state!.plannedDrillHoles.push(hole);
    }

    return {
      success: true,
      output: `Drill plan: ${rows}×${cols} grid, ${ctx.state!.plannedDrillHoles.length} holes ordered, spacing ${spacing}m, depth ${depth}m`,
    };
  }

  if (sub === 'add') {
    const x = parseFloat(named['x'] ?? '0');
    const z = parseFloat(named['z'] ?? named['y'] ?? '0');
    const depth = parseFloat(named['depth'] ?? '8');
    const diameter = parseFloat(named['diameter'] ?? '0.15');
    const claim = claimForAction(ctx, [{ x, z }], 'drill');
    if (!claim.ok) return { success: false, output: claim.output! };

    // Additive — unlike 'grid' above, does not clear the existing plan.
    const hole = addHole(ctx.state!.plannedDrillHoles, x, z, depth, diameter);
    dispatchDrillHoleAction(ctx, hole);

    return { success: true, output: `Added hole ${hole.id} at (${x}, ${z}), depth ${depth}m` };
  }

  if (sub === 'clear') {
    const clearedCount = clearDrillPlan(ctx);
    return { success: true, output: `Cleared drill plan (${clearedCount} holes)` };
  }

  if (sub === 'remove') {
    const state = ctx.state!;
    const holeSpec = named['hole'] ?? '';
    const holeId = resolveHoleId(state, holeSpec);

    if (removeHole(state.drillHoles, holeId)) {
      cancelOutstandingChargeAction(state, holeId);
      clearHoleCharges(state, holeId);
      return { success: true, output: `Removed hole ${holeId}` };
    }

    const plannedIdx = state.plannedDrillHoles.findIndex(h => h.id === holeId);
    if (plannedIdx !== -1) {
      const action = state.pendingActions.find(a => a.type === 'drill_hole' && a.payload['holeId'] === holeId);
      if (action) cancelAction(state, action.id);
      cancelOutstandingChargeAction(state, holeId);
      state.plannedDrillHoles.splice(plannedIdx, 1);
      clearHoleCharges(state, holeId);
      return { success: true, output: `Removed hole ${holeId}` };
    }

    return { success: false, output: `Hole "${holeId}" not found` };
  }

  if (sub === 'show') {
    const state = ctx.state!;
    if (state.drillHoles.length === 0 && state.plannedDrillHoles.length === 0) {
      return { success: true, output: t('mining.drill_plan.none') };
    }
    const orderedLines = state.plannedDrillHoles.map(h =>
      `  ${h.id}: (${h.x}, ${h.z}) depth=${h.depth}m dia=${h.diameter}m [ORDERED]`,
    );
    const drilledLines = state.drillHoles.map(h =>
      `  ${h.id}: (${h.x}, ${h.z}) depth=${h.depth}m dia=${h.diameter}m`,
    );
    const lines = [...orderedLines, ...drilledLines];
    return { success: true, output: `Drill plan (${lines.length} holes):\n${lines.join('\n')}` };
  }

  return { success: false, output: t('mining.drill_plan.usage') };
}

// ── Charge commands ──

/**
 * Queue a `charge_hole` PendingAction for `hole` with the given (already
 * validated) charge, cancelling any outstanding order for the same hole
 * first so a re-charge replaces rather than stacks (#554, mirrors drill_plan
 * grid/add's drill_hole dispatch).
 */
function dispatchChargeAction(
  ctx: MiningContext,
  hole: { id: string; x: number; z: number },
  explosiveId: string,
  amountKg: number,
  stemmingM: number,
): void {
  const state = ctx.state!;
  cancelOutstandingChargeAction(state, hole.id);

  const durationTicks = computeChargeHoleDurationTicks(amountKg);
  const actionId = state.nextPendingActionId++;
  // skipQualificationCheck (#554, mirrors drill_hole's #553 dispatch): a
  // charge order must queue silently even when nobody on the roster
  // currently holds 'blasting' yet.
  dispatchPendingAction(state, {
    id: actionId,
    type: 'charge_hole',
    requiredSkill: 'blasting',
    requiredVehicleRole: null,
    targetX: hole.x,
    targetZ: hole.z,
    targetY: 0,
    payload: {
      holeId: hole.id, explosiveId, amountKg, stemmingM, durationTicks,
    } satisfies ChargeHoleActionPayload,
    targetEmployeeId: null,
  }, { skipQualificationCheck: true });

  state.plannedChargesByHole[hole.id] = { explosiveId, amountKg, stemmingM };
}

/**
 * Queue a `drill_hole` PendingAction for `hole` — the per-hole dispatch
 * built independently by drill_plan grid's loop and drill_plan add's
 * single-hole path (#790, mirrors dispatchChargeAction's #554
 * extraction for charge_hole). Does not touch plannedDrillHoles: grid's
 * caller pushes the hole itself; add's caller already got it pushed by
 * addHole.
 */
function dispatchDrillHoleAction(
  ctx: MiningContext,
  hole: DrillHole,
): void {
  const durationTicks = computeDrillHoleDurationTicks(hole.depth, hole.diameter);
  const actionId = ctx.state!.nextPendingActionId++;
  // skipQualificationCheck (#553, mirrors HaulDispatch.ts's #552
  // syncHaulDispatch): a drill order must queue silently even when nobody
  // on the roster currently holds 'blasting' or a drill_rig licence —
  // rejecting it outright here would make ordering holes depend on
  // hiring order instead of eventually being drillable once qualified.
  dispatchPendingAction(ctx.state!, {
    id: actionId,
    type: 'drill_hole',
    requiredSkill: 'blasting',
    requiredVehicleRole: 'drill_rig',
    targetX: hole.x,
    targetZ: hole.z,
    targetY: 0,
    payload: {
      holeId: hole.id, x: hole.x, z: hole.z, depth: hole.depth, diameter: hole.diameter, durationTicks,
    } satisfies DrillHoleActionPayload,
    targetEmployeeId: null,
  }, { skipQualificationCheck: true });
}

export function chargeCommand(
  ctx: MiningContext,
  _args: string[],
  named: Record<string, string>,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return { success: false, output: err };

  if (_args[0] === 'show') {
    const orderedEntries = Object.entries(ctx.state!.plannedChargesByHole);
    const loadedEntries = Object.entries(ctx.state!.chargesByHole);
    if (orderedEntries.length === 0 && loadedEntries.length === 0) return { success: true, output: t('mining.charge.none_set') };
    const orderedLines = orderedEntries.map(([id, c]) =>
      `  ${id}: ${c.explosiveId} ${c.amountKg}kg, stemming ${c.stemmingM}m [ORDERED]`,
    );
    const loadedLines = loadedEntries.map(([id, c]) =>
      `  ${id}: ${c.explosiveId} ${c.amountKg}kg, stemming ${c.stemmingM}m`,
    );
    return { success: true, output: `Charges:\n${[...orderedLines, ...loadedLines].join('\n')}` };
  }

  const holeSpec = named['hole'] ?? '';
  const explosiveId = named['explosive'] ?? '';
  const amount = parseFloat((named['amount'] ?? '0').replace('kg', ''));
  const stemming = parseFloat((named['stemming'] ?? String(MIN_STEMMING_M)).replace('m', ''));

  if (!explosiveId) return { success: false, output: t('mining.charge.missing_explosive') };

  if (holeSpec === '*') {
    const holeIds = ctx.state!.drillHoles.map(h => h.id);
    const depths: Record<string, number> = {};
    for (const h of ctx.state!.drillHoles) depths[h.id] = h.depth;
    const result = batchCharge(holeIds, depths, explosiveId, amount, stemming);
    if (result.errors.length > 0) {
      return { success: false, output: `Errors:\n${result.errors.map(e => `  ${e.holeId}: ${e.message}`).join('\n')}` };
    }
    for (const h of ctx.state!.drillHoles) {
      const charge = result.charges[h.id];
      if (!charge) continue;
      dispatchChargeAction(ctx, h, charge.explosiveId, charge.amountKg, charge.stemmingM);
    }
    return { success: true, output: `Ordered charges for ${holeIds.length} holes with ${explosiveId} ${amount}kg` };
  }

  // Resolve holeId: accept either the exact ID (H1) or the legacy hole_N format
  const holeId = resolveHoleId(ctx.state!, holeSpec);
  const hole = ctx.state!.drillHoles.find(h => h.id === holeId);
  if (!hole) {
    const planned = ctx.state!.plannedDrillHoles.find(h => h.id === holeId);
    if (planned) return { success: false, output: `Hole "${holeId}" has not been drilled yet.` };
    return { success: false, output: `Hole "${holeId}" not found` };
  }

  const result = createCharge(explosiveId, amount, stemming, hole.depth);
  if ('error' in result) return { success: false, output: result.error };

  dispatchChargeAction(ctx, hole, explosiveId, amount, stemming);
  return { success: true, output: `Charge ordered for ${holeId}: ${explosiveId} ${amount}kg, stemming ${stemming}m` };
}

// ── Sequence commands ──

export function sequenceCommand(
  ctx: MiningContext,
  args: string[],
  named: Record<string, string>,
): CommandResult {
  const preamble = requireGameWithSub(ctx, args);
  if (preamble.error) return preamble.error;
  const sub = preamble.sub;

  if (sub === 'auto') {
    const step = parseFloat((named['delay_step'] ?? '25').replace('ms', ''));
    ctx.state!.sequenceDelays = autoVPattern(ctx.state!.drillHoles, step);
    return { success: true, output: `Auto V-pattern sequence, ${step}ms step, ${Object.keys(ctx.state!.sequenceDelays).length} holes` };
  }

  if (sub === 'set') {
    const hole = named['hole'] ?? '';
    const delay = parseFloat((named['delay'] ?? '0').replace('ms', ''));
    const holeId = resolveHoleId(ctx.state!, hole, false);
    setDelay(ctx.state!.sequenceDelays, holeId, delay);
    return { success: true, output: `Set ${holeId} delay: ${delay}ms` };
  }

  if (sub === 'show') {
    const entries = Object.entries(ctx.state!.sequenceDelays);
    if (entries.length === 0) return { success: true, output: t('mining.sequence.none_set') };
    const lines = entries.sort(([, a], [, b]) => a - b)
      .map(([id, d]) => `  ${id}: ${d}ms`);
    return { success: true, output: `Sequence:\n${lines.join('\n')}` };
  }

  return { success: false, output: t('mining.sequence.usage') };
}

// ── Blast commands ──

/**
 * Assemble the current drill/charge/sequence state into a BlastPlan —
 * the same three GameState fields passed to assembleBlastPlan at every
 * call site (blastCommand, blastPlanCommand's validate, previewCommand,
 * blastPreviewCommand) (#790).
 */
function assembleCurrentBlastPlan(state: GameState): BlastPlan {
  return assembleBlastPlan(state.drillHoles, state.chargesByHole, state.sequenceDelays);
}

/**
 * Validate the current blast plan against the current set of
 * still-loading charge orders — the second GameState field
 * (plannedChargesByHole) every validate-then-refuse call site reads
 * identically (#790).
 */
function validateCurrentBlastPlan(state: GameState, plan: BlastPlan): ValidationError[] {
  return validateBlastPlan(plan, new Set(Object.keys(state.plannedChargesByHole)));
}

/**
 * Render blast-plan validation errors as the multi-line message every
 * validate-then-refuse call site built identically, varying only in
 * header text ("Invalid plan" vs "Validation issues") (#790).
 */
function formatBlastPlanErrors(errors: ValidationError[], header: string): string {
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
function assembleValidBlastPlan(
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

export function blastCommand(
  ctx: MiningContext,
  _args: string[],
  _named: Record<string, string>,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return { success: false, output: err };

  const assembled = assembleValidBlastPlan(ctx.state!, t('mining.blast_plan.invalid_plan_header'));
  if (assembled.error) return assembled.error;
  const plan = assembled.plan;

  // ctx.weatherCycle may not exist yet (created lazily by the `weather`
  // command, eagerly by main.ts on new_game/campaign start/sandbox start —
  // see console-api.ts's `weather` field doc) — 'sunny' (not raining) is the
  // correct fallback either way, since createWeatherCycle's own initial
  // state is always 'sunny' regardless of seed.
  const wetHoleIds = new Set(wetHoles(ctx.state!, ctx.weatherCycle?.current ?? 'sunny'));
  const result = executeBlast(plan, ctx.grid!, [], undefined, ctx.state!.buildings, ctx.emitter, wetHoleIds);
  if (!result) return { success: false, output: 'Blast execution failed.' };

  // Store fragment data for renderer (localized remesh + mesh spawning)
  ctx.lastBlastFragments = result.fragments.map(f => f.position);
  ctx.lastBlastFragmentData = result.fragments;
  ctx.lastBlastFlights = result.flights;

  const state = ctx.state!;

  // Buildings destroyed by the blast: score penalty per building. Their freed
  // footprint is already inside clearedRegion (a building is only destroyed
  // when its footprint overlaps a cleared voxel), so the NavGrid patch below
  // — keyed on clearedRegion — covers it without a second patch call.
  for (const destroyed of result.destroyedBuildings) {
    recordBuildingDestruction(state.scores, destroyed.type === 'explosive_warehouse');
  }

  // A blast can destroy a Freight Warehouse — keep logistics capacity honest.
  if (result.destroyedBuildings.length > 0) {
    syncLogisticsCapacity(state.logistics, getStorageCapacity(state.buildings));
  }

  // Ore value is informational only here — cash is credited when the ore is
  // actually hauled, stored, and sold/delivered (see Logistics.consumeStoredOre).

  // Update scores based on blast outcome
  if (result.projectionCount > 0) {
    recordVibration(state.scores, result.projectionCount * 0.5);
  }

  // Standing on the rock when it goes is not survivable, whatever the charge:
  // the ground is simply not there any more. Evacuating the blast zone first
  // (see Zone.ts) is the whole point of the safety drill.
  const blastedColumns = new Set(result.clearedColumns);
  for (const emp of state.employees.employees) {
    if (!emp.alive) continue;
    if (!blastedColumns.has(`${Math.floor(emp.x)},${Math.floor(emp.z)}`)) continue;
    killEmployee(state.employees, emp.id);
    state.damage.deathCount++;
    state.damage.lawsuitPending = true;
    state.damage.accidents.push({
      tick: state.tickCount, type: 'death', entityId: emp.id, fragmentId: -1, kineticEnergy: 0,
    });
  }
  for (const veh of [...state.vehicles.vehicles]) {
    if (!blastedColumns.has(`${Math.floor(veh.x)},${Math.floor(veh.z)}`)) continue;
    destroyVehicle(state.vehicles, veh.id);
    state.damage.accidents.push({
      tick: state.tickCount, type: 'vehicle_destroyed', entityId: veh.id, fragmentId: -1, kineticEnergy: 0,
    });
  }

  // Rock that was thrown lands somewhere, and whatever is standing there pays
  // for it. Fragment positions are where the rock came to rest and its speed is
  // what it was doing on impact, so this reads the blast's own outcome rather
  // than guessing at a danger radius.
  const impacts = processProjections(
    result.fragments,
    state.buildings,
    state.vehicles,
    state.employees,
    state.damage,
    state.tickCount,
  );
  if (impacts.length > 0) {
    syncLogisticsCapacity(state.logistics, getStorageCapacity(state.buildings));
  }

  // Track blast in damage state and level stats
  state.damage.blastCount++;
  recordBlastResult(state.levelStats, result.fragments);
  snapshotStats(state.levelStats, state);

  // Trigger one post-blast ore report event when conditions are met.
  const oreReport = computeBlastOreReport(result.fragments, state.surveyResults);
  state.lastOreReport = oreReport;
  detectOreReport(oreReport, state.events, state.tickCount);

  // Track blast fragments in logistics for contract delivery. collectedOre is
  // only credited once a fragment is hauled and delivered to a warehouse
  // (see Logistics.deliverToDepot), not the instant the blast resolves.
  addBlastFragments(state.logistics, result.fragments);

  // Store drill holes before clearing (needed by renderer for per-hole detonation timing)
  ctx.lastBlastHoles = [...state.drillHoles];

  // Charge cost, summed before the plan is cleared below — BlastResult has no
  // notion of money spent, only rock/ore recovered.
  let spent = 0;
  for (const charge of Object.values(state.chargesByHole)) {
    const explosive = getExplosive(charge.explosiveId);
    if (explosive) spent += explosive.costPerKg * charge.amountKg;
  }
  state.lastBlastReport = buildBlastReport(result, state.tickCount, spent);

  // Clear drill plan after blast (holes are consumed)
  state.drillHoles = [];
  state.chargesByHole = {};
  state.plannedChargesByHole = {};
  state.sequenceDelays = {};

  // Patch NavGrid to reflect terrain changes from the blast
  if (state.navGrid) {
    NavGrid.patchNavGrid(state.navGrid, ctx.grid!, state.buildings.buildings, state.drillHoles, result.clearedRegion);
  }

  return {
    success: true,
    output: [
      t('mining.blast.report_header'),
      `Rating: ${result.rating.toUpperCase()}`,
      `Cleared voxels: ${result.clearedVoxels}`,
      `Cracked voxels: ${result.crackedVoxels}`,
      `Fragments: ${result.fragmentCount}`,
      `Average fragment size: ${result.averageFragmentSize.toFixed(3)} m³`,
      `Oversized fragments: ${result.oversizedFragments}`,
      `Projections: ${result.projectionCount}`,
      `Furthest throw: ${result.maxThrowDistance.toFixed(1)} m`,
      `Total rock volume: ${result.totalRockVolume.toFixed(1)} m³`,
      `Total ore value: $${result.totalOreValue.toFixed(0)}`,
      ...(result.destroyedBuildings.length > 0
        ? [`Buildings destroyed: ${result.destroyedBuildings.map(b => `${b.type} #${b.buildingId}`).join(', ')}`]
        : []),
    ].join('\n'),
  };
}

// ── Blast plan save/load/validate ──

export function blastPlanCommand(
  ctx: MiningContext,
  args: string[],
  named: Record<string, string>,
): CommandResult {
  const preamble = requireGameWithSub(ctx, args);
  if (preamble.error) return preamble.error;
  const sub = preamble.sub;

  if (sub === 'save') {
    const name = named['name'] ?? 'default';
    ctx.state!.savedPlans[name] = {
      drillHoles: [...ctx.state!.drillHoles],
      chargesByHole: { ...ctx.state!.chargesByHole },
      sequenceDelays: { ...ctx.state!.sequenceDelays },
    };
    return { success: true, output: `Plan saved as "${name}"` };
  }

  if (sub === 'load') {
    const name = named['name'] ?? 'default';
    const saved = ctx.state!.savedPlans[name];
    if (!saved) return { success: false, output: `No saved plan "${name}"` };
    ctx.state!.drillHoles = [...saved.drillHoles];
    ctx.state!.chargesByHole = { ...saved.chargesByHole };
    ctx.state!.sequenceDelays = { ...saved.sequenceDelays };
    return { success: true, output: `Plan "${name}" loaded` };
  }

  if (sub === 'validate') {
    const assembled = assembleValidBlastPlan(ctx.state!, t('mining.blast_plan.validation_issues_header'));
    if (assembled.error) return assembled.error;
    return { success: true, output: 'Plan is valid and ready to blast.' };
  }

  if (sub === 'list') {
    const names = Object.keys(ctx.state!.savedPlans);
    if (names.length === 0) return { success: true, output: t('mining.blast_plan.none_saved') };
    return { success: true, output: `Saved plans:\n${names.map(n => `  ${n}`).join('\n')}` };
  }

  return { success: false, output: t('mining.blast_plan.usage') };
}

// ── Preview commands ──

export function previewCommand(
  ctx: MiningContext,
  args: string[],
  _named: Record<string, string>,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return { success: false, output: err };

  const plan = assembleCurrentBlastPlan(ctx.state!);
  const tier = ctx.state!.softwareTier;
  const sub = args[0];

  if (sub === 'energy') {
    const result = previewEnergy(plan, ctx.grid!, tier);
    if (!result) return { success: false, output: `Requires software tier 1+ (current: ${tier})` };
    return { success: true, output: `Energy preview: ${result.energyMap.size} voxels, max=${result.maxEnergy.toFixed(1)}, min=${result.minEnergy.toFixed(1)}` };
  }
  if (sub === 'fragments') {
    const result = previewFragments(plan, ctx.grid!, tier);
    if (!result) return { success: false, output: `Requires software tier 2+ (current: ${tier})` };
    return { success: true, output: `Fragment preview: ${result.fracturedCount} fractured, ${result.crackedCount} cracked, ${result.unaffectedCount} unaffected, avg size ${result.avgFragmentSize.toFixed(2)}` };
  }
  if (sub === 'projections') {
    const result = previewProjections(plan, ctx.grid!, tier);
    if (!result) return { success: false, output: `Requires software tier 3+ (current: ${tier})` };
    return { success: true, output: `Projection preview: ${result.projectionZoneCount} voxels in projection zone` };
  }
  if (sub === 'vibrations') {
    const result = previewVibrations(plan, [], tier);
    if (!result) return { success: false, output: `Requires software tier 4+ (current: ${tier})` };
    return { success: true, output: `Vibration preview: max=${result.maxVibration.toFixed(4)}` };
  }

  return { success: false, output: t('mining.preview.usage') };
}

/**
 * Show a comprehensive blast preview covering energy, fragmentation,
 * projections, and vibrations — each unlocked by the corresponding
 * software tier.  Sections with insufficient tier display a lock message.
 */
export function blastPreviewCommand(
  ctx: MiningContext,
  _args: string[],
  _named: Record<string, string>,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return { success: false, output: err };

  if (ctx.state!.drillHoles.length === 0) {
    return { success: false, output: t('mining.blast.no_drill_plan') };
  }

  const assembled = assembleValidBlastPlan(ctx.state!, t('mining.blast_plan.invalid_plan_header'));
  if (assembled.error) return assembled.error;
  const plan = assembled.plan;

  const tier = ctx.state!.softwareTier;
  const energyPreview = previewEnergy(plan, ctx.grid!, tier);
  const fragmentPreview = previewFragments(plan, ctx.grid!, tier);
  const projectionPreview = previewProjections(plan, ctx.grid!, tier);
  const vibrationPreview = previewVibrations(plan, [], tier);

  ctx.state!.lastBlastPreview = {
    tier,
    energy: energyPreview
      ? { affectedVoxels: energyPreview.energyMap.size, minEnergy: energyPreview.minEnergy, maxEnergy: energyPreview.maxEnergy }
      : null,
    fragments: fragmentPreview
      ? {
        fractured: fragmentPreview.fracturedCount, cracked: fragmentPreview.crackedCount, unaffected: fragmentPreview.unaffectedCount,
        avgFragmentSizeCm: fragmentPreview.avgFragmentSize * VOXEL_SIZE_CM,
      }
      : null,
    projections: projectionPreview
      ? {
        projectionZoneVoxels: projectionPreview.projectionZoneCount,
        collapseFragments: Math.max(0, (fragmentPreview?.fracturedCount ?? 0) + (fragmentPreview?.crackedCount ?? 0) - projectionPreview.projectionZoneCount),
      }
      : null,
    vibrations: vibrationPreview
      ? { maxVibration: vibrationPreview.maxVibration, affectedVillages: vibrationPreview.villages.length }
      : null,
  };

  const lines: string[] = [t('mining.blast.preview_header')];

  lines.push('');
  if (energyPreview) {
    lines.push('--- Energy Map ---');
    lines.push(`  Affected voxels: ${energyPreview.energyMap.size}`);
    lines.push(`  Min energy: ${energyPreview.minEnergy.toFixed(1)}`);
    lines.push(`  Max energy: ${energyPreview.maxEnergy.toFixed(1)}`);
  } else {
    lines.push('--- Energy Map --- [Requires software tier 1]');
  }

  lines.push('');
  if (fragmentPreview) {
    lines.push('--- Fragmentation ---');
    lines.push(`  Fractured: ${fragmentPreview.fracturedCount}`);
    lines.push(`  Cracked: ${fragmentPreview.crackedCount}`);
    lines.push(`  Unaffected: ${fragmentPreview.unaffectedCount}`);
    lines.push(`  Average fragment size: ${fragmentPreview.avgFragmentSize.toFixed(3)} m³`);
  } else {
    lines.push('--- Fragmentation --- [Requires software tier 2]');
  }

  lines.push('');
  if (projectionPreview) {
    const fractured = fragmentPreview?.fracturedCount ?? 0;
    const cracked = fragmentPreview?.crackedCount ?? 0;
    // Fragments that are fractured/cracked but NOT projected outward collapse in place
    const collapseCount = (fractured + cracked) - projectionPreview.projectionZoneCount;
    lines.push('--- Projections ---');
    lines.push(`  Projection zone voxels: ${projectionPreview.projectionZoneCount}`);
    lines.push(`  Projected fragments: ${projectionPreview.projectionZoneCount}`);
    lines.push(`  Collapse fragments: ${collapseCount}`);
  } else {
    lines.push('--- Projections --- [Requires software tier 3]');
  }

  lines.push('');
  if (vibrationPreview) {
    lines.push('--- Vibrations ---');
    lines.push(`  Max vibration: ${vibrationPreview.maxVibration.toFixed(4)}`);
    lines.push(`  Affected villages: ${vibrationPreview.villages.length}`);
  } else {
    lines.push('--- Vibrations --- [Requires software tier 4]');
  }

  return { success: true, output: lines.join('\n') };
}

// ── Buy software ──

export function buySoftwareCommand(
  ctx: MiningContext,
  _args: string[],
  named: Record<string, string>,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return { success: false, output: err };

  const currentTier = ctx.state!.softwareTier;

  if (named['tier'] !== undefined) {
    const requestedTier = parseInt(named['tier'], 10);
    if (requestedTier <= currentTier) {
      return { success: false, output: `Already at tier ${requestedTier} or higher` };
    }
    if (requestedTier > currentTier + 1) {
      return { success: false, output: `Must purchase tier ${currentTier + 1} first` };
    }
    // requestedTier === currentTier + 1 — fall through to purchase
  }

  const result = purchaseSoftware(currentTier, ctx.state!.cash);
  if ('error' in result) return { success: false, output: result.error };
  ctx.state!.cash -= result.cost;
  addExpense(ctx.state!.finances, result.cost, 'equipment', `Software tier ${result.newTier}`, ctx.state!.tickCount);
  ctx.state!.softwareTier = result.newTier;
  return { success: true, output: `Upgraded to software tier ${result.newTier}. Cost: $${result.cost}` };
}

// ── Build ramp ──

export function buildRampCommand(
  ctx: MiningContext,
  args: string[],
  named: Record<string, string>,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return { success: false, output: err };

  if (args[0] === 'cancel') {
    const rampId = parseInt(args[1] ?? named['id'] ?? '', 10);
    if (isNaN(rampId)) return { success: false, output: t('mining.build_ramp.cancel_usage') };
    return cancelRampCommand(ctx, rampId);
  }

  let originX: number;
  let originZ: number;
  let direction: RampDirection;
  let length: number;
  const depth = parseInt(named['depth'] ?? '8', 10);

  if (named['start'] && named['end']) {
    const start = named['start'].split(',').map(Number);
    const end = named['end'].split(',').map(Number);
    originX = start[0] ?? 0;
    originZ = start[1] ?? 0;
    const dx = (end[0] ?? 0) - originX;
    const dz = (end[1] ?? 0) - originZ;
    if (Math.abs(dz) >= Math.abs(dx)) {
      direction = dz >= 0 ? 'south' : 'north';
      length = Math.abs(Math.round(dz));
    } else {
      direction = dx >= 0 ? 'east' : 'west';
      length = Math.abs(Math.round(dx));
    }
  } else {
    const origin = (named['origin'] ?? '0,0').split(',').map(Number);
    originX = origin[0] ?? 0;
    originZ = origin[1] ?? 0;
    direction = (named['direction'] ?? 'south') as RampDirection;
    length = parseInt(named['length'] ?? '10', 10);
  }

  // Pre-check runs before rampFootprint/cellsInRect build the array (the cost this
  // bounds), and therefore also before validateRampOrder's own length<=0 check below —
  // that check stays as a safety net for any other caller of buildRamp/validateRampOrder,
  // but on this call path it is now unreachable for length<1.
  if (!Number.isFinite(length) || length < 1) {
    return { success: false, output: 'Invalid ramp length: length must be a finite positive number.' };
  }
  if (length > MAX_RAMP_LENGTH) {
    return {
      success: false,
      output: `Ramp too long: ${length}m exceeds the ${MAX_RAMP_LENGTH}m limit per ramp.`,
    };
  }

  const footprint = rampFootprint(originX, originZ, direction, length);
  const rampClaim = claimForAction(ctx, cellsInRect(footprint.minX, footprint.minZ, footprint.maxX, footprint.maxZ), 'build a ramp');
  if (!rampClaim.ok) return { success: false, output: rampClaim.output! };

  const rampDef: RampDef = { originX, originZ, direction, length, targetDepth: depth };
  const validation = validateRampOrder(rampDef, ctx.state!.cash);
  if (!validation.success) return { success: false, output: validation.message };

  const segments = defineRampSegments(ctx.grid!, rampDef);

  // Cost is charged in full at order time — unspent remainder (unworked
  // segments' share) is refunded on cancel via actionOrderCost/cancelAction
  // (#555, mirrors #553/#554's order-then-work pattern).
  ctx.state!.cash -= validation.cost;
  addExpense(ctx.state!.finances, validation.cost, 'construction', 'Build ramp', ctx.state!.tickCount);

  const rampId = ctx.state!.nextPlannedRampId++;
  const plannedRamp: PlannedRamp = { id: rampId, def: rampDef, footprint, segments: [] };

  for (const segment of segments) {
    const { x: cx, z: cz } = rampStepColumn(rampDef, segment.index);
    const surfaceY = computeColumnSurfaceY(ctx.grid!, cx, cz);
    const actionId = ctx.state!.nextPendingActionId++;

    // skipQualificationCheck (#555, mirrors drill_hole/charge_hole's #553/
    // #554 dispatch): a ramp order must queue silently even when nobody on
    // the roster currently holds driving.excavator or a rock_digger yet.
    dispatchPendingAction(ctx.state!, {
      id: actionId,
      type: 'dig_ramp_segment',
      requiredSkill: 'driving.excavator',
      requiredVehicleRole: 'rock_digger',
      targetX: cx,
      targetZ: cz,
      targetY: surfaceY,
      payload: {
        rampId, segmentIndex: segment.index, cells: segment.cells, region: segment.region,
        segmentCost: RAMP_COST_PER_METER,
      } satisfies RampSegmentActionPayload,
      targetEmployeeId: null,
    }, { skipQualificationCheck: true });

    plannedRamp.segments.push({
      index: segment.index, actionId, cells: segment.cells, region: segment.region, done: false,
    });
  }

  ctx.state!.plannedRamps.push(plannedRamp);

  return {
    success: true,
    output: `Ramp ordered: ${length}m ${direction}, ${segments.length} segments queued for excavation`,
  };
}

/**
 * Cancel an ordered ramp still excavating (#555, mirrors `cancelAction`'s use
 * for drill/charge orders) — releases any in-flight `dig_ramp_segment`
 * actions (refunding each segment's unspent order-time cost via
 * `cancelAction`/`actionOrderCost`) and removes the `PlannedRamp` entirely.
 * Already-carved terrain is kept; only undug segments' cost is refunded.
 */
export function cancelRampCommand(ctx: MiningContext, rampId: number): { success: boolean; output: string } {
  const state = ctx.state!;
  const ramp = state.plannedRamps.find(r => r.id === rampId);
  if (!ramp) return { success: false, output: `Ramp #${rampId} not found` };

  let refunded = 0;
  for (const segment of ramp.segments) {
    if (segment.done) continue;
    const result = cancelAction(state, segment.actionId);
    if (result.success) refunded += result.refunded ?? 0;
  }

  const idx = state.plannedRamps.findIndex(r => r.id === rampId);
  if (idx !== -1) state.plannedRamps.splice(idx, 1);

  return {
    success: true,
    output: `Ramp #${rampId} cancelled.${refunded > 0 ? ` $${formatMoney(refunded)} refunded.` : ''}`,
  };
}

/** The cells a ramp of `length` cuts through, running `direction` from (originX, originZ). Max inclusive. */
function rampFootprint(
  originX: number, originZ: number, direction: RampDirection, length: number,
): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const ox = Math.floor(originX);
  const oz = Math.floor(originZ);
  if (direction === 'north' || direction === 'south') {
    return {
      minX: ox,
      maxX: ox + RAMP_WIDTH,
      minZ: Math.min(oz, direction === 'north' ? oz - length : oz),
      maxZ: Math.max(oz, direction === 'south' ? oz + length : oz),
    };
  }
  return {
    minX: Math.min(ox, direction === 'west' ? ox - length : ox),
    maxX: Math.max(ox, direction === 'east' ? ox + length : ox),
    minZ: oz,
    maxZ: oz + RAMP_WIDTH,
  };
}

// ── Weather commands ──

export function weatherCommand(
  ctx: MiningContext,
  args: string[],
  _named: Record<string, string>,
): CommandResult {
  const err = requireGame(ctx);
  if (err) return { success: false, output: err };

  if (!ctx.weatherCycle) {
    ctx.weatherCycle = createWeatherCycle(ctx.state!.seed);
    ctx.rng = new Random(ctx.state!.seed + 1000);
  }

  if (args[0] === 'advance') {
    forceAdvance(ctx.weatherCycle, ctx.rng!);
    return { success: true, output: `Weather: ${ctx.weatherCycle.current}` };
  }

  if (args[0] === 'set') {
    const target = args[1] as WeatherState | undefined;
    if (!target || !ALL_WEATHER_STATES.includes(target)) {
      return {
        success: false,
        output: t('mining.weather.set_usage', { valid: ALL_WEATHER_STATES.join(', ') }),
      };
    }
    setWeather(ctx.weatherCycle, target);
    return { success: true, output: `Weather: ${ctx.weatherCycle.current}` };
  }

  return { success: true, output: `Current weather: ${ctx.weatherCycle.current}` };
}

// ── Tubing commands ──

export function tubingCommand(
  ctx: MiningContext,
  args: string[],
  named: Record<string, string>,
): CommandResult {
  const preamble = requireGameWithSub(ctx, args);
  if (preamble.error) return preamble.error;
  const sub = preamble.sub;

  if (sub === 'buy') {
    const amount = parseInt(named['amount'] ?? '1', 10);
    const result = buyTubing(ctx.state!.tubingState, amount, ctx.state!.cash);
    if (!result.success) return { success: false, output: result.message };
    ctx.state!.cash -= result.cost;
    addExpense(ctx.state!.finances, result.cost, 'equipment', `Tubing x${amount}`, ctx.state!.tickCount);
    return { success: true, output: `${result.message}. Inventory: ${ctx.state!.tubingState.inventory}` };
  }

  if (sub === 'install') {
    const holeSpec = named['hole'] ?? '';
    const holeId = resolveHoleId(ctx.state!, holeSpec, false);
    const result = installTubing(ctx.state!.tubingState, holeId);
    return { success: result.success, output: result.message };
  }

  return { success: true, output: `Tubing inventory: ${ctx.state!.tubingState.inventory}, installed: ${ctx.state!.tubingState.installedHoles.size} holes` };
}

// ── Survey command ──

export function surveyCommand(
  ctx: MiningContext,
  args: string[],
  named: Record<string, string>,
): CommandResult {
  const preamble = requireGameWithSub(ctx, args);
  if (preamble.error) return preamble.error;
  const sub = preamble.sub;

  if (sub === 'show') {
    const pending = ctx.state!.pendingActions.filter(a => a.type === 'survey');
    if (pending.length === 0) return { success: true, output: t('mining.survey.none_pending') };
    // payload['method'] is Record<string, unknown> — String() narrows to a printable value
    const lines = pending.map(
      a => `  [${a.id}] ${String(a.payload['method'])} at (${a.targetX}, ${a.targetZ})`,
    );
    return { success: true, output: `Pending surveys:\n${lines.join('\n')}` };
  }

  if (sub === 'mode') {
    const pendingCount = ctx.state!.pendingActions.filter(a => a.type === 'survey').length;
    const completedCount = ctx.state!.surveyResults.length;
    return {
      success: true,
      output: `Survey status: ${completedCount} completed, ${pendingCount} pending.`,
    };
  }

  if (sub === 'ore_report') {
    const report = ctx.state!.lastOreReport;
    if (!report) {
      return {
        success: false,
        output: t('mining.survey.ore_report_unavailable'),
      };
    }

    const oreLines = Object.entries(report.oreYields).map(
      ([oreId, kg]) => `  ${oreId}: ${kg.toFixed(1)}kg`,
    );

    const lines = [
      t('mining.survey.ore_report_header'),
      ...(oreLines.length > 0 ? oreLines : ['  (no ore recovered)']),
      `Total yield: ${report.totalYieldKg.toFixed(1)}kg`,
      `Estimated yield: ${report.estimatedYieldKg.toFixed(1)}kg`,
      report.estimatedYieldKg === 0
        ? 'Yield ratio: n/a (no surveyed ore in blast zone)'
        : `Yield ratio: ${(report.yieldRatio * 100).toFixed(0)}% of estimate`,
    ];

    return { success: true, output: lines.join('\n') };
  }

  if (!sub) {
    return { success: false, output: t('mining.survey.usage') };
  }
  if (!(SURVEY_METHODS as string[]).includes(sub)) {
    return {
      success: false,
      output: t('mining.survey.unknown_method', { method: sub }),
    };
  }

  // sub is a validated SurveyMethod from this point
  const method = sub as SurveyMethod;

  if (named['x'] === undefined || named['z'] === undefined) {
    return {
      success: false,
      output: t('mining.survey.usage'),
    };
  }

  const x = parseInt(named['x'], 10);
  const z = parseInt(named['z'], 10);
  if (isNaN(x) || isNaN(z)) {
    return { success: false, output: 'Invalid coordinates: x and z must be integers.' };
  }

  const claim = claimForAction(ctx, cellsInDisc(x, z, SURVEY_COVERAGE_RADIUS[method]), 'survey');
  if (!claim.ok) return { success: false, output: claim.output! };

  const result = runSurvey(ctx.state!, { method, centerX: x, centerZ: z });

  if (!result.success) {
    if (result.error === 'insufficient_funds') {
      return { success: false, output: `Insufficient funds. ${method} survey costs $${SURVEY_COSTS[method]}.` };
    }
    if (result.error === 'no_surveyor') {
      return { success: false, output: 'No available surveyor. Hire an employee with geology qualification.' };
    }
    return { success: false, output: 'Survey failed.' };
  }

  return {
    success: true,
    output: `${method} survey queued at (${x}, ${z}). Action ID: ${result.actionId}.`,
  };
}
