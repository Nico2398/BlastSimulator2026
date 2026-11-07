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
  // The refusal told when no floor can be ramped is the top floor's.
  let refusalKey: string | null = null;
  for (const floor of floors) {
    const why = { reasonKey: 'mining.crater_access.no_start' };
    const plan = planKeepingRoads(state, grid, floor, surface, [], why);
    if (plan === null) { refusalKey ??= why.reasonKey; continue; }
    return {
      ok: true, def: plan.def, cost: plan.cost, length: rampTotalLength(rampPathOf(plan.def).legs),
      orderCount: floor.orderCount, line: buildRampCommand(plan.def),
    };
  }
  return { ok: false, reasonKey: refusalKey ?? 'mining.crater_access.no_start' };
}
