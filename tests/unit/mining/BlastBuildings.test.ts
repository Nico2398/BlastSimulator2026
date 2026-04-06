// BlastSimulator2026 — Unit tests for blast-aware building interaction.
//
// Covers four feature areas:
//   1. checkProtectedPositions  — validates drill holes against building footprints (BlastPlan)
//   2. executeBlast destruction — buildings are removed from state when their footprint voxels are cleared
//   3. executeBlast secondaries — explosive_warehouse detonation chain events emitted on BlastResult
//   4. recordBuildingDestruction — score penalties applied when buildings are blast-destroyed

import { describe, it, expect, beforeEach } from 'vitest';

import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import {
  createBuildingState,
  placeBuilding,
} from '../../../src/core/entities/Building.js';

import type { DrillHole } from '../../../src/core/mining/DrillPlan.js';
import { addHole, resetHoleIds } from '../../../src/core/mining/DrillPlan.js';
import { batchCharge } from '../../../src/core/mining/ChargePlan.js';
import { autoVPattern } from '../../../src/core/mining/Sequence.js';
import {
  assembleBlastPlan,
  checkProtectedPositions,
} from '../../../src/core/mining/BlastPlan.js';
import type { ValidationError } from '../../../src/core/mining/BlastPlan.js';

import { executeBlast } from '../../../src/core/mining/BlastExecution.js';

import {
  createScoreState,
  recordBuildingDestruction,
} from '../../../src/core/scores/ScoreManager.js';

// ── Shared test helpers ────────────────────────────────────────────────────────

/**
 * Fill a rectangular region of the VoxelGrid with solid cruite rock.
 * cruite: hardnessTier 1, fractureThreshold 200 — softest rock; easy to blast.
 */
function fillRegion(
  grid: VoxelGrid,
  x0: number, x1: number,
  y0: number, y1: number,
  z0: number, z1: number,
): void {
  for (let z = z0; z <= z1; z++)
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++)
        grid.setVoxel(x, y, z, {
          rockId: 'cruite',
          density: 1.0,
          oreDensities: {},
          fractureModifier: 1.0,
        });
}

/**
 * Build a fully-charged, sequenced BlastPlan from a set of DrillHoles.
 * Uses dynatomics (1300 energy/kg × 5 kg = 6500 raw energy) — more than
 * enough to fracture cruite (fractureThreshold 200) anywhere in the blast zone.
 */
function makeBlastPlan(holes: DrillHole[]) {
  const holeIds = holes.map(h => h.id);
  const holeDepths: Record<string, number> = {};
  for (const h of holes) holeDepths[h.id] = h.depth;
  const { charges } = batchCharge(holeIds, holeDepths, 'dynatomics', 5, 1);
  const delays = autoVPattern(holes, 25);
  return assembleBlastPlan(holes, charges, delays);
}

/**
 * Standard test grid: 20 × 10 × 20 voxels.
 * Cruite rock fills y = 0–4 across the footprint region (x/z = 0–15),
 * so getColumnSurfaceY returns 5 at any in-region column.
 */
function makeTestGrid(): VoxelGrid {
  const grid = new VoxelGrid(20, 10, 20);
  fillRegion(grid, 0, 15, 0, 4, 0, 15);
  return grid;
}

// ── 1. checkProtectedPositions ─────────────────────────────────────────────────
//
// Validates that checkProtectedPositions(holes, buildingState) returns a
// ValidationError { holeId, issue } for every hole whose floored (x, z)
// falls within any building's footprint cells, and no error otherwise.

