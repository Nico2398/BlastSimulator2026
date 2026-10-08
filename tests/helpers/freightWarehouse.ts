// BlastSimulator2026 — Freight warehouse test fixture (#1372)
//
// Places a finished freight warehouse directly (no construction order) and
// syncs logistics capacity, so integration fixtures can store ore or accept
// ore_sale contracts without driving a construction site to completion.

import type { GameContext } from '../../src/console/commands/world.js';
import { placeBuilding } from '../../src/core/entities/Building.js';
import { refreshLogisticsCapacity } from '../../src/core/engine/BuildingTaskHelpers.js';

/** Place a freight warehouse at (x, z) and return its building id. */
export function addFreightWarehouse(ctx: GameContext, x = 20, z = 20, tier: 1 | 2 | 3 = 1): number {
  const state = ctx.state!;
  const result = placeBuilding(state.buildings, 'freight_warehouse', x, z, 200, 200, tier);
  if (!result.success || !result.building) throw new Error(`fixture warehouse refused: ${result.error}`);
  refreshLogisticsCapacity(state);
  return result.building.id;
}

/** Id of the first active freight warehouse, placing one when there is none. */
export function ensureFreightWarehouse(ctx: GameContext): number {
  const existing = ctx.state!.buildings.buildings.find(b => b.type === 'freight_warehouse' && b.active);
  return existing ? existing.id : addFreightWarehouse(ctx);
}
