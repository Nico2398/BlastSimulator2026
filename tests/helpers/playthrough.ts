// BlastSimulator2026 — Player-honest playthrough driver (#1363)
//
// The ordinary actions a player has with every control enabled: let time pass,
// resolve a pending event, accept and deliver contracts. Shared by the tutorial
// and Level 1 full playthroughs so neither carries its own copy and both are
// held to the same honesty rule: no layoff, scrap, demolish or sell hack.

import type { GameState } from '../../src/core/state/GameState.js';
import { playTick, playContracts, clearBlastZone, stockWarehouse, type Run } from '../../scripts/shared/player-actions.js';

export { playTick, playContracts, clearBlastZone, stockWarehouse, type Run };

const DELIVERY_WAIT_FLOAT = 1_000_000;

/** Commands a player-honest playthrough must never issue (budget-balancing hacks). */
export const FORBIDDEN_COMMAND = /^(employee fire|vehicle scrap|build destroy|vehicle sell)\b/;

/**
 * Top cash up so payroll cannot bankrupt a test while the crew idles through the explosive
 * delivery wait (#1895); funding is not the subject of those tests.
 */
export function fundForDeliveryWait(state: Pick<GameState, 'cash'>): void {
  state.cash = Math.max(state.cash, DELIVERY_WAIT_FLOAT);
}

/** Advance ticks until `done()` reads true or `maxTicks` pass. */
export function tickUntil(run: Run, state: GameState, maxTicks: number, done: () => boolean): void {
  for (let i = 0; i < maxTicks && !done(); i++) playTick(run, state);
}

/** Every command verb a first-blast playthrough may use: what a player can do with controls enabled. */
export const PLAYER_BLAST_VERB = /^(campaign start|time resume|tick|drill_plan|charge|sequence|blast|zone clear|zone status|contract accept|contract deliver|event choose)\b/;

/**
 * Land every outstanding charge order's explosives now, as if the order had been stock-covered (#1895).
 * For tests whose subject is timing-sensitive downstream of the charge (weather, hauling, positions) and
 * must not shift by the cash-bought delivery wait.
 */
export function deliverExplosivesNow(state: GameState): void {
  for (const a of state.pendingActions) {
    if (a.type === 'charge_hole' && typeof a.payload['deliveryArrivalTick'] === 'number') {
      a.payload['deliveryArrivalTick'] = state.tickCount;
    }
  }
}
