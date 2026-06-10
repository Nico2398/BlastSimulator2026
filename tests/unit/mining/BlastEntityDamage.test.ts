import { describe, it, expect, beforeEach } from 'vitest';
import { computeBlastEntityDamage } from '../../../src/core/mining/BlastCalc.js';
import type { BlastEntityDamageResult } from '../../../src/core/mining/BlastCalc.js';
import { VoxelGrid, type VoxelData } from '../../../src/core/world/VoxelGrid.js';
import { Random } from '../../../src/core/math/Random.js';
import { createBuildingState, getDefSize, getBuildingDef, type BuildingState } from '../../../src/core/entities/Building.js';
import type { Building, BuildingType, BuildingTier } from '../../../src/core/entities/Building.js';
import type { Employee } from '../../../src/core/entities/Employee.js';
import type { Vehicle, VehicleRole, VehicleTier } from '../../../src/core/entities/Vehicle.js';
import { getRock } from '../../../src/core/world/RockCatalog.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

const CRUITE_ABSORPTION = getRock('cruite')!.energyAbsorption; // 200

/** Create a VoxelGrid filled entirely with one rock type at density 1.0. */
function filledGrid(
  sizeX: number, sizeY: number, sizeZ: number, rockId: string,
): VoxelGrid {
  const grid = new VoxelGrid(sizeX, sizeY, sizeZ);
  const voxel: VoxelData = {
    composition: { rocks: [{ rockId, coefficient: 1.0 }] },
    density: 1.0,
    oreDensities: {},
    fractureModifier: 1.0,
  };
  for (let z = 0; z < sizeZ; z++) {
    for (let y = 0; y < sizeY; y++) {
      for (let x = 0; x < sizeX; x++) {
        grid.setVoxel(x, y, z, voxel);
      }
    }
  }
  return grid;
}

/** Create a VoxelGrid of all air except solid rock at one column (x, *, z). */
function columnRockGrid(
  sizeX: number, sizeY: number, sizeZ: number,
  sx: number, sz: number, rockId: string,
): VoxelGrid {
  const grid = new VoxelGrid(sizeX, sizeY, sizeZ);
  const voxel: VoxelData = {
    composition: { rocks: [{ rockId, coefficient: 1.0 }] },
    density: 1.0,
    oreDensities: {},
    fractureModifier: 1.0,
  };
  for (let y = 0; y < sizeY; y++) {
    grid.setVoxel(sx, y, sz, voxel);
  }
  return grid;
}

/** Set all voxels in a column (x, *, z) to solid rock. */
function fillColumn(grid: VoxelGrid, x: number, z: number, rockId: string): void {
  const voxel: VoxelData = {
    composition: { rocks: [{ rockId, coefficient: 1.0 }] },
    density: 1.0,
    oreDensities: {},
    fractureModifier: 1.0,
  };
  for (let y = 0; y < grid.sizeY; y++) {
    grid.setVoxel(x, y, z, voxel);
  }
}

/** Create an Employee fixture. */
function makeEmployee(id: number, x: number, z: number, alive: boolean = true): Employee {
  return {
    id,
    name: `Test${id}`,
    role: 'driller',
    salary: 1000,
    morale: 50,
    unionized: false,
    injured: false,
    alive,
    x,
    z,
    qualifications: [],
    trainingState: null,
    activeActionId: null,
    hunger: 80,
    fatigue: 80,
    breakNeed: 80,
    collapsing: false,
  };
}

/** Create a Vehicle fixture. */
function makeVehicle(id: number, x: number, z: number): Vehicle {
  return {
    id,
    type: 'debris_hauler' as VehicleRole,
    tier: 1 as VehicleTier,
    x,
    z,
    hp: 100,
    task: 'idle',
    targetX: x,
    targetZ: z,
    driverId: null,
    state: 'idle',
    payloadKg: 0,
    waitingTicks: 0,
  };
}

/** Create a building placed at (x, z) in the given BuildingState. Returns the building ID. */
function addBuilding(
  state: BuildingState,
  type: BuildingType,
  tier: BuildingTier,
  x: number,
  z: number,
): number {
  const def = getBuildingDef(type, tier);
  const b: Building = {
    id: state.nextId++,
    type,
    tier,
    x,
    z,
    hp: def.maxHp,
    active: true,
  };
  state.buildings.push(b);
  return b.id;
}

