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
import { replenishNeed } from '../entities/EmployeeNeeds.js';
import { addExpense } from '../economy/Finance.js';
import { isInZone, isZoneClear, isZoneStillBlastThreatened } from '../entities/Zone.js';
import { NEED_REST_DURATIONS, NEED_REST_NO_BUILDING_CAP, NEED_REST_COSTS } from '../config/balance.js';

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
export function findNearestLivingQuarters(
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
export function completeRestForEmployee(state: GameState, emp: Employee, needKey: NeedKey): void {
  const building = findNearestLivingQuarters(state, emp.x, emp.z);
  if (building) {
    const def = getBuildingDef(building.type, building.tier);
    // BUILDING_REPLENISH_RATES is a per-tick rate (its own doc comment, and
    // Employee.test.ts's "per-tick fill rate" framing), but this call site
    // used to apply it exactly once regardless of how many ticks the rest
    // actually spent — one tick's worth of gain for the whole visit. Against
    // any real travel distance to and from the building, that one tick is
    // smaller than what the round trip alone costs in drain, so an employee
    // whose work site isn't adjacent to their living_quarters nets negative
    // every cycle: collapse, rest, walk back barely recovered, collapse
    // again before finishing (or even starting) the next task — confirmed
    // live, a solo driller stuck oscillating at ~0-10 fatigue for 5000+
    // ticks with a tier-1 living_quarters two tiles from the drill grid,
    // never landing a single hole (#700). Scaling by the rest's own
    // NEED_REST_DURATIONS[needKey] — the same constant that sets how many
    // ticks the visit takes — applies the full rate for the full stay,
    // matching the "per-tick" contract the rate was already documented as.
    for (let i = 0; i < NEED_REST_DURATIONS[needKey]; i++) {
      replenishNeed(emp, needKey, building.tier, def.capacity);
    }
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
