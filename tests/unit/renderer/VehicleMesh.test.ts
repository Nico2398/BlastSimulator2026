// VehicleMesh — unit tests

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { Vehicle } from '../../../src/core/entities/Vehicle.js';
import { VehicleMesh } from '../../../src/renderer/VehicleMesh.js';

function makeVehicle(id: number, type: Vehicle['type'], x = 0, z = 0): Vehicle {
  return { id, type, x, z, hp: 100, task: 'idle', targetX: x, targetZ: z };
}

describe('VehicleMesh', () => {
  it('addVehicle adds group to scene', () => {
    const scene = new THREE.Scene();
    const vm = new VehicleMesh(scene);
    vm.addVehicle(makeVehicle(1, 'truck'));
    expect(scene.children.length).toBe(1);
    expect(vm.count).toBe(1);
    vm.dispose();
  });

  it('all vehicle types can be added', () => {
    const scene = new THREE.Scene();
    const vm = new VehicleMesh(scene);
    const types: Vehicle['type'][] = ['truck', 'excavator', 'drill_rig', 'bulldozer'];
    types.forEach((t, i) => vm.addVehicle(makeVehicle(i, t, i * 5, 0)));
    expect(vm.count).toBe(4);
    vm.dispose();
  });

  it('vehicles have multiple children (composed shapes)', () => {
    const scene = new THREE.Scene();
    const vm = new VehicleMesh(scene);
    const types: Vehicle['type'][] = ['truck', 'excavator', 'drill_rig', 'bulldozer'];
    for (const type of types) {
      vm.addVehicle(makeVehicle(0, type));
      const group = scene.children[0] as THREE.Group;
      expect(group.children.length).toBeGreaterThan(1); // multi-part shapes
      vm.clearAll();
    }
    vm.dispose();
  });

  it('update lerps vehicle toward new position', () => {
    const scene = new THREE.Scene();
    const vm = new VehicleMesh(scene);
    const v = makeVehicle(1, 'truck', 0, 0);
    vm.addVehicle(v);

    // Move vehicle target far away
    v.x = 100;
    v.z = 100;

    // After a few updates, position should move toward target
    vm.update([v]);
    vm.update([v]);
    vm.update([v]);
    const group = scene.children[0] as THREE.Group;
    expect(group.position.x).toBeGreaterThan(0);
    expect(group.position.z).toBeGreaterThan(0);
    vm.dispose();
  });

  it('snapPosition moves vehicle immediately', () => {
    const scene = new THREE.Scene();
    const vm = new VehicleMesh(scene);
    vm.addVehicle(makeVehicle(1, 'bulldozer', 0, 0));
    vm.snapPosition(1, 50, 75);
    const group = scene.children[0] as THREE.Group;
    expect(group.position.x).toBeCloseTo(50);
    expect(group.position.z).toBeCloseTo(75);
    vm.dispose();
  });

  it('removeVehicle removes specific mesh', () => {
    const scene = new THREE.Scene();
    const vm = new VehicleMesh(scene);
    vm.addVehicle(makeVehicle(1, 'truck'));
    vm.addVehicle(makeVehicle(2, 'excavator'));
    vm.removeVehicle(1);
    expect(scene.children.length).toBe(1);
    expect(vm.count).toBe(1);
    vm.dispose();
  });

  it('clearAll removes all vehicles', () => {
    const scene = new THREE.Scene();
    const vm = new VehicleMesh(scene);
    vm.addVehicle(makeVehicle(1, 'truck'));
    vm.addVehicle(makeVehicle(2, 'drill_rig'));
    vm.clearAll();
    expect(scene.children.length).toBe(0);
    vm.dispose();
  });
});
