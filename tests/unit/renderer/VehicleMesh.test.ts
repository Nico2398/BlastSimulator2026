// VehicleMesh — unit tests

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { Vehicle, VehicleTier, VehicleState } from '../../../src/core/entities/Vehicle.js';
import type { Employee } from '../../../src/core/entities/Employee.js';
import { hireEmployee, createEmployeeState } from '../../../src/core/entities/Employee.js';
import { Random } from '../../../src/core/math/Random.js';
import { VehicleMesh, BODY_TINT } from '../../../src/renderer/VehicleMesh.js';
import type { VehicleStatusKind } from '../../../src/core/entities/VehicleStatus.js';
import { WAITING_QUEUE_SLOT_OFFSETS } from '../../../src/core/config/balance.js';
import { MOVE_TWEEN_DURATION_S } from '../../../src/renderer/MovementInterpolation.js';
import { CharacterMesh } from '../../../src/renderer/CharacterMesh.js';
import { MOVEMENT_TRAIL_MAX_POINTS, type MovementTrail, type TrailHostEvent, type TrailPoint } from '../../../src/core/entities/MovementTrail.js';
import { loadedModelLibrary } from '../../helpers/models.js';

function makeVehicle(id: number, type: Vehicle['type'], x = 0, z = 0, tier = 1 as VehicleTier, hp = 100): Vehicle {
  return { id, type, tier, x, z, hp, cargo: [], occupantIds: [] };
}

/** #1138: addVehicle/update/refreshModels take a VehicleState now, not a raw Vehicle[]. */
function makeVehicleState(vehicles: Vehicle[] = []): VehicleState {
  return { vehicles, nextId: vehicles.length + 1, driverBoardingCount: 0, reservations: [] };
}

let _nextEmployeeId = 1;

/**
 * A driving-employee fixture, mounted into `vehicle` (occupantIds[0]) — the
 * status/waiting-queue derivation this whole file now needs since Vehicle
 * itself carries no display state (#1138). ids are forced unique across
 * every fixture in this file, since each hireEmployee call starts a fresh
 * throwaway EmployeeState (ids always begin at 1).
 */
function makeOccupant(vehicle: Vehicle, overrides: Partial<Employee> = {}): Employee {
  const id = _nextEmployeeId++;
  const { employee } = hireEmployee(createEmployeeState(), 'driller', new Random(id), vehicle.x, vehicle.z);
  employee.id = id;
  Object.assign(employee, overrides);
  vehicle.occupantIds = [employee.id];
  return employee;
}

/** An occupant whose driving employee is waiting on occupancy toward (destX, destZ). */
function makeWaitingOccupant(vehicle: Vehicle, destX: number, destZ: number, waitingTicks = 5): Employee {
  return makeOccupant(vehicle, {
    vehicleWaitingTicks: waitingTicks,
    itinerary: {
      legs: [{ mode: 'drive', vehicleId: vehicle.id, destX, destZ, arrival: 'exact', onArrive: { kind: 'none' }, estTicks: 5 }],
      goal: { kind: 'reposition', x: destX, z: destZ },
      workTicks: 0,
      estTotalTicks: 5,
    },
  });
}

/** An occupant whose driving employee is mid-task (computeVehicleStatus's 'working' branch). */
function makeWorkingOccupant(vehicle: Vehicle): Employee {
  return makeOccupant(vehicle, { taskTicksRemaining: 5, itinerary: null });
}

describe('VehicleMesh', () => {
  it('addVehicle adds group to scene', () => {
    const scene = new THREE.Scene();
    const vm = new VehicleMesh(scene);
    const v = makeVehicle(1, 'debris_hauler');
    vm.addVehicle(v, makeVehicleState([v]), []);
    expect(scene.children.length).toBe(1);
    expect(vm.count).toBe(1);
    vm.dispose();
  });

  it('all vehicle roles can be added', () => {
    const scene = new THREE.Scene();
    const vm = new VehicleMesh(scene);
    const types: Vehicle['type'][] = ['debris_hauler', 'rock_digger', 'drill_rig', 'building_destroyer', 'rock_fragmenter', 'charging_truck'];
    const vehicles = types.map((t, i) => makeVehicle(i, t, i * 5, 0));
    const vs = makeVehicleState(vehicles);
    vehicles.forEach(v => vm.addVehicle(v, vs, []));
    expect(vm.count).toBe(6);
    vm.dispose();
  });

  it('vehicles have multiple children (composed shapes)', () => {
    const scene = new THREE.Scene();
    const vm = new VehicleMesh(scene);
    const types: Vehicle['type'][] = ['debris_hauler', 'rock_digger', 'drill_rig', 'building_destroyer', 'rock_fragmenter', 'charging_truck'];
    for (const type of types) {
      const v = makeVehicle(0, type);
      vm.addVehicle(v, makeVehicleState([v]), []);
      const group = scene.children[0] as THREE.Group;
      expect(group.children.length).toBeGreaterThan(1); // multi-part shapes
      vm.clearAll();
    }
    vm.dispose();
  });

  it('update lerps vehicle toward new position', () => {
    const scene = new THREE.Scene();
    const vm = new VehicleMesh(scene);
    const v = makeVehicle(1, 'debris_hauler', 0, 0);
    vm.addVehicle(v, makeVehicleState([v]), []);

    // Move vehicle target far away
    v.x = 100;
    v.z = 100;

    // After a few updates, position should move toward target
    // (dt now required — VehicleMesh.update() must become duration-aware, #520)
    const vs = makeVehicleState([v]);
    vm.update([v], vs, [], 0.1);
    vm.update([v], vs, [], 0.1);
    vm.update([v], vs, [], 0.1);
    const group = scene.children[0] as THREE.Group;
    expect(group.position.x).toBeGreaterThan(0);
    expect(group.position.z).toBeGreaterThan(0);
    vm.dispose();
  });

  it('snapPosition moves vehicle immediately', () => {
    const scene = new THREE.Scene();
    const vm = new VehicleMesh(scene);
    const v = makeVehicle(1, 'building_destroyer', 0, 0);
    vm.addVehicle(v, makeVehicleState([v]), []);
    vm.snapPosition(1, 50, 0, 75);
    const group = scene.children[0] as THREE.Group;
    expect(group.position.x).toBeCloseTo(50);
    expect(group.position.z).toBeCloseTo(75);
    vm.dispose();
  });

  it('removeVehicle removes specific mesh', () => {
    const scene = new THREE.Scene();
    const vm = new VehicleMesh(scene);
    const v1 = makeVehicle(1, 'debris_hauler');
    const v2 = makeVehicle(2, 'rock_digger');
    const vs = makeVehicleState([v1, v2]);
    vm.addVehicle(v1, vs, []);
    vm.addVehicle(v2, vs, []);
    vm.removeVehicle(1);
    expect(scene.children.length).toBe(1);
    expect(vm.count).toBe(1);
    vm.dispose();
  });

  it('clearAll removes all vehicles', () => {
    const scene = new THREE.Scene();
    const vm = new VehicleMesh(scene);
    const v1 = makeVehicle(1, 'debris_hauler');
    const v2 = makeVehicle(2, 'drill_rig');
    const vs = makeVehicleState([v1, v2]);
    vm.addVehicle(v1, vs, []);
    vm.addVehicle(v2, vs, []);
    vm.clearAll();
    expect(scene.children.length).toBe(0);
    vm.dispose();
  });
});

