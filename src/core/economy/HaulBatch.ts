/** A fragment that could ride in a haul batch (#1370). */
export interface HaulCandidate {
  fragmentId: number;
  massKg: number;
}

/**
 * Picks the fragments one haul trip carries. The primary always rides; extras
 * join in the given order while cumulative mass stays within capacity and room
 * and the count within maxItems.
 */
export function selectHaulBatch(
  primary: HaulCandidate,
  _ordered: readonly HaulCandidate[],
  _capacityKg: number,
  _roomKg: number,
  _maxItems: number,
): HaulCandidate[] {
  return [primary]; // TODO: implement
}
