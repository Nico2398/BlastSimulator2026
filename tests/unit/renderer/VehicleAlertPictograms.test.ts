// VehicleAlertPictograms — unit tests (#2226)
// A broken or stuck vehicle shows a camera-facing pictogram (a billboard plane, not a sphere) above it;
// every other status shows none.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { VehicleAlertPictograms, vehicleAlertKindFor } from '../../../src/renderer/VehicleAlertPictograms.js';
import type { Vehicle, VehicleState } from '../../../src/core/entities/Vehicle.js';
import type { Employee } from '../../../src/core/entities/Employee.js';
import { hireEmployee, createEmployeeState } from '../../../src/core/entities/Employee.js';
import type { VehicleStatusKind } from '../../../src/core/entities/VehicleStatus.js';
import { Random } from '../../../src/core/math/Random.js';

const ALL_KINDS: VehicleStatusKind[] = ['idle', 'moving', 'working', 'waiting', 'hauling', 'stuck', 'broken'];

describe('vehicleAlertKindFor', () => {
  it('maps broken to broken', () => {
    expect(vehicleAlertKindFor('broken')).toBe('broken');
  });

  it('maps stuck to stuck', () => {
    expect(vehicleAlertKindFor('stuck')).toBe('stuck');
  });

  it('maps every other status to null', () => {
    for (const kind of ALL_KINDS.filter(k => k !== 'broken' && k !== 'stuck')) {
      expect(vehicleAlertKindFor(kind), kind).toBeNull();
    }
  });
});

let nextEmployeeId = 1;

function makeVehicle(id: number, hp = 100): Vehicle {
  return { id, type: 'debris_hauler', tier: 1, x: 0, z: 0, hp, cargo: [], occupantIds: [] };
}

function makeState(vehicles: Vehicle[]): VehicleState {
  return { vehicles, nextId: vehicles.length + 1, driverBoardingCount: 0, reservations: [] };
}

function occupy(vehicle: Vehicle, overrides: Partial<Employee> = {}): Employee {
  const id = nextEmployeeId++;
  const { employee } = hireEmployee(createEmployeeState(), 'driller', new Random(id), 0, 0);
  employee.id = id;
  Object.assign(employee, { locomotion: { kind: 'mounted', vehicleId: vehicle.id } }, overrides);
  vehicle.occupantIds = [id];
  return employee;
}

/** A vehicle in the given status, with the employees that derive it. */
function fixtureFor(id: number, kind: VehicleStatusKind): { vehicle: Vehicle; employees: Employee[] } {
  const vehicle = makeVehicle(id, kind === 'broken' ? 0 : 100);
  const employees: Employee[] = [];
  switch (kind) {
    case 'stuck': employees.push(occupy(vehicle, { isMoveStuck: true, moveConsecutiveFailures: 9 })); break;
    case 'waiting': employees.push(occupy(vehicle, { vehicleWaitingTicks: 5 })); break;
    case 'working': employees.push(occupy(vehicle, { taskTicksRemaining: 5, activeTaskTotalTicks: 10 })); break;
    case 'moving':
      employees.push(occupy(vehicle, {
        itinerary: {
          legs: [{ mode: 'drive', vehicleId: id, destX: 9, destZ: 9, arrival: 'exact', onArrive: { kind: 'none' }, estTicks: 5 }],
          goal: { kind: 'reposition', x: 9, z: 9 }, workTicks: 0, estTotalTicks: 5,
        },
      }));
      break;
    case 'idle': employees.push(occupy(vehicle)); break;
    case 'broken': employees.push(occupy(vehicle, { isMoveStuck: true })); break; // broken pre-empts stuck
    case 'hauling': break; // needs a reservation; built by the caller
  }
  return { vehicle, employees };
}

function makeCamera(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.5, 4000);
  camera.quaternion.setFromEuler(new THREE.Euler(-0.5, 0.9, 0.1));
  return camera;
}

function meshesUnder(object: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  object.traverse(c => { if ((c as THREE.Mesh).isMesh) out.push(c as THREE.Mesh); });
  return out;
}

function setup() {
  const scene = new THREE.Scene();
  const camera = makeCamera();
  const pictograms = new VehicleAlertPictograms(scene, camera);
  const anchors = new Map<number, THREE.Group>();
  const anchorOf = (id: number): THREE.Group => {
    let a = anchors.get(id);
    if (!a) { a = new THREE.Group(); scene.add(a); anchors.set(id, a); }
    return a;
  };
  const getAnchor = (id: number): THREE.Object3D | null => anchors.get(id) ?? null;
  return { scene, camera, pictograms, anchorOf, getAnchor };
}

