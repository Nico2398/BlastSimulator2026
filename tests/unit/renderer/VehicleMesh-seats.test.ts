// VehicleMesh — seated figures (#2319)

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { Vehicle, VehicleState, VehicleTier } from '../../../src/core/entities/Vehicle.js';
import type { Employee, EmployeeRole } from '../../../src/core/entities/Employee.js';
import { hireEmployee, createEmployeeState } from '../../../src/core/entities/Employee.js';
import { Random } from '../../../src/core/math/Random.js';
import { VehicleMesh } from '../../../src/renderer/VehicleMesh.js';
import { vehicleSeatAnchors } from '../../../src/renderer/VehicleSeats.js';
import { ModelLibrary } from '../../../src/renderer/models/ModelLibrary.js';
import { loadModelsFromDisk, loadedModelLibrary } from '../../helpers/models.js';

const WORKERS = ['worker_driller', 'worker_blaster', 'worker_driver', 'worker_surveyor', 'worker_manager'];
const SHUTTLE = 'vehicle_travel_vehicle_t1';
const RACE_CAR = 'vehicle_travel_vehicle_t2';
const HAULER = 'vehicle_debris_hauler_t2';

function makeVehicle(id: number, type: Vehicle['type'], tier: VehicleTier, occupantIds: number[] = [], x = 0, z = 0): Vehicle {
  return { id, type, tier, x, z, hp: 100, cargo: [], occupantIds };
}

function stateOf(vehicles: Vehicle[]): VehicleState {
  return { vehicles, nextId: vehicles.length + 1, driverBoardingCount: 0, reservations: [] };
}

function makeEmployee(id: number, role: EmployeeRole = 'driver'): Employee {
  const { employee } = hireEmployee(createEmployeeState(), role, new Random(id), 0, 0);
  employee.id = id;
  return employee;
}

const ROLES: EmployeeRole[] = ['driver', 'driller', 'blaster', 'surveyor', 'manager', 'driver'];
function crew(n: number): Employee[] {
  return Array.from({ length: n }, (_, i) => makeEmployee(100 + i, ROLES[i % ROLES.length]!));
}

async function setup(vehicleIds: string[], v: Vehicle, employees: Employee[]) {
  const library = await loadedModelLibrary([...vehicleIds, ...WORKERS]);
  const scene = new THREE.Scene();
  const vm = new VehicleMesh(scene, library);
  vm.addVehicle(v, stateOf([v]), employees);
  vm.update([v], stateOf([v]), employees, 0.1);
  return { vm, scene, library };
}

function isDescendant(obj: THREE.Object3D, ancestor: THREE.Object3D): boolean {
  for (let p = obj.parent; p; p = p.parent) if (p === ancestor) return true;
  return false;
}