describe('VehicleMesh — movement interpolation (#520)', () => {
  it('update() eases across multiple small-dt frames, passing through an intermediate point, and fully converges only once cumulative real time matches the tween duration', () => {
    const scene = new THREE.Scene();
    const vm = new VehicleMesh(scene);
    const v = makeVehicle(1, 'debris_hauler', 0, 0);
    vm.addVehicle(v, makeVehicleState([v]), []);
    const group = scene.children[0] as THREE.Group;

    v.x = 10;
    v.z = 10;
    const vs = makeVehicleState([v]);

    const dt = 0.05;
    const steps = Math.ceil(MOVE_TWEEN_DURATION_S / dt) + 5;
    let sawIntermediate = false;
    for (let i = 0; i < steps; i++) {
      vm.update([v], vs, [], dt);
      if (
        group.position.x > 0 && group.position.x < 10 &&
        group.position.z > 0 && group.position.z < 10
      ) {
        sawIntermediate = true;
      }
    }

    expect(sawIntermediate).toBe(true);
    expect(group.position.x).toBeCloseTo(10);
    expect(group.position.z).toBeCloseTo(10);
    vm.dispose();
  });

  it('retargeting mid-glide does not produce a large single-frame jump', () => {
    const scene = new THREE.Scene();
    const vm = new VehicleMesh(scene);
    const v = makeVehicle(1, 'debris_hauler', 0, 0);
    vm.addVehicle(v, makeVehicleState([v]), []);
    const group = scene.children[0] as THREE.Group;

    v.x = 10;
    v.z = 10;
    vm.update([v], makeVehicleState([v]), [], 0.05); // glide partway

    const beforeX = group.position.x;
    const beforeZ = group.position.z;

    // Retarget completely before convergence.
    v.x = -20;
    v.z = 40;
    vm.update([v], makeVehicleState([v]), [], 0.05);

    const jump = Math.hypot(group.position.x - beforeX, group.position.z - beforeZ);
    // Linear interpolation (#948): no smoothstep taper near a fresh
    // retarget, so the jump is (dt/durationS) * distanceToNewTarget with
    // nothing to shrink it. Bounded by MOVE_TELEPORT_DISTANCE (60) — a
    // larger distance snaps instead of gliding — giving 0.05 * 60 = 3 for
    // this test's dt/duration.
    expect(jump).toBeLessThan(3);
    vm.dispose();
  });

  it('a very large x/z change reaches the new position within one update() call (snap path)', () => {
    const scene = new THREE.Scene();
    const vm = new VehicleMesh(scene);
    const v = makeVehicle(1, 'debris_hauler', 0, 0);
    vm.addVehicle(v, makeVehicleState([v]), []);
    const group = scene.children[0] as THREE.Group;

    // Magnitude far exceeding any single-tick move (teleport across the map).
    v.x = 500;
    v.z = -500;
    vm.update([v], makeVehicleState([v]), [], 0.016);

    expect(group.position.x).toBeCloseTo(500);
    expect(group.position.z).toBeCloseTo(-500);
    vm.dispose();
  });

  it('setSurfaceY updates only the y component, leaving x/z untouched', () => {
    const scene = new THREE.Scene();
    const vm = new VehicleMesh(scene);
    const v = makeVehicle(1, 'debris_hauler', 4, 9);
    vm.addVehicle(v, makeVehicleState([v]), []);
    const group = scene.children[0] as THREE.Group;
    const xBefore = group.position.x;
    const zBefore = group.position.z;

    vm.setSurfaceY(1, 7);

    expect(group.position.y).toBe(7);
    expect(group.position.x).toBe(xBefore);
    expect(group.position.z).toBe(zBefore);
    vm.dispose();
  });
});

// #1038: rendered Y must follow the same eased (x, z) as the X/Z glide,
// never the last-synced target cell — otherwise a vehicle's wheels belong to
// a different terrain column than its body for the whole glide, and it
// visibly steps/sinks/floats when crossing a slope. Mirrors the CharacterMesh
// coverage — vehicles must behave the same as employees.
describe('VehicleMesh — heightAt follows the eased render position on slopes (#1038)', () => {
  it('update(vehicles, vehicleState, employees, dt, heightAt) resamples y to heightAt at the eased render position, not a stale synced value', () => {
    const scene = new THREE.Scene();
    const vm = new VehicleMesh(scene);
    const v = makeVehicle(1, 'debris_hauler', 0, 0);
    vm.addVehicle(v, makeVehicleState([v]), [], 0);
    const group = scene.children[0] as THREE.Group;

    v.x = 10;
    v.z = 0;
    const heightAt = (x: number, _z: number) => x * 2;

    vm.update([v], makeVehicleState([v]), [], 0.05, heightAt);

    // Mid-glide: eased x must sit strictly between 0 and 10, or this test
    // cannot distinguish "sampled at eased x" from "sampled at target x".
    expect(group.position.x).toBeGreaterThan(0);
    expect(group.position.x).toBeLessThan(10);
    expect(group.position.y).toBe(heightAt(group.position.x, group.position.z));
    vm.dispose();
  });

  it('resamples y from heightAt every call even for a stationary vehicle (post-blast terrain change under an idle entity)', () => {
    const scene = new THREE.Scene();
    const vm = new VehicleMesh(scene);
    const v = makeVehicle(1, 'debris_hauler', 5, 5);
    vm.addVehicle(v, makeVehicleState([v]), [], 0);
    const group = scene.children[0] as THREE.Group;

    // Converge the tween fully — a stationary vehicle, no target change.
    for (let i = 0; i < 30; i++) vm.update([v], makeVehicleState([v]), [], 0.05);
    expect(group.position.x).toBeCloseTo(5);
    expect(group.position.z).toBeCloseTo(5);

    // Terrain changed under the idle vehicle (e.g. a blast) between two
    // calls — heightAt now returns a different value at the same (x, z).
    let terrainY = 3;
    const heightAt = () => terrainY;
    vm.update([v], makeVehicleState([v]), [], 0.05, heightAt);
    expect(group.position.y).toBe(3);

    terrainY = 9;
    vm.update([v], makeVehicleState([v]), [], 0.05, heightAt);
    expect(group.position.y).toBe(9);
    vm.dispose();
  });

  it('omitting heightAt leaves y untouched by update(), exactly as before (backward-compat regression guard)', () => {
    const scene = new THREE.Scene();
    const vm = new VehicleMesh(scene);
    const v = makeVehicle(1, 'debris_hauler', 0, 0);
    vm.addVehicle(v, makeVehicleState([v]), [], 5); // surfaceY = 5

    vm.update([v], makeVehicleState([v]), [], 0.05); // no heightAt arg
    const group = scene.children[0] as THREE.Group;
    expect(group.position.y).toBe(5);
    vm.dispose();
  });
});

