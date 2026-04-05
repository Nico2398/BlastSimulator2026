// BlastSimulator2026 — Building types, catalog, and placement grid tests (CH1.1)

import { describe, it, expect } from 'vitest';
import {
  BUILDING_DEFS,
  BUSY,
  buildPlacementGrid,
  createBuildingState,
  getAllBuildingTypes,
  getBuildingDef,
  getSurfaceY,
  placeBuilding,
  type BuildingTier,
  type BuildingType,
  type RampVoxelType,
} from '../../../src/core/entities/Building.js';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

const ALL_BUILDING_TYPES: BuildingType[] = [
  'driving_center', 'blasting_academy', 'management_office', 'geology_lab',
  'research_center', 'living_quarters', 'explosive_warehouse', 'freight_warehouse',
  'vehicle_depot',
];

const ALL_TIERS: BuildingTier[] = [1, 2, 3];

const RAMP_DIRECTIONS: RampVoxelType[] = [
  'ramp_north', 'ramp_south', 'ramp_east', 'ramp_west',
];

function makeFilledGrid(sizeX: number, sizeY: number, sizeZ: number, fillUpToY: number): VoxelGrid {
  const grid = new VoxelGrid(sizeX, sizeY, sizeZ);
  for (let y = 0; y < fillUpToY; y++) {
    for (let z = 0; z < sizeZ; z++) {
      for (let x = 0; x < sizeX; x++) {
        grid.setVoxel(x, y, z, { rockId: 'sandite', density: 1, oreDensities: {}, fractureModifier: 1 });
      }
    }
  }
  return grid;
}

// ── BuildingType union ───────────────────────────────────────────────────────

describe('BuildingType union', () => {
  it('contains exactly 9 canonical types', () => {
    const types = getAllBuildingTypes();
    expect(types).toHaveLength(9);
  });

  it('contains all required canonical types', () => {
    const types = getAllBuildingTypes();
    for (const expected of ALL_BUILDING_TYPES) {
      expect(types).toContain(expected);
    }
  });

  it('does NOT contain any legacy types', () => {
    const types = getAllBuildingTypes();
    const legacyTypes = [
      'worker_quarters', 'storage_depot', 'office', 'break_room',
      'canteen', 'medical_bay', 'explosives_magazine', 'ramp',
    ];
    for (const legacy of legacyTypes) {
      expect(types).not.toContain(legacy);
    }
  });
});

// ── BuildingTier type ────────────────────────────────────────────────────────

describe('BuildingTier', () => {
  it('BUILDING_DEFS contains tiers 1, 2, and 3 for every type', () => {
    for (const type of ALL_BUILDING_TYPES) {
      for (const tier of ALL_TIERS) {
        expect(BUILDING_DEFS[type][tier]).toBeDefined();
      }
    }
  });

  it('tier 3 has higher capacity than tier 1 for every type', () => {
    for (const type of ALL_BUILDING_TYPES) {
      const t1 = BUILDING_DEFS[type][1];
      const t3 = BUILDING_DEFS[type][3];
      expect(t3.capacity).toBeGreaterThan(t1.capacity);
    }
  });

  it('tier 3 has higher constructionCost than tier 1', () => {
    for (const type of ALL_BUILDING_TYPES) {
      expect(BUILDING_DEFS[type][3].constructionCost).toBeGreaterThan(
        BUILDING_DEFS[type][1].constructionCost,
      );
    }
  });

  it('tier 3 has larger footprint than tier 1 for every type', () => {
    for (const type of ALL_BUILDING_TYPES) {
      const t1Cells = BUILDING_DEFS[type][1].footprint.length;
      const t3Cells = BUILDING_DEFS[type][3].footprint.length;
      expect(t3Cells).toBeGreaterThan(t1Cells);
    }
  });
});

// ── RampVoxelType ────────────────────────────────────────────────────────────

describe('RampVoxelType', () => {
  it('has exactly 4 directional values', () => {
    expect(RAMP_DIRECTIONS).toHaveLength(4);
  });

  it('includes north, south, east, west', () => {
    expect(RAMP_DIRECTIONS).toContain('ramp_north');
    expect(RAMP_DIRECTIONS).toContain('ramp_south');
    expect(RAMP_DIRECTIONS).toContain('ramp_east');
    expect(RAMP_DIRECTIONS).toContain('ramp_west');
  });
});

// ── BUILDING_DEFS catalog ────────────────────────────────────────────────────

