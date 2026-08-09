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
  isPlacementBlockedByResearch,
  queueResearchTask,
  tickResearch,
  isTierUnlocked,
  findNearestActiveBuildingOfType,
  getDemolishCost,
  getUpgradeCost,
  getMoveCost,
  moveBuilding,
  BUILDING_DEFS,
} from '../../../src/core/entities/Building.js';
import type { Building } from '../../../src/core/entities/Building.js';

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

// ── isPlacementBlockedByResearch (#410 — currently a no-op stub, always false) ──

describe('isPlacementBlockedByResearch', () => {
  it('never blocks tier 1, regardless of research state', () => {
    const state = createBuildingState();
    expect(isPlacementBlockedByResearch(state, 'living_quarters', 1)).toBe(false);
  });

  it('blocks tier 2 when the tier has not been researched', () => {
    const state = createBuildingState();
    expect(isPlacementBlockedByResearch(state, 'living_quarters', 2)).toBe(true);
  });

  it('blocks tier 3 when only tier 2 has been researched', () => {
    const state = createBuildingState();
    state.unlockedTiers['living_quarters'] = 2;
    expect(isPlacementBlockedByResearch(state, 'living_quarters', 3)).toBe(true);
  });

  it('does not block tier 2 once tier 2 has been researched', () => {
    const state = createBuildingState();
    state.unlockedTiers['living_quarters'] = 2;
    expect(isPlacementBlockedByResearch(state, 'living_quarters', 2)).toBe(false);
  });

  it('does not block tier 3 once tier 3 has been researched', () => {
    const state = createBuildingState();
    state.unlockedTiers['living_quarters'] = 3;
    expect(isPlacementBlockedByResearch(state, 'living_quarters', 3)).toBe(false);
  });

  it('a research unlock for one building type does not unblock another type', () => {
    const state = createBuildingState();
    state.unlockedTiers['geology_lab'] = 3;
    expect(isPlacementBlockedByResearch(state, 'driving_center', 2)).toBe(true);
  });
});

// ── placeBuilding — research gating (#410) ──────────────────────────────────

describe('placeBuilding — research gating', () => {
  it('places a tier-1 building with no research required', () => {
    const state = createBuildingState();
    const result = placeBuilding(state, 'living_quarters', 0, 0, 64, 64, 1);
    expect(result.success).toBe(true);
  });

  it('rejects placing a tier-2 building when the tier has not been researched', () => {
    const state = createBuildingState();
    const result = placeBuilding(state, 'living_quarters', 0, 0, 64, 64, 2);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/research/i);
    expect(state.buildings).toHaveLength(0);
  });

  it('rejects placing a tier-3 building when only tier 2 has been researched', () => {
    const state = createBuildingState();
    state.unlockedTiers['living_quarters'] = 2;
    const result = placeBuilding(state, 'living_quarters', 0, 0, 64, 64, 3);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/research/i);
  });

  it('allows placing a tier-2 building once tier 2 has been researched via the queue', () => {
    const state = createBuildingState();
    // A placed research_center is required before any research task can be queued.
    placeBuilding(state, 'research_center', 40, 40, 64, 64);

    const queueResult = queueResearchTask(state, 'living_quarters', 2);
    expect(queueResult.success, JSON.stringify(queueResult)).toBe(true);
    // Tier-2 (first upgrade) tasks are cost-only — 0 ticks, so a single tick completes them.
    tickResearch(state);
    expect(isTierUnlocked(state, 'living_quarters', 2)).toBe(true);

    const result = placeBuilding(state, 'living_quarters', 0, 0, 64, 64, 2);
    expect(result.success).toBe(true);
    // Two buildings now: the research_center placed above, plus this living_quarters.
    expect(state.buildings).toHaveLength(2);
  });

  it('still rejects tier 3 after only tier 2 has completed research', () => {
    const state = createBuildingState();
    placeBuilding(state, 'research_center', 40, 40, 64, 64);

    const queueResult = queueResearchTask(state, 'living_quarters', 2);
    expect(queueResult.success, JSON.stringify(queueResult)).toBe(true);
    tickResearch(state);

    const result = placeBuilding(state, 'living_quarters', 0, 0, 64, 64, 3);
    expect(result.success).toBe(false);
  });
});

