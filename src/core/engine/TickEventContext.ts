// BlastSimulator2026 — Tick-time EventContext construction (#1086)
//
// Core-owned relocation of src/console/commands/eventResolution.ts's
// buildEventContext, taking `state: GameState` directly instead of the
// console-only `GameContext` — it only ever read fields already on
// GameState.

import type { GameState } from '../state/GameState.js';
import type { EventContext } from '../events/EventPool.js';
import { getLivingEmployees } from '../entities/Employee.js';

/** Build the EventContext from the current GameState. */
export function buildTickEventContext(s: GameState): EventContext {
  return {
    scores: s.scores,
    employeeCount: getLivingEmployees(s.employees.employees).length,
    deathCount: s.damage.deathCount,
    corruptionLevel: s.corruption.level,
    hasBuilding: (type: string) => s.buildings.buildings.some(b => b.type === type),
    hasDrillPlan: s.drillHoles.length > 0,
    tickCount: s.tickCount,
    lawsuitCount: s.corruption.attempts.filter(a => a.target === 'judge').length,
    activeContractCount: s.contracts.active.length,
    weatherId: 'clear', // TODO: wire actual weather when available
  };
}
