// BlastSimulator2026 — Gathering rate per material (#2243)
// `collectedOre` only holds the stock on hand, and deliveries and sales draw
// it down, so how fast a material is coming in cannot be read back from it.
// This log records what each haul actually credited at the depot — ore by
// ore id, barren rock under the rubble id — keeping only the last
// ORE_RATE_WINDOW_TICKS, and turns it into a rate the contract outlook
// projects forward.

import { ORE_RATE_WINDOW_TICKS, TICKS_PER_DAY } from '../config/balance.js';

/** Material id contracts use for generic rubble (`Contract.materialId`). */
export const RUBBLE_MATERIAL_ID = '';

/** Game-hours per tick (TICKS_PER_DAY ticks make a 24-hour day). */
const HOURS_PER_TICK = 24 / TICKS_PER_DAY;

/** Kg credited per material during one tick. */
export interface OreCollectionEntry {
  tick: number;
  kg: Record<string, number>;
}

/**
 * Add `kg` (per material, non-positive amounts ignored) to the entry for `tick`,
 * then drop entries older than the window so the log never outgrows a day.
 */
export function recordCollection(
  log: OreCollectionEntry[],
  tick: number,
  kg: Readonly<Record<string, number>>,
  windowTicks: number = ORE_RATE_WINDOW_TICKS,
): void {
  const credited = Object.entries(kg).filter(([, amount]) => amount > 0);
  if (credited.length > 0) {
    let entry = log[log.length - 1];
    if (!entry || entry.tick !== tick) {
      entry = { tick, kg: {} };
      log.push(entry);
    }
    for (const [id, amount] of credited) entry.kg[id] = (entry.kg[id] ?? 0) + amount;
  }
  const oldest = tick - windowTicks;
  let drop = 0;
  while (drop < log.length && log[drop]!.tick <= oldest) drop++;
  if (drop > 0) log.splice(0, drop);
}

/**
 * Kg per game-hour of each material credited over the window ending at `tick`.
 * The whole window is the divisor, so the first haul of a game reads as a
 * modest rate rather than one tick's burst extrapolated across the day.
 */
export function collectionRateKgPerHour(
  log: readonly OreCollectionEntry[] | undefined,
  tick: number,
  windowTicks: number = ORE_RATE_WINDOW_TICKS,
): Record<string, number> {
  const rates: Record<string, number> = {};
  if (!log || windowTicks <= 0) return rates;
  const oldest = tick - windowTicks;
  for (const entry of log) {
    if (entry.tick <= oldest || entry.tick > tick) continue;
    for (const [id, amount] of Object.entries(entry.kg)) rates[id] = (rates[id] ?? 0) + amount;
  }
  const hours = windowTicks * HOURS_PER_TICK;
  for (const id of Object.keys(rates)) rates[id] = rates[id]! / hours;
  return rates;
}

/** `recordCollection` on a game state's own log, created on first use (saves from before #2243 carry none). */
export function recordStateCollection(
  state: { tickCount: number; oreCollectionLog?: OreCollectionEntry[] },
  kg: Readonly<Record<string, number>>,
): void {
  state.oreCollectionLog ??= [];
  recordCollection(state.oreCollectionLog, state.tickCount, kg);
}
