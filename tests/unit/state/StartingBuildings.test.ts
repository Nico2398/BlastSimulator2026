import { describe, it, expect } from 'vitest';
import { createRunner } from '../../../src/console/createRunner.js';
import { placeStartingBuildings, resolveStartingSite, isStaffedComposition } from '../../../src/core/state/StartingBuildings.js';
import { createBuildingState, getDefSize, getBuildingDef, getStorageCapacity } from '../../../src/core/entities/Building.js';
import { VoxelGrid, getSmoothTerrainSurfaceY, type VoxelData } from '../../../src/core/world/VoxelGrid.js';
import type { StartingBuildingSlot } from '../../../src/core/config/balance.js';
import { FREIGHT_WAREHOUSE_CAPACITY_KG, RALLY_POINT_BUILDING_CLEARANCE, STARTING_SITE_STAFFED_COMPOSITION } from '../../../src/core/config/balance.js';

function solidVoxel(): VoxelData {
  return {
    composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
    density: 1.0,
    oreDensities: {},
    fractureModifier: 1.0,
  };
}

function makeFlatGrid(size: number, topY = 1): VoxelGrid {
  const grid = new VoxelGrid(size, size);
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      for (let y = 0; y <= topY; y++) grid.setVoxel(x, y, z, solidVoxel());
    }
  }
  return grid;
}

const WAREHOUSE: StartingBuildingSlot = { type: 'freight_warehouse', tier: 1 };

describe('placeStartingBuildings (#1363)', () => {
  it('places a tier-1 freight warehouse on flat ground and reports one placed', () => {
    const buildings = createBuildingState();
    const placed = placeStartingBuildings(buildings, makeFlatGrid(40), [WAREHOUSE], { x: 10, z: 10 });
    expect(placed).toBe(1);
    expect(buildings.buildings).toHaveLength(1);
    const b = buildings.buildings[0]!;
    expect(b.type).toBe('freight_warehouse');
    expect(b.tier).toBe(1);
    expect(b.active).toBe(true);
    expect(b.hp).toBe(getBuildingDef('freight_warehouse', 1).maxHp);
  });

  it('places the building close to the requested point', () => {
    const buildings = createBuildingState();
    placeStartingBuildings(buildings, makeFlatGrid(40), [WAREHOUSE], { x: 20, z: 20 });
    const b = buildings.buildings[0]!;
    expect(Math.hypot(b.x - 20, b.z - 20)).toBeLessThanOrEqual(8);
  });

  it('keeps the whole footprint inside the grid', () => {
    const buildings = createBuildingState();
    const grid = makeFlatGrid(40);
    placeStartingBuildings(buildings, grid, [WAREHOUSE], { x: 0, z: 0 });
    const b = buildings.buildings[0]!;
    const { sizeX, sizeZ } = getDefSize(getBuildingDef(b.type, b.tier));
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.z).toBeGreaterThanOrEqual(0);
    expect(b.x + sizeX).toBeLessThanOrEqual(40);
    expect(b.z + sizeZ).toBeLessThanOrEqual(40);
  });

  it('provides the warehouse storage capacity', () => {
    const buildings = createBuildingState();
    placeStartingBuildings(buildings, makeFlatGrid(40), [WAREHOUSE], { x: 10, z: 10 });
    expect(getStorageCapacity(buildings)).toBeGreaterThanOrEqual(FREIGHT_WAREHOUSE_CAPACITY_KG[1]);
  });

  it('skips steep ground and settles on the flat part of the site', () => {
    // Left half is a cliff-like staircase (height varies each column), right half is flat.
    const size = 48;
    const grid = new VoxelGrid(size, size);
    for (let z = 0; z < size; z++) {
      for (let x = 0; x < size; x++) {
        const top = x < 24 ? 1 + (x % 2) * 6 : 1;
        for (let y = 0; y <= top; y++) grid.setVoxel(x, y, z, solidVoxel());
      }
    }
    const buildings = createBuildingState();
    const placed = placeStartingBuildings(buildings, grid, [WAREHOUSE], { x: 6, z: 20 });
    expect(placed).toBe(1);
    // x=21 is the first origin whose margin (20..25) spans a single level.
    expect(buildings.buildings[0]!.x).toBeGreaterThanOrEqual(21);
  });

  it('places several slots without overlap', () => {
    const buildings = createBuildingState();
    const placed = placeStartingBuildings(buildings, makeFlatGrid(40), [WAREHOUSE, WAREHOUSE], { x: 10, z: 10 });
    expect(placed).toBe(2);
    const [a, b] = buildings.buildings as [typeof buildings.buildings[number], typeof buildings.buildings[number]];
    const overlapX = a.x < b.x + 4 && b.x < a.x + 4;
    const overlapZ = a.z < b.z + 4 && b.z < a.z + 4;
    expect(overlapX && overlapZ).toBe(false);
  });

  it('returns 0 for an empty slot list', () => {
    const buildings = createBuildingState();
    expect(placeStartingBuildings(buildings, makeFlatGrid(40), [], { x: 10, z: 10 })).toBe(0);
    expect(buildings.buildings).toHaveLength(0);
  });

  it('returns 0 and places nothing when no site fits (grid smaller than the footprint)', () => {
    const buildings = createBuildingState();
    expect(placeStartingBuildings(buildings, makeFlatGrid(3), [WAREHOUSE], { x: 1, z: 1 })).toBe(0);
    expect(buildings.buildings).toHaveLength(0);
  });

  it('returns 0 when the only ground is unbuildable (every column differs in height)', () => {
    const size = 24;
    const grid = new VoxelGrid(size, size);
    for (let z = 0; z < size; z++) {
      for (let x = 0; x < size; x++) {
        const top = 1 + ((x + z) % 2) * 8;
        for (let y = 0; y <= top; y++) grid.setVoxel(x, y, z, solidVoxel());
      }
    }
    const buildings = createBuildingState();
    expect(placeStartingBuildings(buildings, grid, [WAREHOUSE], { x: 12, z: 12 })).toBe(0);
  });
});

