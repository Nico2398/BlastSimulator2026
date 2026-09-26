// BlastSimulator2026 — Rest-action creation and building-lookup helpers
//
// Shared building/rest-record helpers used by every rest-creating path
// (NeedRestoration.ts's tickNeedRestoration/tickCollapse,
// NeedTaskInsertion.ts's autoInsertNeedTasks, ForceShiftRest.ts) and by rest
// completion (RestCompletion.ts, ShiftCycle.ts). Split out of GameLoop.ts as
// part of #759's file-size split; re-exported there so GameLoop.ts stays the
// single public surface for tick-orchestration callers.

import type { GameState, PendingAction } from '../state/GameState.js';
import { getBuildingDef, findNearestActiveBuildingOfType, type Building, type BuildingType } from '../entities/Building.js';
import { findBuildingApproachCell } from '../nav/BuildingApproach.js';
import type { Employee, NeedKey } from '../entities/Employee.js';
import { addExpense } from '../economy/Finance.js';
import { isInZone, isZoneClear, isZoneStillBlastThreatened } from '../entities/Zone.js';
import {
  NEED_REST_NO_BUILDING_CAP, NEED_REST_COSTS, MAX_NEED_GAUGE,
  AGENT_WALK_SPEED, NEED_DRAIN_RATES, BUILDING_REPLENISH_RATES, NEED_REST_DURATIONS,
} from '../config/balance.js';
import { moveTo, alightOnArrival } from './MoveTo.js';
import { isMounted, mountedVehicleId } from '../entities/EmployeeLocomotion.js';
import { getVehicleDefByTier } from '../entities/Vehicle.js';
import { estimateLegDistance } from './PlanItinerary.js';
import { cellsToTravelTicks } from './ActionSelection.js';
import { hasClaimableSameRoleFollowUp } from './VehicleReservation.js';

/**
 * Create a rest PendingAction with boilerplate fields pre-filled. Generates a
 * new ID from state.nextPendingActionId.
 *
 * `claimedByEmployeeId`, when given, constructs the record already-claimed
 * (status 'assigned', holderId set) — the shape tickNeedRestoration,
 * tickCollapse, and forceShiftRestIfNeeded[ByPolicy] all need, since each
 * self-claims a rest action synchronously at creation. Omit it for
 * autoInsertNeedTasks' busy-employee case, which leaves the action genuinely
 * 'queued'/unheld.
 */
export function createRestPendingAction(
  state: GameState,
  overrides: Pick<PendingAction, 'targetX' | 'targetZ' | 'targetEmployeeId' | 'payload'>,
  claimedByEmployeeId?: number,
): PendingAction {
  return {
    id: state.nextPendingActionId++,
    type: 'rest',
    requiredSkill: null,
    requiredVehicleRole: null,
    targetX: overrides.targetX,
    targetZ: overrides.targetZ,
    targetY: 0,
    payload: overrides.payload,
    targetEmployeeId: overrides.targetEmployeeId,
    status: claimedByEmployeeId !== undefined ? 'assigned' : 'queued',
    holderId: claimedByEmployeeId ?? null,
    queuedAtTick: state.tickCount,
  };
}

/**
 * Find the nearest active building of `buildingType` to (empX, empZ),
 * excluding any candidate that falls inside the player-declared safety zone
 * (state.zone.activeZone) while an evacuation of it is still in progress OR
 * its blast plan is still live (!isZoneClear || isZoneStillBlastThreatened)
 * — narrower than gating on the live drill-plan danger zone for as long as
 * any hole exists anywhere (that would keep every need-driven rest path
 * routing around a site's own living_quarters for the whole drilling phase,
 * not just the evacuation itself: the isZoneStillBlastThreatened half only
 * ever runs once `zone` is non-null, i.e. only after a `zone clear` has
 * actually been drawn), but exactly enough to stop the specific defeat this
 * closes.
 *
 * Without this exclusion, every need-driven rest path (tickCollapse,
 * tickNeedRestoration, ForceShiftRest, autoInsertNeedTasks — all routed
 * through this one helper) will happily send an employee walking straight
 * back into the zone it was just evacuated from the instant the nearest
 * matching building happens to sit inside it, undoing the evacuation —
 * confirmed live via tutorial-interactive.json's `wait_until dangerZoneClear`
 * never resolving, in two stages (#557 and its own follow-up):
 *  1. An employee evacuated clean, then ForceShiftRest's own shift-cycle
 *     policy immediately re-routed them straight back to the living_quarters
 *     sitting under the drill grid the instant they arrived — closed by the
 *     original !isZoneClear exclusion below.
 *  2. Even with every entity genuinely, simultaneously out of the zone (no
 *     stale claim involved at all — a fresh rest request, created after
 *     arrival), the SAME living_quarters was still reachable the moment
 *     isZoneClear read true — which happens the instant evacuation succeeds,
 *     regardless of whether the blast that evacuation was FOR has actually
 *     fired yet. Closed by also requiring !isZoneStillBlastThreatened (#557
 *     follow-up) — see that function's own doc comment (Zone.ts) for why
 *     occupancy alone is the wrong "safe to return" signal.
 * Returns null — same as "no building of this type exists at all" — when
 * every matching building sits inside the not-yet-safe zone, rather than
 * routing there anyway: a degraded rest-in-place (NEED_REST_NO_BUILDING_CAP)
 * is the one outcome that can never walk anyone back into a zone still being
 * cleared, or still armed. Self-deactivates the moment both conditions clear
 * — the routing this exists to stop only applies until then.
 */
