// Expected balance constants (to be added to src/core/config/balance.ts):
//   LIVING_QUARTERS_WELLBEING_MULTIPLIERS = { absent: 0.85, t1: 0.90, t2: 1.00, t3: 1.10 }
//   LIVING_QUARTERS_OVERCAPACITY_PENALTY  = 0.10
//
// Living quarter bed capacities from BuildingDefs.ts:
//   Tier 1 ("The Cells")                      → 20 beds
//   Tier 2 ("Staff Dormitory")                 → 40 beds
//   Tier 3 ("Unnecessarily Luxurious Hotel")   → 80 beds

import { describe, it, expect } from 'vitest';
import {
  createBuildingState,
  placeBuilding,
  destroyBuilding,
  getBuildingDef,
  getLivingQuartersWellbeingMultiplier,
} from '../../../src/core/entities/Building.js';

// ─── BuildingDef sanity checks (already implemented — verify capacity values) ──

describe('Living quarters BuildingDef capacity values', () => {
  it('tier-1 living quarters has 20-bed capacity', () => {
    expect(getBuildingDef('living_quarters', 1).capacity).toBe(20);
  });

  it('tier-2 living quarters has 40-bed capacity', () => {
    expect(getBuildingDef('living_quarters', 2).capacity).toBe(40);
  });

  it('tier-3 living quarters has 80-bed capacity', () => {
    expect(getBuildingDef('living_quarters', 3).capacity).toBe(80);
  });
});

// ─── getLivingQuartersWellbeingMultiplier ─────────────────────────────────────