describe('BUILDING_DEFS catalog', () => {
  it('every def has a non-empty nameKey', () => {
    for (const type of ALL_BUILDING_TYPES) {
      for (const tier of ALL_TIERS) {
        const def = BUILDING_DEFS[type][tier];
        expect(def.nameKey).toBeTruthy();
        expect(def.nameKey.length).toBeGreaterThan(0);
      }
    }
  });

  it('every nameKey matches expected i18n pattern building.<type>.t<tier>.name', () => {
    for (const type of ALL_BUILDING_TYPES) {
      for (const tier of ALL_TIERS) {
        const def = BUILDING_DEFS[type][tier];
        expect(def.nameKey).toBe(`building.${type}.t${tier}.name`);
      }
    }
  });

  it('every def has a non-empty footprint', () => {
    for (const type of ALL_BUILDING_TYPES) {
      for (const tier of ALL_TIERS) {
        const def = BUILDING_DEFS[type][tier];
        expect(def.footprint.length).toBeGreaterThan(0);
      }
    }
  });

  it('footprint cells are valid [dx, dz] non-negative integer pairs', () => {
    for (const type of ALL_BUILDING_TYPES) {
      for (const tier of ALL_TIERS) {
        for (const [dx, dz] of BUILDING_DEFS[type][tier].footprint) {
          expect(Number.isInteger(dx)).toBe(true);
          expect(Number.isInteger(dz)).toBe(true);
          expect(dx).toBeGreaterThanOrEqual(0);
          expect(dz).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('every def has valid entryPoint and exitPoint', () => {
    for (const type of ALL_BUILDING_TYPES) {
      for (const tier of ALL_TIERS) {
        const def = BUILDING_DEFS[type][tier];
        expect(def.entryPoint).toHaveLength(2);
        expect(def.exitPoint).toHaveLength(2);
        expect(def.entryPoint[0]).toBeGreaterThanOrEqual(0);
        expect(def.entryPoint[1]).toBeGreaterThanOrEqual(0);
        expect(def.exitPoint[0]).toBeGreaterThanOrEqual(0);
        expect(def.exitPoint[1]).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('every def has positive costs and HP', () => {
    for (const type of ALL_BUILDING_TYPES) {
      for (const tier of ALL_TIERS) {
        const def = BUILDING_DEFS[type][tier];
        expect(def.constructionCost).toBeGreaterThan(0);
        expect(def.demolishCost).toBeGreaterThan(0);
        expect(def.operatingCostPerTick).toBeGreaterThan(0);
        expect(def.maxHp).toBeGreaterThan(0);
        expect(def.structuralResistance).toBeGreaterThan(0);
      }
    }
  });

  it('every def has type and tier fields matching its catalog position', () => {
    for (const type of ALL_BUILDING_TYPES) {
      for (const tier of ALL_TIERS) {
        const def = BUILDING_DEFS[type][tier];
        expect(def.type).toBe(type);
        expect(def.tier).toBe(tier);
      }
    }
  });

  it('getBuildingDef returns tier 1 by default', () => {
    for (const type of ALL_BUILDING_TYPES) {
      const defaultDef = getBuildingDef(type);
      const tier1Def = getBuildingDef(type, 1);
      expect(defaultDef).toBe(tier1Def);
    }
  });

  it('getBuildingDef returns the correct tier when specified', () => {
    const t2 = getBuildingDef('living_quarters', 2);
    expect(t2.tier).toBe(2);
    expect(t2.type).toBe('living_quarters');
  });

  it('living_quarters has positive wellBeing scoreEffects at all tiers', () => {
    for (const tier of ALL_TIERS) {
      const def = getBuildingDef('living_quarters', tier);
      expect(def.scoreEffects.wellBeing).toBeGreaterThan(0);
    }
  });

  it('explosive_warehouse has negative safety scoreEffects at all tiers', () => {
    for (const tier of ALL_TIERS) {
      const def = getBuildingDef('explosive_warehouse', tier);
      expect(def.scoreEffects.safety).toBeLessThan(0);
    }
  });

  it('management_office has positive safety scoreEffects at all tiers', () => {
    for (const tier of ALL_TIERS) {
      const def = getBuildingDef('management_office', tier);
      expect(def.scoreEffects.safety).toBeGreaterThan(0);
    }
  });
});

// ── Placement grid — getSurfaceY ─────────────────────────────────────────────

describe('getSurfaceY', () => {
  it('returns 0 for a fully empty column', () => {
    const grid = new VoxelGrid(4, 8, 4);
    expect(getSurfaceY(grid, 0, 0)).toBe(0);
    expect(getSurfaceY(grid, 2, 3)).toBe(0);
  });

  it('returns 1 when only the bottom voxel is solid', () => {
    const grid = new VoxelGrid(4, 8, 4);
    grid.setVoxel(0, 0, 0, { rockId: 'sandite', density: 1, oreDensities: {}, fractureModifier: 1 });
    expect(getSurfaceY(grid, 0, 0)).toBe(1);
  });

  it('returns correct surface height when multiple layers are filled', () => {
    const grid = makeFilledGrid(4, 8, 4, 5);
    expect(getSurfaceY(grid, 0, 0)).toBe(5);
    expect(getSurfaceY(grid, 3, 3)).toBe(5);
  });

  it('ignores air voxels (density=0) above solid ones', () => {
    const grid = makeFilledGrid(4, 8, 4, 3);
    // Add a zero-density voxel above the solid surface — surface should still be 3
    grid.setVoxel(1, 3, 1, { rockId: '', density: 0, oreDensities: {}, fractureModifier: 1 });
    expect(getSurfaceY(grid, 1, 1)).toBe(3);
  });
});

// ── Placement grid — buildPlacementGrid ─────────────────────────────────────

describe('buildPlacementGrid', () => {
  it('has correct dimensions matching the VoxelGrid', () => {
    const vg = makeFilledGrid(6, 8, 5, 2);
    const state = createBuildingState();
    const pg = buildPlacementGrid(vg, state);
    expect(pg.length).toBe(5);            // sizeZ rows
    expect(pg[0]!.length).toBe(6);        // sizeX cols
  });

  it('worldX and worldZ match grid positions', () => {
    const vg = makeFilledGrid(4, 8, 4, 2);
    const state = createBuildingState();
    const pg = buildPlacementGrid(vg, state);
    expect(pg[0]![0]!.worldX).toBe(0);
    expect(pg[0]![0]!.worldZ).toBe(0);
    expect(pg[2]![3]!.worldX).toBe(3);
    expect(pg[2]![3]!.worldZ).toBe(2);
  });

  it('surfaceY reflects solid voxel height for each column', () => {
    const vg = makeFilledGrid(4, 8, 4, 3);
    const state = createBuildingState();
    const pg = buildPlacementGrid(vg, state);
    for (let z = 0; z < 4; z++) {
      for (let x = 0; x < 4; x++) {
        expect(pg[z]![x]!.surfaceY).toBe(3);
      }
    }
  });

  it('cells under a building footprint are marked BUSY', () => {
    const vg = makeFilledGrid(20, 8, 20, 2);
    const state = createBuildingState();
    // management_office T1: 2×2 footprint at (3, 4)
    placeBuilding(state, 'management_office', 3, 4, 20, 20);
    const pg = buildPlacementGrid(vg, state);

    // All 4 cells of the 2×2 footprint should be BUSY
    expect(pg[4]![3]!.surfaceY).toBe(BUSY);
    expect(pg[4]![4]!.surfaceY).toBe(BUSY);
    expect(pg[5]![3]!.surfaceY).toBe(BUSY);
    expect(pg[5]![4]!.surfaceY).toBe(BUSY);

    // Adjacent cells should NOT be BUSY
    expect(pg[3]![3]!.surfaceY).not.toBe(BUSY);
    expect(pg[4]![5]!.surfaceY).not.toBe(BUSY);
  });

  it('cells under multiple buildings are all marked BUSY', () => {
    const vg = makeFilledGrid(30, 8, 30, 2);
    const state = createBuildingState();
    placeBuilding(state, 'management_office', 0, 0, 30, 30);  // 2×2 at (0,0)
    placeBuilding(state, 'living_quarters', 5, 5, 30, 30);    // 3×3 at (5,5)
    const pg = buildPlacementGrid(vg, state);

    // management_office footprint
    expect(pg[0]![0]!.surfaceY).toBe(BUSY);
    expect(pg[1]![1]!.surfaceY).toBe(BUSY);

    // living_quarters footprint
    expect(pg[5]![5]!.surfaceY).toBe(BUSY);
    expect(pg[7]![7]!.surfaceY).toBe(BUSY);

    // Gap between them should not be BUSY
    expect(pg[3]![3]!.surfaceY).not.toBe(BUSY);
  });

  it('returns all-zero surfaceY for empty VoxelGrid', () => {
    const vg = new VoxelGrid(5, 8, 5);
    const state = createBuildingState();
    const pg = buildPlacementGrid(vg, state);
    for (let z = 0; z < 5; z++) {
      for (let x = 0; x < 5; x++) {
        expect(pg[z]![x]!.surfaceY).toBe(0);
      }
    }
  });

  it('grid with no buildings has no BUSY cells', () => {
    const vg = makeFilledGrid(8, 8, 8, 4);
    const state = createBuildingState();
    const pg = buildPlacementGrid(vg, state);
    for (let z = 0; z < 8; z++) {
      for (let x = 0; x < 8; x++) {
        expect(pg[z]![x]!.surfaceY).not.toBe(BUSY);
      }
    }
  });

  it('BUSY cells from large (freight_warehouse T1: 4×4) cover all footprint cells', () => {
    const vg = makeFilledGrid(30, 8, 30, 1);
    const state = createBuildingState();
    // freight_warehouse T1 is 4×4
    placeBuilding(state, 'freight_warehouse', 10, 10, 30, 30);
    const pg = buildPlacementGrid(vg, state);

    for (let dz = 0; dz < 4; dz++) {
      for (let dx = 0; dx < 4; dx++) {
        expect(pg[10 + dz]![10 + dx]!.surfaceY).toBe(BUSY);
      }
    }
    // Just outside the footprint
    expect(pg[10]![14]!.surfaceY).not.toBe(BUSY);
    expect(pg[14]![10]!.surfaceY).not.toBe(BUSY);
  });

  it('handles a 1×1 VoxelGrid without error', () => {
    const vg = new VoxelGrid(1, 4, 1);
    const state = createBuildingState();
    const pg = buildPlacementGrid(vg, state);
    expect(pg).toHaveLength(1);
    expect(pg[0]).toHaveLength(1);
    expect(pg[0]![0]!.surfaceY).toBe(0);
  });
});