// ── Tiers: each tier is its own model asset, drawn at model scale ────────────
// Role used throughout: debris_hauler. No runtime scaling or tinting shift
// stands in for tier any more — the tier-1 junk heap and the tier-3 monster
// are different .glb files, so a library holding only the tier-2 asset draws
// tier 2 for real and the other two as stand-ins.

describe('VehicleMesh — tier picks the model asset', () => {
  it('draws the tier whose asset is loaded and a stand-in for the others, all at unit scale', async () => {
    const library = await loadedModelLibrary(['vehicle_debris_hauler_t2']);
    const scene = new THREE.Scene();
    const vm = new VehicleMesh(scene, library);
    const vehicles = [
      makeVehicle(1, 'debris_hauler', 0, 0, 1),
      makeVehicle(2, 'debris_hauler', 4, 0, 2),
      makeVehicle(3, 'debris_hauler', 8, 0, 3),
    ];
    const vs = makeVehicleState(vehicles);
    vehicles.forEach(v => vm.addVehicle(v, vs, []));
    expect(vm.getInstance(1)!.isFallback).toBe(true);
    expect(vm.getInstance(2)!.isFallback).toBe(false);
    expect(vm.getInstance(3)!.isFallback).toBe(true);
    for (const group of scene.children) expect((group as THREE.Group).scale.x).toBe(1);
    vm.dispose();
  });

  it('keeps the model\'s own paint colour at every tier', () => {
    const scene = new THREE.Scene();
    const vm = new VehicleMesh(scene);
    const vehicles = [makeVehicle(1, 'debris_hauler', 0, 0, 1), makeVehicle(2, 'debris_hauler', 4, 0, 3)];
    const vs = makeVehicleState(vehicles);
    vehicles.forEach(v => vm.addVehicle(v, vs, []));
    const c1 = vm.getInstance(1)!.tints.get(BODY_TINT)!.color;
    const c3 = vm.getInstance(2)!.tints.get(BODY_TINT)!.color;
    expect(c1.getHex()).toBe(c3.getHex());
    vm.dispose();
  });
});

// ── Issue #2226: no sphere floats above a vehicle ──────────────────────────
// The state-colour sphere (#411) is gone: a vehicle group carries no sphere in any status. Broken and stuck
// show a camera-facing pictogram instead (VehicleAlertPictograms.test.ts); working shows the task bar
// (TaskProgressBar.test.ts).

