// BlastSimulator2026 — Tutorial contract availability verification (Issue #328)
// Verifies that after the tutorial blast, contracts are available for acceptance.

import { describe, it, expect } from 'vitest';
import { generateTerrain } from '../../../src/core/world/TerrainGen.js';
import { getMinePreset } from '../../../src/core/world/MineType.js';
import { createGame } from '../../../src/core/state/GameState.js';
import { generateContracts } from '../../../src/core/economy/Contract.js';
import { Random } from '../../../src/core/math/Random.js';
import type { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import type { ContractType } from '../../../src/core/economy/Contract.js';

const VALID_CONTRACT_TYPES: readonly ContractType[] = ['ore_sale', 'rubble_disposal', 'supply'];

function makeTutorialTerrain(): VoxelGrid {
  const preset = getMinePreset('desert');
  if (!preset) throw new Error('desert preset not found');
  return generateTerrain({
    sizeX: 24,
    sizeY: 12,
    sizeZ: 24,
    seed: 42,
    preset,
  });
}

describe('Tutorial contract availability (Issue #328)', () => {
  it('tutorial terrain (seed 42, desert, 24×12×24) has ore-bearing columns near (10,10)', () => {
    const terrain = makeTutorialTerrain();

    // Count how many columns within a 5×5 grid centred on (10,10) contain
    // at least one voxel with a non-empty oreDensities map.
    let oreColumns = 0;
    for (let x = 8; x <= 12; x++) {
      for (let z = 8; z <= 12; z++) {
        for (let y = 0; y < terrain.sizeY; y++) {
          const voxel = terrain.getVoxel(x, y, z);
          if (voxel && Object.keys(voxel.oreDensities).length > 0) {
            oreColumns++;
            break; // one ore-bearing voxel is enough for this column
          }
        }
      }
    }

    expect(oreColumns).toBeGreaterThanOrEqual(1);
  });

  it('generateContracts creates available contracts for tutorial game state at tick 0', () => {
    // Arrange: create a fresh tutorial game state with seed 42, desert, 20000 cash
    const state = createGame({ seed: 42, mineType: 'desert', startingCash: 20000 });
    const rng = new Random(42 + 0); // seed + tickCount

    // Act: generate contracts as the campaign initialization would
    generateContracts(state.contracts, rng, 0);

    // Assert: available contracts exist
    expect(state.contracts.available.length).toBeGreaterThan(0);

    // Assert: each contract has valid fields
    for (const contract of state.contracts.available) {
      // quantityKg must be positive (quantity of material to deliver)
      expect(contract.quantityKg).toBeGreaterThan(0);
      // pricePerKg must be positive (payment per kg)
      expect(contract.pricePerKg).toBeGreaterThan(0);
      // type must be one of the valid contract types
      expect(VALID_CONTRACT_TYPES).toContain(contract.type);
      // id must be positive (assigned by generateContracts)
      expect(contract.id).toBeGreaterThan(0);
      // deliveredKg starts at 0 for fresh contracts
      expect(contract.deliveredKg).toBe(0);
      // acceptedAtTick starts at 0 (not yet accepted)
      expect(contract.acceptedAtTick).toBe(0);
      // completed and expired are false for fresh contracts
      expect(contract.completed).toBe(false);
      expect(contract.expired).toBe(false);
    }
  });

  it('contracts persist after ticking to tick 3 (simulating tutorial step 9)', () => {
    // Arrange: generate contracts at tick 0 (same setup as test 2)
    const state = createGame({ seed: 42, mineType: 'desert', startingCash: 20000 });
    const rng0 = new Random(42 + 0);
    generateContracts(state.contracts, rng0, 0);

    // Verify contracts were generated
    expect(state.contracts.available.length).toBeGreaterThan(0);
    const originalCount = state.contracts.available.length;
    expect(state.contracts.lastRefreshTick).toBe(0);

    // Act: simulate tick 3 — another call to generateContracts with tick 3
    const rng3 = new Random(42 + 3);
    generateContracts(state.contracts, rng3, 3);

    // Assert: contracts still available (no premature refresh)
    expect(state.contracts.available.length).toBeGreaterThan(0);
    // The refresh interval (REFRESH_INTERVAL = 20) has not elapsed,
    // so lastRefreshTick should remain 0
    expect(state.contracts.lastRefreshTick).toBe(0);
    // No contracts should have been added or removed
    expect(state.contracts.available.length).toBe(originalCount);
  });
});