describe('checkProtectedPositions', () => {
  beforeEach(() => resetHoleIds());

  it('returns a ValidationError when a hole sits on a building footprint cell', () => {
    // explosive_warehouse tier-1 footprint: rect(2,2) → covers cells
    // (2,2), (3,2), (2,3), (3,3) when placed at origin (2, 2).
    const buildingState = createBuildingState();
    placeBuilding(buildingState, 'explosive_warehouse', 2, 2, 20, 20);

    const holes: DrillHole[] = [];
    addHole(holes, 2, 2, 5, 0.15); // exact match on footprint cell (2, 2)

    const errors: ValidationError[] = checkProtectedPositions(holes, buildingState);

    expect(errors).toHaveLength(1);
    expect(errors[0]!.holeId).toBe(holes[0]!.id);
    expect(errors[0]!.issue.toLowerCase()).toContain('protected');
  });

  it('returns no errors when no hole overlaps any building footprint cell', () => {
    // Building at (2, 2) with 2×2 footprint covers cells (2,2)–(3,3).
    const buildingState = createBuildingState();
    placeBuilding(buildingState, 'explosive_warehouse', 2, 2, 20, 20);

    const holes: DrillHole[] = [];
    addHole(holes, 8, 8, 5, 0.15); // well clear of the building

    const errors: ValidationError[] = checkProtectedPositions(holes, buildingState);

    expect(errors).toHaveLength(0);
  });

  it('only reports errors for the holes that overlap a building footprint', () => {
    // Building at (2, 2) with 2×2 footprint.
    const buildingState = createBuildingState();
    placeBuilding(buildingState, 'explosive_warehouse', 2, 2, 20, 20);

    const holes: DrillHole[] = [];
    const underBuilding = addHole(holes, 2, 2, 5, 0.15); // overlaps footprint cell (2, 2)
    addHole(holes, 10, 10, 5, 0.15);                      // no overlap

    const errors: ValidationError[] = checkProtectedPositions(holes, buildingState);

    expect(errors).toHaveLength(1);
    expect(errors[0]!.holeId).toBe(underBuilding.id);
    expect(errors[0]!.issue.toLowerCase()).toContain('protected');
  });

  it('floors non-integer hole coordinates before footprint lookup', () => {
    // Building at (2, 2) — footprint cell (2, 2).
    // Hole at (2.3, 2.7): floor(2.3)=2, floor(2.7)=2 → maps to cell (2, 2).
    const buildingState = createBuildingState();
    placeBuilding(buildingState, 'explosive_warehouse', 2, 2, 20, 20);

    const holes: DrillHole[] = [];
    addHole(holes, 2.3, 2.7, 5, 0.15);

    const errors: ValidationError[] = checkProtectedPositions(holes, buildingState);

    expect(errors).toHaveLength(1);
    expect(errors[0]!.issue.toLowerCase()).toContain('protected');
  });
});

// ── 2. executeBlast — building destruction ────────────────────────────────────
//
// When executeBlast is called with a 5th BuildingState argument, any building
// whose footprint contains a voxel (x, z) that was cleared is:
//   • removed from buildingState.buildings
//   • recorded in result.destroyedBuildings: { buildingId, type, x, z }[]
//
// The blast zone from a hole at (5, 5) with BLAST_ZONE_RADIUS=5 spans x=[0..10], z=[0..10].
// An explosive_warehouse placed at (5, 5) has a 2×2 footprint covering (5,5),(6,5),(5,6),(6,6)
// — all inside the blast zone.  A building placed at (15, 15) is outside the zone.