describe('placeStartingBuildings — flat surroundings and the rally point', () => {
  it('passes over a footprint that fits a gentle slope when flat ground lies further out', () => {
    // A steady slope west of x=24 (two levels every five columns): many 4x4
    // footprints there span only one level and pass the placement tolerance,
    // but every one-cell margin around them spans two — a hillside.
    const size = 48;
    const grid = new VoxelGrid(size, size);
    for (let z = 0; z < size; z++) {
      for (let x = 0; x < size; x++) {
        const top = 1 + Math.floor(Math.min(x, 24) * 0.4);
        for (let y = 0; y <= top; y++) grid.setVoxel(x, y, z, solidVoxel());
      }
    }
    const buildings = createBuildingState();
    placeStartingBuildings(buildings, grid, [WAREHOUSE], { x: 18, z: 20 });
    // x=21 is the first origin whose margin (20..25) spans a single level.
    expect(buildings.buildings[0]!.x).toBeGreaterThanOrEqual(21);
  });

  it('keeps every footprint RALLY_POINT_BUILDING_CLEARANCE cells from the flag', () => {
    const flag = { x: 20, z: 20 };
    const buildings = createBuildingState();
    placeStartingBuildings(buildings, makeFlatGrid(48), [WAREHOUSE, { type: 'spoil_heap', tier: 1 }], flag, flag);
    expect(buildings.buildings).toHaveLength(2);
    for (const b of buildings.buildings) {
      const { sizeX, sizeZ } = getDefSize(getBuildingDef(b.type, b.tier));
      const dx = flag.x < b.x ? b.x - flag.x : Math.max(0, flag.x - (b.x + sizeX - 1));
      const dz = flag.z < b.z ? b.z - flag.z : Math.max(0, flag.z - (b.z + sizeZ - 1));
      expect(Math.max(dx, dz), `${b.type} at (${b.x},${b.z})`).toBeGreaterThanOrEqual(RALLY_POINT_BUILDING_CLEARANCE);
      expect(Math.max(dx, dz), `${b.type} at (${b.x},${b.z})`).toBeLessThanOrEqual(RALLY_POINT_BUILDING_CLEARANCE + 4);
    }
  });

  it('still places a building beside the flag on a site with no room to keep its clearance', () => {
    const buildings = createBuildingState();
    expect(placeStartingBuildings(buildings, makeFlatGrid(8), [WAREHOUSE], { x: 4, z: 4 }, { x: 4, z: 4 })).toBe(1);
  });
});

