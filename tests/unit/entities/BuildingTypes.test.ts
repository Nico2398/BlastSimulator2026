// BlastSimulator2026 — Building types, catalog, and placement grid tests (CH1.1)

import { describe, it, expect } from 'vitest';
import {
  BUILDING_DEFS,
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
        grid.setVoxel(x, y, z, { composition: { rocks: [{ rockId: 'sandite', coefficient: 1.0 }] }, density: 1, oreDensities: {}, fractureModifier: 1 });
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
    grid.setVoxel(0, 0, 0, { composition: { rocks: [{ rockId: 'sandite', coefficient: 1.0 }] }, density: 1, oreDensities: {}, fractureModifier: 1 });
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
    grid.setVoxel(1, 3, 1, { composition: { rocks: [] }, density: 0, oreDensities: {}, fractureModifier: 1 });
    expect(getSurfaceY(grid, 1, 1)).toBe(3);
  });
});
