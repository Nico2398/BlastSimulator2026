// BlastSimulator2026 — Rest-action creation and building-lookup helpers
//
// Shared building/rest-record helpers used by every rest-creating path
// (NeedRestoration.ts's tickNeedRestoration/tickCollapse,
// NeedTaskInsertion.ts's autoInsertNeedTasks, ForceShiftRest.ts) and by rest
// completion (RestCompletion.ts, ShiftCycle.ts). Split out of GameLoop.ts as
// part of #759's file-size split; re-exported there so GameLoop.ts stays the
// single public surface for tick-orchestration callers.

import type { GameState, PendingAction } from '../state/GameState.js';
import type { Building, BuildingType } from '../entities/Building.js';
import type { Employee, NeedKey } from '../entities/Employee.js';

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
  void state; void overrides; void claimedByEmployeeId;
  // TODO: implement
  throw new Error('not implemented');
}

/** Find the nearest active building of `buildingType` to (empX, empZ). */
export function findNearestBuildingOfType(
  state: GameState,
  buildingType: BuildingType,
  empX: number,
  empZ: number,
): Building | null {
  void state; void buildingType; void empX; void empZ;
  // TODO: implement
  throw new Error('not implemented');
}

/** Find the nearest active living_quarters building to (empX, empZ). */
export function findNearestLivingQuarters(
  state: GameState,
  empX: number,
  empZ: number,
): Building | null {
  void state; void empX; void empZ;
  // TODO: implement
  throw new Error('not implemented');
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
  void state; void building; void empX; void empZ;
  // TODO: implement
  throw new Error('not implemented');
}

/**
 * Deduct the per-visit cost from cash for the given need gauge.
 *
 * @returns The per-visit cost constant (the amount that would be deducted
 *          ignoring the cash floor of 0). When cash is insufficient, the
 *          actual deduction is less than this value.
 */
export function deductRestCost(state: GameState, needKey: NeedKey): number {
  void state; void needKey;
  // TODO: implement
  throw new Error('not implemented');
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
  void state; void emp; void needKey;
  // TODO: implement
}