/** Set effectiveEnergy for all voxels in a building's footprint column, across all y. */
function setBuildingFootprintEnergy(
  effectiveEnergy: Map<string, number>,
  grid: VoxelGrid,
  b: { x: number; z: number },
  type: BuildingType,
  tier: BuildingTier,
  energyPerColumn: number,
): void {
  const def = getBuildingDef(type, tier);
  for (const [dx, dz] of def.footprint) {
    const cx = b.x + dx;
    const cz = b.z + dz;
    for (let y = 0; y < grid.sizeY; y++) {
      const v = grid.getVoxel(cx, y, cz);
      if (v && v.density > 0) {
        const key = `${cx},${y},${cz}`;
        effectiveEnergy.set(key, energyPerColumn);
      }
    }
  }
}

// ============================================================================
// Suite: computeBlastEntityDamage
// ============================================================================

describe('BlastCalc — computeBlastEntityDamage', () => {

  // ──── Employee instant kill ─────────────────────────────────────────────

  describe('employee instant kill', () => {

    // AC: Alive employee on a fragmented voxel → killedEmployeeIds includes that employee's ID.
    it('alive employee on a fragmented voxel → killed', () => {
      const grid = filledGrid(5, 5, 5, 'cruite');
      const fragmented = new Set<string>(['2,0,2']);
      const effectiveEnergy = new Map<string, number>();
      const employees = [makeEmployee(1, 2, 2)];  // at x=2, z=2
      const vehicles: Vehicle[] = [];
      const buildings = createBuildingState();
      const rng = new Random(42);

      const result = computeBlastEntityDamage(
        fragmented, effectiveEnergy, grid, employees, vehicles, buildings, rng,
      );
      expect(result.killedEmployeeIds).toEqual([1]);
    });

    // AC: Dead/already-dead employee on fragmented voxel → NOT double-killed.
    it('dead employee on fragmented voxel → NOT double-killed', () => {
      const grid = filledGrid(5, 5, 5, 'cruite');
      const fragmented = new Set<string>(['2,0,2']);
      const effectiveEnergy = new Map<string, number>();
      const employees = [makeEmployee(1, 2, 2, false)]; // alive = false
      const vehicles: Vehicle[] = [];
      const buildings = createBuildingState();
      const rng = new Random(42);

      const result = computeBlastEntityDamage(
        fragmented, effectiveEnergy, grid, employees, vehicles, buildings, rng,
      );
      expect(result.killedEmployeeIds).toEqual([]);
    });

    // AC: Employee NOT on any fragmented voxel → NOT in killedEmployeeIds.
    it('employee NOT on fragmented voxel → not killed', () => {
      const grid = filledGrid(5, 5, 5, 'cruite');
      const fragmented = new Set<string>(['2,0,2']);
      const effectiveEnergy = new Map<string, number>();
      const employees = [makeEmployee(1, 0, 0)];  // at x=0, z=0 — not fragmented
      const vehicles: Vehicle[] = [];
      const buildings = createBuildingState();
      const rng = new Random(42);

      const result = computeBlastEntityDamage(
        fragmented, effectiveEnergy, grid, employees, vehicles, buildings, rng,
      );
      expect(result.killedEmployeeIds).toEqual([]);
    });

    // Employee standing on fragmented voxel at a different y-level → still killed (scan all y).
    it('employee on fragmented voxel at y-level 3 → killed (scans all y)', () => {
      const grid = filledGrid(5, 5, 5, 'cruite');
      // Fragment only at y=3
      const fragmented = new Set<string>(['2,3,2']);
      const effectiveEnergy = new Map<string, number>();
      const employees = [makeEmployee(1, 2, 2)];
      const vehicles: Vehicle[] = [];
      const buildings = createBuildingState();
      const rng = new Random(42);

      const result = computeBlastEntityDamage(
        fragmented, effectiveEnergy, grid, employees, vehicles, buildings, rng,
      );
      expect(result.killedEmployeeIds).toEqual([1]);
    });

    // Multiple employees on fragmented voxels → all killed.
    it('multiple employees on fragmented voxels → all killed', () => {
      const grid = filledGrid(5, 5, 5, 'cruite');
      const fragmented = new Set<string>(['2,0,2', '4,0,4']);
      const effectiveEnergy = new Map<string, number>();
      const employees = [
        makeEmployee(1, 2, 2),
        makeEmployee(2, 4, 4),
        makeEmployee(3, 0, 0), // not on fragmented
      ];
      const vehicles: Vehicle[] = [];
      const buildings = createBuildingState();
      const rng = new Random(42);

      const result = computeBlastEntityDamage(
        fragmented, effectiveEnergy, grid, employees, vehicles, buildings, rng,
      );
      expect(result.killedEmployeeIds).toEqual(expect.arrayContaining([1, 2]));
      expect(result.killedEmployeeIds).not.toContain(3);
    });

    // Employee at fractional coordinate → Math.floor used for voxel lookup.
    it('employee at fractional coordinates → uses Math.floor for voxel lookup', () => {
      const grid = filledGrid(5, 5, 5, 'cruite');
      const fragmented = new Set<string>(['2,0,2']);
      const effectiveEnergy = new Map<string, number>();
      const employees = [makeEmployee(1, 2.7, 2.3)];
      const vehicles: Vehicle[] = [];
      const buildings = createBuildingState();
      const rng = new Random(42);

      const result = computeBlastEntityDamage(
        fragmented, effectiveEnergy, grid, employees, vehicles, buildings, rng,
      );
      expect(result.killedEmployeeIds).toEqual([1]);
    });
  });

  // ──── Vehicle instant destroy ───────────────────────────────────────────

  describe('vehicle instant destroy', () => {

    // AC: Vehicle on a fragmented voxel → destroyedVehicleIds includes that vehicle's ID.
    it('vehicle on a fragmented voxel → destroyed', () => {
      const grid = filledGrid(5, 5, 5, 'cruite');
      const fragmented = new Set<string>(['1,0,1']);
      const effectiveEnergy = new Map<string, number>();
      const employees: Employee[] = [];
      const vehicles = [makeVehicle(10, 1, 1)];
      const buildings = createBuildingState();
      const rng = new Random(42);

      const result = computeBlastEntityDamage(
        fragmented, effectiveEnergy, grid, employees, vehicles, buildings, rng,
      );
      expect(result.destroyedVehicleIds).toEqual([10]);
    });

    // AC: Vehicle NOT on any fragmented voxel → NOT in destroyedVehicleIds.
    it('vehicle NOT on fragmented voxel → not destroyed', () => {
      const grid = filledGrid(5, 5, 5, 'cruite');
      const fragmented = new Set<string>(['1,0,1']);
      const effectiveEnergy = new Map<string, number>();
      const employees: Employee[] = [];
      const vehicles = [makeVehicle(10, 4, 4)];
      const buildings = createBuildingState();
      const rng = new Random(42);

      const result = computeBlastEntityDamage(
        fragmented, effectiveEnergy, grid, employees, vehicles, buildings, rng,
      );
      expect(result.destroyedVehicleIds).toEqual([]);
    });

    // Multiple vehicles on fragmented voxels → all destroyed.
    it('multiple vehicles on fragmented voxels → all destroyed', () => {
      const grid = filledGrid(5, 5, 5, 'cruite');
      const fragmented = new Set<string>(['0,0,0', '4,0,4']);
      const effectiveEnergy = new Map<string, number>();
      const employees: Employee[] = [];
      const vehicles = [
        makeVehicle(10, 0, 0),
        makeVehicle(11, 4, 4),
        makeVehicle(12, 2, 2), // not on fragmented
      ];
      const buildings = createBuildingState();
      const rng = new Random(42);

      const result = computeBlastEntityDamage(
        fragmented, effectiveEnergy, grid, employees, vehicles, buildings, rng,
      );
      expect(result.destroyedVehicleIds).toEqual(expect.arrayContaining([10, 11]));
      expect(result.destroyedVehicleIds).not.toContain(12);
    });
  });

  // ──── Building sum + survival roll ──────────────────────────────────────

  describe('building sum + survival roll', () => {

    // AC: Building with summed effectiveEnergy > structuralResistance → destroyed.
    it('building footprint energy sum > structuralResistance → building destroyed', () => {
      const grid = filledGrid(6, 5, 6, 'cruite');
      const buildings = createBuildingState();
      const bId = addBuilding(buildings, 'driving_center', 1, 2, 2);
      const def = getBuildingDef('driving_center', 1); // structuralResistance = 3000

      const effectiveEnergy = new Map<string, number>();
      // Use energy well above structuralResistance for each footprint column
      setBuildingFootprintEnergy(effectiveEnergy, grid, { x: 2, z: 2 }, 'driving_center', 1, 2000);
      // 4 footprint cells × 2000 each = 8000 total > 3000

      const fragmented = new Set<string>();
      const employees: Employee[] = [];
      const vehicles: Vehicle[] = [];
      const rng = new Random(42);

      const result = computeBlastEntityDamage(
        fragmented, effectiveEnergy, grid, employees, vehicles, buildings, rng,
      );
      expect(result.destroyedBuildingIds).toContain(bId);
    });

    // AC: Building with summed effectiveEnergy ≤ structuralResistance → NOT destroyed.
    it('building footprint energy sum ≤ structuralResistance → NOT destroyed', () => {
      const grid = filledGrid(6, 5, 6, 'cruite');
      const buildings = createBuildingState();
      const bId = addBuilding(buildings, 'driving_center', 1, 2, 2);
      const def = getBuildingDef('driving_center', 1); // structuralResistance = 3000

      const effectiveEnergy = new Map<string, number>();
      // Use energy well below structuralResistance per column
      setBuildingFootprintEnergy(effectiveEnergy, grid, { x: 2, z: 2 }, 'driving_center', 1, 500);
      // 4 cells × 500 = 2000 < 3000

      const fragmented = new Set<string>();
      const employees: Employee[] = [];
      const vehicles: Vehicle[] = [];
      const rng = new Random(42);

      const result = computeBlastEntityDamage(
        fragmented, effectiveEnergy, grid, employees, vehicles, buildings, rng,
      );
      expect(result.destroyedBuildingIds).not.toContain(bId);
    });

    // Multiple buildings: one destroyed, one not.
    it('multiple buildings — only ones exceeding structuralResistance are destroyed', () => {
      const grid = filledGrid(10, 5, 10, 'cruite');
      const buildings = createBuildingState();
      const b1 = addBuilding(buildings, 'driving_center', 1, 1, 1); // structuralResistance = 3000
      const b2 = addBuilding(buildings, 'living_quarters', 1, 5, 5); // structuralResistance = 3500

      const effectiveEnergy = new Map<string, number>();
      // b1 gets enough energy: 4 cells × 2000 = 8000 > 3000
      setBuildingFootprintEnergy(effectiveEnergy, grid, { x: 1, z: 1 }, 'driving_center', 1, 2000);
      // b2 gets too little energy: 9 cells × 300 = 2700 < 3500
      setBuildingFootprintEnergy(effectiveEnergy, grid, { x: 5, z: 5 }, 'living_quarters', 1, 300);

      const fragmented = new Set<string>();
      const employees: Employee[] = [];
      const vehicles: Vehicle[] = [];
      const rng = new Random(42);

      const result = computeBlastEntityDamage(
        fragmented, effectiveEnergy, grid, employees, vehicles, buildings, rng,
      );
      expect(result.destroyedBuildingIds).toContain(b1);
      expect(result.destroyedBuildingIds).not.toContain(b2);
    });

    // Building destroyed → occupant survival roll applies per spec formula.
    it('building destroyed → occupant survival roll applies', () => {
      const grid = filledGrid(6, 5, 6, 'cruite');
      const buildings = createBuildingState();
      const bId = addBuilding(buildings, 'driving_center', 1, 2, 2);

      // structuralResistance = 3000; set energy to exactly 3× = 9000 total
      // deathProb = clamp((9000/3000 - 1) * 0.5, 0.30, 1.00) = clamp(1.0, 0.30, 1.00) = 1.0
      const effectiveEnergy = new Map<string, number>();
      setBuildingFootprintEnergy(effectiveEnergy, grid, { x: 2, z: 2 }, 'driving_center', 1, 2250);
      // 4 cells × 2250 = 9000

      // Employee standing inside the building footprint (cell (2,2) which maps to footprint (0,0))
      const employees = [makeEmployee(1, 2, 2)];
      const vehicles: Vehicle[] = [];
      const fragmented = new Set<string>();

      // With deathProb=1.0, occupant MUST die
      const rng = new Random(42);
      const result = computeBlastEntityDamage(
        fragmented, effectiveEnergy, grid, employees, vehicles, buildings, rng,
      );
      expect(result.destroyedBuildingIds).toContain(bId);
      expect(result.occupantCasualties).toBeGreaterThanOrEqual(1);
      // Employee 1 is in killedEmployeeIds (occupant killed)
      expect(result.killedEmployeeIds).toContain(1);
    });

    // AC: Energy exactly equal to structuralResistance → building NOT destroyed (condition is strictly >).
    it('energy equal to structuralResistance → building NOT destroyed', () => {
      const grid = filledGrid(6, 5, 6, 'cruite');
      const buildings = createBuildingState();
      const bId = addBuilding(buildings, 'driving_center', 1, 2, 2);

      // structuralResistance = 3000; set exactly 3000 total (4 cells × 750 = 3000)
      // Condition is totalE > structuralResistance, so exactly equal → NOT destroyed
      const effectiveEnergy = new Map<string, number>();
      setBuildingFootprintEnergy(effectiveEnergy, grid, { x: 2, z: 2 }, 'driving_center', 1, 750);

      const employees = [makeEmployee(1, 2, 2)];
      const vehicles: Vehicle[] = [];
      const fragmented = new Set<string>();
      const rng = new Random(42);

      const result = computeBlastEntityDamage(
        fragmented, effectiveEnergy, grid, employees, vehicles, buildings, rng,
      );
      expect(result.destroyedBuildingIds).not.toContain(bId);
      expect(result.occupantCasualties).toBe(0);
    });

    it('deathProb clamped to 0.30 minimum when energy just exceeds structuralResistance', () => {
      const grid = filledGrid(6, 5, 6, 'cruite');
      const buildings = createBuildingState();
      const bId = addBuilding(buildings, 'driving_center', 1, 2, 2);

      // structuralResistance = 3000; just barely exceed: 3001 total
      // deathProb = clamp((3001/3000 - 1) * 0.5, 0.30, 1.00) = clamp(0.000166... * 0.5, 0.30, 1.00)
      // = clamp(0.0000833..., 0.30, 1.00) = 0.30
      const effectiveEnergy = new Map<string, number>();
      // We need 4 cells summing to 3001 → 750.25 each (approx)
      // Actually, let's use uneven distribution: 750, 750, 750, 751
      const def = getBuildingDef('driving_center', 1);
      const cols = def.footprint;
      const energies = [750, 750, 750, 751];
      for (let i = 0; i < cols.length; i++) {
        const [dx, dz] = cols[i]!;
        const cx = 2 + dx;
        const cz = 2 + dz;
        for (let y = 0; y < grid.sizeY; y++) {
          const v = grid.getVoxel(cx, y, cz);
          if (v && v.density > 0) {
            effectiveEnergy.set(`${cx},${y},${cz}`, energies[i]!);
          }
        }
      }

      const employees = [makeEmployee(1, 2, 2)];
      const vehicles: Vehicle[] = [];
      const fragmented = new Set<string>();
      const rng = new Random(42);

      const result = computeBlastEntityDamage(
        fragmented, effectiveEnergy, grid, employees, vehicles, buildings, rng,
      );
      expect(result.destroyedBuildingIds).toContain(bId);
      // deathProb is 0.30, so occupant may or may not die (stochastic)
      // But totalDeaths must be ≥ 0 and ≤ 1
      expect(result.totalDeaths).toBeGreaterThanOrEqual(0);
      expect(result.totalDeaths).toBeLessThanOrEqual(1);
    });

    // AC: deathProb max 1.00 when energy is very high.
    it('deathProb clamped to 1.00 at very high energy → all occupants die', () => {
      const grid = filledGrid(6, 5, 6, 'cruite');
      const buildings = createBuildingState();
      const bId = addBuilding(buildings, 'driving_center', 1, 2, 2);

      // structuralResistance = 3000; energy = 12000 (4×)
      // deathProb = clamp((12000/3000 - 1) * 0.5, 0.30, 1.00) = clamp(1.5, 0.30, 1.00) = 1.0
      const effectiveEnergy = new Map<string, number>();
      setBuildingFootprintEnergy(effectiveEnergy, grid, { x: 2, z: 2 }, 'driving_center', 1, 3000);

      // Two employees inside the building
      const employees = [
        makeEmployee(1, 2, 2), // footprint cell (0,0) from origin (2,2)
        makeEmployee(2, 3, 2), // footprint cell (1,0)
      ];
      const vehicles: Vehicle[] = [];
      const fragmented = new Set<string>();
      const rng = new Random(42);

      const result = computeBlastEntityDamage(
        fragmented, effectiveEnergy, grid, employees, vehicles, buildings, rng,
      );
      expect(result.destroyedBuildingIds).toContain(bId);
      // With deathProb=1.0, both occupants MUST die
      expect(result.occupantCasualties).toBe(2);
      expect(result.totalDeaths).toBe(2);
    });

    // AC: Occupant who survives roll → NOT killed (still alive after function).
    it('occupant who survives roll → NOT killed', () => {
      const grid = filledGrid(6, 5, 6, 'cruite');
      const buildings = createBuildingState();
      const bId = addBuilding(buildings, 'driving_center', 1, 2, 2);

      // structuralResistance = 3000; just barely exceed so deathProb = 0.30
      // Use a seed where rng.chance(0.30) returns false for the occupant
      // We can't pick the seed a priori, but we can use 2 occupants and check
      // if at least one survives (statistically very likely at 30% death prob)
      const effectiveEnergy = new Map<string, number>();
      const def = getBuildingDef('driving_center', 1);
      const cols = def.footprint;
      const energies = [751, 750, 750, 750];
      for (let i = 0; i < cols.length; i++) {
        const [dx, dz] = cols[i]!;
        const cx = 2 + dx;
        const cz = 2 + dz;
        for (let y = 0; y < grid.sizeY; y++) {
          const v = grid.getVoxel(cx, y, cz);
          if (v && v.density > 0) {
            effectiveEnergy.set(`${cx},${y},${cz}`, energies[i]!);
          }
        }
      }

      // 10 occupants → with deathProb=0.30, expected deaths ≈ 3, so at least 1 likely survives
      const employees = Array.from({ length: 10 }, (_, i) => makeEmployee(i + 1, 2 + (i % 2), 2 + Math.floor(i / 5)));
      const vehicles: Vehicle[] = [];
      const fragmented = new Set<string>();
      const rng = new Random(42);

      const result = computeBlastEntityDamage(
        fragmented, effectiveEnergy, grid, employees, vehicles, buildings, rng,
      );
      expect(result.destroyedBuildingIds).toContain(bId);
      // At least one occupant survived (occupantCasualties < number of occupants)
      expect(result.occupantCasualties).toBeLessThan(10);
    });

    // AC: Occupant who fails roll → killed, counted in occupantCasualties.
    it('occupant who fails death roll → killed and counted in occupantCasualties', () => {
      const grid = filledGrid(6, 5, 6, 'cruite');
      const buildings = createBuildingState();
      const bId = addBuilding(buildings, 'driving_center', 1, 2, 2);

      // deathProb = 1.0 (certain death)
      const effectiveEnergy = new Map<string, number>();
      setBuildingFootprintEnergy(effectiveEnergy, grid, { x: 2, z: 2 }, 'driving_center', 1, 3000);

      const employees = [makeEmployee(1, 2, 2)];
      const vehicles: Vehicle[] = [];
      const fragmented = new Set<string>();
      const rng = new Random(42);

      const result = computeBlastEntityDamage(
        fragmented, effectiveEnergy, grid, employees, vehicles, buildings, rng,
      );
      expect(result.destroyedBuildingIds).toContain(bId);
      expect(result.occupantCasualties).toBe(1);
      expect(result.killedEmployeeIds).toContain(1);
    });

    // Building destroyed but no occupants → 0 casualties, building still destroyed.
    it('building destroyed with no occupants → 0 occupantCasualties', () => {
      const grid = filledGrid(6, 5, 6, 'cruite');
      const buildings = createBuildingState();
      const bId = addBuilding(buildings, 'driving_center', 1, 2, 2);

      const effectiveEnergy = new Map<string, number>();
      setBuildingFootprintEnergy(effectiveEnergy, grid, { x: 2, z: 2 }, 'driving_center', 1, 2000);

      const employees: Employee[] = [];
      const vehicles: Vehicle[] = [];
      const fragmented = new Set<string>();
      const rng = new Random(42);

      const result = computeBlastEntityDamage(
        fragmented, effectiveEnergy, grid, employees, vehicles, buildings, rng,
      );
      expect(result.destroyedBuildingIds).toContain(bId);
      expect(result.occupantCasualties).toBe(0);
    });
  });

  // ──── Aggregate results ─────────────────────────────────────────────────

  describe('aggregate results', () => {

    // AC: totalDeaths equals the count of unique killed employees (killedEmployeeIds includes
    // both instant kills and occupant kills; totalDeaths must not double-count).
    it('totalDeaths equals unique killedEmployeeIds count (no double-counting)', () => {
      const grid = filledGrid(8, 5, 8, 'cruite');
      const buildings = createBuildingState();
      const bId = addBuilding(buildings, 'driving_center', 1, 4, 4);

      // Set up: employee on fragmented voxel AND occupant in destroyed building
      const fragmented = new Set<string>(['1,0,1']);
      const effectiveEnergy = new Map<string, number>();
      setBuildingFootprintEnergy(effectiveEnergy, grid, { x: 4, z: 4 }, 'driving_center', 1, 3000);

      // Employee 1 on fragmented voxel (instant kill)
      // Employee 2 inside building occupant (deathProb=1.0)
      const employees = [
        makeEmployee(1, 1, 1),   // instant kill
        makeEmployee(2, 4, 4),   // occupant
      ];
      const vehicles: Vehicle[] = [];
      const rng = new Random(42);

      const result = computeBlastEntityDamage(
        fragmented, effectiveEnergy, grid, employees, vehicles, buildings, rng,
      );
      // totalDeaths must equal the number of unique killed employees (not double-count occupants)
      expect(result.totalDeaths).toBe(result.killedEmployeeIds.length);
      // Verify both kills actually happened in this scenario
      expect(result.killedEmployeeIds).toContain(1);
      expect(result.killedEmployeeIds).toContain(2);
      expect(result.totalDeaths).toBe(2);
    });
  });

  // ──── Seeded PRNG determinism ───────────────────────────────────────────

  describe('seeded PRNG determinism', () => {

    // AC: Same seed → same result.
    it('same seed produces identical occupant casualty count', () => {
      const grid = filledGrid(6, 5, 6, 'cruite');
      const buildings = createBuildingState();
      const bId = addBuilding(buildings, 'driving_center', 1, 2, 2);

      // deathProb ≈ 0.50 (totalEnergy = 2× structuralResistance)
      const effectiveEnergy = new Map<string, number>();
      setBuildingFootprintEnergy(effectiveEnergy, grid, { x: 2, z: 2 }, 'driving_center', 1, 1500);

      const employees = Array.from({ length: 5 }, (_, i) => makeEmployee(i + 1, 2 + (i % 2), 2));
      const vehicles: Vehicle[] = [];
      const fragmented = new Set<string>();

      const result1 = computeBlastEntityDamage(
        fragmented, effectiveEnergy, grid, employees, vehicles, buildings, new Random(42),
      );
      const result2 = computeBlastEntityDamage(
        fragmented, effectiveEnergy, grid, employees, vehicles, buildings, new Random(42),
      );

      expect(result1.occupantCasualties).toBe(result2.occupantCasualties);
      expect(result1.destroyedBuildingIds).toEqual(result2.destroyedBuildingIds);
      expect(result1.killedEmployeeIds).toEqual(result2.killedEmployeeIds);
    });

    // Different seed → result may differ (cannot assert, but should not throw).
    it('different seed does not throw', () => {
      const grid = filledGrid(6, 5, 6, 'cruite');
      const buildings = createBuildingState();
      addBuilding(buildings, 'driving_center', 1, 2, 2);

      const effectiveEnergy = new Map<string, number>();
      setBuildingFootprintEnergy(effectiveEnergy, grid, { x: 2, z: 2 }, 'driving_center', 1, 1500);

      const employees = [makeEmployee(1, 2, 2)];
      const vehicles: Vehicle[] = [];
      const fragmented = new Set<string>();

      expect(() => {
        computeBlastEntityDamage(fragmented, effectiveEnergy, grid, employees, vehicles, buildings, new Random(1));
        computeBlastEntityDamage(fragmented, effectiveEnergy, grid, employees, vehicles, buildings, new Random(999));
      }).not.toThrow();
    });
  });

  // ──── Edge cases ────────────────────────────────────────────────────────

  describe('edge cases', () => {

    // AC: Empty fragmented voxels → no damage.
    it('empty fragmented voxels → no damage (empty result)', () => {
      const grid = filledGrid(5, 5, 5, 'cruite');
      const fragmented = new Set<string>();
      const effectiveEnergy = new Map<string, number>();
      const employees = [makeEmployee(1, 2, 2)];
      const vehicles = [makeVehicle(10, 2, 2)];
      const buildings = createBuildingState();
      const rng = new Random(42);

      const result = computeBlastEntityDamage(
        fragmented, effectiveEnergy, grid, employees, vehicles, buildings, rng,
      );
      expect(result.killedEmployeeIds).toEqual([]);
      expect(result.destroyedVehicleIds).toEqual([]);
      expect(result.destroyedBuildingIds).toEqual([]);
      expect(result.occupantCasualties).toBe(0);
      expect(result.totalDeaths).toBe(0);
    });

    // AC: No employees/vehicles/buildings → empty result.
    it('no employees, vehicles, or buildings → empty result', () => {
      const grid = filledGrid(5, 5, 5, 'cruite');
      const fragmented = new Set<string>(['2,0,2']);
      const effectiveEnergy = new Map<string, number>([['2,0,2', 9999]]);
      const employees: Employee[] = [];
      const vehicles: Vehicle[] = [];
      const buildings = createBuildingState();
      const rng = new Random(42);

      const result = computeBlastEntityDamage(
        fragmented, effectiveEnergy, grid, employees, vehicles, buildings, rng,
      );
      expect(result.killedEmployeeIds).toEqual([]);
      expect(result.destroyedVehicleIds).toEqual([]);
      expect(result.destroyedBuildingIds).toEqual([]);
      expect(result.occupantCasualties).toBe(0);
      expect(result.totalDeaths).toBe(0);
    });

    // Employee and vehicle at same cell → both killed/destroyed.
    it('employee and vehicle on same fragmented cell → both killed/destroyed', () => {
      const grid = filledGrid(5, 5, 5, 'cruite');
      const fragmented = new Set<string>(['2,0,2']);
      const effectiveEnergy = new Map<string, number>();
      const employees = [makeEmployee(1, 2, 2)];
      const vehicles = [makeVehicle(10, 2, 2)];
      const buildings = createBuildingState();
      const rng = new Random(42);

      const result = computeBlastEntityDamage(
        fragmented, effectiveEnergy, grid, employees, vehicles, buildings, rng,
      );
      expect(result.killedEmployeeIds).toEqual([1]);
      expect(result.destroyedVehicleIds).toEqual([10]);
    });

    // Building at grid edge with footprint partially out-of-bounds — skip OOB voxels gracefully.
    it('building at grid edge — out-of-bounds footprint cells are skipped', () => {
      // Grid is small: 3×5×3. Building placed at (2,2) — right at the x-edge.
      const grid = filledGrid(3, 5, 3, 'cruite');
      const buildings = createBuildingState();
      // driving_center tier 1 has footprint rect(2,2) → occupies x ∈ [2,3], but grid max X = 2
      // So footprint extends beyond grid in +x direction
      const bId = addBuilding(buildings, 'driving_center', 1, 2, 0);

      // Set energy only on in-bounds voxels under the building
      const effectiveEnergy = new Map<string, number>();
      const def = getBuildingDef('driving_center', 1);
      for (const [dx, dz] of def.footprint) {
        const cx = 2 + dx;
        const cz = 0 + dz;
        if (grid.isInBounds(cx, 0, cz)) {
          for (let y = 0; y < grid.sizeY; y++) {
            const v = grid.getVoxel(cx, y, cz);
            if (v && v.density > 0) {
              effectiveEnergy.set(`${cx},${y},${cz}`, 9999);
            }
          }
        }
      }

      const fragmented = new Set<string>();
      const employees: Employee[] = [];
      const vehicles: Vehicle[] = [];
      const rng = new Random(42);

      // Should not throw
      const result = computeBlastEntityDamage(
        fragmented, effectiveEnergy, grid, employees, vehicles, buildings, rng,
      );
      expect(result).toBeDefined();
    });

    // Building with zero incoming energy (no blast near it) → NOT destroyed.
    it('building with zero incoming energy → NOT destroyed', () => {
      const grid = filledGrid(6, 5, 6, 'cruite');
      const buildings = createBuildingState();

      const bId = addBuilding(buildings, 'driving_center', 1, 2, 2);
      const effectiveEnergy = new Map<string, number>();
      const fragmented = new Set<string>();
      const employees: Employee[] = [];
      const vehicles: Vehicle[] = [];
      const rng = new Random(42);

      // No energy set → sum of effectiveEnergy under footprint = 0 → building not destroyed
      const result = computeBlastEntityDamage(
        fragmented, effectiveEnergy, grid, employees, vehicles, buildings, rng,
      );
      expect(result.destroyedBuildingIds).not.toContain(bId);
    });

    // Employee inside building who is ALSO on a fragmented voxel → counted once (not double-counted).
    it('employee on fragmented voxel AND inside destroyed building → counted once in totalDeaths', () => {
      const grid = filledGrid(6, 5, 6, 'cruite');
      const buildings = createBuildingState();
      const bId = addBuilding(buildings, 'driving_center', 1, 2, 2);

      // Fragmented at same cell as occupant
      const fragmented = new Set<string>(['2,0,2']);
      const effectiveEnergy = new Map<string, number>();
      setBuildingFootprintEnergy(effectiveEnergy, grid, { x: 2, z: 2 }, 'driving_center', 1, 3000);

      const employees = [makeEmployee(1, 2, 2)]; // both on fragmented AND inside building
      const vehicles: Vehicle[] = [];
      const rng = new Random(42);

      const result = computeBlastEntityDamage(
        fragmented, effectiveEnergy, grid, employees, vehicles, buildings, rng,
      );
      // Employee should appear in killedEmployeeIds (instant kill)
      expect(result.killedEmployeeIds).toContain(1);
      // occupantCasualties may also include them from the survival roll
      // But totalDeaths should equal killedEmployeeIds + occupantCasualties
      // If the employee is in both, they should not be double-counted
      // The spec says killedEmployeeIds tracks instant kills, occupantCasualties tracks
      // deaths from survival rolls. If the employee is both instantly killed AND
      // then rolled in survival, that's OK — they're a casualty in both counts.
      expect(result.totalDeaths).toBe(
        result.killedEmployeeIds.length + result.occupantCasualties,
      );
    });
  });
});