/** Every column steps 1 <-> 2 with x parity: a tolerated one-level slope under any footprint. */
function makeSteppedGrid(size: number): VoxelGrid {
  const grid = new VoxelGrid(size, size);
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const top = 1 + (x % 2);
      for (let y = 0; y <= top; y++) grid.setVoxel(x, y, z, solidVoxel());
    }
  }
  return grid;
}

function footprintHeights(grid: VoxelGrid, b: { type: any; tier: any; x: number; z: number }): number[] {
  return getBuildingDef(b.type, b.tier).footprint.map(([dx, dz]) => getSmoothTerrainSurfaceY(grid, b.x + dx, b.z + dz));
}

describe('placeStartingBuildings levels the footprint (#1583)', () => {
  it('levels a footprint placed on a one-step slope, never raising it', () => {
    const grid = makeSteppedGrid(40);
    const before = new Map<string, number>();
    for (let z = 0; z < 40; z++) for (let x = 0; x < 40; x++) before.set(`${x},${z}`, getSmoothTerrainSurfaceY(grid, x, z));
    const buildings = createBuildingState();
    expect(placeStartingBuildings(buildings, grid, [WAREHOUSE], { x: 10, z: 10 })).toBe(1);
    const b = buildings.buildings[0]!;
    const heights = footprintHeights(grid, b);
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(1e-6);
    const originals = getBuildingDef(b.type, b.tier).footprint.map(([dx, dz]) => before.get(`${b.x + dx},${b.z + dz}`)!);
    expect(Math.max(...originals) - Math.min(...originals)).toBeGreaterThan(0.5);
    heights.forEach((h, i) => expect(h).toBeLessThanOrEqual(originals[i]! + 1e-6));
    expect(heights[0]).toBeGreaterThanOrEqual(Math.min(...originals) - 1e-6);
  });

  it('leaves a flat grid untouched', () => {
    const grid = makeFlatGrid(40, 2);
    const before = getSmoothTerrainSurfaceY(grid, 10, 10);
    const buildings = createBuildingState();
    placeStartingBuildings(buildings, grid, [WAREHOUSE], { x: 10, z: 10 });
    for (const h of footprintHeights(grid, buildings.buildings[0]!)) expect(h).toBeCloseTo(before, 6);
  });

  it('levels every slot of a two-slot site', () => {
    const grid = makeSteppedGrid(40);
    const buildings = createBuildingState();
    expect(placeStartingBuildings(buildings, grid, [WAREHOUSE, WAREHOUSE], { x: 10, z: 10 })).toBe(2);
    for (const b of buildings.buildings) {
      const heights = footprintHeights(grid, b);
      expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(1e-6);
    }
  });
});

describe('resolveStartingSite (#1363)', () => {
  const levelSite = { employees: [], vehicles: [], buildings: [] };

  it('keeps the level site when staffed is absent', () => {
    expect(resolveStartingSite(levelSite, undefined)).toBe(levelSite);
  });

  it('uses the global staffed composition when staffed is true', () => {
    expect(resolveStartingSite(levelSite, true)).toBe(STARTING_SITE_STAFFED_COMPOSITION);
  });

  it('yields a bare site when staffed is false', () => {
    expect(resolveStartingSite(levelSite, false)).toBeUndefined();
  });
});

describe('isStaffedComposition (#1574)', () => {
  it('is false for an absent site and a heap-only site', () => {
    expect(isStaffedComposition(undefined)).toBe(false);
    expect(isStaffedComposition({ employees: [], vehicles: [], buildings: [] })).toBe(false);
  });

  it('is true for the global staffed composition', () => {
    expect(isStaffedComposition(STARTING_SITE_STAFFED_COMPOSITION)).toBe(true);
  });
});