export function findNearestBuildingOfType(
  state: GameState,
  buildingType: BuildingType,
  empX: number,
  empZ: number,
): Building | null {
  const zone = state.zone.activeZone;
  if (zone === null || (
    isZoneClear(zone, state.vehicles, state.employees)
    && !isZoneStillBlastThreatened(state.drillHoles, zone)
  )) {
    return findNearestActiveBuildingOfType(state.buildings, buildingType, empX, empZ);
  }

  const outsideZone = state.buildings.buildings.filter(b => !isInZone(b.x, b.z, zone));
  return findNearestActiveBuildingOfType(
    { ...state.buildings, buildings: outsideZone }, buildingType, empX, empZ,
  );
}

/** Find the nearest active living_quarters building to (empX, empZ). */
function findNearestLivingQuarters(
  state: GameState,
  empX: number,
  empZ: number,
): Building | null {
  return findNearestBuildingOfType(state, 'living_quarters', empX, empZ);
}

/**
 * Resolve the nearest walkable NavGrid cell on the ring around a building,
 * closest to (empX, empZ). See findBuildingApproachCell's doc for why a
 * building's raw (x, z) can never be targeted directly (#437) — every
 * rest-routing call site needs this same resolution.
 */
export function resolveBuildingApproach(
  state: GameState,
  building: Building,
  empX: number,
  empZ: number,
): { x: number; z: number } {
  return findBuildingApproachCell(state.navGrid, building, getBuildingDef(building.type, building.tier), empX, empZ);
}

/**
 * Deduct the per-visit cost from cash for the given need gauge.
 *
 * @returns The per-visit cost constant (the amount that would be deducted
 *          ignoring the cash floor of 0). When cash is insufficient, the
 *          actual deduction is less than this value.
 */
export function deductRestCost(state: GameState, needKey: NeedKey): number {
  const cost = NEED_REST_COSTS[needKey];
  // Clamp to [0, cash]: a player already at or below 0 owes nothing more for
  // this specific visit (rather than being charged the full cost like every
  // other expense in the game), but — unlike the previous `Math.max(0, cash -
  // cost)` formula — never resets pre-existing negative cash back up to 0.
  // That old formula treated "already in debt" the same as "can afford part
  // of this," silently erasing any debt the moment a need-rest cost fired.
  const actualDeduction = Math.max(0, Math.min(state.cash, cost));

  state.cash -= actualDeduction;
  addExpense(state.finances, actualDeduction, 'needs', `Rest: ${needKey}`, state.tickCount);
  return cost;
}

/**
 * Shared rest-completion sequence used by both RestCompletion.ts's
 * tickGeneralRestCompletion and ShiftCycle.ts's completeRestTick: replenish
 * the resting need gauge from the nearest active living_quarters (or, with no
 * building in range, up to NEED_REST_NO_BUILDING_CAP only), deduct the
 * visit's NEED_REST_COSTS entry, clear the collapsing flag, and null out
 * restTicksRemaining/activeActionId so the employee returns to normal task
 * dispatch. Callers own any remaining wrap-up specific to their rest source.
 */
/**
 * True when `building`'s living-quarters occupancy is already at capacity —
 * #1204: routes the rest flow's "is there room to go inside" check through
 * the same occupancy model #1202's Mount.ts admitOccupant/enterBuilding
 * already own, the way #1203 did for the training building.
 */
export function isRestBuildingFull(_state: GameState, _building: Building): boolean {
  // TODO(skeleton): implement — see RestActionHelpers.test.ts
  return false;
}

/**
 * Resolves the living_quarters buildingId a rest PendingAction's payload
 * names, if any — #1204: mirrors the equivalent lookup #1203 added for the
 * training flow's own payload-carried buildingId.
 */
export function resolveRestBuildingId(_payload: Record<string, unknown>): number | undefined {
  // TODO(skeleton): implement — see RestActionHelpers.test.ts
  return undefined;
}

