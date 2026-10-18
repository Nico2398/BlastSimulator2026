// BlastSimulator2026 — Player-honest actions shared by test playthroughs and scripts (#1922)
//
// The ordinary actions a player has with every control enabled: let time pass,
// resolve a pending event, accept and deliver contracts, clear the blast zone.
// Lives under scripts/ so both tests/helpers/playthrough.ts (which re-exports it)
// and the progression probe can import it; scripts must not import from tests.

import type { GameState } from '../../src/core/state/GameState.js';

/** A console command runner, as `createRunner().runner.run` or a recording wrapper of it. */
export type Run = (cmd: string) => { success: boolean; output: string };

/**
 * Resolve a pending event with its first option (`event choose 0`); a no-op when none is pending.
 * `tick` refuses to advance while an event is pending, so every headless tick loop answers it first.
 * The one home of that rule: playTick, the probe and command-mode `waitUntil` all go through it.
 */
export function resolvePendingEvent(run: Run, state: Pick<GameState, 'events'> | null | undefined): void {
  if (state?.events.pendingEvent) run('event choose 0');
}

/** One ordinary player tick: resolve a pending event, then let time pass. */
export function playTick(run: Run, state: GameState): void {
  resolvePendingEvent(run, state);
  run('tick 1');
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

/** Tiles a careful player clears around a charged pattern before firing. */
const BLAST_ZONE_CLEAR_MARGIN = 16;

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
