// BlastSimulator2026 — Building catalog data
// 9 canonical building types × 3 tiers. Data file — line-limit exempt.

import type { BuildingDef, BuildingTier, BuildingType } from './Building.js';

// ── Footprint helpers ──

/** Generate a rectangular footprint of dx/dz cell offsets. */
function rect(sizeX: number, sizeZ: number): ReadonlyArray<readonly [number, number]> {
  const cells: Array<readonly [number, number]> = [];
  for (let dz = 0; dz < sizeZ; dz++) {
    for (let dx = 0; dx < sizeX; dx++) {
      cells.push([dx, dz]);
    }
  }
  return cells;
}

/** Centre-bottom entry/exit helper: entry on front-left, exit front-right. */
function entry(): readonly [number, number] { return [0, 0] as const; }
function exit_(sizeX: number): readonly [number, number] { return [sizeX - 1, 0] as const; }

// ── Catalog ──

export type BuildingDefCatalog = {
  [K in BuildingType]: { [T in BuildingTier]: BuildingDef };
};

export const BUILDING_DEFS: BuildingDefCatalog = {

  // ── Driving Center ──────────────────────────────────────────────────────────
  driving_center: {
    1: {
      type: 'driving_center', tier: 1,
      nameKey: 'building.driving_center.t1.name',
      footprint: rect(2, 2), entryPoint: entry(), exitPoint: exit_(2),
      constructionCost: 12000, demolishCost: 3000, operatingCostPerTick: 8,
      capacity: 4, maxHp: 100, structuralResistance: 3000,
      scoreEffects: {},
    },
    2: {
      type: 'driving_center', tier: 2,
      nameKey: 'building.driving_center.t2.name',
      footprint: rect(3, 2), entryPoint: entry(), exitPoint: exit_(3),
      constructionCost: 30000, demolishCost: 7000, operatingCostPerTick: 14,
      capacity: 8, maxHp: 160, structuralResistance: 5000,
      scoreEffects: {},
    },
    3: {
      type: 'driving_center', tier: 3,
      nameKey: 'building.driving_center.t3.name',
      footprint: rect(4, 3), entryPoint: entry(), exitPoint: exit_(4),
      constructionCost: 60000, demolishCost: 14000, operatingCostPerTick: 22,
      capacity: 16, maxHp: 240, structuralResistance: 8000,
      scoreEffects: {},
    },
  },

  // ── Blasting Academy ────────────────────────────────────────────────────────
  blasting_academy: {
    1: {
      type: 'blasting_academy', tier: 1,
      nameKey: 'building.blasting_academy.t1.name',
      footprint: rect(2, 2), entryPoint: entry(), exitPoint: exit_(2),
      constructionCost: 15000, demolishCost: 4000, operatingCostPerTick: 10,
      capacity: 4, maxHp: 100, structuralResistance: 3000,
      scoreEffects: {},
    },
    2: {
      type: 'blasting_academy', tier: 2,
      nameKey: 'building.blasting_academy.t2.name',
      footprint: rect(3, 2), entryPoint: entry(), exitPoint: exit_(3),
      constructionCost: 36000, demolishCost: 9000, operatingCostPerTick: 18,
      capacity: 8, maxHp: 160, structuralResistance: 5000,
      scoreEffects: {},
    },
    3: {
      type: 'blasting_academy', tier: 3,
      nameKey: 'building.blasting_academy.t3.name',
      footprint: rect(3, 3), entryPoint: entry(), exitPoint: exit_(3),
      constructionCost: 72000, demolishCost: 18000, operatingCostPerTick: 28,
      capacity: 16, maxHp: 240, structuralResistance: 8000,
      scoreEffects: {},
    },
  },

  // ── Management Office ───────────────────────────────────────────────────────
  management_office: {
    1: {
      type: 'management_office', tier: 1,
      nameKey: 'building.management_office.t1.name',
      footprint: rect(2, 2), entryPoint: entry(), exitPoint: exit_(2),
      constructionCost: 8000, demolishCost: 2000, operatingCostPerTick: 6,
      capacity: 5, maxHp: 80, structuralResistance: 2500,
      scoreEffects: { safety: 2 },
    },
    2: {
      type: 'management_office', tier: 2,
      nameKey: 'building.management_office.t2.name',
      footprint: rect(2, 3), entryPoint: entry(), exitPoint: exit_(2),
      constructionCost: 20000, demolishCost: 5000, operatingCostPerTick: 10,
      capacity: 10, maxHp: 120, structuralResistance: 4000,
      scoreEffects: { safety: 3 },
    },
    3: {
      type: 'management_office', tier: 3,
      nameKey: 'building.management_office.t3.name',
      footprint: rect(3, 3), entryPoint: entry(), exitPoint: exit_(3),
      constructionCost: 40000, demolishCost: 10000, operatingCostPerTick: 16,
      capacity: 20, maxHp: 180, structuralResistance: 6000,
      scoreEffects: { safety: 4, wellBeing: 1 },
    },
  },

  // ── Geology Lab ─────────────────────────────────────────────────────────────
  geology_lab: {
    1: {
      type: 'geology_lab', tier: 1,
      nameKey: 'building.geology_lab.t1.name',
      footprint: rect(2, 2), entryPoint: entry(), exitPoint: exit_(2),
      constructionCost: 12000, demolishCost: 3000, operatingCostPerTick: 8,
      capacity: 4, maxHp: 80, structuralResistance: 2500,
      scoreEffects: {},
    },
    2: {
      type: 'geology_lab', tier: 2,
      nameKey: 'building.geology_lab.t2.name',
      footprint: rect(3, 2), entryPoint: entry(), exitPoint: exit_(3),
      constructionCost: 28000, demolishCost: 7000, operatingCostPerTick: 14,
      capacity: 8, maxHp: 120, structuralResistance: 4000,
      scoreEffects: {},
    },
    3: {
      type: 'geology_lab', tier: 3,
      nameKey: 'building.geology_lab.t3.name',
      footprint: rect(3, 3), entryPoint: entry(), exitPoint: exit_(3),
      constructionCost: 55000, demolishCost: 13000, operatingCostPerTick: 22,
      capacity: 16, maxHp: 180, structuralResistance: 6000,
      scoreEffects: {},
    },
  },

  // ── Research Center ─────────────────────────────────────────────────────────
  research_center: {
    1: {
      type: 'research_center', tier: 1,
      nameKey: 'building.research_center.t1.name',
      footprint: rect(2, 3), entryPoint: entry(), exitPoint: exit_(2),
      constructionCost: 25000, demolishCost: 6000, operatingCostPerTick: 15,
      capacity: 5, maxHp: 100, structuralResistance: 3000,
      scoreEffects: {},
    },
    2: {
      type: 'research_center', tier: 2,
      nameKey: 'building.research_center.t2.name',
      footprint: rect(3, 3), entryPoint: entry(), exitPoint: exit_(3),
      constructionCost: 60000, demolishCost: 14000, operatingCostPerTick: 25,
      capacity: 10, maxHp: 160, structuralResistance: 5000,
      scoreEffects: {},
    },
    3: {
      type: 'research_center', tier: 3,
      nameKey: 'building.research_center.t3.name',
      footprint: rect(4, 4), entryPoint: entry(), exitPoint: exit_(4),
      constructionCost: 120000, demolishCost: 28000, operatingCostPerTick: 40,
      capacity: 20, maxHp: 240, structuralResistance: 8000,
      scoreEffects: {},
    },
  },

  // ── Living Quarters ─────────────────────────────────────────────────────────
  living_quarters: {
    1: {
      type: 'living_quarters', tier: 1,
      nameKey: 'building.living_quarters.t1.name',
      footprint: rect(3, 3), entryPoint: entry(), exitPoint: exit_(3),
      constructionCost: 10000, demolishCost: 2500, operatingCostPerTick: 6,
      capacity: 20, maxHp: 120, structuralResistance: 3500,
      scoreEffects: { wellBeing: 2 },
    },
    2: {
      type: 'living_quarters', tier: 2,
      nameKey: 'building.living_quarters.t2.name',
      footprint: rect(4, 3), entryPoint: entry(), exitPoint: exit_(4),
      constructionCost: 25000, demolishCost: 6000, operatingCostPerTick: 10,
      capacity: 40, maxHp: 180, structuralResistance: 5000,
      scoreEffects: { wellBeing: 4 },
    },
    3: {
      type: 'living_quarters', tier: 3,
      nameKey: 'building.living_quarters.t3.name',
      footprint: rect(5, 4), entryPoint: entry(), exitPoint: exit_(5),
      constructionCost: 50000, demolishCost: 12000, operatingCostPerTick: 16,
      capacity: 80, maxHp: 250, structuralResistance: 7000,
      scoreEffects: { wellBeing: 6 },
    },
  },

  // ── Explosive Warehouse ─────────────────────────────────────────────────────
  explosive_warehouse: {
    1: {
      type: 'explosive_warehouse', tier: 1,
      nameKey: 'building.explosive_warehouse.t1.name',
      footprint: rect(2, 2), entryPoint: entry(), exitPoint: exit_(2),
      constructionCost: 20000, demolishCost: 5000, operatingCostPerTick: 12,
      capacity: 500, maxHp: 200, structuralResistance: 5000,
      scoreEffects: { safety: -1 },
    },
    2: {
      type: 'explosive_warehouse', tier: 2,
      nameKey: 'building.explosive_warehouse.t2.name',
      footprint: rect(3, 2), entryPoint: entry(), exitPoint: exit_(3),
      constructionCost: 48000, demolishCost: 11000, operatingCostPerTick: 20,
      capacity: 1500, maxHp: 300, structuralResistance: 7000,
      scoreEffects: { safety: -1 },
    },
    3: {
      type: 'explosive_warehouse', tier: 3,
      nameKey: 'building.explosive_warehouse.t3.name',
      footprint: rect(4, 3), entryPoint: entry(), exitPoint: exit_(4),
      constructionCost: 95000, demolishCost: 22000, operatingCostPerTick: 30,
      capacity: 4000, maxHp: 400, structuralResistance: 10000,
      scoreEffects: { safety: -2 },
    },
  },

  // ── Freight Warehouse ───────────────────────────────────────────────────────
  freight_warehouse: {
    1: {
      type: 'freight_warehouse', tier: 1,
      nameKey: 'building.freight_warehouse.t1.name',
      footprint: rect(4, 4), entryPoint: entry(), exitPoint: exit_(4),
      constructionCost: 15000, demolishCost: 4000, operatingCostPerTick: 10,
      capacity: 2000, maxHp: 150, structuralResistance: 4000,
      scoreEffects: {},
    },
    2: {
      type: 'freight_warehouse', tier: 2,
      nameKey: 'building.freight_warehouse.t2.name',
      footprint: rect(5, 4), entryPoint: entry(), exitPoint: exit_(5),
      constructionCost: 36000, demolishCost: 9000, operatingCostPerTick: 16,
      capacity: 6000, maxHp: 220, structuralResistance: 6000,
      scoreEffects: {},
    },
    3: {
      type: 'freight_warehouse', tier: 3,
      nameKey: 'building.freight_warehouse.t3.name',
      footprint: rect(6, 5), entryPoint: entry(), exitPoint: exit_(6),
      constructionCost: 72000, demolishCost: 18000, operatingCostPerTick: 24,
      capacity: 15000, maxHp: 300, structuralResistance: 9000,
      scoreEffects: {},
    },
  },

  // ── Vehicle Depot ───────────────────────────────────────────────────────────
  vehicle_depot: {
    1: {
      type: 'vehicle_depot', tier: 1,
      nameKey: 'building.vehicle_depot.t1.name',
      footprint: rect(4, 3), entryPoint: entry(), exitPoint: exit_(4),
      constructionCost: 18000, demolishCost: 4500, operatingCostPerTick: 12,
      capacity: 6, maxHp: 130, structuralResistance: 4000,
      scoreEffects: {},
    },
    2: {
      type: 'vehicle_depot', tier: 2,
      nameKey: 'building.vehicle_depot.t2.name',
      footprint: rect(5, 3), entryPoint: entry(), exitPoint: exit_(5),
      constructionCost: 42000, demolishCost: 10000, operatingCostPerTick: 20,
      capacity: 12, maxHp: 200, structuralResistance: 6000,
      scoreEffects: {},
    },
    3: {
      type: 'vehicle_depot', tier: 3,
      nameKey: 'building.vehicle_depot.t3.name',
      footprint: rect(6, 4), entryPoint: entry(), exitPoint: exit_(6),
      constructionCost: 85000, demolishCost: 20000, operatingCostPerTick: 30,
      capacity: 24, maxHp: 280, structuralResistance: 9000,
      scoreEffects: {},
    },
  },

};
