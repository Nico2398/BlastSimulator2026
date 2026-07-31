// VehicleMesh — unit tests

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { Vehicle, VehicleTier, VehicleOperationalState } from '../../../src/core/entities/Vehicle.js';
import { VehicleMesh, STATE_COLOR_MAP, applyStateIndicator } from '../../../src/renderer/VehicleMesh.js';
import { WAITING_QUEUE_SLOT_OFFSETS } from '../../../src/core/config/balance.js';

function makeVehicle(id: number, type: Vehicle['type'], x = 0, z = 0, tier = 1 as VehicleTier): Vehicle {
  return { id, type, x, z, hp: 100, task: 'idle', state: 'idle', targetX: x, targetZ: z, tier } as Vehicle;
}

describe('VehicleMesh', () => {
  it('addVehicle adds group to scene', () => {
    const scene = new THREE.Scene();
    const vm = new VehicleMesh(scene);
    vm.addVehicle(makeVehicle(1, 'debris_hauler'));
    expect(scene.children.length).toBe(1);
    expect(vm.count).toBe(1);
    vm.dispose();
  });

  it('all vehicle roles can be added', () => {
    const scene = new THREE.Scene();
    const vm = new VehicleMesh(scene);
    const types: Vehicle['type'][] = ['debris_hauler', 'rock_digger', 'drill_rig', 'building_destroyer', 'rock_fragmenter'];
    types.forEach((t, i) => vm.addVehicle(makeVehicle(i, t, i * 5, 0)));
    expect(vm.count).toBe(5);
    vm.dispose();
  });

  it('vehicles have multiple children (composed shapes)', () => {
    const scene = new THREE.Scene();
    const vm = new VehicleMesh(scene);
    const types: Vehicle['type'][] = ['debris_hauler', 'rock_digger', 'drill_rig', 'building_destroyer', 'rock_fragmenter'];
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
    const v = makeVehicle(1, 'debris_hauler', 0, 0);
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
    vm.addVehicle(makeVehicle(1, 'building_destroyer', 0, 0));
    vm.snapPosition(1, 50, 0, 75);
    const group = scene.children[0] as THREE.Group;
    expect(group.position.x).toBeCloseTo(50);
    expect(group.position.z).toBeCloseTo(75);
    vm.dispose();
  });

  it('removeVehicle removes specific mesh', () => {
    const scene = new THREE.Scene();
    const vm = new VehicleMesh(scene);
    vm.addVehicle(makeVehicle(1, 'debris_hauler'));
    vm.addVehicle(makeVehicle(2, 'rock_digger'));
    vm.removeVehicle(1);
    expect(scene.children.length).toBe(1);
    expect(vm.count).toBe(1);
    vm.dispose();
  });

  it('clearAll removes all vehicles', () => {
    const scene = new THREE.Scene();
    const vm = new VehicleMesh(scene);
    vm.addVehicle(makeVehicle(1, 'debris_hauler'));
    vm.addVehicle(makeVehicle(2, 'drill_rig'));
    vm.clearAll();
    expect(scene.children.length).toBe(0);
    vm.dispose();
  });
});

// ── Task 2.13: tier-specific scale and color variation ────────────────────────
// Role used throughout: debris_hauler.
//   • children[0] of its group is the yellow body mesh — the first part built,
//     and the one whose material color reflects the tier tint.
//   • group.scale.x reflects the uniform scale applied via group.scale.setScalar().

describe('VehicleMesh — tier scale variation', () => {
  /** Helper: add a debris_hauler at the given tier, return group.scale.x. */
  const getScale = (tier: VehicleTier): number => {
    const scene = new THREE.Scene();
    const vm = new VehicleMesh(scene);
    vm.addVehicle(makeVehicle(1, 'debris_hauler', 0, 0, tier));
    const group = scene.children[0] as THREE.Group;
    const sx = group.scale.x;
    vm.dispose();
    return sx;
  };

  it('T2 vehicle group scale is larger than T1', () => {
    // Higher tier → bigger vehicle → setScalar(value > 1) for T2 relative to T1.
    expect(getScale(2)).toBeGreaterThan(getScale(1));
  });

  it('T3 vehicle group scale is larger than T2', () => {
    // T3 must be strictly larger than T2.
    expect(getScale(3)).toBeGreaterThan(getScale(2));
  });
});

describe('VehicleMesh — tier color brightening', () => {
  /**
   * Helper: add a debris_hauler at the given tier and return the RGB components
   * of the first child mesh's MeshPhongMaterial color.
   * The first child of debris_hauler is the yellow body (children[0]).
   */
  const getBodyColor = (tier: VehicleTier): { r: number; g: number; b: number } => {
    const scene = new THREE.Scene();
    const vm = new VehicleMesh(scene);
    vm.addVehicle(makeVehicle(1, 'debris_hauler', 0, 0, tier));
    const group = scene.children[0] as THREE.Group;
    const bodyMesh = group.children[0] as THREE.Mesh;
    const color = (bodyMesh.material as THREE.MeshPhongMaterial).color;
    vm.dispose();
    return { r: color.r, g: color.g, b: color.b };
  };

  it('T2 debris_hauler body color is brighter than T1', () => {
    // Higher tier → brighter tint on the body material.
    const c1 = getBodyColor(1);
    const c2 = getBodyColor(2);
    const brighter = c2.r > c1.r || c2.g > c1.g || c2.b > c1.b;
    expect(brighter).toBe(true);
  });

  it('T3 debris_hauler body color is brighter than T2', () => {
    // T3 must be strictly brighter than T2 on at least one channel.
    const c2 = getBodyColor(2);
    const c3 = getBodyColor(3);
    const brighter = c3.r > c2.r || c3.g > c2.g || c3.b > c2.b;
    expect(brighter).toBe(true);
  });
});

