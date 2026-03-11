import { describe, it, expect } from 'vitest';
import {
  createBuildingState,
  placeBuilding,
  destroyBuilding,
  getTotalOperatingCost,
  getStorageCapacity,
  getBuildingScoreEffects,
  getBuildingDef,
} from '../../../src/core/entities/Building.js';

describe('Building system', () => {
  it('placing a building deducts cost and adds it to state', () => {
    const state = createBuildingState();
    const result = placeBuilding(state, 'worker_quarters', 0, 0, 64, 64);

    expect(result.success).toBe(true);
    expect(result.cost).toBe(getBuildingDef('worker_quarters').constructionCost);
    expect(state.buildings.length).toBe(1);
    expect(state.buildings[0]!.type).toBe('worker_quarters');
  });

  it('building operating costs are deducted each tick', () => {
    const state = createBuildingState();
    placeBuilding(state, 'worker_quarters', 0, 0, 64, 64);
    placeBuilding(state, 'office', 10, 10, 64, 64);

    const total = getTotalOperatingCost(state);
    const expectedCost =
      getBuildingDef('worker_quarters').operatingCostPerTick +
      getBuildingDef('office').operatingCostPerTick;
    expect(total).toBe(expectedCost);
  });

  it('storage depot increases storage capacity', () => {
    const state = createBuildingState();
    expect(getStorageCapacity(state)).toBe(0);

    placeBuilding(state, 'storage_depot', 0, 0, 64, 64);
    expect(getStorageCapacity(state)).toBe(getBuildingDef('storage_depot').capacity);

    placeBuilding(state, 'storage_depot', 10, 0, 64, 64);
    expect(getStorageCapacity(state)).toBe(getBuildingDef('storage_depot').capacity * 2);
  });

  it('worker quarters increase well-being score', () => {
    const state = createBuildingState();
    placeBuilding(state, 'worker_quarters', 0, 0, 64, 64);

    const effects = getBuildingScoreEffects(state);
    expect(effects.wellBeing).toBeGreaterThan(0);
  });

  it('destroying a building removes it and its effects', () => {
    const state = createBuildingState();
    placeBuilding(state, 'worker_quarters', 0, 0, 64, 64);
    const buildingId = state.buildings[0]!.id;

    expect(getBuildingScoreEffects(state).wellBeing).toBeGreaterThan(0);

    const destroyed = destroyBuilding(state, buildingId);
    expect(destroyed).toBe(true);
    expect(state.buildings.length).toBe(0);
    expect(getBuildingScoreEffects(state).wellBeing).toBe(0);
  });

  it('cannot place building on occupied space or outside bounds', () => {
    const state = createBuildingState();
    placeBuilding(state, 'worker_quarters', 0, 0, 64, 64);

    // Overlapping position
    const overlap = placeBuilding(state, 'office', 1, 1, 64, 64);
    expect(overlap.success).toBe(false);
    expect(overlap.error).toBe('Space is occupied');

    // Out of bounds
    const oob = placeBuilding(state, 'storage_depot', 62, 62, 64, 64);
    expect(oob.success).toBe(false);
    expect(oob.error).toBe('Out of bounds');
  });
});
