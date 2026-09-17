// VehicleMesh — unit tests

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { Vehicle, VehicleTier, VehicleState } from '../../../src/core/entities/Vehicle.js';
import type { Employee } from '../../../src/core/entities/Employee.js';
import { hireEmployee, createEmployeeState } from '../../../src/core/entities/Employee.js';
import { Random } from '../../../src/core/math/Random.js';
import { VehicleMesh, STATE_COLOR_MAP, applyStateIndicator, BODY_TINT } from '../../../src/renderer/VehicleMesh.js';
import type { VehicleStatusKind } from '../../../src/core/entities/VehicleStatus.js';
import { WAITING_QUEUE_SLOT_OFFSETS } from '../../../src/core/config/balance.js';
import { MOVE_TWEEN_DURATION_S } from '../../../src/renderer/MovementInterpolation.js';
import { loadedModelLibrary } from '../../helpers/models.js';

function makeVehicle(id: number, type: Vehicle['type'], x = 0, z = 0, tier = 1 as VehicleTier, hp = 100): Vehicle {
  return { id, type, tier, x, z, hp, payload: null, occupantIds: [] };
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
    const types: Vehicle['type'][] = ['debris_hauler', 'rock_digger', 'drill_rig', 'building_destroyer', 'rock_fragmenter'];
    const vehicles = types.map((t, i) => makeVehicle(i, t, i * 5, 0));
    const vs = makeVehicleState(vehicles);
    vehicles.forEach(v => vm.addVehicle(v, vs, []));
    expect(vm.count).toBe(5);
    vm.dispose();
  });

  it('vehicles have multiple children (composed shapes)', () => {
    const scene = new THREE.Scene();
    const vm = new VehicleMesh(scene);
    const types: Vehicle['type'][] = ['debris_hauler', 'rock_digger', 'drill_rig', 'building_destroyer', 'rock_fragmenter'];
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

// ── Issue #411: operational-state visual indicator ─────────────────────────
// Prior to this, VehicleOperationalState.working (and waiting/broken) all
// rendered identically to idle since only position lerped — no color/marker
// distinguished them. STATE_COLOR_MAP and applyStateIndicator close that gap,
// following the same material-manipulation pattern as applyTierVariation.
//
// #1138: VehicleOperationalState (a Vehicle-native field) is deleted —
// STATE_COLOR_MAP is now keyed by VehicleStatusKind (VehicleStatus.ts), the
// fully-derived replacement, with two new kinds (stuck, hauling) that never
// existed as a Vehicle.state value.

describe('STATE_COLOR_MAP (#411, #1138)', () => {
  const ALL_KINDS: VehicleStatusKind[] = ['idle', 'moving', 'working', 'waiting', 'broken', 'stuck', 'hauling'];

  it('has a numeric color entry for every VehicleStatusKind', () => {
    for (const kind of ALL_KINDS) {
      expect(STATE_COLOR_MAP[kind], `missing color for kind "${kind}"`).toBeTypeOf('number');
    }
  });

  it('assigns a color to each of the 7 kinds, with working and hauling deliberately sharing the "actively doing something" green', () => {
    const colors = ALL_KINDS.map(k => STATE_COLOR_MAP[k]);
    // working/hauling intentionally share a color (both read as "green,
    // actively productive") — every other pair is still distinct.
    const unique = new Set(colors);
    expect(unique.size).toBe(ALL_KINDS.length - 1);
    expect(STATE_COLOR_MAP.working).toBe(STATE_COLOR_MAP.hauling);
  });
});

describe('applyStateIndicator (#411)', () => {
  /** Marker mesh contract: a single child tagged userData.isStateIndicator. */
  function getIndicatorMeshes(group: THREE.Group): THREE.Mesh[] {
    return group.children.filter(
      (c): c is THREE.Mesh => c instanceof THREE.Mesh && c.userData?.['isStateIndicator'] === true,
    );
  }

  it('adds exactly one state-indicator marker mesh to the group', () => {
    const group = new THREE.Group();
    applyStateIndicator(group, 'working');

    expect(getIndicatorMeshes(group)).toHaveLength(1);
  });

  it("marker material color matches STATE_COLOR_MAP['broken']", () => {
    const group = new THREE.Group();
    applyStateIndicator(group, 'broken');

    const marker = getIndicatorMeshes(group)[0]!;
    const mat = marker.material as THREE.MeshBasicMaterial | THREE.MeshPhongMaterial;
    expect(mat.color.getHex()).toBe(STATE_COLOR_MAP['broken']);
  });

  it("marker material color matches STATE_COLOR_MAP['waiting']", () => {
    const group = new THREE.Group();
    applyStateIndicator(group, 'waiting');

    const marker = getIndicatorMeshes(group)[0]!;
    const mat = marker.material as THREE.MeshBasicMaterial | THREE.MeshPhongMaterial;
    expect(mat.color.getHex()).toBe(STATE_COLOR_MAP['waiting']);
  });

  it("marker material color matches STATE_COLOR_MAP['stuck']", () => {
    const group = new THREE.Group();
    applyStateIndicator(group, 'stuck');

    const marker = getIndicatorMeshes(group)[0]!;
    const mat = marker.material as THREE.MeshBasicMaterial | THREE.MeshPhongMaterial;
    expect(mat.color.getHex()).toBe(STATE_COLOR_MAP['stuck']);
  });

  it('updates the existing marker in place on repeated calls rather than stacking duplicates', () => {
    const group = new THREE.Group();
    applyStateIndicator(group, 'idle');
    applyStateIndicator(group, 'moving');
    applyStateIndicator(group, 'working');

    const markers = getIndicatorMeshes(group);
    expect(markers).toHaveLength(1);
    const mat = markers[0]!.material as THREE.MeshBasicMaterial | THREE.MeshPhongMaterial;
    expect(mat.color.getHex()).toBe(STATE_COLOR_MAP['working']);
  });

  it('does not remove or alter the group\'s existing body meshes', () => {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshPhongMaterial({ color: 0xf5c518 }));
    group.add(body);

    applyStateIndicator(group, 'working');

    expect(group.children).toContain(body);
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

  it('refreshModels swaps a stand-in for the real model, keeping the state marker above it', async () => {
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
    const group = scene.children[0] as THREE.Group;
    const marker = group.children.find(c => c.userData['isStateIndicator']) as THREE.Mesh;
    expect(marker.position.y).toBeGreaterThan(inst.bounds.max.y);
    vm.dispose();
  });
});