// ── Issue #411: operational-state visual indicator ─────────────────────────
// Prior to this, VehicleOperationalState.working (and waiting/broken) all
// rendered identically to idle since only position lerped — no color/marker
// distinguished them. STATE_COLOR_MAP and applyStateIndicator close that gap,
// following the same material-manipulation pattern as applyTierVariation.

describe('STATE_COLOR_MAP (#411)', () => {
  const ALL_STATES: VehicleOperationalState[] = ['idle', 'moving', 'working', 'waiting', 'broken'];

  it('has a numeric color entry for every VehicleOperationalState', () => {
    for (const state of ALL_STATES) {
      expect(STATE_COLOR_MAP[state], `missing color for state "${state}"`).toBeTypeOf('number');
    }
  });

  it('assigns a distinct color to each of the 5 states', () => {
    const colors = ALL_STATES.map(s => STATE_COLOR_MAP[s]);
    const unique = new Set(colors);
    expect(unique.size).toBe(ALL_STATES.length);
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
// anchored to the shared target rather than each vehicle's own raw x/z).
// These tests lock in the fixed behavior of both rounds.

describe('waitingQueueOffset / waitingRenderPosition (#411)', () => {
  it('an idle vehicle occupying the exact target cell reserves slot 0 and renders at its own unoffset position', () => {
    const scene = new THREE.Scene();
    const vm = new VehicleMesh(scene);

    const idleAtTarget = makeVehicle(1, 'debris_hauler', 10, 10, 1);
    idleAtTarget.state = 'idle';
    idleAtTarget.targetX = 10;
    idleAtTarget.targetZ = 10;

    const waiting = makeVehicle(2, 'debris_hauler', 5, 5, 1);
    waiting.state = 'waiting';
    waiting.targetX = 10;
    waiting.targetZ = 10;

    const pool = [idleAtTarget, waiting];

    // Idle occupant is never offset regardless of slot bookkeeping.
    expect(vm.waitingQueueOffset(idleAtTarget, pool)).toEqual([0, 0]);
    expect(vm.waitingRenderPosition(idleAtTarget, pool)).toEqual([10, 10]);

    // Idle occupant claims slot 0 first (ascending id), so the waiting
    // vehicle must NOT also get the [0, 0] offset — it would render on top.
    expect(vm.waitingQueueOffset(waiting, pool)).toEqual(WAITING_QUEUE_SLOT_OFFSETS[1]);

    vm.dispose();
  });

  it('waiting vehicles anchor to the shared target, not their own raw x/z (round 4 regression)', () => {
    const scene = new THREE.Scene();
    const vm = new VehicleMesh(scene);

    // Two vehicles converging on the same target from very different raw
    // positions — the bug this guards against added the offset to each
    // vehicle's own x/z, scattering them instead of anchoring to the target.
    const v1 = makeVehicle(1, 'debris_hauler', 1, 1, 1);
    v1.state = 'waiting';
    v1.targetX = 20;
    v1.targetZ = 20;

    const v2 = makeVehicle(2, 'debris_hauler', 40, 45, 1);
    v2.state = 'waiting';
    v2.targetX = 20;
    v2.targetZ = 20;

    const pool = [v1, v2];

    const [o1x, o1z] = WAITING_QUEUE_SLOT_OFFSETS[0]!;
    const [o2x, o2z] = WAITING_QUEUE_SLOT_OFFSETS[1]!;

    expect(vm.waitingRenderPosition(v1, pool)).toEqual([20 + o1x, 20 + o1z]);
    expect(vm.waitingRenderPosition(v2, pool)).toEqual([20 + o2x, 20 + o2z]);

    vm.dispose();
  });

  it('4 waiting vehicles sharing a target get distinct slots at least one slot-spacing apart', () => {
    const scene = new THREE.Scene();
    const vm = new VehicleMesh(scene);

    const vehicles = [1, 2, 3, 4].map(id => {
      const v = makeVehicle(id, 'debris_hauler', id, id, 1);
      v.state = 'waiting';
      v.targetX = 50;
      v.targetZ = 50;
      return v;
    });

    const positions = vehicles.map(v => vm.waitingRenderPosition(v, vehicles));

    // sharingTarget is ascending-id order with no idle occupant, so vehicle
    // at array index i gets WAITING_QUEUE_SLOT_OFFSETS[i] — derive the
    // expected minimum spacing from the real constant, not a hardcoded value.
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
    const vehicles = Array.from({ length: count }, (_, i) => {
      const v = makeVehicle(i + 1, 'debris_hauler', i, i, 1);
      v.state = 'waiting';
      v.targetX = 5;
      v.targetZ = 5;
      return v;
    });

    const firstOffset = vm.waitingQueueOffset(vehicles[0]!, vehicles);
    const wrappedOffset = vm.waitingQueueOffset(vehicles[vehicles.length - 1]!, vehicles);

    expect(wrappedOffset).toEqual(firstOffset);
    expect(wrappedOffset).toEqual(WAITING_QUEUE_SLOT_OFFSETS[0]);

    vm.dispose();
  });
});
