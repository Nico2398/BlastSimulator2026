// CharacterMesh — unit tests

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { Employee } from '../../../src/core/entities/Employee.js';
import type { MovementTrail } from '../../../src/core/entities/MovementTrail.js';
import { CharacterMesh } from '../../../src/renderer/CharacterMesh.js';
import {
  GARMENT_COLORS, GARMENT_TINT, HAIR_COLORS, HAIR_TINT, paletteFor, ROLE_COLORS, ROLE_TINT, SKIN_TINT, SKIN_TONES,
} from '../../../src/renderer/CharacterMesh.js';
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
    locomotion: { kind: 'on_foot' },
    itinerary: null,
    vehicleWaitingTicks: 0,
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

  it('an evacuating worker is never hidden — his panic is the cue, not a strobe', async () => {
    const scene = new THREE.Scene();
    const cm = new CharacterMesh(scene, await loadedModelLibrary(['worker_driller']));
    const emp = makeEmployee(1);
    cm.addEmployee(emp);
    cm.setEvacuating(1, true);
    const gasp = cm.getInstance(1)!.node('Gasp')!;
    const rest = gasp.position.clone();
    for (let i = 0; i < 120; i++) {
      cm.update([emp], 1 / 60);
      expect(cm.getGroup(1)!.visible).toBe(true);
    }
    // The gaping mouth has come out of the skull.
    expect(gasp.position.distanceTo(rest)).toBeGreaterThan(0.02);
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

  // #1038: rendered Y must follow the same eased (x, z) as the X/Z glide,
  // never the last-synced target cell — otherwise an entity's feet belong to
  // a different terrain column than its body for the whole glide, and it
  // visibly steps/sinks/floats when crossing a slope.
  describe('heightAt — Y follows the eased render position on slopes (#1038)', () => {
    it('update(employees, dt, heightAt) resamples y to heightAt at the eased render position, not a stale synced value', () => {
      const scene = new THREE.Scene();
      const cm = new CharacterMesh(scene);
      const emp = makeEmployee(1, { x: 0, z: 0 });
      cm.addEmployee(emp, 0);
      const group = scene.children[0] as THREE.Group;

      emp.x = 10;
      emp.z = 0;
      const heightAt = (x: number, _z: number) => x * 2;

      cm.update([emp], 0.05, heightAt);

      // Mid-glide: eased x must sit strictly between 0 and 10, or this test
      // cannot distinguish "sampled at eased x" from "sampled at target x".
      expect(group.position.x).toBeGreaterThan(0);
      expect(group.position.x).toBeLessThan(10);
      expect(group.position.y).toBe(heightAt(group.position.x, group.position.z));
      cm.dispose();
    });

    it('resamples y from heightAt every call even for a stationary employee (post-blast terrain change under an idle entity)', () => {
      const scene = new THREE.Scene();
      const cm = new CharacterMesh(scene);
      const emp = makeEmployee(1, { x: 5, z: 5 });
      cm.addEmployee(emp, 0);
      const group = scene.children[0] as THREE.Group;

      // Converge the tween fully — a stationary employee, no target change.
      for (let i = 0; i < 30; i++) cm.update([emp], 0.05);
      expect(group.position.x).toBeCloseTo(5);
      expect(group.position.z).toBeCloseTo(5);

      // Terrain changed under the idle employee (e.g. a blast) between two
      // calls — heightAt now returns a different value at the same (x, z).
      let terrainY = 3;
      const heightAt = () => terrainY;
      cm.update([emp], 0.05, heightAt);
      expect(group.position.y).toBe(3);

      terrainY = 9;
      cm.update([emp], 0.05, heightAt);
      expect(group.position.y).toBe(9);
      cm.dispose();
    });

    it('omitting heightAt leaves y untouched by update(), exactly as before (backward-compat regression guard)', () => {
      const scene = new THREE.Scene();
      const cm = new CharacterMesh(scene);
      const emp = makeEmployee(1, { x: 0, z: 0 });
      cm.addEmployee(emp, 5); // surfaceY = 5

      cm.update([emp], 0.05); // no 3rd arg
      const group = scene.children[0] as THREE.Group;
      expect(group.position.y).toBe(5);
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

  it('draws the exported worker as a skinned character with the role tint and per-employee skin and hair tones', async () => {
    const scene = new THREE.Scene();
    const cm = new CharacterMesh(scene, await load());
    cm.addEmployee(makeEmployee(1, { role: 'manager' }));
    const inst = cm.getInstance(1)!;
    expect(inst.isFallback).toBe(false);
    expect(inst.skinned).toBe(true);
    for (const n of ['Hips', 'Head', 'HandL', 'ThighR', 'LidL']) expect(inst.node(n)).toBeInstanceOf(THREE.Bone);
    expect(inst.tints.get(ROLE_TINT)!.color.getHex()).toBe(ROLE_COLORS.manager);
    expect(inst.tints.get(GARMENT_TINT)!.color.getHex()).toBe(GARMENT_COLORS.manager);
    expect(inst.tints.get(SKIN_TINT)!.color.getHex()).toBe(paletteFor(1, SKIN_TONES, 1));
    expect(inst.tints.get(HAIR_TINT)!.color.getHex()).toBe(paletteFor(1, HAIR_COLORS, 2));
    cm.dispose();
  });

  it('spreads a crew across the skin and hair palettes, the same way every time', () => {
    const skins = new Set<number>();
    for (let id = 1; id <= 40; id++) {
      skins.add(paletteFor(id, SKIN_TONES, 1));
      expect(paletteFor(id, SKIN_TONES, 1)).toBe(paletteFor(id, SKIN_TONES, 1));
      expect(SKIN_TONES).toContain(paletteFor(id, SKIN_TONES, 1));
      expect(HAIR_COLORS).toContain(paletteFor(id, HAIR_COLORS, 2));
    }
    expect(skins.size).toBeGreaterThan(SKIN_TONES.length - 2);
  });

  /** Forward position of a bone relative to the hips, in the worker's own frame (he faces +X before yaw). */
  function forwardOfHips(group: THREE.Group, inst: ReturnType<CharacterMesh['getInstance']> & object, bone: string): number {
    group.updateMatrixWorld(true);
    const p = inst.node(bone)!.getWorldPosition(new THREE.Vector3());
    const h = inst.node('Hips')!.getWorldPosition(new THREE.Vector3());
    const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(group.quaternion);
    return p.sub(h).dot(fwd);
  }

  it('turns to face the direction of travel and walks in alternating strides, then settles into a standing idle', async () => {
    const scene = new THREE.Scene();
    const cm = new CharacterMesh(scene, await load());
    const emp = makeEmployee(1, { x: 0, z: 0 });
    cm.addEmployee(emp, 0);
    const group = cm.getGroup(1)!;
    const inst = cm.getInstance(1)!;

    // Walk toward +Z: the model faces +X at rest, so it must turn to -π/2.
    emp.z = 6;
    let minL = Infinity, maxL = -Infinity, opposed = 0, frames = 0;
    for (let i = 0; i < 50; i++) {
      cm.update([emp], 1 / 30);
      if (i < 15) continue;
      const l = forwardOfHips(group, inst, 'FootL');
      const r = forwardOfHips(group, inst, 'FootR');
      minL = Math.min(minL, l);
      maxL = Math.max(maxL, l);
      if (Math.abs(l - r) > 0.05) { frames++; if (Math.sign(l) !== Math.sign(r)) opposed++; }
    }
    expect(group.rotation.y).toBeCloseTo(-Math.PI / 2, 1);
    // A real stride: the foot travels well in front of and behind the hips…
    expect(maxL - minL).toBeGreaterThan(0.2);
    // …and the two feet are on opposite sides of the hips through the stride.
    expect(opposed / Math.max(1, frames)).toBeGreaterThan(0.6);

    // Arrived: the gait blends out; the feet come back under the hips (the free foot of a
    // weight-shifted stance rests a few centimetres forward, never a stride away).
    for (let i = 0; i < 90; i++) cm.update([emp], 1 / 30);
    expect(Math.abs(forwardOfHips(group, inst, 'FootL'))).toBeLessThan(0.08);
    expect(Math.abs(forwardOfHips(group, inst, 'FootR'))).toBeLessThan(0.08);
    expect(group.rotation.y).toBeCloseTo(-Math.PI / 2, 1);
    cm.dispose();
  });

  it('plays the role\'s work loop while a task ticks down: the driller braces the drill out in front', async () => {
    const scene = new THREE.Scene();
    const cm = new CharacterMesh(scene, await load());
    const emp = makeEmployee(1, { role: 'driller', taskTicksRemaining: 6 });
    cm.addEmployee(emp, 0);
    const group = cm.getGroup(1)!;
    const inst = cm.getInstance(1)!;
    const idleReach = forwardOfHips(group, inst, 'HandR');
    for (let i = 0; i < 45; i++) cm.update([emp], 1 / 30);
    expect(forwardOfHips(group, inst, 'HandR')).toBeGreaterThan(idleReach + 0.15);
    cm.dispose();
  });

  it('a collapsing worker ends up on the ground', async () => {
    const scene = new THREE.Scene();
    const cm = new CharacterMesh(scene, await load());
    const emp = makeEmployee(1, { collapsing: true, fatigue: 0 });
    cm.addEmployee(emp, 0);
    const inst = cm.getInstance(1)!;
    for (let i = 0; i < 90; i++) cm.update([emp], 1 / 30);
    cm.getGroup(1)!.updateMatrixWorld(true);
    expect(inst.node('Hips')!.getWorldPosition(new THREE.Vector3()).y).toBeLessThan(0.25);
    expect(inst.node('Head')!.getWorldPosition(new THREE.Vector3()).y).toBeLessThan(0.45);
    cm.dispose();
  });

  it('two idle workers do not breathe and glance in lockstep', async () => {
    const scene = new THREE.Scene();
    const cm = new CharacterMesh(scene, await load());
    const a = makeEmployee(1, { x: 0 });
    const b = makeEmployee(2, { x: 3 });
    cm.addEmployee(a, 0);
    cm.addEmployee(b, 0);
    for (let i = 0; i < 40; i++) cm.update([a, b], 1 / 30);
    const qa = cm.getInstance(1)!.node('Head')!.quaternion;
    const qb = cm.getInstance(2)!.node('Head')!.quaternion;
    expect(qa.angleTo(qb)).toBeGreaterThan(0.01);
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
    // The injury tint carries over to the real model: the garment goes red, the hat keeps the role colour.
    expect(inst.tints.get(GARMENT_TINT)!.color.getHex()).not.toBe(GARMENT_COLORS.driller);
    expect(inst.tints.get(ROLE_TINT)!.color.getHex()).toBe(ROLE_COLORS.driller);
    expect(cm.getGroup(1)!.children).toEqual([inst.root]);
    cm.dispose();
  });

  describe('walk trail (#1199)', () => {
    it('follows the recorded route round a corner rather than the straight chord', () => {
      const scene = new THREE.Scene();
      const cm = new CharacterMesh(scene);
      const emp = makeEmployee(1, { x: 0, z: 0 });
      cm.addEmployee(emp, 0);
      const group = cm.getGroup(1)!;

      emp.x = 4;
      emp.z = 4;
      emp.walkTrail = { points: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 4 }], relocated: false, hostMarkers: [] };
      cm.update([emp], MOVE_TWEEN_DURATION_S / 2);

      expect(group.position.x).toBeCloseTo(4);
      expect(group.position.z).toBeCloseTo(0);
      cm.dispose();
    });

    it('a relocation that is not a walk snaps to the new position', () => {
      const scene = new THREE.Scene();
      const cm = new CharacterMesh(scene);
      const emp = makeEmployee(1, { x: 0, z: 0 });
      cm.addEmployee(emp, 0);
      const group = cm.getGroup(1)!;

      emp.x = 3;
      emp.z = 2;
      emp.walkTrail = { points: [{ x: 3, z: 2 }], relocated: false, hostMarkers: [] };
      cm.update([emp], 0.01);

      expect(group.position.x).toBe(3);
      expect(group.position.z).toBe(2);
      cm.dispose();
    });
  });
});

// ── Delayed removal at the host marker / spawn at the exit marker (#1589) ───

function hostTrail(
  points: Array<[number, number]>,
  markers: Array<[number, 'board' | 'enter' | 'alight' | 'leave']>,
  hostX: number, hostZ: number,
): MovementTrail {
  return {
    points: points.map(([x, z]) => ({ x, z })),
    relocated: false,
    hostMarkers: markers.map(([pointIndex, event]) => ({
      pointIndex, event, hostKind: event === 'enter' || event === 'leave' ? 'building' : 'vehicle', hostX, hostZ,
    })),
  };
}

describe('CharacterMesh — retiring into a host (#1589)', () => {
  const boardTrail = () => hostTrail([[0, 0], [1, 0], [2, 0], [3, 0]], [[3, 'board']], 3, 0);

  it('keeps the mesh and reports isRetiring until the trail reaches the board marker', () => {
    const cm = new CharacterMesh(new THREE.Scene());
    const emp = makeEmployee(1, { x: 0, z: 0 });
    cm.addEmployee(emp, 0);
    expect(cm.isRetiring(1)).toBe(false);

    emp.x = 3;
    emp.z = 0;
    emp.walkTrail = boardTrail();
    cm.retireEmployee(emp);
    expect(cm.count).toBe(1);
    expect(cm.isRetiring(1)).toBe(true);

    cm.update([emp], MOVE_TWEEN_DURATION_S / 2);
    expect(cm.count).toBe(1);
    expect(cm.isRetiring(1)).toBe(true);
    const x = cm.getPosition(1)!.x;
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(3);
    cm.dispose();
  });

  it('removes the mesh once playback reaches the marker; isRetiring is false afterwards', () => {
    const cm = new CharacterMesh(new THREE.Scene());
    const emp = makeEmployee(1, { x: 0, z: 0 });
    cm.addEmployee(emp, 0);
    emp.x = 3;
    emp.walkTrail = boardTrail();
    cm.retireEmployee(emp);

    for (let i = 0; i < 40 && cm.count > 0; i++) cm.update([emp], 0.05);

    expect(cm.count).toBe(0);
    expect(cm.getPosition(1)).toBeNull();
    expect(cm.isRetiring(1)).toBe(false);
    cm.dispose();
  });

  it('never moves past the marker point while retiring', () => {
    const cm = new CharacterMesh(new THREE.Scene());
    const emp = makeEmployee(1, { x: 0, z: 0 });
    cm.addEmployee(emp, 0);
    emp.x = 3;
    emp.walkTrail = boardTrail();
    cm.retireEmployee(emp);
    for (let i = 0; i < 40 && cm.count > 0; i++) {
      cm.update([emp], 0.05);
      const p = cm.getPosition(1);
      if (p) expect(p.x).toBeLessThanOrEqual(3 + 1e-9);
    }
    cm.dispose();
  });

  it('an employee with no walkTrail is removed immediately', () => {
    const cm = new CharacterMesh(new THREE.Scene());
    const emp = makeEmployee(1, { x: 0, z: 0 });
    cm.addEmployee(emp, 0);
    cm.retireEmployee(emp);
    expect(cm.count).toBe(0);
    expect(cm.isRetiring(1)).toBe(false);
    cm.dispose();
  });

  it('a relocated trail is removed immediately (nothing to walk)', () => {
    const cm = new CharacterMesh(new THREE.Scene());
    const emp = makeEmployee(1, { x: 0, z: 0 });
    cm.addEmployee(emp, 0);
    emp.walkTrail = { ...boardTrail(), relocated: true };
    cm.retireEmployee(emp);
    expect(cm.count).toBe(0);
    cm.dispose();
  });

  it('retiring an employee that has no mesh is a harmless no-op', () => {
    const cm = new CharacterMesh(new THREE.Scene());
    const emp = makeEmployee(1, { x: 0, z: 0 });
    emp.walkTrail = boardTrail();
    expect(() => cm.retireEmployee(emp)).not.toThrow();
    expect(cm.count).toBe(0);
    expect(cm.isRetiring(1)).toBe(false);
    cm.dispose();
  });

  it('removeEmployee drops a retiring mesh at once', () => {
    const cm = new CharacterMesh(new THREE.Scene());
    const emp = makeEmployee(1, { x: 0, z: 0 });
    cm.addEmployee(emp, 0);
    emp.x = 3;
    emp.walkTrail = boardTrail();
    cm.retireEmployee(emp);
    cm.removeEmployee(1);
    expect(cm.count).toBe(0);
    expect(cm.isRetiring(1)).toBe(false);
    cm.dispose();
  });

  it('clearAll clears retiring entries', () => {
    const cm = new CharacterMesh(new THREE.Scene());
    const emp = makeEmployee(1, { x: 0, z: 0 });
    cm.addEmployee(emp, 0);
    emp.x = 3;
    emp.walkTrail = boardTrail();
    cm.retireEmployee(emp);
    cm.clearAll();
    expect(cm.count).toBe(0);
    expect(cm.isRetiring(1)).toBe(false);
    cm.dispose();
  });

  it('isRetiring is false for an unknown id', () => {
    const cm = new CharacterMesh(new THREE.Scene());
    expect(cm.isRetiring(99)).toBe(false);
    cm.dispose();
  });
});

describe('CharacterMesh — spawning at the exit marker (#1589)', () => {
  it('addEmployee with an alight trail starts at the marker point, not at the employee position', () => {
    const cm = new CharacterMesh(new THREE.Scene());
    const emp = makeEmployee(1, { x: 8, z: 0 });
    emp.walkTrail = hostTrail([[2, 0], [5, 0], [8, 0]], [[0, 'alight']], 2, 0);
    cm.addEmployee(emp, 0, emp.walkTrail);
    const p = cm.getPosition(1)!;
    expect(p.x).toBeCloseTo(2, 9);
    expect(p.z).toBeCloseTo(0, 9);
    cm.dispose();
  });

  it('then walks the post-marker points to the employee position and stays there', () => {
    const cm = new CharacterMesh(new THREE.Scene());
    const emp = makeEmployee(1, { x: 4, z: 3 });
    emp.walkTrail = hostTrail([[2, 0], [4, 0], [4, 3]], [[0, 'leave']], 2, 0);
    cm.addEmployee(emp, 0, emp.walkTrail);
    for (let i = 0; i < 10; i++) {
      cm.update([emp], 0.05);
      const p = cm.getPosition(1)!;
      // Always on the polyline (2,0)->(4,0)->(4,3): never cutting the corner.
      const onLeg1 = Math.abs(p.z) < 1e-9 && p.x >= 2 - 1e-9 && p.x <= 4 + 1e-9;
      const onLeg2 = Math.abs(p.x - 4) < 1e-9 && p.z >= -1e-9 && p.z <= 3 + 1e-9;
      expect(onLeg1 || onLeg2).toBe(true);
    }
    for (let i = 0; i < 30; i++) cm.update([emp], 0.05);
    const end = cm.getPosition(1)!;
    expect(end.x).toBeCloseTo(4, 9);
    expect(end.z).toBeCloseTo(3, 9);
    cm.dispose();
  });

  it('without a trail it still spawns at the employee position (unchanged)', () => {
    const cm = new CharacterMesh(new THREE.Scene());
    cm.addEmployee(makeEmployee(1, { x: 6, z: 7 }), 0);
    const p = cm.getPosition(1)!;
    expect(p.x).toBe(6);
    expect(p.z).toBe(7);
    cm.dispose();
  });

  it('a trail with no exit marker spawns at the employee position', () => {
    const cm = new CharacterMesh(new THREE.Scene());
    const emp = makeEmployee(1, { x: 6, z: 7 });
    emp.walkTrail = hostTrail([[5, 7], [6, 7]], [], 0, 0);
    cm.addEmployee(emp, 0, emp.walkTrail);
    expect(cm.getPosition(1)!.x).toBe(6);
    cm.dispose();
  });
});

describe('CharacterMesh — board then alight in one batch (#1589)', () => {
  it('hides the mesh between the spans without deleting it, then shows it at the end', () => {
    const cm = new CharacterMesh(new THREE.Scene());
    const emp = makeEmployee(1, { x: 0, z: 0 });
    cm.addEmployee(emp, 0);
    emp.x = 5;
    emp.walkTrail = hostTrail(
      [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0]],
      [[2, 'board'], [4, 'alight']], 2, 0,
    );
    let sawHidden = false;
    for (let i = 0; i < 60; i++) {
      cm.update([emp], 0.05);
      expect(cm.count).toBe(1);
      if (!cm.getGroup(1)!.visible) sawHidden = true;
    }
    expect(sawHidden).toBe(true);
    expect(cm.getGroup(1)!.visible).toBe(true);
    expect(cm.getPosition(1)!.x).toBeCloseTo(5, 9);
    cm.dispose();
  });
});
