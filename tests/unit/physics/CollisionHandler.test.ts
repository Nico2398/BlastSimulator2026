import { describe, it, expect } from 'vitest';
import { applyFragmentCollisions, buildMassMap } from '../../../src/physics/CollisionHandler.js';
import { createBuildingState, placeBuilding } from '../../../src/core/entities/Building.js';
import { createVehicleState, purchaseVehicle } from '../../../src/core/entities/Vehicle.js';
import { createEmployeeState } from '../../../src/core/entities/Employee.js';
import { createDamageState } from '../../../src/core/entities/Damage.js';
import type { FragmentSimResult } from '../../../src/physics/FragmentBody.js';

/** Build a minimal settled fragment result. */
function makeResult(id: number, x: number, z: number, impactSpeed: number): FragmentSimResult {
  return {
    fragmentId: id,
    finalPosition: { x, y: 0.5, z },
    settled: true,
    impactSpeed,
  };
}

describe('CollisionHandler (8.4)', () => {
  it('high-energy fragment damages and destroys a building', () => {
    const buildings = createBuildingState();
    const vehicles = createVehicleState();
    const employees = createEmployeeState();
    const damage = createDamageState();

    // Place a building at (5, 5) — center ≈ (6.5, 6) for 3×3 worker_quarters
    placeBuilding(buildings, 'worker_quarters', 5, 5, 20, 20);
    const building = buildings.buildings[0]!;
    const originalHp = building.hp; // 100

    // Fragment with VERY high KE: mass=200kg, speed=30 m/s → KE=90000J
    // HP damage = round(90000/50) = 1800 >> 100 HP → destroyed
    const results = [makeResult(1, 6.5, 6, 30)]; // hits building center
    const massMap = buildMassMap([{ id: 1, mass: 200 }]);

    const accidents = applyFragmentCollisions(results, massMap, buildings, vehicles, employees, damage, 1);

    expect(accidents).toHaveLength(1);
    expect(accidents[0]!.type).toBe('building_destroyed');
    expect(accidents[0]!.fragmentId).toBe(1);
    expect(accidents[0]!.kineticEnergy).toBeCloseTo(0.5 * 200 * 30 * 30, 0);
    // Building should be removed
    expect(buildings.buildings).toHaveLength(0);
    expect(damage.accidents).toHaveLength(1);
  });

  it('medium-energy fragment damages building without destroying it', () => {
    const buildings = createBuildingState();
    const vehicles = createVehicleState();
    const employees = createEmployeeState();
    const damage = createDamageState();

    // worker_quarters at (5,5), maxHp=100
    placeBuilding(buildings, 'worker_quarters', 5, 5, 20, 20);
    const building = buildings.buildings[0]!;

    // mass=20kg, speed=10 m/s → KE=1000J > BUILDING_DAMAGE_THRESHOLD(500)
    // HP damage = round(1000/50) = 20 → hp goes from 100 to 80 (not destroyed)
    const results = [makeResult(1, 6.5, 6, 10)];
    const massMap = buildMassMap([{ id: 1, mass: 20 }]);

    const accidents = applyFragmentCollisions(results, massMap, buildings, vehicles, employees, damage, 1);

    expect(accidents).toHaveLength(1);
    expect(accidents[0]!.type).toBe('building_damage');
    expect(building.hp).toBe(80);
    expect(buildings.buildings).toHaveLength(1); // Still standing
  });

  it('low-energy fragment does not damage building', () => {
    const buildings = createBuildingState();
    const vehicles = createVehicleState();
    const employees = createEmployeeState();
    const damage = createDamageState();

    placeBuilding(buildings, 'worker_quarters', 5, 5, 20, 20);
    const building = buildings.buildings[0]!;
    const originalHp = building.hp;

    // mass=5kg, speed=5 m/s → KE=62.5J < BUILDING_DAMAGE_THRESHOLD(500)
    const results = [makeResult(1, 6.5, 6, 5)];
    const massMap = buildMassMap([{ id: 1, mass: 5 }]);

    const accidents = applyFragmentCollisions(results, massMap, buildings, vehicles, employees, damage, 1);

    expect(accidents).toHaveLength(0);
    expect(building.hp).toBe(originalHp);
  });

  it('lethal fragment kills nearby employee and marks lawsuit', () => {
    const buildings = createBuildingState();
    const vehicles = createVehicleState();
    const employees = createEmployeeState();
    const damage = createDamageState();

    // Add employee directly (bypass hire to avoid needing RNG)
    employees.employees.push({
      id: 99, name: 'Test Worker', role: 'driller',
      salary: 500, morale: 60, unionized: false,
      injured: false, alive: true,
      x: 10, z: 10,
    });

    // mass=50kg, speed=20 m/s → KE=10000J > DEATH_THRESHOLD(2000)
    const results = [makeResult(1, 10, 10, 20)];
    const massMap = buildMassMap([{ id: 1, mass: 50 }]);

    const accidents = applyFragmentCollisions(results, massMap, buildings, vehicles, employees, damage, 5);

    expect(accidents).toHaveLength(1);
    expect(accidents[0]!.type).toBe('death');
    expect(accidents[0]!.entityId).toBe(99);
    expect(accidents[0]!.tick).toBe(5);

    const emp = employees.employees.find(e => e.id === 99)!;
    expect(emp.alive).toBe(false);
    expect(damage.lawsuitPending).toBe(true);
    expect(damage.deathCount).toBe(1);
  });

  it('injuring fragment injures employee without killing', () => {
    const buildings = createBuildingState();
    const vehicles = createVehicleState();
    const employees = createEmployeeState();
    const damage = createDamageState();

    employees.employees.push({
      id: 99, name: 'Test Worker', role: 'driller',
      salary: 500, morale: 60, unionized: false,
      injured: false, alive: true,
      x: 10, z: 10,
    });

    // mass=10kg, speed=5 m/s → KE=125J — between INJURY(100) and DEATH(2000)
    const results = [makeResult(1, 10, 10, 5)];
    const massMap = buildMassMap([{ id: 1, mass: 10 }]);

    const accidents = applyFragmentCollisions(results, massMap, buildings, vehicles, employees, damage, 3);

    expect(accidents).toHaveLength(1);
    expect(accidents[0]!.type).toBe('injury');
    const emp = employees.employees.find(e => e.id === 99)!;
    expect(emp.alive).toBe(true);
    expect(emp.injured).toBe(true);
  });

  it('fragment far away does not trigger damage', () => {
    const buildings = createBuildingState();
    const vehicles = createVehicleState();
    const employees = createEmployeeState();
    const damage = createDamageState();

    placeBuilding(buildings, 'worker_quarters', 0, 0, 20, 20);

    // Fragment lands at (15, 15) — far from building at (0,0)
    const results = [makeResult(1, 15, 15, 30)];
    const massMap = buildMassMap([{ id: 1, mass: 200 }]);

    const accidents = applyFragmentCollisions(results, massMap, buildings, vehicles, employees, damage, 1);

    expect(accidents).toHaveLength(0);
    expect(buildings.buildings[0]!.hp).toBe(100); // Untouched
  });

  it('vehicle destroyed by high-energy impact', () => {
    const buildings = createBuildingState();
    const vehicles = createVehicleState();
    const employees = createEmployeeState();
    const damage = createDamageState();

    // truck at (10, 10), maxHp=100
    purchaseVehicle(vehicles, 'truck', 10, 10);

    // mass=200kg, speed=30 m/s → KE=90000J, dmg=round(90000/40)=2250 >> 100hp
    const results = [makeResult(1, 10, 10, 30)];
    const massMap = buildMassMap([{ id: 1, mass: 200 }]);

    const accidents = applyFragmentCollisions(results, massMap, buildings, vehicles, employees, damage, 1);

    expect(accidents).toHaveLength(1);
    expect(accidents[0]!.type).toBe('vehicle_destroyed');
    expect(vehicles.vehicles).toHaveLength(0);
  });

  it('buildMassMap creates correct lookup', () => {
    const frags = [
      { id: 1, mass: 50 },
      { id: 2, mass: 100 },
      { id: 3, mass: 25 },
    ];
    const map = buildMassMap(frags);
    expect(map.get(1)).toBe(50);
    expect(map.get(2)).toBe(100);
    expect(map.get(3)).toBe(25);
    expect(map.get(99)).toBeUndefined();
  });
});