describe('executeBlast — building destruction', () => {
  beforeEach(() => resetHoleIds());

  it('removes a building from buildingState when its footprint voxels are cleared', () => {
    const grid = makeTestGrid();
    const buildingState = createBuildingState();
    const placed = placeBuilding(buildingState, 'explosive_warehouse', 5, 5, 20, 20);
    expect(placed.success).toBe(true);
    expect(buildingState.buildings).toHaveLength(1);

    const holes: DrillHole[] = [];
    addHole(holes, 5, 5, 5, 0.15); // directly above building origin
    const plan = makeBlastPlan(holes);

    // Pass buildingState as 5th argument so executeBlast can remove destroyed buildings.
    const result = (executeBlast as any)(plan, grid, [], 1.0, buildingState);

    expect(result).not.toBeNull();
    expect(buildingState.buildings).toHaveLength(0);
  });

  it('does not destroy a building whose footprint lies entirely outside the blast zone', () => {
    const grid = makeTestGrid();
    const buildingState = createBuildingState();
    // Grid is 20×20; building at (15,15) — blast zone from hole at (5,5) ends at x=10, z=10.
    const placed = placeBuilding(buildingState, 'explosive_warehouse', 15, 15, 20, 20);
    expect(placed.success).toBe(true);

    const holes: DrillHole[] = [];
    addHole(holes, 5, 5, 5, 0.15);
    const plan = makeBlastPlan(holes);

    const result = (executeBlast as any)(plan, grid, [], 1.0, buildingState);

    expect(result).not.toBeNull();
    // Building should remain untouched.
    expect(buildingState.buildings).toHaveLength(1);
    // destroyedBuildings must exist and be empty — not undefined.
    expect((result as any).destroyedBuildings).toBeDefined();
    expect((result as any).destroyedBuildings).toHaveLength(0);
  });

  it('populates result.destroyedBuildings with buildingId, type, x, and z', () => {
    const grid = makeTestGrid();
    const buildingState = createBuildingState();
    const placed = placeBuilding(buildingState, 'explosive_warehouse', 5, 5, 20, 20);
    const buildingId = placed.building!.id; // capture before blast removes it

    const holes: DrillHole[] = [];
    addHole(holes, 5, 5, 5, 0.15);
    const plan = makeBlastPlan(holes);

    const result = (executeBlast as any)(plan, grid, [], 1.0, buildingState);

    expect(result).not.toBeNull();
    const destroyed = (result as any).destroyedBuildings;
    expect(destroyed).toBeDefined();
    expect(destroyed).toHaveLength(1);
    expect(destroyed[0].buildingId).toBe(buildingId);
    expect(destroyed[0].type).toBe('explosive_warehouse');
    expect(destroyed[0].x).toBe(5);
    expect(destroyed[0].z).toBe(5);
  });
});

// ── 3. executeBlast — secondary blast events ──────────────────────────────────
//
// When an explosive_warehouse with storedExplosivesKg > 0 is destroyed by a blast,
// executeBlast emits a secondaryBlastEvent in result.secondaryBlastEvents:
//   { buildingId: number; x: number; z: number; explosivesKg: number }
//
// No event is emitted when:
//   • storedExplosivesKg is 0 or absent
//   • The destroyed building is not an explosive_warehouse

describe('executeBlast — secondary blast events', () => {
  beforeEach(() => resetHoleIds());

  it('emits a secondaryBlastEvent for an explosive_warehouse that has stored explosives', () => {
    const grid = makeTestGrid();
    const buildingState = createBuildingState();
    const placed = placeBuilding(buildingState, 'explosive_warehouse', 5, 5, 20, 20);
    const buildingId = placed.building!.id;

    // storedExplosivesKg triggers a secondary blast event when the building is destroyed.
    (buildingState.buildings[0] as any).storedExplosivesKg = 200;

    const holes: DrillHole[] = [];
    addHole(holes, 5, 5, 5, 0.15);
    const plan = makeBlastPlan(holes);

    const result = (executeBlast as any)(plan, grid, [], 1.0, buildingState);

    expect(result).not.toBeNull();
    const events = (result as any).secondaryBlastEvents;
    expect(events).toBeDefined();
    expect(events).toHaveLength(1);
    expect(events[0].buildingId).toBe(buildingId);
    expect(events[0].explosivesKg).toBe(200);
    expect(events[0].x).toBe(5);
    expect(events[0].z).toBe(5);
  });

  it('emits no secondaryBlastEvent when storedExplosivesKg is 0', () => {
    const grid = makeTestGrid();
    const buildingState = createBuildingState();
    placeBuilding(buildingState, 'explosive_warehouse', 5, 5, 20, 20);
    (buildingState.buildings[0] as any).storedExplosivesKg = 0;

    const holes: DrillHole[] = [];
    addHole(holes, 5, 5, 5, 0.15);
    const plan = makeBlastPlan(holes);

    const result = (executeBlast as any)(plan, grid, [], 1.0, buildingState);

    expect(result).not.toBeNull();
    const events = (result as any).secondaryBlastEvents;
    expect(events).toBeDefined();
    expect(events).toHaveLength(0);
  });

  it('emits no secondaryBlastEvent when storedExplosivesKg is absent (undefined)', () => {
    const grid = makeTestGrid();
    const buildingState = createBuildingState();
    // No storedExplosivesKg set at all — field will be undefined.
    placeBuilding(buildingState, 'explosive_warehouse', 5, 5, 20, 20);

    const holes: DrillHole[] = [];
    addHole(holes, 5, 5, 5, 0.15);
    const plan = makeBlastPlan(holes);

    const result = (executeBlast as any)(plan, grid, [], 1.0, buildingState);

    expect(result).not.toBeNull();
    const events = (result as any).secondaryBlastEvents;
    expect(events).toBeDefined();
    expect(events).toHaveLength(0);
  });

  it('emits no secondaryBlastEvent when a non-explosive building is destroyed', () => {
    const grid = makeTestGrid();
    const buildingState = createBuildingState();
    // management_office tier-1 has a 2×2 footprint — same geometry as explosive_warehouse,
    // but is not an explosive_warehouse and carries no stored explosives.
    placeBuilding(buildingState, 'management_office', 5, 5, 20, 20);

    const holes: DrillHole[] = [];
    addHole(holes, 5, 5, 5, 0.15);
    const plan = makeBlastPlan(holes);

    const result = (executeBlast as any)(plan, grid, [], 1.0, buildingState);

    expect(result).not.toBeNull();
    const events = (result as any).secondaryBlastEvents;
    expect(events).toBeDefined();
    expect(events).toHaveLength(0);
  });
});