// ── findNearestActiveBuildingOfType (issue #437 — arrival-gated actions) ────

describe('findNearestActiveBuildingOfType', () => {
  it('returns null when no building of that type exists at all', () => {
    const state = createBuildingState();
    placeBuilding(state, 'management_office', 0, 0, 64, 64);

    const result = findNearestActiveBuildingOfType(state, 'living_quarters', 5, 5);
    expect(result).toBeNull();
  });

  it('returns null when a building of that type exists but is inactive', () => {
    const state = createBuildingState();
    placeBuilding(state, 'living_quarters', 0, 0, 64, 64);
    state.buildings[0]!.active = false;

    const result = findNearestActiveBuildingOfType(state, 'living_quarters', 1, 1);
    expect(result).toBeNull();
  });

  it('returns the sole matching active building when only one exists', () => {
    const state = createBuildingState();
    placeBuilding(state, 'living_quarters', 10, 10, 64, 64);
    const building = state.buildings[0]!;

    const result = findNearestActiveBuildingOfType(state, 'living_quarters', 0, 0);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(building.id);
  });

  it('returns the nearest of several matching buildings by Euclidean distance from (x, z)', () => {
    const state = createBuildingState();
    placeBuilding(state, 'living_quarters', 0, 0, 64, 64);   // distance from (20,20) ≈ 28.28
    placeBuilding(state, 'living_quarters', 18, 18, 64, 64); // distance from (20,20) ≈ 2.83 — nearest
    placeBuilding(state, 'living_quarters', 40, 40, 64, 64); // distance from (20,20) ≈ 28.28

    const nearest = state.buildings[1]!;
    const result = findNearestActiveBuildingOfType(state, 'living_quarters', 20, 20);

    expect(result).not.toBeNull();
    expect(result!.id).toBe(nearest.id);
  });

  it('ignores buildings of a different type even when closer', () => {
    const state = createBuildingState();
    placeBuilding(state, 'management_office', 1, 1, 64, 64); // closest, wrong type
    placeBuilding(state, 'living_quarters', 30, 30, 64, 64); // only correct-type match

    const target = state.buildings[1]!;
    const result = findNearestActiveBuildingOfType(state, 'living_quarters', 0, 0);

    expect(result).not.toBeNull();
    expect(result!.id).toBe(target.id);
  });

  it('ignores inactive buildings even when they are the nearest of the correct type', () => {
    const state = createBuildingState();
    placeBuilding(state, 'living_quarters', 1, 1, 64, 64);
    state.buildings[0]!.active = false; // nearest, but inactive
    placeBuilding(state, 'living_quarters', 30, 30, 64, 64); // farther, but active

    const active = state.buildings[1]!;
    const result = findNearestActiveBuildingOfType(state, 'living_quarters', 0, 0);

    expect(result).not.toBeNull();
    expect(result!.id).toBe(active.id);
  });

  it('a building exactly at the query position has distance 0 and is returned', () => {
    const state = createBuildingState();
    placeBuilding(state, 'freight_warehouse', 5, 5, 64, 64);
    placeBuilding(state, 'freight_warehouse', 20, 20, 64, 64);

    const exact = state.buildings[0]!;
    const result = findNearestActiveBuildingOfType(state, 'freight_warehouse', 5, 5);

    expect(result).not.toBeNull();
    expect(result!.id).toBe(exact.id);
  });

  it('returns null against an empty building state', () => {
    const state = createBuildingState();
    const result = findNearestActiveBuildingOfType(state, 'freight_warehouse', 0, 0);
    expect(result).toBeNull();
  });
});

// ── getDemolishCost / getUpgradeCost / getMoveCost (#511 — direct coverage) ──

