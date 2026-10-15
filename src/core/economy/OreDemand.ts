/**
 * Ore demand: how urgently the open ore_sale offers need ore the mine has not
 * yet stocked, and how much of that urgency a haul fragment can relieve (#1817).
 */
import type { Contract } from './Contract.js';

/**
 * Per-ore haul urgency in 0..1 (ore id -> urgency; absent means 0). An ore with
 * an open ore_sale offer is urgent in proportion to how far collected stock
 * falls short of the need.
 */
export function oreHaulUrgency(
  available: readonly Contract[],
  active: readonly Contract[],
  collectedOre: Readonly<Record<string, number>>,
): ReadonlyMap<string, number> {
  void available; void active; void collectedOre;
  return new Map(); // TODO: implement
}

/** Highest urgency among the ores a fragment carries (density > 0); 0 if none. */
export function fragmentHaulUrgency(
  oreDensities: Readonly<Record<string, number>>,
  urgency: ReadonlyMap<string, number>,
): number {
  void oreDensities; void urgency;
  return 0; // TODO: implement
}
