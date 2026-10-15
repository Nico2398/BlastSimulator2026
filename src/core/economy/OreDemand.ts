/**
 * Ore demand: how urgently the open ore_sale offers need ore the mine has not
 * yet stocked, and how much of that urgency a haul fragment can relieve (#1817).
 */
import { remainingKg, storedStockKg, type Contract } from './Contract.js';

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
  // Smallest kg any open demand for each ore still asks of the warehouse.
  const need = new Map<string, number>();
  const want = (materialId: string, kg: number): void => {
    if (kg > 0 && kg < (need.get(materialId) ?? Infinity)) need.set(materialId, kg);
  };
  for (const offer of available) {
    if (offer.type === 'ore_sale') want(offer.materialId, offer.quantityKg);
  }
  for (const c of active) {
    if ((c.type === 'ore_sale' || c.type === 'supply') && c.held !== true && !c.completed && !c.expired) {
      want(c.materialId, remainingKg(c));
    }
  }
  const urgency = new Map<string, number>();
  for (const [materialId, kg] of need) {
    const stock = storedStockKg({ type: 'ore_sale', materialId }, collectedOre, 0);
    if (stock < kg) urgency.set(materialId, 1 - stock / kg);
  }
  return urgency;
}

/** Highest urgency among the ores a fragment carries (density > 0); 0 if none. */
export function fragmentHaulUrgency(
  oreDensities: Readonly<Record<string, number>>,
  urgency: ReadonlyMap<string, number>,
): number {
  let max = 0;
  for (const [ore, density] of Object.entries(oreDensities)) {
    if (density > 0) max = Math.max(max, urgency.get(ore) ?? 0);
  }
  return max;
}
