import { describe, it, expect } from 'vitest';
import {
  createBuildingState,
  placeBuilding,
  destroyBuilding,
  demolishBuilding,
  getTotalOperatingCost,
  getStorageCapacity,
  getBuildingScoreEffects,
  getBuildingDef,
} from '../../../src/core/entities/Building.js';

describe('Building system', () => {
  it('placing a building deducts cost and adds it to state', () => {
    const state = createBuildingState();
    const result = placeBuilding(state, 'living_quarters', 0, 0, 64, 64);

    expect(result.success).toBe(true);
    expect(result.cost).toBe(getBuildingDef('living_quarters').constructionCost);
    expect(state.buildings.length).toBe(1);
    expect(state.buildings[0]!.type).toBe('living_quarters');
    expect(state.buildings[0]!.tier).toBe(1);
  });

  it('building operating costs are deducted each tick', () => {
    const state = createBuildingState();
    placeBuilding(state, 'living_quarters', 0, 0, 64, 64);
    placeBuilding(state, 'management_office', 10, 10, 64, 64);

    const total = getTotalOperatingCost(state);
    const expectedCost =
      getBuildingDef('living_quarters').operatingCostPerTick +
      getBuildingDef('management_office').operatingCostPerTick;
    expect(total).toBe(expectedCost);
  });

  it('freight warehouse increases storage capacity', () => {
    const state = createBuildingState();
    expect(getStorageCapacity(state)).toBe(0);

    placeBuilding(state, 'freight_warehouse', 0, 0, 64, 64);
    expect(getStorageCapacity(state)).toBe(getBuildingDef('freight_warehouse').capacity);

    placeBuilding(state, 'freight_warehouse', 20, 0, 64, 64);
    expect(getStorageCapacity(state)).toBe(getBuildingDef('freight_warehouse').capacity * 2);
  });

  it('living quarters increase well-being score', () => {
    const state = createBuildingState();
    placeBuilding(state, 'living_quarters', 0, 0, 64, 64);

    const effects = getBuildingScoreEffects(state);
    expect(effects.wellBeing).toBeGreaterThan(0);
  });

  it('destroying a building removes it and its effects', () => {
    const state = createBuildingState();
    placeBuilding(state, 'living_quarters', 0, 0, 64, 64);
    const buildingId = state.buildings[0]!.id;

    expect(getBuildingScoreEffects(state).wellBeing).toBeGreaterThan(0);

    const destroyed = destroyBuilding(state, buildingId);
    expect(destroyed).toBe(true);
    expect(state.buildings.length).toBe(0);
    expect(getBuildingScoreEffects(state).wellBeing).toBe(0);
  });

  it('cannot place building on occupied space or outside bounds', () => {
    const state = createBuildingState();
    placeBuilding(state, 'living_quarters', 0, 0, 64, 64);

    // Overlapping position (living_quarters is 3×3)
    const overlap = placeBuilding(state, 'management_office', 1, 1, 64, 64);
    expect(overlap.success).toBe(false);
    expect(overlap.error).toBe('Space is occupied');

    // Out of bounds
    const oob = placeBuilding(state, 'freight_warehouse', 62, 62, 64, 64);
    expect(oob.success).toBe(false);
    expect(oob.error).toBe('Out of bounds');
  });
});

describe('demolishBuilding()', () => {
  it('removes the building and returns freed footprint cells', () => {
    const state = createBuildingState();
    placeBuilding(state, 'management_office', 5, 3, 64, 64);
    const buildingId = state.buildings[0]!.id;
    const def = getBuildingDef('management_office');

    const result = demolishBuilding(state, buildingId);

    expect(result.success).toBe(true);
    expect(state.buildings.length).toBe(0);
    expect(result.freedCells.length).toBe(def.footprint.length);
  });

  it('freed cells match absolute grid positions of the footprint', () => {
    const state = createBuildingState();
    placeBuilding(state, 'management_office', 5, 3, 64, 64);
    const buildingId = state.buildings[0]!.id;
    const def = getBuildingDef('management_office');

    const result = demolishBuilding(state, buildingId);

    const expected = def.footprint.map(([dx, dz]) => ({ x: 5 + dx, z: 3 + dz }));
    expect(result.freedCells).toEqual(expected);
  });

  it('footprint cells can be placed on after demolition', () => {
    const state = createBuildingState();
    placeBuilding(state, 'management_office', 0, 0, 64, 64);
    const buildingId = state.buildings[0]!.id;

    demolishBuilding(state, buildingId);

    // Previously occupied origin is now free
    const second = placeBuilding(state, 'management_office', 0, 0, 64, 64);
    expect(second.success).toBe(true);
  });

  it('returns failure for unknown building ID', () => {
    const state = createBuildingState();
    const result = demolishBuilding(state, 9999);

    expect(result.success).toBe(false);
    expect(result.freedCells).toHaveLength(0);
    expect(result.error).toContain('not found');
  });
});
