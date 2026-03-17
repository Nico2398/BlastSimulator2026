// CharacterMesh — unit tests

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { Employee } from '../../../src/core/entities/Employee.js';
import { CharacterMesh } from '../../../src/renderer/CharacterMesh.js';

function makeEmployee(id: number, overrides: Partial<Employee> = {}): Employee {
  return {
    id, name: `Worker ${id}`,
    role: 'driller',
    salary: 3000, morale: 80,
    unionized: false, injured: false, alive: true,
    x: id * 2, z: 0,
    ...overrides,
  };
}

describe('CharacterMesh', () => {
  it('addEmployee adds a group with 3 children (body + head + hat)', () => {
    const scene = new THREE.Scene();
    const cm = new CharacterMesh(scene);
    cm.addEmployee(makeEmployee(1));
    const group = scene.children[0] as THREE.Group;
    expect(group.children.length).toBe(3);
    cm.dispose();
  });

  it('all employee roles can be added', () => {
    const scene = new THREE.Scene();
    const cm = new CharacterMesh(scene);
    const roles: Employee['role'][] = ['driller', 'blaster', 'driver', 'surveyor', 'manager'];
    roles.forEach((role, i) => cm.addEmployee(makeEmployee(i, { role })));
    expect(cm.count).toBe(roles.length);
    cm.dispose();
  });

  it('injured employee has different body color', () => {
    const scene = new THREE.Scene();
    const cm = new CharacterMesh(scene);
    cm.addEmployee(makeEmployee(1, { role: 'driller', injured: false }));
    cm.addEmployee(makeEmployee(2, { role: 'driller', injured: true }));

    const g1 = scene.children[0] as THREE.Group;
    const g2 = scene.children[1] as THREE.Group;
    const c1 = (g1.children[0] as THREE.Mesh).material as THREE.MeshPhongMaterial;
    const c2 = (g2.children[0] as THREE.Mesh).material as THREE.MeshPhongMaterial;
    // Injured should be darker/more red
    expect(c2.color.getHex()).not.toBe(c1.color.getHex());
    cm.dispose();
  });

  it('update lerps character position', () => {
    const scene = new THREE.Scene();
    const cm = new CharacterMesh(scene);
    const emp = makeEmployee(1, { x: 0, z: 0 });
    cm.addEmployee(emp);

    emp.x = 50;
    emp.z = 50;
    cm.update([emp], 0.016);
    cm.update([emp], 0.016);

    const group = scene.children[0] as THREE.Group;
    expect(group.position.x).toBeGreaterThan(0);
    expect(group.position.z).toBeGreaterThan(0);
    cm.dispose();
  });

  it('setEvacuating makes character blink after time update', () => {
    const scene = new THREE.Scene();
    const cm = new CharacterMesh(scene);
    const emp = makeEmployee(1);
    cm.addEmployee(emp);
    cm.setEvacuating(1, true);
    // After update with enough time, visibility state may change
    // Just verify no crash and visibility eventually becomes false
    let anyInvisible = false;
    for (let i = 0; i < 120; i++) {
      cm.update([emp], 1 / 60);
      const group = scene.children[0] as THREE.Group;
      if (!group.visible) anyInvisible = true;
    }
    expect(anyInvisible).toBe(true);
    cm.dispose();
  });

  it('removeEmployee removes from scene', () => {
    const scene = new THREE.Scene();
    const cm = new CharacterMesh(scene);
    cm.addEmployee(makeEmployee(1));
    cm.addEmployee(makeEmployee(2));
    cm.removeEmployee(1);
    expect(scene.children.length).toBe(1);
    cm.dispose();
  });

  it('clearAll removes all characters', () => {
    const scene = new THREE.Scene();
    const cm = new CharacterMesh(scene);
    cm.addEmployee(makeEmployee(1));
    cm.addEmployee(makeEmployee(2));
    cm.clearAll();
    expect(scene.children.length).toBe(0);
    cm.dispose();
  });
});