describe('VehicleAlertPictograms', () => {
  for (const kind of ['broken', 'stuck'] as const) {
    it(`shows one pictogram above a ${kind} vehicle, parented under its anchor`, () => {
      const { pictograms, anchorOf, getAnchor } = setup();
      const { vehicle, employees } = fixtureFor(1, kind);
      const anchor = anchorOf(1);

      pictograms.sync([vehicle], makeState([vehicle]), employees, getAnchor);

      expect(pictograms.count).toBe(1);
      expect(meshesUnder(anchor).length).toBeGreaterThan(0);
      pictograms.dispose();
    });

    it(`the ${kind} pictogram is a billboard plane, not a sphere, above the vehicle`, () => {
      const { pictograms, anchorOf, getAnchor } = setup();
      const { vehicle, employees } = fixtureFor(1, kind);
      const anchor = anchorOf(1);

      pictograms.sync([vehicle], makeState([vehicle]), employees, getAnchor);

      const meshes = meshesUnder(anchor);
      expect(meshes.some(m => m.geometry instanceof THREE.PlaneGeometry)).toBe(true);
      expect(meshes.some(m => m.geometry instanceof THREE.SphereGeometry)).toBe(false);
      anchor.updateMatrixWorld(true);
      const plane = meshes.find(m => m.geometry instanceof THREE.PlaneGeometry)!;
      expect(plane.getWorldPosition(new THREE.Vector3()).y).toBeGreaterThan(0);
      pictograms.dispose();
    });

    it(`update() turns the ${kind} pictogram to face the camera, whatever the anchor's heading`, () => {
      const { pictograms, camera, anchorOf, getAnchor } = setup();
      const { vehicle, employees } = fixtureFor(1, kind);
      const anchor = anchorOf(1);
      anchor.rotation.y = 2.3;
      pictograms.sync([vehicle], makeState([vehicle]), employees, getAnchor);

      pictograms.update(0.016);

      anchor.updateMatrixWorld(true);
      const plane = meshesUnder(anchor).find(m => m.geometry instanceof THREE.PlaneGeometry)!;
      const worldQuat = plane.getWorldQuaternion(new THREE.Quaternion());
      expect(worldQuat.angleTo(camera.quaternion)).toBeLessThan(1e-4);
      pictograms.dispose();
    });
  }

  it('shows none for idle, moving, waiting, working or hauling vehicles', () => {
    for (const kind of ['idle', 'moving', 'waiting', 'working', 'hauling'] as const) {
      const { pictograms, anchorOf, getAnchor } = setup();
      const { vehicle, employees } = fixtureFor(1, kind);
      const state = makeState([vehicle]);
      if (kind === 'hauling') {
        employees.push(occupy(vehicle));
        state.reservations.push({ vehicleId: 1, actionId: 1 });
      }
      const anchor = anchorOf(1);

      pictograms.sync([vehicle], state, employees, getAnchor);

      expect(pictograms.count, kind).toBe(0);
      expect(meshesUnder(anchor), kind).toHaveLength(0);
      pictograms.dispose();
    }
  });

  it('a driverless healthy vehicle shows none, a driverless broken one shows one', () => {
    const { pictograms, anchorOf, getAnchor } = setup();
    const healthy = makeVehicle(1);
    const broken = makeVehicle(2, 0);
    anchorOf(1); anchorOf(2);

    pictograms.sync([healthy, broken], makeState([healthy, broken]), [], getAnchor);

    expect(pictograms.count).toBe(1);
    expect(meshesUnder(anchorOf(1))).toHaveLength(0);
    expect(meshesUnder(anchorOf(2)).length).toBeGreaterThan(0);
    pictograms.dispose();
  });

  it('removes the pictogram when the status changes away from broken', () => {
    const { pictograms, anchorOf, getAnchor } = setup();
    const vehicle = makeVehicle(1, 0);
    const anchor = anchorOf(1);
    pictograms.sync([vehicle], makeState([vehicle]), [], getAnchor);
    expect(pictograms.count).toBe(1);

    vehicle.hp = 100;
    pictograms.sync([vehicle], makeState([vehicle]), [], getAnchor);

    expect(pictograms.count).toBe(0);
    expect(meshesUnder(anchor)).toHaveLength(0);
    pictograms.dispose();
  });

  it('swaps the pictogram when a stuck vehicle breaks, leaving exactly one', () => {
    const { pictograms, anchorOf, getAnchor } = setup();
    const { vehicle, employees } = fixtureFor(1, 'stuck');
    const anchor = anchorOf(1);
    pictograms.sync([vehicle], makeState([vehicle]), employees, getAnchor);
    const stuckMeshes = meshesUnder(anchor).length;
    expect(pictograms.count).toBe(1);

    vehicle.hp = 0;
    pictograms.sync([vehicle], makeState([vehicle]), employees, getAnchor);

    expect(pictograms.count).toBe(1);
    expect(meshesUnder(anchor)).toHaveLength(stuckMeshes);
    pictograms.dispose();
  });

  it('repeated syncs of a steady alert do not stack pictograms', () => {
    const { pictograms, anchorOf, getAnchor } = setup();
    const vehicle = makeVehicle(1, 0);
    const anchor = anchorOf(1);
    pictograms.sync([vehicle], makeState([vehicle]), [], getAnchor);
    const first = meshesUnder(anchor).length;

    pictograms.sync([vehicle], makeState([vehicle]), [], getAnchor);
    pictograms.sync([vehicle], makeState([vehicle]), [], getAnchor);

    expect(pictograms.count).toBe(1);
    expect(meshesUnder(anchor)).toHaveLength(first);
    pictograms.dispose();
  });

  it('sweeps a vehicle removed from the roster', () => {
    const { pictograms, anchorOf, getAnchor } = setup();
    const vehicle = makeVehicle(1, 0);
    const anchor = anchorOf(1);
    pictograms.sync([vehicle], makeState([vehicle]), [], getAnchor);
    expect(pictograms.count).toBe(1);

    pictograms.sync([], makeState([]), [], getAnchor);

    expect(pictograms.count).toBe(0);
    expect(meshesUnder(anchor)).toHaveLength(0);
    pictograms.dispose();
  });

  it('shows nothing for a vehicle whose anchor is missing, and shows it once the anchor appears', () => {
    const { pictograms, anchorOf, getAnchor } = setup();
    const vehicle = makeVehicle(1, 0);

    pictograms.sync([vehicle], makeState([vehicle]), [], getAnchor);
    expect(pictograms.count).toBe(0);

    const anchor = anchorOf(1);
    pictograms.sync([vehicle], makeState([vehicle]), [], getAnchor);
    expect(pictograms.count).toBe(1);
    expect(meshesUnder(anchor).length).toBeGreaterThan(0);
    pictograms.dispose();
  });

  it('gives each alerting vehicle its own pictogram under its own anchor', () => {
    const { pictograms, anchorOf, getAnchor } = setup();
    const a = makeVehicle(1, 0);
    const b = makeVehicle(2, 0);
    const c = makeVehicle(3, 100);
    anchorOf(1); anchorOf(2); anchorOf(3);

    pictograms.sync([a, b, c], makeState([a, b, c]), [], getAnchor);

    expect(pictograms.count).toBe(2);
    expect(meshesUnder(anchorOf(1)).length).toBeGreaterThan(0);
    expect(meshesUnder(anchorOf(2)).length).toBeGreaterThan(0);
    expect(meshesUnder(anchorOf(3))).toHaveLength(0);
    pictograms.dispose();
  });

  it('clearAll() removes every pictogram but the instance stays usable', () => {
    const { pictograms, anchorOf, getAnchor } = setup();
    const vehicle = makeVehicle(1, 0);
    const anchor = anchorOf(1);
    pictograms.sync([vehicle], makeState([vehicle]), [], getAnchor);

    pictograms.clearAll();

    expect(pictograms.count).toBe(0);
    expect(meshesUnder(anchor)).toHaveLength(0);
    pictograms.sync([vehicle], makeState([vehicle]), [], getAnchor);
    expect(pictograms.count).toBe(1);
    pictograms.dispose();
  });

  it('dispose() leaves nothing behind', () => {
    const { pictograms, anchorOf, getAnchor } = setup();
    const vehicle = makeVehicle(1, 0);
    const anchor = anchorOf(1);
    pictograms.sync([vehicle], makeState([vehicle]), [], getAnchor);

    pictograms.dispose();

    expect(pictograms.count).toBe(0);
    expect(meshesUnder(anchor)).toHaveLength(0);
  });

  it('update() with nothing to show is a no-op', () => {
    const { pictograms } = setup();
    expect(() => pictograms.update(0.016)).not.toThrow();
    expect(pictograms.count).toBe(0);
    pictograms.dispose();
  });
});
