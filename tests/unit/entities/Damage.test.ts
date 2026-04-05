import { describe, it, expect } from 'vitest';
import type { FragmentData } from '../../../src/core/mining/BlastExecution.js';
import {
  createDamageState,
  processProjections,
} from '../../../src/core/entities/Damage.js';
import {
  createBuildingState,
  placeBuilding,
} from '../../../src/core/entities/Building.js';
import { createVehicleState } from '../../../src/core/entities/Vehicle.js';
import {
  createEmployeeState,
  type Employee,
} from '../../../src/core/entities/Employee.js';

function makeProjection(id: number, x: number, z: number, mass: number, velocity: number): FragmentData {
  return {
    id, position: { x, y: 0, z }, volume: mass / 2.5, mass,
    rockId: 'sandite', oreDensities: {},
    initialVelocity: { x: velocity, y: 0, z: 0 },
    isProjection: true,
  };
}

describe('Damage and casualty system', () => {
  it('fast heavy fragment hitting a building reduces its HP', () => {
    const buildings = createBuildingState();
    placeBuilding(buildings, 'living_quarters', 5, 5, 64, 64);
    const origHp = buildings.buildings[0]!.hp;

    const frag = makeProjection(1, 6.5, 6.5, 10, 20); // KE = 0.5*10*400 = 2000J
    const damage = createDamageState();
    const accidents = processProjections(
      [frag], buildings, createVehicleState(), createEmployeeState(), damage, 1,
    );

    expect(accidents.length).toBeGreaterThan(0);
    expect(buildings.buildings[0]!.hp).toBeLessThan(origHp);
  });

  it('building at 0 HP is destroyed', () => {
    const buildings = createBuildingState();
    placeBuilding(buildings, 'management_office', 5, 5, 64, 64); // management_office has 80 HP
    buildings.buildings[0]!.hp = 10; // Set HP low

    // High energy fragment
    const frag = makeProjection(1, 6, 6, 50, 30); // KE = 0.5*50*900 = 22500J
    const damage = createDamageState();
    processProjections(
      [frag], buildings, createVehicleState(), createEmployeeState(), damage, 1,
    );

    expect(buildings.buildings.length).toBe(0);
    const destroyed = damage.accidents.find(a => a.type === 'building_destroyed');
    expect(destroyed).toBeDefined();
  });

  it('fragment hitting employee position injures/kills based on energy', () => {
    const employees = createEmployeeState();
    // Manually add employees near impact
    const emp1: Employee = {
      id: 1, name: 'Bob', role: 'driller', salary: 500,
      morale: 60, unionized: false, injured: false, alive: true,
      x: 10, z: 10,
    };
    const emp2: Employee = {
      id: 2, name: 'Chuck', role: 'blaster', salary: 700,
      morale: 60, unionized: false, injured: false, alive: true,
      x: 20, z: 20,
    };
    employees.employees.push(emp1, emp2);
    employees.nextId = 3;

    // Low energy → injury
    const fragLow = makeProjection(1, 10, 10, 2, 15); // KE = 0.5*2*225 = 225J > 100
    // High energy → death
    const fragHigh = makeProjection(2, 20, 20, 20, 20); // KE = 0.5*20*400 = 4000J > 2000

    const damage = createDamageState();
    processProjections(
      [fragLow, fragHigh],
      createBuildingState(), createVehicleState(), employees, damage, 1,
    );

    expect(emp1.injured).toBe(true);
    expect(emp2.alive).toBe(false);
  });

  it('death is recorded in accident history', () => {
    const employees = createEmployeeState();
    employees.employees.push({
      id: 1, name: 'Test', role: 'driller', salary: 500,
      morale: 60, unionized: false, injured: false, alive: true,
      x: 5, z: 5,
    });

    const frag = makeProjection(1, 5, 5, 30, 20); // KE = 6000J → death
    const damage = createDamageState();
    processProjections(
      [frag], createBuildingState(), createVehicleState(), employees, damage, 5,
    );

    const deathRecord = damage.accidents.find(a => a.type === 'death');
    expect(deathRecord).toBeDefined();
    expect(deathRecord!.tick).toBe(5);
    expect(damage.deathCount).toBe(1);
  });

  it('death triggers a lawsuit pending flag', () => {
    const employees = createEmployeeState();
    employees.employees.push({
      id: 1, name: 'Test', role: 'driller', salary: 500,
      morale: 60, unionized: false, injured: false, alive: true,
      x: 5, z: 5,
    });

    const frag = makeProjection(1, 5, 5, 30, 20);
    const damage = createDamageState();
    processProjections(
      [frag], createBuildingState(), createVehicleState(), employees, damage, 1,
    );

    expect(damage.lawsuitPending).toBe(true);
  });

  it('integration: overcharged blast near buildings → building damage', () => {
    const buildings = createBuildingState();
    placeBuilding(buildings, 'living_quarters', 10, 10, 64, 64);

    // Simulate multiple high-energy projections from an overcharged blast
    const projections = [
      makeProjection(1, 11, 11, 15, 25), // KE = 4687J
      makeProjection(2, 11.5, 11.5, 10, 20), // KE = 2000J
    ];

    const damage = createDamageState();
    const accidents = processProjections(
      projections, buildings, createVehicleState(), createEmployeeState(), damage, 1,
    );

    expect(accidents.length).toBeGreaterThan(0);
    expect(accidents.some(a => a.type === 'building_damage' || a.type === 'building_destroyed')).toBe(true);
  });
});
