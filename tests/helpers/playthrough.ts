// BlastSimulator2026 — Player-honest playthrough driver (#1363)
//
// The ordinary actions a player has with every control enabled: let time pass,
// resolve a pending event, accept and deliver contracts. Shared by the tutorial
// and Level 1 full playthroughs so neither carries its own copy and both are
// held to the same honesty rule: no layoff, scrap, demolish or sell hack.

import type { GameState } from '../../src/core/state/GameState.js';

/** A console command runner, as `createRunner().runner.run` or a recording wrapper of it. */
export type Run = (cmd: string) => { success: boolean; output: string };

/** Commands a player-honest playthrough must never issue (budget-balancing hacks). */
export const FORBIDDEN_COMMAND = /^(employee fire|vehicle scrap|build destroy|vehicle sell)\b/;

/** One ordinary player tick: resolve a pending event, then let time pass. */
export function playTick(run: Run, state: GameState): void {
  if (state.events.pendingEvent) run('event choose 0');
  run('tick 1');
}

/** Advance ticks until `done()` reads true or `maxTicks` pass. */
export function tickUntil(run: Run, state: GameState, maxTicks: number, done: () => boolean): void {
  for (let i = 0; i < maxTicks && !done(); i++) playTick(run, state);
}

/**
 * Ordinary contract play, the same actions the Contracts panel offers:
 * deliver stock against accepted ore_sale/rubble_disposal contracts, and
 * accept an offer only when current stock covers it in full (an
 * unfulfilled contract costs a penalty). ore_sale is preferred.
 */
export function playContracts(run: Run, state: GameState): void {
  const stockOf = (materialId: string) => (
    materialId === '' ? state.logistics.storedMassKg : (state.collectedOre[materialId] ?? 0)
  );
  for (const active of [...state.contracts.active]) {
    if (active.type !== 'ore_sale' && active.type !== 'rubble_disposal') continue;
    const amount = Math.min(active.quantityKg - active.deliveredKg, stockOf(active.materialId));
    if (amount > 0) run(`contract deliver ${active.id} amount:${amount}`);
  }
  for (let guard = 0; guard < 8; guard++) {
    const covered = (c: typeof state.contracts.available[number]) => stockOf(c.materialId) >= c.quantityKg;
    const offer = state.contracts.available.find((c) => c.type === 'ore_sale' && covered(c))
      ?? state.contracts.available.find((c) => c.type === 'rubble_disposal' && covered(c));
    if (!offer) return;
    if (!run(`contract accept ${offer.id}`).success) return;
    const active = state.contracts.active.find((c) => c.id === offer.id);
    if (!active) return;
    const amount = Math.min(active.quantityKg, stockOf(active.materialId));
    if (amount > 0) run(`contract deliver ${active.id} amount:${amount}`);
  }
}
