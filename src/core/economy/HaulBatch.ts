import type { HaulCargoItem } from '../entities/Vehicle.js';
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