// ── 4. recordBuildingDestruction — score penalties ────────────────────────────
//
// recordBuildingDestruction(state, isExplosiveWarehouse) applies score penalties
// immediately to state, clamped to [0, 100]:
//   Always:              safety  -15,  ecology -8
//   If isExplosive:      safety  -10 (extra),  wellBeing -5
//
// Net result from neutral (50):
//   non-explosive:  safety=35, ecology=42, wellBeing=50 (unchanged), nuisance=50
//   explosive:      safety=25, ecology=42, wellBeing=45, nuisance=50

describe('recordBuildingDestruction', () => {
  it('deducts safety by 15 and ecology by 8 for a non-explosive building', () => {
    const state = createScoreState(); // { safety:50, ecology:50, wellBeing:50, nuisance:50 }
    recordBuildingDestruction(state, false);

    expect(state.safety).toBe(35);    // 50 − 15
    expect(state.ecology).toBe(42);   // 50 − 8
    expect(state.wellBeing).toBe(50); // unchanged
    expect(state.nuisance).toBe(50);  // unchanged
  });

  it('deducts safety by 25, ecology by 8, and wellBeing by 5 for an explosive_warehouse', () => {
    const state = createScoreState();

    recordBuildingDestruction(state, true);

    expect(state.safety).toBe(25);    // 50 − (15 + 10)
    expect(state.ecology).toBe(42);   // 50 − 8
    expect(state.wellBeing).toBe(45); // 50 − 5
    expect(state.nuisance).toBe(50);  // unchanged
  });

  it('clamps safety to 0 when the penalty exceeds the current value', () => {
    const state = createScoreState();
    state.safety = 10; // manually lower so the -15 penalty overshoots

    recordBuildingDestruction(state, false); // −15 → −5 → clamp to 0

    expect(state.safety).toBe(0);
  });

  it('clamps ecology to 0 when the penalty exceeds the current value', () => {
    const state = createScoreState();
    state.ecology = 5; // only 5 points — −8 overshoots

    recordBuildingDestruction(state, false);

    expect(state.ecology).toBe(0);
  });

  it('clamps wellBeing to 0 when the explosive_warehouse penalty overshoots', () => {
    const state = createScoreState();
    state.wellBeing = 3; // only 3 points — −5 overshoots

    recordBuildingDestruction(state, true);

    expect(state.wellBeing).toBe(0);
  });
});