describe('VehicleMesh — no state-indicator sphere (#2226)', () => {
  const ALL_KINDS: VehicleStatusKind[] = ['idle', 'moving', 'working', 'waiting', 'broken', 'stuck', 'hauling'];

  /** One vehicle plus the occupant that derives `kind` through computeVehicleStatus. */
  function fixtureFor(kind: VehicleStatusKind): { v: Vehicle; vs: VehicleState; employees: Employee[] } {
    const v = makeVehicle(1, 'debris_hauler', 0, 0, 1 as VehicleTier, kind === 'broken' ? 0 : 100);
    const vs = makeVehicleState([v]);
    const employees: Employee[] = [];
    if (kind === 'stuck') employees.push(makeOccupant(v, { isMoveStuck: true, moveConsecutiveFailures: 9 }));
    if (kind === 'waiting') employees.push(makeWaitingOccupant(v, 5, 5));
    if (kind === 'working') employees.push(makeWorkingOccupant(v));
    if (kind === 'moving') employees.push(makeOccupant(v, {
      itinerary: {
        legs: [{ mode: 'drive', vehicleId: v.id, destX: 9, destZ: 9, arrival: 'exact', onArrive: { kind: 'none' }, estTicks: 5 }],
        goal: { kind: 'reposition', x: 9, z: 9 }, workTicks: 0, estTotalTicks: 5,
      },
    }));
    if (kind === 'hauling') {
      const w = makeOccupant(v, {});
      employees.push(w);
      vs.reservations.push({ vehicleId: v.id, actionId: 1 });
    }
    if (kind === 'idle') employees.push(makeOccupant(v, {}));
    return { v, vs, employees };
  }

  /** Every mesh under `object` whose geometry is a sphere. */
  function spheresUnder(object: THREE.Object3D): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    object.traverse(c => {
      if ((c as THREE.Mesh).isMesh && (c as THREE.Mesh).geometry instanceof THREE.SphereGeometry) out.push(c as THREE.Mesh);
    });
    return out;
  }

  it('no longer exports STATE_COLOR_MAP or applyStateIndicator', async () => {
    const mod = await import('../../../src/renderer/VehicleMesh.js');
    expect(mod).not.toHaveProperty('STATE_COLOR_MAP');
    expect(mod).not.toHaveProperty('applyStateIndicator');
  });

  for (const kind of ALL_KINDS) {
    it(`addVehicle leaves no sphere under a ${kind} vehicle`, () => {
      const scene = new THREE.Scene();
      const vm = new VehicleMesh(scene);
      const { v, vs, employees } = fixtureFor(kind);
      vm.addVehicle(v, vs, employees);
      expect(spheresUnder(scene)).toHaveLength(0);
      vm.dispose();
    });

    it(`update leaves no sphere under a ${kind} vehicle`, () => {
      const scene = new THREE.Scene();
      const vm = new VehicleMesh(scene);
      const { v, vs, employees } = fixtureFor(kind);
      vm.addVehicle(v, vs, employees);
      vm.update([v], vs, employees, 0.1);
      vm.update([v], vs, employees, 0.1);
      expect(spheresUnder(scene)).toHaveLength(0);
      vm.dispose();
    });
  }

  it('a status change through update never adds a sphere (idle -> working -> broken)', () => {
    const scene = new THREE.Scene();
    const vm = new VehicleMesh(scene);
    const v = makeVehicle(1, 'drill_rig');
    const vs = makeVehicleState([v]);
    vm.addVehicle(v, vs, []);
    const worker = makeWorkingOccupant(v);
    vm.update([v], vs, [worker], 0.1);
    expect(spheresUnder(scene)).toHaveLength(0);
    v.hp = 0;
    vm.update([v], vs, [worker], 0.1);
    expect(spheresUnder(scene)).toHaveLength(0);
    vm.dispose();
  });

  it('no vehicle child carries the legacy isStateIndicator tag', () => {
    const scene = new THREE.Scene();
    const vm = new VehicleMesh(scene);
    const { v, vs, employees } = fixtureFor('working');
    vm.addVehicle(v, vs, employees);
    let tagged = 0;
    scene.traverse(c => { if (c.userData['isStateIndicator']) tagged++; });
    expect(tagged).toBe(0);
    vm.dispose();
  });

  it('every role stays free of spheres, fallback model included', () => {
    const scene = new THREE.Scene();
    const vm = new VehicleMesh(scene);
    const types: Vehicle['type'][] = ['debris_hauler', 'rock_digger', 'drill_rig', 'building_destroyer', 'rock_fragmenter', 'charging_truck'];
    const vehicles = types.map((t, i) => makeVehicle(i + 1, t, i * 5, 0));
    const vs = makeVehicleState(vehicles);
    vehicles.forEach(v => vm.addVehicle(v, vs, []));
    expect(spheresUnder(scene)).toHaveLength(0);
    vm.dispose();
  });
});

describe('VehicleMesh.getAnchor (#2226)', () => {
  it('returns the vehicle root group, the same object added to the scene', () => {
    const scene = new THREE.Scene();
    const vm = new VehicleMesh(scene);
    const v = makeVehicle(7, 'rock_digger', 3, 4);
    vm.addVehicle(v, makeVehicleState([v]), []);
    const anchor = vm.getAnchor(7);
    expect(anchor).not.toBeNull();
    expect(scene.children).toContain(anchor);
    vm.dispose();
  });

  it('returns null for an id that was never added', () => {
    const scene = new THREE.Scene();
    const vm = new VehicleMesh(scene);
    expect(vm.getAnchor(99)).toBeNull();
    vm.dispose();
  });

  it('returns null after the vehicle is removed', () => {
    const scene = new THREE.Scene();
    const vm = new VehicleMesh(scene);
    const v = makeVehicle(7, 'rock_digger');
    vm.addVehicle(v, makeVehicleState([v]), []);
    vm.removeVehicle(7);
    expect(vm.getAnchor(7)).toBeNull();
    vm.dispose();
  });

  it('distinguishes two vehicles', () => {
    const scene = new THREE.Scene();
    const vm = new VehicleMesh(scene);
    const a = makeVehicle(1, 'drill_rig');
    const b = makeVehicle(2, 'debris_hauler', 5, 5);
    const vs = makeVehicleState([a, b]);
    vm.addVehicle(a, vs, []);
    vm.addVehicle(b, vs, []);
    expect(vm.getAnchor(1)).not.toBe(vm.getAnchor(2));
    vm.dispose();
  });
});

// ── Issue #411: waitingQueueOffset / waitingRenderPosition ─────────────────
// Rewritten across 3 bug-fix rounds (idle-occupant slot collision, offset
// anchored to the shared target rather than each vehicle's own raw x/z), and
// again for #1138: "waiting" is no longer a Vehicle-native state — it is
// re-derived from the driving employee's own vehicleWaitingTicks and current
// drive leg. The "an idle vehicle already sitting at the target claims slot
// 0" carve-out (round 3) is dropped entirely along with Vehicle.state — see
// VehicleWaitingQueue.ts's own #1138 doc comment — so that dedicated test is
// removed rather than rewritten against a mechanism that no longer exists.