describe('starting compositions carry a charging truck and a crew member who can drive it (#1648)', () => {
  const dual = (slots: typeof STARTING_SITE_STAFFED_COMPOSITION.employees) =>
    slots.some(e => {
      const cats = e.qualifications.map(q => q.category);
      return cats.includes('blasting') && cats.includes('driving.truck');
    });

  it('staffed composition has a tier-1 charging_truck and a blasting + driving.truck slot', () => {
    expect(STARTING_SITE_STAFFED_COMPOSITION.vehicles).toContainEqual({ role: 'charging_truck', tier: 1 });
    expect(dual(STARTING_SITE_STAFFED_COMPOSITION.employees)).toBe(true);
  });

  it('Dusty Hollow composition inherits the truck and the dual-qualified slot', async () => {
    const { DUSTY_HOLLOW_STARTING_SITE } = await import('../../../src/core/config/balance.js');
    expect(DUSTY_HOLLOW_STARTING_SITE.vehicles).toContainEqual({ role: 'charging_truck', tier: 1 });
    expect(dual(DUSTY_HOLLOW_STARTING_SITE.employees)).toBe(true);
  });

  it('the dual-qualified slot is the blaster, at driving.truck level 1', async () => {
    const blaster = STARTING_SITE_STAFFED_COMPOSITION.employees.find(e => e.role === 'blaster')!;
    expect(blaster.qualifications).toContainEqual({ category: 'blasting', proficiencyLevel: 1 });
    expect(blaster.qualifications).toContainEqual({ category: 'driving.truck', proficiencyLevel: 1 });
  });

  it('the tutorial site still opens bare: no crew, no fleet', async () => {
    const { TUTORIAL_STARTING_SITE } = await import('../../../src/core/config/balance.js');
    expect(TUTORIAL_STARTING_SITE.employees).toHaveLength(0);
    expect(TUTORIAL_STARTING_SITE.vehicles).toHaveLength(0);
  });
});


// ── Kit buildings keep each other's largest tier free (#1830) ────────────────
type Rect = { minX: number; minZ: number; maxX: number; maxZ: number };

function rectOf(type: 'freight_warehouse' | 'spoil_heap', tier: 1 | 2 | 3, x: number, z: number): Rect {
  const { sizeX, sizeZ } = getDefSize(getBuildingDef(type, tier));
  return { minX: x, minZ: z, maxX: x + sizeX, maxZ: z + sizeZ };
}

function disjoint(a: Rect, b: Rect): boolean {
  return a.maxX <= b.minX || b.maxX <= a.minX || a.maxZ <= b.minZ || b.maxZ <= a.minZ;
}

function sandboxKit(biome: string, seed: number) {
  const { runner, ctx } = createRunner();
  const r = runner.run(`sandbox start biome:${biome} difficulty:easy seed:${seed}`);
  expect(r).toMatchObject({ success: true });
  const list = ctx.state!.buildings.buildings;
  return {
    warehouse: list.find(b => b.type === 'freight_warehouse')!,
    heap: list.find(b => b.type === 'spoil_heap')!,
  };
}