export function completeRestForEmployee(state: GameState, emp: Employee, needKey: NeedKey, buildingId?: number): void {
  // TODO(skeleton): use buildingId once completion routes through it — see
  // RestActionHelpers.test.ts
  void buildingId;
  const building = findNearestLivingQuarters(state, emp.x, emp.z);
  if (building) {
    // A completed rest visit at any active living_quarters (any tier) fully
    // restores the gauge. The per-tick BUILDING_REPLENISH_RATES loop this
    // used to run under-restored at Tier 1 (~+64 over NEED_REST_DURATIONS,
    // landing well short of MAX_NEED_GAUGE) while Tier 2/3 already reached it
    // via replenishNeed's own clamp — an employee who finished the full stay
    // should land at the same full gauge regardless of tier (#945).
    emp[needKey] = MAX_NEED_GAUGE;
  } else {
    // No building services this need — the employee rests where they stand.
    // That keeps them on their feet but never fully satisfies them: the gauge
    // rises no higher than NEED_REST_NO_BUILDING_CAP, and the rest itself took
    // NEED_REST_NO_BUILDING_DURATION_MULTIPLIER times as long to get here. A
    // gauge already above the cap is left alone rather than pulled down to it.
    emp[needKey] = Math.max(emp[needKey], NEED_REST_NO_BUILDING_CAP);
  }

  deductRestCost(state, needKey);

  if (emp.collapsing) {
    emp.collapsing = false;
  }

  emp.restTicksRemaining = null;
  emp.restNeedKey = null;
  emp.activeActionId = null;
}

/**
 * Start `emp` travelling to (x, z) as a rest destination, preserving mount
 * continuity: a MOUNTED employee is routed through moveTo/planItinerary like
 * any other journey, so they drive there instead of desyncing from their
 * vehicle (I2_mounted_position_mismatch, WorldInvariants.ts). Continuity is
 * travel-only: alightOnArrival marks the installed itinerary's final leg to
 * alight once that travel completes, freeing the vehicle at arrival — same as
 * any other arrival-gated action — rather than holding it for the whole rest,
 * unless hasClaimableSameRoleFollowUp says this employee is the only
 * one who could ever reclaim it anyway, in which case alighting is skipped
 * and mount continuity holds through the whole rest instead (see that
 * function's own doc comment). Both on-foot and mounted employees route
 * through the same single moveTo call, `allowUnreachable: true` (#1178,
 * single-mover unification) — a genuinely unreachable target still installs
 * a best-effort itinerary rather than refusing the trip. Sets
 * pendingActionType alongside the itinerary so the renderer distinguishes a
 * walk-to-rest from an ordinary task walk (#1013 pictograms) and
 * computeEmployeeActivity (EmployeeActivity.ts) reports actionType: 'rest'
 * for the whole trip, not just once the rest itself is executing. The one
 * shared entry point every rest-creating path calls, except hard-collapse
 * (tickCollapse, NeedRestoration.ts), which alights first — a genuine "give
 * up the vehicle" event (#1118).
 *
 * `buildingId` (#1204, skeleton phase — not yet threaded through): once the
 * rest destination is a living_quarters ring cell rather than the building's
 * own (x, z), this will route through `moveTo(state, emp.id, { buildingId },
 * ...)` instead, entering the building unseen on arrival like #1203 did for
 * the training flow. Omitted (undefined) for the no-building rest-in-place
 * case.
 */
export function beginRestTravel(state: GameState, emp: Employee, x: number, z: number, buildingId?: number): void {
  const wasMounted = isMounted(emp.locomotion);
  // TODO(skeleton): route through moveTo(state, emp.id, {buildingId}) when
  // buildingId is defined — see RestActionHelpers.test.ts
  void buildingId;
  const result = moveTo(state, emp.id, { x, z }, { allowUnreachable: true });
  if (wasMounted && result.success && !hasClaimableSameRoleFollowUp(state, emp)) {
    alightOnArrival(emp);
  }
  emp.pendingActionType = 'rest';
}

/**
 * True when `employee` has physically arrived at, and is actively ticking
 * down, an already-claimed action — the one stated soft-threshold contract
 * every need-driven rest path honors: finish the action already in progress
 * before taking a rest. Shared by NeedTaskInsertion.ts's proactive queuing
 * and ForceShiftRest.ts's legacy/policy paths.
 */
export function isMidClaimedTaskExecution(employee: Employee): boolean {
  return employee.taskTicksRemaining !== null;
}

