// BlastSimulator2026 — Tick-time EventContext construction (#1086)
//
// Core-owned relocation of src/console/commands/eventResolution.ts's
// buildEventContext, taking `state: GameState` directly instead of the
// console-only `GameContext` — it only ever read fields already on
// GameState.

import { isProgressionSite, type GameState } from '../state/GameState.js';
import type { EventContext } from '../events/EventPool.js';
import { getEventsByCategory } from '../events/EventPool.js';
import { getLivingEmployees } from '../entities/Employee.js';
import { unionMemberCount } from '../entities/UnionMembership.js';

/** Build the EventContext from the current GameState. */
export function buildTickEventContext(s: GameState): EventContext {
  // Built per call: the pool can change at runtime (tests register events).
  const lawsuitIds = new Set(getEventsByCategory('lawsuit').map(e => e.id));
  return {
    scores: s.scores,
    employeeCount: getLivingEmployees(s.employees.employees).length,
    unionMemberCount: unionMemberCount(s.employees.employees),
    deathCount: s.damage.deathCount,
    corruptionLevel: s.corruption.level,
    hasBuilding: (type: string) => s.buildings.buildings.some(b => b.type === type),
    hasDrillPlan: s.drillHoles.length > 0,
    tickCount: s.tickCount,
    lawsuitCount: s.events.firedEventIds.filter(id => lawsuitIds.has(id)).length,
    activeContractCount: s.contracts.active.length,
    weatherId: s.weather.current,
    hasBlasted: s.damage.blastCount > 0,
    protections: s.corruption.protections,
    unionGrievance: s.events.unionGrievance,
    hasProgression: isProgressionSite(s),
    applicationPending: s.grade?.pending != null,
    lastBlastChargeShare: s.grade?.lastBlastChargeShare ?? 0,
  };
}
