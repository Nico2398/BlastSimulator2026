// BlastSimulator2026 — Saves from before the Research Center was removed (#2283)
// Building tiers 2 and 3 now come from quests, so a save may still hold the removed building, its
// construction orders and a research queue. A load removes the building, cancels its orders and
// refunds everything paid; tiers research already unlocked stay unlocked (`unlockedTiers` is kept).
// Removal point: delete this module and its call in SaveLoad.ts once saves that predate #2283 are
// no longer supported (no such save format can carry a `research_center` building or `researchQueue`).

import type { GameState } from './GameState.js';
import { cancelAction } from '../engine/TaskCancellation.js';
import { releaseOccupantsOfRemovedBuildings } from '../engine/Mount.js';
import { addIncome } from '../economy/Finance.js';
import { RESEARCH_CENTER_REFUND_BY_TIER } from '../config/balance.js';

/** The type name the removed building carried in a save; no longer part of BuildingType. */
const LEGACY_TYPE = 'research_center';

/** Shape of the removed queue entries a save may still carry. */
interface LegacyResearchTask {
  cost?: unknown;
}

function refund(state: GameState, amount: number, reason: string): void {
  if (!Number.isFinite(amount) || amount <= 0) return;
  state.cash += amount;
  addIncome(state.finances, amount, 'refund', reason, state.tickCount);
}

function isLegacy(type: string): boolean {
  return type === LEGACY_TYPE;
}

/** Cancel the construction orders of a removed Research Center, refunding each in full. */
function cancelLegacySites(state: GameState): void {
  for (const site of [...state.plannedBuildings]) {
    if (!isLegacy(site.type)) continue;
    if (state.pendingActions.some(a => a.id === site.actionId)) {
      cancelAction(state, site.actionId);
    } else {
      refund(state, site.cost, 'Research Center order cancelled (save migration)');
    }
    const idx = state.plannedBuildings.findIndex(pb => pb.id === site.id);
    if (idx !== -1) state.plannedBuildings.splice(idx, 1);
  }
}

/** Remove standing Research Centers and refund their construction cost by tier. */
function removeLegacyBuildings(state: GameState): void {
  const standing = state.buildings.buildings.filter(b => isLegacy(b.type));
  if (standing.length === 0) return;
  for (const b of standing) {
    refund(state, RESEARCH_CENTER_REFUND_BY_TIER[b.tier] ?? 0, `Research Center #${b.id} removed (save migration)`);
  }
  state.buildings.buildings = state.buildings.buildings.filter(b => !isLegacy(b.type));
  releaseOccupantsOfRemovedBuildings(state);
}

/** Drop the research queue, refunding each task's cost. */
function dropLegacyQueue(state: GameState): void {
  const holder = state.buildings as unknown as { researchQueue?: unknown; unlockedTiers: Record<string, unknown> };
  const queue = Array.isArray(holder.researchQueue) ? (holder.researchQueue as LegacyResearchTask[]) : [];
  for (const task of queue) refund(state, typeof task.cost === 'number' ? task.cost : 0, 'Research cancelled (save migration)');
  delete holder.researchQueue;
  delete holder.unlockedTiers[LEGACY_TYPE];
}

/** Remove every trace of the Research Center from a loaded save. Idempotent. */
export function removeLegacyResearchCenters(state: GameState): void {
  cancelLegacySites(state);
  removeLegacyBuildings(state);
  dropLegacyQueue(state);
}
