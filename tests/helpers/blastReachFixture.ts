// Issue-#2021 layout: 3x3 hole grid (x 12/16/20, z 44/48/52, spacing 4) with buildings around it.
import { placeBuilding, type Building } from '../../src/core/entities/Building.js';
import { addHole } from '../../src/core/mining/DrillPlan.js';
import { createCharge } from '../../src/core/mining/ChargePlan.js';
import type { GameState } from '../../src/core/state/GameState.js';

/**
 * Empty the site's buildings, then drill and charge the 3x3 grid. Shatternite 15 kg in
 * 0.15 m holes reaches ~4.4 m (#2030), so the warehouse 4 m out is in range.
 */
export function addReachPattern(state: GameState, counter: { nextHoleId: number }): void {
  state.buildings.buildings = [];
  for (const x of [12, 16, 20]) {
    for (const z of [44, 48, 52]) {
      const hole = addHole(counter, state.drillHoles, x, z, 8, 0.15);
      const res = createCharge('shatternite', 15, 2, hole.depth, hole.diameter);
      if ('charge' in res) state.chargesByHole[hole.id] = res.charge;
    }
  }
}

function put(state: GameState, type: Building['type'], x: number, z: number): Building {
  const r = placeBuilding(state.buildings, type, x, z, 64, 64);
  if (!r.building) throw new Error(`fixture: cannot place ${type} at ${x},${z}: ${r.error}`);
  return r.building;
}

/** Office between holes, freight warehouse, stocked explosive warehouse (228 kg), far quarters. */
export function addReachBuildings(state: GameState): void {
  put(state, 'management_office', 14, 48);
  put(state, 'freight_warehouse', 14, 40);
  put(state, 'explosive_warehouse', 22, 48).storedExplosives = { krackle: 228 };
  put(state, 'living_quarters', 30, 48);
}
