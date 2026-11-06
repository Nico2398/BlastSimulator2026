// BlastSimulator2026 — Proposed access ramp into a crater that stranded rubble (#2144)
// The game proposes, the player decides and pays (#2095): nothing here orders, charges or digs.

import type { GameState } from '../state/GameState.js';
import type { VoxelGrid } from '../world/VoxelGrid.js';
import type { RampDef } from './Ramp.js';
import { rampPathOf, rampTotalLength } from './RampPath.js';
import { accessSurface, buildRampCommand, planKeepingRoads, strandedFloors } from './CraterAccessState.js';

export type AccessRampProposal =
  | { ok: true; def: RampDef; cost: number; length: number; orderCount: number; line: string }
  | { ok: false; reasonKey: string };

/** Reason shown when orders are stranded but no ramp can be planned into their crater. */
const ACCESS_NO_PLAN_KEY = 'mining.access_ramp.no_plan';

/** True while an access ramp (not a repair or a widening) still has segments to dig. */
function accessRampBeingDug(state: Pick<GameState, 'plannedRamps'>): boolean {
  return state.plannedRamps.some(p => p.repairOf === undefined && p.widenOf === undefined && p.segments.some(s => !s.done));
}

/**
 * The ramp into the stranded crater with the most out-of-reach orders, planned by `planCraterAccess`; null when no
 * debris order is out of reach, or an access ramp is already being dug. `line` is the `build_ramp` console order.
 */
export function proposeAccessRamp(state: GameState, grid: VoxelGrid): AccessRampProposal | null {
  const surface = accessSurface(state, grid);
  if (surface === null) return null;
  const floors = strandedFloors(state, grid, surface);
  if (floors.length === 0 || accessRampBeingDug(state)) return null;
  for (const floor of floors) {
    const plan = planKeepingRoads(state, grid, floor, surface, []);
    if (plan === null) continue;
    return {
      ok: true, def: plan.def, cost: plan.cost, length: rampTotalLength(rampPathOf(plan.def).legs),
      orderCount: floor.orderCount, line: buildRampCommand(plan.def),
    };
  }
  return { ok: false, reasonKey: ACCESS_NO_PLAN_KEY };
}
