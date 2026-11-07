// BlastSimulator2026 — Charge ordering: queue and auto-charge holes (#1345)

import type { GameState, PendingAction } from '../state/GameState.js';
import type { DrillHole } from './DrillPlan.js';
import {
  createCharge, computeChargeHoleDurationTicks,
  type HoleCharge, type ChargeError,
} from './ChargePlan.js';
import { dispatchPendingAction, cancelAction } from '../engine/TaskDispatch.js';
import { isExplosiveAvailable } from '../campaign/Level.js';

type AutoChargeOutcome = 'ordered' | 'invalid' | 'skipped';

/** Payload carried by a queued `charge_hole` PendingAction (#554). */
export interface ChargeHoleActionPayload {
  holeId: string;
  explosiveId: string;
  amountKg: number;
  stemmingM: number;
  /** Base ticks; scaled by the worker's proficiency at claim time. */
  durationTicks: number;
}

/** Outstanding (queued or claimed) `charge_hole` action for a hole. */
function findOutstandingChargeAction(state: GameState, holeId: string): PendingAction | undefined {
  return state.pendingActions.find(a => a.type === 'charge_hole' && a.payload['holeId'] === holeId);
}

/**
 * blockedReason of the first outstanding (unfinished) charge order that has one, null
 * when none or none blocked (#1649). A claimed order carries no reason, so the first
 * order in the queue is not the one to read (#1660).
 */
export function outstandingChargeBlockedReason(state: Pick<GameState, 'pendingActions'>): string | null {
  for (const a of state.pendingActions) {
    if (a.type === 'charge_hole' && a.blockedReason != null) return a.blockedReason;
  }
  return null;
}

/** Cancel the outstanding charge order of a hole, refunding its cost. No-op without one (#554). */
export function cancelOutstandingChargeAction(state: GameState, holeId: string): void {
  const action = findOutstandingChargeAction(state, holeId);
  if (action) cancelAction(state, action.id);
}

/**
 * Queue a `charge_hole` action for `hole`, replacing any outstanding order so a
 * re-charge does not stack (#554). Pays nothing: the explosive is drawn and paid when
 * the hole is loaded (#2143). Re-charging an already-loaded hole pays in full then and
 * does not refund the consumed explosive — intentional default.
 */
export function dispatchChargeAction(
  state: GameState,
  hole: { id: string; x: number; z: number },
  charge: HoleCharge,
): void {
  const { explosiveId, amountKg, stemmingM } = charge;
  cancelOutstandingChargeAction(state, hole.id);

  const durationTicks = computeChargeHoleDurationTicks(amountKg);
  const actionId = state.nextPendingActionId++;
  // Worked from a charging truck by a crew member holding 'blasting' and the
  // truck's licence (#1649). skipQualificationCheck (#554): the order must still
  // queue silently with no truck, driver or blaster; OrderReachability then
  // stamps why nobody can take it (blockedReason).
  dispatchPendingAction(state, {
    id: actionId,
    type: 'charge_hole',
    requiredSkill: 'blasting',
    requiredVehicleRole: 'charging_truck',
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

/** True when the hole is charged or has an outstanding charge order. */
export function isHoleChargeCovered(state: GameState, holeId: string): boolean {
  return state.chargesByHole[holeId] !== undefined || findOutstandingChargeAction(state, holeId) !== undefined;
}

/** Ids of holes with an outstanding charge order, built in one pass over the queue. */
function outstandingChargeHoleIds(state: GameState): Set<string> {
  const ids = new Set<string>();
  for (const a of state.pendingActions) {
    if (a.type === 'charge_hole') ids.add(a.payload['holeId'] as string);
  }
  return ids;
}

/**
 * What replacing the drill plan would lose: drilled holes and charges (loaded or
 * planned). Null when the plan holds only ordered-not-yet-drilled holes, i.e.
 * nothing worth confirming (#1345).
 */
export function planReplacementLoss(
  state: Pick<GameState, 'drillHoles' | 'chargesByHole' | 'plannedChargesByHole'>,
): { drilled: number; charged: number } | null {
  const drilled = state.drillHoles.length;
  const charged = Object.keys(state.chargesByHole).length + Object.keys(state.plannedChargesByHole).length;
  return drilled > 0 || charged > 0 ? { drilled, charged } : null;
}

/**
 * The pattern charge, or null when none is set. Side effect: a pattern whose
 * explosive the level no longer offers is cleared
 * rather than returned.
 */
function takePatternOrClearIfUnavailable(state: GameState): HoleCharge | null {
  const pattern = state.patternCharge;
  if (pattern == null) return null;
  if (!isExplosiveAvailable(state.campaign.activeLevelId, pattern.explosiveId)) {
    state.patternCharge = null;
    return null;
  }
  return pattern;
}

/** Order the pattern charge for one hole, funds checked per hole. Caller guarantees the hole is uncovered. */
function orderPatternCharge(state: GameState, hole: DrillHole, pattern: HoleCharge): AutoChargeOutcome | { error: string } {
  const created = createCharge(pattern.explosiveId, pattern.amountKg, pattern.stemmingM, hole.depth, hole.diameter);
  if ('error' in created) return { error: created.error };
  dispatchChargeAction(state, hole, created.charge);
  return 'ordered';
}

/** Apply the pattern charge to a freshly drilled hole. Never throws. */
export function autoChargeHole(state: GameState, hole: DrillHole): AutoChargeOutcome {
  const pattern = takePatternOrClearIfUnavailable(state);
  if (pattern == null || isHoleChargeCovered(state, hole.id)) return 'skipped';
  const outcome = orderPatternCharge(state, hole, pattern);
  return typeof outcome === 'string' ? outcome : 'invalid';
}

/** Charge a set of holes with the pattern charge, skipping covered ones. */
export function chargePatternHoles(
  state: GameState,
  holes: ReadonlyArray<DrillHole>,
): { ordered: string[]; invalid: ChargeError[] } {
  const result = { ordered: [] as string[], invalid: [] as ChargeError[] };
  const pattern = takePatternOrClearIfUnavailable(state);
  if (pattern == null) return result;
  const outstanding = outstandingChargeHoleIds(state);
  for (const hole of holes) {
    if (state.chargesByHole[hole.id] !== undefined || outstanding.has(hole.id)) continue;
    const outcome = orderPatternCharge(state, hole, pattern);
    if (typeof outcome !== 'string') result.invalid.push({ holeId: hole.id, message: outcome.error });
    else if (outcome === 'ordered') result.ordered.push(hole.id);
  }
  return result;
}