/**
 * True when `employee` is mid-collapse (walking to a forced rest, or already
 * resting) via either of the two independent triggers that put them there:
 * tickCollapse's fatigue-driven collapse (`collapsing`, #1096/#1107) or
 * ForceShiftRest.ts's shift-boundary rest (`restTicksRemaining` while walking,
 * `pendingRestDuration` while resting, #1110). Both conditions are OR'd
 * because either one alone already removes the employee from
 * claimActionsTargetedAtEmployee eligibility for the same reason: reclaiming
 * a still-'queued', walkOnlyPinnedBy-pinned action targeted at this employee
 * mid-rest reserves its vehicle for the whole rest with nobody aboard,
 * tripping I5_reservation_without_valid_holder (EmployeeDispatch.ts's
 * tickEmployees is the sole caller). `collapsing` is always set and cleared
 * atomically alongside `pendingRestDuration`/`restTicksRemaining`
 * (checkCollapse/tickCollapse, ArrivalGate.ts, completeRestForEmployee above)
 * — except discardStaleRestAction (EvacuationHold.ts), which nulls the two
 * rest fields for a taskQueue-held (not active) rest action during
 * evacuation without touching `collapsing`. That asymmetry does not collapse
 * this OR to a single field check: each sub-condition must stay independently
 * truthy where it already was.
 */
export function isMidCollapseOrForcedRest(employee: Employee): boolean {
  return employee.collapsing
    || employee.restTicksRemaining !== null
    || employee.pendingRestDuration !== null;
}

/**
 * Whether a forced-rest round trip to `building` at (targetX, targetZ) is worth taking:
 * the fatigue it costs to travel there and back must not exceed the fatigue it can recover.
 * `building === null` (resting in place, no travel) is always worthwhile.
 * An unreachable target (no route) is always worthwhile — this guard never blocks on a
 * routing failure another mechanism owns. A world with no NavGrid built yet is the same
 * case: `estimateLegDistance`'s own null-NavGrid convention is to fall back to the cheap
 * octile heuristic (a real, non-null distance — the estimate every other planner caller
 * needs before a NavGrid exists), not to report unreachable, so this guard can't rely on
 * that fallback to reach the "unreachable -> true" branch below. Checked explicitly here
 * instead: no NavGrid means no real routing exists to weigh a round trip against, so this
 * guard must not block one on a heuristic distance it can't actually verify.
 */
export function restRoundTripWorthwhile(
  state: GameState,
  emp: Employee,
  building: Building | null,
  targetX: number,
  targetZ: number,
): boolean {
  if (building === null) return true;
  if (state.navGrid === null) return true;

  // Mounted employees drive the round trip at their vehicle's speed rather
  // than walking it — mirrors hasClaimableSameRoleFollowUp's own mounted-
  // vehicle lookup above.
  let speed: number = AGENT_WALK_SPEED;
  if (isMounted(emp.locomotion)) {
    const vehicle = state.vehicles.vehicles.find(v => v.id === mountedVehicleId(emp.locomotion));
    if (vehicle) {
      speed = getVehicleDefByTier(vehicle.type, vehicle.tier).speed;
    }
  }

  const oneWay = estimateLegDistance(state, 'exact', emp.id, emp.x, emp.z, targetX, targetZ, false);
  // Unreachable is another mechanism's problem (routing failure) — never
  // block a forced rest on it here.
  if (oneWay === null) return true;

  const travelCost = 2 * cellsToTravelTicks(oneWay, speed) * NEED_DRAIN_RATES.fatigue.traveling;

  const headroom = MAX_NEED_GAUGE - emp.fatigue;
  const maxRecovery = Math.min(headroom, BUILDING_REPLENISH_RATES.fatigue[building.tier] * NEED_REST_DURATIONS.fatigue);

  return travelCost <= maxRecovery;
}

/**
 * Resolves where an employee should go to rest (nearest living quarters + approach cell),
 * and whether that round trip is worth taking per `restRoundTripWorthwhile`.
 * Consolidates the building/approach/worthwhile resolution sequence used by both
 * forced-rest entry points in ForceShiftRest.ts.
 */
export function resolveRestDestination(
  state: GameState,
  emp: Employee,
): { targetX: number; targetZ: number; buildingId: number | undefined; worthwhile: boolean } {
  const building = findNearestLivingQuarters(state, emp.x, emp.z);
  if (building === null) {
    // No living_quarters exists at all — same fallback both forced-rest entry
    // points already used (rest in place at the employee's own position),
    // with nothing to weigh a round trip against.
    return { targetX: emp.x, targetZ: emp.z, buildingId: undefined, worthwhile: true };
  }

  const approach = resolveBuildingApproach(state, building, emp.x, emp.z);
  const worthwhile = restRoundTripWorthwhile(state, emp, building, approach.x, approach.z);
  return { targetX: approach.x, targetZ: approach.z, buildingId: building.id, worthwhile };
}