describe('waitingQueueOffset / waitingRenderPosition (#411, #1138)', () => {
  it('a vehicle with no waiting occupant renders at its own unoffset position', () => {
    const scene = new THREE.Scene();
    const vm = new VehicleMesh(scene);

    const idle = makeVehicle(1, 'debris_hauler', 10, 10, 1);
    const pool = [idle];

    expect(vm.waitingQueueOffset(idle, pool, [])).toEqual([0, 0]);
    expect(vm.waitingRenderPosition(idle, pool, [])).toEqual([10, 10]);

    vm.dispose();
  });

  it('a single waiting vehicle gets no offset (needs >=2 sharing a target to matter)', () => {
    const scene = new THREE.Scene();
    const vm = new VehicleMesh(scene);

    const waiting = makeVehicle(1, 'debris_hauler', 5, 5, 1);
    const driver = makeWaitingOccupant(waiting, 10, 10);
    const pool = [waiting];

    expect(vm.waitingQueueOffset(waiting, pool, [driver])).toEqual([0, 0]);

    vm.dispose();
  });

  it('waiting vehicles anchor to the shared drive target, not their own raw x/z (round 4 regression)', () => {
    const scene = new THREE.Scene();
    const vm = new VehicleMesh(scene);

    // Two vehicles converging on the same target from very different raw
    // positions — the bug this guards against added the offset to each
    // vehicle's own x/z, scattering them instead of anchoring to the target.
    const v1 = makeVehicle(1, 'debris_hauler', 1, 1, 1);
    const d1 = makeWaitingOccupant(v1, 20, 20);
    const v2 = makeVehicle(2, 'debris_hauler', 40, 45, 1);
    const d2 = makeWaitingOccupant(v2, 20, 20);

    const pool = [v1, v2];
    const employees = [d1, d2];

    const [o1x, o1z] = WAITING_QUEUE_SLOT_OFFSETS[0]!;
    const [o2x, o2z] = WAITING_QUEUE_SLOT_OFFSETS[1]!;

    expect(vm.waitingRenderPosition(v1, pool, employees)).toEqual([20 + o1x, 20 + o1z]);
    expect(vm.waitingRenderPosition(v2, pool, employees)).toEqual([20 + o2x, 20 + o2z]);

    vm.dispose();
  });

  it('4 waiting vehicles sharing a target get distinct slots at least one slot-spacing apart', () => {
    const scene = new THREE.Scene();
    const vm = new VehicleMesh(scene);

    const vehicles = [1, 2, 3, 4].map(id => makeVehicle(id, 'debris_hauler', id, id, 1));
    const employees = vehicles.map(v => makeWaitingOccupant(v, 50, 50));

    const positions = vehicles.map(v => vm.waitingRenderPosition(v, vehicles, employees));

    // sharingTarget is ascending-id order, so vehicle at array index i gets
    // WAITING_QUEUE_SLOT_OFFSETS[i] — derive the expected minimum spacing
    // from the real constant, not a hardcoded value.
    const usedOffsets = [0, 1, 2, 3].map(i => WAITING_QUEUE_SLOT_OFFSETS[i]!);
    const pairwiseOffsetDistances = usedOffsets.flatMap((a, i) =>
      usedOffsets.slice(i + 1).map(b => Math.hypot(a[0] - b[0], a[1] - b[1])),
    );
    const minExpectedDistance = Math.min(...pairwiseOffsetDistances);
    expect(minExpectedDistance).toBeGreaterThan(0);

    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const [ax, az] = positions[i]!;
        const [bx, bz] = positions[j]!;
        const dist = Math.hypot(ax - bx, az - bz);
        expect(dist).toBeGreaterThanOrEqual(minExpectedDistance);
      }
    }

    vm.dispose();
  });

  it('slot index wraps around via modulo when contenders exceed WAITING_QUEUE_SLOT_OFFSETS.length', () => {
    const scene = new THREE.Scene();
    const vm = new VehicleMesh(scene);

    // One more contender than there are slots — current implementation is
    // `sharingTarget.indexOf(id) % WAITING_QUEUE_SLOT_OFFSETS.length`, so the
    // (length + 1)th vehicle (index === length) wraps back to slot 0.
    const count = WAITING_QUEUE_SLOT_OFFSETS.length + 1;
    const vehicles = Array.from({ length: count }, (_, i) => makeVehicle(i + 1, 'debris_hauler', i, i, 1));
    const employees = vehicles.map(v => makeWaitingOccupant(v, 5, 5));

    const firstOffset = vm.waitingQueueOffset(vehicles[0]!, vehicles, employees);
    const wrappedOffset = vm.waitingQueueOffset(vehicles[vehicles.length - 1]!, vehicles, employees);

    expect(wrappedOffset).toEqual(firstOffset);
    expect(wrappedOffset).toEqual(WAITING_QUEUE_SLOT_OFFSETS[0]);

    vm.dispose();
  });

  it('a driverless vehicle sharing the exact cell of waiting vehicles never counts toward their shared-target slotting', () => {
    const scene = new THREE.Scene();
    const vm = new VehicleMesh(scene);

    const driverless = makeVehicle(1, 'drill_rig', 20, 20, 1); // no occupant at all
    const v1 = makeVehicle(2, 'debris_hauler', 1, 1, 1);
    const d1 = makeWaitingOccupant(v1, 20, 20);
    const v2 = makeVehicle(3, 'debris_hauler', 40, 45, 1);
    const d2 = makeWaitingOccupant(v2, 20, 20);

    const pool = [driverless, v1, v2];
    const employees = [d1, d2];

    // driverless never resolves a drive target — [0, 0], no slot claimed.
    expect(vm.waitingQueueOffset(driverless, pool, employees)).toEqual([0, 0]);
    // Only v1/v2 share a target — same 2-way split as the "no idle occupant" case.
    const [o1x, o1z] = WAITING_QUEUE_SLOT_OFFSETS[0]!;
    const [o2x, o2z] = WAITING_QUEUE_SLOT_OFFSETS[1]!;
    expect(vm.waitingRenderPosition(v1, pool, employees)).toEqual([20 + o1x, 20 + o1z]);
    expect(vm.waitingRenderPosition(v2, pool, employees)).toEqual([20 + o2x, 20 + o2z]);

    vm.dispose();
  });

  describe('scene picking (P2)', () => {
    it('pickables() returns one tagged object per vehicle', () => {
      const scene = new THREE.Scene();
      const vm = new VehicleMesh(scene);
      const v1 = makeVehicle(1, 'debris_hauler');
      const v2 = makeVehicle(2, 'rock_digger', 5, 5);
      const vs = makeVehicleState([v1, v2]);
      vm.addVehicle(v1, vs, []);
      vm.addVehicle(v2, vs, []);
      const pickables = vm.pickables();
      expect(pickables).toHaveLength(2);
      expect(pickables.map(o => o.userData['entityId']).sort()).toEqual([1, 2]);
      expect(pickables.every(o => o.userData['entityKind'] === 'vehicle')).toBe(true);
      vm.dispose();
    });

    it('getPosition() returns the vehicle group world position', () => {
      const scene = new THREE.Scene();
      const vm = new VehicleMesh(scene);
      const v = makeVehicle(1, 'debris_hauler', 12, 7);
      vm.addVehicle(v, makeVehicleState([v]), []);
      const pos = vm.getPosition(1);
      expect(pos?.x).toBeCloseTo(12);
      expect(pos?.z).toBeCloseTo(7);
      vm.dispose();
    });

    it('getPosition() returns null for an id that was never added', () => {
      const scene = new THREE.Scene();
      const vm = new VehicleMesh(scene);
      expect(vm.getPosition(999)).toBeNull();
      vm.dispose();
    });
  });
});

// ── Model-driven rendering: heading, wheel spin, flywheel, stand-in refresh ──

