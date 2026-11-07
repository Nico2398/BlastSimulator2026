// BlastSimulator2026 — Starting buildings hold no explosives; no slot, kit or level starts with stock (#2153)

import { describe, it, expect } from 'vitest';
import { placeStartingBuildings } from '../../../src/core/state/StartingBuildings.js';
import { createBuildingState } from '../../../src/core/entities/Building.js';
import { VoxelGrid, type VoxelData } from '../../../src/core/world/VoxelGrid.js';
import { SANDBOX_STARTING_SITES, type StartingBuildingSlot } from '../../../src/core/config/balance.js';
import { createGame } from '../../../src/core/state/GameState.js';

function solidVoxel(): VoxelData {
  return { composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] }, density: 1.0, oreDensities: {}, fractureModifier: 1.0 };
}

function makeFlatGrid(size: number, topY = 1): VoxelGrid {
  const grid = new VoxelGrid(size, size);
  for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) for (let y = 0; y <= topY; y++) grid.setVoxel(x, y, z, solidVoxel());
  return grid;
}

const hasStoredField = (b: object): boolean => 'storedExplosives' in b;

describe('placeStartingBuildings places no stock (#2153)', () => {
  it('an explosive warehouse slot places an empty building without a storedExplosives field', () => {
    const buildings = createBuildingState();
    const slot: StartingBuildingSlot = { type: 'explosive_warehouse', tier: 1 };
    expect(placeStartingBuildings(buildings, makeFlatGrid(40), [slot], { x: 20, z: 20 })).toBe(1);
    expect(buildings.buildings).toHaveLength(1);
    expect(hasStoredField(buildings.buildings[0]!)).toBe(false);
  });

  it('a legacy slot still naming stock gets none', () => {
    const buildings = createBuildingState();
    const legacy = { type: 'explosive_warehouse', tier: 1, stock: { krackle: 100 } } as unknown as StartingBuildingSlot;
    expect(placeStartingBuildings(buildings, makeFlatGrid(40), [legacy], { x: 20, z: 20 })).toBe(1);
    expect(hasStoredField(buildings.buildings[0]!)).toBe(false);
  });

  it('no building among several carries a storedExplosives field', () => {
    const buildings = createBuildingState();
    const slots: StartingBuildingSlot[] = [
      { type: 'explosive_warehouse', tier: 1 }, { type: 'freight_warehouse', tier: 1 },
    ];
    placeStartingBuildings(buildings, makeFlatGrid(40), slots, { x: 20, z: 20 });
    for (const b of buildings.buildings) expect(hasStoredField(b), b.type).toBe(false);
  });
});

describe('no starting composition names stock (#2153)', () => {
  it.each(['digger', 'full'] as const)('the %s sandbox kit has no slot with a stock', (kit) => {
    for (const slot of SANDBOX_STARTING_SITES[kit].buildings) {
      expect('stock' in slot, slot.type).toBe(false);
    }
  });

  it('a fresh game has no building holding explosives', () => {
    const state = createGame({ seed: 42 });
    for (const b of state.buildings.buildings) expect(hasStoredField(b), b.type).toBe(false);
  });
});