describe('getDemolishCost()', () => {
  it('equals the demolish cost of the building def for its type and tier', () => {
    const building: Building = { id: 1, type: 'management_office', tier: 1, x: 0, z: 0, hp: 100, active: true };
    expect(getDemolishCost(building)).toBe(getBuildingDef('management_office', 1).demolishCost);
  });

  it('uses the tier-specific demolish cost, not tier 1, for an upgraded building', () => {
    const building: Building = { id: 2, type: 'freight_warehouse', tier: 3, x: 0, z: 0, hp: 100, active: true };
    expect(getDemolishCost(building)).toBe(getBuildingDef('freight_warehouse', 3).demolishCost);
    expect(getDemolishCost(building)).not.toBe(getBuildingDef('freight_warehouse', 1).demolishCost);
  });
});

describe('getUpgradeCost()', () => {
  it('is the sum of the current tier demolish cost and the next tier construction cost', () => {
    const building: Building = { id: 1, type: 'living_quarters', tier: 1, x: 0, z: 0, hp: 100, active: true };
    const currentDemolish = getBuildingDef('living_quarters', 1).demolishCost;
    const nextConstruction = getBuildingDef('living_quarters', 2).constructionCost;

    expect(getUpgradeCost(building, 2)).toBe(currentDemolish + nextConstruction);
    // Not just the next tier's construction cost alone...
    expect(getUpgradeCost(building, 2)).not.toBe(nextConstruction);
    // ...and not just the current tier's demolish cost alone.
    expect(getUpgradeCost(building, 2)).not.toBe(currentDemolish);
  });

  it('computes the same demolish-plus-construction sum for a tier-2 to tier-3 upgrade', () => {
    const building: Building = { id: 2, type: 'vehicle_depot', tier: 2, x: 0, z: 0, hp: 100, active: true };
    const expected = getBuildingDef('vehicle_depot', 2).demolishCost + getBuildingDef('vehicle_depot', 3).constructionCost;

    expect(getUpgradeCost(building, 3)).toBe(expected);
  });
});

describe('getMoveCost()', () => {
  it('is 50% of the construction cost for the building type and tier', () => {
    const building: Building = { id: 1, type: 'geology_lab', tier: 1, x: 0, z: 0, hp: 100, active: true };
    expect(getMoveCost(building)).toBe(Math.round(getBuildingDef('geology_lab', 1).constructionCost * 0.5));
    expect(getMoveCost(building)).toBe(6000);
  });

  it('scales with tier via the tier-specific construction cost', () => {
    const building: Building = { id: 2, type: 'freight_warehouse', tier: 3, x: 0, z: 0, hp: 100, active: true };
    expect(getMoveCost(building)).toBe(Math.round(getBuildingDef('freight_warehouse', 3).constructionCost * 0.5));
    expect(getMoveCost(building)).toBe(36000);
  });

  it('rounds a fractional raw product instead of truncating or leaving it unrounded', () => {
    // Every real catalog constructionCost is a multiple of 500 (even), so halving
    // never lands on a fraction. Nudge one entry's cost odd for this case only,
    // to prove Math.round — not truncation, not a no-op — is what runs.
    const original = BUILDING_DEFS.management_office[1].constructionCost;
    const building: Building = { id: 3, type: 'management_office', tier: 1, x: 0, z: 0, hp: 100, active: true };
    try {
      BUILDING_DEFS.management_office[1].constructionCost = 8001; // raw product: 4000.5
      expect(getMoveCost(building)).toBe(4001); // Math.round(4000.5) === 4001, not 4000
    } finally {
      BUILDING_DEFS.management_office[1].constructionCost = original;
    }
  });
});

describe('moveBuilding() cost matches getMoveCost()', () => {
  it('deducts exactly getMoveCost(building) as the relocation cost', () => {
    const state = createBuildingState();
    placeBuilding(state, 'management_office', 0, 0, 64, 64);
    const building = state.buildings[0]!;
    const expectedCost = getMoveCost(building);

    const result = moveBuilding(state, building.id, 10, 10, 64, 64);

    expect(result.success).toBe(true);
    expect(result.cost).toBe(expectedCost);
  });
});