describe('VehicleMesh — model animation (real assets)', () => {
  it('turns toward the direction of travel and spins the hauler wheels by distance covered', async () => {
    const library = await loadedModelLibrary(['vehicle_debris_hauler_t2']);
    const scene = new THREE.Scene();
    const vm = new VehicleMesh(scene, library);
    const v = makeVehicle(1, 'debris_hauler', 0, 0, 2);
    vm.addVehicle(v, makeVehicleState([v]), []);
    const inst = vm.getInstance(1)!;
    expect(inst.isFallback).toBe(false);
    const wheel = inst.node('WheelFL')!;
    const group = scene.children[0] as THREE.Group;

    // Drive toward -Z: a +X-facing model must yaw to +π/2 and its wheels must roll.
    v.x = 0; v.z = -6;
    for (let i = 0; i < 30; i++) vm.update([v], makeVehicleState([v]), [], 0.05);
    expect(group.rotation.y).toBeCloseTo(Math.PI / 2, 1);
    expect(wheel.rotation.z).toBeLessThan(-1);
    // Parked: no further spin.
    const spun = wheel.rotation.z;
    vm.update([v], makeVehicleState([v]), [], 0.05);
    expect(wheel.rotation.z).toBe(spun);
    vm.dispose();
  });

  it('runs the crusher flywheel only while working', async () => {
    const library = await loadedModelLibrary(['vehicle_rock_fragmenter_t2']);
    const scene = new THREE.Scene();
    const vm = new VehicleMesh(scene, library);
    const v = makeVehicle(1, 'rock_fragmenter', 0, 0, 2);
    vm.addVehicle(v, makeVehicleState([v]), []);
    const flywheel = vm.getInstance(1)!.node('Flywheel')!;
    vm.update([v], makeVehicleState([v]), [], 0.1);
    expect(flywheel.rotation.z).toBeCloseTo(0);

    // #1138: "working" is derived from the occupant's own task timer now —
    // no more Vehicle.state to poke directly.
    const worker = makeWorkingOccupant(v);
    vm.update([v], makeVehicleState([v]), [worker], 0.1);
    expect(flywheel.rotation.z).toBeGreaterThan(0);
    vm.dispose();
  });

  it('refreshModels swaps a stand-in for the real model and leaves no sphere above it (#2226)', async () => {
    const library = await loadedModelLibrary([]);
    const scene = new THREE.Scene();
    const vm = new VehicleMesh(scene, library);
    const v = makeVehicle(1, 'drill_rig', 0, 0, 2);
    vm.addVehicle(v, makeVehicleState([v]), []);
    expect(vm.getInstance(1)!.isFallback).toBe(true);
    vm.refreshModels(makeVehicleState([v]), []); // asset still missing — no change
    expect(vm.getInstance(1)!.isFallback).toBe(true);
    const loaded = await loadedModelLibrary(['vehicle_drill_rig_t2']);
    library.register('vehicle_drill_rig_t2', (loaded as unknown as { prototypes: Map<string, never> })['prototypes'].get('vehicle_drill_rig_t2')!);
    vm.refreshModels(makeVehicleState([v]), []);
    const inst = vm.getInstance(1)!;
    expect(inst.isFallback).toBe(false);
    expect(inst.node('Mast')).not.toBeNull();
    let spheres = 0;
    scene.traverse(c => { if ((c as THREE.Mesh).isMesh && (c as THREE.Mesh).geometry instanceof THREE.SphereGeometry) spheres++; });
    expect(spheres).toBe(0);
    vm.dispose();
  });
});


// ── Vehicle and rider share one timeline (#2224) ────────────────────────────
// A vehicle mesh holds still until its driver, boarding in the same batch, has walked up and vanished into
// it, and stops before an alighting driver is drawn. Each case drives real CharacterMesh + VehicleMesh
// frames through the public API, with hand-built walk trails.

const FRAME_DT = 1 / 64; // exact in binary
const BATCH_SIZES = [1, 2, 4, 8] as const;
const X0 = 20;
const Z0 = 10;

function makeRider(x: number, z: number): Employee {
  const id = _nextEmployeeId++;
  const { employee } = hireEmployee(createEmployeeState(), 'driller', new Random(id), x, z);
  employee.id = id;
  return employee;
}

/** Unit-cell polyline along z=Z0 from x=`from` to x=`to` inclusive. */
function line(from: number, to: number): TrailPoint[] {
  const out: TrailPoint[] = [];
  const dir = to >= from ? 1 : -1;
  for (let x = from; x !== to + dir; x += dir) out.push({ x, z: Z0 });
  return out;
}

function riderMarker(pointIndex: number, event: TrailHostEvent, riderId?: number, riderArc?: number) {
  return {
    pointIndex, event, hostKind: 'vehicle' as const, hostX: X0, hostZ: Z0,
    ...(riderId !== undefined ? { riderId } : {}),
    ...(riderArc !== undefined ? { riderArc } : {}),
  };
}

function trailOf(points: TrailPoint[], hostMarkers: MovementTrail['hostMarkers'], relocated = false): MovementTrail {
  return { points, relocated, hostMarkers };
}

interface Rig {
  scene: THREE.Scene;
  vm: VehicleMesh;
  cm: CharacterMesh;
  vehicle: Vehicle;
  state: VehicleState;
  driver: Employee;
}

/** A vehicle at (X0, Z0) and its driver, both meshes added at their batch-start positions. */
function rig(driverStartX: number, driverMeshed: boolean): Rig {
  const scene = new THREE.Scene();
  const vm = new VehicleMesh(scene);
  const cm = new CharacterMesh(scene);
  const vehicle = makeVehicle(1, 'debris_hauler', X0, Z0);
  const driver = makeRider(driverStartX, Z0);
  const state = makeVehicleState([vehicle]);
  vm.addVehicle(vehicle, state, [driver]);
  if (driverMeshed) cm.addEmployee(driver, 0);
  return { scene, vm, cm, vehicle, state, driver };
}

interface Sample { charVisible: boolean; charExists: boolean; vx: number; vz: number }

function runFrames(r: Rig, seconds: number, dt = FRAME_DT): Sample[] {
  const out: Sample[] = [];
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    r.cm.update([r.driver], dt);
    r.vm.update([r.vehicle], r.state, [r.driver], dt);
    const g = r.cm.getGroup(r.driver.id);
    const p = r.vm.getPosition(r.vehicle.id)!;
    out.push({ charVisible: g?.visible === true, charExists: g !== null, vx: p.x, vz: p.z });
  }
  return out;
}

