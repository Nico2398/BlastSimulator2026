// InjuryRecovery — injured employees recover over time, faster in better living quarters (#1382).

import type { GameState } from '../state/GameState.js';
import type { EventEmitter } from '../state/EventEmitter.js';
import type { Employee } from '../entities/Employee.js';
import { healEmployee, injuryTicksOf } from '../entities/Employee.js';
import { isInsideBuilding, isMounted } from '../entities/EmployeeLocomotion.js';
import { INJURY_ON_FOOT_RECOVERY_RATE, INJURY_RECOVERY_RATE_BY_LQ_TIER } from '../config/balance.js';
import { findNearestBuildingOfType } from './RestActionHelpers.js';
import { moveTo } from './MoveTo.js';
import { leaveBuildingIfInside } from './Mount.js';
import { interruptActiveAction } from './TaskCancellation.js';

/** Recovery progress per tick for a living-quarters tier (null = none available). */
export function injuryRecoveryRate(lqTier: 1 | 2 | 3 | null): number {
  return lqTier === null ? INJURY_ON_FOOT_RECOVERY_RATE : INJURY_RECOVERY_RATE_BY_LQ_TIER[lqTier];
}

/** Tier of the living_quarters the employee is inside, or null when elsewhere. */
function livingQuartersTierOf(state: GameState, emp: Employee): 1 | 2 | 3 | null {
  if (!isInsideBuilding(emp.locomotion)) return null;
  const buildingId = emp.locomotion.buildingId;
  const building = state.buildings.buildings.find(b => b.id === buildingId);
  return building?.type === 'living_quarters' ? building.tier : null;
}

/** Walk an idle injured employee on foot to the nearest free-bed living quarters, if any. */
function seekBed(state: GameState, emp: Employee): void {
  if (emp.itinerary !== null || isInsideBuilding(emp.locomotion) || isMounted(emp.locomotion)) return;
  const bed = findNearestBuildingOfType(state, 'living_quarters', emp.x, emp.z);
  if (!bed) return;
  moveTo(state, emp.id, { buildingId: bed.id }, { allowUnreachable: true });
}

/** Advance recovery for every injured employee, healing those that finish. */
export function tickInjuryRecovery(state: GameState, emitter?: EventEmitter): void {
  for (const emp of state.employees.employees) {
    if (!emp.alive || !emp.injured) continue;
    emp.injuryTicksRemaining = injuryTicksOf(emp);

    // An injured employee drops the work they held; rest stays (it is personal).
    if (emp.activeActionId !== null && emp.restTicksRemaining === null) {
      interruptActiveAction(state, emp, emp.activeActionId);
    }
    seekBed(state, emp);

    emp.injuryTicksRemaining -= injuryRecoveryRate(livingQuartersTierOf(state, emp));
    if (emp.injuryTicksRemaining <= 0) {
      healEmployee(state.employees, emp.id);
      leaveBuildingIfInside(state, emp, emitter);
    }
  }
}
