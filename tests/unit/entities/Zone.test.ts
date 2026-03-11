import { describe, it, expect } from 'vitest';
import {
  clearZone,
  isZoneClear,
  type ZoneBounds,
} from '../../../src/core/entities/Zone.js';
import { createVehicleState, purchaseVehicle } from '../../../src/core/entities/Vehicle.js';
import { createEmployeeState, type Employee } from '../../../src/core/entities/Employee.js';
import { createDamageState, processProjections } from '../../../src/core/entities/Damage.js';
import { createBuildingState } from '../../../src/core/entities/Building.js';
import type { FragmentData } from '../../../src/core/mining/BlastExecution.js';

function addEmployee(state: ReturnType<typeof createEmployeeState>, x: number, z: number): Employee {
  const emp: Employee = {
    id: state.nextId++, name: 'Test', role: 'driller', salary: 500,
    morale: 60, unionized: false, injured: false, alive: true, x, z,
  };
  state.employees.push(emp);
  return emp;
}

const zone: ZoneBounds = { x1: 10, z1: 10, x2: 30, z2: 30 };

describe('Zone clearing and evacuation', () => {
  it('clearZone moves all entities out of the defined area', () => {
    const vehicles = createVehicleState();
    const { vehicle } = purchaseVehicle(vehicles, 'truck', 15, 15);
    const employees = createEmployeeState();
    addEmployee(employees, 20, 20);
    addEmployee(employees, 5, 5); // Outside zone

    const result = clearZone(zone, vehicles, employees);

    expect(result.movedVehicles).toBe(1);
    expect(result.movedEmployees).toBe(1); // Only 1 was in zone
    expect(vehicle.x).toBeGreaterThan(zone.x2);
  });

  it('isZoneClear returns true when no entities remain', () => {
    const vehicles = createVehicleState();
    purchaseVehicle(vehicles, 'truck', 15, 15);
    const employees = createEmployeeState();
    addEmployee(employees, 20, 20);

    expect(isZoneClear(zone, vehicles, employees)).toBe(false);

    clearZone(zone, vehicles, employees);
    expect(isZoneClear(zone, vehicles, employees)).toBe(true);
  });

  it('blasting without clearing zone + projections → casualties', () => {
    const employees = createEmployeeState();
    addEmployee(employees, 15, 15); // In blast zone

    const projection: FragmentData = {
      id: 1, position: { x: 15, y: 0, z: 15 }, volume: 4, mass: 10,
      rockId: 'sandite', oreDensities: {},
      initialVelocity: { x: 30, y: 0, z: 0 }, // KE = 0.5*10*900 = 4500J → death
      isProjection: true,
    };

    const damage = createDamageState();
    const accidents = processProjections(
      [projection], createBuildingState(), createVehicleState(), employees, damage, 1,
    );

    expect(accidents.length).toBeGreaterThan(0);
    expect(employees.employees[0]!.alive).toBe(false);
  });

  it('blasting after clearing zone → no casualties even with projections in the zone', () => {
    const vehicles = createVehicleState();
    const employees = createEmployeeState();
    addEmployee(employees, 15, 15);

    // Clear zone first
    clearZone(zone, vehicles, employees);
    expect(isZoneClear(zone, vehicles, employees)).toBe(true);

    // Projection lands in zone — but no one is there
    const projection: FragmentData = {
      id: 1, position: { x: 20, y: 0, z: 20 }, volume: 4, mass: 10,
      rockId: 'sandite', oreDensities: {},
      initialVelocity: { x: 30, y: 0, z: 0 },
      isProjection: true,
    };

    const damage = createDamageState();
    const accidents = processProjections(
      [projection], createBuildingState(), vehicles, employees, damage, 1,
    );

    // No casualties — everyone was evacuated
    const casualties = accidents.filter(a => a.type === 'death' || a.type === 'injury');
    expect(casualties.length).toBe(0);
  });
});
