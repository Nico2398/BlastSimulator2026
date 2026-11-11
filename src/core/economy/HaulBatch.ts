import type { HaulCargoItem } from '../entities/Vehicle.js';
import { HAUL_BATCH_FINES_FRAGMENT_KG } from '../config/balance.js';
/** A fragment that could ride in a haul batch (#1370). */
export type HaulCandidate = HaulCargoItem;

/**
 * Picks the fragments one haul trip carries. The primary always rides; extras
 * join in the given order while cumulative mass stays within capacity and room
 * and the count within maxItems.
 */
export function selectHaulBatch(
  primary: HaulCandidate,
  ordered: readonly HaulCandidate[],
  capacityKg: number,
  roomKg: number,
  maxItems: number,
): HaulCandidate[] {
  const batch = [primary];
  // An over-capacity primary rides alone: its own mass already exhausts the limit.
  let massKg = primary.massKg;
  const limitKg = Math.min(capacityKg, roomKg);
  for (const candidate of ordered) {
    if (batch.length >= maxItems) break;
    if (massKg + candidate.massKg > limitKg) continue; // a later, smaller one may still fit
    batch.push(candidate);
    massKg += candidate.massKg;
  }
  return batch;
}

/**
 * Most fragments one haul trip carries for a truck of `capacityKg`: as many
 * fines-bound fragments as fill it (`HAUL_BATCH_FINES_FRAGMENT_KG`), at least one.
 * A bigger truck carries more pieces, and only an over-fragmented shot meets the limit.
 */
export function haulBatchMaxItems(capacityKg: number): number {
  return Math.max(1, Math.floor(capacityKg / HAUL_BATCH_FINES_FRAGMENT_KG));
}