describe('placeStartingBuildings — warehouse upgrade room (#1830)', () => {
  it('the warehouse tiers 2 and 3 are 5x4 and 6x5', () => {
    expect(getDefSize(getBuildingDef('freight_warehouse', 2))).toMatchObject({ sizeX: 5, sizeZ: 4 });
    expect(getDefSize(getBuildingDef('freight_warehouse', 3))).toMatchObject({ sizeX: 6, sizeZ: 5 });
  });

  const BIOMES = ['desert_badlands', 'red_canyon', 'volcanic_flats', 'tropical_karst', 'alpine_granite', 'green_foothills'];
  const SEEDS = [1, 2, 3, 7, 42];
  for (const biome of BIOMES) {
    for (const seed of SEEDS) {
      it(`${biome} seed ${seed}: heap is clear of warehouse tier-2 and tier-3 footprints`, () => {
        const { warehouse, heap } = sandboxKit(biome, seed);
        const heapRect = rectOf('spoil_heap', 1, heap.x, heap.z);
        expect(disjoint(heapRect, rectOf('freight_warehouse', 2, warehouse.x, warehouse.z)), 'tier 2').toBe(true);
        expect(disjoint(heapRect, rectOf('freight_warehouse', 3, warehouse.x, warehouse.z)), 'tier 3').toBe(true);
      });
    }
  }

  it('desert_badlands seed 42 (the reported repro) leaves tier 2 free', () => {
    const { warehouse, heap } = sandboxKit('desert_badlands', 42);
    expect(disjoint(rectOf('spoil_heap', 1, heap.x, heap.z), rectOf('freight_warehouse', 2, warehouse.x, warehouse.z))).toBe(true);
  });

  it('green_foothills seed 3 leaves tier 2 free', () => {
    const { warehouse, heap } = sandboxKit('green_foothills', 3);
    expect(disjoint(rectOf('spoil_heap', 1, heap.x, heap.z), rectOf('freight_warehouse', 2, warehouse.x, warehouse.z))).toBe(true);
  });

  it('keeps the room when the heap is listed before the warehouse (symmetric to slot order)', () => {
    const buildings = createBuildingState();
    const slots: StartingBuildingSlot[] = [{ type: 'spoil_heap', tier: 1 }, WAREHOUSE];
    expect(placeStartingBuildings(buildings, makeFlatGrid(60), slots, { x: 30, z: 30 })).toBe(2);
    const w = buildings.buildings.find(b => b.type === 'freight_warehouse')!;
    const h = buildings.buildings.find(b => b.type === 'spoil_heap')!;
    const heapRect = rectOf('spoil_heap', 1, h.x, h.z);
    expect(disjoint(heapRect, rectOf('freight_warehouse', 2, w.x, w.z))).toBe(true);
    expect(disjoint(heapRect, rectOf('freight_warehouse', 3, w.x, w.z))).toBe(true);
  });

  it('keeps the room in the warehouse-first order on a flat grid too', () => {
    const buildings = createBuildingState();
    const slots: StartingBuildingSlot[] = [WAREHOUSE, { type: 'spoil_heap', tier: 1 }];
    placeStartingBuildings(buildings, makeFlatGrid(60), slots, { x: 30, z: 30 });
    const w = buildings.buildings.find(b => b.type === 'freight_warehouse')!;
    const h = buildings.buildings.find(b => b.type === 'spoil_heap')!;
    expect(disjoint(rectOf('spoil_heap', 1, h.x, h.z), rectOf('freight_warehouse', 3, w.x, w.z))).toBe(true);
  });

  it('stays near the anchor and keeps rally clearance while reserving room', () => {
    const flag = { x: 30, z: 30 };
    const buildings = createBuildingState();
    placeStartingBuildings(buildings, makeFlatGrid(60), [WAREHOUSE, { type: 'spoil_heap', tier: 1 }], flag, flag);
    for (const b of buildings.buildings) {
      expect(Math.hypot(b.x - flag.x, b.z - flag.z), b.type).toBeLessThanOrEqual(RALLY_POINT_BUILDING_CLEARANCE + 12);
    }
  });

  it('still places every building on a cramped site where no cell leaves room', () => {
    const buildings = createBuildingState();
    const slots: StartingBuildingSlot[] = [WAREHOUSE, { type: 'spoil_heap', tier: 1 }];
    // 9x7 fits the tier-1 pair but cannot hold a tier-3 warehouse clear of the heap.
    const grid = makeFlatGrid(9);
    expect(placeStartingBuildings(buildings, grid, slots, { x: 4, z: 4 })).toBe(2);
    expect(buildings.buildings).toHaveLength(2);
  });

  it('is deterministic', () => {
    const run = () => {
      const buildings = createBuildingState();
      placeStartingBuildings(buildings, makeFlatGrid(60), [{ type: 'spoil_heap', tier: 1 }, WAREHOUSE], { x: 30, z: 30 });
      return buildings.buildings.map(b => [b.type, b.x, b.z]);
    };
    expect(run()).toEqual(run());
  });
});