/** The batch in which `driver` walks `walk` cells to the vehicle, boards it and rides `ride` cells. */
function boardBatch(r: Rig, walk: number, ride: number): void {
  const { vehicle, driver } = r;
  vehicle.x = X0 + ride;
  vehicle.walkTrail = trailOf(line(X0, X0 + ride), [riderMarker(0, 'board', driver.id, walk)]);
  driver.x = vehicle.x;
  driver.z = vehicle.z;
  driver.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
  vehicle.occupantIds = [driver.id];
  driver.walkTrail = trailOf(
    line(X0 - walk, X0 + ride),
    [{ pointIndex: walk, event: 'board', hostKind: 'vehicle', hostX: X0, hostZ: Z0 }],
  );
  r.cm.retireEmployee(driver);
}

/** The batch in which `driver`, riding at batch start, is driven `ride` cells, steps out one cell on and walks `walk` more. */
function alightBatch(r: Rig, ride: number, walk: number): void {
  const { vehicle, driver } = r;
  vehicle.x = X0 + ride;
  vehicle.walkTrail = trailOf(line(X0, X0 + ride), [riderMarker(ride, 'alight', driver.id, ride)]);
  vehicle.occupantIds = [];
  driver.x = X0 + ride + 1 + walk;
  driver.z = Z0;
  driver.locomotion = { kind: 'on_foot' };
  driver.walkTrail = trailOf(
    line(X0, X0 + ride + 1 + walk),
    [{ pointIndex: ride + 1, event: 'alight', hostKind: 'vehicle', hostX: X0 + ride, hostZ: Z0 }],
  );
  r.cm.addEmployee(driver, 0, driver.walkTrail);
}

describe('VehicleMesh — holds still until the boarding driver is inside (#2224)', () => {
  for (const batch of BATCH_SIZES) {
    it(`batch of ${batch}: the vehicle mesh stays at its batch-start position in every frame the boarding character is visible`, () => {
      const walk = batch;
      const ride = 2 * batch;
      const r = rig(X0 - walk, true);
      boardBatch(r, walk, ride);
      const frames = runFrames(r, 1.5);
      const shown = frames.filter(f => f.charVisible);
      expect(shown.length).toBeGreaterThan(0); // the walk to the vehicle was on screen
      for (const f of shown) {
        expect(f.vx).toBeCloseTo(X0, 2);
        expect(f.vz).toBeCloseTo(Z0, 2);
      }
      r.vm.dispose(); r.cm.dispose();
    });

    it(`batch of ${batch}: once the driver is gone the vehicle drives on and ends at its target`, () => {
      const r = rig(X0 - batch, true);
      boardBatch(r, batch, 2 * batch);
      const frames = runFrames(r, 1.5);
      expect(r.cm.count).toBe(0);
      const moved = frames.filter(f => !f.charExists && f.vx > X0 + 1e-3);
      expect(moved.length).toBeGreaterThan(0);
      expect(frames[frames.length - 1]!.vx).toBeCloseTo(X0 + 2 * batch, 6);
      // The vehicle never drives backwards or overshoots.
      for (let i = 1; i < frames.length; i++) expect(frames[i]!.vx).toBeGreaterThanOrEqual(frames[i - 1]!.vx - 1e-9);
      for (const f of frames) expect(f.vx).toBeLessThanOrEqual(X0 + 2 * batch + 1e-9);
      r.vm.dispose(); r.cm.dispose();
    });

    it(`batch of ${batch}: the vehicle moves for the first time no earlier than the frame the driver vanishes`, () => {
      const r = rig(X0 - batch, true);
      boardBatch(r, batch, 2 * batch);
      const frames = runFrames(r, 1.5);
      const firstMove = frames.findIndex(f => f.vx > X0 + 1e-3);
      const goneAt = frames.findIndex(f => !f.charExists);
      expect(goneAt).toBeGreaterThanOrEqual(0);
      expect(firstMove).toBeGreaterThanOrEqual(goneAt - 1);
      r.vm.dispose(); r.cm.dispose();
    });
  }

  it('only the locomotion tick writes the vehicle position: the renderer leaves vehicle.x/z alone', () => {
    const r = rig(X0 - 2, true);
    boardBatch(r, 2, 4);
    runFrames(r, 1.5);
    expect(r.vehicle.x).toBe(X0 + 4);
    expect(r.vehicle.z).toBe(Z0);
    r.vm.dispose(); r.cm.dispose();
  });
});

describe('VehicleMesh — stops before the alighting driver is drawn (#2224)', () => {
  for (const batch of BATCH_SIZES) {
    it(`batch of ${batch}: the vehicle mesh is stationary at the alight point in every frame the character is visible`, () => {
      const ride = 2 * batch;
      const r = rig(X0, false);
      alightBatch(r, ride, batch);
      const frames = runFrames(r, 1.5);
      let prevX = X0;
      let shown = 0;
      frames.forEach(f => {
        if (f.charVisible) {
          shown++;
          expect(Math.abs(f.vx - (X0 + ride))).toBeLessThanOrEqual(1);
          expect(Math.abs(f.vx - prevX)).toBeLessThan(1e-6);
        }
        prevX = f.vx;
      });
      expect(shown).toBeGreaterThan(0);
      r.vm.dispose(); r.cm.dispose();
    });

    it(`batch of ${batch}: the vehicle was driving before the driver appeared (it did not stand still the whole batch)`, () => {
      const ride = 2 * batch;
      const r = rig(X0, false);
      alightBatch(r, ride, batch);
      const frames = runFrames(r, 1.5);
      const firstShown = frames.findIndex(f => f.charVisible);
      expect(firstShown).toBeGreaterThan(0);
      expect(frames.slice(0, firstShown).some(f => f.vx > X0 + 1e-3 && f.vx < X0 + ride - 1e-3)).toBe(true);
      expect(frames[firstShown]!.vx).toBeCloseTo(X0 + ride, 6);
      r.vm.dispose(); r.cm.dispose();
    });
  }

  it('the driver then walks away from a vehicle that stays parked', () => {
    const r = rig(X0, false);
    alightBatch(r, 4, 3);
    const frames = runFrames(r, 2);
    const last = frames[frames.length - 1]!;
    expect(last.charVisible).toBe(true);
    expect(last.vx).toBeCloseTo(X0 + 4, 6);
    expect(r.cm.getPosition(r.driver.id)!.x).toBeCloseTo(X0 + 4 + 1 + 3, 6);
    r.vm.dispose(); r.cm.dispose();
  });
});

