// CharacterMesh — unit tests

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { Employee } from '../../../src/core/entities/Employee.js';
import { CharacterMesh } from '../../../src/renderer/CharacterMesh.js';
import { ROLE_COLORS, ROLE_TINT } from '../../../src/renderer/CharacterMesh.js';
import { loadedModelLibrary } from '../../helpers/models.js';
import { MOVE_TWEEN_DURATION_S } from '../../../src/renderer/MovementInterpolation.js';

function makeEmployee(id: number, overrides: Partial<Employee> = {}): Employee {
  return {
    id, name: `Worker ${id}`,
    role: 'driller',
    salary: 3000, morale: 80,
    unionized: false, injured: false, alive: true,
    x: id * 2, z: 0,
    qualifications: [],
    trainingState: null,
    activeActionId: null,
    fatigue: 100,
    collapsing: false,
    interruptedActionPayload: null,
    ticksWorked: 0,
    restTicksRemaining: null,
    restNeedKey: null,
    taskTicksRemaining: null,
    activeTaskSkill: null,
    destinationX: null,
    destinationZ: null,
    moveConsecutiveFailures: 0,
    isMoveStuck: false,
    pendingRestDuration: null,
    pendingRestNeedKey: null,
    pendingTaskDuration: null,
    pendingActionType: null,
    pendingActionPayload: null,
    pendingDriverVehicleId: null,
    taskQueue: [],
    ...overrides,
  };
}