describe('getLivingQuartersWellbeingMultiplier', () => {

  // ── Absent penalty ──────────────────────────────────────────────────────────

  describe('absent penalty (no active living quarters)', () => {
    it('returns 0.85 when no buildings exist at all', () => {
      const state = createBuildingState();
      expect(getLivingQuartersWellbeingMultiplier(state, 0)).toBe(0.85);
    });

    it('returns 0.85 when no living quarters buildings are placed', () => {
      const state = createBuildingState();
      placeBuilding(state, 'management_office', 0, 0, 64, 64, 1);
      expect(getLivingQuartersWellbeingMultiplier(state, 10)).toBe(0.85);
    });

    it('returns 0.85 when the only living quarters building is inactive', () => {
      const state = createBuildingState();
      placeBuilding(state, 'living_quarters', 0, 0, 64, 64, 1);
      state.buildings[0]!.active = false;
      expect(getLivingQuartersWellbeingMultiplier(state, 10)).toBe(0.85);
    });

    it('returns 0.85 when all living quarters buildings have been destroyed', () => {
      const state = createBuildingState();
      placeBuilding(state, 'living_quarters', 0, 0, 64, 64, 1);
      const id = state.buildings[0]!.id;
      destroyBuilding(state, id);
      expect(getLivingQuartersWellbeingMultiplier(state, 10)).toBe(0.85);
    });
  });

  // ── Tier multipliers (within capacity) ─────────────────────────────────────

  describe('tier multipliers — no overcapacity', () => {
    it('returns 0.90 for a single active tier-1 building (10 of 20 beds used)', () => {
      const state = createBuildingState();
      placeBuilding(state, 'living_quarters', 0, 0, 64, 64, 1);
      expect(getLivingQuartersWellbeingMultiplier(state, 10)).toBe(0.90);
    });

    it('returns 1.00 for a single active tier-2 building (10 of 40 beds used)', () => {
      const state = createBuildingState();
      placeBuilding(state, 'living_quarters', 0, 0, 64, 64, 2);
      expect(getLivingQuartersWellbeingMultiplier(state, 10)).toBe(1.00);
    });

    it('returns 1.10 for a single active tier-3 building (10 of 80 beds used)', () => {
      const state = createBuildingState();
      placeBuilding(state, 'living_quarters', 0, 0, 64, 64, 3);
      expect(getLivingQuartersWellbeingMultiplier(state, 10)).toBe(1.10);
    });

    it('returns 0.90 for tier-1 at exactly 1 employee (minimum non-zero)', () => {
      const state = createBuildingState();
      placeBuilding(state, 'living_quarters', 0, 0, 64, 64, 1);
      expect(getLivingQuartersWellbeingMultiplier(state, 1)).toBe(0.90);
    });
  });

  // ── Best-tier selection ─────────────────────────────────────────────────────

  describe('best-tier selection when multiple buildings present', () => {
    it('uses tier-2 multiplier (1.00) when tier-1 and tier-2 are both active', () => {
      const state = createBuildingState();
      // tier-1 footprint 3×3 at (0,0); tier-2 footprint 4×3 at (10,0) — no overlap
      placeBuilding(state, 'living_quarters', 0,  0, 64, 64, 1);
      placeBuilding(state, 'living_quarters', 10, 0, 64, 64, 2);
      expect(getLivingQuartersWellbeingMultiplier(state, 5)).toBe(1.00);
    });

    it('uses tier-3 multiplier (1.10) when tier-1, tier-2, and tier-3 are all active', () => {
      const state = createBuildingState();
      placeBuilding(state, 'living_quarters', 0,  0, 64, 64, 1);
      placeBuilding(state, 'living_quarters', 10, 0, 64, 64, 2);
      placeBuilding(state, 'living_quarters', 20, 0, 64, 64, 3);
      expect(getLivingQuartersWellbeingMultiplier(state, 5)).toBe(1.10);
    });

    it('ignores inactive buildings when selecting best tier', () => {
      const state = createBuildingState();
      // tier-1 at (0,0) active; tier-3 at (10,0) inactive → effective best = tier 1
      placeBuilding(state, 'living_quarters', 0,  0, 64, 64, 1);
      placeBuilding(state, 'living_quarters', 10, 0, 64, 64, 3);
      state.buildings[1]!.active = false;
      expect(getLivingQuartersWellbeingMultiplier(state, 5)).toBe(0.90);
    });

    it('falls back to absent penalty when only inactive higher-tier buildings exist', () => {
      const state = createBuildingState();
      placeBuilding(state, 'living_quarters', 0, 0, 64, 64, 3);
      state.buildings[0]!.active = false;
      expect(getLivingQuartersWellbeingMultiplier(state, 5)).toBe(0.85);
    });
  });

  // ── Overcapacity penalty ────────────────────────────────────────────────────

  describe('overcapacity penalty (-0.10 applied when employeeCount > total beds)', () => {
    it('tier-1 overcapacity: 0.90 - 0.10 = 0.80 (21 employees, 20 beds)', () => {
      const state = createBuildingState();
      placeBuilding(state, 'living_quarters', 0, 0, 64, 64, 1);
      expect(getLivingQuartersWellbeingMultiplier(state, 21)).toBe(0.80);
    });

    it('tier-2 overcapacity: 1.00 - 0.10 = 0.90 (41 employees, 40 beds)', () => {
      const state = createBuildingState();
      placeBuilding(state, 'living_quarters', 0, 0, 64, 64, 2);
      expect(getLivingQuartersWellbeingMultiplier(state, 41)).toBe(0.90);
    });

    it('tier-3 overcapacity: 1.10 - 0.10 = 1.00 (81 employees, 80 beds)', () => {
      const state = createBuildingState();
      placeBuilding(state, 'living_quarters', 0, 0, 64, 64, 3);
      expect(getLivingQuartersWellbeingMultiplier(state, 81)).toBe(1.00);
    });

    it('exactly at capacity (employeeCount == beds) is NOT overcapacity — no penalty', () => {
      const state = createBuildingState();
      placeBuilding(state, 'living_quarters', 0, 0, 64, 64, 1);
      // 20 employees for 20 beds → not overcapacity → stays at 0.90
      expect(getLivingQuartersWellbeingMultiplier(state, 20)).toBe(0.90);
    });

    it('total bed count sums across all active buildings (two tier-1 = 40 beds)', () => {
      const state = createBuildingState();
      // Two tier-1 buildings: 20 + 20 = 40 beds
      placeBuilding(state, 'living_quarters', 0,  0, 64, 64, 1);
      placeBuilding(state, 'living_quarters', 10, 0, 64, 64, 1);
      // 40 employees exactly at capacity → no penalty → 0.90
      expect(getLivingQuartersWellbeingMultiplier(state, 40)).toBe(0.90);
      // 41 employees → overcapacity → 0.90 - 0.10 = 0.80
      expect(getLivingQuartersWellbeingMultiplier(state, 41)).toBe(0.80);
    });

    it('inactive buildings do not contribute beds to the total', () => {
      const state = createBuildingState();
      // Two tier-1 buildings, second one inactive → effective capacity = 20 beds
      placeBuilding(state, 'living_quarters', 0,  0, 64, 64, 1);
      placeBuilding(state, 'living_quarters', 10, 0, 64, 64, 1);
      state.buildings[1]!.active = false;
      // 21 employees > 20 active beds → overcapacity → 0.80
      expect(getLivingQuartersWellbeingMultiplier(state, 21)).toBe(0.80);
    });

    it('best-tier selection and overcapacity are applied together (tier-3 overcapacity = 1.00)', () => {
      const state = createBuildingState();
      // tier-1 at (0,0), tier-3 at (10,0): best = tier-3 → 1.10
      // total beds = 20 (t1) + 80 (t3) = 100
      // 101 employees → overcapacity → 1.10 - 0.10 = 1.00
      placeBuilding(state, 'living_quarters', 0,  0, 64, 64, 1);
      placeBuilding(state, 'living_quarters', 10, 0, 64, 64, 3);
      expect(getLivingQuartersWellbeingMultiplier(state, 101)).toBe(1.00);
    });
  });
});