describe('VehicleMesh — board and alight in the same batch (#2224)', () => {
  for (const batch of BATCH_SIZES) {
    it(`ride of ${batch} cells: the vehicle drives only while the driver is hidden, and parks wherever the driver is seen`, () => {
      const walk = 2;
      const ride = batch;
      const r = rig(X0 - walk, true);
      const { vehicle, driver } = r;
      vehicle.x = X0 + ride;
      vehicle.walkTrail = trailOf(line(X0, X0 + ride), [
        riderMarker(0, 'board', driver.id, walk),
        riderMarker(ride, 'alight', driver.id, walk + ride),
      ]);
      driver.x = X0 + ride + 1 + 2;
      driver.walkTrail = trailOf(line(X0 - walk, X0 + ride + 3), [
        { pointIndex: walk, event: 'board', hostKind: 'vehicle', hostX: X0, hostZ: Z0 },
        { pointIndex: walk + ride + 1, event: 'alight', hostKind: 'vehicle', hostX: X0 + ride, hostZ: Z0 },
      ]);

      const frames = runFrames(r, 1.5);
      let prevX = X0;
      let sawDriving = false;
      for (const f of frames) {
        if (f.charVisible) {
          expect(Math.abs(f.vx - prevX)).toBeLessThan(1e-6);
          const atStart = Math.abs(f.vx - X0) < 1e-3;
          const atEnd = Math.abs(f.vx - (X0 + ride)) < 1e-3;
          expect(atStart || atEnd).toBe(true);
        } else if (f.charExists && f.vx > X0 + 1e-3 && f.vx < X0 + ride - 1e-3) {
          sawDriving = true;
        }
        prevX = f.vx;
      }
      if (ride > 1) expect(sawDriving).toBe(true);
      expect(frames[frames.length - 1]!.vx).toBeCloseTo(X0 + ride, 6);
      expect(frames[frames.length - 1]!.charVisible).toBe(true);
      r.vm.dispose(); r.cm.dispose();
    });
  }
});

describe('VehicleMesh — no riding window, the old glide (#2224)', () => {
  const FAR = 8;
  const movedAfter = (r: Rig, frames: number): number => {
    for (let i = 0; i < frames; i++) r.vm.update([r.vehicle], r.state, [r.driver], FRAME_DT);
    return r.vm.getPosition(r.vehicle.id)!.x - X0;
  };

  it('a rider trail flagged relocated gives no window: the vehicle moves from the first frames', () => {
    const r = rig(X0 - 2, false);
    const { vehicle, driver } = r;
    vehicle.x = X0 + FAR;
    vehicle.walkTrail = trailOf(line(X0, X0 + FAR), [riderMarker(0, 'board', driver.id, 6)]);
    driver.walkTrail = trailOf(line(X0 - 2, X0 + FAR), [], true);
    expect(movedAfter(r, 4)).toBeGreaterThan(0.2);
    r.vm.dispose();
  });

  it('a capped rider trail gives no window', () => {
    const r = rig(X0 - 2, false);
    const { vehicle, driver } = r;
    vehicle.x = X0 + FAR;
    vehicle.walkTrail = trailOf(line(X0, X0 + FAR), [riderMarker(0, 'board', driver.id, 100)]);
    driver.walkTrail = trailOf(Array.from({ length: MOVEMENT_TRAIL_MAX_POINTS }, (_, i) => ({ x: X0 - 2 + i * 0.1, z: Z0 })), []);
    expect(movedAfter(r, 4)).toBeGreaterThan(0.2);
    r.vm.dispose();
  });

  it('a rider the employees list does not hold gives no window', () => {
    const r = rig(X0 - 2, false);
    const { vehicle, driver } = r;
    vehicle.x = X0 + FAR;
    vehicle.walkTrail = trailOf(line(X0, X0 + FAR), [riderMarker(0, 'board', driver.id, 6)]);
    for (let i = 0; i < 4; i++) r.vm.update([vehicle], r.state, [], FRAME_DT);
    expect(r.vm.getPosition(vehicle.id)!.x - X0).toBeGreaterThan(0.2);
    r.vm.dispose();
  });

  it('a drive with no rider markers (driver aboard all batch) moves from the first frame and ends on target', () => {
    const r = rig(X0, false);
    const { vehicle, driver } = r;
    driver.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
    vehicle.occupantIds = [driver.id];
    vehicle.x = X0 + FAR;
    vehicle.walkTrail = trailOf(line(X0, X0 + FAR), []);
    driver.walkTrail = trailOf(line(X0, X0 + FAR), []);
    expect(movedAfter(r, 4)).toBeGreaterThan(0.2);
    for (let i = 0; i < 80; i++) r.vm.update([vehicle], r.state, [driver], FRAME_DT);
    expect(r.vm.getPosition(vehicle.id)!.x).toBeCloseTo(X0 + FAR, 6);
    r.vm.dispose();
  });

  it('a waiting-queue offset render is a render-only shift: no window, the mesh glides to its slot at once', () => {
    const scene = new THREE.Scene();
    const vm = new VehicleMesh(scene);
    const a = makeVehicle(1, 'debris_hauler', X0, Z0);
    const b = makeVehicle(2, 'debris_hauler', X0 + 2, Z0);
    const waitingA = makeWaitingOccupant(a, 40, Z0);
    makeWaitingOccupant(b, 40, Z0);
    const employees = [waitingA, makeWaitingOccupant(b, 40, Z0)];
    const state = makeVehicleState([a, b]);
    vm.addVehicle(a, state, employees);
    vm.addVehicle(b, state, employees);
    a.x = X0 + 1;
    // A rider marker that, if honoured, would hold the mesh for 90% of the tween.
    a.walkTrail = trailOf(line(X0, X0 + 1), [riderMarker(0, 'board', waitingA.id, 9)]);
    waitingA.walkTrail = trailOf(line(X0 - 9, X0 + 1), []);
    for (let i = 0; i < 4; i++) vm.update([a, b], state, employees, FRAME_DT);
    expect(vm.getPosition(1)!.x - X0).toBeGreaterThan(0.2);
    vm.dispose();
  });
});