describe('CharacterMesh', () => {
  it('addEmployee adds a group holding the worker model (a stand-in box until the asset is loaded)', () => {
    const scene = new THREE.Scene();
    const cm = new CharacterMesh(scene);
    cm.addEmployee(makeEmployee(1));
    const group = scene.children[0] as THREE.Group;
    const instance = cm.getInstance(1)!;
    expect(group.children).toEqual([instance.root]);
    expect(instance.root.name).toBe('worker_driller');
    expect(instance.isFallback).toBe(true);
    expect(instance.tints.get(ROLE_TINT)!.color.getHex()).toBe(ROLE_COLORS.driller);
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

    const c1 = cm.getInstance(1)!.tints.get(ROLE_TINT)!;
    const c2 = cm.getInstance(2)!.tints.get(ROLE_TINT)!;
    // Injured should be darker/more red
    expect(c2.color.getHex()).not.toBe(c1.color.getHex());
    expect(c1.color.getHex()).toBe(ROLE_COLORS.driller);
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

  it('snapPosition sets the group position immediately, bypassing the lerp', () => {
    const scene = new THREE.Scene();
    const cm = new CharacterMesh(scene);
    cm.addEmployee(makeEmployee(1, { x: 0, z: 0 }), 0);

    cm.snapPosition(1, 10, 3, 20);

    const group = scene.children[0] as THREE.Group;
    expect(group.position.x).toBe(10);
    expect(group.position.y).toBe(3);
    expect(group.position.z).toBe(20);
    cm.dispose();
  });

  it('snapPosition on an unknown id is a no-op', () => {
    const scene = new THREE.Scene();
    const cm = new CharacterMesh(scene);
    cm.addEmployee(makeEmployee(1, { x: 0, z: 0 }), 0);

    expect(() => cm.snapPosition(999, 10, 3, 20)).not.toThrow();
    const group = scene.children[0] as THREE.Group;
    expect(group.position.x).toBe(0);
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

  it('setEvacuating(false) restores visibility immediately', () => {
    const scene = new THREE.Scene();
    const cm = new CharacterMesh(scene);
    const emp = makeEmployee(1);
    cm.addEmployee(emp);
    cm.setEvacuating(1, true);
    cm.setEvacuating(1, false);
    const group = scene.children[0] as THREE.Group;
    expect(group.visible).toBe(true);
    cm.dispose();
  });

  it('setEvacuating on an unknown id is a no-op', () => {
    const scene = new THREE.Scene();
    const cm = new CharacterMesh(scene);
    cm.addEmployee(makeEmployee(1));
    expect(() => cm.setEvacuating(999, true)).not.toThrow();
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

  describe('movement interpolation (#520)', () => {
    it('update() eases across multiple small-dt frames, passing through an intermediate point, and fully converges only once cumulative real time matches the tween duration', () => {
      const scene = new THREE.Scene();
      const cm = new CharacterMesh(scene);
      const emp = makeEmployee(1, { x: 0, z: 0 });
      cm.addEmployee(emp, 0);
      const group = scene.children[0] as THREE.Group;

      emp.x = 10;
      emp.z = 10;

      const dt = 0.05;
      const steps = Math.ceil(MOVE_TWEEN_DURATION_S / dt) + 5;
      let sawIntermediate = false;
      for (let i = 0; i < steps; i++) {
        cm.update([emp], dt);
        if (
          group.position.x > 0 && group.position.x < 10 &&
          group.position.z > 0 && group.position.z < 10
        ) {
          sawIntermediate = true;
        }
      }

      expect(sawIntermediate).toBe(true);
      // Not just "greater than 0" — cumulative real time (steps * dt) now
      // exceeds MOVE_TWEEN_DURATION_S, so a duration-aware ease must have
      // fully arrived. A fixed-fraction-per-call lerp (duration-blind)
      // never reaches this close after only ~1s of real time.
      expect(group.position.x).toBeCloseTo(10);
      expect(group.position.z).toBeCloseTo(10);
      cm.dispose();
    });

    it('retargeting mid-glide does not produce a large single-frame jump', () => {
      const scene = new THREE.Scene();
      const cm = new CharacterMesh(scene);
      const emp = makeEmployee(1, { x: 0, z: 0 });
      cm.addEmployee(emp, 0);
      const group = scene.children[0] as THREE.Group;

      emp.x = 10;
      emp.z = 10;
      cm.update([emp], 0.05); // glide partway

      const beforeX = group.position.x;
      const beforeZ = group.position.z;

      // Retarget completely before convergence.
      emp.x = -20;
      emp.z = 40;
      cm.update([emp], 0.05);

      const jump = Math.hypot(group.position.x - beforeX, group.position.z - beforeZ);
      // Linear interpolation (#948): no smoothstep taper near a fresh
      // retarget, so the jump is (dt/durationS) * distanceToNewTarget with
      // nothing to shrink it. Bounded by MOVE_TELEPORT_DISTANCE (60) — a
      // larger distance snaps instead of gliding — giving 0.05 * 60 = 3 for
      // this test's dt/duration.
      expect(jump).toBeLessThan(3);
      cm.dispose();
    });

    it('a very large x/z change reaches the new position within one update() call (snap path)', () => {
      const scene = new THREE.Scene();
      const cm = new CharacterMesh(scene);
      const emp = makeEmployee(1, { x: 0, z: 0 });
      cm.addEmployee(emp, 0);
      const group = scene.children[0] as THREE.Group;

      // Magnitude far exceeding any single-tick move (teleport across the map).
      emp.x = 500;
      emp.z = -500;
      cm.update([emp], 0.016);

      expect(group.position.x).toBeCloseTo(500);
      expect(group.position.z).toBeCloseTo(-500);
      cm.dispose();
    });

    it('setSurfaceY updates only the y component, leaving x/z untouched', () => {
      const scene = new THREE.Scene();
      const cm = new CharacterMesh(scene);
      cm.addEmployee(makeEmployee(1, { x: 4, z: 9 }), 0);
      const group = scene.children[0] as THREE.Group;
      const xBefore = group.position.x;
      const zBefore = group.position.z;

      cm.setSurfaceY(1, 7);

      expect(group.position.y).toBe(7);
      expect(group.position.x).toBe(xBefore);
      expect(group.position.z).toBe(zBefore);
      cm.dispose();
    });
  });

  describe('scene picking (P2)', () => {
    it('pickables() returns one tagged object per employee', () => {
      const scene = new THREE.Scene();
      const cm = new CharacterMesh(scene);
      cm.addEmployee(makeEmployee(1));
      cm.addEmployee(makeEmployee(2));
      const pickables = cm.pickables();
      expect(pickables).toHaveLength(2);
      expect(pickables.map(o => o.userData['entityId']).sort()).toEqual([1, 2]);
      expect(pickables.every(o => o.userData['entityKind'] === 'employee')).toBe(true);
      cm.dispose();
    });

    it('getPosition() returns the employee group world position', () => {
      const scene = new THREE.Scene();
      const cm = new CharacterMesh(scene);
      cm.addEmployee(makeEmployee(1, { x: 9, z: 4 }));
      const pos = cm.getPosition(1);
      expect(pos?.x).toBeCloseTo(9);
      expect(pos?.z).toBeCloseTo(4);
      cm.dispose();
    });

    it('getPosition() returns null for an id that was never added', () => {
      const scene = new THREE.Scene();
      const cm = new CharacterMesh(scene);
      expect(cm.getPosition(999)).toBeNull();
      cm.dispose();
    });
  });

  describe('getGroup() — billboard anchor for overlays (#546)', () => {
    it('returns the same Group added to the scene for a rendered employee', () => {
      const scene = new THREE.Scene();
      const cm = new CharacterMesh(scene);
      cm.addEmployee(makeEmployee(1));

      const group = cm.getGroup(1);
      expect(group).toBe(scene.children[0]);
      cm.dispose();
    });

    it('returns null for an id that was never added', () => {
      const scene = new THREE.Scene();
      const cm = new CharacterMesh(scene);
      cm.addEmployee(makeEmployee(1));

      expect(cm.getGroup(999)).toBeNull();
      cm.dispose();
    });

    it('an object parented under getGroup(id) tracks the interpolated tween position automatically', () => {
      const scene = new THREE.Scene();
      const cm = new CharacterMesh(scene);
      const emp = makeEmployee(1, { x: 0, z: 0 });
      cm.addEmployee(emp, 0);

      const group = cm.getGroup(1);
      expect(group).not.toBeNull();
      const indicator = new THREE.Object3D();
      group!.add(indicator);

      emp.x = 10;
      emp.z = 10;
      // Partial tween step (dt well under MOVE_TWEEN_DURATION_S), matching
      // the existing "update() eases across multiple small-dt frames" test.
      cm.update([emp], 0.05);

      const groupPos = group!.position.clone();
      const indicatorWorldPos = new THREE.Vector3();
      indicator.getWorldPosition(indicatorWorldPos);

      // The tween must have actually moved the group off the origin for this
      // to be a meaningful check (otherwise both sides trivially agree at 0).
      expect(groupPos.x).toBeGreaterThan(0);
      expect(indicatorWorldPos.x).toBeCloseTo(groupPos.x);
      expect(indicatorWorldPos.z).toBeCloseTo(groupPos.z);
      cm.dispose();
    });
  });
});

describe('CharacterMesh — model animation (real assets)', () => {
  const load = () => loadedModelLibrary(['worker_driller', 'worker_manager']);

  it('draws the exported worker with its six pivot nodes and the role tint', async () => {
    const scene = new THREE.Scene();
    const cm = new CharacterMesh(scene, await load());
    cm.addEmployee(makeEmployee(1, { role: 'manager' }));
    const inst = cm.getInstance(1)!;
    expect(inst.isFallback).toBe(false);
    for (const n of ['Head', 'Torso', 'ArmL', 'ArmR', 'LegL', 'LegR']) expect(inst.node(n)).not.toBeNull();
    expect(inst.tints.get(ROLE_TINT)!.color.getHex()).toBe(ROLE_COLORS.manager);
    cm.dispose();
  });

  it('turns to face the direction of travel and swings legs and arms while walking, then settles at rest', async () => {
    const scene = new THREE.Scene();
    const cm = new CharacterMesh(scene, await load());
    const emp = makeEmployee(1, { x: 0, z: 0 });
    cm.addEmployee(emp, 0);
    const group = cm.getGroup(1)!;
    const inst = cm.getInstance(1)!;
    const legL = inst.node('LegL')!;
    const armL = inst.node('ArmL')!;

    // Walk toward +Z: the model faces +X at rest, so it must turn to -π/2.
    emp.z = 4;
    let maxSwing = 0;
    for (let i = 0; i < 20; i++) {
      cm.update([emp], 0.05);
      maxSwing = Math.max(maxSwing, Math.abs(legL.rotation.z));
    }
    expect(group.rotation.y).toBeCloseTo(-Math.PI / 2, 1);
    expect(maxSwing).toBeGreaterThan(0.1);
    // Arms counter-swing the legs.
    expect(Math.sign(armL.rotation.z)).toBe(-Math.sign(legL.rotation.z));

    // Arrived: the gait blends out and the limbs return to rest.
    for (let i = 0; i < 40; i++) cm.update([emp], 0.05);
    expect(legL.rotation.z).toBeCloseTo(0, 5);
    expect(armL.rotation.z).toBeCloseTo(0, 5);
    expect(inst.root.position.y).toBeCloseTo(0, 5);
    cm.dispose();
  });

  it('refreshModels swaps a stand-in for the real model once the library has it', async () => {
    const library = await loadedModelLibrary([]);
    const scene = new THREE.Scene();
    const cm = new CharacterMesh(scene, library);
    cm.addEmployee(makeEmployee(1, { role: 'driller', injured: true }));
    expect(cm.getInstance(1)!.isFallback).toBe(true);
    cm.refreshModels(); // nothing loaded yet — still the stand-in
    expect(cm.getInstance(1)!.isFallback).toBe(true);
    const loaded = await loadedModelLibrary(['worker_driller']);
    library.register('worker_driller', (loaded as unknown as { prototypes: Map<string, never> })['prototypes'].get('worker_driller')!);
    cm.refreshModels();
    const inst = cm.getInstance(1)!;
    expect(inst.isFallback).toBe(false);
    expect(inst.node('Head')).not.toBeNull();
    // The injury tint carries over to the real model.
    expect(inst.tints.get(ROLE_TINT)!.color.getHex()).not.toBe(ROLE_COLORS.driller);
    expect(cm.getGroup(1)!.children).toEqual([inst.root]);
    cm.dispose();
  });
});