describe('VehicleMesh seated figures', () => {
  it('shows one figure per occupant of a loaded shuttle, seat = occupant index, driver seat 0', async () => {
    const staff = crew(3);
    const v = makeVehicle(1, 'travel_vehicle', 1, staff.map(e => e.id));
    const { vm } = await setup([SHUTTLE], v, staff);
    const figures = vm.getSeatedFigures(1);
    expect(figures).toHaveLength(3);
    expect(figures.map(f => f.seat)).toEqual([0, 1, 2]);
    expect(figures.map(f => f.employeeId)).toEqual(staff.map(e => e.id));
    vm.dispose();
  });

  it('seats a full shuttle with six figures', async () => {
    const staff = crew(6);
    const v = makeVehicle(1, 'travel_vehicle', 1, staff.map(e => e.id));
    const { vm } = await setup([SHUTTLE], v, staff);
    expect(vm.getSeatedFigures(1).map(f => f.seat)).toEqual([0, 1, 2, 3, 4, 5]);
    vm.dispose();
  });

  it('shows exactly one figure in a race car with one occupant', async () => {
    const staff = crew(1);
    const v = makeVehicle(1, 'travel_vehicle', 2, [staff[0]!.id]);
    const { vm } = await setup([RACE_CAR], v, staff);
    const figures = vm.getSeatedFigures(1);
    expect(figures).toHaveLength(1);
    expect(figures[0]!.seat).toBe(0);
    expect(figures[0]!.employeeId).toBe(staff[0]!.id);
    vm.dispose();
  });

  it('shows no figures in an empty vehicle', async () => {
    const v = makeVehicle(1, 'travel_vehicle', 1, []);
    const { vm } = await setup([SHUTTLE], v, crew(2));
    expect(vm.getSeatedFigures(1)).toEqual([]);
    vm.dispose();
  });

  it('skips occupants that are not on the employee roster', async () => {
    const staff = crew(2);
    const v = makeVehicle(1, 'travel_vehicle', 1, [staff[0]!.id, 9999, staff[1]!.id]);
    const { vm } = await setup([SHUTTLE], v, staff);
    const ids = vm.getSeatedFigures(1).map(f => f.employeeId);
    expect(ids).toContain(staff[0]!.id);
    expect(ids).toContain(staff[1]!.id);
    expect(ids).not.toContain(9999);
    expect(ids).toHaveLength(2);
    vm.dispose();
  });

  it('returns no figures for an unknown vehicle id', async () => {
    const v = makeVehicle(1, 'travel_vehicle', 1, []);
    const { vm } = await setup([SHUTTLE], v, []);
    expect(vm.getSeatedFigures(404)).toEqual([]);
    vm.dispose();
  });

  it('parents every figure under the vehicle root group, at its seat anchor x/z', async () => {
    const staff = crew(4);
    const v = makeVehicle(1, 'travel_vehicle', 1, staff.map(e => e.id), 7, -3);
    const { vm } = await setup([SHUTTLE], v, staff);
    const group = vm.getAnchor(1)!;
    const anchors = vehicleSeatAnchors('travel_vehicle', 1);
    for (const f of vm.getSeatedFigures(1)) {
      expect(isDescendant(f.object, group)).toBe(true);
    }
    group.updateMatrixWorld(true);
    for (const f of vm.getSeatedFigures(1)) {
      const local = group.worldToLocal(f.object.getWorldPosition(new THREE.Vector3()));
      expect(local.x).toBeCloseTo(anchors[f.seat]!.x, 4);
      expect(local.z).toBeCloseTo(anchors[f.seat]!.z, 4);
    }
    vm.dispose();
  });

  it('keeps the seated pose when the vehicle turns: world positions follow the group', async () => {
    const staff = crew(2);
    const v = makeVehicle(1, 'travel_vehicle', 1, staff.map(e => e.id));
    const { vm } = await setup([SHUTTLE], v, staff);
    const group = vm.getAnchor(1)!;
    const anchors = vehicleSeatAnchors('travel_vehicle', 1);
    group.rotation.y = Math.PI / 2;
    group.position.set(20, 0, 10);
    group.updateMatrixWorld(true);
    for (const f of vm.getSeatedFigures(1)) {
      const local = group.worldToLocal(f.object.getWorldPosition(new THREE.Vector3()));
      expect(local.x).toBeCloseTo(anchors[f.seat]!.x, 4);
      expect(local.z).toBeCloseTo(anchors[f.seat]!.z, 4);
    }
    vm.dispose();
  });

  it('removes the figure of a passenger who leaves, on the next update', async () => {
    const staff = crew(3);
    const v = makeVehicle(1, 'travel_vehicle', 1, staff.map(e => e.id));
    const { vm } = await setup([SHUTTLE], v, staff);
    expect(vm.getSeatedFigures(1)).toHaveLength(3);
    v.occupantIds = [staff[0]!.id, staff[2]!.id];
    vm.update([v], stateOf([v]), staff, 0.1);
    const figures = vm.getSeatedFigures(1);
    expect(figures.map(f => f.employeeId).sort()).toEqual([staff[0]!.id, staff[2]!.id].sort());
    expect(figures).toHaveLength(2);
    vm.dispose();
  });

  it('detaches a departed passenger figure from the vehicle group', async () => {
    const staff = crew(2);
    const v = makeVehicle(1, 'travel_vehicle', 1, staff.map(e => e.id));
    const { vm } = await setup([SHUTTLE], v, staff);
    const group = vm.getAnchor(1)!;
    const gone = vm.getSeatedFigures(1).find(f => f.employeeId === staff[1]!.id)!;
    v.occupantIds = [staff[0]!.id];
    vm.update([v], stateOf([v]), staff, 0.1);
    expect(isDescendant(gone.object, group)).toBe(false);
    vm.dispose();
  });

  it('adds a figure when a passenger boards', async () => {
    const staff = crew(3);
    const v = makeVehicle(1, 'travel_vehicle', 1, [staff[0]!.id]);
    const { vm } = await setup([SHUTTLE], v, staff);
    expect(vm.getSeatedFigures(1)).toHaveLength(1);
    v.occupantIds = [staff[0]!.id, staff[1]!.id];
    vm.update([v], stateOf([v]), staff, 0.1);
    const figures = vm.getSeatedFigures(1);
    expect(figures).toHaveLength(2);
    expect(figures[1]!.employeeId).toBe(staff[1]!.id);
    expect(figures[1]!.seat).toBe(1);
    vm.dispose();
  });

  it('keeps the same figure object for the same occupant across updates', async () => {
    const staff = crew(2);
    const v = makeVehicle(1, 'travel_vehicle', 1, staff.map(e => e.id));
    const { vm } = await setup([SHUTTLE], v, staff);
    const before = vm.getSeatedFigures(1).map(f => f.object);
    vm.update([v], stateOf([v]), staff, 0.1);
    vm.update([v], stateOf([v]), staff, 0.1);
    const after = vm.getSeatedFigures(1).map(f => f.object);
    expect(after).toHaveLength(2);
    expect(after[0]!).toBe(before[0]!);
    expect(after[1]!).toBe(before[1]!);
    vm.dispose();
  });

  it('removeVehicle drops the figures', async () => {
    const staff = crew(2);
    const v = makeVehicle(1, 'travel_vehicle', 1, staff.map(e => e.id));
    const { vm } = await setup([SHUTTLE], v, staff);
    vm.removeVehicle(1);
    expect(vm.getSeatedFigures(1)).toEqual([]);
    vm.dispose();
  });

  it('clearAll drops the figures of every vehicle', async () => {
    const staff = crew(3);
    const a = makeVehicle(1, 'travel_vehicle', 1, [staff[0]!.id, staff[1]!.id]);
    const b = makeVehicle(2, 'travel_vehicle', 2, [staff[2]!.id], 10, 0);
    const library = await loadedModelLibrary([SHUTTLE, RACE_CAR, ...WORKERS]);
    const vm = new VehicleMesh(new THREE.Scene(), library);
    const vs = stateOf([a, b]);
    vm.addVehicle(a, vs, staff);
    vm.addVehicle(b, vs, staff);
    vm.update([a, b], vs, staff, 0.1);
    expect(vm.getSeatedFigures(1)).toHaveLength(2);
    expect(vm.getSeatedFigures(2)).toHaveLength(1);
    vm.clearAll();
    expect(vm.getSeatedFigures(1)).toEqual([]);
    expect(vm.getSeatedFigures(2)).toEqual([]);
    vm.dispose();
  });

  it('shows no figures in a vehicle without seat anchors, even with an occupant', async () => {
    const staff = crew(1);
    const v = makeVehicle(1, 'debris_hauler', 2, [staff[0]!.id]);
    const { vm } = await setup([HAULER], v, staff);
    expect(vm.getSeatedFigures(1)).toEqual([]);
    vm.dispose();
  });

  it('shows no figures while the vehicle is the stand-in box', async () => {
    const staff = crew(2);
    const v = makeVehicle(1, 'travel_vehicle', 1, staff.map(e => e.id));
    const library = await loadedModelLibrary(WORKERS);
    const vm = new VehicleMesh(new THREE.Scene(), library);
    vm.addVehicle(v, stateOf([v]), staff);
    vm.update([v], stateOf([v]), staff, 0.1);
    expect(vm.getInstance(1)!.isFallback).toBe(true);
    expect(vm.getSeatedFigures(1)).toEqual([]);
    vm.dispose();
  });

  it('shows the figures once the asset loads and the model is swapped in', async () => {
    const staff = crew(2);
    const v = makeVehicle(1, 'travel_vehicle', 1, staff.map(e => e.id));
    const library = new ModelLibrary();
    await loadModelsFromDisk(library, WORKERS);
    const vm = new VehicleMesh(new THREE.Scene(), library);
    vm.addVehicle(v, stateOf([v]), staff);
    vm.update([v], stateOf([v]), staff, 0.1);
    expect(vm.getSeatedFigures(1)).toEqual([]);
    await loadModelsFromDisk(library, [SHUTTLE]);
    vm.refreshModels(stateOf([v]), staff);
    vm.update([v], stateOf([v]), staff, 0.1);
    expect(vm.getSeatedFigures(1)).toHaveLength(2);
    vm.dispose();
  });
});
