// BlastSimulator2026 — Player-honest actions shared by test playthroughs and scripts (#1922)
//
// The ordinary actions a player has with every control enabled: let time pass,
// resolve a pending event, accept and deliver contracts, clear the blast zone.
// Lives under scripts/ so both tests/helpers/playthrough.ts (which re-exports it)
// and the progression probe can import it; scripts must not import from tests.

import type { GameState } from '../../src/core/state/GameState.js';
import { stateRubbleStockKg } from '../../src/core/economy/SpoilHeaps.js';
import { pendingSpoilOverflowKg } from '../../src/core/economy/HaulDispatch.js';
import { isPaidClearance } from '../../src/core/economy/Contract.js';
import { getExplosivesFreeCapacity, getExplosivesInStock } from '../../src/core/entities/BuildingWarehouse.js';

/** A console command runner, as `createRunner().runner.run` or a recording wrapper of it. */
export type Run = (cmd: string) => { success: boolean; output: string };

/** How a probe answers a pending event: `first` is option 0, `cheapest` the option with the highest cashDelta (#2117). */
export type EventPolicy = 'first' | 'cheapest';

/** Index of the option with the highest `cashDelta` (missing = 0; lowest index on ties; 0 when empty). */
export function cheapestEventOption(consequences: ReadonlyArray<{ cashDelta?: number }>): number {
  void consequences;
  throw new Error('not implemented');
}

/**
 * Resolve a pending event with its first option (`event choose 0`); a no-op when none is pending.
 * `tick` refuses to advance while an event is pending, so every headless tick loop answers it first.
 * The one home of that rule: playTick, the probe and command-mode `waitUntil` all go through it.
 */
export function resolvePendingEvent(run: Run, state: Pick<GameState, 'events'> | null | undefined, policy: EventPolicy = 'first'): void {
  void policy;
  if (state?.events.pendingEvent) run('event choose 0');
}

/** One ordinary player tick: resolve a pending event, then let time pass. */
export function playTick(run: Run, state: GameState, policy: EventPolicy = 'first'): void {
  resolvePendingEvent(run, state, policy);
  run('tick 1');
}

/**
 * Ordinary contract play, the same actions the Contracts panel offers:
 * deliver stock against accepted ore_sale/rubble_disposal contracts, and
 * accept an offer only when current stock covers it in full (an
 * unfulfilled contract costs a penalty). ore_sale is preferred. With
 * `supply`, a covered supply offer is taken too (after ore_sale, before
 * rubble): a mine hauling faster than the ore_sale board buys sells the rest
 * there instead of filling its warehouse. Rubble is measured as the contract
 * draws it, barren rock in storage and on the spoil heaps (`stateRubbleStockKg`);
 * a clearance the mine pays for is taken only while barren hauls wait on full heaps.
 */
export function playContracts(run: Run, state: GameState, opts: { supply?: boolean } = {}): void {
  const stockOf = (materialId: string) => (
    materialId === '' ? stateRubbleStockKg(state) : (state.collectedOre[materialId] ?? 0)
  );
  for (const active of [...state.contracts.active]) {
    if (active.type !== 'ore_sale' && active.type !== 'rubble_disposal') continue;
    const amount = Math.min(active.quantityKg - active.deliveredKg, stockOf(active.materialId));
    if (amount > 0) run(`contract deliver ${active.id} amount:${amount}`);
  }
  for (let guard = 0; guard < 8; guard++) {
    const covered = (c: typeof state.contracts.available[number]) => stockOf(c.materialId) >= c.quantityKg;
    const offer = state.contracts.available.find((c) => c.type === 'ore_sale' && covered(c))
      ?? (opts.supply ? state.contracts.available.find((c) => c.type === 'supply' && covered(c)) : undefined)
      ?? state.contracts.available.find((c) => c.type === 'rubble_disposal' && covered(c)
        && (!isPaidClearance(c) || pendingSpoilOverflowKg(state) > 0));
    if (!offer) return;
    if (!run(`contract accept ${offer.id}`).success) return;
    const active = state.contracts.active.find((c) => c.id === offer.id);
    if (!active) return;
    const amount = Math.min(active.quantityKg, stockOf(active.materialId));
    if (amount > 0) run(`contract deliver ${active.id} amount:${amount}`);
  }
}

/** Tiles a careful player clears around a charged pattern before firing. */
export const BLAST_ZONE_CLEAR_MARGIN = 16;

/** Order everyone out of the blast radius and wait until the zone reads clear, as the Blast panel's evacuate control does. */
export function clearBlastZone(run: Run, state: GameState): void {
  const xs = state.drillHoles.map((h) => h.x);
  const zs = state.drillHoles.map((h) => h.z);
  if (xs.length === 0) return;
  const m = BLAST_ZONE_CLEAR_MARGIN;
  run(`zone clear x1:${Math.min(...xs) - m} y1:${Math.min(...zs) - m} x2:${Math.max(...xs) + m} y2:${Math.max(...zs) + m}`);
  const isClear = () => { const z = run('zone status').output; return z.includes('CLEAR') && !z.includes('NOT'); };
  for (let i = 0; i < 80 && !isClear(); i++) playTick(run, state);
}

/**
 * Stock `kg` of `explosiveId` in an explosive warehouse before ordering a pattern, as a competent player does:
 * a stock-covered order skips the cash-bought delivery wait (#1895), which would idle the crew on payroll.
 * Builds a warehouse on the first free cell when the site has none (the kits carry none) and waits for the
 * crew to raise it, then buys. Returns the buy command's result so a caller can assert it.
 */
export function stockWarehouse(run: Run, state: GameState, explosiveId: string, kg: number): { success: boolean; output: string } {
  if (!state.buildings.buildings.some((b) => b.type === 'explosive_warehouse')) {
    const grid = state.navGrid!;
    let ordered = false;
    for (let z = 1; z < grid.height - 6 && !ordered; z += 2) {
      for (let x = 1; x < grid.width - 6 && !ordered; x += 2) {
        ordered = run(`build explosive_warehouse at:${x},${z} tier:1`).success;
      }
    }
    for (let i = 0; i < 600 && state.plannedBuildings.length > 0; i++) playTick(run, state);
  }
  return run(`buy explosive:${explosiveId} kg:${kg}`);
}

/** Explosive store room (kg) for an order of `explosiveId`: its free space plus what it already holds of that explosive. */
export function explosiveRoomKg(state: GameState, explosiveId: string): number {
  return getExplosivesFreeCapacity(state.buildings) + getExplosivesInStock(state.buildings, explosiveId);
}

/**
 * Bring the store up to `kg` of `explosiveId`, buying only the shortfall: stock an abandoned pattern left behind charges
 * the next one, and buying the full charge again on top of it fills the store until no order fits (#2091).
 */
export function topUpWarehouse(run: Run, state: GameState, explosiveId: string, kg: number): { success: boolean; output: string } {
  const shortKg = Math.max(0, kg - Math.floor(getExplosivesInStock(state.buildings, explosiveId)));
  return shortKg > 0 ? stockWarehouse(run, state, explosiveId, shortKg) : { success: true, output: `${explosiveId} in stock` };
}
