/**
 * Ore demand: how urgently the open ore_sale offers need ore the mine has not
 * yet stocked, and how much of that urgency a haul fragment can relieve (#1817).
 */
import { ORE_DEMAND_FULL_GRADE, ORE_DEMAND_MIN_GRADE } from '../config/balance.js';
import { isAutoDeliverable, remainingKg, storedStockKg, type Contract } from './Contract.js';

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
  // Active contracts draw stock first (auto-delivery), so their remaining kg is
  // committed; an open offer then needs its own quantity on top (smallest wins).
  const committed = new Map<string, number>();
  const smallestOffer = new Map<string, number>();
  for (const offer of available) {
    if (offer.type !== 'ore_sale' || offer.quantityKg <= 0) continue;
    const prev = smallestOffer.get(offer.materialId) ?? Infinity;
    if (offer.quantityKg < prev) smallestOffer.set(offer.materialId, offer.quantityKg);
  }
  for (const c of active) {
    if ((c.type === 'ore_sale' || c.type === 'supply') && isAutoDeliverable(c)) {
      const kg = remainingKg(c);
      if (kg > 0) committed.set(c.materialId, (committed.get(c.materialId) ?? 0) + kg);
    }
  }
  const need = new Map<string, number>();
  for (const id of new Set([...committed.keys(), ...smallestOffer.keys()])) {
    need.set(id, (committed.get(id) ?? 0) + (smallestOffer.get(id) ?? 0));
  }
  const urgency = new Map<string, number>();
  for (const [materialId, kg] of need) {
    const stock = storedStockKg({ type: 'ore_sale', materialId }, collectedOre, 0);
    if (stock < kg) urgency.set(materialId, 1 - stock / kg);
  }
  return urgency;
}

/** Grade weight in 0..1: 0 below ORE_DEMAND_MIN_GRADE, else density / ORE_DEMAND_FULL_GRADE capped at 1. */
function gradeWeight(density: number): number {
  if (density < ORE_DEMAND_MIN_GRADE || density <= 0) return 0;
  if (ORE_DEMAND_FULL_GRADE <= 0) return 1;
  return Math.min(1, density / ORE_DEMAND_FULL_GRADE);
}

/**
 * Highest grade-weighted urgency among the ores a fragment carries (#1828): urgency x grade weight,
 * so a rich fragment of the wanted ore outranks a trace one; 0 if none.
 */
export function fragmentHaulUrgency(
  oreDensities: Readonly<Record<string, number>>,
  urgency: ReadonlyMap<string, number>,
): number {
  let max = 0;
  for (const [ore, density] of Object.entries(oreDensities)) {
    max = Math.max(max, (urgency.get(ore) ?? 0) * gradeWeight(density));
  }
  return max;
}
