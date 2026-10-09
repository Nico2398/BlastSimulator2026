// BlastSimulator2026 — Freight warehouse test fixture (#1372)
//
// Places a finished freight warehouse directly (no construction order) and
// syncs logistics capacity, so integration fixtures can store ore or accept
// ore_sale contracts without driving a construction site to completion.

import type { GameContext } from '../../src/console/commands/world.js';
import type { GameState } from '../../src/core/state/GameState.js';
import type { FragmentData } from '../../src/core/mining/BlastExecution.js';
import { placeBuilding } from '../../src/core/entities/Building.js';
import { freightWarehouseSites } from '../../src/core/entities/BuildingWarehouse.js';
import { FREIGHT_WAREHOUSE_CAPACITY_KG } from '../../src/core/config/balance.js';
import { refreshLogisticsCapacity } from '../../src/core/engine/BuildingTaskHelpers.js';

/** Place a freight warehouse on a game state at (x, z) and return its building id. */
export function addFreightWarehouseToState(state: GameState, x = 20, z = 20, tier: 1 | 2 | 3 = 1): number {
  const result = placeBuilding(state.buildings, 'freight_warehouse', x, z, 200, 200, tier);
  if (!result.success || !result.building) throw new Error(`fixture warehouse refused: ${result.error}`);
  refreshLogisticsCapacity(state);
  return result.building.id;
}

/** Place a freight warehouse at (x, z) and return its building id. */
export function addFreightWarehouse(ctx: GameContext, x = 20, z = 20, tier: 1 | 2 | 3 = 1): number {
  return addFreightWarehouseToState(ctx.state!, x, z, tier);
}

/** Id of the first active freight warehouse, placing one when there is none. */
export function ensureFreightWarehouse(ctx: GameContext): number {
  const existing = ctx.state!.buildings.buildings.find(b => b.type === 'freight_warehouse' && b.active);
  return existing ? existing.id : addFreightWarehouse(ctx);
}

/** Current freight warehouse sites of a state, as logistics sees them. */
export function sitesOf(state: GameState) {
  return freightWarehouseSites(state.buildings);
}

const MAX_FIXTURE_WAREHOUSES = 40;
let fillerSeq = 900_000;

/** Give a unit fixture at least `freeKg` of free freight room (warehouses only, no filler). */
export function setFreightRoom(state: GameState, freeKg: number): void {
  if (sitesOf(state).length === 0) placeFixtureWarehouses(state, freeKg);
  refreshLogisticsCapacity(state);
}

/**
 * Give a unit fixture exactly `freeKg` of free freight room: places the
 * tier-1 warehouses needed to hold it (capped at MAX_FIXTURE_WAREHOUSES) and parks a stored filler fragment for the
 * surplus. Reuses existing warehouses when the state already has some.
 */
export function setFreightRoomExact(state: GameState, freeKg: number): void {
  if (sitesOf(state).length === 0) placeFixtureWarehouses(state, freeKg);
  refreshLogisticsCapacity(state);
  const sites = sitesOf(state);
  let surplus = sites.reduce((a, s) => a + s.capacityKg, 0) - freeKg;
  for (const site of sites) {
    if (surplus <= 0) break;
    const mass = Math.min(surplus, site.capacityKg);
    state.logistics.fragments.push({
      fragment: fillerFragment(++fillerSeq, mass), state: 'stored', vehicleId: null, warehouseId: site.id,
    });
    state.logistics.storedMassKg += mass;
    surplus -= mass;
  }
}

/** Tier-1 warehouses only (higher tiers need research before placement), until capacity covers `kg`. */
function placeFixtureWarehouses(state: GameState, kg: number): void {
  for (let i = 0; i < MAX_FIXTURE_WAREHOUSES; i++) {
    addFreightWarehouseToState(state, 20 + 6 * (i % 20), 20 + 6 * Math.floor(i / 20), 1);
    if (sitesOf(state).reduce((a, s) => a + s.capacityKg, 0) >= kg) break;
  }
}

function fillerFragment(id: number, mass: number): FragmentData {
  return {
    id,
    position: { x: 0, y: 0, z: 0 },
    volume: mass / 2500,
    mass,
    rockId: 'sandite',
    oreDensities: {},
    initialVelocity: { x: 0, y: 0, z: 0 },
    isProjection: false,
    halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
    shapeSeed: 1,
    origin: { x: 0, y: 0, z: 0 },
  };
}

/**
 * Upgrade every placed (adding depots beside the first until `minTotalKg` fits) freight warehouse to tier 3 (FREIGHT_WAREHOUSE_CAPACITY_KG[3] each) in place and
 * resync capacity: a tier-1 warehouse cannot take one heavy boulder,
 * and a per-warehouse rule means pooled capacity alone does not help.
 * Skips the research gate on purpose; upgrades are not what these fixtures probe.
 */
export function upgradeFreightWarehousesToTier3(state: GameState, minTotalKg = 0): void {
  // Extra depots go in a row in a column beyond the first one (4x4 footprint, 5 apart).
  const first = state.buildings.buildings.find(b => b.type === 'freight_warehouse');
  for (let i = 1; first && sitesOf(state).length < MAX_FIXTURE_WAREHOUSES; i++) {
    if (sitesOf(state).reduce((a, s) => a + (s.capacityKg > FREIGHT_WAREHOUSE_CAPACITY_KG[1] ? s.capacityKg : FREIGHT_WAREHOUSE_CAPACITY_KG[3]), 0) >= minTotalKg) break;
    addFreightWarehouseToState(state, first.x, first.z + 5 * i, 1);
  }
  for (const b of state.buildings.buildings) {
    if (b.type === 'freight_warehouse') b.tier = 3;
  }
  refreshLogisticsCapacity(state);
}
